# Spec Delta

## MODIFIED Requirements

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
