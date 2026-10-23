# Spec Delta

## Purpose

为 Creator 当前场景中的粒子系统提供显式目标查询和实时控制，使调用方可以读取播放状态并调整模拟过程，同时避免选区耦合导致对无关节点操作，且不将实时状态误认为已经保存到场景资产。

## ADDED Requirements

### Requirement: Particle state is observable for explicit targets
系统 SHALL 通过 `particle.queryState` 返回显式 3D ParticleSystem 目标的身份、速度、模拟时间、粒子计数和播放状态及逐字段可用性。

#### Scenario: Supported live target is queried
- **GIVEN** 当前工程和场景中存在受支持的粒子目标
- **WHEN** 调用方按节点和组件身份查询
- **THEN** 返回该目标的真实读回状态，未暴露的字段明确不可用，不以虚构默认值代替

#### Scenario: Target is absent or incompatible
- **GIVEN** 目标已删除、不是粒子系统或宿主版本无对应适配
- **WHEN** 调用方查询目标
- **THEN** 返回目标失效或不支持的结构化结果，不退回当前选中对象

### Requirement: Particle controls stay bound to approved targets
系统 SHALL 通过 `particle.control` 对获批显式目标提供 `setSpeed/play/pause/stop/restart` 五类实时控制。

#### Scenario: Authorized control is verified
- **GIVEN** 当前精确版本已通过验收，目标和动作已获本地审批
- **WHEN** 分别执行五类控制动作
- **THEN** 每项均有目标身份和与动作相符的状态读回证据，调用只改变实时模拟状态，不声称持久化场景资产

#### Scenario: Selection changes during admission
- **GIVEN** 审批绑定目标 A，当前选区后来改为 B
- **WHEN** 控制动作取得执行机会
- **THEN** 仍只作用于 A，无法保证时在执行前拒绝，B 的模拟状态保持不变

#### Scenario: Speed or authorization is invalid
- **GIVEN** 速度为负数、非有限值、超声明上限，或审批缺失/过期/绑定不符
- **WHEN** 调用方请求控制
- **THEN** 系统在原生调用前拒绝并保持粒子状态不变

### Requirement: Particle mutation is enabled only by exact version evidence
系统 SHALL 仅为已通过该能力实机验收的 Creator 精确版本开放粒子控制写路径。

#### Scenario: Static declaration exists without runtime proof
- **GIVEN** 安装包有粒子管理器声明但本候选尚未完成该版本实机验收
- **WHEN** 外部调用方请求粒子控制
- **THEN** 返回带版本和能力缺口的不支持结果，不把内部类型声明当作外部可执行授权
