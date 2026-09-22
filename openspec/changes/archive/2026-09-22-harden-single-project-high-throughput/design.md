# Design

## Context

见 [proposal.md](proposal.md) 的动机。当前 Hub 对 legacy inline 写提供 1–32 的并发槽位（默认 16），但等待者无容量上限；read-only 与 executor-managed 请求绕过该槽位。Runtime `TaskScheduler`、`ResourceLockManager` 和 executor-managed commit queue 也使用无界数组。`TaskControlPlane` 声明终态默认保留 5 分钟，但回收主要由幂等声明触发；Hub owner 映射与插件 task ID 集合没有逐任务回收协作。

已有能力可复用：Runtime 提供 `submitBatch`、dedupe/coalesce、`BatchCommitCoordinator` 与 snapshot validation；Asset import 支持批内并发并统一进入一次 AssetDB transaction；Lumen 推荐多项离线编辑后集中 commit。缺口是这些机制尚未形成 Editor MCP 的统一单工程吞吐契约，受管写调用仍逐项取得资源、提交和后验。

Creator AssetDB、Scene 和编辑器消息共享工程状态，不能通过增加同工程 writer 数量安全扩容。本设计把吞吐拆为可并行的 admission/read/plan/prepare 阶段和唯一 writer commit 阶段。

## Goals / Non-Goals

**Goals:**

- 在固定内存和队列容量内吸收短时突发，并在持续过载时快速、可重试地拒绝。
- 提升单工程大量独立资源操作的吞吐，目标 workload 在同等结果与后验下至少达到逐调用顺序基线的 2 倍；未达到时不宣称高吞吐完成。
- 保持同资源 FIFO、完整资源闭包、单工程唯一 writer、审批绑定、幂等和保守项目状态。
- 让状态/取消控制在队列高水位时仍可响应，并让所有任务关联状态实际按期限和容量回收。

**Non-Goals:**

- 不增加第二个 AssetDB/editor writer，不并行调用可能改变 Creator 全局状态的消息。
- 不承诺跨多个 Creator 进程或多主机的分布式事务与公平性。
- 不把自动微批用于 destructive、不同 owner、不同审批边界或未声明依赖的调用。
- 不声称批次具有 Creator/AssetDB 未提供的数据库 ACID 回滚能力。
- 不在本 change 增加新的业务 operation；批次、状态和诊断仍属于控制面。

## Decisions

### 1. 在业务执行前建立分层 admission control

新增进程级 `ThroughputAdmissionController`，以 `projectKey + connectionId + costClass` 管理配额。顺序为：解析 operation 与最小输入形状、确定风险/成本类别、尝试容量预约、再消费审批并创建任务。容量不足时不会消耗一次性审批租约，也不会写入任务账本。

成本类别初始分为：

- `control`：status/cancel/evidence，使用保留容量；
- `read_light`：版本、选择、单资源信息等短查询；
- `read_heavy`：全量 hierarchy、依赖扫描、catalog rebuild 等；
- `prepare`：Lumen 解析、序列化、引用与资源闭包规划；
- `writer`：AssetDB/editor commit，只允许每工程 1 个活跃者。

首版默认值：单连接在途 8、单连接等待 32、单工程普通等待 64、轻量读并发 8、重型读并发 2、prepare 并发 4、writer 1。配置允许在验证过的硬范围内收紧或调优，但不能关闭容量上限。选择分层信号量而不是单一全局 semaphore，是为了避免重型扫描耗尽轻量查询与控制面容量。

拒绝结果通过既有 failure v1 兼容追加 `code=throughput_overloaded`、`category=overloaded`、`projectState=not_started`、有界 `retryAfterMs` 和当前调用方可见的安全队列摘要。客户端退避加入抖动；写重试必须使用幂等键。

### 2. 读吞吐采用请求合并与 optimistic revision，不给所有读加全局锁

为明确 allow-list 的纯读 operation 建立短生命周期 `ReadCoalescer`。合并键包含工程、operation、规范化输入、权限/版本画像和当前 revision；只有结果不依赖连接私有状态的请求才允许跨连接合并。默认合并窗口 10 ms，完成后不长期持有响应；低成本稳定 catalog 可使用带 TTL 的小容量 LRU。

`ProjectRevisionClock` 在每次成功 writer commit、AssetDB refresh/settle 和外部变更失效信号后推进 revision。读取在开始和结束分别观察 revision：

- revision 未变化：返回该 revision 的一致结果；
- revision 变化且 operation 可安全重试：在预算内重读一次；
- 仍变化或不可重试：返回结果绑定的 revision 与 `stale=true`，不得冒充当前状态；
- 必须观察编辑器稳定态的读取在 writer commit 阶段有界等待，而不是读取半提交状态。

备选方案是所有读取得 project read lock，但会让高频读取与 writer 相互阻塞，吞吐和交互性都更差。revision validation 可以隔离大多数读取，同时只为强一致 operation 保留 barrier。

### 3. 写吞吐使用五阶段流水线和单 writer 微批

受管写流程调整为：

```text
admit -> plan -> prepare -> assemble -> commit/postflight
           |        |           |             |
         bounded  parallel    bounded       writer = 1
```

`plan` 计算资源闭包、审批摘要、依赖和 snapshot；`prepare` 只做不会改变工程的 Lumen 内存编辑、序列化和导入规划；`assemble` 将兼容任务组成显式批次或自动微批；`commit` 原子预约批次资源闭包联合集并取得唯一 writer；`postflight` 执行一次共享 refresh/settle/log checkpoint，再把验证结果投影到各项 outcome。

显式批次是首选接口：调用方声明有序操作和依赖边，系统一次校验整个批次。自动微批只用于同 owner、同工程、同风险/审批作用域、allow-list operation family、资源闭包完整且不改变单调用顺序语义的请求。默认自动窗口 10 ms。

首版批次边界：最多 32 项、规范化输入总计 4 MiB、prepare 并发 4。writer 不在不可逆 commit 中按墙钟强制中断；200 ms 是片段组装目标和批间公平切片阈值，超过时只记录观测并在安全边界后让出 writer。超大显式批次在 commit 前按依赖拓扑和稳定输入顺序切片，子批次之间重新校验 snapshot。

### 4. 批次资源、审批与幂等一次规划但逐项可追溯

批次先分别规划每项资源闭包，再计算联合锁集合与依赖 DAG。锁集合一次性原子预约，避免逐项取得锁导致死锁；同资源边保持提交 FIFO。批次授权绑定 owner、风险上界、完整联合资源摘要和逐项工作摘要，任何变化都要求重新审批。

批次拥有独立 `batchId`；每项仍有 `taskId`、幂等键、状态和 outcome。批次级幂等摘要覆盖有序 operation、依赖边、逐项摘要和资源联合集。相同摘要重放返回原批次；同键不同摘要失败。自动微批不会改变调用方提供的逐项幂等作用域。

现有 `McpBatchApprovalStore` 只复用审批概念，不等同于执行批次；实现中需要把审批受理和 Runtime batch receipt 明确分层，避免“共享 token”被误当作事务。

### 5. 失败语义以 journal 和可证明恢复为准

每个批次记录有界、安全的阶段 journal：计划摘要、锁、开始 commit 的项、完成项、共享 settle 与恢复结果，不保存原始内容或 token。

- writer 前失败或取消：释放准备结果与锁，整体 `unchanged`；
- commit 全部成功且共享后验通过：整体 `succeeded`；
- 中途失败且每项 inverse/清理已验证：`rolled_back`；
- 任何已提交项无法证明恢复：`may_have_changed`，返回已知逐项状态与查询建议；
- commit 窗口内超时/取消不强制打断，在安全边界结算。

Prefab/Scene 首次创建继续使用现有原子创建状态机。首版不自动把多个首次创建合为一个假原子事务；可以并行准备内容，但发布在 writer 中逐项执行并共享最终 settle。delete、覆盖写、scene 切换、builder/preview 全局操作默认不进入自动微批。

### 6. 控制面回收以终态事件、周期扫描和压力清理三路触发

`TaskControlPlane` 成为任务关联生命周期的唯一回收通知源。任务终态建立默认 5 分钟 retention；30 秒周期扫描删除过期 ledger/result/owner/evidence/idempotency/abort controller，同时通知 Hub `McpTaskControl` 和 `PluginTaskApi` 删除外层 task ID。新任务受理和容量高水位也可触发增量扫描，但不再依赖幂等请求。

首版硬上限按工程设置 4096 个保留任务；单任务证据最多 32 项/64 KiB，单批证据最多 128 项/256 KiB，超限写入稳定截断摘要和 dropped count。非终态任务不会为了腾容量被静默删除；容量满时拒绝新工作。所有计时器在 runtime/plugin deactivate 时撤销。

### 7. 公平性在 admission、prepare 和 writer 三层实施

admission 为每连接保留公平份额；prepare worker pool 按工程内 round-robin 与优先级预算取任务；writer 延续优先级队列，但限制同优先级连续提交次数，并在批次片段之间重新选择。控制请求使用独立小容量通道，不进入 writer 排队。

不采用“高优先级永远先执行”，因为持续高优流量会饿死后台批次；也不采用纯全局 FIFO，因为短交互请求会被大型后台批次挡住。稳定策略是优先级 + 最大连续次数 + 批次切片。

### 8. 指标使用有界聚合，不保留请求内容

按工程和成本类别维护固定窗口计数器/直方图：accepted、rejected、in-flight、queued、queue wait、execution、writer hold、settle、coalesced reads、GC removed、event-loop lag 与 RSS 高水位。指标不含路径、输入、token、连接 ID 或逐任务日志；普通 Bridge 只从自身 overload 响应看到必要摘要，完整健康快照仅供受信宿主诊断。

指标本身不得成为新瓶颈：使用固定桶和环形窗口，不按 taskId 建立长期时序。高水位测试断言任务完成并冷却后队列归零、保留记录受上限约束、RSS 不持续单调增长。

### 9. 实机验收按正确性、吞吐和长稳三层推进

单元/集成层覆盖容量、合并、revision、批次 DAG、锁联合集、失败 journal、回收和脱敏指标。模拟压力层至少运行 10,000 次混合读取、500 项可批写入、过载与重试风暴，并与顺序基线比较结果与时间。

Creator 3.8.3/3.8.7 分别运行：

- 30 分钟正常混合负载；
- 10 分钟持续过载与退避重试；
- 至少 100 个资源的显式批次和等价逐项顺序基线；
- 队列高水位期间的 status/cancel 响应；
- prepare、writer 前、commit 中和 postflight 故障注入；
- 冷却后的队列、任务记录、RSS 趋势、探针残留和 `project.log` 增量。

高吞吐通过条件包括：结果等价、合格 workload 至少 2 倍吞吐、队列/记录有界、overload 以拒绝而非超时体现、控制请求在 1 秒内得到响应、零覆盖/孤立 `.meta`/探针残留、成功批次唯一 postflight、日志零新增 error/warn。

## Risks / Trade-offs

- [自动合批改变调用时序或审批含义] → 仅 allow-list 同 owner/同审批/无隐式依赖请求；其余保持独立 FIFO，显式批次优先。
- [大批次长时间占用 writer] → 操作数/体积上限、拓扑切片、批间重新调度；不可逆提交不按超时强杀。
- [revision 持续变化导致重型读取反复重试] → 最多自动重读一次，之后返回 stale revision 或有界等待，不制造重试风暴。
- [联合资源锁扩大阻塞范围] → prepare 在锁外完成，commit 前重验 snapshot；超大联合集提前切片，不逐项嵌套取锁。
- [任务回收过早影响客户端查询] → 保持默认 5 分钟并在回执中公开 retainedUntil；硬容量满时拒绝新任务，不删除有效记录。
- [指标和日志检查在高频下反成瓶颈] → 固定窗口聚合；批次共享一次日志 checkpoint/postflight，不逐项重复扫描完整日志。
- [吞吐目标受 Creator 版本/机器差异影响] → 同机同候选对比顺序基线，绝对 QPS 仅作观测；2 倍门槛只应用于声明可批的合格 workload。

## Migration Plan

1. 先实现任务生命周期回收、指标与无副作用 admission controller，并保持默认容量足够覆盖现有测试；所有业务仍逐项执行。
2. 接入 read cost profile、合并与 revision clock，先对 allow-list 轻量读取启用，重型和强一致读取保持保守路径。
3. 打通显式 batch receipt、DAG/联合资源规划、并行 prepare、单 writer commit 与批次 outcome；默认关闭自动微批。
4. 将 Lumen 多文件更新、批量资产 import/copy/move 和同 Scene patch 逐类迁入显式批次，并验证逐项路径结果一致。
5. 对已证明安全的 operation family 启用 10 ms 自动微批，保留运行开关以便回退到独立 FIFO。
6. 完成模拟压力与 Creator 双版本长稳矩阵；依据证据在硬范围内校准默认配额，不降低安全门禁来追求数字。
7. 更新文档和知识；若线上出现异常，可关闭自动微批和读缓存，同时保留 admission、回收与单 writer，从而回退到有界的原执行语义。
