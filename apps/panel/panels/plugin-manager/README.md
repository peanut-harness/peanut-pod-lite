# Plugin Manager Panel Mirror

这个目录是 plugin-manager 面板静态资产的唯一源码源头。

当前约定：

- 不把这里当作主源码目录
- 宿主固定从 `embedded/index.html` 加载面板；`standalone/` 为未来 Vite bundle、worker、wasm 等资源保留
- 修改 panel 静态资源时只修改本目录

## 插件管理视图

- 顶部导航保留插件管理、开发者、MCP、设置和关于；包管理以 Unity 原生暗色 Package Manager 为布局和外观基准：灰色编辑器工具栏、分类／连续列表／详情三栏、紧凑按钮与小图标；窄窗口保持三栏并横向滚动。
- 设置是同一工作台中的导航页，保存后仍留在当前面板；不打开弹窗或独立窗口。
- 详情分为简介、版本、运行控制标签页；支持方向键、Home、End。运行标签仅在当前插件具有匹配的运行记录时显示；版本区不会展示旧选择的安装快照。
- 正式版显示 registry 来源，开发版显示 local/manual 来源。只使用宿主提供的目录、安装索引和运行记录；没有来源条目的运行插件以“当前工程”显示，仍可在详情访问运行控制。
- 同一插件在列表合并为一个条目，版本选择只列出当前渠道；只有 SemVer 更高的版本计入“可更新”。简介来自所选插件的运行记录，缺失时不生成介绍或其他商店信息。
- 安装、更新和版本操作沿用原有桥接。运行按钮、卸载与版本维护须与当前详情身份一致，切换或等待期间不允许操作旧选择。
- 创建、源码目录打包和来源维护位于开发者区域。独立打开 HTML 时显示未连接宿主的空态，不提供示例插件或模拟安装结果。
- 独立 `file://` 预览使用普通脚本加载；页面脚本没有模块依赖，不能改为会受本地文件 CORS 限制的 `type="module"`。验收须确认脚本已启动、空态和导航可用，不能只检查静态 HTML。

验证入口：`npm test --workspace @peanut/pod-panel`；运行控制与安装桥接回归：`npm test --prefix packages/engine/modules/kernel`。交互单测不能替代 Creator 实机或像素级视觉验收。Unity 结构参考：https://docs.unity3d.com/6000.0/Documentation/Manual/upm-ui.html 。
