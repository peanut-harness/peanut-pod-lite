# Proposal

> 历史候选状态（2026-10-26）：本 change 的四项任务已按当时的 Pro、Server、CPM 四仓来源候选完成，记录和回执保持原样。Pod 当前候选已在 [decouple-pod-from-cpm](../decouple-pod-from-cpm/proposal.md) 中移除 CPM 依赖；当前测试矩阵的来源分母使用 Lite Packaging、Pro 包身份和 Server 审阅来源。下文的 CPM 适配器与旧候选仅供历史追溯，不是当前产品验收入口。

## Why

现有测试矩阵已能诚实显示六条业务主线的未执行状态，但 Pro、Server、CPM 仍被列为缺少来源仓库，能力分母无法用于跨产品缺口导航。当前环境已有 Pro 的固定操作目录、Server 的账户实现与迁移记录、CPM 的公开 schema v2 清单；需要把这些只读来源绑定到候选身份，同时保留未发布和未完成宿主验收的边界。

## What Changes

- 只读接入 Pro 核心 84 项与高级 15 项 JSON 目录，并按来源摘要、提交与精确目录项生成独立能力分母；未映射项逐项显示，不因已有单测而计入产品通过。
- 为 Server 建立可审阅的账户路由来源声明，逐项绑定实现文件摘要与迁移限制；Actor 尚未完成的真实宿主验收继续作为缺口。
- 为 CPM 公开 `releases.json` schema v2 增加固定适配器，区分清单来源完整与 stable 发行可用。当前空 `releases` 只能证明公开入口按设计拒绝，不能算成功安装。
- 更新初始输入、来源说明和报告回归，保留六条主线及两版 Creator 的未执行状态；不改现有证据三轴、CLI 执行边界或其他产品仓库。

## Capabilities

### New Capabilities

- `pod-product-source-inventories`: 将 Pro、Server、CPM 的具体只读来源绑定到矩阵分母，并对空发行、目录漂移、缺根和未完成真实验收保持保守状态。

### Modified Capabilities

无。

## Impact

主要改动位于 Lite 的 `tools/pod-test-coverage/`、对应定向测试、`docs/testing/pod/` 和本 OpenSpec change。读取 Pro/Server/CPM 的现有文件需显式本地根与 SHA-256；不修改这些仓库，不运行输入命令、Creator、服务或网络，也不发布 CPM stable 清单。
