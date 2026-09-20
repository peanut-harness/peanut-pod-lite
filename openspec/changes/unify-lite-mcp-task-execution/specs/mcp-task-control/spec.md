# Spec Delta

## Purpose

定义受管任务的调用方归属、状态查询、取消、安全证据、超时与幂等行为，使异步执行可观测且不会扩大连接权限、泄露输入或造成重复项目写入。

## ADDED Requirements

### Requirement: Every managed task has an immutable owner
系统 SHALL 在任务受理时记录并固定提供插件、Bridge 连接、工程和 capability owner，使外部调用方只能访问同一连接拥有的任务，并允许受信宿主控制面按既有权限读取必要摘要。

#### Scenario: Owner queries its task
- **GIVEN** 一个已由当前 Bridge 连接创建的受管任务
- **WHEN** 创建任务的同一 Bridge 连接查询任务
- **THEN** 系统返回该任务的安全状态摘要

#### Scenario: Different connection queries a task
- **GIVEN** 一个由其它 Bridge 连接拥有的任务标识
- **WHEN** 另一 Bridge 连接使用已知 `taskId` 查询该任务
- **THEN** 系统返回不可用或无权限结果，不泄露任务是否存在、输入、资源路径或证据内容

### Requirement: Task status is queryable without exposing secrets
系统 SHALL 提供覆盖 `queued`、`planning`、`waiting_commit`、`running`、`succeeded`、`failed` 和 `cancelled` 的安全状态摘要，并排除审批 token、访问 token、原始 capability 输入和未筛选日志。

#### Scenario: Query a running task
- **GIVEN** 一个仍处于非终态且归当前连接所有的任务
- **WHEN** 所有者查询尚未完成的任务
- **THEN** 系统返回当前阶段、创建与更新时间以及安全等待摘要，不返回原始输入

#### Scenario: Query an expired task record
- **GIVEN** 一个曾归当前连接所有但已经超过记录保留期的任务标识
- **WHEN** 所有者查询已超出声明保留期且被回收的任务
- **THEN** 系统返回任务不可用，不得返回其它任务的数据

### Requirement: Cancellation respects ownership and commit boundaries
系统 SHALL 允许所有者在安全阶段取消任务并释放全部预留资源，同时在不可逆 commit 窗口拒绝取消，且取消不得留下探针、孤立 `.meta` 或未登记资产。

#### Scenario: Owner cancels a queued task
- **GIVEN** 一个归当前连接所有且尚未进入 commit 的任务
- **WHEN** 所有者在任务进入 commit 窗口前请求取消
- **THEN** 任务进入 `cancelled`，所有预留资源被释放，后续冲突任务可以继续

#### Scenario: Owner cancels after commit starts
- **GIVEN** 一个归当前连接所有且已经进入不可逆 commit 的任务
- **WHEN** 所有者在任务进入不可逆 commit 窗口后请求取消
- **THEN** 系统拒绝取消并返回稳定原因，任务继续到可判定终态

#### Scenario: Non-owner attempts cancellation
- **GIVEN** 一个由其它 Bridge 连接拥有的任务标识
- **WHEN** 非所有者连接请求取消任务
- **THEN** 系统拒绝请求且不改变任务状态

### Requirement: Timeout never creates an unsafe mid-commit abort
系统 SHALL 使用不会强制中断不可逆 commit 的受控截止时间，使 commit 前超时在无项目变更的情况下释放资源，并使 commit 中超时在安全边界后以保守项目状态结束。

#### Scenario: Timeout while waiting for resources
- **GIVEN** 一个配置截止时间且仍在等待资源锁的任务
- **WHEN** 任务等待资源锁时超过截止时间
- **THEN** 任务以 timeout 失败结束，状态表明项目未改变，并释放所有队列占位

#### Scenario: Timeout during irreversible commit
- **GIVEN** 一个配置截止时间且已经进入不可逆 commit 的任务
- **WHEN** 截止时间在不可逆提交步骤执行期间到达
- **THEN** 系统不强制中断提交，并在安全边界后返回 timeout 失败及 `may_have_changed` 或更保守的项目状态

### Requirement: Idempotency prevents duplicate writes
系统 SHALL 在提供幂等键时，以任务所有者、工程、capability 和幂等键组成作用域并绑定工作摘要，使同摘要重复请求返回原任务且不同摘要复用同键时失败。

#### Scenario: Identical idempotent request is repeated
- **GIVEN** 一个保留期内已受理且带幂等键的任务
- **WHEN** 同一连接以相同幂等键重复提交相同 operation、输入和资源闭包
- **THEN** 系统返回首次任务的 `taskId`、状态或结果，不再次执行写入

#### Scenario: Idempotency key is reused for different work
- **GIVEN** 一个已绑定到既有工作摘要的幂等作用域
- **WHEN** 同一幂等作用域使用相同键提交不同输入、风险或资源闭包
- **THEN** 系统返回稳定的幂等冲突错误且不创建新任务

### Requirement: Evidence is indexed and safely retrievable
系统 SHALL 为终态任务保存遵守 owner 与保留期的结构化安全证据索引，关联执行阶段、资源闭包、AssetDB settle、postflight 和产物身份摘要，并排除 token、原始输入、完整日志及未声明文件内容。

#### Scenario: Owner reads successful task evidence
- **GIVEN** 一个归当前连接所有且仍在保留期内的成功任务
- **WHEN** 所有者查询保留期内成功任务的证据
- **THEN** 系统返回结构化证据索引，可关联到任务成功判据但不泄露敏感数据

#### Scenario: Failed task has partial evidence
- **GIVEN** 一个归当前连接所有且在中间阶段失败的任务
- **WHEN** 任务在中间阶段失败
- **THEN** 证据索引只列出已完成步骤及安全失败摘要，不把未执行步骤标记为通过
