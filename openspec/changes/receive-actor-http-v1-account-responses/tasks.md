# Tasks

交付 coordinated；checkpoint owner 为本执行会话，integration owner 为唯一 Workspace 总管。串行执行，不改生产配置。

- [ ] 1.1 `[peanut-pod-lite: openspec/changes/receive-actor-http-v1-account-responses/** | depends:none | serial | owner:pod-account | requirements:account-response-reception#Explicit account response formats | non-goals:不重开归档change]` 固定双格式与业务验证契约；验收：strict、task packet、登记和 preflight 通过。
- [ ] 1.2 `[peanut-pod-lite: packages/hosts/modules/creator-38/src/pod-account-client.js,packages/hosts/modules/creator-38/tests/account-session.test.mts | depends:1.1 | serial | owner:pod-account | requirements:account-response-reception#Explicit account response formats | non-goals:不切换地址或放宽请求生命周期]` 实现两种传输共享的严格 v1/raw 接收；验收：两格式、畸形/错误封套、原生回退及会话竞态回归通过。
- [ ] 1.3 `[peanut-pod-lite: packages/hosts/modules/creator-38/src/account-controller.js,packages/hosts/modules/creator-38/tests/account-pro-entitlement.test.mts | depends:1.2 | serial | owner:pod-account | requirements:account-response-reception#Trusted and current entitlement facts | non-goals:不允许部分权益替代完整Pro]` 校验可信设备和整数毫秒，兼容旧 ISO 期限，保留完整权益及新鲜查询；验收：设备/期限/部分权益/陈旧请求正反例通过。
- [ ] 2.1 `[peanut-pod-lite: openspec/changes/receive-actor-http-v1-account-responses/** | depends:1.3 | serial | owner:pod-account | requirements:account-response-reception#Distinct native acceptance evidence | non-goals:不冒称Server或Creator实机已完成]` 固化证据、执行完整规定验证并交付本地提交；验收：verify、pack、strict、scoped RAG、diff与精确回执通过，远端状态由集成 owner 推送回读后确认。
