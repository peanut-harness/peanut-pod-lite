# Proposal

## Why

令牌登录存在可复现的会话竞争：退出后的旧刷新会恢复登录，切换服务地址后旧凭据会用于新服务。Creator 3.8.3 的 Node 14 没有全局 fetch，现有客户端不能依赖开发机的 Web API。

## What Changes

- 退出、替换令牌和切换服务地址时使旧请求失效；旧响应不能恢复会话或授权 checkout。
- 服务地址先校验再写入，跨服务变更清除旧凭据；保留同一规范地址的有效会话。
- 使用有界、拒绝重定向的 HTTPS 传输，兼容 Node 14，覆盖响应体读取与超时释放。
- 完整交互式登录另列待办；服务端以 peanut-server 公共框架为基础，产品业务仍归 peanut-pod-server，另行登记实施。Pro 权益契约缺口不在本 Lite 子步骤中静默修复或宣称完成。

## Capabilities

### New Capabilities

- `account-token-session`: 令牌登录会话隔离、异步响应失效与兼容传输。

### Modified Capabilities

无。

## Impact

Creator 3.8 Host 的账户 controller、session store、client 与账户面板，以及相关回归测试。保持既有消息名和订阅/checkout API；不使用真实凭据，不部署、不付款、不发布。
