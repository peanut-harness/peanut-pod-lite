# Spec Delta

## ADDED Requirements

### Requirement: Task control state is bounded and reclaimed
系统 SHALL 对任务账本、调度队列、资源等待者、owner 映射、证据、幂等索引、结果与插件 task ID 设置一致的保留策略和硬容量边界，并通过周期回收与任务终态事件移除过期关联状态，而不依赖后续幂等请求触发。

#### Scenario: Terminal task expires
- **GIVEN** 一个终态任务及其 owner、证据、结果和幂等关联已经超过声明保留期
- **WHEN** 周期回收或容量维护运行
- **THEN** 系统原子移除该任务的全部关联索引，后续查询返回任务不可用且不影响其它任务

#### Scenario: Control state reaches its hard limit
- **GIVEN** 尚未过期的任务控制记录已达到声明硬上限
- **WHEN** 新请求需要创建额外记录
- **THEN** 系统在执行项目工作前拒绝新请求并返回 overload，不覆盖仍有效任务或静默丢弃证据

#### Scenario: Plugin deactivates under load
- **GIVEN** 插件持有运行中、等待中和终态任务
- **WHEN** 插件停用
- **THEN** 系统取消安全阶段任务、保留必要终态证据到声明期限，并释放插件持有的 executor、task ID 和 owner 索引

### Requirement: Batch control remains owner-safe and individually observable
系统 SHALL 使批次及其子任务绑定同一不可变 owner 与工程，并提供批次状态、逐项状态、取消边界和结构化证据；批次查询不得扩大调用方对其它连接任务的可见性。

#### Scenario: Owner queries a running batch
- **GIVEN** 当前连接拥有一个正在准备或提交的批次
- **WHEN** 所有者查询批次状态
- **THEN** 系统返回批次阶段、总项数、完成/失败/等待计数和安全队列摘要，并允许按 taskId 查询自身逐项状态

#### Scenario: Non-owner queries a batch
- **GIVEN** 一个由其它连接拥有的批次标识
- **WHEN** 当前连接查询该批次或猜测其子任务标识
- **THEN** 系统返回不可用结果，不泄露批次存在性、规模、资源或结果

#### Scenario: Owner cancels before batch commit
- **GIVEN** 批次尚未进入不可逆 writer commit，部分子任务仍在准备或等待
- **WHEN** 所有者取消批次
- **THEN** 系统取消所有尚安全可取消的子任务、释放资源并以 `unchanged` 结束批次

#### Scenario: Owner cancels during batch commit
- **GIVEN** 批次已经进入不可逆 writer commit
- **WHEN** 所有者请求取消批次
- **THEN** 系统拒绝强制中断，继续到可判定安全边界并返回逐项终态与保守项目状态

### Requirement: Batch evidence is bounded and authoritative
系统 SHALL 为每个批次保存一个权威批次级资源闭包、提交、settle 与 postflight 证据摘要，并为子任务保存有界逐项 outcome 引用；证据容量不得随重复查询或重复 postflight 无界增长。

#### Scenario: Successful batch evidence is queried
- **GIVEN** 一个成功批次仍在保留期内
- **WHEN** 所有者查询批次证据
- **THEN** 系统返回唯一批次 postflight、共享 settle、批次资源摘要和逐项 outcome 引用，不重复保存相同证据

#### Scenario: Evidence exceeds per-task or per-batch bound
- **GIVEN** 执行器尝试记录超过声明数量或大小上限的安全证据
- **WHEN** 控制面接收额外证据
- **THEN** 系统保留稳定截断摘要和计数，拒绝无界增长且不得把证据截断误报为业务成功
