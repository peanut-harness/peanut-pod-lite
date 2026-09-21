# Peanut Pod Lite

Cocos Creator 编辑器产品。Lite 公开 83 项免费操作（38 读、45 写/破坏性）；所有原生写入都必须消费绑定连接、操作、资源与风险的本地审批租约。Pro 始终可选，缺失或升级失败不得阻断 Lite。

## 五个工作区

- `packages/protocol`：稳定 DTO、版本与宿主上下文协议，不依赖其它工作区。
- `packages/sdk`：插件作者 API，只依赖 `protocol`。
- `packages/engine`：运行时、安装、资产、Lumen、MCP、策略与内核，只依赖 `protocol`、`sdk`。
- `packages/hosts`：Creator 宿主壳、进程识别与一次性版本画像，只依赖 `protocol`、`sdk`、`engine`。
- `apps/panel`：静态面板应用与嵌入资源，不依赖引擎或宿主。

内部实现保留在 `packages/engine/modules/*` 与 `packages/hosts/modules/*`，但不再是 npm workspace，也不维护独立 lockfile。依赖安装、构建和测试只从仓库根执行。

## Creator 适配

- `creator-24`：Creator 2.4，实验支持，默认禁止写入。
- `creator-30-35`：Creator 3.0–3.5，实验支持，默认禁止写入。
- `creator-36-37`：显式不支持，不会误落到 3.8 写入适配器。
- `creator-38`：Creator 3.8；当前宿主与工程均精确匹配已验证的 `3.8.3` 或 `3.8.7` 时允许写入。

宿主启动时只解析一次 `CreatorContext`。未知版本、宿主与工程版本不一致、或缺少实机证据时均 fail-closed。

Creator 3.x 新建 Prefab/Scene 时，Lite 先预留目标与父目录，再由 AssetDB `create-asset` 或 Creator 原生 Prefab 发布器完成首次可见写入；成功必须同时取得真实 UUID、`.meta`、适用子资源、引用与干净日志证据。普通文件写入后 refresh 只用于已有资源更新，不能作为首次创建成功判据。

版本画像只维护 `specs/creator-profiles/creator-profiles.json`，运行时代码由 `npm run generate` 生成。内部 engine/host 模块由各自 manifest 的 `peanut.internalDependencies` 自动发现和拓扑执行，新增模块不需要再修改根任务脚本。

## 验证

```powershell
npm install
npm run generate:check
npm run verify
npm run pack
```

结构与版本画像见 `docs/ARCHITECTURE.md`；Core/Pro 安全边界见 `docs/BOUNDARIES.md`；安装与实机验收见 `docs/INSTALLATION.md`；吞吐容量、批次语义、指标与 soak 清单见 `docs/SINGLE-PROJECT-THROUGHPUT.md`。Creator 实机证据由独立 QA 工程保存，本仓不提交本机日志、临时验收转储或测试工程绝对路径；Node 测试不能替代编辑器实机验证。
