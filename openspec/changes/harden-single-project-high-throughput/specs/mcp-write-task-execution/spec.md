# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
