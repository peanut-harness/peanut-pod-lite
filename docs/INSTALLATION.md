# Core 安装顺序

`peanut-pod-lite` 是可独立运行的基础层。它不依赖 Pro、在线许可证、SnowB、设计导入或内容发布服务。

## Peanut Packaging 迁移前校验基线（任务 1.1）

以下是当前 `ProjectPackageStore` 与 Creator 3.8 Host 对**同一隔离夹具**的只读行为，尚非新安装路径的验收结论。Host 首装仍先在 Creator 关闭时放置 `extensions/peanut-pod-lite-host/`，再安装 Core 目录包并重启；尚未启动的 Plugin Manager 面板不承担首次 Host 放置。既有工程的 `peanut-plugins/installed.json` schema v2 与目录布局须保留原字节，先核验再决定接续或迁移。

| 向量 | 当前 Packaging 读取/检查 | 当前 Host 加载检查 | 切换门禁 |
| --- | --- | --- | --- |
| 完整活动包、提交后残留的 `installed.json.tmp` | 读取原活动版本，包检查通过 | 读取原活动版本 | 保持摘要与身份一致；中断文件不得变成活动事实 |
| 重复插件或版本记录 | 返回重复快照或版本 | 拒绝索引 | 新共享读取必须拒绝歧义 |
| 未知 schema、逃逸安装路径 | 当作空索引 | 拒绝索引 | 新共享读取必须报错并保留原索引，不得静默清空 |
| 已记录载荷被篡改、总摘要漂移 | 包检查失败 | 拒绝载荷或摘要 | 保持逐文件和总摘要校验 |
| 未记录文件或符号链接 | 包检查通过 | 拒绝载荷 | 新共享读取必须拒绝额外载荷与链接 |
| manifest 版本偏离活动索引 | 单独包检查通过 | 拒绝包身份 | 新共享读取必须交叉核对身份 |

冻结的测试向量还包括 Lite/Pro 目录包的逐文件与总摘要、目录签名规范化字节、Host 更新目录摘要和候选 Host/Core 身份比较。任何弱于当前 Host 的结果都阻止切换；任务 1.2 补齐自有共享只读校验后，才更新下文正式安装说明。当前测试仅使用临时工程，不读取或修复用户既有工程。

装好后，从 Creator 的 **Extension > Cocos Plugin Manager** 打开同一个停靠面板。插件、开发者工具、MCP、设置和关于页都在此面板内切换；无需另开设置窗口。

## 必需顺序

1. **关闭目标 Creator 项目。** 不得在旧宿主仍持有插件目录或运行期服务时覆盖安装。
2. **安装 Lite 宿主扩展。** 使用 `packages/hosts/modules/creator-38/release/peanut-pod-lite-host-*/` 安装到项目 `extensions/peanut-pod-lite-host/`。该原生 Creator 扩展通过 Peanut Packaging 的共享只读验证器读取 `peanut-plugins/installed.json` 活动版本，完整校验后加载必需的 `peanut.pod-lite` 与可选的 `peanut.cocos-mcp-pro`；不扫描旧插件目录。
3. **通过 Peanut Packaging 安装 Core 能力包。** 安装器必须先校验目录包、原子写入插件目录和 schema v2 活动版本索引，再允许 Creator host 加载。不得手工伪造成功索引。
4. **启动 Creator 并等待宿主就绪。** 打开方式遵循 Hub `knowledge/cocos-creator-open.md`：3.x 用 `--project <abs> --nologin`；本工程已有 GUI 则 attach，不要再 spawn / 强杀；装宿主扩展后必须重启 Creator。只接受 `query-status` 返回 `ready: true` 且日志出现 `lite_host_ready`；未就绪时不得继续能力验收。
5. **运行只读冒烟测试。** 验证 `editor.queryVersion`、`editor.queryProject`、`editor.querySelection`、`scene.getCurrent`、`scene.getHierarchy`、`builder.queryPlatforms`、`builder.querySchema`、`builder.queryDefaultConfig` 与 `preview.query`；失败时停止，不继续任何写入测试。
6. **运行本地审批写入测试。** 先申请一次性审批租约，再执行一个可恢复的原生写操作；Core 不接受在线签名计划作为替代审批。
7. **运行原子创建矩阵。** 对 3.8.3 与 3.8.7 分别执行 `verify-managed-task-live.mts`，要求同一候选 Host/Core 身份下 Prefab/Scene 首次创建、同目标竞争、commit 前取消、UUID/`.meta`、唯一 postflight、零探针残留和日志增量全部通过。其它 3.8 补丁不得借此自动开放写入。
8. **运行吞吐长稳矩阵。** 对 3.8.3 与 3.8.7 分别执行 `verify-throughput-soak-live.mts`；默认包含 30 分钟正常混合负载、10 分钟持续过载，以及任务保留期后的回收检查。短时参数只允许验证 harness，不构成实机验收证据。

## 可选 Canvas 能力

UI Prefab 和 SnowB 的完整安装需要签名 Canvas 能力。构建 Host 时可设置 `PEANUT_HOST_NATIVE_CAPABILITY_ROOT` 为可信能力包根目录；该目录必须包含 `public-key.pem` 和当前平台的 `canvas/1.x/<platform>-<arch>/capability.manifest.json` 及载荷。打包器验证签名、文件摘要和本机加载能力后，将当前平台载荷复制到 Host 自身的 `native-capabilities/`，并计入发行摘要。Lite 源码不从 Pro 仓库自动定位或加载能力。

未设置变量时仍发布不含 Canvas 的 Lite Host。安装含 Canvas 的候选 Host 后须重启 Creator，保持常规包安装事务和原有授权检查；不能靠复制文件到运行中的 Host 绕过发行摘要。缺失或损坏能力只导致依赖 Canvas 的插件拒绝安装/激活，不阻断 Lite 的基本功能。

## 插件创建与生命周期

- 在 **开发者** 页选择 **创建插件**，分别使用 **Creator 3.8 Host** 或 **Peanut Core** 模板。生成目标必须为空目录；Core 模板自带符合运行时模块协议的 `register`、`activate`、`deactivate` 和 `dispose` 入口。
- 选择插件工作目录后，先预览，再用 **打包当前目录** 校验清单与所有文件摘要。仅打包成功的目录包可交给 Peanut Packaging 安装事务；宿主不得直接改写 `peanut-plugins/installed.json`。
- **插件** 页将本机安装状态与受信任目录产品分开显示。受信任条目必须通过目录签名、包摘要和 Creator 兼容范围校验；下载先进入隔离暂存区，再由安装事务提交。目录过期或不可用时，面板需明确显示状态，本地目录包及本机已安装版本仍可管理。
- 版本安装保留已有可用版本；安装失败不切换活动版本。可在版本页切换或回滚，修复会重新校验当前包。
- Lite Host 更新先暂存候选版本。选择重启后才原子切换，Creator 下次启动检查候选 Host；健康检查失败会恢复前一版本并记录失败原因。不要在 Creator 仍运行时手工覆盖宿主目录。

## 目录信任与 Pro 权益

远程插件目录使用独立公钥验证 `lite-plugin-catalog-v1` 签名；包下载按目录中的 SHA-256、产品 ID、版本及 Creator 兼容画像再验证一次。目录签名密钥只用于远程插件目录，不承担本地 Host/Core 安装身份校验。验收工程中的目录、测试 CA 和载荷都是项目隔离的临时测试材料，不是生产信任锚或正式产品发布。

当前仓库不提供公开第三方插件目录地址或生产目录公钥。未配置受信任目录读取器时，面板会显示目录不可用；不要把测试签名密钥用于生产。可通过 **Extension > Peanut Account** 设置 Pod 服务并登录，但 Pro 安装、升级和修复仍会在每次操作前重新向服务确认 `peanut.cocos-mcp-pro` 的最新权益；未登录、超时、过期或产品不匹配都在下载和写入前拒绝。登录令牌由宿主安全存储，不作为 URL、目录缓存或安装索引字段。

Creator 3.8.3 和 3.8.7 是当前已验证可写的 Creator 版本。Creator 2.4、3.0–3.5 仍为独立的实验性宿主；本生命周期面板与 Lite Host 自更新不向这些版本承诺支持。Linux 的系统密钥存储后端也可能拒绝 Pro 激活，Lite 不受影响。

## 构建候选与 Peanut Packaging 安装

本地可先构建宿主扩展与 Core 目录包。宿主与 MCP 目录包均使用本仓 esbuild，不再读取 `PEANUT_COCOS_EDITOR_ROOT`：

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

### 发布候选（维护者）

`npm run release:candidate` 先运行完整 `npm run verify` 与 `npm run pack`，再从 archive 字节重新核对 descriptor、Host/Core 摘要和 3.8.3/3.8.7 的 88/41/47 画像，要求 `sourceCommit` 等于干净 HEAD，并输出已核对的 Pod 自有候选描述。该命令不生成独立产品签名输入或公开发行清单。live 验收脚本带 `--release-descriptor release/peanut.pod-lite-<v>/lite-release-descriptor.json` 时会拒绝与候选身份不一致的 `query-status.artifacts`。

禁止在内部 module 目录单独安装依赖；仓库只维护根 lockfile。可选宿主发布物位于 `packages/hosts/modules/creator-24/release/` 与 `packages/hosts/modules/creator-30-35/release/`。

2.4 宿主安装到项目 `packages/peanut-pod-24/`；3.0–3.5 宿主安装到 `extensions/peanut-pod-35/`。

首装时，在 Creator 关闭且目标工程经过确认后，先将已核对的 Host 发行目录放置到 `extensions/peanut-pod-lite-host/`，再用 `PackagingApp({ projectPath })` 对当前候选的 Core 目录包执行 `validate → planInstall → install`；已有 Core 版本执行 `upgrade`，异常后执行 `repair` 并重新读取 `ProjectPackageStore.resolveVerifiedActivePackage`。这两个入口均属于本仓现有 Peanut Packaging 工作流。不要手写 `installed.json`，也不要把复制 Core 文件当作安装成功。启动 Creator 后，用 `query-status.artifacts` 与同一候选 descriptor 对照 Host/Core 摘要。

`peanut-pod-lite-host` 的 `query-status`、`list-tools` 与 `invoke-tool` 是 Creator 消息入口。`query-status.pro.state` 为 `absent`、`active` 或 `failed`；Pro 的版本、错误和已注册服务可独立诊断。`query-status.account` 描述登录与订阅快照，不得把订阅状态当成写盘许可。

## 订阅升级

Lite 可在未订阅时完整使用编辑器能力。升级入口在 Extension > Peanut Account：

1. 保存 HTTPS Pod 服务地址并登录（OIDC access token 由宿主加密保存）。
2. 查看订阅快照。未订阅时 `recommendedAction` 为 `upgrade`，打开 Server 签发的 checkout URL。
3. 账单成功后由 Pod Server webhook 写入权益；Creator 客户端不能自授。
4. 已授权但未安装 Pro 时 `recommendedAction` 为 `install-pro`。用 Peanut Packaging 安装 `peanut.cocos-mcp-pro` 后调用 `refresh-pro`。
5. Pro 激活失败只更新 `query-status.pro`，Lite 工具表保持不变。

## Pro 的后置安装

Pro 只能在上述 Core 验收全部通过后由 Peanut Packaging 安装。宿主使用 Electron `safeStorage`（Windows 为 DPAPI）持久化加密的 HMAC 材料，运行时只向 Pro 提供不可导出的 WebCrypto key；Linux 检测到 `basic_text` 后端时拒绝激活 Pro。进程内服务注册表由宿主注入调用方身份。Pro 安装、撤销、摘要不匹配或激活失败只更新 `query-status.pro`，不得移除、降级或阻塞 Core 已注册的能力。

## 失败与回滚

- 宿主安装失败：不创建能力包目录，保持项目无 MCP 扩展状态。
- 能力包摘要校验失败：删除未激活的暂存目录，不修改已生效 Core 版本。
- Pro 缺失或失败：保持 Core `ready: true`，撤销 Pro 已注册的服务并记录独立错误；不得把 Pro 错误提升为 Core 启动失败。
- 冒烟测试失败：停用 Core 能力包，保留宿主日志；不得安装 Pro。
- 本地审批测试失败：停用写入路由，仅保留只读能力，直到明确修复。

此顺序专门避免旧插件管理器、旧业务插件或 Pro 授权边界成为 Core 启动依赖。
