# Spec Delta

## MODIFIED Requirements

### Requirement: Default synchronous behavior remains compatible
系统 SHALL 保持既有 Editor MCP 工具名、业务 operation 标识和普通写操作的默认同步结果兼容，同时允许目录增量增加已声明能力，并仅在实际完成后返回 `taskStatus=succeeded`。

#### Scenario: Existing caller uses default mode
- **GIVEN** 一个依赖当前同步调用契约的 Editor MCP 客户端
- **WHEN** 调用方未显式请求异步模式并成功执行写 capability
- **THEN** 调用方收到原有业务结果以及同一任务的 `taskId` 和 `taskStatus=succeeded`

#### Scenario: Task controls do not expand the business catalog
- **GIVEN** 目录包含研究基线的 88 项业务操作及本变更新增业务操作
- **WHEN** 系统公开任务状态、取消、证据控制或只读 Resources 入口
- **THEN** 这些控制和资源入口不计入业务 operation，基线工具名映射不变，业务数量从权威目录一致派生

#### Scenario: New business operations are consistently advertised
- **GIVEN** 本变更新增粒子和反射探针业务操作
- **WHEN** Host、Core 目录与 MCP 入口广告当前候选
- **THEN** 它们一致公开新增操作的输入/输出 schema、读写风险及可用性画像，既有 88 项工具仍可发现

#### Scenario: Native job exceeds the synchronous wait budget
- **GIVEN** 调用方未显式请求异步，且原生长任务已受理但未完成
- **WHEN** 同步等待预算耗尽
- **THEN** 返回同一 `taskId`、实际非终态 `taskStatus`、`pending=true` 和续查指引，不附带成功判据；既有任务继续跟踪且不得重复提交

### Requirement: Asynchronous execution requires explicit opt-in
系统 SHALL 仅在调用方显式请求异步模式时提前返回 `taskStatus=queued`，并对该任务使用与同步模式相同的审批、安全、资源闭包和成功判定；同步原生长任务等待耗尽时按明确的 pending 契约返回。

#### Scenario: Caller requests asynchronous mode
- **GIVEN** 一个已通过输入和授权校验的写 capability 请求
- **WHEN** 已授权调用显式请求异步执行
- **THEN** 系统返回可查询的任务标识而不等待任务终态

#### Scenario: Caller omits asynchronous mode
- **GIVEN** 一个使用默认执行选项的写 capability 请求
- **WHEN** 调用方未提供异步执行请求且任务在等待预算内完成
- **THEN** 系统返回经过既有后验验证的同步结果，不仅返回 `queued`

#### Scenario: Pending native task is distinguished from early async admission
- **GIVEN** 默认同步原生任务已等待到预算耗尽
- **WHEN** 系统返回 pending 响应
- **THEN** 响应明确说明等待耗尽及真实任务状态，客户端不能将其当作完成成功或新的异步提交
