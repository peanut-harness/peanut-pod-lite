# Design

## Context

参见 `proposal.md` 的动机。当前 Hub 对全部写 capability 使用全局 write slot 并执行日志 postflight；Editor MCP 内部又通过 `ResourceOperationTaskQueue` 进行项目 writer 与多资源闭包调度并再次执行 postflight。与此同时，Runtime 已有另一套任务账本、优先级、取消、超时、trace 与批提交骨架，但其提交派发器仅识别少量硬编码 kind，资源锁也只有单键语义。

现有约束包括：83 项 Editor MCP 业务 operation 和默认同步调用必须兼容；写/破坏性操作继续消费绑定连接、operation、资源和风险的本地审批；Lite 不依赖 Pro；Creator 实机证据必须绑定实际加载产物；第三方插件未迁移时不能改变原有 Hub 写入语义。

## Goals / Non-Goals

**Goals:**

- 建立一套共享任务控制面，统一状态、归属、账本、取消、超时、幂等、trace 和证据索引。
- 允许不同任务域使用显式注册的调度/执行策略，Editor MCP 保留完整资源闭包和 project writer 语义。
- 消除受管任务路径上的 Hub 全局串行和重复 postflight，同时维持未迁移插件兼容。
- 以异步核心承载同步兼容适配，为后续长任务和批次工作流提供稳定基础。

**Non-Goals:**

- 本变更不增加新的 Editor MCP 业务 operation，也不改变 Lite/Pro 能力归属。
- 本变更不实现任务自动重试；失败后的重放仍由调用方依据结构化失败显式决定。
- 本变更不把 `scaffold → compAdd/Set → bind → commit → preview` 合并为新的原子业务事务；统一控制面完成后另行设计。
- 本变更不把未验证的 Creator 2.4 或 3.0–3.5 写能力提升为 verified。

## Decisions

### 1. 共享控制面，保留领域调度策略

从 Runtime 任务实现中提取实例级 `TaskControlPlane`，负责任务标识、owner、状态机、结果、失败、timeout/cancel、idempotency、trace、证据和保留策略。执行调度通过 `TaskExecutionStrategy` 接口注入：现有通用 Runtime 使用其合并/提交策略，Editor MCP 使用资源闭包策略。

不直接把 Editor MCP 塞进现有 `ExecutionRuntimeService`。后者目前使用单锁键、单提交队列和硬编码 commit dispatcher，直接复用会丢失跨工程并行、原子多资源锁和 AssetDB transaction 语义。也不继续扩展独立 `ResourceOperationTaskQueue` 的完整控制面，因为这会永久维护两套状态与取消协议。

### 2. 执行器按插件与 kind 显式注册

增加实例级 task executor registry，以 `(pluginId, kind)` 为唯一键。插件在激活期通过受管任务 API 注册 planner/executor，并获得 disposer；停用时宿主撤销注册并拒绝新任务。重复键、未知 kind 和已撤销 executor 明确失败。

Editor MCP 就近注册一个资源 operation executor。现有 Runtime 内建的 asset query/refresh 和 scene patch 也迁为组装入口显式注册，逐步移除核心 dispatcher 对具体 kind 的 switch。注册只建立描述和工厂映射，不在注册阶段执行 Creator API。

相比把任意 callback 直接塞进任务请求，注册表能固定生命周期、owner 和权限边界；相比自动发现，实现加载仍由明确组装入口控制，符合打包裁剪和测试隔离要求。

### 3. MCP capability 声明执行模型

在 capability 定义中增加可选 `executionModel`：

- `inline`：默认值；保持 Hub 全局 write slot 和现有 postflight，兼容第三方插件。
- `managed_task`：Hub 只负责 schema、风险、审批、破坏性确认、审计和 invocation 传递；任务执行器负责排队、资源锁、执行与唯一 postflight。

Editor MCP 写/破坏性 capability 声明 `managed_task`，只读 capability 保持直接调用。Hub recent call 与 `taskId` 关联，以任务终态更新审计，但不得再对同一任务执行第二次项目日志检查。

相比按插件 ID 硬编码特例，声明式执行模型可由 registry 校验并保持扩展边界；默认 `inline` 避免破坏已有插件。

### 4. 异步核心提供同步兼容适配

任务核心先完成 admission 并返回 receipt。默认 Editor MCP handler 继续等待任务终态，将原有业务结果与 `taskId/taskStatus` 合并后返回；显式异步请求直接返回 `queued` receipt。同步与异步必须共享同一个任务、授权摘要、资源计划和 postflight，不维护两条执行路径。

通用业务输入使用统一的可选执行控制对象承载 `mode`、`idempotencyKey` 和 `timeoutMs`，由共享 codec 在 capability 边界校验。调用方不得设置内部 owner、project key、资源锁或 `critical` 优先级；批量与优先级策略由受信执行器决定。

### 5. Editor 资源策略使用原子锁集合和工程 writer

资源 planner 在 admission 后、执行前生成归一计划：`projectKey`、完整排序资源键、`requiresProjectWriter`、资源闭包摘要和授权摘要。调度器一次性判断并预留全部键，禁止持有一部分锁后追加；同资源保留稳定 FIFO，不相交的离线资源操作可以并行。project writer 是每工程屏障，不得阻塞其它工程。

现有 `ResourceOperationPlanner`、closure resolver、AssetDB transaction 和 postflight monitor 保留领域职责；队列状态和记录迁入共享控制面。Runtime 的锁管理器扩展为原子集合接口，原单键调用通过单元素集合适配，避免一次性大改所有消费者。

### 6. 授权在 admission 与执行边界双重约束

Hub 在创建任务前完成本地审批消费，并生成不含 token 的授权摘要，绑定 connection、capability、operation、风险、资源摘要和有效期。执行器重新规划后比较资源摘要；风险升级、闭包变化或授权过期均在写入前失败，调用方必须重新审批。

任务 owner 由宿主从 invocation 注入，外部输入不能覆盖。owner 至少包含 `pluginId`、`connectionId`、`projectKey` 和 capability；插件互调使用宿主生成的 `plugin:<caller>` connection 身份。

### 7. 取消与超时只在安全边界生效

任务状态机扩展为 `queued → planning → waiting_commit → running → succeeded|failed|cancelled`。取消和 timeout 在 commit 前可以移除队列占位并释放资源；进入不可逆 commit 后控制器只记录请求，不强制 abort Creator 或文件操作，等待 transaction 到达安全边界后以保守状态结束。

invocation `AbortSignal` 只作为当前同步等待和可中止步骤的信号，不等同于任务所有权取消。异步任务在原 HTTP/MCP invocation 结束后继续存在，只有 owner 的显式 task cancel 或宿主停用策略可以取消。

### 8. 幂等键绑定规范化工作摘要

幂等作用域为 `(pluginId, connectionId, projectKey, capability, idempotencyKey)`；值绑定规范化输入摘要、风险和资源闭包摘要。同作用域同摘要返回原任务，同键不同摘要失败。幂等索引采用有界 TTL，TTL 不短于任务记录保留期；回收任务时同步回收或保留可解释 tombstone，不能把同键指向其它任务。

### 9. 任务控制不进入 83 项业务目录

Hub 提供 connection-scoped 的 task status、cancel 和 evidence 控制入口，并将它们作为宿主通用控制协议处理，而不是 `EditorMcpOperationId`。面板通过受信内部控制接口读取同一数据，外部 Bridge 必须经过 connection owner 校验。

状态与证据 DTO 采用 allow-list 投影：允许时间戳、阶段、operation、锁等待摘要、结构化失败和产物 digest；禁止 token、原始输入、完整日志、绝对路径和未声明文件内容。

### 10. Postflight 由领域执行器唯一负责

`managed_task` 的成功判定由 Editor 资源执行器完成：AssetDB settle、UUID/子资源查询、引用校验、增量日志，以及 capability 策略声明的 preview 后验。Hub 只接收终态与安全证据摘要。`inline` capability 继续使用 Hub 现有 postflight，避免未迁移插件失去保护。

### 11. Creator 3.8.x 兼容按目标运行时验证

`creator-38` 以 Creator 3.8.x 编辑器扩展运行时为兼容线，但写入开放仍受精确版本证据约束。Host bundle 不使用 Creator 3.8.3 内置 Node 不支持的 `node:` 内置模块标识，跨版本运行时差异集中在宿主适配边界。首轮以已安装的 Creator 3.8.3 作为最低基线、以 3.8.7 作为现有回归版本；只有目标版本完成宿主加载、只读冒烟、审批写入、资源清理和日志检查后，才把该版本加入 verified/write-enabled 目录。未完成证据的 3.8 补丁版本继续只读并返回结构化画像诊断，不用通配符绕过证据门禁。

## Risks / Trade-offs

- [共享控制面重构可能影响现有 Runtime 任务] → 先用现有 Runtime 测试冻结状态、优先级、公平、取消和 trace 行为，再将内部实现迁入控制面，保持公开 API 不变。
- [绕过 Hub 全局写槽可能暴露原先被遮蔽的竞态] → 仅对已声明 `managed_task` 且通过双连接并发测试和 Creator 3.8.7 实机验证的 capability 启用。
- [任务 owner 与审计记录失配] → owner 只能由 invocation 注入，Hub recent call 保存 `taskId` 关联，并通过跨连接负例测试验证不可枚举。
- [超时期间 Creator 写入无法安全中断] → commit 窗口不可强杀，返回保守 `may_have_changed`，证据记录已完成步骤并要求先查询状态。
- [幂等缓存回收导致重复写] → 幂等 TTL 与任务保留期统一配置，并在过期后要求调用方生成新键，不承诺跨宿主重启的 exactly-once。
- [任务控制入口扩大工具目录] → 控制协议与 Editor 业务 operation 分离，目录测试继续固定 83 项。

## Migration Plan

1. 为现有 Hub inline 写路径、Execution Runtime 和 Editor 资源队列补充特征测试，冻结兼容行为与失败协议。
2. 增加 task control contracts、实例级 control plane 和 executor registry；先迁移现有 Runtime 内部实现，保持外部 API 与测试结果不变。
3. 增加原子多资源锁和 project writer 策略，将 Editor MCP 资源队列迁为注册执行器；此时仍通过同步适配运行。
4. 增加 capability `executionModel`，默认 `inline`；逐项把 Editor MCP 写 capability 标记为 `managed_task`，移除该路径的 Hub write slot 和重复 postflight。
5. 接入 owner、status/cancel/evidence、timeout 与 idempotency，并开放显式异步模式。
6. 运行模块定向测试、根 `npm run verify`、`npm run pack`，再在 Creator 3.8.7 用两个 Bridge 连接完成冲突 FIFO、非冲突并行、取消清理、postflight 和产物身份验收。
7. 实机失败时可将 capability 执行模型回退为 `inline`；在全部验收通过前保留旧队列实现作为受控回滚点，通过后删除重复实现和兼容分支。
