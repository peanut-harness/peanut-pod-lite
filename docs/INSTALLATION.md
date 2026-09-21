# Core 安装顺序

`peanut-pod-lite` 是可独立运行的基础层。它不依赖 Pro、在线许可证、SnowB、设计导入或内容发布服务。

## 必需顺序

1. **关闭目标 Creator 项目。** 不得在旧宿主仍持有插件目录或运行期服务时覆盖安装。
2. **安装 Lite 宿主扩展。** 使用 `packages/hosts/modules/creator-38/release/peanut-pod-lite-host-*/` 安装到项目 `extensions/peanut-pod-lite-host/`。该原生 Creator 扩展从 CPM `peanut-plugins/installed.json` 读取活动版本，完整校验后加载必需的 `peanut.pod-lite` 与可选的 `peanut.cocos-mcp-pro`；不扫描旧插件目录。
3. **通过 CPM 安装 Core 能力包。** 安装器必须先校验目录包、原子写入插件目录和 schema v2 活动版本索引，再允许 Creator host 加载。不得手工伪造成功索引。
4. **启动 Creator 并等待宿主就绪。** 打开方式遵循 Hub `knowledge/cocos-creator-open.md`：3.x 用 `--project <abs> --nologin`；本工程已有 GUI 则 attach，不要再 spawn / 强杀；装宿主扩展后必须重启 Creator。只接受 `query-status` 返回 `ready: true`（gateway 接入后 `tools` 应为 83）且日志出现 `lite_host_ready`；未就绪时不得继续能力验收。
5. **运行只读冒烟测试。** 验证 `editor.queryVersion`、`editor.queryProject`、`editor.querySelection`、`scene.getCurrent`、`scene.getHierarchy`、`builder.queryPlatforms`、`builder.querySchema`、`builder.queryDefaultConfig` 与 `preview.query`；失败时停止，不继续任何写入测试。
6. **运行本地审批写入测试。** 先申请一次性审批租约，再执行一个可恢复的原生写操作；Core 不接受在线签名计划作为替代审批。
7. **运行原子创建矩阵。** 对 3.8.3 与 3.8.7 分别执行 `verify-managed-task-live.mts`，要求同一候选 Host/Core 身份下 Prefab/Scene 首次创建、同目标竞争、commit 前取消、UUID/`.meta`、唯一 postflight、零探针残留和日志增量全部通过。其它 3.8 补丁不得借此自动开放写入。
8. **运行吞吐长稳矩阵。** 对 3.8.3 与 3.8.7 分别执行 `verify-throughput-soak-live.mts`；默认包含 30 分钟正常混合负载、10 分钟持续过载，以及任务保留期后的回收检查。短时参数只允许验证 harness，不构成实机验收证据。

## 构建候选与 CPM 安装

本地可先构建宿主扩展与 Core CPM 目录包。宿主与 MCP 目录包均使用本仓 esbuild，不再读取 `PEANUT_COCOS_EDITOR_ROOT`：

```bash
npm install
npm run verify
npm run pack
```

候选安装完成并重启 Creator 后执行：

```bash
npm exec -- tsx packages/hosts/modules/creator-38/scripts/verify-managed-task-live.mts \
  --project <creator-project> \
  --output <qa-evidence-json>

npm exec -- tsx packages/hosts/modules/creator-38/scripts/verify-throughput-soak-live.mts \
  --project <creator-project> \
  --output <qa-throughput-evidence-json>
```

报告必须是 `peanut.creator38.managed-task-live.v2`，不得包含 Hub token 或审批 token；两个精确版本的报告必须绑定同一 `query-status.artifacts`。
吞吐报告必须是 `peanut.creator38.throughput-soak.v1`，100 资源批次吞吐至少为逐项基线的 2 倍，control P95 不超过 1 秒，overload 必须以拒绝和退避重试体现，并在冷却后确认任务索引、注册探针和新增 error/warn 均为零。`--allow-short --normal-ms <ms> --overload-ms <ms>` 仅用于 runner 冒烟，不得勾选长稳任务。

禁止在内部 module 目录单独安装依赖；仓库只维护根 lockfile。可选宿主发布物位于 `packages/hosts/modules/creator-24/release/` 与 `packages/hosts/modules/creator-30-35/release/`。

2.4 宿主安装到项目 `packages/peanut-pod-24/`；3.0–3.5 宿主安装到 `extensions/peanut-pod-35/`。

生成的目录包必须交给 CPM / Peanut Packaging 安装。当前公共 `cpm-install` 尚无签名 release，不能把旧仓库的直接安装脚本或手工复制当作正式 CPM 安装证据。

`peanut-pod-lite-host` 的 `query-status`、`list-tools` 与 `invoke-tool` 是 Creator 消息入口。`query-status.pro.state` 为 `absent`、`active` 或 `failed`；Pro 的版本、错误和已注册服务可独立诊断。`query-status.account` 描述登录与订阅快照，不得把订阅状态当成写盘许可。

## 订阅升级

Lite 可在未订阅时完整使用编辑器能力。升级入口在 Extension > Peanut Account：

1. 保存 HTTPS Pod 服务地址并登录（OIDC access token 由宿主加密保存）。
2. 查看订阅快照。未订阅时 `recommendedAction` 为 `upgrade`，打开 Server 签发的 checkout URL。
3. 账单成功后由 Pod Server webhook 写入权益；Creator 客户端不能自授。
4. 已授权但未安装 Pro 时 `recommendedAction` 为 `install-pro`。用 CPM 安装 `peanut.cocos-mcp-pro` 后调用 `refresh-pro`。
5. Pro 激活失败只更新 `query-status.pro`，Lite 工具表保持不变。

## Pro 的后置安装

Pro 只能在上述 Core 验收全部通过后由 CPM 安装。宿主使用 Electron `safeStorage`（Windows 为 DPAPI）持久化加密的 HMAC 材料，运行时只向 Pro 提供不可导出的 WebCrypto key；Linux 检测到 `basic_text` 后端时拒绝激活 Pro。进程内服务注册表由宿主注入调用方身份。Pro 安装、撤销、摘要不匹配或激活失败只更新 `query-status.pro`，不得移除、降级或阻塞 Core 已注册的能力。

## 失败与回滚

- 宿主安装失败：不创建能力包目录，保持项目无 MCP 扩展状态。
- 能力包摘要校验失败：删除未激活的暂存目录，不修改已生效 Core 版本。
- Pro 缺失或失败：保持 Core `ready: true`，撤销 Pro 已注册的服务并记录独立错误；不得把 Pro 错误提升为 Core 启动失败。
- 冒烟测试失败：停用 Core 能力包，保留宿主日志；不得安装 Pro。
- 本地审批测试失败：停用写入路由，仅保留只读能力，直到明确修复。

此顺序专门避免旧插件管理器、旧业务插件或 Pro 授权边界成为 Core 启动依赖。
