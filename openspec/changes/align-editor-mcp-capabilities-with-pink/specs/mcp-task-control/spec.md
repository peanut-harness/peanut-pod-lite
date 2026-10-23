# Spec Delta

## ADDED Requirements

### Requirement: Native jobs remain associated until a truthful outcome
系统 SHALL 为原生长任务保留受 owner 保护的受管任务关联，直到得到已验证终态或明确的完成未确认结论。

#### Scenario: Request ends before native work
- **GIVEN** 原生构建或烘焙已经受理但尚未完成
- **WHEN** 原始 HTTP 请求结束或同步等待预算耗尽
- **THEN** 同一 owner 可在保留期内继续查询状态与证据，任务不会仅因请求结束进入成功或取消终态

#### Scenario: Cancellation request precedes native acknowledgment
- **GIVEN** 原生任务仍在运行且取消请求已发出
- **WHEN** 尚未收到可验证取消结果
- **THEN** 状态保持未完成，并注明取消待确认，不能把取消请求受理当作实际取消

#### Scenario: Owner or observation is unavailable
- **GIVEN** 查询者非 owner，或宿主重启导致原生任务状态无法恢复
- **WHEN** 请求任务状态
- **THEN** 非 owner 得到不可用；合法 owner 只得到与可恢复证据一致的未确认结果，不自动重启工作或泄露原始输入
