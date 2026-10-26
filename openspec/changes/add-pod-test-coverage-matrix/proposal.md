# Proposal

## Why

PeanutPod 的 Lite、Pro、Server 与 CPM 已有不同层次的测试，但没有一个能区分“已登记测试”“历史通过”“当前候选通过”“仍缺实机证据”的整体视图。当前 Pro 根 verify 不包含所有插件业务测试，Server 替身测试也不证明真实依赖可用；需要可重算、保留未知项的能力—用例—证据矩阵，指导后续验收并防止扩大通过结论。

## What Changes

- 在 Lite 增加离线覆盖工具和版本化输入格式，从显式提供的 Lite/Pro/Server/CPM 来源快照建立能力分母，映射现有测试入口和六条业务主线；不扫描未指定工作空间目录。
- 原样接收 Lite editor-stability 的版本化分母和验证结论，保留未核实组件、importer 与动态注册项；不另造资源矩阵或放宽其校验器。
- 独立记录测试定义、实际执行结果、证据完整性与候选适用性；历史通过、预期拒绝、环境阻塞和缺失证据不升级为当前业务成功。
- 输出机器可读报告和 Markdown 矩阵，列出未映射能力、未执行用例、缺证据、失效证据及对应责任仓库/既有变更。
- 给出“候选安装→就绪→只读冒烟→审批写入→保存重开→独立回读→清理”的最小验收链计划，精确引用已有脚本与准入条件，工具不执行计划中的命令。

## Capabilities

### New Capabilities

- `pod-test-coverage`: 版本化能力分母、测试映射、证据适用性核验、覆盖报告及最小实机链的离线计划。

### Modified Capabilities

无。现有 account-token-session、assetdb-resource-creation、MCP 任务/吞吐规格及 editor-stability 验收约束保持不变。

## Impact

- 实现归属 `peanut-pod-lite`：拟新增 `tools/pod-test-coverage/`、对应 `tools/tests/pod-test-coverage-*.test.mts`、`tests/fixtures/pod-test-coverage/` 和 `docs/testing/pod/`。现有根 test:tools 已发现 `.test.mts`，不预设修改 package.json 或 lockfile。
- 其他仓库只作为显式指定的只读输入；Pro 的 pinned Lite 与当前 Lite 独立标识。不新增生产依赖、不改变产品 API、发行包、权限或支持版本。
- 本次先交付上述能力的完整规划。实施需确认 change 并由总管逐 task 准入；真实 Creator、服务、安装与独立 QA 的执行继续由各自已批准任务承接。

## Non-goals

- 不在此变更运行全产品测试、浏览器、Creator、远程服务、付费请求、签名或发布；不执行输入文件里的脚本。
- 不恢复封存工作树、不修复已有 UI Prefab/账号/资源稳定性功能、不修改既有任务完成标记、不替代独立 QA。
- 不把代码目录数量、单元测试数量、HTTP 受理或预期拒绝换算成实机成功率，不把截图作为唯一正确性证据。
- 不新建通用 QA 框架或调度平台；现有能力通过引用与适配复用。撤回新增工具/文档即可回滚，不影响产品运行。
