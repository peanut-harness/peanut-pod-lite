# peanut-pod-lite
## 架构与所有权
Cocos Creator 编辑器产品，拥有内核、版本宿主、Lumen、editor-mcp 与订阅升级入口；付费能力只广告、不执行。
- `packages/protocol`：跨层契约；`packages/sdk`：公开客户端 API。
- `packages/engine`：与版本无关的能力；`packages/hosts`：进程发现与版本适配。
- `apps/panel`：面板与浏览器脚本。
## 验证入口
在仓库根运行 `npm run verify`；`npm run pack` 构建宿主包。
工程测试不替代真实 Creator、SDK 兼容性、异常与资源关闭验证；构建包不代表获准发布。
## 证据与未决项
SDK/监听器和 Creator 适配的最新状态以任务回执为准。历史 5.1、窗口诊断等未完成事实不因本次整理被关闭。
[知识路由](INDEX.md)；[整理前原文](history/2026-10-30/overview.md)；[摘要清单](history/2026-10-30/manifest.json)。
