# Spec Delta

## Purpose

定义 Lite 首次创建 Prefab/Scene 主资源时的目标预留、AssetDB 发布、身份确认、冲突处理与失败清理行为，避免编辑器或后续任务观察到未登记或半提交资源。

## ADDED Requirements

### Requirement: New Prefab and Scene targets are reserved before publication
系统 SHALL 在首次创建 Prefab 或 Scene 主资源前，将目标路径、父目录、`.meta` 与已知依赖纳入同一受管任务资源闭包，并在任何磁盘或 AssetDB 发布前拒绝已存在目标或无法证明唯一所有权的目标。

#### Scenario: A missing target is admitted for creation
- **GIVEN** 目标 Prefab 或 Scene 在磁盘与 AssetDB 中均不存在，且调用已通过授权
- **WHEN** 受管任务完成资源闭包规划并取得全部相关锁
- **THEN** 系统为该任务预留目标并允许进入创建事务

#### Scenario: The target already exists
- **GIVEN** 目标路径已存在于磁盘、AssetDB 或二者之一
- **WHEN** 调用方请求首次创建同一路径的 Prefab 或 Scene
- **THEN** 系统以稳定冲突结果拒绝首次创建，不覆盖现有资源且不生成新的 `.meta`

#### Scenario: Two connections create the same target
- **GIVEN** 两个连接几乎同时请求创建同一 Prefab 或 Scene 目标
- **WHEN** 两个任务竞争相同资源闭包
- **THEN** 只有先取得目标预留的任务可以发布，后续任务必须等待后返回已存在或幂等复用结果

### Requirement: Publication completes through an AssetDB-owned creation barrier
系统 SHALL 通过受控的 AssetDB 创建与登记屏障发布新 Prefab/Scene，并在返回成功前确认父目录已登记、主资源具有真实 UUID、`.meta` 与声明的子资源可查询，且编辑器不会收到指向尚未登记主资源的后续操作。

#### Scenario: Parent directory is not yet registered
- **GIVEN** 目标 Prefab 或 Scene 的父目录尚未被 AssetDB 查询到
- **WHEN** 创建事务准备发布主资源
- **THEN** 系统先通过受控 AssetDB 路径登记父目录，再发布主资源且不得依赖普通文件系统 refresh 的竞态时序

#### Scenario: AssetDB confirms the new resource
- **GIVEN** 创建事务已向 AssetDB 提交主资源内容
- **WHEN** AssetDB 返回可查询的主资源 UUID、`.meta` 和适用的子资源信息
- **THEN** 系统记录身份摘要并允许任务进入引用校验和 postflight

#### Scenario: Registration remains pending
- **GIVEN** 创建事务已开始但主资源在截止时间内仍无法由 AssetDB 查询
- **WHEN** 注册屏障达到受控截止时间
- **THEN** 系统不得继续组件绑定、引用写入、catalog 或 preview，并以稳定的 registration pending 失败结束

### Requirement: Failed creation cleans up or reports conservative project state
系统 SHALL 在主资源可见前的失败或取消中移除该事务创建的暂存、探针和 sidecar；若失败发生在 AssetDB 可能已发布主资源之后，系统 MUST 保留可诊断证据并将项目状态报告为 `may_have_changed` 或更保守状态，禁止盲目重试。

#### Scenario: Creation is cancelled before publication
- **GIVEN** 一个新建任务已取得目标预留但尚未发布主资源
- **WHEN** 所有者在 commit 窗口前取消任务
- **THEN** 系统释放目标预留并清理本任务产生的暂存内容，使后续创建可以安全继续

#### Scenario: AssetDB rejects publication
- **GIVEN** 创建事务已进入 AssetDB 发布步骤
- **WHEN** AssetDB 拒绝创建或返回无法证明主资源状态的错误
- **THEN** 系统执行受控清理，记录已完成步骤，并在无法证明完全回滚时返回保守项目状态和先查询后处理的推荐动作

#### Scenario: Cleanup leaves no registration artifacts
- **GIVEN** 一个首次创建事务以失败或取消结束
- **WHEN** 系统完成清理和最终状态判定
- **THEN** 工程中不存在该事务遗留的注册探针、暂存文件或孤立 `.meta`，除非它们被明确列入 `may_have_changed` 证据

### Requirement: Creator evidence proves the atomic creation path
系统 SHALL 对每个开放写入的 Creator 精确补丁版本保存绑定候选 Host/Core 产物的真实创建证据，覆盖首次创建、同目标竞争、失败清理、AssetDB 身份和增量项目日志。

#### Scenario: Candidate passes the Creator creation matrix
- **GIVEN** 当前候选 Host/Core 已安装到声明版本匹配的 Creator 3.8.3 或 3.8.7 工程
- **WHEN** QA 通过真实 Bridge 执行 Prefab 与 Scene 首次创建矩阵
- **THEN** 报告证明每个成功资源具有真实 UUID 和 `.meta`、同目标竞争无覆盖、失败路径无残留，并且对应项目日志增量不含 `original asset is not exist` 或其它新错误警告

