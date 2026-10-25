# Design

## Context

当前 Creator 3.8 Host 使用 CommonJS 协议入口，正式打包目标 node14。账户配置与加密令牌由 AccountSessionStore 持有；Host 消息和面板都复用 LiteAccountController。原因见 proposal.md。

## Goals / Non-Goals

**Goals:** 保证令牌来源隔离、退出与在途结果一致、请求期限覆盖完整响应；保留既有消息名。

**Non-Goals:** 不新增身份提供方、密码或刷新令牌协议，不改变 Pro 权益判定，不部署、不付款。服务端迁移依赖单独登记的 peanut-server 公共接口消费者任务，不写框架业务代码。

## Decisions

1. Controller 使用会话代次与刷新序号。退出、替换令牌、切换规范服务地址时提升代次；旧响应和旧错误都不能覆盖当前状态。checkout 和权益请求完成后复核代次，失效请求不能返回有效授权或支付 URL。仅依赖取消不够，因为远端或传输可能已完成。
2. SessionStore 在写地址前执行 HTTPS 根地址校验和规范化。地址变化时先清除旧令牌；同一规范地址保留会话。无效地址不改变存量配置。此处不新增凭据格式或持久化刷新令牌。
3. 默认传输使用 Node HTTPS；注入 transport 保持测试兼容，且总期限覆盖响应体解析。重定向失败关闭，响应体大小有限制，计时器和流在终态释放。Host 组装显式注入原有 global fetch 测试替身时仍可验证旧协议，但实际 Node 14 不依赖 fetch/AbortController。
4. 面板统一处理异步失败，令牌字段在提交前清空；不把错误堆栈或令牌显示给用户。后台响应重新呈现当前 Host 状态。

## Risks / Trade-offs

- 地址变化要求重新输入令牌 → 避免将原服务凭据发送给新服务，保留相同规范地址的会话。
- Node 测试无法证明 Creator 正式包已运行 → 单独保留实际 Host/面板验收任务；锁屏时不得勾选。
- 旧 Pro 到期与设备契约有缺口 → 纳入后续服务器契约检查，不借本步骤宣称权益功能已补齐。
