## Context

基线 d45da9f；旧令牌/会话变更已归档，复用其会话代次和请求生命周期保护。
本任务由原执行会话在单独登记工作树串行消费，coordinated 交付，由唯一 Workspace 总管集成。

## Decisions

1. 新 media type 为 application/vnd.peanut.actor-response+json;version=1。
   成功封套只接受 version/requestId/ok/result 四键，version=1、ok=true、requestId 为非空受限字符串。
   错误封套、未知版本、冲突字段和其他类型拒绝；HTTP 非成功仍沿用安全错误。
2. application/json 或缺少 media type 的旧 raw 输入可兼容；缺少 header 是既有注入 transport 契约。
   raw 对象若带 version/ok/result/error/requestId 封套标志，则拒绝含糊降级。明确的其他 media type 拒绝。
3. 两条传输共享解封与业务验证。subscription 必须具有租户/用户/设备身份、deviceRegistered=true、
   正确产品及包、合法状态和已知无重复权益。过期/撤销/none 不返回可执行权益。
   checkout 必须有明确 alreadyEntitled、产品及包；URL 只接受 HTTPS，无凭据。
4. 期限可为 null、非负安全整数 Unix 毫秒或合法旧 ISO 字符串；数字不经过 Date.parse。
   Pro 验证仍发起新请求，要求有效设备、active、完整六项权益及未过期；refresh 也先验证结果再 signed_in。
5. 正常 raw 响应字段不变。传输错误不回显底层异常或 token。面板、会话持久化和生产配置不变。

## Validation

对 fetch 注入和 Node 原生 HTTPS 回退验证新 v1 与旧 raw；负例覆盖未知版本、缺失 requestId、
错误封套、混淆 media type、设备缺失、期限类型、完整权益，以及登录代次竞态。
相关测试后执行 canonical verify/pack、strict、scoped RAG 和 diff；源码未变时复用已通过结果。
没有 producer 原生收据时明确保留其未完成状态，不将客户端测试计作 Server 或 Creator 实机证据。
