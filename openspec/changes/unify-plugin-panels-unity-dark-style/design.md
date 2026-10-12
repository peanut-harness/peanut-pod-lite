# Design

## Context

参见 `proposal.md` 与 `specs/plugin-panel-ui/spec.md`。Pro 与 Lite 是独立仓库，不能共享运行时样式包。UI Prefab 和 SDF Font 使用 HTML/CSS；SnowB 使用 MUI；Lite Host Controller 是静态 HTML/CSS 面板。Pro 的发行文件由各自 pack/build 脚本从源码生成。

## Goals / Non-Goals

**Goals:**
- 以已确认的 Cocos 面板截图为视觉基准：中性炭灰层次、紧凑控件、清晰分隔和少量蓝色焦点提示。
- 用当前面板视口而非浏览器外层窗口决定排版；横向分区可以收缩/重排，内容超出时在局部滚动。
- 保留面板已有功能与宿主桥接。

**Non-Goals:**
- 不改 Plugin Manager 宿主界面、插件业务逻辑、协议或数据格式。
- 不把 Pro/Lite 合并为共享运行时依赖，也不手改生成的发行副本。

## Decisions

- 各仓库在各自 UI 技术栈内定义一组语义化颜色与尺寸值；不增加跨仓样式依赖。颜色以炭灰底色和浅灰文字为主，蓝色只用于选中/焦点等需要强调的状态。
- 使用 `width/height: 100%`、`min-width/min-height: 0`、`minmax(0, 1fr)` 和适当的容器断点处理停靠视口。面板不得设置会裁切宿主的最小宽高或居中最大页面宽度。
- 仅让长列表、设置栏、规则编辑区、预览结果等内部区域滚动；标题、主要操作区和面板框架保持在视口中。窄视口应把并排内容改为纵向或提供可用的分区切换入口。
- 只修改 Pro 面板源码并调用现有打包脚本生成发行内容；Lite 面板沿用现有静态资源构建路径。
- 用户于 2026-10-12 批准补齐 Canvas 宿主集成。Creator Host 从自身发行包装配 NativeCapabilityRegistry，保持签名和逐文件摘要验证。打包配置显式指定能力来源，Lite 不依赖 Pro 仓库路径；载荷计入 Host 的发行摘要。未配置时 Lite 正常启动，依赖 Canvas 的插件仍明确拒绝安装。

## 实机续验收

已有 UI 构建任务完成后，测试工程仅保留 Lite Core。通过正式开发安装 API 安装 SDF Font 成功；UI Prefab 与 SnowB 因 native_capability_unavailable:canvas 拒绝。本轮 self-delivery，checkpoint owner 与 integration owner 均为当前任务，沿用用户已授权的 Pro/Lite 主检出。原安装失败证据保留，新增宿主能力与真实安装验收单独记录。

## Risks / Trade-offs

- SnowB 的左右设置栏和画布共用空间较多 → 窄面板下优先压缩栏宽，并提供可切换的设置区，避免画布不可用。
- UI Prefab 有多个页面和嵌入式覆盖样式 → 以宿主中的 embedded 页面实际入口为准，并在窄宽/矮高尺寸检查规则编辑和资源设计等长内容页面。
- 不同 Creator 版本的嵌入 Chromium 对新式 CSS 支持有差异 → 使用已支持的 Grid/Flex 与传统媒体查询；避免把关键布局行为仅放在 `:has()` 上。

## Migration Plan

1. 修改各插件源码面板。
2. 运行现有包构建/打包流程刷新嵌入发行资源。
3. 执行各仓规定的结构、构建和同步检查；出现回归时回退对应面板源码并重建发行资源。

## Host Controller 的 Lite 槽位适配

保留默认通用工作台，另外声明 plugin-host-1/2/3 三个静态 Creator 面板。每个槽位独立保存插件上下文、刷新代次与事件清理；请求携带槽位身份，并继续校验已激活插件、贡献面板和真实安装路径。原生 bridge 接收真实宿主扩展名，Pro 未提供该字段时继续兼容 peanut-pod。关闭仅清理指定槽位，非法槽位与停用插件明确拒绝。验收包括 A/B 分别加载、关闭 A 后 B 保持可用、无效槽位/旧调用方回归及实机截图。
