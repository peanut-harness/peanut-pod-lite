## ADDED Requirements

### Requirement: Explicit account response formats

客户端 SHALL 严格解封指定 media type 的 actor-response v1，并兼容合法旧 raw 账户响应。

#### Scenario: Both supported success formats
- **WHEN** fetch 或原生 HTTPS 收到合法 v1 或旧 raw 业务响应
- **THEN** 返回一致的业务对象，既有超时、上限与重定向规则继续生效

#### Scenario: Ambiguous or erroneous envelope
- **WHEN** 版本未知、封套损坏、缺少 requestId、media type 冲突或 HTTP 200/ok=false
- **THEN** 拒绝结果，不产生 signed_in 或 Pro 授权

### Requirement: Trusted and current entitlement facts

客户端 SHALL 校验设备、身份、产品、权益及期限事实后才建立登录状态或授予完整 Pro。

#### Scenario: Numeric and legacy expiry
- **WHEN** 收到安全整数毫秒或合法旧 ISO 期限
- **THEN** 按同一真实时间判断期限，数字不交给 Date.parse

#### Scenario: Device and complete entitlement boundary
- **WHEN** 设备无效、事实损坏、已过期、部分权益或会话已更换
- **THEN** 不能通过完整 Pro 检查，旧请求不能恢复已退出的会话

### Requirement: Distinct native acceptance evidence

交付 MUST 区分客户端协议测试、Creator 实机和 Server 原生验收。

#### Scenario: Consumer-only validation
- **WHEN** 客户端测试与正式包检查通过，但 producer 原生验收仍缺失
- **THEN** 仅记录消费者检查点，不宣称真实账户宿主或生产替代完成
