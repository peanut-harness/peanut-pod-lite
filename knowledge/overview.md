# peanut-pod-lite

SDK续查：实际reset只重置队列，不清空起始Map，原猜测已排除。监听器根因为SDK init重复bind覆盖旧引用；已实现仅新登记3.8.7工程可显式启用的项目内幂等注册兼容，精确匹配3个原方法摘要并只释放自身旧回调，20次真实原方法离线回归稳定，待实机。独立probe继续只读并观察已缓存SDK适配器；不改安装包、不改阈值、不忽略计时器错误，5.1未完成。

5.1诊断续查（2026-10-16）：GPU修复c9a5b1c完整verify1256/1256、113项组件回归及官方候选通过。BlitScreen由通用standard改为同版全屏专用材质，原生实际材质/相机/管线确认后，GL错误从2降至0，正常关闭自有PID18592后的完整日志仍有4条SDK计时器错误、零警告，整轮仍拒绝。另有界复现定位监听器注册于SDK CompManager/NodeManager，保存重开增长，两种顺序对照无效；metric冷启动也未解决SDK启动错误。全部原始证据保留，5.1受零诊断门禁阻塞。详情见editor-native-operations.md。

Cocos Creator 编辑器产品。当前源码契约为 84 项免费操作（39 读、45 写/破坏性），保留旧 83 项映射并新增只读 `asset.readText`；可登录并升级订阅，但不执行付费能力。任务 1.1 完成 DTO/policy/schema/目录：默认 32 文件、每文件 1 MiB、输入/输出各 4 MiB；读取项用 `byteCount`，写入前 `beforeSha256` 区分真实摘要/absent/未知 null，`sha256` 为真实后验摘要。Core 已校验 oneOf/数组容量/哈希模式，Kernel 接纳校验已在任务 3.1 实现，实际文本读取及共享屏障/revision 已在任务 3.2 离线验收，任务 3.3 已实现全批准备与 writer 内重验，3.4 已实现逐项读回及 UUID/meta 后验和保守部分失败；3.5 已接入原有控制面安全机制并强化文本写入 AI 成功判据；Runtime 幂等索引仅存剔除审批凭据后的 SHA-256 工作摘要，源码正文不进入控制面记录；Runtime 100 项及 MCP Host/写入安全 82 项定向测试通过。Creator 多平台验收延后，实机矩阵和全量零日志验收尚未完成。 任务 1.2 已提供绑定产品与两版安装源码的覆盖草稿/严格校验：3.8.7 为 1220 目标/4119 用例，3.8.3 为 1229/4128；每版 4 个动态注册未解析项保留待运行时对照，全部 8247 用例 pending、可用性 unverified，32 项合成读取/校验测试通过。真实夹具、运行时目录和原生日志读取端口仍待后续，静态分母不代表实机覆盖。 任务 3.1 已验收无副作用的真实路径/物理别名/严格 UTF-8/JSON 字节 guard 与 Kernel 新关键词；77 项离线回归、两模块类型检查、两项文件竞态和非枚举 getter/祖先 serializer 零调用探针通过。任务 3.2 已接真实 Hub/Creator Host 的 read gateway、共享资源锁及多文件 revision；观察异常后仅以受信 owner 做一次当前 Runtime 终态确认，未知仍保持屏障，终态复用只释放一次且不重执行。早到终态缓存仅保留真实 managed receipt 窗口。源 223 项定向回归通过；总管独立 46 项与 4 项原始探针通过，覆盖重叠不相加。31 项既有 Kernel 测试严格类型诊断未变，无新增租约错误；Node25 执行、ES2017 构建未证明 Node14 或新 Creator 运行。

## Architecture v2

- `packages/protocol` 提供稳定 DTO 与 `ICreatorContext`，零内部依赖；`packages/sdk` 提供插件作者 API，只依赖 protocol。
- `packages/engine`：runtime、installation、assets、Lumen、MCP、policy、kernel。
- `packages/hosts`：Creator 壳、进程与版本画像；宿主只解析一次上下文。
- `apps/panel`：静态面板应用，不依赖 engine/hosts。
- 只有根 `package-lock.json`；内部 modules 不是 workspace，不得声明 `file:` 依赖。
- 内部 modules 由 manifest 自动发现，按 `peanut.internalDependencies` 拓扑执行并校验源码导入。
- Creator 版本实现使用阶段工厂注册表装配；版本目录互不导入，共用端口与宿主实现分别归 `adapters/core`、`adapters/shared`。
- 源码质量门禁用 TypeScript AST 覆盖 `src/` 与 `source/` 的生产源码，排除声明文件、测试与 fixture，并锁定单文件单类及最大文件行数；属性值/引用解析、Prefab 文档来源、面板状态投影与 Scene 输入读取已从核心编排类拆出。

## Creator Profiles

- 2.4 与 3.0–3.5：experimental、写入关闭；3.6–3.7：unsupported。
- `specs/creator-profiles/creator-profiles.json` 生成 protocol 画像目录，规范与运行时不能双写。
- 3.8.3 与 3.8.7：host/project 版本都存在且一致时 full，可写；其它 3.8 补丁版本保持只读，直到逐版本完成实机证据。
- 最低宿主兼容、实机证据与任务调度事实见 [creator-profiles.md](creator-profiles.md)。
- 未知、缺失或不一致版本全部 fail-closed。
- 原生资源、调度与组件矩阵边界见 [editor-native-operations.md](editor-native-operations.md)；8045b84完整verify1256项与候选通过；e90fb77两版WebView/Sprite实际可见及有界关闭整会话零诊断。Sorting2D单项模块UI对照成功，新空模板缺engine.json的首次创建修复已过92项及真实SDK离线暂存，仍待新检查点实机。99/795分母与5.1未完成状态保留。

## Hard Rules

- 写操作必须消费绑定连接、operation、精确资源和风险的租约；非空 approval ID 不够。Hub 审批白名单使用 namespaced capability 名称，镜像到 Lite 本地租约时宿主必须同时加入工具定义声明的内部 operation，避免 `peanut.editor-mcp.asset-open` 与 `asset.open` 口径不一致造成误拒绝。
- `prefab.unpack`、`prefab.unlink`、`builder.build` 与删除/引用替换类操作是 destructive。
- destructive 调用必须同时提供 destructive 租约与 `confirmDestructive:true`；`asset.import` 的 overwrite/override 动态升级为 destructive。
- AssetDB 写入在进入宿主前拒绝绝对目标路径和 `.`/`..` 逃逸；仅 `asset.import.sources` 可读取项目外绝对源文件。
- capability 缺 schema 时目录构造直接失败，不静默漏注册。
- Lite 永不 import Pro；Pro 缺失不得挡住 Lite 启动；订阅不等于写盘许可。
- Creator 2.4 缺本机安装时保留已提交正式模板，禁止用测试 fixture 覆盖发布资产。
- 产品分发是目录包 / CPM，不是 `npm publish`。
- `@peanut/pod-engine/installation` 公开纯 CPM manifest/完整性协议；Pro 不得恢复旧顶层 `cpm-core` 包。
- Creator 进程必须精确匹配 `--project` / `--path`；Node 单测不是实机冒烟。

## Verification

根目录执行 `npm run verify` 和 `npm run pack`。旧 checkout 的 ignored 顶层生成物确认无源码后移出仓库，不放宽结构门禁。结构说明见 `docs/ARCHITECTURE.md`，产品契约见 Hub `contracts/pod-product.md`。

2026-10-16：空模板修复0f8e3fd完整verify1256项及本地候选通过；原生验证工具正在迁移为设备登记与当前会话身份核对，拒绝旧owner工程和租约。Sorting2D新工程实机及其余5.1仍待完成。

2026-10-16原生续验：dde82cd的3.8.7新工程初次有效Profile比对因额外物化graphics拒绝；磁盘和其余选择未变。独立校验修复严格接纳仅由冻结选择推导的graphics两项，拒绝缺失、额外字段和其它管线/模块变化；工具SHA与初始失败保留。同一自有PID完成20/20资源加载及Sorting2D生命周期和2字段保存/移除重开，新增warn/error为0。唯一IAB页一次MCP刷新复用连接、无新增标签或浏览器诊断；实际遮挡仍受Hub禁止截图约束，未声明呈现通过；剩余5.1未完成。

2026-10-16续验准备：867811c完整verify1256项及官方pack/候选通过。dde82cd实机Sorting2D campaign的2字段、增删及保存/移除重开通过，但正常关闭自有PID6537后，整段原始stdout严格扫描发现3项Config file error与24项trackTimeEnd失败，整会话仍拒绝；stderr和project.log无此诊断，不用局部增量代替全渠道验收。用户单次Sorting2D截图授权尚未使用，唯一IAB标签已停泊空白。新增3.8.7精确后处理上下文，只开启custom-pipeline-post-process及Forward宏；8份实际SDK离线场景已装配，需原生Forward/PostProcessBuilder证据后才解除阻塞，99/795分母不变。新隔离工程通过SDK支持的旧版空服务配置迁移避免缺配置，公开Profile只读核验；受限VM执行原方法重现失败和空services迁移，不算实机通过。macOS改用应用启动入口保留双原始日志验证计时器问题。新源已过101项夹具与定向严格检查，仍待clean检查点完整verify/候选及冷启动、单次截图和后处理实机；5.1不勾选，不开all、不推送或发布。

后处理相机门禁：同版SDK的Camera.usePostProcess默认false；新展示源显式写入其已审计序列化槽，并在原生快照只读核对公开getter及全局PostProcess，避免只有组件而未启用效果。f158519的完整verify1256项通过，此相机补齐仍需新检查点及实机。

2026-10-16实机收尾：8ae0192完整verify1256项、官方pack/候选通过；同一自有3.8.7 PID50275完成20/20资源加载。Creator公开Profile补齐11项SDK默认宏，磁盘仅保存覆盖项；独立校验按同版macro.ts逐项核对，初次拒绝、原生快照和工具SHA均保留。唯一获准Sorting2D截图确认蓝色order1覆盖后创建红色order0；两字段及完整生命周期观测通过，单次授权已用完，未新增标签。后处理首轮23/24字段读回，BlitScreen.activeMaterials在onLoad按enabled materials重建，补真实启用材质原子上下文后其4字段重验通过；8类后处理共24字段及8份展示的实际Main Camera.usePostProcess/global PostProcess上下文已观测，原展示源不变。

整会话仍拒绝：完整stdout有212条SDK trackTimeEnd错误，stderr有1条SSL及6条uniform-buffer WebGL错误、2条MaxListenersExceededWarning和1条trace提示；project.log没有这些诊断。旧campaign的accepted只覆盖当时project.log增量，不能作全渠道验收，字段观测不升级为后处理呈现通过。新门禁在campaign开始前扫描全部原始来源，逐MCP动作与只读观测同时检查stdout/stderr/启动器及project.log，识别类型化Node警告、异步诊断、缺失/链接/轮换/截断/前缀改写；不忽略SDK消息，也不能重取游标跳过启动错误。已关闭会话的离线回放在0次MCP/0组件前拒绝219错误与3警告，保留99/795完整分母。110项组件回归、严格类型及源码规范通过；新源须clean检查点完整verify/候选，不用关闭的旧实例假装新候选实机。六项已撤销，退回Label后仅正常关闭自有PID50275，启动器退出0不等于Creator退出码0；唯一IAB标签停泊空白。5.1仍未完成，后处理呈现、原始诊断及角色控制器/蒙皮/Tiled专门上下文仍待解决；不勾选、不推送、不发布、不开all。

2026-10-16无Host/Core只读对照：代码检查点4b797c3完整verify1256/1256、110项组件回归及官方pack/候选通过后，在新的登记工程首次启动前移除Host/Core，保留同版SDK、精确后处理配置、原始Bloom场景和只读探针；公开Host查询明确不存在，实际Forward/PostProcessBuilder、Main Camera.usePostProcess及全局PostProcess均确认。未调用MCP写、未开预览或截图，场景SHA不变；正常关闭自有PID59543后，五个原始来源仍有2条SDK asset-db启动计时器错误，零警告。本单场景冷启动未复现循环中的GPU/监听器问题，不能据此判定其归因；不将该对照记作产品候选原生通过。最终进程核对仅余原先两个3.8.3工程，自有50275/59543均消失。当前零诊断门禁阻止继续有效campaign；5.1保持未完成，先解决/定位原始诊断，再补角色控制器、蒙皮和Tiled上下文，禁止忽略SDK错误。此后仅更新文档，源码/配置不变，复用4b797c3完整验证；知识另做scoped同步并交sync。
