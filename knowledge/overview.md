# peanut-pod-lite

Cocos Creator 编辑器产品。公开 83 项免费操作（38 读、45 写/破坏性），可登录并升级订阅，但不执行付费能力。

## Architecture v2

- `packages/protocol`：稳定 DTO 与 `ICreatorContext`，零内部依赖。
- `packages/sdk`：插件作者 API，只依赖 protocol。
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
- 3.8.7：host/project 版本都存在且一致时 full，可写；其它 3.8 补丁版本只读。
- 最低宿主兼容、实机证据与任务调度事实见 [creator-profiles.md](creator-profiles.md)。
- Creator 宿主网关解包 Router `data` 时必须把 `taskId/taskStatus` 合并进公开结果，不能在 Core dispatcher 边界丢失任务证据。2026-09-19 在 Creator 3.8.7 工程 `D:\mcp-test` 使用 CPM `PackagingApp` 安装当前目录包后，保留 `assets/mcp-scheduler-live/ParallelA.ts` 与 `ParallelB.ts`：不同资源并发和同资源 FIFO 均返回独立成功任务 ID，最终内容分别为 `fifo-second` / `parallel`；`lumen.commit` 返回 `assetdb_registered`、两项真实 UUID/`.meta`，对应 `project.log` 增量为 0 字节、零 error/warn。

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
