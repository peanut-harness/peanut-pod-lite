# Tasks

## 1. 契约与覆盖基线

- [x] 1.1 `[peanut-pod-lite:packages/protocol/**,packages/engine/modules/policy/**,packages/engine/modules/mcp/src/editor-mcp-capability-catalog.ts,packages/engine/modules/mcp/src/editor-mcp-tool-catalog.ts,packages/engine/modules/mcp/tests/** | serial | depends:none | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Text file calls are bounded and project confined,mcp-write-task-execution#Default synchronous behavior remains compatible | non-goals:不实现文件执行器、不改变原版写权限、不修改原工程或旧实机证据、不发布]` 定义批量读写 DTO、容量配置、逐文件 outcome 和可选 `expectedSha256`，更新 policy/schema/工具映射及 profile 为原 83 项加 `asset.readText`；依赖：方案确认与实现登记；验收：目录一致性、旧工具映射、schema 和 Node 14 宿主兼容测试通过。
- [x] 1.2 `[peanut-pod-lite:tools/editor-stability/**,tools/tests/editor-stability*.test.mts,tests/fixtures/editor-stability/coverage/** | serial | depends:1.1 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:editor-operation-stability#Coverage is exhaustive and version specific | non-goals:不运行Creator或修改安装包、不改产品schema、不实现4.1/4.2夹具、不改原工程与旧证据、不pack或发布、不把源码声明和文件存在当运行时可用]` 建立版本化 coverage manifest 生成器与严格校验器，对照实际 Creator importer/组件、38 类独立资产、Prefab/Scene 和公开 operation；依赖：1.1；验收：新增目录项、缺夹具、跳过、重复用例和无依据不适用均被拒绝，分母与原生差异可查。

## 2. 生命周期与原始日志

- [ ] 2.1 建立命名有效的隔离夹具和 raw 日志阶段 validator，覆盖 stdout/stderr、project.log、启动、操作、冷却、退出及延迟诊断；依赖：1.2 与实机登记；验收：合成 warning/error 注入使对应阶段失败，旧报告原始 bytes 与摘要不变。
- [ ] 2.2 顺序复现 3.8.7 不带 Lite / 带 Lite 的最小工程正常退出，按证据修复扩展卸载或支持的退出顺序；依赖：2.1；验收：命名警告与 `Object has been destroyed` 均消失，保留失败与修复后的原始文本、PID 和退出证据；无法消除时保持本项未完成。

## 3. 多文件读取与写入

- [x] 3.1 `[peanut-pod-lite:packages/engine/modules/assets/src/text-file-io-guard.ts,packages/engine/modules/assets/src/index.ts,packages/engine/modules/assets/tests/text-file-io-guard.test.ts,packages/engine/modules/kernel/src/mcp/mcp-capability-registry.ts,packages/engine/modules/kernel/tests/mcp-capability-registry.test.ts | serial | depends:1.1 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Text file calls are bounded and project confined | non-goals:只实现离线路径字节UTF8guard和Kernel关键词校验，不接文件执行器或writer、不改旧审批、不运行Creator、不改原工程旧报告、不pack或发布]` 实现资产根 realpath/symlink 校验、重复物理目标检查及文件数/单文件/输入输出字节预算；依赖：1.1；owned paths：assets 的新增文本 I/O guard 与独立测试；验收：穿越、大小写别名、symlink、非法 UTF-8、二进制、32/33 文件和正文边界测试通过，拒绝前后文件摘要相同。
- [x] 3.2 `[peanut-pod-lite:packages/sdk/src/plugin-module-contracts.ts,packages/protocol/src/mcp/mcp-capability-contracts.ts,packages/engine/modules/assets/src/text-file-io-guard.ts,packages/engine/modules/assets/tests/text-file-io-guard.test.ts,packages/engine/modules/kernel/src/mcp/cocos-mcp-hub.ts,packages/engine/modules/kernel/src/mcp/mcp-hub-control.ts,packages/engine/modules/kernel/src/mcp/mcp-task-control.ts,packages/engine/modules/kernel/src/mcp/mcp-capability-registry.ts,packages/engine/modules/kernel/tests/cocos-mcp-hub.test.ts,packages/engine/modules/kernel/tests/mcp-capability-registry.test.ts,packages/engine/modules/policy/src/core-cocos-mcp-execution-dispatcher.ts,packages/engine/modules/policy/src/core-cocos-mcp-read-tool-schema-catalog.ts,packages/engine/modules/policy/src/core-mcp-input-validator.ts,packages/engine/modules/policy/src/core-text-file-io-contract.ts,packages/engine/modules/policy/tests/text-file-io-contract.test.mts,packages/engine/modules/policy/tests/execution-dispatcher.test.mts,packages/engine/modules/mcp/src/editor-mcp-text-read-gateway.ts,packages/engine/modules/mcp/src/editor-mcp-action-router.ts,packages/engine/modules/mcp/src/editor-mcp-plugin-module.ts,packages/engine/modules/mcp/src/editor-mcp-gateway-factory.ts,packages/engine/modules/mcp/tests/editor-mcp-text-read-gateway.test.mts,packages/engine/modules/mcp/tests/editor-mcp-host-integration.test.mjs,packages/engine/modules/mcp/tests/editor-mcp-plugin.test.mjs,packages/engine/modules/mcp/package.json,packages/hosts/modules/creator-38/src/main.js,packages/hosts/modules/creator-38/tests/text-read-bridge.test.mts,packages/hosts/modules/creator-38/package.json | serial | depends:3.1 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Bulk reads preserve content and expose consistency | non-goals:仅实现真实一致性读入口及必要writer共享锁和宿主revision装配，不重构3.3写事务或3.5保留幂等策略、不改审批授权和Runtime调度算法、不运行Creator、不改原工程旧报告、不pack或发布]` 实现 `asset.readText` 单文件/多文件内容读回、writer 屏障、资源互斥、revision/文件快照与有界冲突；依赖：3.1；验收：BOM、CRLF、Unicode、空文件、缺文件逐项结果、跨 revision 写入及外部编辑测试通过，不返回混合快照或截断内容。
- [x] 3.3 `[peanut-pod-lite:packages/engine/modules/assets/src/text-file-io-guard.ts,packages/engine/modules/assets/tests/text-file-io-guard.test.ts,packages/engine/modules/mcp/src/editor-mcp-silent-asset-gateway.ts,packages/engine/modules/mcp/src/editor-mcp-text-write-gateway.ts,packages/engine/modules/mcp/src/editor-mcp-action-router.ts,packages/engine/modules/mcp/src/resource-operation-planner.ts,packages/engine/modules/mcp/tests/editor-mcp-text-write-gateway.test.mts,packages/engine/modules/mcp/tests/editor-mcp-write-safety-matrix.test.mjs,packages/engine/modules/mcp/tests/editor-mcp-host-integration.test.mjs,packages/engine/modules/mcp/package.json,packages/engine/modules/kernel/src/mcp/mcp-hub-control.ts,packages/engine/modules/kernel/tests/cocos-mcp-hub.test.ts,packages/engine/modules/policy/src/core-text-file-io-contract.ts,packages/engine/modules/policy/tests/text-file-io-contract.test.mts,packages/engine/modules/mcp/src/resource-operation-contracts.ts,packages/engine/modules/mcp/src/resource-operation-task-executor.ts,packages/engine/modules/mcp/src/editor-mcp-plugin-module.ts,packages/engine/modules/mcp/src/editor-mcp-gateway-factory.ts,packages/engine/modules/mcp/tests/resource-operation-task-executor.test.mts | serial | depends:3.1,3.2 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Text file calls are bounded and project confined,bulk-text-file-io#Bulk writes validate all work before mutation | non-goals:仅实现写入前全批准备与唯一writer内重验及真实请求容量，不实现3.4逐文件后验或部分失败、不重设计3.5幂等保留取消或审批调度、不运行Creator或改原工程旧证据、不pack发布、不改依赖版本]` 重构 `asset.writeText` 为保留 `expectedSha256` 的不可变全批准备，进入既有唯一 writer 后在第一项变化前重验全部路径、物理身份与期望摘要，保持 `files` 优先及旧单文件/files 成功字段；依赖：3.1、3.2；验收：公开入口最后一项路径/摘要/权限/容量无效、排队时外部内容或物理目标变化、`absent` 冲突及无审批均在第一项变化前整批 unchanged，目录/meta/探针/暂存和范围外文件摘要不变；symlink、硬链接或物理别名、大小写重复、非法类型、32/33 文件、1MiB 与完整编码4MiB（含控制字段与Unicode转义）边界、获批 HTTP 分块及 Creator Host 离线路由验证通过，其它128KiB限制保持；真实单writer共享资源闭包和旧UUID/新AssetDB语义、已验收A1回归与原始探针通过。
- [ ] 3.4 `[peanut-pod-lite:packages/engine/modules/assets/src/text-file-io-guard.ts,packages/engine/modules/assets/tests/text-file-io-guard.test.ts,packages/engine/modules/mcp/src/editor-mcp-text-write-outcome.ts,packages/engine/modules/mcp/src/editor-mcp-text-write-gateway.ts,packages/engine/modules/mcp/src/editor-mcp-silent-asset-gateway.ts,packages/engine/modules/mcp/src/editor-mcp-asset-db-transaction.ts,packages/engine/modules/mcp/src/editor-mcp-action-router.ts,packages/engine/modules/mcp/src/resource-operation-contracts.ts,packages/engine/modules/mcp/src/resource-operation-task-executor.ts,packages/engine/modules/mcp/src/editor-mcp-plugin-module.ts,packages/engine/modules/mcp/src/editor-mcp-gateway-factory.ts,packages/engine/modules/mcp/tests/editor-mcp-text-write-outcome.test.mts,packages/engine/modules/mcp/tests/editor-mcp-text-write-gateway.test.mts,packages/engine/modules/mcp/tests/editor-mcp-asset-db-transaction.test.mts,packages/engine/modules/mcp/tests/resource-operation-task-executor.test.mts,packages/engine/modules/mcp/tests/editor-mcp-write-safety-matrix.test.mjs,packages/engine/modules/mcp/tests/editor-mcp-host-integration.test.mjs,packages/engine/modules/mcp/package.json,packages/protocol/src/mcp/mcp-capability-contracts.ts,packages/protocol/src/mcp/text-file-io-contracts.ts,packages/protocol/src/index.ts,packages/protocol/tests/contracts-text-file-io.test.ts,packages/engine/modules/runtime/src/execution/execution-runtime-service.ts,packages/engine/modules/runtime/tests/execution-runtime.test.ts,packages/engine/modules/kernel/src/mcp/mcp-failure-presenter.ts,packages/engine/modules/kernel/tests/cocos-mcp-hub.test.ts | serial | depends:3.3 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Every written file has an authoritative outcome,bulk-text-file-io#Bulk writes validate all work before mutation,bulk-text-file-io#Text file calls are bounded and project confined | non-goals:仅逐文件真实读回与UUID/meta后验及保守部分失败，复用唯一writer和原日志postflight；不重设计3.5审批admission幂等owner保留取消或AI规则，不改调度器和日志过滤、不运行Creator或改原工程旧证据、不pack发布Git知识或依赖版本；共享协议RuntimeKernel须总管另行精确实施登记]` 增加逐文件内容摘要、UUID/meta 后验、兼容结果字段和保守部分失败结果；依赖：3.3；验收：第 N 项提交和最终后验故障注入准确区分已写/待核实/未执行，不能误报整批成功或无证据回滚。
- [ ] 3.5 将批量读写接入原有 admission、幂等、取消、结果保留和 owner 安全规则，并更新 AI 成功判据；依赖：3.2、3.4；验收：重试不重复写、异连接不可见、取消前零写入、控制面保留容量、结果和证据字节有界，旧单文件/files 用法兼容测试通过。

## 4. 资源全类型夹具与矩阵

- [ ] 4.1 为序列化资产、动画、地形、渲染和层次资源补合法最小夹具、Inspector patch 和语义读回规则；依赖：1.2；候选 lane `fixtures-serialized`，仅拥有 `tests/fixtures/editor-stability/serialized/**`；验收：所有对应 manifest 行都有夹具/依赖/回读，无占位无效资源。
- [ ] 4.2 为图片、模型、音视频、字体、图集、骨骼、地图、Bundle 和其它原生 importer 补合法夹具与依赖；依赖：1.2；候选 lane `fixtures-media`，仅拥有 `tests/fixtures/editor-stability/media/**`；验收：夹具合法性、原生目录差异和引用闭包审查通过，不用伪二进制宣称可导入。
- [ ] 4.3 实现 manifest 驱动的资源生命周期/Inspector 实机 runner 与证据 validator；依赖：2.1、4.1、4.2；owned paths：creator-38 的新增 resource stability 脚本；验收：适用 create/import/read/patch/copy/move/rename/refresh/delete 全部可追溯，UUID 保持、引用/登记/日志检查失败均阻止通过。

## 5. 组件与代码矩阵

- [ ] 5.1 为版本化组件目录生成真实依赖装配、公开字段值和引用夹具，覆盖全部适用字段类型及增删改保存重开；依赖：1.2、4.1、4.2；验收：99 项策展目录与实际版本差异可查，依赖组件、物理/UI/动画后端有效，缺字段用例使覆盖校验失败。
- [ ] 5.2 增加 TypeScript/JavaScript 单文件和跨文件模块、组件字段与引用变更的代码夹具及实际 Creator 编译/预览就绪探针；依赖：3.5、5.1；验收：文本读回、脚本 UUID、真实编译、原生组件绑定、预览加载均检查，故障注入和有效零日志 campaign 分开记录。
- [ ] 5.3 将组件/代码矩阵与资源 runner、raw 日志和 coverage validator 集成，修复全部实际发现的操作错误；依赖：2.2、4.3、5.1、5.2；验收：离线定向回归和实机定向分片零缺口、零非预期失败；影响共享 schema 的修复由 checkpoint owner 串行审阅。

## 6. 新候选与双版本最终验收

- [ ] 6.1 在最终 tree 执行实际根工作区定向检查、生成/构建、Core prerequisite pack、canonical verify 和 pack，核对新 Host/Core/descriptor 身份；依赖：3.5、5.3；验收：所有命令 exit 0、结构/类型/兼容/测试通过，必要产物顺序和新摘要有证据，不复用旧 669 测试作为新结果。
- [ ] 6.2 Creator 3.8.7 在新隔离副本安装同一候选，顺序执行全量资源/组件/代码矩阵、至少 100 文件有界批读写、30m 常规＋10m 超载＋冷却及正常退出；依赖：6.1 与实机登记；验收：coverage 零遗漏、原始各阶段 warning/error 零新增、非预期失败和残留为零，control P95 ≤1s，身份和引用全部通过。
- [ ] 6.3 Creator 3.8.3 在另一新隔离副本执行同样完整验收；依赖：6.2 完成并关闭所属实例；验收：同候选摘要、精确版本及 6.2 同等级门槛全部通过；不把另一版结果当本版证据。
- [ ] 6.4 独立回读两版报告、raw 日志、覆盖分母、逐文件结果与原工程基线，形成完整验收摘要；依赖：6.2、6.3；验收：所有统计能从原始证据重算，旧报告保留，原工程未改，未通过项不能打勾。

## 7. 知识与交付

- [ ] 7.1 更新批量用法、限制迁移、版本支持与验收文档及所属知识卡，执行 scoped build/check-sync 并保存 sync；依赖：6.4；验收：知识与实际源码/新制品一致，无 raw 日志、凭据、本机路径或 `.rag/` 进入提交范围。
- [ ] 7.2 checkpoint owner 在授权 Git 范围内提交同一验收 tree，交由 integration owner 集成与远端回读；依赖：7.1 与明确 checkpoint/集成登记；验收：checkpoint、目标分支 tree、远端回读 receipt 可核对，仅 remote-verified 才标代码交付完成。

## 8. Execution Notes

任务 1.1、1.2、3.1 与 3.2 已通过各自离线验收，其余实现任务未完成。3.2 已装配 SDK 调用上下文、真实 Hub revision/writer 屏障、与 managed executor 相同资源锁、完整逐项失败结果及传输输出校验；A1 修复观察异常及终态任务复用遗留屏障，并限制早到终态缓存仅存在于真实 managed receipt 窗口。源 223 项定向回归与 4 项原始探针通过，总管独立复测 46 项和同一 4 项探针通过（存在覆盖重叠，不相加为独立用例数）。原始失败证据保留；31 项既有 Kernel 测试严格类型诊断未变化，无新增租约类型错误。Node25 执行与 ES2017 构建不代表 Node14 或新 Creator 实机验证。实施前逐 task id 发包，声明依赖、owned paths、非目标和验收。4.1/4.2 可在 1.2 完成、夹具格式确认、宿主可用且路径无重叠后评估临时子 Agent；共享目录/schema、runner、构建、Git、知识、Creator 实机和性能测量保持串行。上述候选 lane 不是已经执行或批准的并行登记。

任务 6.1 发包必须纳入 `tools/release-identity.mts` 与 `tools/tests/release-identity.test.mts`，将当前硬编码旧 83/38 profile 身份对齐新源码 84/39/45；该后续修正尚未开放，旧包、旧实机报告及摘要保留。

### 任务 3.2 发包边界

任务 3.1 的 c48c35a 精确八文件本地检查点已经总管核验，旧实机报告和两份发布包未改。3.2 原 26 路径与 A1 追加的 mcp-task-control.ts 共 27 个实现边界已串行验收；metadata 与精确 checkpoint 由总管另行登记，未获远端完成凭据。真实 Hub 与 Creator main.js 直连必须共用受信工程 revision/writer 屏障，SDK 与 Core request 上下文仅由宿主装配，两种 MCP plugin/factory 都转发；不得从业务参数注入或以目录 revision/本地计数器替代。Router reader 必须与已有同步/managed writer 使用同一个 ResourceLockManager，canonical project/physical keys 全批原子取得并在所有出口释放。只读结果同时复核真实 revision 和所有文件身份/摘要/时间，外部修改采用有界重读或明确冲突，禁止混合内容或截断。

输出使用既有 TextFileReadOutcome 与 number|null revision DTO；Core 与 Kernel schema 必须支持真实逐项 failed 分支及必要 nullable JSON 类型，保留旧 schema/审批语义并限制预算。缺文件、不可读、非法文件等逐项错误不含该项内容，overall ok=false；一致性无法证明则 consistent=false，真实 revision 不可得则 fail closed，绝不伪造 revision=0。请求级穿越/别名/容量或权限失败可整体拒绝；部分结果须在实际公开目录及 registry 校验后完整到达调用方，不可被 presenter 掩盖成 output_schema_invalid。

真实 Hub 管理写/终态屏障、Creator 直连、plugin 与 factory、相同资源锁等待/取消释放、BOM/CRLF/Unicode/空文件/缺文件/非法编码、外部编辑与重复冲突、JSON 内容转义/失败结构和完整响应预算均需验证。新增 reader 可用受控临时工程及源内存 bundle 测试，不修改旧双版本报告或 release 档案。两份 package.json 仅追加新测试入口，既有 pack/依赖/版本保持。Assets guard 仅补必要只读批次校验/快照接口，保留 3.1 无副作用与零 hook 保证；不重写 write 准备。后续任务、Git、Creator 与 pack 均未发包。


### 任务 3.3 发包边界

A1 本地检查点 72899da 的 parent、tree、精确 27 文件及 1023 当前源码哈希已由总管核验，仍不是 remote-verified。3.3 仅属 A2 的写入前检查（R02、R03、R04 的 pre-mutation 部分、R05）；3.4 的逐项后验/部分失败和 3.5 的保留/所有权各自独立，保持未完成。本节和任务注解是规划候选，具体实现仍须绑定独立通过的任务包并重新登记，不开放 Git、知识、生成或实机权限。

以现有 TextFileIoGuard 和产品容量来源为基础，首次准备必须在任何目录、meta、探针和内容变化前完成 schema、内容字节、全批路径/身份/别名、可写权限、风险与审批资源检查，保留每项合法的 64 位摘要或 absent；提供 files 时忽略单文件业务字段，但完整请求的所有字段仍计入编码预算。准备结果及排队前原始物理身份只供当前调用，作为可信内部不可变计划载荷沿既有 executor 的 execute/executeBatch、Plugin 与 Gateway factory 两处 managed 装配传递到实际 Router/写入口；不作为调用方业务 input、WeakMap/持久缓存、共享指标、任务证据或结果载荷，不新增调度器。取得既有 ResourceLockManager 的唯一 writer 与完整资源集合后，在第一项变化前重验全批原始物理身份、真实目标/审批资源及可选前置条件，不能重新准备基线代替核对排队前身份；随后进入原有 commit 窗口和静默 AssetDB 写入流程，不能只在最后一项即将提交时才校验。

准备与重验失败均保留原有稳定错误并可证明 unchanged，测试需对整个隔离工程（目录、meta、探针、暂存）和范围外哨兵做前后快照。真实请求上限对齐声明的4MiB，仅公开文本读写调用可使用，其它请求维持原128KiB边界；宿主路径复用相同校验来源。成功场景验证单文件/files优先、省略前置条件、BOM/CRLF/Unicode/空文本、旧结果字段及UUID/新建AssetDB身份。已有A1的reader、共享锁及实际任务终态回归须保持通过；Node25离线执行和ES2017构建不代表Node14或Creator实机验收。若传递调用局部准备信息等确需额外路径，先向总管提交精确路径与理由并扩展登记，不能自行越界实现。


### 任务 3.4 精确规划边界

总管独立复核 dc3cdfdbc7dcfb67fb19df7e14d874beca67b31606c7dadb520bbae7fda65707 已验收任务3.3的写入前全批准备与唯一writer内重验，本轮仅据此标记3.3完成；257项源码离线回归与原4项A1探针单独计数，31项既有Kernel严格类型诊断保持，Node25/ES2017不等于Node14或Creator实机。上文旧Execution Notes及3.3规划段保留为历史，3.4/3.5、15个原生绑定unknown和四项原始实机发现仍开放，整体目标与remote-verified未完成。

3.4新增26路径serial规划注解，具体实施、5个必要dist构建与离线执行仍须总管独立复核并重新登记。沿用3.3调用局部Symbol签发不可变准备，先在既有联合锁内重验整批原基线，再顺序复用原目录/meta、AssetDB create/既有UUID内容更新及统一refresh/settle。逐项before和实际写后bytes/SHA、UUID/meta只据真实读回；预期SHA不作读回证据。保留written/createdDirectories/byteCount/dirReady/refresh/metaReady/transaction/taskPostflight与原单文件/files优先。原ProjectLogPostflightMonitor为唯一权威最终后验，任何提交/登记/内容/身份/原日志失败均不得把阶段通过或HTTP成功称整批成功。

保持verified/written_unverified/failed/not_started和nullable契约，按原顺序区分已变更、失败/不确定和未执行；整体成功要求全部最终内容/登记及原日志通过。部分失败保守may_have_changed，unchanged仅有完整无变更证据，不实现无证据rolled_back；不确定orphan备份不能在generic finally删除或盲目重放。复用原execute/executeBatch、Plugin/Factory managed，记录可证本批次delta以正确处理共享原本缺失父目录，禁止替换排队前基线或放宽外部变更；较晚项影响早期目标须最终重新核验，不能用较早阶段成功冒充最终verified。需在原Runtime失败data与Kernel安全failure附件间保留本任务有界逐项结果，不改3.5算法、owner或AI成功规则。未来确定性第N次create/write/AssetDB、refresh/registration/settle、内容/UUID/meta读回和最终原日志故障注入，必须覆盖真实Router、两处managed装配、executeBatch及Host源码离线桥；保留3.3拒绝前全工程零变更与原四探针，离线double不作原生证明。
