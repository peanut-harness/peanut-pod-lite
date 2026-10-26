# Spec Delta

## Purpose

提供 PeanutPod 整体能力、测试定义和验收证据之间可复核的离线映射，使维护者能够辨别当前候选的真实覆盖、已有历史证据及未完成项，并据此选择下一项验收工作。该能力保留各责任仓库和既有验收规范的边界，不以报告生成成功替代产品通过。

## ADDED Requirements

### Requirement: Independent capability denominator

系统 SHALL 从显式绑定身份与摘要的来源建立能力分母，独立于用例和结果文件；保留未映射、未核实和来源缺失项。系统 MUST 保留版本化 editor-stability 分母的全部目标、动作与未决项，并将当前 Lite 与 Pro 固定依赖的 Lite 分开标识。

#### Scenario: Missing case cannot remove a capability
- **WHEN** 来源包含某个能力而映射文件没有对应测试
- **THEN** 报告保留该能力并列为 unmapped，不能从分母删除或列为不适用

#### Scenario: A repository source is unavailable
- **WHEN** 配置要求的 Pro、Server 或 CPM 来源未提供或摘要不符
- **THEN** 报告明确来源不可用或无效，分母完整性未确认，不能输出整体覆盖完成

#### Scenario: Nested inventory has unresolved targets
- **WHEN** editor-stability 分母包含未核实组件、动态注册、额外 importer 或无结果用例
- **THEN** 汇总保留原标识和待核实状态，不能用已有子集替代完整分母

### Requirement: Explicit case and workflow mapping

系统 SHALL 为每个用例记录稳定标识、能力引用、责任仓库、测试层、精确适用环境、前置条件、夹具、入口、预期业务结果、允许副作用、独立读回和恢复要求。业务主线 SHALL 覆盖安装生命周期、基础编辑、设计到工程、字体与内容工具、账号与权限、恢复与连续使用；产品是否提供能力与该能力测试是否完成 MUST 分开表达。

#### Scenario: Rejection has a distinct expectation
- **WHEN** 同一能力有正常执行与无权限拒绝用例
- **THEN** 两者分别映射和计数，拒绝用例通过不能满足正常执行用例

#### Scenario: Command exists without recorded results
- **WHEN** 用例引用存在的测试入口但没有执行证据
- **THEN** 仅确认测试已映射，结果保持未执行

#### Scenario: Malformed mapping is supplied
- **WHEN** 映射包含重复标识、未知能力、悬空依赖、循环依赖或缺少必需判据
- **THEN** 校验失败并指出对应标识，不自动忽略错误项

### Requirement: Evidence validity is independent from execution outcome

系统 SHALL 分别表示执行结果、证据核验状态和候选适用性，只有证据可读取、摘要及必需读回核验通过且适用于声明候选时才计入当前通过。结果绑定 SHALL 包含责任仓库、原源码身份、相关输入摘要、制品、工具链、平台、精确宿主版本、夹具及实际命令身份；不同层所需字段由明确的证据类型决定，缺失必需字段不得默认为一致。

#### Scenario: Native result is from another candidate or version
- **WHEN** 原生结果的包摘要或 Creator 版本与当前候选不同
- **THEN** 原始结果保留为历史记录，当前验收不计通过，并显示不匹配原因

#### Scenario: Source commit changes without relevant input changes
- **WHEN** 新提交只改变不被该测试消费的内容，且原始成功证据和全部相关输入绑定均可核验一致
- **THEN** 允许明确记录复用关系并保留原证据身份，不改写历史源码或结果

#### Scenario: A summary claims success without underlying evidence
- **WHEN** 只有 pass 标记、命令退出码、文档描述或不可访问的原始证据引用
- **THEN** 当前证据保持未核验或缺失，不能从这些摘要合成原生或服务集成通过

#### Scenario: Environment prevents execution
- **WHEN** 锁屏、Creator 不可用或隔离服务缺失阻止执行
- **THEN** 标记环境阻塞，保留所需用例及阻塞原因，不改为 passed、skipped 或 not_applicable

### Requirement: Layer specific acceptance boundaries

系统 SHALL 将代码契约、制品安装、Creator 原生、业务流程、故障长稳证据分别归类，保留相关规范要求的独立后验。产品响应成功、Node 替身和目录校验 MUST NOT 升级为 Creator、真实服务或用户业务流程通过。适用故障注入用例 SHALL 区分预期诊断与新增非预期诊断。

#### Scenario: Created resource lacks native identity
- **WHEN** 资源创建返回成功但没有必需的 AssetDB UUID、meta、引用或日志后验
- **THEN** 该原生用例不得计为当前通过，报告缺失的后验项目

#### Scenario: Server test uses substitutes
- **WHEN** 账号或计划测试通过但使用 OIDC、PostgreSQL、KMS 或运行时替身
- **THEN** 只记录其协议或单元层覆盖，真实依赖与目标宿主验收仍为独立未完成项

#### Scenario: A target is declared not applicable
- **WHEN** 用例声明不适用
- **THEN** 必须核验适用范围依据；editor-stability 项仍须满足其原生目录与原始证据规则，不接受静态缺失或人工跳过作为依据

### Requirement: Reproducible honest coverage reports

系统 SHALL 对同一规范化输入生成稳定排序、无运行时随机字段的 JSON 和 Markdown 报告，分别输出分母完整性、测试映射覆盖、当前结果状态、证据缺口和历史结果。系统 MUST 同时显示原始总量、不适用量及适用分母，不把 unmapped、blocked、failed、not_run 或未核验证据隐去。

#### Scenario: No results are supplied
- **WHEN** 所有来源和映射有效但结果集合为空
- **THEN** 报告可以成功生成，所有相关用例显示未执行，当前通过数为零，验收未完成

#### Scenario: Report rendering succeeds with incomplete acceptance
- **WHEN** 报告包含未执行或阻塞项
- **THEN** 报告生成状态与产品验收状态分别输出，要求验收完成的检查返回非零

#### Scenario: Input order varies
- **WHEN** 等价输入只改变记录或键的排列顺序
- **THEN** 规范化报告与其摘要相同，按测试层和精确环境分别统计，不产生跨层混合成功率

### Requirement: Offline bounded acceptance planning

系统 SHALL 生成具有依赖和停止条件的最小验收链计划，绑定候选身份、精确版本、隔离工程要求、现有执行入口、预期读回和清理条件。系统 MUST 仅从显式允许根读取有界数据，不执行输入中的代码、命令或网络请求，不修改输入/历史证据，并拒绝路径逃逸、符号链接逃逸、未知版本和超过限制的输入。

#### Scenario: Minimum Creator chain is planned
- **WHEN** 用户请求候选安装到基础编辑的计划
- **THEN** 计划依次包含安装身份、宿主就绪、只读冒烟、审批写入、保存重开、独立读回和清理，前一门禁失败阻止依赖步骤；清理按实际已执行状态处理而非盲目删除

#### Scenario: Input embeds a command or external location
- **WHEN** 映射或证据携带可执行文本、远程引用或越界文件路径
- **THEN** 命令仅作为经过校验的展示数据，远程/越界读取被拒绝，不产生执行、网络或输入目录写入

#### Scenario: Output already exists
- **WHEN** 请求输出位置已有文件或与输入重叠
- **THEN** 明确拒绝覆盖；只有显式新输出目录可写，历史报告及失败证据保持原样
