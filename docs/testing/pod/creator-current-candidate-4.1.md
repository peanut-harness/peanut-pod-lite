# 自有安装候选的现有 Creator 工程核对（4.1，部分证据）

状态：**未完成**。本次只使用工作区已存在、标记为 `isolated Creator lifecycle acceptance` 的 3.8.3 和 3.8.7 工程。两工程在本轮前都已装有旧 Core `0.2.0`，所以这次是同版本候选替换，不能证明空工程首装；也不能把本页当作六条产品主线或长稳验收通过。测试矩阵的 12 条用例仍保持 `not_run`。

## 候选和运行范围

- Lite 源码 checkpoint `ad0308bb8cd4d85b9d556de153a01c82cdc341b4`，Pro 源码 checkpoint `634418c90ec59f6630e535e763259dc15748e68c`。Host 目录摘要 `13654c4c0524163bf0ae1b8a1659a636e49e77f85e9d72a073930cabcafde2f0`，Core 目录摘要 `e169a8718e63234b23a57e0ecb1251a288b9a1e1a1f9e1b5c0e989b8d0c127f2`，Pro 目录摘要 `801c6d26d4d386de8bff09bbce70d1acf33abe74ba29e72e6e8cb182efe1f68f`。
- 工程根：`/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3` 与对应的 `creator-3.8.7`。执行记录和原有 Host/安装目录备份：`/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-decouple-cpm-20261026/task-4.1/`。`preflight-baseline.json` 固定运行前文件清单、源码摘要和候选逐文件摘要；`postflight-comparison.json` 列出运行后差异。
- 两版安装均由 Lite `PackagingApp.validate → planInstall → install` 完成，安装结果在 `install-3.8.3.json`、`install-3.8.7.json`；Host 在 Creator 关闭后放入各工程 `extensions/peanut-pod-lite-host/`。每次启动前均重新以 `ps -axo pid=,ppid=,command=` 和 `lsof -nP -iTCP:9223 -iTCP:9224 -sTCP:LISTEN` 核对占用，只关闭本次启动的 PID。

实际启动命令分别为：

```sh
/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/MacOS/CocosCreator --project /Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3 --nologin --remote-debugging-port=9223 --user-data-dir=/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-decouple-cpm-20261026/task-4.1/profile-3.8.3
/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator --project /Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7 --nologin --remote-debugging-port=9224 --user-data-dir=/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-decouple-cpm-20261026/task-4.1/profile-3.8.7
```

Bridge 验证命令在工作区根执行，脚本完整源码保存于上述执行记录目录：

```sh
node .peanut-ai/pod-decouple-cpm-20261026/task-4.1/verify-current-creator.mjs .peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3 .peanut-ai/pod-decouple-cpm-20261026/task-4.1/runtime-3.8.3.json 3.8.3
node .peanut-ai/pod-decouple-cpm-20261026/task-4.1/verify-current-creator.mjs .peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7 .peanut-ai/pod-decouple-cpm-20261026/task-4.1/runtime-3.8.7.json 3.8.7
```

## 可重算结果

| 工程 | 安装索引最终 SHA-256 | Host 状态最终 SHA-256 | 当前运行结果 |
| --- | --- | --- | --- |
| Creator 3.8.3 | `b05c3a9b9fb2758cff2283b87c2f92dfcd2de87867c62137e5cebc8f714670da` | `143c0248b490c47ed43a72d3d4cdcda64ca024ae214e11790131e66c9d38966c` | Core `ready`、Pro `absent`，Host/Core 摘要匹配，宿主冒烟 20 通过、0 失败 |
| Creator 3.8.7 | `b61ed6e462596ed63ce88e340e93ada2cea6986f73a206572bec4cd3114b236b` | `93c4dfeb93a9c27865eff6894863e222b81a555473da08ee23c343dbd983f140` | Core `ready`、Pro `0.1.1 active`、9 项服务，Host/Core 摘要匹配，宿主冒烟 20 通过、0 失败 |

两版 localhost Bridge 的 `editor-query-version` 返回成功。没有审批令牌的写入只产生 `confirmationRequired: true` 计划，没有生成文件；签发一次性写入令牌后，`asset-write-text` 在 `assets/peanut-pod-decouple-4-1/probe.json` 成功结束。原始响应见 `runtime-3.8.3.json` 与 `runtime-3.8.7.json`，工程中的探针仅位于登记命名空间。

3.8.7 用自有 Packaging 将当前 Pro 候选装入后重启，`host-status.json` 显示 `0.1.1 active` 与 9 项服务。随后仅在测试工程内备份并破坏该 Pro bundle，重启后 Core 仍 `ready`，Pro 独立报 `package_file_integrity_mismatch` 且服务为空；`pro-failure-runtime.json` 保存状态。`PackagingApp.repair` 将活动 Pro 回退到仍完整的旧 `0.9.0`；恢复候选原字节并再次安装，重启后 Pro `0.1.1 active`、Core 摘要不变，见 `pro-repair-3.8.7.json`、`pro-restored-3.8.7.json`、`pro-recovered-runtime.json`。这证明当前隔离工程中的失败隔离与恢复路径，不替代空工程首装或长稳。

## 停止点与工程差异

- 两工程的根 `package.json`、`acceptance-fixture.json` 和原有 `assets/` 文件摘要均保持不变；新增文件没有越过登记路径。替换 Host 时删除了旧 Host 包中的 `dist/cpm-package-store.js` 和旧 `dist/host-update-coordinator.js`。完整新增/消失路径逐项列在 `postflight-comparison.json`。
- Creator 自动轮换了 3.8.3 的一份、3.8.7 的四份旧 `temp/asset-db/log` 文件；这些文件没有预先单独备份，记录为 `may_have_changed`，不得宣称历史工程可逐字节回滚。3.8.7 首次启动出现一次 `library/58/58c5b54c-b5df-41fd-9824-fae746c5af2a.json` 缺失错误，之后的 Pro 候选与恢复启动未再复现；最终日志仍有工程名称不适合作可执行文件名的 Creator 警告。
- 由于缺少当前候选的空工程首装原始证据，4.1 保持未完成，4.2 不开放。本轮不继续操作工程，也不把已有两版记录计入测试矩阵通过数。
