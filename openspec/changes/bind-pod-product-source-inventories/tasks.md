# Tasks

> 取代记录（2026-10-26）：四项勾选状态保留，表示旧候选来源绑定当时已交付。当前 Pod 候选已按 [decouple-pod-from-cpm/tasks.md](../decouple-pod-from-cpm/tasks.md) 3.1 改绑自有 Packaging/Host 来源；旧 CPM 清单适配器与四仓回执仅作历史证据，不再作为当前分母或产品安装前置。本 change 未归档。

交付按 serial 依赖推进：1.1 → 1.2 → 1.3 → 2.1。每项由本产品会话完成技术验收与 checkpoint；规划工作树目前只开放本 change 目录。实施前须由 Workspace 总管按对应 task packet 登记精确写集并运行 preflight。禁止并行代理、外仓写入、产品实机或服务执行、CPM 发布与输入命令执行。来源分母完成、工具交付和产品验收分别记录。

## 1. 跨仓来源绑定

- [x] 1.1 `[peanut-pod-lite:tools/pod-test-coverage/inventory.mts,tools/pod-test-coverage/report.mts,tools/tests/pod-test-coverage-inventory.test.mts,tools/tests/pod-test-coverage-report.test.mts,tests/fixtures/pod-test-coverage/** | depends:none | serial | owner:pod-source-owner | requirements:pod-product-source-inventories#CPM release manifest distinguishes source from availability | non-goals:不导入外仓JS、不签名验证自报、不下载发行包]` 增加 CPM schema v2 清单的固定离线适配，空 stable 显示来源可核对而公开发行不可用；非空未受信发行保持待验证；验收：定向 inventory/report 测试覆盖空清单、非空未验证、未知 schema/渠道/字段、摘要漂移、缺根、路径逃逸和不产生安装通过。
- [x] 1.2 `[peanut-pod-lite:docs/testing/pod/server-route-review.json,tools/tests/pod-test-coverage-inventory.test.mts,tests/fixtures/pod-test-coverage/** | depends:1.1 | serial | owner:pod-source-owner | requirements:pod-product-source-inventories#Server route review binds implementation without host claims | non-goals:不改Server、不运行Native/PG/OIDC/KMS]` 以 Lite 保存的审阅快照绑定 Server 账户 offer/subscription/checkout 实现引用与限制，记录候选 Server 提交、审阅者和文件摘要；验收：定向测试核对三路由来源、全部实现 SHA、缺根/漂移拒绝完整及 VM 测试不升级真实宿主通过；实际本机来源引用逐项可回读。
- [x] 1.3 `[peanut-pod-lite:docs/testing/pod/initial-input.json,docs/testing/pod/README.md,tools/tests/pod-test-coverage-cli.test.mts,tools/tests/pod-test-coverage-report.test.mts,tests/fixtures/pod-test-coverage/** | depends:1.2 | serial | owner:pod-source-owner | requirements:pod-product-source-inventories#Pro operations remain an independent source denominator,pod-product-source-inventories#Cross-product report keeps provenance and unfinished work visible | non-goals:不填伪造pass、不修改Pro/Server/CPM、不缩小99项分母]` 将 Pro 核心/高级目录、Server 审阅文件、CPM 公开清单按四仓快照与显式根接入初始输入，更新缺口导航；验收：两份 Pro 目录准确为84/15且无重叠，目录新增项成为 unmapped；初始 validate/report 返回0，六条主线 check-acceptance 返回2，当前通过0，缺少仓库列表与可用性按真实来源重算，输入及外仓文件前后摘要不变。

## 2. 组合验收与交付

- [x] 2.1 `[peanut-pod-lite:docs/testing/pod/**,openspec/changes/bind-pod-product-source-inventories/** | depends:1.3 | serial | owner:pod-source-owner | requirements:pod-product-source-inventories#Cross-product report keeps provenance and unfinished work visible | non-goals:不重跑Creator或服务、不核验Actions、不自动归档旧change]` 完成组合验证和回执，区分工具状态、目录完整性、stable 可用性与产品未验收；验收：受影响定向测试、`npm run test:tools`、`npm run verify`、本 change 严格校验、`git diff --check`和 Lite scoped RAG 按有效输入 run/reuse；checkpoint 经普通集成推送后独立回读远端 SHA，只有 remote-verified 标代码交付完成。
