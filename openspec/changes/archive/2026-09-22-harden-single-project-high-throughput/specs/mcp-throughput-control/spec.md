# Spec Delta

## Purpose

定义 Lite 在单个 Creator 工程承受大量并发读写请求时的有界受理、成本分级、读合并、一致性标识、公平调度与过载反馈，使系统在容量边界内提升吞吐并在超载时可预测地降级而非无限排队。

## ADDED Requirements

### Requirement: Admission is bounded per connection and project
系统 SHALL 在执行业务逻辑前按 Bridge 连接、Creator 工程和操作成本类别限制在途请求与等待请求数量，并为所有内部任务队列、资源等待队列和批次准备队列设置硬容量边界。

#### Scenario: Capacity is available
- **GIVEN** 当前连接与工程均未达到对应成本类别的在途或等待上限
- **WHEN** 调用方提交一个通过输入与权限校验的请求
- **THEN** 系统受理请求并返回正常同步结果或受管任务回执

#### Scenario: Project queue is full
- **GIVEN** 当前工程的对应等待队列已达到声明容量
- **WHEN** 任一连接继续提交同类别请求
- **THEN** 系统在创建任务、取得审批消费或执行项目操作前拒绝请求，不增加任何内部队列或工程状态

#### Scenario: One connection floods a project
- **GIVEN** 一个连接持续提交请求且其它连接也有已受理工作
- **WHEN** 该连接达到自身配额但工程仍有剩余容量
- **THEN** 系统仅限制该连接，并为其它连接保留可推进容量

### Requirement: Overload responses are stable and retry-safe
系统 SHALL 对容量不足、等待预算耗尽和主动负载削减返回稳定的 `overloaded` 类失败，包含拒绝阶段、受控队列摘要和有界 `retryAfterMs`，且只在项目状态可证明未改变时允许重试。

#### Scenario: Request is rejected at admission
- **GIVEN** 请求尚未创建任务或进入任何写入阶段
- **WHEN** admission control 因容量不足拒绝请求
- **THEN** 响应标记项目状态为 `not_started` 或 `unchanged`，给出退避建议且不返回敏感的其它连接信息

#### Scenario: Client retries with idempotency
- **GIVEN** 一个写请求曾被受理但客户端未收到确定结果
- **WHEN** 客户端在退避后以相同幂等键重试相同工作
- **THEN** 系统复用原任务或结果，不重复执行写入

#### Scenario: Project state is uncertain
- **GIVEN** 请求已进入不可逆提交且最终状态为 `may_have_changed` 或 `unknown`
- **WHEN** 系统生成恢复建议
- **THEN** 响应要求先查询工程状态，不得建议自动重放

### Requirement: Read workloads are cost-classed and revision-aware
系统 SHALL 将只读 operation 按轻量查询、重型扫描和实时编辑器查询分类并应用不同并发预算；可合并或缓存的结果必须绑定工程 revision、有效期和来源，使调用方能识别陈旧结果。

#### Scenario: Identical reads are coalesced
- **GIVEN** 同一工程在短窗口内收到多个语义相同且允许合并的只读请求
- **WHEN** 第一个请求仍在执行
- **THEN** 系统共享同一次底层读取并向每个调用方返回各自响应，底层 Bridge 不重复执行等价查询

#### Scenario: Heavy reads reach their concurrency budget
- **GIVEN** 当前工程已有达到上限的依赖扫描、全量 hierarchy 或等价重型读取
- **WHEN** 新的重型读取到达
- **THEN** 系统有界等待或以 overload 拒绝，而不是占用轻量读取和 writer 的全部执行容量

#### Scenario: A cached read crosses a write revision
- **GIVEN** 一个缓存或合并读取绑定旧工程 revision
- **WHEN** 相关资源完成写提交并推进 revision
- **THEN** 系统不得把旧结果冒充当前状态，必须失效、重读或明确返回其旧 revision

### Requirement: Scheduling preserves fairness under sustained load
系统 SHALL 在持续单工程负载下限制单批大小、准备并发、writer 连续占用和优先级连续次数，使交互请求、取消/状态控制和较低优先级任务在声明等待上界内获得推进机会。

#### Scenario: Large background workload is sliced
- **GIVEN** 一个后台批次包含超过单次提交上限的独立操作
- **WHEN** 系统执行该批次
- **THEN** 系统按稳定顺序切分为有界提交片段，并在片段之间允许已等待的更高优先级或控制请求推进

#### Scenario: High priority traffic is continuous
- **GIVEN** 高优先级请求持续到达且低优先级任务已经等待
- **WHEN** 调度器达到声明的连续高优先级执行上限
- **THEN** 系统允许一个可运行的较低优先级任务推进，不无限饥饿

#### Scenario: Control operations remain responsive
- **GIVEN** 工程队列处于高水位
- **WHEN** 所有者查询或取消尚未提交的任务
- **THEN** 状态与取消控制使用保留容量，不被普通业务请求完全阻塞

### Requirement: Throughput health is observable without leaking work content
系统 SHALL 提供脱敏的工程级吞吐健康摘要，至少覆盖各成本类别的在途数、等待数、拒绝数、等待延迟、执行延迟、writer 占用、AssetDB settle 延迟、event-loop lag 和任务回收数量，并排除资源内容、原始输入、token 与其它连接身份。

#### Scenario: Operator inspects a loaded project
- **GIVEN** 单工程正在执行大量混合读写请求
- **WHEN** 受信宿主读取吞吐健康摘要
- **THEN** 返回有界聚合指标与容量配置，可区分正常排队、过载拒绝和异常 settle 延迟

#### Scenario: External caller lacks diagnostic authority
- **GIVEN** 普通 Bridge 调用方请求吞吐诊断
- **WHEN** 调用方没有宿主级诊断权限
- **THEN** 系统只返回其自身请求的必要 overload/等待摘要，不泄露工程整体或其它连接数据

### Requirement: High-throughput support is evidence gated
系统 SHALL 在 Creator 3.8.3 与 3.8.7 分别保存绑定候选 Host/Core 身份的单工程长稳证据，覆盖持续读取、批量写入、混合负载、队列高水位、过载拒绝、取消/超时、失败恢复和客户端退避重试。

#### Scenario: Candidate passes the soak matrix
- **GIVEN** 当前候选安装于声明精确版本的 Creator 工程
- **WHEN** QA 在单工程运行声明时长与负载规模的高吞吐矩阵
- **THEN** 报告证明队列与内存有界、控制请求可响应、无资源覆盖或注册残留、成功任务后验有效且项目日志无新增 error/warn

#### Scenario: Soak evidence is incomplete
- **GIVEN** 任一开放写入的 Creator 精确版本缺少长稳、过载或恢复证据
- **WHEN** 候选准备声明高吞吐支持
- **THEN** 系统保持该声明未验证，不以单元测试或短时并发结果替代实机长稳证据
