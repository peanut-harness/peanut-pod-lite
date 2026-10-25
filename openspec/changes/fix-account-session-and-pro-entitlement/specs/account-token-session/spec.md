# Spec Delta

## Purpose

提供 Creator 内访问令牌登录的会话隔离与可诊断失败行为，确保退出、换令牌和切换账户服务后旧请求无法恢复身份或沿用旧授权，并在 Node 14 宿主中以有限资源完成 HTTPS 请求。

## ADDED Requirements

### Requirement: Session changes invalidate pending results

系统 SHALL 在退出、替换令牌和切换账户服务后隔离旧请求的成功与失败结果，旧刷新不能恢复登录，旧 checkout 或权益请求不能提供有效授权。

#### Scenario: Logout while refresh is pending
- **WHEN** 用户退出后旧刷新成功或失败
- **THEN** 账户保持退出，旧结果不覆盖当前会话

#### Scenario: New session wins
- **WHEN** 新令牌登录完成后旧会话或较早刷新返回
- **THEN** 只显示当前会话的最新刷新结果

#### Scenario: Checkout completes after logout
- **WHEN** checkout 等待期间用户退出或切换服务
- **THEN** 返回明确会话失效错误且不返回可打开的支付链接

### Requirement: Credentials remain bound to their service

系统 SHALL 在持久化前验证并规范化 HTTPS 根地址；服务改变时清除旧令牌，无效输入不改变现有配置。

#### Scenario: Change service origin
- **WHEN** 用户将服务地址改为不同的有效 HTTPS 地址
- **THEN** 清除旧令牌并显示退出状态，新请求不携带原服务令牌

#### Scenario: Equivalent or invalid address
- **WHEN** 输入与现地址等价或输入无效地址
- **THEN** 等价地址保留会话；无效地址拒绝且不改变已有地址与令牌

### Requirement: Bounded Node 14 account transport

系统 SHALL 在没有全局 fetch 和 AbortController 的 Node 14 宿主中使用 HTTPS；拒绝重定向，限制响应体，并使总超时覆盖连接、响应与 JSON 读取，所有终态释放资源。

#### Scenario: Compatible runtime
- **WHEN** 全局 Web API 不可用且账户服务返回合法 JSON
- **THEN** 客户端通过兼容传输完成请求，不因缺少 Web API 失败

#### Scenario: Slow or excessive response
- **WHEN** 服务迟迟不返回响应体、返回超限数据或重定向
- **THEN** 请求在有界期限内失败，不泄露令牌或继续跨地址请求

### Requirement: Honest acceptance boundary

系统交付记录 MUST 区分协议测试、正式包和实际 Creator 验收；完整交互登录与 peanut-server 账户服务迁移保持独立待办。

#### Scenario: Locked workstation
- **WHEN** 无法操作 Creator 面板
- **THEN** 保留未完成实机任务，不用 Node 测试替代或宣称全部账户功能完成
