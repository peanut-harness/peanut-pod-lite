# Tasks

## 1. Align release ownership

- [x] 1.1 `[repo: peanut-pod-lite] [paths: openspec/changes/publish-signed-public-cpm-release/**] [depends: none] [serial] [owner: self-delivery]` 按本 change 的职责划分调整现有 CPM 发行 change：CPM 负责首次引导与信任交接，Lite 面板负责产品插件操作；验证产品目录契约唯一，且每个安装索引只有一个写入者。
- [x] 1.2 `[repo: peanut-pod-lite] [paths: packages/hosts/modules/creator-38/src/account-controller.js, Pod account contract] [depends: 1.1] [serial] [owner: self-delivery]` 确认 Pod 账号响应能在每次 Pro 安装/更新/修复请求中证明目标权益；如不足，通过 Hub 登记的 owner 扩展服务契约，并验证未登录、缺少/过期权益和服务超时均会在下载前拒绝。

## 2. Create and package plugins

- [x] 2.1 `[repo: peanut-pod-lite] [paths: packages/engine/modules/plugin-authoring/**, plugin templates] [depends: 1.1] [serial] [owner: self-delivery]` 定义并生成 Creator 3.8 Host 与 Peanut Core 插件模板；验证有效 ID 能生成预期文件，且无效、冲突 ID 或非空目标目录保持不变。
- [x] 2.2 `[repo: peanut-pod-lite] [paths: packages/engine/modules/kernel/src/panels/**, packages/engine/modules/kernel/src/builtin/builtin-plugin-manager-panel-module.ts] [depends: 2.1] [serial] [owner: self-delivery]` 通过安全宿主桥接把创建流程接入现有共享面板；验证用户能从面板生成两类模板，并查看生成路径。
- [x] 2.3 `[repo: peanut-pod-lite] [paths: packages/engine/modules/installation/**, packages/engine/modules/kernel/src/panels/**] [depends: 2.2] [serial] [owner: self-delivery]` 将面板校验和打包接入 `PackagingApp`，再通过现有项目事务提供本地包预览与安装；验证无效包不能进入可安装状态，且本地安装失败会保留活动版本。

## 3. Discover and download signed releases

- [x] 3.1 `[repo: peanut-pod-lite] [paths: packages/engine/modules/installation/src/integrity/**, packages/engine/modules/installation/tests/**] [depends: 1.1] [serial] [owner: self-delivery]` 定义产品目录 schema 与专用信任锚，尽量复用兼容的签名向量；验证身份、版本、渠道、兼容范围、URL、签名或摘要被篡改时都会拒绝。
- [x] 3.2 `[repo: peanut-pod-lite] [paths: packages/engine/modules/installation/src/remote/**, packages/engine/modules/installation/tests/**] [depends: 3.1] [serial] [owner: self-delivery]` 将远程目录和归档下载到隔离暂存区，并限制体积、拒绝不安全重定向与不完整载荷；验证摘要失败或取消操作不会留下暂存残留。
- [x] 3.3 `[peanut-pod-lite: packages/engine/modules/kernel/src/panels/**,packages/engine/modules/installation/**,apps/panel/panels/plugin-manager/embedded/**,packages/hosts/modules/creator-38/panel/plugin-manager/**,packages/hosts/src/plugin-panel-activator.ts,packages/hosts/modules/creator-38/src/plugin-manager-shell.js,packages/hosts/modules/creator-38/src/main.js | serial | depends:3.2 | owner:self-delivery | requirements:lite-plugin-lifecycle-management#Manage installed and available Peanut plugins in one panel | non-goals:不实现 Pro 权益门控、Lite Host 自更新、签名发行、端到端总验收或安装指南更新]` 在共享插件面板展示受信任目录中的可用版本、渠道、Creator 兼容范围、已安装版本和来源；目录不可用时保留本地包和已安装状态，并明确标记在线数据过期或不可用；验收：在线目录条目与本机安装状态同时可见且身份/来源不混淆，离线时本地包和已安装状态仍可用，目录过期或不可用有明确状态提示。实际 Creator main 可注入可控 test fixture reader 或已验签目录快照供面板展示；该注入不构成生产信任锚或目录服务。

## 4. Enforce authorization and manage versions

- [x] 4.1 `[repo: peanut-pod-lite] [paths: packages/hosts/modules/creator-38/src/account-controller.js, packages/hosts/modules/creator-38/src/pod-account-client.js, packages/hosts/modules/creator-38/tests/**, packages/hosts/modules/creator-38/src/plugin-manager-shell.js] [depends: 1.2, 3.2] [serial] [owner: self-delivery]` Pro 归档获取和包变更必须通过 `peanut.cocos-mcp-pro` 的最新服务端权益验证；验证令牌不进入 URL、日志、目录缓存或安装索引，且拒绝授权不影响 Lite/其他插件。
- [x] 4.2 `[repo: peanut-pod-lite] [paths: packages/engine/modules/installation/src/**, packages/engine/modules/kernel/src/panels/**] [depends: 3.2, 4.1] [serial] [owner: self-delivery]` 通过共享面板和既有不可变版本仓提供安装、更新、修复、卸载、版本选择、回滚与安全清理；验证失败事务保留最后可用版本，恢复状态不确定时采取保守报告。
- [x] 4.3 `[repo: peanut-pod-lite] [paths: packages/hosts/modules/creator-38/**, packages/engine/modules/installation/**] [depends: 4.2] [serial] [owner: self-delivery]` 为活动 Lite Host 增加暂存式自更新，将替换延迟到安全重启阶段；验证旧 Host 在重启前仍可用，重启后健康检查失败时能恢复或明确报告状态。
- [x] 4.4 `[peanut-pod-lite: apps/panel/panels/plugin-manager/embedded/index.js,apps/panel/tests/plugin-manager-panel-message-route.test.mjs,packages/engine/modules/kernel/src/app/plugin-manager-app.ts,packages/engine/modules/kernel/src/builtin/builtin-plugin-manager-panel-module.ts,packages/engine/modules/kernel/src/builtin/builtin-plugin-manager-panel-registration.ts,packages/engine/modules/kernel/src/panels/plugin-manager-panel-contracts.ts,packages/engine/modules/kernel/src/panels/plugin-manager-panel-ui-types.ts,packages/engine/modules/kernel/src/panels/plugin-manager-panel-ui.ts,packages/engine/modules/kernel/tests/builtin-plugin-manager-panel.test.ts,packages/engine/modules/kernel/tests/plugin-runtime-package-handoff.test.ts,packages/hosts/src/plugin-panel-activator.ts,packages/hosts/modules/creator-38/src/plugin-manager-shell.js,packages/hosts/modules/creator-38/tests/pro-package-gate.test.mts,packages/hosts/modules/creator-38/tests/trusted-catalog-install.test.mts,packages/hosts/modules/creator-38/src/main.js | depends: 3.3, 4.1, 4.2 | serial | owner: self-delivery | requirements: lite-plugin-lifecycle-management#Authenticate remote plugin releases before installation, lite-plugin-lifecycle-management#Require server-verified entitlement for Pro installation | non-goals: 不实现目录服务或新下载器，不使用真实账号或生产凭据，不发布产品版本]` 将已验签目录中的目标产品/版本连接到既有 RemotePackageDownloader 和 CPM 安装事务；Creator Host 必须在下载前校验 Pro 目标权益；验收：真实 Creator 面板可对受控 HTTPS 测试目录执行 Lite/其他插件下载与 CPM 安装；Pro 权益拒绝时 downloader 调用次数为零，授权通过后安装身份/版本与签名目录一致；篡改、取消和安装失败保持旧活动版本并清理本事务暂存内容。

## 5. Integrate and document

- [ ] 5.1 `[repo: peanut-pod-lite] [paths: packages/engine/modules/kernel/tests/**, packages/engine/modules/installation/tests/**, packages/hosts/modules/creator-38/tests/**] [depends: 2.3, 3.3, 4.3, 4.4] [serial] [owner: self-delivery]` 在受支持 Creator fixture 中端到端验收创建、打包、本地安装、远程安装 Lite/其他插件、有权/无权安装 Pro、更新、回滚、离线和 Lite Host 重启；核对身份、索引、错误与恢复证据一致。
- [ ] 5.2 `[repo: peanut-pod-lite] [paths: docs/INSTALLATION.md, README.md, packages/engine/modules/installation/README.md] [depends: 5.1] [serial] [owner: self-delivery]` 更新安装与开发指南，说明引导到面板的交接、插件模板、远程信任模型、Pro 登录/权益要求、版本恢复和当前平台限制；核对文档操作与面板及发行契约一致。
