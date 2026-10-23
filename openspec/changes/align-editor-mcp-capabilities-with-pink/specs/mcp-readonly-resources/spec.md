# Spec Delta

## Purpose

使标准 MCP 客户端能够按需发现和读取 Lite 工具说明及授权工程的资产元信息，减少重复询问与无界目录返回，并在标准协议入口保持原有身份、工程隔离、资源容量和只读访问边界。

## ADDED Requirements

### Requirement: Standard clients discover and read resources
系统 SHALL 在启用的标准 MCP 入口提供 `resources/list`、`resources/templates/list` 和 `resources/read`。

#### Scenario: Standard client initializes
- **GIVEN** 标准入口已启用且客户端通过认证
- **WHEN** 客户端完成标准 MCP 初始化并请求资源列表及模板
- **THEN** 客户端发现文档资源与按资产类型查询的模板，并可读取有效资源内容

#### Scenario: Existing private clients keep working
- **GIVEN** 旧客户端使用现有 action/NDJSON 私有入口
- **WHEN** 标准适配入口启用或关闭
- **THEN** 旧入口的鉴权、请求形状和响应契约保持可用

### Requirement: Resource content is declared and read only
系统 SHALL 将资源内容限定为声明的使用文档及既有查询允许的资产元信息。

#### Scenario: Documentation and asset metadata are requested
- **GIVEN** URI 对应已声明文档或授权工程内的资产类型/身份
- **WHEN** 客户端读取资源
- **THEN** 返回 URI、MIME 类型、内容及适用 revision，不发生工程写入，也不隐式执行工具

#### Scenario: Arbitrary files or sensitive content are requested
- **GIVEN** URI 包含未知资源、任意本机路径、路径逃逸、其他工程或凭据目标
- **WHEN** 客户端读取资源
- **THEN** 请求失败，不返回源码正文、访问 token、未筛选日志或未授权文件内容

### Requirement: Resource enumeration and reads are bounded
系统 SHALL 对资源列表、资产类型结果和读取内容执行已声明的条数、字节及 revision 一致性限制。

#### Scenario: Large type catalog is paginated
- **GIVEN** 一类资产数量超过一页上限
- **WHEN** 客户端读取该类型资源
- **THEN** 返回有界页和可续查信息，不一次输出整个资产目录

#### Scenario: Cursor no longer matches its context
- **GIVEN** 游标已过期或来自另一连接、工程、查询类型或 revision
- **WHEN** 客户端使用该游标续读
- **THEN** 返回稳定的游标失效结果并要求重新查询，不混合不同快照数据

#### Scenario: Content exceeds byte budget
- **GIVEN** 资源内容超过声明的响应字节上限
- **WHEN** 客户端请求读取
- **THEN** 返回可识别的超限结果及分片或精确查询建议，不静默截断成完整成功内容

### Requirement: Standard resource access preserves session isolation
系统 SHALL 使标准协议会话的资源权限受受信连接身份和工程生命周期约束。

#### Scenario: Caller forges ownership
- **GIVEN** 一个客户端尝试在输入中指定其他 connectionId 或工程身份
- **WHEN** 请求进入标准入口
- **THEN** 系统忽略或拒绝伪造身份，只使用认证后绑定的连接身份执行查询

#### Scenario: Project closes or capability is disabled
- **GIVEN** 资源所属工程关闭或相关能力撤销
- **WHEN** 客户端继续读取此前 URI 或游标
- **THEN** 返回不可用，既有会话和缓存不能绕过生命周期控制
