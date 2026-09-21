# Proposal

## Why

Lite 已能在写后等待 AssetDB settle，并能用注册探针修复纯磁盘 copy/createFolder 的目录登记，但新建 Prefab/Scene 仍先落盘再刷新，Creator Assets 面板可能在主资源尚未登记时观察到文件并报告 `original asset is not exist`。该竞态是当前知识卡中唯一仍明确存在的核心正确性风险，必须在继续扩展批次事务和自动重试前关闭。

## What Changes

- 为新建 Prefab/Scene 定义单一原子创建事务：登记父目录、预留目标、通过受控 AssetDB 创建路径发布序列化内容，并等待真实 UUID、`.meta`、子资源和目录索引就绪。
- 将 `lumen.scaffold`、`prefab.createFromNode` 及其它会首次生成 Prefab/Scene 主资源的路径接入同一事务，禁止各入口自行采用“写文件后 refresh”的成功判定。
- 明确目标已存在、并发创建、创建中取消/超时、AssetDB pending、部分发布和清理失败的稳定结果；未能证明无项目变更时返回 `may_have_changed` 或更保守状态。
- 把原子创建证据纳入受管任务唯一 postflight，成功必须关联实际 AssetDB UUID、`.meta`、引用校验和干净的增量项目日志。
- 在 Creator 3.8.3 与 3.8.7 使用当前候选包运行首次创建、并发同目标、失败清理和 Assets 面板日志回归，并将产物身份与结构化报告绑定。

## Capabilities

### New Capabilities

- `assetdb-resource-creation`: 定义 Prefab/Scene 主资源经 AssetDB 原子创建、登记、冲突处理、失败清理和证据判定的外部行为。

### Modified Capabilities

- `mcp-write-task-execution`: 强化新资源写任务的 commit/postflight 契约，使任务只在原子创建已完成且 AssetDB 身份可验证时成功。

## Impact

- 主要影响 `packages/engine/modules/mcp` 的 AssetDB transaction、Lumen scaffold、Scene/Prefab gateway、资源规划、postflight 与相关测试。
- 可能需要扩展 `packages/engine/modules/runtime` 或 SDK 的提交证据类型，但不改变 83 项业务 operation、默认同步调用、审批租约或 Creator 画像规则。
- Creator 3.8 Host 只承担当前包安装、Bridge 调用和证据采集，不新增绕过 CPM/完整性校验的安装路径。
- `README.md`、`docs/MCP-TASK-QUEUE-DESIGN.md`、Creator 验证说明和 Lite/Hub 知识卡需要与最终行为同步。
