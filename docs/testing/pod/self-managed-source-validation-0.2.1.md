# Lite 0.2.1 自有来源矩阵回执

本回执只记录离线来源与静态矩阵的可重算状态，不代表 Creator 产品全面验收。候选来源为 Lite `660226aa28d0d96fc4766c81c3b58af71cd1a8f0`（树 `200aa648a71368c4f2e4a84f9fec37baad2f9484`）；当前任务记录提交与候选源码提交分开。Host/Core 目录与归档摘要固定在 [候选字节回执](lite-0.2.1-candidate.json)，Pro 来源现为 `c877665e37d5f927052338524a6f88886b1d57fc`（树 `f0637b9fc909f4a204a0646434be5e26ad0599e9`），其中 Core 目录 88 项；Server 来源仍按 `initial-input.json` 的审阅 pin。`source-catalog.json` 的 SHA-256 为 `7e9723dbf51c8d0b1a780e47739582bd736c4b2d1f322be83803a7650d23bcd9`。

从 Lite 仓根使用 `README.md` 中的显式 Lite/Pro/Server 绝对根运行：`validate` 退出 0，`report` 退出 0；分母 114（Lite 策展 6、Lite Packaging 1、Pro Core 88、Pro Premium 15、Pro 包身份 1、Server 路由 3），已映射 6、未映射 108，缺仓与缺来源均为空。12 条用例全部 `not_run`、当前通过 0；六条主线各自的 `check-acceptance` 均退出 2。六份 `pod-test-coverage-{cli,evidence,input,inventory,plan,report}.test.mts` 定向测试已在本候选执行并通过；此前 110 项分母保留在旧提交与旧回执中。

当前 `0.2.1` 候选已在两处既有隔离 Creator 工程完成 [真实版本升级与修复](creator-0.2.1-upgrade-4.1.md)。此前 [0.2.0 部分运行证据](creator-current-candidate-4.1.md) 属不同候选，只供追溯。真实 Creator 空工程首装、六条主线与长稳仍缺产品证据；来源完整性不能改变这些状态。历史 CPM 清单回执仍保存在 `source-inventory-validation.md`，不进入本候选分母。
