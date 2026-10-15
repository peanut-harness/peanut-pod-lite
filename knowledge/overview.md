# peanut-pod-lite

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
- 原生资源、调度与组件矩阵边界见 [editor-native-operations.md](editor-native-operations.md)；13e46db完整verify1256项，两版动画/URL定向零诊断通过，3.8.3 cubemap仍有输入缺口；实际呈现发现WebView黑字透明底及Sprite尺寸不足，已修源码待新候选复验。3.8.3退出时新增Electron GuestView错误待处置，已补关闭日志门禁；99/795分母与5.1未完成状态保留。

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
