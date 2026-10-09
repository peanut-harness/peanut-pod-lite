# Spec Delta

## Purpose

让 Lite 的共享插件面板成为 Peanut 插件发现、安装和版本维护的统一入口，覆盖 Lite、Pro 与其他受信任 Peanut 插件，并保留首次安装所需的轻量引导流程。

## ADDED Requirements

### Requirement: Manage installed and available Peanut plugins in one panel
共享插件面板 SHALL 展示受信任目录中的可用 Peanut 插件与当前工程已安装插件，统一显示插件身份、已安装版本、可用版本和兼容信息，并提供安装、升级、卸载、修复、版本切换和回滚操作。

#### Scenario: View available and installed plugins
- **WHEN** 用户打开插件面板且在线目录可用
- **THEN** 系统展示可用版本和当前工程安装状态，并区分本地包与远程发行

#### Scenario: Catalog is unavailable
- **WHEN** 网络或目录服务不可用
- **THEN** 系统保留已安装版本管理和本地包操作，并清楚标记在线数据不可用

### Requirement: Authenticate remote plugin releases before installation
系统 SHALL 只从受信任的签名目录接受远程 Peanut 插件发行；在下载前验证目录签名、插件身份、版本、渠道、Creator 兼容性和不可变 HTTPS 地址，在下载后校验归档 SHA-256，并在安装前验证包内 manifest 与文件摘要。身份、签名或兼容性校验失败 MUST 在工程状态变化前拒绝。

#### Scenario: Install a valid remote release
- **WHEN** 用户选择兼容的已签名版本并确认安装
- **THEN** 系统下载到隔离暂存区、校验签名与摘要，再交由版本化安装事务提交

#### Scenario: Remote release is tampered or incompatible
- **WHEN** 目录签名、包摘要、插件身份或 Creator 兼容范围不匹配
- **THEN** 系统拒绝下载后续可执行内容或拒绝激活，并保持现有版本和工程索引不变

### Requirement: Preserve immutable versions and recover failed changes
系统 SHALL 将 Peanut 插件各版本保存在不可变版本目录，通过原子活动索引启用版本，并支持回滚到仍保留的已验证版本；下载、校验或提交失败 MUST 清理本事务暂存内容且保留上一已知可用版本。若无法证明恢复成功，系统 MUST 报告 `may_have_changed` 或更保守状态并停止后续变更。

#### Scenario: Upgrade and roll back a plugin
- **WHEN** 用户升级插件后选择回滚到仍保留的已验证版本
- **THEN** 系统原子切换活动版本并在面板中显示实际生效版本

#### Scenario: Upgrade fails before commit
- **WHEN** 下载、校验或暂存阶段失败
- **THEN** 系统清理本次暂存内容，旧活动版本保持可用且索引不变

### Requirement: Require server-verified entitlement for Pro installation
Pro 的下载、安装、升级或修复 SHALL 要求用户已登录，并由 Pod Server 验证当前账号对目标 Pro 产品具有有效权益；客户端订阅快照、缓存或界面状态 MUST NOT 单独授权该操作。权益验证失败时 MUST 在工程状态变化前拒绝操作，认证令牌 MUST NOT 写入日志、包 URL 或发行缓存元数据。

#### Scenario: Authorized account installs Pro
- **WHEN** 已登录用户请求安装或升级 Pro，且 Pod Server 确认权益有效
- **THEN** 系统允许继续执行签名发行校验和安装事务，并独立报告 Pro 状态

#### Scenario: User is signed out or lacks entitlement
- **WHEN** 用户未登录、权益失效或 Pod Server 拒绝授权
- **THEN** 系统提示登录或升级订阅，不下载或安装 Pro，也不影响 Lite 与其他非 Pro 插件

### Requirement: Keep first-install bootstrap small and hand off ongoing management to Lite
首次安装入口 SHALL 只负责取得并验证 Lite 启动所需的受信任发行；Lite 激活后，Peanut 插件的发现、下载、安装与版本维护 SHALL 由共享插件面板统一发起并展示。Lite Host 自身需要重启才能安全替换时，系统 MUST 先暂存并验证新版本，再提示安全重启完成切换。

#### Scenario: First Lite installation
- **WHEN** 用户尚未安装 Lite 并运行公开首次安装入口
- **THEN** 入口安装并验证 Lite 所需的最小启动组件，随后将插件生命周期管理交给 Lite 面板

#### Scenario: Upgrade the active Lite Host
- **WHEN** 用户从 Lite 面板选择更新当前正在运行的 Lite Host
- **THEN** 系统先完整下载和验证目标版本，提示用户安全重启，并只在安全切换后更新活动版本
