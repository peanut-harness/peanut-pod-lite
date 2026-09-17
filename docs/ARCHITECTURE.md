# Lite Architecture v2

## 依赖方向

依赖只允许沿以下方向流动：`protocol <- sdk <- engine <- hosts`。

`panel` 是独立静态应用，只消费稳定消息协议，不装配 runtime、kernel 或 Creator API，并且是 HTML/CSS/浏览器脚本的唯一源码源头。Creator 生命周期、进程、版本和面板装配全部归 `hosts`；业务能力、审批、资产写入和版本能力适配全部归 `engine`。

## 工作区

- `protocol` 固定跨模块数据形状和 `ICreatorContext`。
- `sdk` 固定第三方插件可见的最小 API，不泄漏 engine 私有类型。
- `engine` 通过 package subpath 暴露内部模块；内部目录不是独立发布单元。
- `hosts` 包含 2.x 与 3.x 两类壳，并把具体版本映射为四个兼容画像。
- `panel` 只保留可复制进 Creator 扩展的静态页面和最小应用标识。

`RuntimeFacade` 只依赖适配器工厂契约。2.4、3.0–3.5 与 3.6–3.8 分别拥有独立阶段工厂，默认组合根只负责注册；重复工厂 id、重复阶段、未知阶段、重复适配器 id 或版本范围重叠均 fail-closed。跨版本共用端口位于 `adapters/core`，共用宿主实现位于 `adapters/shared`，版本目录禁止互相导入。默认内存宿主为空，测试数据必须显式注入。

## 版本画像

`specs/creator-profiles/creator-profiles.json` 是兼容状态的唯一真相源。`npm run generate` 从该文件生成 protocol 中的类型化画像目录，`npm run generate:check` 阻止规范与运行时代码漂移。宿主读取实际 Creator 版本和工程声明版本，解析为不可变 `ICreatorContext` 后再装配运行时。

当前画像：2.4 与 3.0–3.5 为 experimental，3.6–3.7 为 unsupported，3.8.7 有 full 实机证据。只有宿主版本和项目声明版本都精确为 3.8.7 时允许写入；项目版本缺失、无法解析或不匹配时一律只读。

`CreatorOperationAvailabilityMatrix` 将 83 项公开操作与可信 Creator 上下文组合为 `available`、`read_only`、`write` 或 `refused`，矩阵测试覆盖四个版本画像；unsupported 全拒绝，写操作仅在具备精确实机证据时进入 `write`。

`Creator38MigrationWorkstreamCatalog` 只负责把同一份 83 项可信目录划分为五个互斥验收域：Editor/Scene/Prefab 21、Asset read 15、Asset write 12、Preview/Builder/Reference 9、Lumen 26。它不复制 schema、风险或审批规则，也不把 Node parity 测试当成 Creator 3.8.7 实机证据。

当前目录与矩阵测试的分类口径为 38 项读、45 项写/破坏性，与 README 一致。旧迁移台账的 36/47 是历史口径，不作为本仓验收基线；分类以当前 capability catalog 和 `creator-operation-availability-matrix.test.mts` 为准，不能仅凭总数 83 判定分类一致。

## 构建模型

仓库只有根 `package-lock.json`。根脚本按协议、SDK、engine、panel、hosts 顺序执行；engine/hosts 的内部模块由 manifest 自动发现，并按 `peanut.internalDependencies` 拓扑执行。`tools/verify-workspace-structure.mjs` 同时核对模块导出、源码导入、宿主画像、嵌套 lockfile 和逆向依赖。

旧 checkout 升级后，Git 不会清理已忽略的 `dist/`、`node_modules/` 与 `release/`，这些生成物可能让已迁出的旧顶层 `packages/*` 目录继续存在。结构门禁仍须拒绝这些目录，不能增加忽略规则来绕过。遇到 `unexpected_top_level_packages` 时，先核对 Git tracked 文件、工作区改动和目录内容；仅在确认没有 tracked 文件或用户源码且全部文件均为被忽略的生成物后，将旧目录原样移至仓外的 `/private/tmp` 独立备份目录，保留路径供回滚。无法确认归属的文件应保留并报告，不运行 `git clean` 或直接删除目录。处理后执行根 `npm ci`、`npm run verify` 和 `npm run pack`；安装依赖不得改变根 lockfile。

宿主发布物使用 esbuild 打成自包含目录包。Creator 2.4 模板在没有本机编辑器时保留已提交正式模板，绝不再用测试 fixture 覆盖发布资产。

源码质量门禁使用 TypeScript AST 检查 `src/` 与 `source/` 中的生产源码，排除声明文件、测试和 fixture，避免注释、字符串或目录命名造成误计数。基线只能随真实旧债下降而收紧，不能掩盖最大文件回涨、新增自由函数、多类文件、旧式脚本或单行 JSDoc；生产文件已禁止再次出现多类实现。

Lumen 属性 Schema 只负责编排字段目录、版本门控与嵌入对象流程，基础值校验和 Prefab 引用解码分别归 `LumenComponentPropertyValueParser`、`LumenComponentPropertyReferenceDecoder`；Prefab 文档只负责内存结构编辑，空白条目、模板读取、克隆与原样复制归 `LumenPrefabDocumentSource`。Plugin Manager 控制器把初始状态和选中项规则交给 `PluginManagerPanelStateProjector`，Scene Gateway 把九类未受信输入交给 `EditorMcpSceneInputReader`。

## 安全不变量

- operation ID、schema 与审批语义保持稳定。
- 缺失 schema、未知版本、空资源授权和不匹配风险均 fail-closed。
- `prefab.unpack`、`prefab.unlink`、`builder.build` 与删除/替换类操作按 destructive 处理。
- Lite 不导入 Pro；订阅状态不能替代本地写入审批。
- `preview.capture` 与 `snowb.bmfont.export` 是 Pro 独占操作，Lite 在所有 Creator 画像上都显式拒绝，也不请求 Pro admission 服务。
- Creator 进程匹配必须精确解析 `--project` / `--path`，不得用路径前缀或其它工程进程作为当前工程证据。
