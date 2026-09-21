# Spec Delta

## Purpose

定义公共 CPM CLI 与 Lite 产品包从签名发行、可信下载、原子安装到 Creator 激活验收的完整分发契约，使用户能够安全安装和升级，同时让任何身份、完整性或恢复证据缺失都保持失败关闭。

## ADDED Requirements

### Requirement: Public CPM releases are authenticated by a fixed trust anchor
系统 SHALL 只接受由公开引导程序内置或等价固定配置的 Ed25519 信任锚验证通过的 CPM release；release 身份、版本、渠道、HTTPS URL 与 SHA-256 必须共同受签名保护，签名私钥不得进入公开仓库、runtime archive、产品目录包或客户端环境。

#### Scenario: A valid stable release is selected
- **GIVEN** stable manifest、固定信任锚和 release 签名一致，且 release 使用不可变 HTTPS URL 与合法语义化版本
- **WHEN** 用户通过公共引导入口请求 stable 渠道
- **THEN** 系统选择该渠道最高的已验证版本，并在下载任何可执行内容前固定其身份、URL 与摘要

#### Scenario: Manifest key or signature is invalid
- **GIVEN** manifest 公钥与固定信任锚不一致、签名缺失或签名不能验证声明字段
- **WHEN** 引导程序读取非空 release manifest
- **THEN** 系统在安装目录发生任何变化前拒绝发行，并返回稳定的信任校验错误

#### Scenario: Published version is reused with different bytes
- **GIVEN** 同一 release id 与版本已发布
- **WHEN** 发布流程观察到不同 URL、摘要、签名或 runtime 内容试图复用该版本
- **THEN** 系统拒绝覆盖既有发行并要求使用新版本号

### Requirement: Bootstrap installation is atomic and recoverable
系统 SHALL 在 Bash 与 Windows PowerShell 公共入口中完成 CPM runtime 的下载、双层校验、受控解包和原子 current 切换；路径逃逸、符号链接、特殊文件、隐藏额外载荷、清单外文件或摘要不一致 MUST 在激活前被拒绝。

#### Scenario: Clean bootstrap installation succeeds
- **GIVEN** 目标机器满足公开声明的运行前置条件，release 与 runtime manifest 均有效，且目标版本尚未安装
- **WHEN** 用户执行公共 Bash 或 PowerShell 安装命令
- **THEN** 系统将完整 runtime 写入版本化目录，原子更新 current 指针，执行版本查询冒烟，并以零退出码返回已安装身份

#### Scenario: Runtime archive is unsafe or corrupt
- **GIVEN** runtime archive 包含路径逃逸、链接、特殊文件、额外文件或任一摘要不匹配
- **WHEN** 引导程序校验或解包该 archive
- **THEN** 系统拒绝激活、清除本次下载和暂存内容，并保持原 current 版本不变

#### Scenario: Activation fails after staging
- **GIVEN** 新 runtime 已完整暂存但 current 切换或安装后冒烟失败
- **WHEN** 引导程序结束本次安装
- **THEN** 系统恢复或保留上一可用 current 版本，并报告可诊断失败而不留下指向不完整版本的状态

### Requirement: CPM installs authenticated Lite Host and Core packages
系统 SHALL 通过显式项目命令安装版本匹配的 Creator Host 与 `peanut.pod-lite` Core，先验证产品发行真实性，再验证目录包 manifest 与逐文件摘要，最后原子写入 Creator 扩展目录、CPM 版本目录和 schema v2 活动索引；本地 tarball、手工复制或仅成功下载不得被认定为正式安装。

#### Scenario: Lite is installed into a clean Creator project
- **GIVEN** 目标工程关闭 Creator，Host/Core 产品 release 已认证且目录包完整，并声明受支持的 Creator 精确版本
- **WHEN** 用户通过 CPM 对该工程执行 Lite 安装
- **THEN** 系统写入版本匹配的 Host 与 Core、提交活动版本索引，并在 Creator 重启后使 `query-status` 报告与发行身份一致的 Core ready 状态

#### Scenario: Host and Core identities do not match
- **GIVEN** Host、Core、release manifest 或项目活动索引的版本/摘要无法组成同一已发布候选
- **WHEN** CPM 计划安装、升级或修复 Lite
- **THEN** 系统在激活前拒绝该组合，保持原已安装版本可用并返回身份不一致错误

#### Scenario: Pro is absent or fails
- **GIVEN** Lite Host/Core 有效，但 Pro 未安装、未授权、摘要错误或激活失败
- **WHEN** CPM 完成 Lite 安装并启动 Creator 验收
- **THEN** Lite Core 仍可达到 ready，Pro 仅以独立状态报告且不得回滚或阻塞 Lite

### Requirement: Product upgrades and repairs preserve the last known good installation
系统 SHALL 使 Lite 升级、修复和失败恢复基于不可变版本目录与原子活动索引，并在新版本未通过包校验、激活或宿主冒烟时保留上一已知可用版本；任何可能修改过工程但无法证明回滚完成的结果 MUST 明确报告保守状态。

#### Scenario: Lite upgrade succeeds
- **GIVEN** 工程存在一个已验证的 Lite 版本，且更高版本 Host/Core 通过全部发行与包校验
- **WHEN** 用户执行升级并重启 Creator
- **THEN** 系统切换到新版本、保留可审计的前版本记录，并证明 Host/Core 身份、工具目录与版本画像属于新发行

#### Scenario: Lite upgrade fails before activation
- **GIVEN** 新版本下载、解包或目录包校验失败
- **WHEN** 升级尚未切换活动索引
- **THEN** 系统清理本次暂存内容，旧版本继续保持活动且工程状态为 unchanged

#### Scenario: Lite activation cannot be proven
- **GIVEN** 活动索引已切换，但 Creator 启动、Host/Core 身份或 ready 冒烟无法完成
- **WHEN** 恢复流程不能证明旧版本已完整恢复
- **THEN** 系统停止后续安装，报告 may_have_changed 或更保守状态，并要求查询工程后再重试

### Requirement: Stable publication is evidence gated and remotely verified
系统 SHALL 仅在 CPM 自身安全门禁、Lite 构建门禁、干净安装/升级/恢复矩阵、Creator 3.8.3 与 3.8.7 实机激活以及独立 QA 证据全部绑定同一不可变发行后发布非空 stable manifest，并在发布后回读公共 HTTPS 端点验证用户实际获得的字节与声明一致。

#### Scenario: Release candidate passes all gates
- **GIVEN** CPM runtime、Lite Host/Core 和对应清单已固定身份，所有正负测试与两版 Creator 验收通过，且独立 QA 报告不含秘密
- **WHEN** 发布流程准备写入 stable manifest
- **THEN** 系统签名并发布不可变 release，回读 manifest、runtime 与产品包摘要，随后公共 Bash/PowerShell 干净安装均成功

#### Scenario: Any required evidence is missing
- **GIVEN** 签名、摘要、许可证/清单、失败恢复、某一受支持 Creator 版本或独立 QA 中任一必需证据缺失或不一致
- **WHEN** 发布流程评估 stable readiness
- **THEN** `releases.json` 保持空列表或维持上一 stable 版本，不得把本地构建或部分通过结果宣传为正式发行

#### Scenario: Post-publication remote verification fails
- **GIVEN** stable manifest 已更新，但公共端点回读的 manifest、脚本、archive 或产品包与批准身份不一致
- **WHEN** 发布后验证运行
- **THEN** 系统停止继续推广并恢复到上一可验证 manifest 或重新进入 fail-closed 状态，同时保留事件证据
