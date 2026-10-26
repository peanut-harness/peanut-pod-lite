# Design

## Context

动机见 proposal.md。以下是本轮只读确认的实现事实，不是新测试通过声明：

- Lite `tools/editor-stability/coverage-{contracts,inventory-reader,manifest-generator,manifest-validator}.mts` 已定义独立分母、稳定摘要、精确版本、夹具和原始结果验证；生成器只产生 pending。现存草稿的 3.8.7/3.8.3 用例分别为 4119/4128，这些数字只是历史输入，不能硬编码为新候选分母。
- Lite 根 verify 覆盖生成一致性、构建、类型和测试；Pro 根 verify 只有结构、工具与目录，业务包另有 test/typecheck/pack。Pro 的 `catalog/core-operations.json` 对应固定 Lite，不能冒充 Lite 当前主线。
- Server 根 `src/http-handler.js` 的账户、账单、计划路由与 `actor-service/` 迁移轨并存，根单测使用替身。Node 与目标原生 Actor 宿主必须分别记录。
- Creator 原生创建、资源稳定性和吞吐已有脚本；其使用限制及原始后验继续有效。UI Prefab 2.6、账号 v1 接收、公开 CPM 发布和资源稳定性仍有独立未完成任务。

## Goals / Non-Goals

**Goals:** 交付一个不执行产品的离线索引/校验工具、六条主线的可追溯映射、当前证据缺口报告，以及最小实机链计划。读者可追溯每个统计到来源、用例和证据，分母不随结果缺失而缩小。

**Non-Goals:** 不新增测试执行器、Agent 调度、自动登录/付费、云服务或浏览器；不改变现有覆盖校验规则；不消费未指定目录；不以本变更完成宣称全部 Pod 产品验收完成。后续修复与实机任务必须在原责任仓和独立准入下进行。

## Decisions

### 1. 归属与最小实现

Lite 拥有产品级测试导航，新增 `tools/pod-test-coverage/` 下 TypeScript ESM 模块；数据与示例放 `tests/fixtures/pod-test-coverage/`，说明和初始映射放 `docs/testing/pod/`。采用标准库，不新增依赖，不修改产品 workspace、lockfile 或安装包。根 test:tools 的既有发现规则可以接入新 `.test.mjs` 测试。

工具运行基线选择 Node 22，精确补丁与 OS/架构进入验收记录；与 Creator 内嵌 Node 14 的产品兼容基线分开。路径处理使用平台标准 API，首轮实际宿主验收为 macOS；Windows/Linux 文件系统行为用固定夹具覆盖但不冒称已在对应机器验收。容量上限集中定义为输入协议限制，禁止从任意环境变量改变验证强度。固定来源/证据适配器由显式组装清单注入，未知类型拒绝赋予通过，不建立外部插件加载机制。

采用薄适配层汇总现有分母，不改 editor-stability。其 `.mts` 校验器可由现有 tsx 测试/适配环境调用，但离线主命令不得为验证输入动态导入任意文件；优先消费原校验器的已验证、绑定原始输入的报告。仅有覆盖草稿时导入全部用例，证据均为 missing/unverified。未完成可信原始证据适配器的报告类型只作历史索引，不具备赋予 passed 的权限。建立一个新的通用 QA 框架会重复宿主与执行语义，因此不采用。

### 2. 输入身份与独立来源

输入为 `pod-test-coverage-input.v1` JSON，包含 `sources`、`capabilities`、`cases`、`workflows`、`results` 和 `candidate`；结果不能添加或删除 capabilities。每种数据必须显式 schemaVersion，拒绝未知字段及重复 ID。

| 对象 | 必需内容 |
| --- | --- |
| source | repository、角色（当前产品/固定依赖）、commit/tree、相对 sourceRef、sha256、来源种类、完整性依据、精确版本或 null |
| capability | 稳定 ID、ownerRepo、sourceId、sourceSubject、适用范围、待核实原因、关联既有 change/spec |
| case | 稳定 ID、capabilityIds、layer、environment、preconditions、fixtureRefs、commandRef、expectedOutcome、allowedEffects、readback、recovery、depends |
| result | caseId、executionOutcome、原始 command/输入/制品/夹具绑定、evidenceRefs、既有 validator 身份、原始结果时间、诊断摘要引用 |
| workflow | 六类之一、所需 caseId、有序依赖、停止及清理规则 |
| candidate | 各责任仓库与固定依赖身份、明确需要验收的环境和相关输入摘要；不能只填一个总 commit |

本机根路径只通过 CLI 显式 `--source-root <repository=path>` / `--evidence-root <id=path>` 提供，不写进共享 JSON。引用采用 rootId 与规范相对路径，禁止 `..`、绝对路径、协议和 symlink 逃逸。不同仓缺少根不自动搜索兄弟目录。

来源适配：

- Lite：现有版本化 inventory/manifest 是完整资源/操作分母；profile JSON 解释声明的版本边界，草稿自身不证明 supported。摘要不对应当前候选时仍展示历史来源，并标记候选分母未确认。
- Pro：读取 core/premium catalog、各插件 manifest/package.json 与 fixed-Lite 身份；每个 catalog 条目必须独立进入分母，业务包入口单列，不把根 verify 当全部测试。
- Server：人工审阅的根 HTTP 路由与 Actor 服务清单绑定各自实现文件摘要，记录 reviewer 依据和遗漏限制；文件漂移必须重新审阅，不用不可靠正则静默生成“完整 API”。本轮已确认的六类路由为 offer、subscription、checkout、billing webhook、plans、plans/verify。完整性由清单审阅与源文件绑定确认，非机器自动证明。
- CPM：只读其 package.json、已有 release/bootstrap 用例与公开发布任务引用；生产端点证据没有提供时明确缺失。安装能力边界不扩展到当前未承诺的 Creator 平台。
- 用户业务主线另有版本化策展清单，不以操作目录替代面板入口、重开、回滚、账号会话和结果消费。新能力源出现时产生 unmapped，而非自动生成 passed。

选择显式快照而非启动所有产品收集目录，便于离线检查且不引入实机副作用；代价是来源新鲜度必须展示并校验。

### 3. 三轴状态与统计

- `executionOutcome`：`not_run | passed | failed | blocked | not_applicable`。旧 pending 映射为 not_run；旧 skipped 保留原始值并作为未完成缺口，不能变为不适用。
- `evidenceStatus`：`missing | unverified | verified | invalid`。引用存在且哈希正确只是必要条件；必须通过该类型原始证据解析器核验判据。未知类型为 unverified，不能通过。
- `applicability`：`current | historical | unknown`。实际命令、平台、运行时/Creator、制品、夹具、测试源码及被测输入全部相符才为 current。纯文档提交允许在完整输入证明下复用，保留原 commit/tree 和复用说明。

`currentPassed` 只计三轴为 passed/verified/current 的用例。不适用须有对应规格认可的依据；editor-stability 的 runtime_catalog/原始证据要求原样保留。最小合成夹具只证明工具本身，报告必须标记 synthetic，不进入产品结果。

报告分别给出 capabilityTotal、mapped/unmapped、caseTotal、currentPassed、currentFailed、blocked、notRun、evidenceMissing/Invalid/Unverified、historical 和 notApplicable；三轴计数是不同维度，禁止相加当成总用例数。显示原始总量、不适用量和适用总量。分母未知时总完成率为空；按测试层、目标环境、业务主线分别统计，不把单测量和原生量混算。多个旧结果全量保留；同一 candidate/case 存在互相矛盾且无明确后续尝试关系的结果时作为冲突，不择优取通过。

有效测试映射不代表已执行。预期拒绝的 case 必须与正常成功 case 分离。只有 required workflow 全部适用用例当前满足判据、分母完整且无悬空映射时，才能对该 workflow 声明验收完成。

### 4. 命令与有界读写

拟提供：

```
node --import tsx tools/pod-test-coverage/cli.mts validate --input <json> --source-root <id=path> --evidence-root <id=path>
node --import tsx tools/pod-test-coverage/cli.mts report --input <json> --source-root <id=path> --evidence-root <id=path> --out <new-directory>
node --import tsx tools/pod-test-coverage/cli.mts check-acceptance --input <json> --source-root <id=path> --evidence-root <id=path> --workflow <id>
```

validate 仅检查输入结构、引用、来源完整性声明、映射与证据一致性；合法的 not_run/blocked 不造成结构校验失败。来源缺失明确列缺口，已声明摘要不匹配/非法引用则错误。report 对合法但不完整输入生成报告并返回 0，明确 `acceptanceComplete:false`；check-acceptance 对所选主线未完成返回 2；非法输入或 I/O 错误返回 1。没有输出参数的检查不得写文件。

每文件上限 32 MiB、总读取 128 MiB、JSON 深度 64、总用例上限 100000、引用文件上限 1024；超限报稳定错误，不截断分母。路径只读解析后还须核对 realpath，拒绝任何符号链接输入，防止替换逃逸；静态本地输入前后摘要变化视为 invalid。根目录不允许写入；输出必须是独立新目录，排他创建 JSON/Markdown，不覆盖历史文件，失败仅清理本次新建输出，不修改输入或旧报告。Markdown 转义来自输入的文本，禁止嵌入原始 HTML。

命令使用 repository、cwd-relative、executable、argv 的展示结构，不拼接 shell、更不执行；不动态加载外部 JS、调用网络或读取凭据。原始日志外置，只输出有限原因码和证据引用，不复制令牌、项目内容或机器绝对路径。

### 5. 初始六条主线和证据边界

| 主线 | 初始映射来源 | 必须显式保留的缺口 |
| --- | --- | --- |
| 安装生命周期 | Lite INSTALLATION、公开 CPM change、CPM 现有 tests | 干净机器/公开候选回读、坏签名/升级/回滚的当前候选证据 |
| 基础编辑 | editor-stability inventory、managed-task-live、资源 runner | 两版原生注册、组件/代码矩阵、重开/引用/日志后验 |
| 设计到工程 | Pro UI Prefab tests、2.6 剩余项、设计包 tests | 受管成功历史、正向字段选择、最终包预览与跨入口实机；阶段三禁写不因本矩阵解除 |
| 字体与内容 | SDF、SnowB、AVM、Content Delivery、preview-capture 各包 | 原生产物可使用、依赖能力及平台差异，根 verify 不替代业务测试 |
| 账号权限 | Lite session/entitlement tests、Server 根与 Actor tests | 实际账号宿主/OIDC/PG/KMS、v1/raw 消费者接收、会话竞态及撤销 |
| 恢复连续使用 | Lite throughput/任务/安装恢复测试与现有长稳脚本 | 30 分钟正常＋10 分钟过载＋冷却的精确候选双版本结果 |

初始报告优先记录从当前可读取来源确认的事实。文档中 339/339 或旧长稳数字只能挂为 historical/unverified 引用，除非原始证据和相关输入已被合格适配器完整核验；不能手填新的通过数。

### 6. 最小实机链只生成计划

顺序固定为：候选包/来源身份 → 隔离工程及宿主版本 → CPM 安装 → ready/只读冒烟 → 一次可恢复的审批写入 → 保存/重开 → AssetDB/meta/引用/日志独立回读 → 本任务进程与资源清理。

计划引用 `verify-managed-task-live.mts`、INSTALLATION 和对应既有 task；脚本未覆盖的“保存重开”单独标记待定义步骤，不声称脚本已覆盖。每步记录 ownerRepo、requiredInputs、entryRef、readback、depends、onFailure、cleanupScope、budget。候选未冻结、无精确工程绑定、未获实际写权限时计划为 blocked；不自动创建授权或试跑。清理必须有已创建资源清单，may_have_changed 时保留诊断并先核验工程，不能自动重复写入或声称回滚。

3.8.3/3.8.7 分别形成计划与结果，实验版本只映射其声明的只读/拒绝边界。任何后续无头浏览器必须遵守 Chrome Dev 与独立用户目录规则；本工具不启动浏览器。独立 QA 消费矩阵但不由本变更改造 QA 引擎。

## Risks / Trade-offs

- [旧文档和主线描述不同步] → 固定实际来源摘要；文档只作线索，冲突显示为待核实，不静默选较乐观状态。
- [跨仓清单需要人工维护] → 明确 source-reviewed 的有限完整性与源文件摘要；漂移使审阅过期，报告保留缺口。
- [可读证据被误当可信证据] → 分离哈希存在性与原始判据验证，未知类型保持 unverified；负向测试证明伪造汇总不能通过。
- [新工具演变为庞大平台] → 仅离线输入、适配、校验、报告；禁止调度/执行/修复，采用依赖串行的一个实现工作树。
- [当前产品未验收导致工具无法收口] → 工具在如实报告缺口且通过合成负向验证后可完成；产品通过状态独立，不要求为了工具交付去修业务。

## Migration Plan

先固定输入契约和合成夹具，再实现独立分母与映射、证据状态、报告和 CLI，最后录入可核对的初始来源与六条主线并将计划接入报告。串行 DAG 为 1.1 → 1.2 → 2.1 → 2.2 → 3.1 → 3.2；共享 schema/数据/报告使并行无收益，不启用子代理。

实现验收：定向 `tsx --test tools/tests/pod-test-coverage-*.test.mts`；现有 `npm run test:tools`；按项目完整验证要求执行 Lite `npm run verify`，无发布包改动不额外 pack。原始命令/退出码保留，环境缺失不算通过。初始数据使用 validate/report 验证，check-acceptance 对真实未完成主线必须返回 2；另以完整合成证据验证退出 0，不能将其计入产品结果。整个实现验收不运行 Creator 或远程服务。

本轮规划验收为 OpenSpec strict、逐 task packet、精确差异与 scoped RAG；未改变产品输入不重跑产品测试。规划以 coordinated 交付：checkpoint owner 为本执行会话，integration owner 为唯一 Workspace 总管，实际 ID 与 Git 权限由设备登记绑定。后续每项任务需要对应写集和 preflight。撤回新增文件可回滚，无产品数据迁移、无生产部署；不修改或删除历史证据，不触发或核验 Actions。
