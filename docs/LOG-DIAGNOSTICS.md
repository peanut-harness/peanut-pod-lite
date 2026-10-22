# 日志诊断

`peanut.editor-mcp.diagnostics-query-logs` 是 Lite 只读工具，只查询当前授权工程的 `temp/logs/project.log`，不接受文件路径或正则。

```json
{"mode":"search","contains":"error","contextBefore":2,"contextAfter":2,"limit":100}
```

- `tail` 从尾部向前分页；`nextCursor` 继续同模式翻页。
- `delta` 从给定 `followCursor` 顺序跟随；省略游标则从头开始。
- `search` 从头顺序搜索，`contains` 为区分大小写的字面文本；使用 `nextCursor` 继续。
- `levels` 可过滤 error/warn/info/debug/trace/unknown；上下文保留原始堆栈，无法识别级别保持unknown。
- 默认最多100匹配、每侧2行上下文；每侧最多10行，单次读取含游标指纹最多1MiB，UTF-8 JSON结果最多64KiB。
- 超长行会分片并标记 `fragment`；`truncated` 表示仍有页或片段，不能据此宣称已查完整日志。
- `pendingLine` 表示尾部尚未完成的行，保留游标等待追加；不消费未完成UTF-8字符。
- 游标绑定当前工程、文件代次、前缀和位置指纹，并由宿主签名。轮转、清空或替换时 `resetDetected=true`；宿主重启会使旧游标失效。
- 日志缺失、无权限、路径逃逸、非普通文件和读取期间变动分别返回失败；不将其伪装成空日志。

只有 `response.ok=true` 且 `result.ok=true` 才算观测成功，失败读取 `failureCode`。搜索为空不代表工程通过验收；继续使用原有 `preview.queryErrors` 的增量验收流程。

当前阶段：Reader、真实Router和策略/MCP回归已通过；Creator实机与整体交付以对应OpenSpec任务和证据为准。
