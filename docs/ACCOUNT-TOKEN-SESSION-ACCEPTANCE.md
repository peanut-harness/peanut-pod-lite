# 令牌登录与会话检查点

本记录只覆盖 Lite 客户端令牌会话子线，不表示账户功能、完整登录或服务器迁移完成。

## 已修复与验证

- 退出、替换令牌和切换服务后，在途刷新/checkout/权益响应失效；较早刷新不能覆盖最新账户。
- HTTPS 服务地址先验证再规范化；地址变化清除旧令牌，相同地址保留会话；无效输入不改变配置。
- 缺少 fetch/AbortController 时使用 Node HTTPS，保持 TLS 验证、禁止重定向、限制响应体为 1 MiB；默认总期限 10 秒，可注入 1–30000 毫秒，包含响应体解析。
- 面板提交前清空令牌输入，异步失败可见且不显示底层错误细节。

定向账户回归 13/13、Host JavaScript 语法检查通过。测试使用合成凭据、临时目录与受控传输，不能证明 Creator 或真实 OIDC 已通过。

## 尚未完成的验证

首次完整 verify 在沙箱中因 tsx IPC EPERM 拒绝；沙箱外进入 Host 测试后因新工作树缺少 lite-release-descriptor.json 失败。正式 pack 按既有 clean-tree 门禁报告 lite_release_source_dirty。按 Hub 的本地 checkpoint 流程先完成 scoped 知识同步并提交代码候选，再在干净工作树 pack/verify，不手写或绕过产物门禁。当前不能报告全仓 verify 或正式 pack 通过。

Creator 3.8.3/3.8.7 面板仍待解锁后操作，完整交互式登录按用户决定另列待办。Pro 设备状态与到期时间契约不在本客户端子步骤中改写；服务端按用户决定基于 peanut-server 公共 Actor/HTTP/Native 框架开发，业务归 peanut-pod-server，真实原生宿主验收单独记录。Node InProcessActorRuntime 不能替代该验收。

原始通过、失败与限制见 [客户端检查点证据](../openspec/changes/fix-account-session-and-pro-entitlement/evidence/client-checkpoint/validation.json)。没有使用真实账号、付款、生产部署、发布或触发/核验 GitHub Actions。

Scoped RAG 已在总管处理共享知识同步后回读通过：`ok scope=peanut-pod-lite chunks=542`。上述 stale 记录保留为历史失败，不改写成首次通过。当前可形成待正式 pack/verify 的本地代码检查点；实机任务继续未完成。

## 干净工作树最终后台验证

本地代码检查点 `e8915cbee2dcd380b438f8cb47b0dc8a235ad39a` 后，正式 `npm run pack` 与完整 `npm run verify` 均退出 0。缺失描述文件前置已解决，原失败日志保留。Host package digest 为 `2609b0234273bfb7cb136dbf5f38b3b2af1ac0a895bdf9e7d992fb3f3815c93c`；Core 为 `f6eeba550bf4c9ba36e4ed9eab33bd9622c84c739a5d466c40e7bedd398c1d79`，完整描述文件及两条原始命令日志见 [最终后台证据](../openspec/changes/fix-account-session-and-pro-entitlement/evidence/client-clean-validation/validation.json)。

3.1 后台验证已完成；3.2 两版实际面板仍未完成。知识同步回读通过仅对应总管注明的共享主线事实 attestation，不代表本分支已集成或已到远端。当前为 coordinated 本地检查点，未推送或合并本轮账户改动；集成后正式发布包身份仍须绑定实际交付提交。

## 用户验收确认

用户于 2026-10-25 确认 Pod Lite 验收通过。该确认用于关闭 OpenSpec 3.2；本次总管整理没有重新运行 Creator 面板，也没有生成实机截图或设备日志。代码自动验证仍以 `evidence/client-clean-validation/validation.json` 中的检查点为准。完整交互式登录和 peanut-server 服务迁移仍是独立待办。
