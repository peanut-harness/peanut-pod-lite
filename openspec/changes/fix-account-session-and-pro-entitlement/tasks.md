# Tasks

交付 coordinated；checkpoint owner 为当前执行会话，integration owner 为唯一 Workspace 总管。串行执行，真实账户/付款/部署与发布关闭。

## 1. Session lifecycle

- [x] 1.1 `[peanut-pod-lite: packages/hosts/modules/creator-38/src/account-controller.js,packages/hosts/modules/creator-38/tests/account-session.test.mts | depends:none | serial | owner:account-repair | requirements:account-token-session#Session changes invalidate pending results | non-goals:不新增交互登录]` 隔离退出、换令牌、并发刷新与 checkout 的过期结果；验收：可控乱序请求与失败用例，旧结果不恢复会话或授权。
- [x] 1.2 `[peanut-pod-lite: packages/hosts/modules/creator-38/src/account-session-store.js,packages/hosts/modules/creator-38/src/pod-account-client.js,packages/hosts/modules/creator-38/tests/account-session.test.mts | depends:1.1 | serial | owner:account-repair | requirements:account-token-session#Credentials remain bound to their service | non-goals:不改凭据格式]` 先验证规范服务地址，跨地址清除令牌，同地址保留；验收：非法输入不变、跨来源不发送旧令牌。

## 2. Compatible transport and panel

- [x] 2.1 `[peanut-pod-lite: packages/hosts/modules/creator-38/src/pod-account-client.js,packages/hosts/modules/creator-38/tests/account-session.test.mts | depends:1.2 | serial | owner:account-repair | requirements:account-token-session#Bounded Node 14 account transport | non-goals:不弱化TLS或跟随重定向]` 补齐 Node 14 HTTPS 传输与完整响应期限；验收：无 fetch/AbortController、慢响应体、超限及重定向用例通过。
- [x] 2.2 `[peanut-pod-lite: packages/hosts/modules/creator-38/panel/account/index.js,packages/hosts/modules/creator-38/tests/account-session.test.mts | depends:2.1 | serial | owner:account-repair | requirements:account-token-session#Session changes invalidate pending results | non-goals:不重设计面板]` 账户面板提交前清除令牌、异步失败可见且无未处理拒绝；验收：面板协议回归与语法检查。

## 3. Delivery evidence

- [x] 3.1 `[peanut-pod-lite: packages/hosts/modules/creator-38/package.json,docs,openspec/changes/fix-account-session-and-pro-entitlement | depends:2.2 | serial | owner:account-repair | requirements:account-token-session#Honest acceptance boundary | non-goals:不宣称服务端或完整登录完成]` 接入 canonical 测试并记录 verify、pack、strict、diff、scoped RAG 证据；所有要求通过后本地提交，远端集成由总管处理。
- [x] 3.2 `[peanut-pod-lite: openspec/changes/fix-account-session-and-pro-entitlement | depends:3.1 | serial | owner:account-repair | requirements:account-token-session#Honest acceptance boundary | non-goals:不使用真实凭据]` Creator 3.8.3/3.8.7 当前包的令牌登录、退出与地址切换面板验证；用户于 2026-10-25 确认 Pod Lite 验收通过，记录见 `evidence/user-acceptance-20261025.json`。

## Follow-up boundaries

完整交互登录待身份提供方/登录契约确认。Pro 的设备状态和 activeUntil 契约、账户订阅/offer/checkout 的 peanut-server 真实宿主迁移属于随后单独登记的服务端任务；本文件不是这些功能的完成记录。
