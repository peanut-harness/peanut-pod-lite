# Creator 实机验收

本手册验证 Creator 3.8.x 中的 Lite 宿主、`peanut.editor-mcp` 与 Lumen。当前已完成 3.8.3 与 3.8.7 的实机证据；未列入精确画像的补丁版本仍只读。离线测试只能证明协议和实现行为，不能替代编辑器实机验收。

## 1. 构建与安装

在仓库根执行：

```bash
npm install
npm run verify
npm run pack
```

按根目录 [`docs/INSTALLATION.md`](../../../../../docs/INSTALLATION.md) 安装宿主和 CPM 目录包。测试工程路径由 QA 环境显式提供，仓库脚本和文档不得写死本机路径。

## 2. 就绪门禁

刷新或重启目标编辑器后，必须同时满足：

- `query-status` 返回 `ready: true`。
- `list-tools` 返回 83 个 Lite operation，且不包含 Pro operation。
- `query-status.artifacts`、`host-status.json.artifacts` 与 `smoke-results.json.artifacts` 完全一致；记录宿主 `mainDigest`、Lite `packageDigest`/`packedAt`，有 Pro 时同时记录 Pro package digest。
- `project.log` 出现本轮 `lite_host_ready`，之后没有新增启动错误。
- 宿主版本与工程版本均为已验证的 `3.8.3` 或 `3.8.7`；缺失、不一致或其它 3.8 补丁版本时写入保持关闭。

任一条件失败都停止写入验收，不通过截图推断状态。

## 3. 只读冒烟

至少验证：

- `editor.queryVersion`、`editor.queryProject`、`editor.querySelection`
- `scene.getCurrent`、`scene.getHierarchy`
- `builder.queryPlatforms`、`builder.querySchema`、`builder.queryDefaultConfig`
- `preview.query`

结果必须来自 MCP 响应和本轮 `project.log` 增量；报告缺少产物摘要或摘要与待验 release 不一致时，本轮证据无效。

完整验收按 `Creator38MigrationWorkstreamCatalog` 的固定分母记录，不得只报告 83 项总数：Editor/Scene/Prefab 21、Asset read 15、Asset write 12、Preview/Builder/Reference 9、Lumen 26。每项证据至少包含 operation、输入 fixture、MCP 结果、日志增量和清理结果；Node parity 测试只证明冻结契约，不替代本节的 Creator 3.8.x 精确补丁版本证据。

## 4. 静默资源写入

逐项验证资产创建、复制、移动、重命名、删除、导入、重导入、引用替换和 Lumen 源文件写入：

1. 记录写入前的 `project.log` 字节偏移与资源状态。
2. 无租约调用必须拒绝且不产生资源副作用。
3. 签发绑定 operation、精确 resources 与 risk 的一次性租约。
4. 执行写入，确认没有覆盖、重命名或确认对话框阻塞编辑器。
5. 等待 AssetDB 稳定，刷新编辑器后重新读取资源、UUID、`.meta` 和序列化组件绑定。
6. 只检查记录偏移后的日志增量；新增 error 或未解释 warning 均不通过。

覆盖既有目标时，MCP 必须通过明确的 replace/overwrite 语义静默处理或结构化拒绝，不能触发原生确认弹窗。

## 5. 组件全覆盖

组件覆盖使用仓库内的可重复工具，不保留生成结果：

```bash
npm exec -- tsx packages/engine/modules/lumen/scripts/create-component-matrix-fixture.ts --project <project-path> --sprite-frame <uuid>
npm exec -- tsx packages/engine/modules/lumen/scripts/create-binding-verification-scene.ts --project <project-path> --player-panel <prefab-path>
node packages/engine/modules/lumen/scripts/diff-cc-dts-components.mjs <cc.d.ts-or-editor-root>
```

- 对 schema 中每个可挂载组件执行创建、挂载、属性写入、保存、刷新和重新读取。
- 对资源字段验证 UUID、子资源 UUID、Prefab 引用、SpriteFrame 和脚本属性序列化。
- 对不可挂载、抽象或冲突的 renderable 组件要求结构化拒绝；不得触发 `[Scene] Can't add renderable component...`。
- 工具生成的 fixture、编辑器日志和 JSON 结果属于 QA 资产，不提交到 Lite 仓库。

## 6. 判定与清理

- 以 MCP 返回、资源落盘内容和 `project.log` 增量作为判定依据；禁止截图验收。
- 删除本轮临时资源后刷新 AssetDB，再确认日志没有新增错误或警告。
- 保留可复现的 QA 工程资产与自动化用例，不在本仓保存机器相关日志、轮询快照或绝对路径转储。

受管任务矩阵使用同一脚本覆盖每个精确补丁版本：

```bash
npm exec -- tsx packages/hosts/modules/creator-38/scripts/verify-managed-task-live.mts \
  --project <project-path> \
  --output <qa-evidence-path>
```

脚本通过当前会话描述符验证同资源 FIFO、不同资源并行、跨连接取消拒绝、owner 在 commit 前取消、取消目标与 AssetDB 注册探针零残留、成功任务恰好一次 postflight、Host/Core 产物身份一致和增量日志零 error/warn。输出只保存结构化安全摘要，不保存 Hub token。

## 7. 当前迁移证据

2026-09-17，提交 `743ebb9` 的 Creator 3.8.7 阶段验收已完成：

- 83 个业务 operation 与 1 个本地审批入口全部发布到宿主和 Hub。
- 启动 smoke 的 20 个空参只读调用与 18 个参数化只读 fixture 全部通过，即 38/38 个业务只读 operation 已具备实机证据。
- 本地审批入口完成签发和消费；`asset.writeText` 验证无租约拒绝、租约写入、AssetDB settle、原内容与 `.meta` 哈希恢复。
- 本轮日志增量没有 error 或 warning，三份状态/报告中的宿主和 CPM 产物身份一致。
- 2026-09-20，Creator 3.8.3 项目 `billiards-practice-clean` 的当前 pack 验收完成：修复旧 Node 的 `node:` builtin、`Object.hasOwn` 与 `crypto.randomUUID` 兼容性后，Host/Core 加载成功；`asset.writeText` 经 Hub 写租约完成 AssetDB settle 与 postflight 校验，随后 destructive 删除验证无残留。
- 2026-09-21，修复 executor-managed 任务过早进入 commit 窗口后，同一候选 pack 在 Creator 3.8.3 与 3.8.7 逐版本通过受管任务矩阵：Host digest 均为 `5312e5db4c4287fc5f51294eb9758f828e36cb52df61428733405827c0b96e6b`，Core package digest 均为 `d5c5b010351c73586af7bad29cea352cc34f4c182e753d1572020a82407ee6bf`；两个版本均完成 5 个同资源 blocker、FIFO 最终值、两项不同资源并行、跨连接取消不可枚举、owner 取消与零残留，9 个成功任务各只有一条 postflight 证据，增量日志零 error/warn。结构化报告摘要分别为 `b56554090ebcd48a3fb2cd61105e44d152efb46a9afdce6e26b111a4e94e2e4a`（3.8.3）与 `7395057fd472f594d92c0c69e7e0d0f91983cf301bd7aa15db25a546b97151f3`（3.8.7）。

这不是 Wave 1 完成声明。剩余分母是 44 个写/破坏性 operation，必须继续按第 4、5 节逐项记录副作用、读取验证和清理结果。
