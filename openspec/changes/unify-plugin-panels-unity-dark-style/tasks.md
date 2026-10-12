# Tasks

## 1. Lite 面板

- [x] 1.1 将 Plugin Host Controller 改为紧凑的炭灰工具面板，并让表单、按钮和状态区随停靠视口重排；通过静态资源构建及窄宽/矮高布局检查确认无页面横向溢出。

## 2. Pro 面板

- [x] 2.1 调整 UI Prefab 的规范源码，统一中性深灰色层级，并确保所有主要页面填充面板可用空间、长列表与编辑器内部滚动；运行该包的 build/pack 检查发行副本。
- [x] 2.2 调整 SDF Font 的表单、图集预览和结果区，使其在窄宽/矮高视口重排且可达；修正面板 runtime 与 WASM 的源码构建路径，并运行该包的 build/pack 检查发行副本。
- [x] 2.3 调整 SnowB BMFont 的主题与三栏工作区，使两侧设置和中央画布能适配较小停靠视口且保留可操作入口；运行该面板 build/pack 并检查构建结果。

## 3. 集成验收

- [x] 3.1 执行 Pro 与 Lite 的规定验证，并检查源码/打包产物差异只包含本次面板变更；`openspec validate unify-plugin-panels-unity-dark-style --type change --strict` 通过。

## 4. 已批准的实机集成补齐

- [ ] 4.1 Creator Lite Host 装配可选的签名 Canvas 注册表，打包配置显式接收能力来源并把载荷纳入发行摘要；验证缺失载荷不阻断 Lite，完整载荷可用，签名/摘要不符被拒绝。
- [ ] 4.2 构建并更新测试宿主，通过正式安装 API 安装 UI Prefab 与 SnowB，核对实际激活状态；保留旧失败证据，并执行受影响的完整验证。
- [ ] 4.3 在真实 Creator 中逐个检查 SDF Font、UI Prefab、SnowB 和 Host Controller 的紧凑布局、窄宽/矮高适配、局部滚动及原有操作入口，保存实际截图；截图能力不可用时保持未完成。
