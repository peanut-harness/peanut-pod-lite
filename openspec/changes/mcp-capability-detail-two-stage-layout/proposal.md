# Proposal

## Why

当前 MCP 页面将能力目录、定义、JSON Schema、审批和调用记录同时塞入三栏，停靠窗口变窄时参数说明被挤压，能力名称也难以辨认。采用目录加详情的两段式结构，并让详情标题固定、正文独立滚动，能把空间留给实际内容。

## What Changes

- 将 MCP 能力页从三栏调整为左侧目录和右侧详情两段式布局。
- 右侧固定当前能力的步骤提示和名称，只滚动签名、说明、参数及次级内容。
- 将输入参数、JSON Schema、审批与最近调用组织在同一个详情区域中，并为窄面板提供可用重排。
- 保持现有能力选择、Schema、审批、调用记录及宿主通信行为。

## Capabilities

### New Capabilities
- `mcp-capability-detail-ui`: MCP 能力目录和两段式详情阅读体验。

### Modified Capabilities

## Impact

- 影响 Lite Plugin Manager MCP 面板的 HTML/CSS 和生成的面板资源。
- 不改变 MCP capability 协议、参数结构、审批流程或能力调用行为。
