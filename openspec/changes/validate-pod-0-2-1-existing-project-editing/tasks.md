# Tasks

## 1. 冻结计划与执行门禁

- [x] 1.1 `[peanut-pod-lite:docs/testing/pod/existing-project-editing-plan.md,docs/testing/pod/existing-project-editing-plan.json | depends:none | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不运行 Creator、不修改工程]` 固定两份现有工程、Lite 0.2.1 实测包摘要、原资产保护范围、带 runId 的写入命名空间、备份/占用/失败停止规则与逐项证据字段；验收：JSON 可解析，两个版本和精确路径一致，矩阵 12 条仍为 `not_run`，当前工程没有写入。
  - 规划核验：`existing-project-editing-plan.json` 可解析，两个工程 `package.json` 与 `acceptance-fixture.json` 的四个 SHA-256 均与旧登记一致；12 条仍 `not_run`，运行门禁全为 false。仅只读核对，未启动 Creator 或写工程。
- [ ] 1.2 `[peanut-pod-lite:packages/hosts/modules/creator-38/scripts/verify-managed-task-live.mts,packages/hosts/modules/creator-38/scripts/verify-existing-project-editing-readback.mts,packages/hosts/modules/creator-38/tests/** | depends:1.1 | serial | owner:pod-test-owner | requirements:assetdb-resource-creation#Creator evidence proves the atomic creation path | non-goals:登记前不写源码、不重置工程]` 向总管登记精确脚本/测试写集及预检，再补受管创建的可控输出与独立重开后只读核验入口；验收：定向测试证明候选身份不符、路径越界、缺 `.meta`/UUID/引用和新增日志错误均拒绝，现有受管任务回归仍通过。

## 2. 两版现有工程实测

- [ ] 2.1 `[external:creator-3.8.3-existing-test-project | depends:1.2 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不新建/清空/重置工程]` 取得本工程独占运行租约与新鲜占用预检，备份并核对保护摘要后，执行 0.2.1 受管创建→保存关闭→重开→独立读回；验收：原始命令、Host/Core 身份、Prefab/Scene UUID 与 meta、引用、增量日志、工程前后差异和退出码齐全，失败即停并保留状态。
- [ ] 2.2 `[external:creator-3.8.7-existing-test-project | depends:2.1 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不新建/清空/重置工程]` 在另一份现有工程独立重复 2.1 的备份、占用与实机链；验收：同样的逐项原始证据和原资产零漂移，Pro 可选状态单独记录，既有首次 `library` ENOENT 作为历史保留。

## 3. 证据核对与交付

- [ ] 3.1 `[peanut-pod-lite:docs/testing/pod/**,openspec/changes/validate-pod-0-2-1-existing-project-editing/** | depends:2.2 | serial | owner:pod-test-owner | requirements:assetdb-resource-creation#Creator evidence proves the atomic creation path | non-goals:不降覆盖分母、不伪造通过]` 按两版原始证据逐条更新报告与矩阵；分别列最小实机链和 4,128/4,119 条覆盖草稿的未验证项。验收：输入 `validate`、`report`、六条 `check-acceptance` 可重算，证据不足的用例保持 `not_run` 或明确失败，不把局部通过写成整条主线通过。
- [ ] 3.2 `[peanut-pod-lite:本变更已登记路径 | depends:3.1 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不发布 CPM、不归档产品变更]` 跑受影响定向测试、根 `npm run verify`、必要打包身份检查、OpenSpec strict、`git diff --check` 与 scoped RAG；按登记普通集成推送并独立回读远端 SHA。验收：所有必需检查与源码身份有退出码回执，远端 SHA 一致；产品未覆盖部分仍明确列出。
