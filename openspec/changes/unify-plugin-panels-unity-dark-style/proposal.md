# Proposal

## Why

Peanut Pod 的插件面板目前使用不同的颜色、间距和布局策略；部分面板在编辑器窗口缩放后仍保留固定宽度或高度，造成内容拥挤、裁切或大片空白。用户已确认以 Cocos Plugin Manager 的紧凑深灰界面为视觉参考，需要把这套风格和真正随可用窗口变化的布局落实到现有插件页面。

## What Changes

- 为所有已有独立插件面板统一深灰中性色、文字层级、控件、边框、间距和焦点状态。
- 让面板使用宿主提供的完整宽高；按可用尺寸调整导航、栏位和表单排列，并把滚动限制在合适的内容区域。
- 保持现有插件操作、数据和宿主通信行为不变。
- 在 Creator Lite Host 中接入已签名的可选 Canvas 原生能力，解除 UI Prefab 与 SnowB 的真实安装阻塞；能力载荷通过显式打包配置提供，缺失时仅拒绝依赖该能力的插件。

## Capabilities

### New Capabilities
- `plugin-panel-ui`: 已有插件面板遵循统一视觉风格，并适配编辑器提供的可用空间。

### Modified Capabilities

## Impact

- Pro：UI Prefab、SDF Font、SnowB BMFont 的面板源码与其构建/打包入口。
- Lite：Plugin Host Controller 面板源码及面板静态资源构建。
- Lite OpenSpec：新增插件面板 UI 能力规范。
- Lite Host：原生能力注册表装配、可选载荷打包与安装验收。

## 已批准的实机宿主补齐

Host Controller 仍调用旧 Pro 消息，Lite 缺少固定槽位。用户于 2026-10-12 批准本轮新增 Lite Host A/B/C 适配：动态选择宿主消息接收者，固定槽位分别绑定活动插件，加载或关闭一个槽位不影响其他槽位。

用户于 2026-10-12 批准修复 UI Prefab 包边界：保留 MCP 优先与离线绑定回退，通过插件自身的窄 Cocos 序列化适配器完成控制器引用写入，移除 Lumen 内核运行时依赖，不放宽包测试。
