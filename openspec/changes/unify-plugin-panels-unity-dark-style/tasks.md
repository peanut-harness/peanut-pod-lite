# Tasks

## 1. Lite 面板

- [x] 1.1 将 Plugin Host Controller 改为紧凑的炭灰工具面板，并让表单、按钮和状态区随停靠视口重排；通过静态资源构建及窄宽/矮高布局检查确认无页面横向溢出。

## 2. Pro 面板

- [x] 2.1 调整 UI Prefab 的规范源码，统一中性深灰色层级，并确保所有主要页面填充面板可用空间、长列表与编辑器内部滚动；运行该包的 build/pack 检查发行副本。
- [x] 2.2 调整 SDF Font 的表单、图集预览和结果区，使其在窄宽/矮高视口重排且可达；修正面板 runtime 与 WASM 的源码构建路径，并运行该包的 build/pack 检查发行副本。
- [x] 2.3 调整 SnowB BMFont 的主题与三栏工作区，使两侧设置和中央画布能适配较小停靠视口且保留可操作入口；运行该面板 build/pack 并检查构建结果。

## 3. 集成验收

- [ ] 3.1 执行 Pro 与 Lite 的规定验证，并检查源码/打包产物差异只包含本次面板变更；`openspec validate --change unify-plugin-panels-unity-dark-style` 通过。
