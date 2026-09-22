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
- 3.8.3 与 3.8.7：host/project 版本都存在且一致时 full，可写；其它 3.8 补丁版本保持只读，直到逐版本完成实机证据。
- 最低宿主兼容、实机证据与任务调度事实见 [creator-profiles.md](creator-profiles.md)。
- 未知、缺失或不一致版本全部 fail-closed。
- Creator 3.8.x 迁移验收按五个互斥域固定分母：Editor/Scene/Prefab 21、Asset read 15、Asset write 12、Preview/Builder/Reference 9、Lumen 26；legacy schema/readOnly/risk parity fixture 已覆盖全部 83 项，但不替代 Creator 实机证据。
- 2026-09-20 在 Creator 3.8.3 工程 `billiards-practice-clean` 完成当前 Host/Core pack 的真实 Bridge 验证：宿主与工程版本均为 3.8.3，Host/Core 产物身份与状态报告一致，`asset.writeText` 经 Hub 写租约完成 AssetDB settle、`.meta` 生成和 postflight 校验，随后经 destructive 租约删除且无残留；3.8.3 现纳入 verified/write-enabled 精确画像。
- Creator 3.8 实机报告同时记录宿主入口 SHA-256、打包 Host 目录包 digest、Lite CPM package digest/packedAt 与可选 Pro package digest；`query-status`、`host-status.json`、`smoke-results.json` 三方身份必须一致，旧报告不能冒充当前 release；live 脚本带 `--release-descriptor` 时再经 `CpmPackageStore.compareReleaseIdentity` 核对 descriptor。目录包 digest 规范按码元序拼接，校验端兼容旧 localeCompare 清单。
- Creator 3.x 新建 Prefab/Scene 已改为单一 AssetDB 原子创建状态机：目标与 sidecar/父目录先纳入资源闭包，Lumen 在内存生成主内容，父目录登记探针清理完成后才进入 commit 窗口，再通过 `create-asset` 或 Creator 原生 Prefab 发布器写入并确认真实 UUID、`.meta` 与子资源。pending、身份不一致、探针残留或新增日志 error/warn 均阻止成功；无法证明回滚时返回 `may_have_changed`。
- MCP 写调用默认进入进程内共享的项目调度器：同工程 Router 共享 AssetDB/editor writer 屏障，同资源按 FIFO 串行，不同资源的离线 Lumen 编辑与不同工程可以并行；多资源锁必须一次性原子预约，空锁集合降级为项目锁而不是绕锁。
- 当前资源规划已覆盖 operation 推导资源、copy/rename/首次创建目标、主资源和父目录 `.meta`、序列化引用、传递依赖及 UUID/子资源闭包。纯磁盘 copy/createFolder 使用注册探针与 refresh/settle；首次创建使用专用发布状态机，创建身份由唯一 postflight 消费。共享任务控制面提供 connection-scoped 状态/取消/证据、超时与幂等，成功还要求 `project.log` 增量零错误零警告。自动重试与跨调用批次事务仍待后续阶段，设计见 `docs/MCP-TASK-QUEUE-DESIGN.md`。
- MCP Hub 失败响应在兼容 `error` 字段外统一追加 `failure` v1：包含稳定 `code`、`category`、受控 `reason`、`retryable`、项目 `state` 与 `recommendedAction`；已入队写任务再附 `taskId/taskStatus/operation`。普通 JSON 与 NDJSON 流式响应使用同一结构。真实发布链路由 policy `CoreCocosMcpToolDefinitionCatalog` 生成契约，Creator 3.8 host 与 Hub summary 必须原样透传 `outputSchema/aiHandling`，registry 在注册时 fail-closed 校验其结构。写操作必须同时满足 `taskStatus=succeeded` 与 `postflight.verified=true`；状态为 `unknown`/`may_have_changed` 时 AI 必须先查询目标再决定是否重试，禁止盲目重放写入。
- Creator 宿主网关解包 Router `data` 时必须把 `taskId/taskStatus` 合并进公开结果，不能在 Core dispatcher 边界丢失任务证据。2026-09-19 在 Creator 3.8.7 工程 `D:\mcp-test` 使用 CPM `PackagingApp` 安装当前目录包后，保留 `assets/mcp-scheduler-live/ParallelA.ts` 与 `ParallelB.ts`：不同资源并发和同资源 FIFO 均返回独立成功任务 ID，最终内容分别为 `fifo-second` / `parallel`；`lumen.commit` 返回 `assetdb_registered`、两项真实 UUID/`.meta`，对应 `project.log` 增量为 0 字节、零 error/warn。
- 2026-09-21，AssetDB 原子创建候选在 Creator 3.8.3 与 3.8.7 通过 v2 实机矩阵：Host/Core digest 为 `5312e5db4c4287fc5f51294eb9758f828e36cb52df61428733405827c0b96e6b` / `68c6721913b494c5cfabe05ead19db00ec96074f48033a31d728ba856ddd645f`。Prefab/Scene 真实 UUID 与 `.meta`、同目标一成一败无覆盖、发布前取消零残留、创建任务唯一 `assetdb_settle` 与所有成功任务唯一 postflight 均通过；两端探针残留与日志增量均为零。报告摘要为 `db615d8ed8929ea5c7ccde93a19eef76e3ab54c27bdd0681633db7e650444850`（3.8.3）与 `30c2fcaa2de077cd2a26c8ed81add00d3b17a916c523d16ee8e2cc02e80daa1f`（3.8.7）。

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
