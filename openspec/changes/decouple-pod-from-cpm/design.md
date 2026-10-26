# Design

## Context

见 `proposal.md`。Lite 已有 `PackagingApp({ projectPath })`、`ProjectPackageStore`、Plugin Manager、目录包打包器和版本索引事务；Pro 也用自有脚本生成相同目录包。Creator 3.8 Host 则用独立的 `CpmPackageStore` 再次解析 `peanut-plugins/installed.json`、核验并加载 Core/Pro。`docs/INSTALLATION.md`、`release:candidate`、公开 CPM 变更和初始测试矩阵仍要求独立 CPM CLI/清单。现有项目索引 schema v2 与自有安装器共享磁盘布局，但读写规则可能有差异，不能只替换类名。

## Goals / Non-Goals

**Goals:**

- 让自有 Packaging 成为目录包、安装索引和 Host 加载的一致来源；保持逐文件校验、原子切换、上版恢复及 Core/Pro 隔离。
- Pod 构建、安装、测试和文档不再需要独立 CPM CLI、bootstrap、公开 manifest、产品 catalog 或相邻仓库。
- 旧工程先只读核对，再按兼容性决定原样接续或受控迁移；不将旧报告当作新候选通过。

**Non-Goals:**

- 不删除独立 `cpm-install` 仓库或改其面向其它产品的行为；不把此前 CPM 工作宣称为已完成。
- 不引入新的包管理器，也不要求重新设计 Plugin Manager 面板、Pro 订阅政策或 Creator 编辑业务。
- 不为验证而操作日常工程、发布 stable、执行付款或替换 Server 账号协议。

## Decisions

### 1. 安装写入仍由 Peanut Packaging 负责

继续使用 `PackagingApp` / `ProjectPackageStore` 的 `pack → inspect → planInstall → install/upgrade/repair/rollback` 路径。Host 首次放置沿用现有受控入口；Host/Core 发行身份和目录包摘要来自 Lite 自有打包结果。放弃以独立 CPM CLI 为首装中介，也不以手工写 `installed.json` 代替安装事务。安装前必须校验目标 Creator 已关闭、候选来源和原始包身份；验证步骤读取真实索引与 Host 状态。

### 2. Host 改用共享的受验证活动包读取

在 installation 公共边界提供适合 Host 启动的只读 `resolveVerifiedActivePackage`（名称可按项目惯例调整）：读取项目索引、活动版本、目录包和完整性，返回已验证入口及身份。Host 的 Core 和可选 Pro 共用该读取，不再独立维护 `CpmPackageStore`。现有 `ProjectPackageStore.inspect` 与旧 Host 负例需逐项比较；若共享检查缺少重复记录、路径逃逸、额外文件、链接、主入口纳入摘要等约束，先补齐后切换。`query-status.artifacts` 继续报告 Host/Core 包摘要，确保候选核对不断链。

### 3. 先兼容索引，再收敛命名

`peanut-plugins/installed.json` schema v2 是当前自有 Packaging 也在使用的项目持久格式，第一阶段保持字节兼容和目录布局，不通过品牌更名触发工程迁移。新读取器对历史记录重新核验；完全兼容则原样继续，歧义、未知 schema 或摘要不匹配则失败关闭并保留可恢复材料。确需格式演进时另行版本化迁移，写前保存旧状态、原子提交并验证回滚。代码、公开 API 与新文档逐步改用 Peanut Packaging 名称；旧 `cpm_*` 错误码如已被外部诊断消费，保留兼容映射并给出迁移说明，不静默丢失原因。

### 4. Pro 只依赖自有目录包契约

Pro 构建器改从 Lite installation 的自有完整性/manifest API 取得包规则，或将当前等价协议以 Pod 自有名称公开；运行产物需与 Host 共享校验器字节兼容。保持服务端实时权益、签名远程目录、归档摘要和本地写入审批。Pro 缺失或损坏只改变 `query-status.pro`，不阻断 Core。为避免先改生产协议导致 Pro 失装，先固定双方目录包测试向量，再更换构建器与 Host 读取入口。

### 4a. Pod 生产入口不再调用 CPM 专用协议

自有 installation 公共 API 承接当前目录包摘要、manifest 与签名规范，并固定与既有有效包相同的字节向量。`ProjectPackageStore`、`SignedPluginCatalogVerifier`、Host 更新器、Host/Core 身份比较及实机验收脚本转用该 API；`release:candidate` 只生成 Pod 自有候选身份与必要签名材料，不再引用 `cpm-install` 开发种子、`CPM_DEV_KEYS` 或公开 CPM release 格式。Pro 构建器跟随同一公共 API。生产导入和调用中不保留 CPM 专用类名；历史索引 schema v2 的磁盘字节与已被外部消费的错误码可在明确兼容边界保留，并以映射测试证明原因未丢失。历史测试向量和旧变更回执仅作追踪。

### 5. 测试矩阵按产品路径重绑定

安装用例的命令引用改为现有自有构建/安装入口，来源项改为 Lite Packaging 与 Pro 包身份。移除 `cpm-install` 对新候选的仓库和 stable 清单分母，保留此前报告作为历史证据；不删或重解释旧回执。新候选重新冻结提交、包摘要、Creator 版本和输入摘要，`not_run` 只有在隔离工程取得原始安装、加载、失败恢复及独立读回后才改变。其它五条主线不因来源变更自动通过。

### 6. 显式收敛旧 OpenSpec 承诺

`publish-signed-public-cpm-release` 尚有 5.x/6.x 未完成任务，其公开 CPM 承诺与新产品决策冲突。在该旧变更获得独立精确写集后，记录取代决定、已交付历史和未执行项，停止它的后续 Pod 派工；不勾选未完成项、不称发布成功，也不自动归档。主规格若已有对应正式条目，再以 delta 同步替换，避免长期并存冲突。`bind-pod-product-source-inventories` 的历史 CPM 来源同理保留追踪，其未来候选输入改为自有路径。

## Risks / Trade-offs

- [共享读取器校验弱于旧 Host] → 用同一组有效、篡改、链接、逃逸、重复、额外载荷和断电索引夹具对照；任何弱化先修正，未通过不切换 Host。
- [Host 首装与内置 Plugin Manager 存在引导顺序] → 保留现有 Host 放置入口，先安装/核对 Core，再重启宿主；不让尚未启动的面板承担首次 Host 放置。
- [旧工程格式或半途状态不一致] → 只读盘点、冻结前后摘要，兼容则原样接续；不兼容时拒绝并提供可恢复迁移，不自动重建索引。
- [Pro 与 Lite 跨仓协议漂移] → 固定共享测试向量与包摘要，先签收公共 API 和版本，再更新 Pro pin/构建器；不从私有 sibling 源码导入。
- [旧 CPM 名称散布在历史、vendor 和错误码中] → 区分生产依赖与历史追踪；生产入口清零，历史证据保留，兼容错误码按消费者证明逐项处理。
- [自有协议重命名引起摘要或签名漂移] → 先冻结目录包和签名的字节向量，再切换所有生产调用方；摘要、签名、Host 身份比较任一不一致即停止后续安装切换。

## Migration Plan

先冻结自有安装与旧 Host 的行为差异及精确候选；补齐共享只读校验并切换 Host；再调整 Lite 首装/包身份与 Pro 构建，随后重绑矩阵及文档、标注旧 CPM 规划取代关系。每阶段保留上一可用安装包与回滚路径；Lite 和 Pro 各自完成定向/根验证后，用具名隔离工程验证安装、升级、修复、回滚、Core/Pro 故障隔离及 Creator 3.8.3/3.8.7 的 Host 身份和基础操作。只有实际结果、普通集成推送与远端回读齐全才标代码交付；产品验收仍按真实运行证据单独判断。
