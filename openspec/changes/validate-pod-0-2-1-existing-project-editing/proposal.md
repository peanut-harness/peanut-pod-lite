# Proposal

## Why

Pod Lite 0.2.1 已在现有 Creator 3.8.3 与 3.8.7 工程完成自有安装路径的升级和修复，但测试矩阵的“基础编辑”仍缺同一候选的原生编辑、保存重开与独立读回证据。现有受管任务脚本只覆盖创建、并发和后验，不能直接据此判定整条产品主线通过。

## What Changes

- 在两份现有测试工程内定义同一冻结 Host/Core 候选的最小编辑链：受控创建 Prefab/Scene、保存并重开、AssetDB 身份与缺失引用读回、增量日志后验；原生组件与代码矩阵另列未验证明细。
- 为每次运行规定精确工程写入命名空间、备份和占用检查、失败停止与恢复规则；保留旧日志缺失及先前 `library` 错误记录。
- 将真实运行结果逐条回填 Pod 测试矩阵；证据未齐时维持 `not_run` 或明确失败，不把既有 20/0 smoke 与静态草稿升格为产品通过。

## Capabilities

### New Capabilities

无。此变更只补测试执行与证据，不改变产品能力要求。

### Modified Capabilities

无。既有 `mcp-write-task-execution` 和 `assetdb-resource-creation` 行为保持原样；本变更按 `.openspec.yaml` 的 `skip_specs: true` 跳过 delta spec。

## Impact

影响 Lite 的 Creator 实机验收脚本、两份现有测试工程中的本任务资产命名空间、`docs/testing/pod/` 计划与矩阵证据。不得新建或重置工程，不访问真实 Server/账号，不发布 CPM。运行、源码和工程写入须分别完成精确登记与 preflight；本次规划登记本身不开放这些动作。
