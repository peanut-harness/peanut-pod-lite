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

- 2.4 与 3.0–3.5：experimental，写入关闭。
- 3.6–3.7：unsupported。
- `specs/creator-profiles/creator-profiles.json` 生成 protocol 画像目录，规范与运行时不能双写。
- 3.8.7：host/project 版本都存在且一致时 full，可写；其它 3.8 补丁版本只读。
- 未知、缺失或不一致版本全部 fail-closed。
- 83 项公开操作通过版本能力矩阵统一生成 `available`、`read_only`、`write`、`refused` 状态，并覆盖四个画像测试。
- Creator 3.8.7 迁移验收按五个互斥域固定分母：Editor/Scene/Prefab 21、Asset read 15、Asset write 12、Preview/Builder/Reference 9、Lumen 26；legacy schema/readOnly/risk parity fixture 已覆盖全部 83 项，但不替代 Creator 实机证据。
- Creator 3.8 实机报告同时记录宿主入口 SHA-256、Lite CPM package digest/packedAt 与可选 Pro package digest；`query-status`、`host-status.json`、`smoke-results.json` 三方身份必须一致，旧报告不能冒充当前 release。
- 新建 Prefab/Scene 的 AssetDB commit 屏障若仍返回 `pending` 未登记资源，必须 fail-closed；不得继续 catalog、commit 后续或把本地序列化结果当作干净实机证据。Creator 3.8 Assets 面板的 `original asset is not exist` 竞态仍需通过 AssetDB 原子创建/登记流程消除。
- MCP 写调用默认进入进程内共享的项目调度器：同工程 Router 共享 AssetDB/editor writer 屏障，同资源按 FIFO 串行，不同资源的离线 Lumen 编辑与不同工程可以并行；多资源锁必须一次性原子预约，空锁集合降级为项目锁而不是绕锁。
- 当前资源规划已覆盖 operation 推导资源、copy/rename 目标、`.meta` UUID/子资源、序列化引用、传递依赖与父目录闭包；写操作统一经过 AssetDB transaction。纯磁盘 copy/createFolder 若目标尚未注册，transaction 先在目标目录通过 `asset-db.create-asset` 创建短生命周期 JSON 探针以登记父目录与同目录资源，再执行 refresh/settle、UUID/`.meta` 校验并删除探针；pending 或探针残留都失败关闭。任务还以 `project.log` 增量零错误零警告作为成功条件。失败异常携带 `taskId`，完成记录有界回收；异步状态/取消/超时/幂等、跨调用批次事务仍待后续阶段，设计见 `docs/MCP-TASK-QUEUE-DESIGN.md`。
- MCP Hub 失败响应在兼容 `error` 字段外统一追加 `failure` v1：包含稳定 `code`、`category`、受控 `reason`、`retryable`、项目 `state` 与 `recommendedAction`；已入队写任务再附 `taskId/taskStatus/operation`。普通 JSON 与 NDJSON 流式响应使用同一结构。真实发布链路由 policy `CoreCocosMcpToolDefinitionCatalog` 生成契约，Creator 3.8 host 与 Hub summary 必须原样透传 `outputSchema/aiHandling`，registry 在注册时 fail-closed 校验其结构。写操作必须同时满足 `taskStatus=succeeded` 与 `postflight.verified=true`；状态为 `unknown`/`may_have_changed` 时 AI 必须先查询目标再决定是否重试，禁止盲目重放写入。
- Creator 宿主网关解包 Router `data` 时必须把 `taskId/taskStatus` 合并进公开结果，不能在 Core dispatcher 边界丢失任务证据。2026-09-19 在 Creator 3.8.7 工程 `D:\mcp-test` 使用 CPM `PackagingApp` 安装当前目录包后，保留 `assets/mcp-scheduler-live/ParallelA.ts` 与 `ParallelB.ts`：不同资源并发和同资源 FIFO 均返回独立成功任务 ID，最终内容分别为 `fifo-second` / `parallel`；`lumen.commit` 返回 `assetdb_registered`、两项真实 UUID/`.meta`，对应 `project.log` 增量为 0 字节、零 error/warn。
- 2026-09-19 在同一 Creator 3.8.7 工程重放高并发资产生命周期：修复前 4 路 `asset.copy` 因纯磁盘目标目录未进入 AssetDB，以约 21 秒阶梯全部 `registration_pending`；加入注册探针并更新 CPM Core 包后，4/4 copy 在 3.241 秒内完成，随后 4/4 rename、4/4 move 均保留 UUID。最终资产位于 `assets/mcp-concurrency-live/run-20260919-203000/moved-fixed-214400/`，证据资产为 `ConcurrencyValidation.json`；新会话 `project.log` 零 error/warn，注册探针残留为 0。
- 2026-09-19 同工程实机目录 revision 84 已公开写工具的 `outputSchema` 与 `aiHandling`；无审批 copy 返回 `approval_required/not_started/request_approval`，已审批但源缺失返回 `silent_copy_seed_missing`、任务 ID、`unknown/stop`，两者都未生成目标。成功结果解包将内部 `taskPostflight` 兼容映射为公开 `postflight`，schema 要求必含布尔 `verified`；实机 copy 返回 HTTP 200、`taskStatus=succeeded`、`postflight.verified=true`，AssetDB 读回 UUID `2b69c9d2-17bd-4fe0-a94b-1b808bbe9458`，资产保留于 `assets/mcp-ai-contract-validation/success-final/Record02.json` 及 `.meta`。携完整 `mcpFailure` 的已处理任务失败不再进入 PluginDiagnosticReporter，最终会话 `project.log` 零 error/warn。
- 2026-09-17 的 Creator 3.8.7 阶段证据绑定提交 `743ebb9`：宿主公开 83 个业务 operation 加 1 个审批入口，38/38 个业务只读 operation 均完成实机调用；`asset.writeText` 额外完成无租约拒绝、一次性租约写入、AssetDB settle 与原文件/`.meta` 哈希恢复。其余 44 个写/破坏性 operation 仍需逐项可恢复实机证据。

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
