# 跨仓来源接入验证回执

变更：`bind-pod-product-source-inventories`。候选：`research-baseline-20261026`。本回执记录离线来源与工具验收，不构成 PeanutPod 产品验收。

## 来源与报告

在显式 Lite、Pro、Server、CPM 四根和 `initial-input.json` 固定摘要下，`validate` 与 `report` 均返回 0。来源完整性为 `true`，缺少来源仓库为 `[]`；分母 109 项，其中 Lite 策展 6、Pro 核心 84、高级 15、Server 审阅路由 3、CPM stable 状态 1。Pro 两份目录无重叠。103 项仍为 `unmapped`，映射完整性为 `false`。当前 12 条用例全部 `not_run`，当前通过 0；六条主线 `check-acceptance` 均返回 2。

CPM 公开 `releases.json` 的 stable 集合为空，`releaseAvailable=false`。Server 路由审阅的实现引用摘要逐项核对，但真实 Native 宿主、HTTP、OIDC、PG 和 KMS 验收仍未完成。目录与审阅来源仅提供可核对分母；没有运行 Creator、服务、安装器或输入中的命令。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| 定向 CLI/报告测试 | 7/7 通过 |
| TypeScript 定向 `--noEmit` | 通过 |
| `npm run test:tools` | 97/97 通过 |
| `npm run verify` | 通过；先前新工作树缺少本地 release descriptor，执行 `npm run pack` 生成忽略的测试产物后重跑通过 |
| OpenSpec strict validation | 通过 |
| `git diff --check` | 通过 |
| Lite scoped RAG `check-sync --brief` | `ok scope=peanut-pod-lite chunks=724` |

依赖通过与锁文件相同的已有本地安装树复用，未更新依赖或锁文件。产品通过数保持零。

## 远端交付

实现与本地验证回执在干净主检出普通快进集成并推送；独立读取 `origin` 的 `refs/heads/main` 得到 `d66003c0112266d3d9ec5d3d4f084460341f1eb6`，与推送的候选一致。代码交付为 `remote-verified`。本次勾选和回执收尾本身仍须普通推送及再次远端回读；当前产品六条主线未验收，OpenSpec 变更未归档。
