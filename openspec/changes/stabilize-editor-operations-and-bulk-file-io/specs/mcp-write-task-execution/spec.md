# Spec Delta

## MODIFIED Requirements

### Requirement: Default synchronous behavior remains compatible
系统 SHALL 保持原有 83 项 Editor MCP 业务 operation 的工具名、业务标识和默认同步写入语义，并新增只读 `asset.readText` 使业务目录变为 84 项；成功写入数据继续附加稳定的 `taskId` 与 `taskStatus=succeeded`。任务控制及本地审批签发入口不计入业务 operation。

#### Scenario: Existing caller uses default mode
- **GIVEN** 一个依赖当前同步调用契约的 Editor MCP 客户端
- **WHEN** 调用方未显式请求异步模式并成功执行写 capability
- **THEN** 调用方收到原有业务结果以及同一任务的 `taskId` 和 `taskStatus=succeeded`

#### Scenario: Task controls do not expand the business catalog
- **GIVEN** Editor MCP 业务目录包含保留的 83 项 operation 和新增 `asset.readText`
- **WHEN** 系统公开任务状态、取消或证据控制入口
- **THEN** 这些入口不计入 84 项 Editor MCP 业务 operation，也不改变原有 operation 到工具名的映射

#### Scenario: New text read capability is advertised consistently
- **WHEN** Host、Core 目录与 MCP Hub 广告当前候选
- **THEN** 它们一致公开 `peanut.editor-mcp.asset-read-text` 的只读 schema、能力画像和有界结果契约，原 83 项工具仍可按原工具名发现
