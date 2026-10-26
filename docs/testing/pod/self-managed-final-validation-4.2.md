# Pod 自有安装候选的本地验证与交付门禁（4.2）

## 候选身份

4.1 Creator 实测的 Lite 0.2.1 源码提交为 `660226aa28d0d96fc4766c81c3b58af71cd1a8f0`，Host/Core 包摘要分别为 `3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438`、`ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f`。本轮知识卡与证据提交只改变源码记录提交，不把它们写成 4.1 实测源码身份。Lite 重打包 Host/Core 归档与 4.1 冻结归档逐字节一致；描述符仅 `sourceCommit` 字段随知识卡提交变化。原描述符 SHA-256 `1a73441ae9abf86e15fda0434cb5ad51388a0fda589ad6ecc88b64e1eb2d3a40` 及两份原归档保存在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/4.1-frozen-candidate/`，并已再次核对。

Pro 的实际 Lite gitlink 仍为 `87e076cfd1711af8b7ef88af959337c9a764f445`（Lite 0.2.0）；Pro 的公共 Core 目录修正至该 pin 已编译公开的 88 项，无需改 gitlink。Pro 目录包仍为 0.1.1、包摘要 `801c6d26d4d386de8bff09bbce70d1acf33abe74ba29e72e6e8cb182efe1f68f`。源码提交、目录包摘要与 Lite 的 0.2.1 源码身份分开记录。

## 本地检查

| 检查 | 结果 |
| --- | --- |
| Lite 安装、Host 更新、发行与矩阵定向测试 | 80/80，通过；首次普通沙箱的 loopback `listen EPERM` 原始失败保留，宿主批准后同组通过 |
| Lite 根 `npm run verify` | 退出 0，21 组共 1584/1584；普通沙箱 tsx IPC `EPERM` 与知识卡未提交时的 `lite_release_source_dirty` 已分别保留，干净提交后通过 |
| Lite 根 `npm run pack` | 退出 0；Host/Core 归档 SHA-256 分别为 `266589255eca7e6a8fa03f64171a329e607b8de514df79a0cdcf7418dbfb771f`、`cb037f16b57e38b38306f0066d6eb88ea94ef514cccfe92d5e49c49925ca64d0`，与 4.1 原始字节相同 |
| Pro adapter 类型检查、目录包测试、adapter 测试 | 退出 0；目录包 6/6、adapter 9/9 |
| Pro 目录修复回归与根 `npm run verify` | 目标回归 5/5、根验证退出 0；Core 本地 88、Pro 高级 15、legacy 快照 85，严格相等与读写审批策略均核对 |
| Pro `npm run pack --prefix packages/mcp-cocos-host-adapter` | 保留旧同版本目录后退出 0；新 raw pack 仅 manifest 的 `/package/packedAt` 时间戳不同，包摘要和其他三文件相同。最终 release 从原 4.1 实测 manifest 原字节恢复，四文件逐字节相同；`verify:package` 退出 0 |
| 双工作树隔离 RAG | `build` 退出 0、31 chunks；Lite/Pro `check-sync --brief` 均退出 0，输入显式绑定两棵 feature 工作树，不使用主检出成功代替 |
| OpenSpec 与 Git 差异 | `npx openspec validate decouple-pod-from-cpm --strict` 与两仓 `git diff --check` 均退出 0；普通集成与首轮独立远端 SHA 回读已完成 |

Pro 原始打包首次因同版本目录已存在而报历史诊断名 `cpm_version_already_exists`。旧四文件、新 raw 四文件、机器 diff、恢复后的四文件和验签回执保存在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/`；**新 raw 输出本身只有包摘要相同，不宣称其 manifest 字节自然相同**。根验证原始日志及所有失败尝试另见该目录 `local-verification-logs/`。

## CPM 调用核对与来源矩阵

生产构建与发行脚本、Creator Host 加载/更新、PackagingApp、目录安装仓和 Pro 目录包脚本中，对 `CpmIntegrityProtocol`、`CpmManifestValidator`、`CpmSigningProtocol`、`cpm-release-v1`、`@peanut/cpm` 与 `cpm-core` 的调用/依赖搜索为零；审计路径和搜索结果保存在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/cpm-api-audit.json`。`installation/index.ts` 的旧 `Cpm*` 别名、签名协议的历史 `cpm-release-v1` 类型、既有诊断码，以及覆盖工具对旧 CPM 清单的读取分支仅按兼容与历史证据保留，当前候选安装与验签使用自有目录包协议。

`initial-input.json` 现绑定 Lite 0.2.1 冻结包与 Pro 修正后的来源文件；Pro Core 源文件 SHA-256 为 `471dd61257089562c660799e4c14a52e86997ad1eed9d79a9ea05d0750dd9920`。显式 Lite/Pro/Server 根下 `validate`、`report` 均退出 0；分母 114、已映射 6、未映射 108、缺仓与缺来源均为空。六份矩阵测试 38/38，通过。12 条用例仍全部 `not_run`、当前通过 0，六条主线 `check-acceptance` 均退出 2。报告在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.2-validation-registration/matrix-report-pro88-final/`，先前 110 项与更早 CPM 清单结果保留为历史记录。

4.1 的两版现有工程升级与修复已完成，但真实 Creator 空工程首装、六条产品主线和长时间稳定性仍缺原始证据；旧候选未备份丢失的五份日志与首次 3.8.7 `library` ENOENT 继续保留。

普通交付按依赖顺序完成：Lite 候选 `b03304b6cd58dc045b2c78fc43d7dabca8a6125c` 快进并推送 `origin/main`，独立 `ls-remote` 回读同 SHA；其历史包含 Pro gitlink `87e076cfd1711af8b7ef88af959337c9a764f445`。随后 Pro 候选 `c877665e37d5f927052338524a6f88886b1d57fc` 快进并推送 `origin/main`，独立回读同 SHA。Pro 主检出的子模块工作目录已切到提交记录的 pin，主检出保持干净。两份首轮远端原始输出保存在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.2-delivery-registration/`。**本收尾文档与 4.2 勾选所在的最终 Lite 提交仍须再次普通推送和独立远端回读；最终 SHA 另存交付回执，不在提交内自引用。**代码交付不代表产品全面验收或可归档。
