# Creator 视口控制

Lite 提供三项 Creator 编辑器视口工具：

- `viewport.queryState`：读取 2D 模式、网格可见性和相机位置/朝向/视点/比例。
- `viewport.focusNodes`：按精确节点 UUID 或完整路径聚焦相机，不修改场景选区。
- `viewport.setState`：设置 2D 模式和/或网格可见性，并逐字段回读。

能力只在 Creator 宿主精确为 3.8.3 或 3.8.7 时开放。模式、网格和聚焦使用 Creator `scene` 官方消息；相机数值由 POD 已声明的场景脚本桥读取，输出先筛选为 JSON 数字字段。相机管理器在 Creator 类型声明中属于内部接口，因此宿主版本不匹配、脚本桥不可用或相机数据无效时都明确返回不可用，不回退到旧缓存。

聚焦目标必须在当前层级中唯一解析为节点 UUID。Creator 的聚焦消息返回 `void`，因此单凭消息成功不代表相机已对准目标；实现再次读取相机数据，只有观察到相机状态变化才返回 `verified`。相机没有变化时返回 `accepted_unverified`，包括相机已处于目标视点的情况。设置模式或网格时分别检查设置消息和官方查询结果；一个字段失败不会隐藏其它成功字段，结果会列出 `accepted`、`verified`、`actual` 和 `failureCode`。

`viewport.focusNodes` 与 `viewport.setState` 是本地审批写操作，必须使用绑定当前连接、操作和风险的审批租约。工具成功条件是任务完成、日志 postflight 通过、`result.data.ok=true`、`status=verified` 且所有字段均验证通过。用户手动改变模式或网格后，`viewport.queryState` 总是向 Creator 请求当前值，不复用旧状态。

实机验收应在独立 QA 工程分别使用 Creator 3.8.3 和 3.8.7，记录精确版本、工具响应和 `project.log` 增量。分别检查手动状态变化、单节点与多节点聚焦、目标不存在/路径歧义、模式/网格设置与字段级失败；比较运行前后的 Scene、Prefab、`.meta` 摘要，并确认没有保存弹窗或源资产变化。Node 测试只覆盖消息边界、状态验证和拒绝行为，不替代两版 Creator 实机证据。
