# MCP 写操作任务队列设计

## 目标

将每次需要改变项目状态的 MCP 调用建模为一个可追踪任务。任务负责资源依赖闭包、审批租约、排队、锁、AssetDB 登记、执行、提交、验证和证据归档。

这项改造解决两个问题：

- `lumen.scaffold → lumen.compAdd → lumen.bind* → lumen.commit` 被多个独立请求拆开后，AssetDB 尚未登记时下一个请求已经开始。
- 多个 Agent、多个 bridge 连接或多个自动化场景同时操作一个 Creator 工程时，资源锁和审批范围无法覆盖完整事务。

任务队列不改变现有 MCP 工具名。同步调用仍等待任务结束；需要长任务或批量矩阵时，调用方可请求异步任务并使用任务查询接口获取结果。

## 边界

任务队列只负责本地 Creator 工程状态和证据，不负责 Pod 订阅、Pro 在线计划或远程存储。

- Lite 写操作仍只需要本地审批租约。
- Pro 操作仍需要签名计划、宿主能力探针和本地审批。
- 读操作可直接执行；如果读操作绑定某个任务快照，则必须读取任务声明的 catalog/AssetDB 版本。
- 队列不能绕过 schema、风险、资源路径或版本画像门禁。

## 任务模型

```ts
interface IResourceOperationTask {
  readonly taskId: string;
  readonly parentTaskId: string | null;
  readonly projectRoot: string;
  readonly connectionId: string;
  readonly operation: string;
  readonly input: Record<string, unknown>;
  readonly resourceClosure: IResourceClosure;
  readonly approval: ITaskApprovalBinding;
  readonly idempotencyKey: string;
  readonly priority: 'interactive' | 'normal' | 'batch';
  readonly mode: 'sync' | 'async';
}

interface IResourceClosure {
  readonly roots: readonly string[];
  readonly exclusiveKeys: readonly string[];
  readonly sharedKeys: readonly string[];
  readonly dependencies: readonly IResourceDependency[];
  readonly sidecars: readonly string[];
  readonly subAssets: readonly string[];
}

interface ITaskApprovalBinding {
  readonly leaseId: string;
  readonly operation: string;
  readonly risk: 'write' | 'destructive';
  readonly resources: readonly string[];
}
```

任务状态：

```text
queued
→ planning
→ awaiting_approval
→ reserving
→ assetdb_registering
→ executing
→ committing
→ verifying
→ succeeded
```

异常路径为 `failed`、`cancelled` 或 `expired`。状态转移写入内存审计记录，不能只靠普通异常字符串判断任务结果。

## MCP 调用语义

现有同步调用保持兼容：

```json
{
  "taskId": "task-…",
  "status": "succeeded",
  "result": {},
  "evidence": {}
}
```

批量或长时间操作可以请求异步模式：

```json
{
  "taskId": "task-…",
  "status": "queued"
}
```

后续增加以下控制面能力：

- `task.status`：返回状态、步骤、锁等待、资源闭包摘要和失败码；不返回秘密或原始外部 token。
- `task.cancel`：只允许同一 connection 或受信宿主取消仍未进入不可逆阶段的任务。
- `task.retry`：只对幂等或明确可恢复失败重试；重试前重新计算资源闭包和审批有效期。
- `task.evidence`：读取本任务的结构化证据索引。

重复的 `idempotencyKey` 必须返回原任务结果或原任务状态，不得再次写盘。

## 资源闭包

提交任务前先通过 `AssetImportPlanner`、AssetDB 查询和序列化 UUID 扫描计算闭包：

```text
主资源
├── .meta
├── 子资源：SpriteFrame / Texture / AnimationClip …
├── Prefab / Scene 引用
├── 脚本和脚本字段引用
├── 材质、贴图、字体、Atlas 等依赖
└── 父目录和 AssetDB 目录节点
```

规范化 key 统一使用现有 `normalizeResourceLockKey` 规则，并额外生成目录锁：

```text
project:<project-id>
dir:assets/ui
db://assets/ui/panel.prefab
meta:assets/ui/panel.prefab.meta
uuid:<main-uuid>
uuid:<sub-asset-uuid>
```

绝对路径、`..` 逃逸、未解析且不在允许范围内的 UUID、缺失 sidecar 或依赖闭包不完整时，任务停在 `failed`，不能进入执行。

## 队列和锁

### 工程级调度

每个 Creator 工程有一个 AssetDB writer 通道。任务规划、依赖扫描、只读查询可以并行；所有影响磁盘、AssetDB、catalog 或 Creator 编辑器状态的任务进入该工程队列。

### 资源级互斥

任务开始前一次性计算并排序所有 exclusive keys，按字典序预留。禁止持有一把锁后动态申请另一把锁。这样可避免：

```text
任务 A：Prefab → 目录
任务 B：目录 → Prefab
```

产生死锁。

### 并行规则

| 场景 | 行为 |
| --- | --- |
| 不同工程 | 可并行执行 |
| 同工程、不同资源闭包 | 可并行规划；AssetDB 写阶段仍经过工程 writer |
| 同一 Prefab/Scene | 按提交顺序 FIFO |
| 同一目录创建新资源 | 目录锁串行 |
| 共享 SpriteFrame/Texture/脚本 | 写入互斥；只读可并行 |
| 仅 inspect/query | 可并行；需声明读取快照 |
| commit/catalog/preview | 工程级串行 |

优先级只能影响尚未开始的任务，不能插队已获得锁的交互任务。批量矩阵使用 `batch` 优先级并设置公平配额，避免长期饿死。

## 执行阶段

### 1. Planning

- 校验 operation schema、版本画像和风险。
- 展开资源依赖闭包。
- 检查 idempotencyKey。
- 生成锁集合和证据目录。

### 2. Approval

审批租约必须同时绑定：connection、operation、风险和完整资源闭包。非空 approval ID 不足以通过校验。

审批过期、资源闭包变化或风险升级时，任务回到 `awaiting_approval`，不能复用旧租约。

### 3. AssetDB registration

- 先确保父目录已由 AssetDB 登记。
- 对 `asset.copy` / `asset.createFolder` 这类纯磁盘变更，若目标路径尚未被 `query-asset-info` 识别，transaction 必须在目标目录用 `asset-db.create-asset` 创建短生命周期 JSON 探针，借助 Creator 原生 AssetDB 注册父目录和同目录资产；refresh/settle 后删除探针，删除失败必须清理文件与 `.meta` 并使缓存失效。
- 新建主资源必须等待 `query-asset-info` 返回有效 UUID。
- sidecar、子资源和依赖资源必须达到 ready 状态。
- 任一资源仍是 `pending` 时，任务失败关闭，不继续 compAdd、bind、commit 或 catalog。
- 成功事务结束后不得残留 `__peanut_assetdb_register_*.json` 或对应 `.meta`。

这一步专门防止 Creator 3.8 Assets 面板的 `original asset is not exist` 竞态。

### 4. Execute

批次内步骤共享同一任务锁、审批和资源闭包。例如：

```text
lumen.scaffold
→ lumen.compAdd
→ lumen.compSet
→ lumen.bindSprite / lumen.bindRef / lumen.bindClick
```

任何子步骤失败都停止后续步骤，并记录已完成步骤和可恢复动作。

### 5. Commit and verify

```text
lumen.commit
→ AssetDB refresh/settle
→ catalog refresh
→ validateRefs
→ preview.refresh
→ preview.queryErrors(sinceOffset)
```

`settle.pending > 0`、UUID 缺失、`.meta` 不存在、引用校验失败或日志增量出现 error/warning 时，任务不能成功。

## 代码与资源绑定

代码绑定不是单独的字符串测试，必须产生真实项目资产：

1. 通过 `asset.writeText` 写入项目内 `.ts`/`.js`，并等待脚本 `.meta` 和 AssetDB 登记。
2. 通过 `lumen.compAdd` 绑定脚本组件。
3. 通过 `lumen.compSet` 写入脚本字段，包括 UUID、Prefab、SpriteFrame 和节点引用。
4. commit 后重新打开 Prefab/Scene，检查压缩脚本 UUID、`__id__`、子资源 UUID 和字段值。
5. 运行 `validateRefs`，确认没有 dangling、wrongReferenceType、brokenOwnership 或 badAnimPath。

所有代码和资源输入都进入同一任务资源闭包，不能先写代码再以另一个无关任务绑定。

## 证据

每个任务保留：

- 请求摘要和 schema 版本；
- 资源闭包、锁集合和审批摘要；
- 每一步 MCP 响应和状态转移；
- 主资源、`.meta`、子资源和依赖 UUID；
- Prefab/Scene 重开后的 inspect；
- `validateRefs` 结果；
- AssetDB settle 结果；
- `project.log` 起止 offset 和增量错误；
- preview 状态；
- 回滚/清理结果。

证据按 `taskId` 隔离。批量矩阵必须同时提供组件分母、通过、拒绝、失败和未覆盖列表；不能用一个总数替代逐项产物。

## AI 调用契约

MCP 工具目录必须同时提供自然语言说明、精确 input/output schema 和 `aiHandling` 机器规则。AI 不得仅依据 HTTP 状态、磁盘文件存在或异常字符串判断结果：

1. 只读调用仅在 `response.ok=true` 时成功。
2. 写调用仅在 `response.ok=true`、`taskStatus=succeeded`、`postflight.verified=true` 同时成立时成功。
3. 失败响应保留兼容字段 `error`，并返回 `failure.schemaVersion/code/category/retryable/state/recommendedAction`。
4. 已入队写任务失败时，`failure` 还必须包含 `taskId/taskStatus/operation`，便于审计和后续状态查询。
5. `failure.state` 为 `unknown` 或 `may_have_changed` 时，必须先用只读工具查询目标资源，禁止直接重放写操作。
6. `approval_required`、`confirmation_required`、`invalid_input` 分别只允许在取得匹配租约、补充显式确认、修复输入后重试；`postflight_failed` 必须先检查 `project.log`。

目录说明和结构化规则必须由契约测试覆盖，普通 JSON 与 NDJSON 流式失败响应必须返回相同的 `failure`。契约从 Core policy 目录经 Creator host 到 Hub summary 不得被裁剪；registry 拒绝畸形 `aiHandling`。已携完整结构化失败的任务终态直接返回调用方，不得再以未处理异常重复写入 `project.log`。

## 分阶段改造

### Phase 1：任务外壳

- [x] 新增 `ResourceOperationTask`、状态机和 `ResourceOperationTaskQueue`。
- [x] 将现有写 MCP 调用包装成同步任务。
- [x] 保留现有工具名和结果字段，并为写结果附加 `taskId/taskStatus`。

Phase 1 已从 Router 实例级 FIFO 升级为进程内共享的项目调度器：同步结果继续附加 `taskId/taskStatus`，失败异常也携带最终任务记录，完成历史按上限回收。

### Phase 2：资源闭包和锁预留

- [x] 接入 operation 资源推导，并补齐 copy/rename 目标、主资源 `.meta` 与父目录锁。
- [x] `ResourceOperationTaskQueue` 与 `LumenResourceWriteLock` 都一次性原子预约完整锁集合；同资源 FIFO、不同资源并行，空集合不再绕锁。
- [x] 同工程跨 Router 共享 writer 屏障，不同工程 writer 可并行。
- [x] 接入 `.meta` UUID/子资源、序列化引用和传递依赖扫描，并把闭包纳入一次性锁预留。
- [ ] 增加任务级超时、取消和幂等控制。

### Phase 3：完整事务

- [ ] 将 scaffold/compAdd/compSet/bind/commit 合并为批次执行。
- [x] 通过统一 AssetDB transaction 执行父目录注册探针、refresh/settle、查询 UUID/子资源和 `.meta`，未登记直接失败关闭，并清理探针。
- [x] 将 `project.log` 增量错误和警告纳入写任务成功条件。
- [x] 失败任务返回稳定错误码、失败分类、状态歧义、可重试性、推荐动作和任务标识；普通与流式 Hub 响应保持一致。
- [x] 工具目录公开写任务成功判据与禁止盲目重试规则。
- [ ] 将 preview 状态纳入任务成功条件。

### Phase 4：异步和并行

- [ ] 增加 `task.status/cancel/retry/evidence`。
- [x] 增加工程级 writer、公平的冲突 FIFO 和跨工程并行。
- [ ] 增加优先级、取消、超时和批量公平配额。
- 用两个 bridge connection 运行冲突和不冲突任务回归。

## 验收标准

- 同一 Prefab 的两个并发写任务严格 FIFO，最终序列化内容可预测。
- 共享 SpriteFrame/Texture 的任务不会出现 UUID、`.meta` 或 AssetDB 竞态。
- 不同工程的任务可并行，不互相阻塞。
- 任一 pending AssetDB 资源都不会进入下一阶段。
- 任务取消不会留下未登记资源、孤立 `.meta` 或半提交 Prefab。
- 每个成功任务都有真实 Prefab/Scene/Script 产物、AssetDB UUID、引用校验和干净日志增量。
- 旧同步 MCP 调用兼容；异步模式不改变审批和安全边界。
