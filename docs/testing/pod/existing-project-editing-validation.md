# Lite 0.2.1 现有工程最小编辑链实测

本回执对应 [机器可读报告](existing-project-editing-validation.json) 和 [执行计划](existing-project-editing-plan.md)。只使用已登记的两份现有 Creator 工程，候选为冻结的 Lite Host/Core 0.2.1；未新建、清空或重置工程，也未安装或调用 CPM。每次启动前保存完整工程字节副本并核对摘要、占用与候选身份。原始命令、退出码、备份清单和差异位于 `.peanut-ai/pod-existing-project-editing-20261026/`。

| 工程 | 受管创建与重开读回 | 身份及引用 | 保护检查 | 保留的问题 |
| --- | --- | --- | --- | --- |
| Creator 3.8.3 | 均退出 0；不同 Creator 会话 | 3 份 Prefab/Scene 的文件、`.meta`、AssetDB UUID 一致；文件图 2 条命中均由原生 AssetDB 解析，未解析 0 | 受保护资产和包零漂移；轮换日志有备份；拥有的进程与端口已释放 | 首轮两份控制文件超出当时租约；补登记仅用于后续重开，不追认首轮。两次失败的读回脚本日志保留。 |
| Creator 3.8.7 | 均退出 0；不同 Creator 会话 | 同样 3 份资源身份一致，文件图 2 条命中均由原生 AssetDB 解析，未解析 0 | Pro 0.1.1 保持；受保护资产和包零漂移；轮换日志有备份；拥有的进程与端口已释放 | 初次启动在 AppKit 注册阶段 `SIGABRT`，编辑前工程零差异，原因未确认；调整启动经单独登记和宿主审批。 |

两版独立读回的新项目日志均无新增内容，两轮正常启动的 Creator 控制台均无新增错误或警告。3.8.3 技术回执为 `task-2.1-runtime/technical-acceptance-3.8.3.json`，3.8.7 为 `task-2.2-runtime/technical-acceptance-3.8.7.json`，均位于上述私有证据目录。旧五份未备份轮换日志及更早一次 3.8.7 `library` ENOENT 仍是历史缺口。

## 产品矩阵重算

保持 `initial-input.json` 字节不变，以当前 Lite、Pro、Server 显式根重算。`validate` 与 `report` 退出 0；能力分母 114，已映射 6、未映射 108，来源完整。12 条产品用例全部 `not_run`，当前通过 0；安装生命周期、基础编辑、设计到工程、字体与内容、账号权限、恢复连续使用六条 `check-acceptance` 均退出 2。原始 CLI 输出和生成的 `report.json`、`report.md` 位于 `.peanut-ai/pod-existing-project-editing-20261026/task-3.1-report/`；六个退出码 2 是尚未完成产品验收的结果。

组件与代码覆盖草稿中，3.8.3 的 4,128 条和 3.8.7 的 4,119 条仍全部为 `pending`。本次三资源样本没有覆盖原生注册、组件字段、TypeScript/JavaScript 组合的完整矩阵，也不能证明空白工程首装、真实 Server/账号或六条产品主线通过。后续应为这些缺口提供独立夹具与实机读回，再逐条更新矩阵状态。

## 交付前验证

当前工作树独立安装锁文件依赖后，定向测试 9/9、根 `npm run verify`、根 `npm run pack`、OpenSpec strict、私有范围与工作空间知识同步检查均退出 0。Host/Core 包摘要和归档 SHA-256 与冻结实测候选完全一致；生成描述符的 `sourceCommit` 是后续测试修订提交，运行实测源码仍以 `660226aa28d0d96fc4766c81c3b58af71cd1a8f0` 为准。第一次完整验证曾被旧测试硬编码的 0.2.0 目录阻断；该测试现按仓库当前版本读取真实自有打包候选，保留包身份、损坏包拒绝和 Pro 隔离断言，失败日志原样保留。验证日志与包身份核对位于 `.peanut-ai/pod-existing-project-editing-20261026/task-3.2-delivery/`。
