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

### Requirement: Native component validation uses scoped capability attachments
系统 SHALL 在保持默认只读公开级别时，允许按名称挂接6项已注册的组件验收能力，并将实际路径及引用限制在当前工程的assets/components和assets/fixtures；挂接可撤销、重启恢复，每次写入仍须消费匹配连接、operation、resources和risk的一次性本地令牌。

#### Scenario: Only the approved six capabilities are attached
- **WHEN** 已认证当前工程请求精确挂接组件添加、移除、属性设置、commit、场景打开和预览刷新
- **THEN** 只增加这6项可见能力，其它写能力保持隐藏，默认公开档位与破坏确认不变

#### Scenario: Input claims an allowed resource but targets a different asset
- **WHEN** 实际业务路径、引用UUID或父目录身份超出挂接范围
- **THEN** 写入前拒绝，申报的resources不能扩大权限，原文件保持不变

#### Scenario: An attachment is revoked before a queued task writes
- **WHEN** 挂接已撤销而组件任务尚未进入写入
- **THEN** 原writer窗口重新校验并拒绝该任务，旧令牌不能恢复挂接

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

### Requirement: Resource campaigns use exact directory attachments
系统 SHALL 在默认只读档位下将资源验收所需的12项既有写能力精确挂接到单一运行目录assets/fixtures/resource-stability/<run>，与组件六项授权隔离；每次写入仍使用匹配连接和资源的一次性令牌，并在原writer锁内独立重算、核对完整资源依赖闭包。

#### Scenario: A resource is imported from a registered input
- **WHEN** 同工程本轮私有暂存目录的普通文件通过明确来源全集导入本轮资产目录
- **THEN** 来源只能只读、拒绝符号链接和外盘路径，不允许隐式依赖展开或省略全局目标，输出身份通过真实AssetDB及原生对象后验

#### Scenario: A copy carries a dependency outside the attached directory
- **WHEN** 写入前独立重算的复制闭包包含范围外路径或未知UUID，或等待writer时闭包新增资源
- **THEN** 第一项变化前拒绝，不以调用方声明的种子或resources替代真实闭包，不公开all

#### Scenario: Resource and component profiles are mixed
- **WHEN** 请求混合两个profile的能力名、扩大资源根或只提供UUID目标
- **THEN** 原授权保持不变并拒绝；撤销和重启恢复沿用现有单工程记录及原writer代数校验

#### Scenario: A missing parent metadata would be created implicitly
- **WHEN** 本轮目录的任一祖先目录或其metadata缺失、为链接或身份变化
- **THEN** 第一项变更前拒绝，不在授权目录外隐含补写；复制的实际执行还须与完整只读准备及源/祖先摘要一致

#### Scenario: Attachment is revoked while a native reference query waits
- **WHEN** 原writer守卫的异步AssetDB查询期间授权被撤销或重新挂接
- **THEN** 查询完成后重新核验授权代数并拒绝旧任务，不进入commit

#### Scenario: Native resource fields use their actual authority
- **WHEN** 资源验收读取运行时对象、导入配置或源文本字段
- **THEN** 逐语义指针标明真实authority、Creator版本、固定reader及源码摘要；导入配置和源文本不能冒充运行时对象，serialized-only不能作为原生通过

#### Scenario: Imported dependencies receive new UUIDs
- **WHEN** 资产补丁需要引用本轮实际导入的依赖
- **THEN** 仅允许显式resources中同run源和props下null占位；在签发一次性令牌前从真实AssetDB及固定SDK类型reader解析UUID，独立后验用保留的源快照重算期望，不猜测旧meta UUID，不扩大能力或目录

### Requirement: SDK cold startup retains real timer pairing
系统 SHALL 在已核验Creator 3.8.7的正式asset-db worker生命周期入口，为真实冷数据库预启动补齐SDK遗漏的真实start，保留原方法、真实end及全部原始诊断；不修改SDK安装包，不在未知版本或函数指纹漂移时安装修复。

#### Scenario: Cold database follows the verified SDK prestart path
- **WHEN** SDK真实数据库实例在预启动入口开始启动
- **THEN** 原start恰好调用一次后继续原预启动，不重放数据库操作、不伪造时间，不改变SDK真实end

#### Scenario: Runtime is changed or compatibility entry is unloaded
- **WHEN** SDK版本/方法指纹未知，或卸载时该方法已被其它主体改变
- **THEN** 不覆盖其它实现；仅恢复本入口拥有的引用，保留可定位失败，不吞诊断

#### Scenario: Formal worker keeps the SDK entry context
- **WHEN** 正式Host的asset-db入口装载已核验worker
- **THEN** SDK直接装载与共同环境控制组同字节的worker，不依赖普通Node子模块自动继承SDK入口上下文；版本化升级由正式manifest指向选定worker，回滚恢复原manifest

#### Scenario: Minimal comparison requires a shared SDK repair environment
- **WHEN** 原纯无Lite和带Lite最小工程均复现同一SDK冷计时错误
- **THEN** 保留两侧原失败；新对照明确记录无Host/Core但带固定SDK修复夹具的控制条件，与正式Host使用同字节worker来源，不能称为未加夹具的纯原生SDK通过

### Requirement: Resource field refusals retain preparation proof
系统 SHALL 将真实字段准备阶段的输入拒绝与写入后的执行故障分开，只有来自原操作、原错误和当前准备阶段的有限一次性证明才能将实际failed任务投影为invalid_input及源未变化；未知状态仍保守保留，禁止按错误前缀伪造证明。

#### Scenario: An invalid field fails in disposable preparation
- **WHEN** 同一受管请求的真实disposable session在save前拒绝非法字段，来源与taskId绑定且输入、取消状态及准备阶段均未变化
- **THEN** 保留ok:false和failed状态、精确拒绝码与有限准备证明；不执行writer，不将拒绝变成成功，不吞掉真实诊断

#### Scenario: A proof is stale or the write window has started
- **WHEN** 证明被复制、重放、用于另一任务，输入变化、取消、准备scope失效或故障发生在写入后
- **THEN** 拒绝使用准备证明，状态保持unknown或实际写入后状态，不能宣称unchanged

#### Scenario: Packed Core and Host retain a single proof owner
- **WHEN** 独立打包Core通过真实Host任务API执行字段负例，Core和Host模块状态彼此隔离
- **THEN** 固定准备实现由可信Host组装注入并在Host证明作用域中运行；Core不能提交任意异常、回调或证明，缺少生产准备端口必须明确失败；公开失败保留原精确码、真实taskId及有限证明，源/meta保持不变

### Requirement: Owned window module installations drain before unload
系统 SHALL 按生命周期generation跟踪自身窗口模块的所有已受理安装；卸载停止接收后等待这些安装和实际late cleanup，并保留卸载期间真实异常，不以stopping或窗口随后销毁将失败转为成功。

#### Scenario: An installation finishes after unload starts
- **WHEN** 已受理的实际load在unload开始后才报告installed，或load/cleanup真实拒绝
- **THEN** 等待并清理同generation自有结果，尝试其他自有清理后传播原错误；旧结果不能加入新generation，未完成安装不能冒充已完成卸载
