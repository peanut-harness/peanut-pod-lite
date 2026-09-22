# mcp-write-task-execution Specification

## Purpose

定义 Lite Editor MCP 写操作在统一受管任务边界内的执行、资源互斥、同步兼容、异步受理与成功判定，确保并发不会绕过审批、AssetDB 一致性或后验验证。

## Requirements

### Requirement: Capability execution model is explicit and backward compatible
系统 SHALL 允许 capability 声明由宿主管理任务执行，同时使未声明执行模型的 capability 继续按现有内联模式执行，并使迁移后的 capability 仍经过既有输入 schema、风险判定、本地审批租约和破坏性确认。

#### Scenario: Existing inline plugin remains compatible
- **GIVEN** 一个按现有契约注册且未声明执行模型的插件 capability
- **WHEN** 一个现有插件注册 capability 且未声明受管任务执行
- **THEN** Hub 按原有内联写槽、调用和 postflight 语义执行该 capability

#### Scenario: Managed write passes authorization before admission
- **GIVEN** 一个声明为受管任务执行的写 capability
- **WHEN** 调用方请求一个受管写 capability
- **THEN** 系统在创建任务前完成输入校验、风险判定和所需本地审批，未通过时不得产生可执行任务

### Requirement: Default synchronous behavior remains compatible
系统 SHALL 保持现有 Editor MCP 写 capability 的默认同步语义、工具名、业务 operation 标识和 83 项业务 operation 总数，并在成功数据上附加稳定的 `taskId` 与 `taskStatus=succeeded`。

#### Scenario: Existing caller uses default mode
- **GIVEN** 一个依赖当前同步调用契约的 Editor MCP 客户端
- **WHEN** 调用方未显式请求异步模式并成功执行写 capability
- **THEN** 调用方收到原有业务结果以及同一任务的 `taskId` 和 `taskStatus=succeeded`

#### Scenario: Task controls do not expand the business catalog
- **GIVEN** Editor MCP 业务目录固定包含 83 项 operation
- **WHEN** 系统公开任务状态、取消或证据控制入口
- **THEN** 这些入口不计入 83 项 Editor MCP 业务 operation，也不改变现有 operation 到工具名的映射

### Requirement: Asynchronous execution requires explicit opt-in
系统 SHALL 仅在调用方显式请求异步模式时返回 `taskId` 与 `taskStatus=queued`，并对该任务使用与同步模式相同的审批、安全、资源闭包和成功判定。

#### Scenario: Caller requests asynchronous mode
- **GIVEN** 一个已通过输入和授权校验的写 capability 请求
- **WHEN** 已授权调用显式请求异步执行
- **THEN** 系统返回可查询的任务标识而不等待任务终态

#### Scenario: Caller omits asynchronous mode
- **GIVEN** 一个使用默认执行选项的写 capability 请求
- **WHEN** 调用方未提供异步执行请求
- **THEN** 系统不得仅返回 `queued`，而应维持默认同步兼容语义

### Requirement: Resource scheduling preserves project consistency
系统 SHALL 在任务开始前计算并原子预留完整资源闭包，使冲突任务按稳定顺序执行、允许不相交工作的规划与离线变换在有界预算内并行、所有 AssetDB/editor 状态写入经过该工程唯一 writer 车道，并保持不同工程互不阻塞。

#### Scenario: Conflicting tasks preserve FIFO
- **GIVEN** 两个任务的资源闭包至少共享一个规范化资源键
- **WHEN** 两个连接依次提交修改同一 Prefab 或共享依赖资源的任务
- **THEN** 后提交任务在前一任务释放完整资源闭包后才开始执行，最终结果与提交顺序一致

#### Scenario: Independent resources can progress concurrently
- **GIVEN** 两个任务的资源闭包不相交且均不需要 project writer
- **WHEN** 两个连接提交同一工程内资源闭包不相交且不占用 project writer 的任务
- **THEN** 系统在声明并发预算内允许两个任务并行执行规划或离线资源编辑

#### Scenario: Project writer forms a barrier
- **GIVEN** 同一工程存在一个已取得 project writer 的任务和其它等待任务
- **WHEN** 一个任务进入工程 writer 阶段
- **THEN** 该工程的其它 writer 任务和与其资源闭包冲突的任务必须等待，但其它工程任务仍可推进

#### Scenario: Parallel preparation never creates a second project writer
- **GIVEN** 同一工程有多个已完成并行准备且资源不相交的写任务
- **WHEN** 多个任务同时准备进入 AssetDB 或 Creator 编辑器提交
- **THEN** 系统仍只授予一个 project writer，并按批次与公平性规则提交

### Requirement: Authorization remains bound to the admitted work
系统 SHALL 将任务授权绑定到调用连接、operation、风险等级和完整资源闭包摘要，并在任一绑定项失效或变化时于项目写入前失败并要求重新审批。

#### Scenario: Resource closure changes while queued
- **GIVEN** 一个已获批并在队列中等待的受管写任务
- **WHEN** 任务等待期间重新规划得到的资源闭包与获批摘要不一致
- **THEN** 任务以 `not_started` 状态失败并要求重新审批，不得复用旧授权进入执行

#### Scenario: Approval expires before execution
- **GIVEN** 一个授权带有效期的受管写任务
- **WHEN** 任务获得执行机会时其授权已失效
- **THEN** 任务不得写入项目，并返回 `approval_required` 类别的结构化失败

### Requirement: Managed task success has one authoritative postflight
系统 SHALL 只在受管任务执行边界内运行一次完整 postflight，覆盖声明的 AssetDB settle、资源查询、引用校验、增量项目日志和可选 preview 后验，并阻止 Hub 对同一任务重复检查；对于首次创建 Prefab/Scene 的任务，postflight 还必须验证原子创建事务产生的 AssetDB 身份与清理状态。

#### Scenario: Postflight succeeds
- **GIVEN** 一个已完成项目写入并进入后验阶段的受管任务
- **WHEN** 写入、AssetDB settle、引用校验及该 operation 声明的其它后验全部通过
- **THEN** 任务才能进入 `succeeded` 并发布安全证据摘要

#### Scenario: Postflight detects new project error
- **GIVEN** 任务在写入前记录了项目日志检查点
- **WHEN** 本任务检查点之后的项目日志出现新错误或新警告
- **THEN** 任务以 `postflight_failed` 失败，结果包含任务标识和项目状态歧义，不得被报告为成功

#### Scenario: Newly created resource has confirmed identity
- **GIVEN** 一个首次创建 Prefab 或 Scene 的受管任务已完成 AssetDB 发布
- **WHEN** 任务准备进入成功终态
- **THEN** 唯一 postflight 必须确认主资源 UUID、`.meta`、适用的子资源、引用校验和创建事务清理状态全部通过

#### Scenario: Newly created resource remains pending
- **GIVEN** 一个首次创建 Prefab 或 Scene 的受管任务无法确认 AssetDB 身份
- **WHEN** 创建或 postflight 截止时间到达
- **THEN** 任务不得成功，也不得继续依赖该资源的后续写入，并返回带任务标识与保守项目状态的结构化失败

### Requirement: Managed failures remain machine actionable
系统 SHALL 为受管任务失败返回足以区分未写入、可能已写入、取消和超时的稳定结构化详情，包括错误码、分类、项目状态、可重试性、推荐动作、operation、`taskId` 和终态。

#### Scenario: Failure occurs before commit
- **GIVEN** 一个尚未进入不可逆 commit 的受管任务
- **WHEN** 任务在取得 writer 或进入不可逆提交前失败
- **THEN** 失败状态标记为 `not_started` 或 `unchanged`，并给出与失败原因匹配的推荐动作

#### Scenario: Failure occurs after a write may have happened
- **GIVEN** 一个已经进入提交或 postflight 阶段的受管任务
- **WHEN** 任务在提交或 postflight 阶段失败且无法证明项目未改变
- **THEN** 失败状态标记为 `may_have_changed` 或 `unknown`，推荐动作要求先查询项目状态

### Requirement: Creator 3.8.x host compatibility is evidence gated
系统 SHALL 使 `creator-38` 宿主在已验证的 Creator 3.8.x 目标运行时加载并执行 Lite MCP，同时按精确 Creator 补丁版本记录宿主加载、只读冒烟、审批写入、资源清理和项目日志证据；未完成证据的补丁版本不得开放写入。

#### Scenario: Creator 3.8.3 host loads the candidate
- **GIVEN** 目标工程声明 `creator.version=3.8.3` 且宿主实际运行于 Creator 3.8.3
- **WHEN** 安装当前候选 Host 与 Core 包并重启 Creator
- **THEN** 宿主完成加载，`query-status` 返回版本画像和受控写入状态，且报告绑定当前 Host/Core 产物身份

#### Scenario: Unsupported 3.8 patch remains fail closed
- **GIVEN** 一个属于 Creator 3.8.x 但尚未完成该补丁版本实机证据的宿主/工程组合
- **WHEN** 调用方请求写或破坏性 Editor MCP capability
- **THEN** 系统拒绝项目写入并返回带具体 profile、host/project 版本和证据缺口的结构化失败

### Requirement: Compatible writes use bounded batch commits
系统 SHALL 允许同一工程、同一可信 owner 与兼容审批范围内的写任务在资源闭包、顺序依赖和风险分类允许时组成有界批次，使批内规划和离线变换可并行、writer 提交保持单通道，并共享能够安全合并的 refresh、settle 与 postflight 工作。

#### Scenario: Explicit batch is accepted
- **GIVEN** 调用方提交一个通过整体输入、授权、容量和资源闭包校验的显式批次
- **WHEN** 批内操作可按依赖图和资源闭包形成安全提交顺序
- **THEN** 系统返回批次标识和逐项任务标识，按有界并发准备并在单 writer 窗口提交

#### Scenario: Independent calls are automatically micro-batched
- **GIVEN** 短窗口内存在同一 owner、兼容风险与审批、资源闭包已知且无需跨调用语义猜测的写任务
- **WHEN** 自动合批不会改变单调用可观察顺序或失败语义
- **THEN** 系统可将其组成有界微批，并保持每个调用独立可查询的结果

#### Scenario: Writes are not safe to batch
- **GIVEN** 请求包含不同 owner、不同审批边界、未声明顺序依赖、全局 Creator 状态操作或无法证明完整的资源闭包
- **WHEN** 系统评估合批
- **THEN** 系统保持原有独立 FIFO 执行或拒绝显式批次，不得为追求吞吐弱化安全边界

#### Scenario: Batch exceeds a declared bound
- **GIVEN** 显式或自动批次超过操作数、输入体积、准备并发或 writer 时间预算
- **WHEN** 系统准备执行批次
- **THEN** 系统在 commit 前拒绝或按稳定顺序切片，并使结果明确关联各子批次

### Requirement: Batch outcomes preserve conservative project state
系统 SHALL 为批次返回整体状态与逐项 outcome，并区分 commit 前未变更、已证明回滚和可能部分改变；系统 MUST 不把 Creator/AssetDB 不支持的多资源操作宣称为数据库式全量原子事务。

#### Scenario: Batch fails before commit
- **GIVEN** 批次仍处于受理、规划、准备或资源等待阶段
- **WHEN** 任一整体前置条件失败且 writer 尚未提交任何项目变化
- **THEN** 批次结束为失败，所有未执行项标记未开始，项目状态为 `unchanged`

#### Scenario: Batch commit succeeds
- **GIVEN** 批次中所有操作完成 writer 提交和批次后验
- **WHEN** 系统发布批次终态
- **THEN** 批次为 `succeeded`，每项 outcome 对应其任务与变更摘要，且批次只包含一次权威 settle/postflight 结论

#### Scenario: Commit fails and rollback is proven
- **GIVEN** 批次提交中途失败但系统能够证明本批次产生的变化已全部恢复
- **WHEN** 恢复和后验完成
- **THEN** 批次项目状态为 `rolled_back`，逐项结果说明已执行与恢复步骤，并允许按新幂等键重新规划

#### Scenario: Commit outcome is uncertain
- **GIVEN** 批次提交中途失败且系统无法证明所有已发生变化均已恢复
- **WHEN** 系统发布失败结果
- **THEN** 批次项目状态为 `may_have_changed` 或更保守状态，列出安全查询建议并禁止自动重放整个批次
