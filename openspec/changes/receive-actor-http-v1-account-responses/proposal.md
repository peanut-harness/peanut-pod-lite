## Why

Pod Server 的新账户入口使用现有 actor-response v1 封套，旧部署仍返回 raw JSON。
Lite 当前直接消费响应体，会把封套或错误对象误当订阅；Pro 检查还将数字毫秒交给 Date.parse，
且没有要求可信设备状态。用户已于 2026-10-26 批准双格式兼容及账户权益修复。

## What Changes

- 按响应 media type 严格验证 v1 成功封套后解封，保留旧 raw JSON 的正常业务响应。
- 拒绝未知版本、损坏封套、200/ok=false 和无效业务对象，避免错误状态成为 signed_in。
- 订阅身份、设备、产品、状态和权益形状先校验；数字毫秒直接比较，旧 ISO 期限显式兼容。
- 保留会话代次、超时、响应上限、重定向拒绝及 Node 14 原生 HTTPS 回退。

## Capabilities

### New Capabilities
- `account-response-reception`: 版本化账户响应接收与权益边界。

### Modified Capabilities

无。

## Impact

仅修改 Creator 3.8 host 的账户客户端、控制器及两个账户测试文件和本变更材料。
producer 为 peanut-pod-server fix-account-session-and-pro-entitlement；本变更的协议验收
不能代替 producer 的真实 Native/PG/OIDC 验收。

## Non-goals

不切换生产服务地址，不退役旧 API，不实现交互登录，不部署、不使用真实账户或支付，不重复既有实机验收。
