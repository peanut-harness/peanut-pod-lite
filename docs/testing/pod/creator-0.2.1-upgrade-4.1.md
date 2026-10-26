# Lite 0.2.1 现有 Creator 工程升级与修复核对（4.1）

## 边界与候选

本轮只使用已登记的两份隔离工程：`creator-3.8.3` 和 `creator-3.8.7`。它们在操作前的 Core 活动版本均为 `0.2.0`。Lite 0.2.1 候选的源码提交为 `660226aa28d0d96fc4766c81c3b58af71cd1a8f0`，描述符 SHA-256 为 `1a73441ae9abf86e15fda0434cb5ad51388a0fda589ad6ecc88b64e1eb2d3a40`；Host 包摘要为 `3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438`，Core 包摘要为 `ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f`。

执行依据为 `.peanut-ai/pod-decouple-cpm-20261026/task-4.1-upgrade-runtime-registration/receipt.json` 和同目录的 `resume-preflight.json`。原始备份、安装计划、运行输出及逐文件前后清单保存在 `.peanut-ai/pod-decouple-cpm-20261026/task-4.1-upgrade-0.2.1/`，按 Creator 版本和 run 分开；逐次命令与输出位置见其中的 `run-command-ledger.md`，旧候选 4.1 证据未覆盖。

## 已完成

- 两份工程在改动前均完成完整项目字节备份和逐文件 SHA-256 对照：3.8.3 为 934 个文件、42.5 MiB；3.8.7 为 967 个文件、53.6 MiB。包含整个 `temp`、Host、安装索引与包、资产及元数据；根 `logs` 在两份工程中原本不存在。每次安装、启动、故障注入和修复前又建立独立的完整备份并验证副本字节相同，见各 `run-*/backup-verification.json` 和 `source-manifest.json`。每次操作前均重新检查 Creator 进程与专用 9223/9224 端口。
- 两份工程的 `PackagingApp.validate` 均返回 `ok: true`；`planInstall` 均明确给出 `operation: upgrade`、`previousVersion: 0.2.0`、`version: 0.2.1`。
- 3.8.3 已使用当前 Host 候选和 `PackagingApp.upgrade`，安装结果为真正的 `0.2.0 → 0.2.1` 升级。重启后 `host-status.json` 中 Host/Core 均为 0.2.1 且包摘要与冻结候选一致，`smoke-results.json` 为 20 项通过、0 项失败、Pro 缺席。
- 3.8.3 的本机 Bridge 核对通过：健康检查、只读版本查询、无审批写入被要求确认、审批令牌写入成功并到达完成状态。原始结果见 `creator-3.8.3/run-03-before-host-launch/runtime-verification.json`。本轮精确 Creator PID `22587` 已结束。
- 3.8.3 的运行后清单与初始备份对照：项目根包与测试标记、旧资产及元数据没有漂移；Creator 轮换删除的旧 `temp/asset-db/log` 均已保存在本轮完整备份，差异见 `final-postflight.json`。
- 3.8.7 在占用解除后重新做了完整备份与占用检查，也执行了 `PackagingApp.upgrade`，安装结果同样为 `0.2.0 → 0.2.1`。重启后 Host/Core 0.2.1 摘要与冻结候选一致，Pro 0.1.1 摘要 `801c6d26d4d386de8bff09bbce70d1acf33abe74ba29e72e6e8cb182efe1f68f` 保持活动，smoke 为 20/0。Bridge 的健康、只读、未审批写入拦截和审批写入全部通过；原始结果见 `creator-3.8.7/run-03-before-host-launch/runtime-verification.json`，本轮精确 Creator PID `27541` 已结束。
- 3.8.7 的最终清单与初始备份对照也没有受保护的根包、测试标记、旧资产或元数据漂移；Creator 轮换删除的旧 `temp/asset-db/log` 均可从本轮完整备份核对，差异见 `final-postflight.json`。
- 两版仅在已安装的 Core `0.2.1/peanut.pod-lite.bundle.js` 副本尾部加入受控标记，冻结候选及安装索引未改。目录验签均报 `package_file_integrity_mismatch`；随后真实 Creator Host 均写入新鲜 `ready: false`、`core: null` 和相同错误，见 3.8.3 `run-05-before-corrupt-host-launch/host-status.json` 与 3.8.7 `run-06-before-corrupt-host-launch/host-status.json`。这两个故障运行的旧 smoke 文件时间戳早于故障，不作为通过证据。Core 损坏时 Pro 未进入检查阶段；Pro 独立保持活动的证据来自升级前与恢复后的 3.8.7 运行及索引。
- 两版 `PackagingApp.repair()` 均返回 `repaired: true`、`reconciled_installed_manifest`，活动 Core 回退到可验证的 `0.2.0`，并从索引中移除损坏的 `0.2.1`；3.8.7 的 Pro 仍为 `0.1.1`。见各 `run-*-before-repair/repair-result.json`。随后用冻结的 0.2.1 目录包再次执行 `PackagingApp.upgrade`，计划仍为 `0.2.0 → 0.2.1`，目录验签摘要重新吻合，见各 `run-*-before-reinstall/reinstall-result.json`。
- 修复后两版均再次启动 Host：Host/Core 包摘要与冻结候选一致，smoke 均 20/0，Bridge 健康、只读、无审批写入拦截、审批写入和完成状态再次通过。3.8.3 的 Pro 仍缺席；3.8.7 的 Pro `0.1.1` 重新活动。新鲜状态、smoke 和 Bridge 原始结果保存在 3.8.3 `run-08-before-restored-launch/`、3.8.7 `run-09-before-restored-launch/`。最终索引均保留可用 `0.2.0` 和活动 `0.2.1`；本任务 Creator 主进程已全部结束。

## 运行记录与产品缺口

3.8.3 首次在普通沙箱启动以退出码 134 结束，空控制台日志已保留；随后用宿主批准的精确 Creator 可执行程序启动成功。启动 3.8.7 前和第一次故障注入前，曾两次发现其他任务正在运行 Creator 3.8.3（工程位于 `/private/tmp/vvgame-all-compare-20261026/`）；均在写入前暂停，待新鲜占用检查确认空闲后继续，没有关闭其他任务进程。六次实际 Creator 启动均使用 `--project` 指向具名隔离工程、`--nologin`、独立 `--user-data-dir` 与 9223/9224 专用端口，控制台原始输出保存在相应 `run-*` 目录。扫描未出现新的 3.8.7 `library` ENOENT；控制台中有 3.8.3 清理不存在场景缓存路径、3.8.7 asset-db 计时标记和一次 Blink 消息错误，未改变 Host/smoke 的终态。

旧 0.2.0 候选运行时未备份而丢失的五份 `temp` 日志仍属于历史 `may_have_changed`；本轮备份不能弥补该缺口。3.8.7 旧运行首次出现的 `library` ENOENT 也继续保留。**4.1 的现有工程升级与修复边界已完成**；这不等同于真实空工程首装、六条产品主线或长时间稳定性，测试矩阵仍按实际证据保持 `not_run`。
