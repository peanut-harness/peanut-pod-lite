# Proposal

## Why

Lite 当前把本地插件开发/打包、远程发现与下载、版本切换和 Pro 权益校验分散在不同入口，用户需要理解多套流程。把这些能力收敛到现有插件面板，可让 Peanut 插件从创建到安装、更新和回滚有一致的入口，同时保持 Pro 的服务端授权边界。

## What Changes

- 在共享插件面板加入插件创建向导、模板文件生成、包校验与打包，并支持将本地包安装到当前 Creator 项目。
- 在同一面板提供受签名保护的 Peanut 插件目录、远程下载、安装、更新、版本选择、回滚、修复和卸载；保留首次安装所需的轻量引导入口。
- 复用 Lite 现有账号会话与订阅查询；安装或更新 Pro 前要求登录，并由 Pod 服务端重新验证目标产品权益，必要时扩展为按产品/操作授权。客户端缓存快照不能单独授权安装。
- Lite、Pro 和其他 Peanut 插件共用包身份、版本和安装状态展示；远程正式包仅接受受信任目录中的签名发行，本地开发包按明确的本地安装流程处理。
- 调整未完成的 `publish-signed-public-cpm-release` 规划，使 CPM 与 Lite 面板的职责一致，避免两个入口各自管理产品版本和安装状态。

## Capabilities

### New Capabilities

- `plugin-authoring-workbench`: 在共享插件面板创建插件、校验包、打包并安装本地开发包。
- `lite-plugin-lifecycle-management`: 在共享插件面板管理 Lite、Pro 与 Peanut 插件的可信远程发现、下载、安装、升级、版本切换、回滚和修复，并对 Pro 执行服务端权益验证。

### Modified Capabilities

- 无。现有 OpenSpec 主规格中没有覆盖插件作者工作流或 Lite 内置远程插件生命周期的能力；正在进行的 CPM 发行 change 需要在实施前协调其产品安装职责。

## Impact

- **代码：** `packages/engine/modules/installation/**`、`packages/engine/modules/kernel/src/panels/**`、内置插件管理面板、Creator 3.8 Host 账号与包管理桥接。
- **产品界面：** 现有共享插件管理面板和设置面板；新增创建、开发包、在线目录及版本操作。
- **信任边界：** 远程目录与包必须验签并校验摘要；Pro 安装/更新需服务端针对目标产品的授权判定；令牌不得进入日志、下载 URL 或包缓存元数据。
- **兼容与迁移：** 保留现有项目级版本索引与原子安装/回滚契约；首次安装仍由轻量引导入口启动，后续产品包生命周期由 Lite 插件面板管理。需协调 Pod 账号服务的权益校验契约，以及 `publish-signed-public-cpm-release` 的现有设计与任务。
