# PeanutPod 测试覆盖矩阵

本目录是离线研究基线。`initial-input.json` 的候选身份固定在 Lite 提交 `f6ac69fb9b5ce7f840d540cd1b1fe3fd23a3ec02`，`source-catalog.json` 的 SHA-256 为 `7d034e70884fa9b684bb9b3ea41931acba787ef62cd2220f96b371bd461cb2fd`。这些值仅标识来源审阅快照，不表示现行产品已通过。

六条主线是安装生命周期、基础编辑、设计到工程、字体与内容、账号权限、恢复连续使用。每条在 Creator 3.8.3 和 3.8.7 各有一条尚未执行的定义；报告保留 12 条 `not_run`，当前通过数为零。来源索引的 `traceRefs` 固定了本机可读的 Lite、Pro、Server 和 CPM 文件路径及内容摘要。初始输入另绑定 Pro 核心 84 项、高级 15 项操作目录，Lite 保存并逐实现摘要核对的 Server 三条账户路由审阅记录，以及 CPM 公开 schema v2 stable 清单。四仓根均可读且字节吻合时，来源分母为 109 项、`missingRepositories` 为空；其中新增的 103 项仍为 `unmapped`，映射和产品验收未完成。CPM 当前空 stable 清单的 `releaseAvailable` 为 `false`，不代表安装成功。外仓线索并未被本输入升级为受信执行证据；新增来源、目录项或字节漂移应重新审阅。

## 离线命令

在 Lite 仓根执行，`ROOT`、`PRO`、`SERVER`、`CPM` 分别为四个仓库的绝对路径，`OUT` 为不在输入或来源根内、尚不存在的目录：

```sh
node --import tsx tools/pod-test-coverage/cli.mts validate --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER" --source-root "cpm=$CPM"
node --import tsx tools/pod-test-coverage/cli.mts report --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER" --source-root "cpm=$CPM" --out "$OUT"
node --import tsx tools/pod-test-coverage/cli.mts check-acceptance --input "$ROOT/docs/testing/pod/initial-input.json" --source-root "lite=$ROOT" --source-root "pro=$PRO" --source-root "server=$SERVER" --source-root "cpm=$CPM" --workflow basic-editing
```

`validate` 和 `report` 对合法但未完成的基线返回 0；`check-acceptance` 返回 2。仅给 Lite 根时，外仓来源显示为 `missing`，不会沿用过时的完整分母。报告同时输出 `report.json` 与 `report.md`，不会执行输入命令。`--synthetic-check` 仅供合成夹具检验退出码；其 0 不等于产品验收，合成证明不会计入当前产品通过数。

## 来源与缺口导航

| 主线 | 可核对入口与历史变更 | 仍需的当前候选证据 |
| --- | --- | --- |
| 安装生命周期 | `docs/INSTALLATION.md`；CPM `cli/cpm.mjs`、`tests/bootstrap.test.mjs` | 干净机器安装身份、坏签名、升级、回滚与独立回读 |
| 基础编辑 | `tests/fixtures/editor-stability/coverage/creator-3.8.3-draft.json`、`creator-3.8.7-draft.json`；`verify-managed-task-live.mts` | 两版原生注册、组件与代码矩阵、保存重开、引用及日志后验 |
| 设计到工程 | Pro `packages/ui-prefab/tests/project-migration.test.mts`；`preserve-ui-prefab-reimport-customizations` | 正向字段选择、最终包预览、跨入口实机与阶段三禁写边界 |
| 字体与内容 | Pro `sdf-font-runtime.ts`、`cocos-snowb-bmfont-service-runtime.ts`、`content-delivery-runtime.ts` | 原生产物可用性、依赖能力和平台差异 |
| 账号权限 | Lite `account-session.test.mts`、`account-pro-entitlement.test.mts`；Server `account-actor.test.ts` | 实际账号宿主、OIDC/PG/KMS、消费者接收、会话竞态与撤销 |
| 恢复连续使用 | `verify-throughput-soak-live.mts`、`hotplug-recovery-acceptance.test.ts` | 30 分钟正常、10 分钟过载、冷却及两版精确候选记录 |

路径和 SHA 见 `source-catalog.json`。历史变更、测试文件与日志仅作为追踪入口；339/339 等旧数字不可填为当前通过。当前六条主线均未完成产品验收。

## 最小安装到编辑计划

报告分别生成 3.8.3 和 3.8.7 的静态计划：候选身份 → 宿主就绪 → 安装 → 只读冒烟 → 实际审批写入 → 保存重开 → 独立读回 → 清理。无精确隔离工程绑定和写入授权时步骤保持 `blocked`。`verify-managed-task-live.mts` 不覆盖保存重开，计划将该步明确标为待定义。失败阻断后续步骤；清理只针对有创建清单的本任务资源，`may_have_changed` 保留诊断并先核验工程。
