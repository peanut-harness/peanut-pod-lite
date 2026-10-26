# PeanutPod 测试覆盖矩阵

此前 Lite `0.2.0` 自有安装候选在两处既有隔离 Creator 工程的部分实测见 [4.1 历史候选证据](creator-current-candidate-4.1.md)。它是同版本替换，不是 `0.2.1` 升级证据；4.1 仍未完成，矩阵的产品用例状态不因此提升。

本目录是离线研究与当前候选的来源矩阵。`initial-input.json` 绑定 Lite `0.2.1` 源码 `660226aa28d0d96fc4766c81c3b58af71cd1a8f0`、Pro 目录修正提交 `c877665e37d5f927052338524a6f88886b1d57fc` 和 Server 审阅提交；[Lite 候选字节回执](lite-0.2.1-candidate.json) 固定 Host/Core 目录与归档摘要。`source-catalog.json` 的 SHA-256 为 `7e9723dbf51c8d0b1a780e47739582bd736c4b2d1f322be83803a7650d23bcd9`。这些值固定来源与候选输入，不表示产品已通过。

本轮显式根读回、分母和六条主线退出码见 [0.2.1 来源矩阵回执](self-managed-source-validation-0.2.1.md)。

六条主线是安装生命周期、基础编辑、设计到工程、字体与内容、账号权限、恢复连续使用。每条在 Creator 3.8.3 和 3.8.7 各有一条尚未执行的定义；报告保留 12 条 `not_run`，当前通过数为零。当前来源为 Lite 策展 6、Lite Packaging 包身份 1、Pro 核心 88、高级 15、Pro 目录包身份 1、Server 审阅路由 3，合计 114；其中 108 项仍为 `unmapped`。来源完整性不证明安装或运行成功，两个包身份来源的 `releaseAvailable` 均为 `null`。此前 110 项候选和 CPM stable 空清单的报告作为历史回执保留，不进入当前分母。

## 离线命令

在 Lite 仓根执行，`ROOT`、`PRO`、`SERVER` 分别为 Lite、Pro、Server 的绝对路径，`OUT` 为不在输入或来源根内、尚不存在的目录：

```sh
node --import tsx tools/pod-test-coverage/cli.mts validate --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER"
node --import tsx tools/pod-test-coverage/cli.mts report --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER" --out "$OUT"
node --import tsx tools/pod-test-coverage/cli.mts check-acceptance --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER" --workflow basic-editing
```

`validate` 和 `report` 对合法但未完成的基线返回 0；`check-acceptance` 返回 2。仅给 Lite 根时，外仓来源显示为 `missing`，不会沿用过时的完整分母。报告同时输出 `report.json` 与 `report.md`，不会执行输入命令。`--synthetic-check` 仅供合成夹具检验退出码；其 0 不等于产品验收，合成证明不会计入当前产品通过数。

## 来源与缺口导航

| 主线 | 可核对入口与历史变更 | 仍需的当前候选证据 |
| --- | --- | --- |
| 安装生命周期 | `docs/INSTALLATION.md`；Lite `PackagingApp`、`release:candidate`；Pro `pod-directory-package.mts` | 现有两版工程的 `0.2.0 → 0.2.1` 升级/修复与 Host/Core 读回；真实空工程首装仍单列缺口 |
| 基础编辑 | `tests/fixtures/editor-stability/coverage/creator-3.8.3-draft.json`、`creator-3.8.7-draft.json`；`verify-managed-task-live.mts` | 两版原生注册、组件与代码矩阵、保存重开、引用及日志后验 |
| 设计到工程 | Pro `packages/ui-prefab/tests/project-migration.test.mts`；`preserve-ui-prefab-reimport-customizations` | 正向字段选择、最终包预览、跨入口实机与阶段三禁写边界 |
| 字体与内容 | Pro `sdf-font-runtime.ts`、`cocos-snowb-bmfont-service-runtime.ts`、`content-delivery-runtime.ts` | 原生产物可用性、依赖能力和平台差异 |
| 账号权限 | Lite `account-session.test.mts`、`account-pro-entitlement.test.mts`；Server `account-actor.test.ts` | 实际账号宿主、OIDC/PG/KMS、消费者接收、会话竞态与撤销 |
| 恢复连续使用 | `verify-throughput-soak-live.mts`、`hotplug-recovery-acceptance.test.ts` | 30 分钟正常、10 分钟过载、冷却及两版精确候选记录 |

路径和 SHA 见 `source-catalog.json`。历史变更、测试文件与日志仅作为追踪入口；339/339 等旧数字不可填为当前通过。当前六条主线均未完成产品验收。

## 最小安装到编辑计划

报告分别生成 3.8.3 和 3.8.7 的静态计划：候选身份 → 宿主就绪 → 安装 → 只读冒烟 → 实际审批写入 → 保存重开 → 独立读回 → 清理。无精确隔离工程绑定和写入授权时步骤保持 `blocked`。`verify-managed-task-live.mts` 不覆盖保存重开，计划将该步明确标为待定义。失败阻断后续步骤；清理只针对有创建清单的本任务资源，`may_have_changed` 保留诊断并先核验工程。
