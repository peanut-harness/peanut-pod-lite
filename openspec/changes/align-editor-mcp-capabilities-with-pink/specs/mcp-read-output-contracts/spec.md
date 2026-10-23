# Spec Delta

## Purpose

为 Lite MCP 的读取能力提供完整、可发现和可验证的输出契约，使自动化调用方能够区分合法空结果、真实业务数据和结构异常，且不会因字段缺失或宿主返回畸形数据而错误认定成功。

## ADDED Requirements

### Requirement: Every read operation publishes a concrete output schema
系统 SHALL 为每个公开读取操作发布描述其业务字段、必填项、可空性及有界集合的具体输出 schema。

#### Scenario: Baseline and new reads are discovered
- **GIVEN** 基线 41 个读取操作和本变更新增的读取操作已注册
- **WHEN** 客户端读取工具目录
- **THEN** 每个读取操作均有具体输出 schema，不能以空对象或仅允许任意字段代替业务契约

#### Scenario: Empty or unavailable values are legitimate
- **GIVEN** 查询目标无结果或某个宿主字段不可用
- **WHEN** 系统返回声明允许的空集合、null 或字段可用性信息
- **THEN** 结果通过对应 schema，并能区分无结果与查询失败

### Requirement: Read results are validated before success
系统 SHALL 在向调用方返回读取成功前校验实际业务结果是否满足该操作的输出 schema。

#### Scenario: Valid result is returned
- **GIVEN** 宿主返回符合契约的业务结果
- **WHEN** 系统完成输出校验
- **THEN** 调用方得到兼容既有字段和值的成功结果

#### Scenario: Malformed result is rejected
- **GIVEN** 宿主返回缺失必填字段、字段类型错误或超出集合边界的数据
- **WHEN** 系统执行输出校验
- **THEN** 返回稳定的结构化输出契约错误及安全字段路径，不透传为成功，不包含原始敏感结果

### Requirement: Read contracts preserve existing access boundaries
系统 SHALL 使输出契约新增和校验保持既有工具名、权限、结果容量及失败信封边界。

#### Scenario: Existing client continues reading
- **GIVEN** 客户端使用基线工具名和合法输入
- **WHEN** 已有读取操作返回合法业务数据
- **THEN** 原有成功字段及失败信封不被重命名或嵌套到新的不兼容层级

#### Scenario: Unauthorized read is attempted
- **GIVEN** 目标不属于调用连接可见工程或公开范围
- **WHEN** 客户端请求读取目标
- **THEN** 请求按原访问控制拒绝，输出 schema 不成为扩大访问范围的依据
