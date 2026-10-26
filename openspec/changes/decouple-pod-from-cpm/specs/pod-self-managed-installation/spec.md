# Spec Delta

## Purpose

让 PeanutPod 使用自身的目录包构建、项目安装和 Creator 宿主加载能力交付 Lite 与 Pro，并在旧工程迁移及失败恢复时维持可核对的包身份，不再依赖独立 CPM 发行体系。

## ADDED Requirements

### Requirement: Pod installation is self-managed

Pod SHALL 通过自有 Peanut Packaging / Plugin Manager 产出的受验证目录包和项目安装事务安装 Lite Core 与 Pro。正式 Pod 安装、启动、升级和修复 MUST 不要求独立 CPM CLI、bootstrap、公开 release manifest 或相邻 `cpm-install` 检出。现有 Host 放置入口 SHALL 在 Creator 启动前与该项目安装事实匹配。

Pod 生产构建、远程目录验签、Host 更新、候选身份核验和实机验收脚本 MUST 调用自有目录包与签名契约，不得导入或调用 CPM 专用协议。既有工程的索引 schema v2 磁盘格式和已被消费的诊断码 MAY 在有兼容测试时保留；这些兼容字节不得要求 CPM 工具或密钥开关存在。

#### Scenario: Fresh isolated project
- **WHEN** 调用方以自有入口将相同候选身份的 Host 与 Core 安装进受支持且已关闭的 Creator 工程
- **THEN** 安装结果可独立读取包版本、摘要和项目活动身份，Host 启动并仅从已验证的活动 Core 加载

#### Scenario: CPM is absent
- **WHEN** 执行正式安装与 Creator 启动的环境没有 CPM CLI、公开清单或 `cpm-install` 仓库
- **THEN** 自有安装与加载仍可完成，且结果不回退到手工索引写入或未验证目录扫描

#### Scenario: Pod production entrypoints
- **WHEN** 构建 Lite/Pro 目录包、验签远程目录、更新 Host 并核对候选身份
- **THEN** 各入口使用 Pod 自有协议且保留已冻结的包摘要和签名字节；生产依赖清单不包含 CPM 专用 API 或 `CPM_DEV_KEYS`

### Requirement: Installer and Host share one verified installation state

项目安装器与 Creator Host SHALL 对活动版本索引、目录包结构、逐文件摘要和包身份采用同一自有契约。缺失、重复、逃逸、链接、额外载荷、摘要漂移或版本错配 MUST 在加载前失败关闭；Pro 的缺失或失败 MUST 不移除或降级已验证的 Lite Core。

#### Scenario: Valid active version
- **WHEN** 自有安装事务已原子提交活动版本，Host 读取到完整且一致的安装记录与目录包
- **THEN** Host 报告与安装记录一致的 Core/Pro 身份，并只加载已验证入口

#### Scenario: Tampered or incomplete state
- **WHEN** 活动索引或任一包文件被篡改、删除、替换为链接或指向工程外路径
- **THEN** 相应包不被加载，错误保留可诊断原因，未受影响的 Core 状态仍独立可用

### Requirement: Existing projects remain recoverable

系统 SHALL 明确识别既有项目索引和已安装包：与新自有契约完全兼容的记录可经重新核验后继续使用；不兼容状态 MUST 给出可恢复的迁移或拒绝结果，不得静默重写、丢弃上一可用版本或误报成功。升级、回滚与修复 MUST 保留上一已知可用版本；恢复无法证明时 MUST 报告 `may_have_changed` 或更保守状态。

#### Scenario: Compatible existing installation
- **WHEN** 旧工程的活动索引和目录包满足新契约的全部身份与完整性规则
- **THEN** Host 与自有 Plugin Manager 对活动版本给出相同结果，无需独立 CPM 才能继续启动

#### Scenario: Incremental Lite upgrade in an existing isolated project
- **WHEN** 已验证的 Lite `0.2.0` 活动包在 Creator 关闭时通过 Peanut Packaging 升级到独立构建且版本递增的 `0.2.1` 候选
- **THEN** 安装器将操作判定为 `upgrade`，保留上一可用版本，重启后的 Host 与 Core 身份均绑定 `0.2.1` 候选；损坏或中断时只按可验证状态回退或修复，且 Pro 的独立状态不使 Core 降级

#### Scenario: Legacy ambiguity or interrupted migration
- **WHEN** 旧记录含歧义、坏摘要、未来 schema，或迁移在提交边界中断
- **THEN** 系统停止加载或后续变更，保留原状态与恢复证据，不通过重建索引掩盖未知工程状态

### Requirement: Pro admission survives the packaging migration

Pro 目录包 SHALL 由 Pod 自有构建路径生成并被同一安装契约校验。远程 Pro 获取或安装、升级、修复 SHALL 继续要求 Server 当前权益核验；本地写入风险 SHALL 继续要求原有审批。Pod MUST 不因移除 CPM 而接受未签名的远程目录、未核验包或仅凭客户端订阅快照授权。

#### Scenario: Entitled Pro installation
- **WHEN** 当前服务端权益通过且 Pro 目录包身份、Creator 范围、签名来源与文件摘要全部匹配
- **THEN** 自有 Plugin Manager 提交 Pro 活动版本，Host 在不影响 Lite Core 的前提下激活它

#### Scenario: Missing entitlement or corrupt package
- **WHEN** 权益不可核对或 Pro 包校验失败
- **THEN** 工程状态在写入前保持不变，Lite Core 继续可用且 Pro 错误独立报告

### Requirement: Product evidence follows the self-managed route

Pod 测试矩阵 SHALL 将自有构建、安装、加载、升级和恢复列为当前候选的来源与用例，不把独立 CPM 清单的可用性作为 Pod 分母或安装验收前置。历史 CPM 记录 MAY 作为追溯材料保留，但 MUST 不计为新候选当前通过；未执行与不适用结果 SHALL 分别呈现。

#### Scenario: New Pod candidate
- **WHEN** 矩阵绑定新 Lite/Pro 候选及自有安装入口的原始证据
- **THEN** 安装主线按该候选的实际安装、Host 身份与独立读回判定，缺证据时仍为未完成

#### Scenario: Existing-project evidence is separated from fresh installation
- **WHEN** 当前候选只在已安装 Core 的隔离 Creator 工程上完成递增升级与修复
- **THEN** 报告只记录该升级与修复证据，不把它或临时夹具首装升格为真实 Creator 空工程首装；缺少的产品首装与长稳证据保持未执行

#### Scenario: Historical CPM report
- **WHEN** 仅有此前的 CPM 发布、bootstrap 或旧工程回执
- **THEN** 报告保留来源追踪，但不把它提升为 Pod 当前安装通过或发行可用性
