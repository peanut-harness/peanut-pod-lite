# Tasks

## 1. 冻结计划与执行门禁

- [x] 1.1 `[peanut-pod-lite:docs/testing/pod/existing-project-editing-plan.md,docs/testing/pod/existing-project-editing-plan.json | depends:none | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不运行 Creator、不修改工程]` 固定两份现有工程、Lite 0.2.1 实测包摘要、原资产保护范围、带 runId 的写入命名空间、备份/占用/失败停止规则与逐项证据字段；验收：JSON 可解析，两个版本和精确路径一致，矩阵 12 条仍为 `not_run`，当前工程没有写入。
  - 规划核验：`existing-project-editing-plan.json` 可解析，两个工程 `package.json` 与 `acceptance-fixture.json` 的四个 SHA-256 均与旧登记一致；12 条仍 `not_run`，运行门禁全为 false。仅只读核对，未启动 Creator 或写工程。
- [x] 1.2 `[peanut-pod-lite:packages/hosts/modules/creator-38/scripts/verify-managed-task-live.mts,packages/hosts/modules/creator-38/scripts/verify-existing-project-editing-readback.mts,packages/hosts/modules/creator-38/tests/existing-project-editing-readback.test.mts,packages/hosts/modules/creator-38/tests/managed-task-live-script.test.mts | depends:1.1 | serial | owner:pod-test-owner | requirements:assetdb-resource-creation#Creator evidence proves the atomic creation path | non-goals:登记前不写源码、不重置工程]` 向总管登记精确脚本/测试写集及预检，再补受管创建的可控输出与独立重开后只读核验入口；验收：定向测试证明候选身份不符、路径越界、缺 `.meta`/UUID/引用和新增日志错误均拒绝，现有受管任务回归仍通过。
  - 登记与本地验收：`.peanut-ai/pod-existing-project-editing-20261026/task-1.2-source-registration/receipt.json` 的 fresh resume preflight 通过；新/旧定向测试 5/5、Host 脚本语法检查、OpenSpec strict、JSON 解析与 diff check 均退出 0。新脚本仅验证本次三份 Prefab/Scene 资源、冻结候选、重开会话和缺失引用扫描；组件/代码全量草稿继续 `pending`，Creator 与工程写入未运行。

## 2. 两版现有工程实测

- [x] 2.1 `[external:creator-3.8.3-existing-test-project | depends:1.2 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不新建/清空/重置工程]` 取得本工程独占运行租约与新鲜占用预检，备份并核对保护摘要后，执行 0.2.1 受管创建→保存关闭→重开→独立读回；验收：原始命令、Host/Core 身份、Prefab/Scene UUID 与 meta、引用、增量日志、工程前后差异和退出码齐全，失败即停并保留状态。
  - 技术回执：`.peanut-ai/pod-existing-project-editing-20261026/task-2.1-runtime/technical-acceptance-3.8.3.json`；两轮完整备份、新鲜占用、受管创建与重开后独立读回、三资源 UUID/meta、两条文件图命中由原生 AssetDB 解析、原生未解析引用 0、保护资产零漂移、轮换日志均可回读。首次控制文件越界与两次脚本失败原样保留；补登记只用于重开，不追认首轮。此项只验最小链，Pod 主线仍 `not_run`。
- [x] 2.2 `[external:creator-3.8.7-existing-test-project | depends:2.1 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不新建/清空/重置工程]` 在另一份现有工程独立重复 2.1 的备份、占用与实机链；验收：同样的逐项原始证据和原资产零漂移，Pro 可选状态单独记录，既有首次 `library` ENOENT 作为历史保留。
  - 技术回执：`.peanut-ai/pod-existing-project-editing-20261026/task-2.2-runtime/technical-acceptance-3.8.7.json`；首次 AppKit `SIGABRT` 且工程零差异，原因未确认并保留；随后经单独登记与宿主审批，受管创建及一次保存重开后独立读回均退出 0，三资源 UUID/meta 一致，文件图 2 命中原生可解析、未解析 0，Pro 0.1.1 不变，保护资产零漂移，轮换日志有备份，拥有的进程及端口已释放。只验最小链，产品主线仍 `not_run`。

## 3. 证据核对与交付

- [x] 3.1 `[peanut-pod-lite:docs/testing/pod/**,openspec/changes/validate-pod-0-2-1-existing-project-editing/** | depends:2.2 | serial | owner:pod-test-owner | requirements:assetdb-resource-creation#Creator evidence proves the atomic creation path | non-goals:不降覆盖分母、不伪造通过]` 按两版原始证据逐条更新报告与矩阵；分别列最小实机链和 4,128/4,119 条覆盖草稿的未验证项。验收：输入 `validate`、`report`、六条 `check-acceptance` 可重算，证据不足的用例保持 `not_run` 或明确失败，不把局部通过写成整条主线通过。
  - 机器可读与人工报告：`docs/testing/pod/existing-project-editing-validation.json`、`.md`；私有重算回执 `.peanut-ai/pod-existing-project-editing-20261026/task-3.1-report/cli-reproduction.json`。输入摘要前后相同，`validate`/`report` 退出 0，六条 `check-acceptance` 均退出 2；分母 114、已映射 6、未映射 108、12 条 `not_run`、通过 0，4,128/4,119 条覆盖草稿均为 `pending`。两版最小链单列，不计产品主线通过。
- [x] 3.2 `[peanut-pod-lite:本变更已登记路径 | depends:3.1 | serial | owner:pod-test-owner | requirements:mcp-write-task-execution#Creator 3.8.x host compatibility is evidence gated | non-goals:不发布 CPM、不归档产品变更]` 跑受影响定向测试、根 `npm run verify`、必要打包身份检查、OpenSpec strict、`git diff --check` 与 scoped RAG；按登记普通集成推送并独立回读远端 SHA。验收：所有必需检查与源码身份有退出码回执，远端 SHA 一致；产品未覆盖部分仍明确列出。
  - 本地验证：定向测试 9/9、根 `npm run verify` 与 `npm run pack` 退出 0；Host/Core 包摘要和归档 SHA-256 与冻结实测候选一致，OpenSpec strict、diff check、私有范围及工作空间 check-sync 均退出 0。第一次验证被旧测试的 0.2.0 路径阻断，该测试在精确补登记后按当前版本读取真实包，失败日志保留。
  - 普通快进集成至 Lite `origin/main` 后，远端独立回读 `ab1201f4f2ccc684a9f25defe9683fbab1d30ff5` 与已验证提交一致；本完成回执提交继续按相同路线推送和回读，最终 SHA 另存私有交付回执。12 条产品用例仍 `not_run`、当前通过 0，4,128/4,119 条覆盖草稿仍 `pending`，不宣称完整产品验收。
