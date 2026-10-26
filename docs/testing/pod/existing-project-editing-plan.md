# Pod 0.2.1 现有工程基础编辑计划

状态：**仅规划，未运行**。本文件绑定 `validate-pod-0-2-1-existing-project-editing`；对应机器输入为 [existing-project-editing-plan.json](existing-project-editing-plan.json)。沿用 4.1 冻结 Host/Core，不新建或重置工程。

| 项目 | Creator | 受保护基线 | 当前阶段 |
| --- | --- | --- | --- |
| `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3` | 3.8.3 | manifest `d0590e91…`、fixture `979d5eaf…` | 最小编辑链已验证，首轮租约外控制文件副作用保留；runId `pod-edit-021-383-20261026-01` |
| `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7` | 3.8.7 | manifest `77447e17…`、fixture `4719237b…` | 最小编辑链已验证，首次启动崩溃保留；runId `pod-edit-021-387-20261026-01` |

候选 Host/Core 包摘要分别为 `3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438` 和 `ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f`；归档 SHA-256 分别为 `266589255eca7e6a8fa03f64171a329e607b8de514df79a0cdcf7418dbfb771f` 和 `cb037f16b57e38b38306f0066d6eb88ea94ef514cccfe92d5e49c49925ca64d0`。源码提交身份以 4.1 实测的 `660226aa28d0d96fc4766c81c3b58af71cd1a8f0` 为准，不把后来的文档提交解释成重新实测。

## 顺序与停止条件

1. **源码入口。**给受管任务脚本提供可控的 runId、候选身份和输出；新增重开后的只读核验入口。现有脚本会写 `assets/_peanut-managed-task-live/<runId>`，此目录当前不在旧 4.1 租约内。源码写集需单独登记，定向测试通过后才能进入工程运行。
2. **每版运行前。**新鲜检查 Creator 进程、端口、项目与磁盘空间；对 Host、安装索引、包、既有资产、`temp/logs/library/profiles/settings` 做可回读备份。原有 manifest/fixture 与无关 assets/metas 的 SHA 必须一致。候选身份、工程版本、备份或独占占用任一不符就停止。
3. **写入与重开。**每版只在登记的 `assets/_peanut-managed-task-live/<runId>` 下创建 Prefab/Scene 和必要夹具，记录实际创建清单、审批令牌范围、任务证据、AssetDB UUID/meta、缺失引用扫描和日志偏移。关闭本次 Creator 进程，再重开同一工程，以另一个只读入口复核资源、候选身份及新增日志。当前空资源样本不证明组件或代码矩阵。
4. **后验。**逐项比对运行前后工程；无关资产与 meta 不得漂移。若出现未解释警告/错误、身份不一致、失败回滚不明或 `may_have_changed`，停止该版本及后续依赖，不自动重试或删除历史证据。清理仅凭本次创建清单和备份执行。

## 通过边界

最小实机链可以证明 0.2.1 在两个现有工程里完成指定 Prefab/Scene 编辑与保存重开，不能证明空工程首装。版本化覆盖草稿仍有 3.8.3 的 4,128 条和 3.8.7 的 4,119 条 `pending`，包括原生注册、组件/字段与 TypeScript/JavaScript 组合；缺夹具、运行结果或独立读回的项不得标通过。Pod 矩阵现有 12 条 `not_run` 不因本规划或局部样本而改变。旧五份未备份轮换日志和首次 3.8.7 `library` ENOENT 保留为历史缺口。

### 3.8.3 实测回执

本版私有回执在 `.peanut-ai/pod-existing-project-editing-20261026/task-2.1-runtime/technical-acceptance-3.8.3.json`。受管创建退出 0；关闭并重开同一工程后，三个 Prefab/Scene 资源的磁盘与 `.meta` 身份、原生 AssetDB UUID 均一致。文件图扫描提示两条内置 skybox 子资源引用，按 UUID 查询 Creator AssetDB 均成功，原生未解析引用为零。新项目日志和两轮 Creator 控制台均无新增错误或警告；最终受保护资产与安装包零漂移，两份轮换日志均有运行前备份，进程及端口已释放。首次启动曾改写两份尚未登记的 `.peanut-ai` 控制文件；当场停止并保留证据，总管随后仅为重开阶段补登记精确路径。本回执不追认首轮越界为合规通过，也不把最小链计为全量组件/代码矩阵或 Pod 基础编辑主线通过。

### 3.8.7 实测回执

本版私有回执在 `.peanut-ai/pod-existing-project-editing-20261026/task-2.2-runtime/technical-acceptance-3.8.7.json`。首次 Creator 启动在 AppKit 注册阶段 `SIGABRT`，创建尚未开始，工程相对启动前备份零差异；原因未确认，崩溃原始证据保留。总管为调整启动和必需的一次重开分别登记后，经宿主审批完成受管创建与独立读回，两个阶段均退出 0。三个 Prefab/Scene 资源的磁盘、`.meta` 和 AssetDB UUID 一致；两条文件图命中均可由原生 AssetDB 解析，未解析引用为零。新项目日志无新增内容，Creator 控制台无新增错误或警告；Pro 0.1.1 保持，受保护资产与包零漂移，轮换日志有运行前备份，拥有的进程与端口已释放。历史首轮 `library` ENOENT 与旧日志缺口仍保留。本回执只证明本次最小链。
