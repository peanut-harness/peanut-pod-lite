# Changelog

## Unreleased

- 新增 `IMcpFailureDetails`、失败分类/状态/推荐动作联合类型与 `IMcpAiHandlingGuidance`；MCP Hub 可在保留旧 `error` 字段的同时追加结构化 `failure`，属于向后兼容扩展
- 补充 `README.md`，明确 `@peanut/pod-protocol` 的职责、子域边界和消费方式
- 在 `package.json` 中增加 `exports`、`sideEffects` 和测试文件清单
- 新增 `shared/common-contracts.ts`，提供 `ContractPayload`、`PluginId`、`PanelId`、`TaskId`、`PluginVersion`、`IsoDateTimeString`
- 将现有 plugin / permission / panel / task 契约改为复用共享语义类型
- 为 contracts 包补充 `shared`、`panel`、`task` 子域测试
- 收紧 `peanut-plugin-manager` 对共享别名的消费，保留其宿主 API 与面板专用 DTO 在本地模块内
