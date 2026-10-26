# Proposal

## Why

Pod 已有 Peanut Packaging 与 Plugin Manager 负责目录包构建、校验、安装和版本维护，但 Creator Host 启动、安装文档与测试矩阵仍把独立 CPM CLI/公开发行当成产品必经路径。用户已明确决定 Pod 今后完全不依赖 CPM；需要把安装事实统一到自有工具，同时安全接续已有工程。

## What Changes

- **BREAKING:** Pod 不再要求、发布或调用独立 `cpm-install` CLI、bootstrap、公开 stable 清单或 CPM 产品目录；Pod 的正式安装与验收改用 Peanut Packaging / Plugin Manager 的自有构建和安装入口。
- Host 启动 Core/Pro 时与自有 `PackagingApp` / `ProjectPackageStore` 共享同一受验证的项目安装事实，保留包摘要、原子版本切换、失败恢复及 Pro 可选隔离。
- 对已安装工程提供有限兼容读取或一次性迁移，明确旧索引、包身份、Host 布置和回滚条件；不通过手工改索引声称安装成功。
- Pro 目录包构建与 Lite 自有完整性契约对齐，替换对外 CPM 命名和跨仓发行依赖；不削弱签名目录、权益核验或本地写入审批。
- 清除 Pod 生产构建、Host 更新、远程目录验签、候选身份核验脚本对 CPM 专用类、协议和公开发行密钥开关的调用；旧索引字节格式与已被消费的诊断码只为兼容保留，不再构成 CPM 运行依赖。
- 重写 Pod 安装用例与离线矩阵来源，改绑自有构建、安装和 Host 证据；历史 CPM 来源保留为历史记录，不计入未来当前候选分母。
- 在已有的 3.8.3/3.8.7 专用隔离工程上，以 Lite `0.2.1` 新候选验证从 `0.2.0` 的真实递增升级、回退与修复；两工程本轮前已安装 Core，因此不把它们当作空工程首装证据。自有 Packaging 的临时工程首装夹具另列，产品首装实机缺口继续可见。
- 将未完成的 `publish-signed-public-cpm-release` 标记为被本决策取代，并在单独登记后调整其规划与产品文档；不得把未完成任务勾选或归档为已交付。

## Capabilities

### New Capabilities

- `pod-self-managed-installation`: Pod 通过自有 Packaging 安装和启动 Core/Pro，安全接续现有工程并提供可核对的安装验收。

### Modified Capabilities

无。当前主规格尚无 Pod 安装能力条目；既有未归档变更中的 CPM 规划将按显式取代关系单独收敛。

## Impact

影响 Lite 的 installation 包、Creator 3.8 Host、构建与发行脚本、安装文档、Pod 覆盖矩阵及相关测试；影响 Pro 目录包构建器与发布说明。`cpm-install` 仓库不作为 Pod 实现或写入目标。Server 账号协议、Creator 编辑操作和 UI Prefab 阶段三权限边界保持各自独立门禁。此变更须按 Lite/Pro 精确任务写集登记，先验证旧工程兼容，再更新正式安装口径。`0.2.1` 仅作为本变更的新 Lite 候选；Pro 不随之改版，代码交付和产品实机首装验收分别记录。
