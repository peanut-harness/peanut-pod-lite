# Design

## Context

动机与五项范围见 [proposal.md](proposal.md)。代码研究基线是远端 `064759dc6b4ac624b538d0995c6a785c79d28c5c`。起草时本地 main 落后远端且有独立文档提交；按用户后续指令，提案提交前已通过合并同步该远端基线，并保留本地 AI Copilot 路线图提交。本 change 仅新增规划文件，未实施产品代码，也未重置或覆盖其他工作。

已观察到的入口：

- `packages/engine/modules/policy/src/core-cocos-mcp-tool-definition-catalog.ts`：41 个读取定义中仅 `asset.readText` 声明输出 schema；47 个写定义共用最小任务信封。
- `packages/engine/modules/kernel/src/mcp/mcp-capability-registry.ts`：仅在声明输出 schema 时校验。
- `packages/engine/modules/mcp/src/editor-mcp-builder-completion.ts`：30 秒内轮询唯一 native task；查询失败/超时返回 accepted；已有 Web 新鲜产物与 realpath 边界检查应保留。
- `packages/engine/modules/kernel/src/mcp/cocos-mcp-hub.ts`：token 认证的私有 action/NDJSON 协议，不是直接可用的标准 MCP Resources 服务。
- Creator 3.8.3、3.8.7 的 `builtin/scene/@types/cce/3d/manager/particle.d.ts` 有查询与五类控制，但控制存在选区组耦合；`modules/editor-extensions/extensions/reflection-probe/dist/scene/index.js` 有 start/cancel/query/clear 导出，clear 实际删除生成资产。这些是静态证据，不能代替公开契约或实机验收。

适用 Hub standards：`project/code-design.md`、`agent-tooling/spec-driven-delivery.md`、`agent-tooling/mcp-development.md`、`agent-tooling/security.md`、`workflows/cocos-api-compatibility.md` 及文本日志/进程归属规则。实现时再按修改语言读取对应规范。

## Goals / Non-Goals

2026-10-27 产品路线补充见 [能力与稳定性路线](../../../docs/PINK-COCOS-CLI-CAPABILITY-ROADMAP.md)。复核的 PinK 安装包保留 MCP 模块但关闭内置 endpoint；原生工具的场景绑定、revision、草稿保护和领域生命周期仅作为设计参考，不据此推导 Creator 旧版接口可用。

当前仅为 `asset.readText` 配置具体读取输出 schema 的源码事实与 A1 一致；2.4、3.0–3.5 尚无画像中的已验证/写入开放版本，UI Prefab 当前阶段一禁止工程生成，现有最小工程样本不代替产品矩阵。跨版本样板、统一在线/文件编辑上下文和动画会话均需独立规划。本 change 不增加这些实现，也不以产品阶段排序删减 A3–A5。

**Goals:** 复用当前依赖方向和受管任务体系，实现具体输出校验、可持续查询的原生工作，以及精确版本门控的实时能力；将标准协议转换与业务执行分离。

**Non-Goals:** 不新增通用 eval/任意 message 代理，不修改 Creator 安装包；首轮粒子仅覆盖已有静态依据的 3D ParticleSystem，不把 2D 粒子资产离线编辑算作实时控制；不改变已有只读资产内容边界。完整非目标见 proposal。

## Decisions

### D1 — 以操作为单位定义输出契约（P1 / A1）

在 policy 增加输出 schema 目录，工具目录按 operation 汇入；共用安全的小型业务结构允许复用，但不通过任意对象或 `additionalProperties: true` 单独充当整个契约。保留 `asset.readText` 的既有严格契约，逐项对照 gateway 的合法、空值、降级和不可用返回。

校验对象是现有 registry 的业务 result，协议外层 `ok/result/failure` 不再嵌套一层。标准适配层将相同业务对象作为结构化内容，文本仅提供一致摘要。输出校验异常经过现有 failure presenter，包含错误码和安全字段路径，不能附上原始结果、文件内容或 token。写任务信封必须扩展实际非终态枚举及 `pending` 分支，避免长任务新契约被最小 schema 拒绝。

替代方案：只补工具描述不能检查真实返回；所有工具共享任意对象 schema 无法发现字段退化，因此不采用。

### D2 — 原生工作附着于既有任务（P1 / A2）

由 runtime 的任务控制保存有界 native association，绑定受管 taskId、owner、project、operation、native id、开始时间、平台、最后观测时间与安全摘要。原生 id 与受管 id 明确分离；外部不得仅凭 native id 查询或取消。

数据流为：输入/审批 → 受管 admission → writer → 单次原生提交 → 记录关联 → 有界查询 → 原生终态 → 产物与唯一 postflight → 发布终态/证据。继续复用原有幂等摘要、队列、资源闭包、owner 和保留机制，不建第二套调度器。构建和烘焙属于工程全局状态，不能自动微合批；原生工作未到安全边界前仍占有对应冲突保护，task control 查询不排在 project writer 后面。

区分三个时间：同步等待预算沿用基线 30 秒；原生观测单次 deadline 有界；总跟踪期限集中配置，默认 30 分钟，轮询间隔默认 500ms，均有单位、合法范围、上限及停用清理。HTTP 等待耗尽返回 `taskId`、实际 `taskStatus`、`pending=true`、安全 native 摘要和 `recommendedNext=task.status`；这是非完成响应，不得触发成功 postflight 或客户端重提。显式 async 仍可在 admission 后返回 queued。

暂时查询异常保留最后状态并标记观测失效；跟踪总期限到达则以稳定 `native_completion_unconfirmed` 原因结束自动观测、项目状态保持保守，并将该工程置于有界的冲突保护状态。只有确认原生工作终止或经过人工核实，才解除相关 writer 阻挡。不能通过回收内存记录假装工程安全；保护记录最多每工程一份，新冲突工作失败关闭。宿主重启后没有恢复证明则报告未知，不自动重建原生任务。

成功继续要求原生 id 匹配、原生 state/stage、平台与本次产物匹配。首轮产物规则保持 Web desktop/mobile，拒绝旧产物、空文件、符号链接逃逸和无规则平台。取消复用 task.cancel：安全排队阶段按既有取消；已原生受理时只有版本适配明确支持且当前安全阶段允许，才能发送取消并等待确认；既有不可逆 commit 窗口仍拒绝取消。此设计不承诺当前 Creator builder 必然提供可用取消接口。

替代方案：延长一个 HTTP timeout 仍不能覆盖断连；将 accepted 当成完成会损坏成功语义；两者均不采用。

### D3 — 显式目标和版本适配（P2 / A3）

新增 `particle.queryState({nodeUuid, componentId})` 和 `particle.control({nodeUuid, componentId, action, speed?})`。仅 setSpeed 接受必填有限非负速度，最大值来自能力配置；其他动作携带 speed 为非法输入。查询结果包含目标、速度、时间、计数、播放状态和逐字段可用性。控制是本地审批的实时写，复用受管任务及精确目标/动作资源摘要，成功由动作对应状态读回和增量日志验证，不报告资产已保存。

creator-38 的 scene 适配优先按 UUID/组件身份解析目标并调用已核实的 ParticleSystem 公共能力；若某版本必须使用选区耦合的 ParticleManager，执行前必须证明其完整实际作用组与审批目标集合一致，且在同一受控窗口校验场景/选区 revision；不能证明便在调用前拒绝，不自动切选区或扩大目标。状态查询只读取，不以 play/stop 等动作探测可用性。

新增写路径初始关闭；两个精确版本分别在隔离工程完成能力矩阵后才能逐版开放。不把既有版本整体验收自动继承为新能力验收。

替代方案：直接调用内部全局 play() 会让当前选区决定操作目标，不满足外部契约。

### D4 — 烘焙和清理具有不同资源闭包（P2 / A4）

业务操作固定为 `reflectionProbe.startBake({probeUuids})`、`queryBake({taskId})`、`cancelBake({taskId, probeUuids?})`、`clearResults({probeUuids})`。数组去重、非空并有配置上限；start/cancel/clear 为写，query 为读。query/cancel 通过受管 taskId 检查 owner，再映射到原生任务/探针，不接受全局 cancel-all。

通过 creator-38 已授权的固定 scene-script 适配白名单连接内部 start-bake/query-bake-info/cancel-bake/clear-results，不向调用方暴露任意脚本名。烘焙复用 D2 的关联，返回 remaining/current/finished 的安全归一化值和逐目标结果；以实际生成资源及探针绑定核实成功。一次全局原生烘焙窗口内无法区分归属时，其他 owner 的启动被串行等待或拒绝，不能取消别人的工作。

清理是 destructive：规划时解析探针绑定、所有待删除生成资产和受影响引用闭包，摘要与审批绑定；执行前重新核对，变化则重新审批。原生 clear-results 只有在能够证明实际影响完全包含于授权集合时才允许调用；否则拒绝。清理后逐资产 AssetDB/绑定读回，并列出部分失败，不承诺全量事务回滚。用户原始素材不属于生成物。

替代方案：统一使用全局 clear/cancel 简化实现会扩大删除或取消范围，不能采用。

### D5 — 本仓拥有薄标准协议入口（P2 / A5）

仓内未找到可直接扩展的标准 MCP Bridge，因此新增 kernel 标准协议 adapter，在同一受控 loopback HTTP listener 上使用独立 `/mcp/standard` 路径，默认关闭；原 `/mcp` 私有 action/NDJSON 不变。使用固定版本官方 MCP SDK，依赖/锁文件由协调 owner 串行维护，不手写整套协议。标准入口支持 SDK 初始化、ping、tools/list、tools/call，以及 resources 三个方法；工具调用转发既有 registry，不实现第二套执行权限。禁止把现有私有地址直接作为标准客户端 URL。

标准入口沿用受信凭据渠道、loopback/Origin 校验及容量配置；认证先于业务调度，服务端分配会话并绑定 connectionId/project，忽略或拒绝输入中的伪造 owner。会话终止不能删除尚在执行的原生工作证据。客户端配置片段只有显式选择标准入口时才生成新 URL，token 不写入文档、URI、源码或日志。

初始资源为：`peanut://docs/editor-mcp`（声明的使用文档），`peanut://assets/types`（授权工程资产类型），模板 `peanut://assets/{type}{?cursor,limit,revision}`（按类型分页查询）与 `peanut://asset/{uuid}`（资产元信息）。`types` 是保留入口，不能作为任意类型名覆盖它。URI 不接受任意磁盘路径，不默认返回源码、原始资产正文或完整日志。固定文档用打包 allowlist；资产数据调用现有 asset catalog，不新增索引器。

资源列表使用标准 cursor；单个类型资源的文本 JSON 载荷包含 revision、items 和 nextCursor，续读参数来自同一模板的声明参数。默认每页 100 条、硬上限 200 条、每次内容 256KiB；配置非法则启动失败。游标由服务端管理或校验，绑定 owner/project/type/revision/有效期，过期、篡改和 revision 变化稳定失败；响应超字节预算明确失败，不静默截断。资源自身是只读的，不能通过 URI 隐式执行工具或文件写入。

协议使用 SDK 的版本协商和 Streamable HTTP，不把 NDJSON 作为标准传输。初始化声明 `resources: {}`；首轮不宣告订阅或资源变更通知。POST 按标准处理 JSON-RPC；GET 由 SDK 返回允许的 SSE 或 405，不额外建设旧版 HTTP+SSE 双端点。HTTP 断开不等同显式取消，连接/会话和任务 owner 的关系遵循 D2。以上协议行为以官方 Resources 和 Transport 规范为依据，并由标准客户端验收。

替代方案：在私有 Hub 增添同名 action 不能证明标准 MCP 兼容；复制 CLI 全量资产模板会突破容量预算，均不采用。

### D6 — 目录兼容与现有活动 change 收敛

本变更只新增两个粒子和四个反射探针业务操作；相对研究基线，候选预期 94 项（43 读 / 51 写），具体目录以实施基线和生成清单核验。Resources 与 task controls 不计入业务 operation。禁止通过固定 83/84/88 的历史断言阻止新增，且不得删除任何基线映射。

`stabilize-editor-operations-and-bulk-file-io` 已修改同名默认同步 requirement，本 change 的完整 delta 保留其 `asset.readText` 和控制入口不计业务数的语义，再加入增量目录与 pending 原生任务。实施首任务与最后归档前均检查该 requirement；协调 owner 在依赖 change 后归档本 change并合并语义，不修改别的活动 change 或擅自标记其任务完成。代码基线须继承实施时已核实的最新远端并保留本地独立文档提交，不能在落后分支直接实施。

### D7 — DAG、所有权和交付边界

本次 proposal/specs/design/tasks 都由当前协调 owner 串行编辑。未来实施任务 DAG 为 `1.1 → 1.2 → 2.1 → 2.2 → 3.1 → 3.2 → 4.1 → 4.2 → 5.1 → 5.2 → 6.1 → 6.2`。P1 为 2.1/2.2，P2 为 3–5；6 为组合验收。共享可变对象包括 protocol/sdk schema、policy 目录/工具名/吞吐画像、manifest/版本生成物、kernel 路由与配置、runtime 任务控制、Creator 场景进程和 Git index，因此本计划全部标记 serial，不声明虚假的独立 parallel lane。

实施默认 coordinated；`gitOwner=pod-lite-coordinator`、`integrationOwner=pod-lite-coordinator`。规划范围为本 change 文件和只读校验；用户后续已单独授权同步远端到本地并提交提案，该授权不启动 apply、安装新依赖、启动宿主或发布产品。进入 apply 后先按 task packet 核实专用 worktree/分支、所有权和允许动作，再实施。完成最终集成才适用既有 remote-verified 交付要求；本轮不宣称已实施或已远端交付。

## Validation

本轮只运行 `openspec validate align-editor-mcp-capabilities-with-pink --strict`、任务 DAG/引用检查与限定文件差异检查，不运行产品构建或实机操作。

未来实施的自动化验收以当前 package scripts 为准：受影响 protocol/sdk/Engine 模块的 typecheck/test，随后 `npm run verify`；新的行为测试必须加入对应包的显式 test 列表，不能写了测试但默认不执行。每次按 task id 记录 canonical command、候选 tree、平台、配置和退出码；只有这些全部匹配才复用既有证据。

实机采用同一候选的两个隔离工程，按 Creator 3.8.3 后 3.8.7 串行运行，保留以下实际结果：

- A1：全部读取工具完整 schema 覆盖，合法/空/不可用/畸形结果矩阵，旧消费者回归。
- A2：超过 30 秒的真实 Web 构建续查，原生提交一次；新鲜/陈旧/逃逸产物，跨 owner、取消不支持/过晚、暂时失联、容量和期限故障注入。
- A3：六类业务语义、两个不同粒子目标、选区竞态、非法速度、无审批和错误版本；动作读回不能用任意延时后单个偶然值代替。
- A4：单个及多个探针，队列、部分失败、所有者取消、跨 owner 拒绝；清理前后 UUID/绑定/文件身份和原始素材保持性；清理闭包变化拒绝。
- A5：官方 SDK 客户端以打包候选完成初始化、tools/list/call 兼容及 Resources 三方法；多页、revision 失效、超字节、伪造 owner、URI 逃逸、工程关闭、资源零写入和旧私有入口回归。

成功操作要求原始增量日志无新增 error/warn；必要的非法请求拒绝有独立预期，不通过新增日志过滤伪造成功。证据摘要提交时只含候选身份、版本、用例、退出码与安全资源摘要；本机安装路径、日志全文、凭据及测试工程内容保存在外部 QA 归档，不写入产品仓。两个版本任一用例缺证即标记未验收，不开放该版本的新写能力。

## Risks / Trade-offs

- [内部适配可能与静态声明不同] → 仅支持两个精确版本并逐能力门控；真实场景不满足显式目标契约时拒绝，不降低验收标准。
- [长任务占用工程写窗口] → 只读控制面保持响应，禁止冲突写入；期限耗尽保留保守保护，不强杀进程换取吞吐。
- [严格输出校验暴露历史畸形返回] → 合法返回夹具先冻结，再逐项修复；不能以放宽成任意对象掩盖错误。
- [生成物清理范围大于调用目标] → 预先计算实际闭包，破坏性审批后再次核对，无法证明时拒绝。
- [标准入口增加协议攻击面] → 默认关闭、同 listener 独立路径、官方 SDK、受信会话身份与原有容量门禁；不暴露公网或新通用调用能力。
- [基线漂移与活动 delta 重叠] → 提案提交前已合入研究远端；实施时仍复核最新远端，归档前由唯一 owner 合并 requirement。

## Migration Plan

1. 审阅批准本 change 后，进入 apply 并核实最新远端/实施 owner；保留当前本地独立提交，建立或复用合规的实施工作区。
2. 串行完成共享契约与 P1 验收，再实现 P2；新增写路径与标准入口初始关闭，旧私有客户端继续使用原地址。
3. 同一候选在两个精确 Creator 版本完成自动化及实机组合验收后，按版本能力画像开放新增写路径；标准入口由配置显式启用。
4. 回退先停止新增受理，排空或核实原生工作，再关闭新入口/能力并回退包；不删除用户生成物或改写工程作为自动回滚步骤。未确认原生工作保持显式阻塞与人工核实指引。
5. 全部证据、知识同步及普通远端交付通过后才 archive；本轮只交付待审阅提案，不执行上述步骤。

## References

- [官方 CLI 粒子接口](https://github.com/cocos/cocos-cli/blob/e683ccc80479aeda84365121f7bb5597f456c38f/src/api/scene/particle.ts)
- [官方 CLI 反射探针接口](https://github.com/cocos/cocos-cli/blob/e683ccc80479aeda84365121f7bb5597f456c38f/src/api/scene/reflection-probe.ts)
- [官方 CLI MCP middleware](https://github.com/cocos/cocos-cli/blob/e683ccc80479aeda84365121f7bb5597f456c38f/src/mcp/mcp.middleware.ts)
- [Creator 3.8 ParticleSystem API](https://docs.cocos.com/creator/3.8/api/en/class/ParticleSystem)
- [Creator 3.8 反射探针](https://docs.cocos.com/creator/3.8/manual/en/concepts/scene/light/probe/reflection-probe.html)
- [MCP Resources 协议基线](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Streamable HTTP 协议基线](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)

上述源码/文档用于解释研究来源，不把当前网页更新、Cocos 4 API 或内部安装包接口视为 Creator 3.8 的跨版本稳定承诺。
