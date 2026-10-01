# Spec Delta

## Purpose

定义资源、组件和代码操作在已支持的 Creator 精确版本上的全量覆盖、有效输入零新增警告错误、生命周期日志与候选身份验收，防止用部分压力测试、离线序列化或隐藏日志宣称整个编辑器操作链稳定。

## ADDED Requirements

### Requirement: Coverage is exhaustive and version specific
验收系统 SHALL 为 Creator 3.8.3、3.8.7 分别生成绑定原生 importer、组件目录、Lite schema 和公开 operation 目录的覆盖清单；每个资源种类、组件及适用操作均有唯一用例和真实结果，额外版本能力不得由另一版本的结果推断。

#### Scenario: Native and product inventories are reconciled
- **WHEN** 验收开始并读取当前版本的原生目录和产品目录
- **THEN** 报告逐项列出两者差异、适用读写能力、前置依赖及用例标识；产品宣称支持却没有用例的条目阻止全量通过

#### Scenario: A fixture or supported operation is missing
- **WHEN** 一个适用资源、组件、属性类型或 operation 缺夹具、被跳过或尚未验证
- **THEN** 全量验收失败并列出缺口，不减少分母、不将跳过记为通过；原生不支持项只允许按版本证据明确列为不适用

### Requirement: Valid resource operations preserve identity and emit no diagnostics
系统 SHALL 对有效且获批的资源创建或导入、读取、属性修改、复制、移动、重命名、刷新和删除完成类型化后验，保持适用的 UUID、`.meta`、子资源和引用正确，且原始操作日志零新增 warning/error，无未处理异常或注册残留。

#### Scenario: A resource completes its applicable lifecycle
- **WHEN** 有效夹具依次执行该种类适用的生命周期及 Inspector 属性操作
- **THEN** 每步具有内容或属性读回、真实 AssetDB 身份、适用引用及干净日志证据，移动和重命名保持 UUID，删除按声明依赖策略执行

#### Scenario: A warning appears after a successful response
- **WHEN** 业务响应成功后、声明 settle 或观察窗口内原始日志出现 warning/error
- **THEN** 对应用例失败并保留原始日志区间，不能以响应成功或过滤后的日志判定通过

### Requirement: Components survive native loading and property changes
系统 SHALL 对每个版本实际支持的组件验证依赖满足后的添加、属性读取与修改、引用绑定、移除、保存与原生重开；公开可编辑字段及其标量、枚举、数组、嵌套值、对象和资源引用类型均有有效值读回与边界拒绝覆盖。

#### Scenario: Component with dependencies is tested
- **WHEN** 一个组件需要其它组件、父子节点、物理后端、脚本或资源依赖
- **THEN** 验收先建立真实有效依赖，再验证组件行为和原生重开；不以空占位组件或离线 JSON 可读替代 Creator 加载

#### Scenario: Invalid component field is rejected
- **WHEN** 输入包含不可写字段、非法值或错误引用类型
- **THEN** 在受控边界返回稳定结构化拒绝，原文件不变，编辑器无新增 warning/error，不把错误写入后再加载判定

### Requirement: Code operations include compilation and bindings
系统 SHALL 对支持的 TypeScript、JavaScript 资产验证单文件与跨文件内容读写、导入依赖、组件类型与字段引用、AssetDB 刷新、实际 Creator 编译就绪、保存重开及必要的预览加载；内容可读不等于代码可编译或运行。

#### Scenario: Several code files change together
- **WHEN** 一个有效多文件代码变更修改组件及其依赖模块
- **THEN** 所有文件内容和摘要读回一致，现有脚本 UUID 保持，Creator 完成编译且原生组件字段与引用仍有效，无新增 warning/error

#### Scenario: A code dependency is unresolved
- **WHEN** 编译或预览观察发现缺依赖、语法错误、无效组件类型或运行时异常
- **THEN** 用例与最终稳定性验收失败，返回保守状态和可定位证据，不以落盘或 refresh 完成声明代码稳定

### Requirement: Lifecycle diagnostics remain raw and attributable
验收系统 SHALL 从受管启动开始保存启动、操作、冷却和正常退出各阶段的原始文本日志与时间区间，绑定候选 Host/Core 和工程身份，并使任一阶段新增 warning/error 阻止零警告验收；不得通过增加 ignore 规则、吞异常或降低日志级别满足验收。

#### Scenario: Project naming causes a startup warning
- **WHEN** 隔离工程的名称导致 Creator 发出可执行文件名警告
- **THEN** 修正隔离夹具名称并重新执行启动验收，保留旧失败证据，原工程不改动

#### Scenario: Normal shutdown reports a destroyed object
- **WHEN** 正常退出产生 `Object has been destroyed` 或等价生命周期警告
- **THEN** 保存原始堆栈并复测带扩展与最小工程的归属；未根治或证明安全规避前该阶段保持失败，不能因属于 Creator 内部而豁免

### Requirement: Stability acceptance binds the complete current candidate
系统 SHALL 仅在两版同一新候选的全量矩阵、至少 100 文件分片批读写、30 分钟正常混合负载、10 分钟过载与冷却回收、正常退出全部通过时声明本次全量稳定性完成，并报告零遗漏、零非预期失败、零新增原始日志警告错误及零探针任务残留。

#### Scenario: Candidate changes after an earlier soak
- **WHEN** Host、Core 或影响操作行为的源码发生变化
- **THEN** 旧报告只作基线，最终矩阵和长稳重新绑定新制品，不复用旧 digest 的实机通过结论

#### Scenario: Expected refusal is exercised under load
- **WHEN** 非法输入、无审批、版本不支持、取消或过载负面用例按预期返回结构化拒绝
- **THEN** 报告单列预期拒绝与退避重试，验证未发生越权写入或额外日志；不能删除必要容量和权限保护以追求所有响应成功
