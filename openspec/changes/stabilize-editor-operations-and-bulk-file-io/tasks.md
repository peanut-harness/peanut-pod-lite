# Tasks

## 1. 契约与覆盖基线

- [x] 1.1 `[peanut-pod-lite:packages/protocol/**,packages/engine/modules/policy/**,packages/engine/modules/mcp/src/editor-mcp-capability-catalog.ts,packages/engine/modules/mcp/src/editor-mcp-tool-catalog.ts,packages/engine/modules/mcp/tests/** | serial | depends:none | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:bulk-text-file-io#Text file calls are bounded and project confined,mcp-write-task-execution#Default synchronous behavior remains compatible | non-goals:不实现文件执行器、不改变原版写权限、不修改原工程或旧实机证据、不发布]` 定义批量读写 DTO、容量配置、逐文件 outcome 和可选 `expectedSha256`，更新 policy/schema/工具映射及 profile 为原 83 项加 `asset.readText`；依赖：方案确认与实现登记；验收：目录一致性、旧工具映射、schema 和 Node 14 宿主兼容测试通过。
- [ ] 1.2 `[peanut-pod-lite:tools/editor-stability/**,tools/tests/editor-stability*.test.mts,tests/fixtures/editor-stability/coverage/** | serial | depends:1.1 | owner:01a0f2c9-6b9a-7560-8866-f97beda3ec0c | requirements:editor-operation-stability#Coverage is exhaustive and version specific | non-goals:不运行Creator或修改安装包、不改产品schema、不实现4.1/4.2夹具、不改原工程与旧证据、不pack或发布、不把源码声明和文件存在当运行时可用]` 建立版本化 coverage manifest 生成器与严格校验器，对照实际 Creator importer/组件、38 类独立资产、Prefab/Scene 和公开 operation；依赖：1.1；验收：新增目录项、缺夹具、跳过、重复用例和无依据不适用均被拒绝，分母与原生差异可查。

## 2. 生命周期与原始日志

- [ ] 2.1 建立命名有效的隔离夹具和 raw 日志阶段 validator，覆盖 stdout/stderr、project.log、启动、操作、冷却、退出及延迟诊断；依赖：1.2 与实机登记；验收：合成 warning/error 注入使对应阶段失败，旧报告原始 bytes 与摘要不变。
- [ ] 2.2 顺序复现 3.8.7 不带 Lite / 带 Lite 的最小工程正常退出，按证据修复扩展卸载或支持的退出顺序；依赖：2.1；验收：命名警告与 `Object has been destroyed` 均消失，保留失败与修复后的原始文本、PID 和退出证据；无法消除时保持本项未完成。

## 3. 多文件读取与写入

- [ ] 3.1 实现资产根 realpath/symlink 校验、重复物理目标检查及文件数/单文件/输入输出字节预算；依赖：1.1；owned paths：assets 的新增文本 I/O guard 与独立测试；验收：穿越、大小写别名、symlink、非法 UTF-8、二进制、32/33 文件和正文边界测试通过，拒绝前后文件摘要相同。
- [ ] 3.2 实现 `asset.readText` 单文件/多文件内容读回、writer 屏障、资源互斥、revision/文件快照与有界冲突；依赖：3.1；验收：BOM、CRLF、Unicode、空文件、缺文件逐项结果、跨 revision 写入及外部编辑测试通过，不返回混合快照或截断内容。
- [ ] 3.3 重构 `asset.writeText` 为全批准备后进入唯一 writer，在第一项变化前重验所有路径与期望摘要；依赖：3.1；验收：最后一项无效、排队时外部改动、`absent` 冲突、无审批均使整批 unchanged，无目录/meta/探针变更。
- [ ] 3.4 增加逐文件内容摘要、UUID/meta 后验、兼容结果字段和保守部分失败结果；依赖：3.3；验收：第 N 项提交和最终后验故障注入准确区分已写/待核实/未执行，不能误报整批成功或无证据回滚。
- [ ] 3.5 将批量读写接入原有 admission、幂等、取消、结果保留和 owner 安全规则，并更新 AI 成功判据；依赖：3.2、3.4；验收：重试不重复写、异连接不可见、取消前零写入、控制面保留容量、结果和证据字节有界，旧单文件/files 用法兼容测试通过。

## 4. 资源全类型夹具与矩阵

- [ ] 4.1 为序列化资产、动画、地形、渲染和层次资源补合法最小夹具、Inspector patch 和语义读回规则；依赖：1.2；候选 lane `fixtures-serialized`，仅拥有 `tests/fixtures/editor-stability/serialized/**`；验收：所有对应 manifest 行都有夹具/依赖/回读，无占位无效资源。
- [ ] 4.2 为图片、模型、音视频、字体、图集、骨骼、地图、Bundle 和其它原生 importer 补合法夹具与依赖；依赖：1.2；候选 lane `fixtures-media`，仅拥有 `tests/fixtures/editor-stability/media/**`；验收：夹具合法性、原生目录差异和引用闭包审查通过，不用伪二进制宣称可导入。
- [ ] 4.3 实现 manifest 驱动的资源生命周期/Inspector 实机 runner 与证据 validator；依赖：2.1、4.1、4.2；owned paths：creator-38 的新增 resource stability 脚本；验收：适用 create/import/read/patch/copy/move/rename/refresh/delete 全部可追溯，UUID 保持、引用/登记/日志检查失败均阻止通过。

## 5. 组件与代码矩阵

- [ ] 5.1 为版本化组件目录生成真实依赖装配、公开字段值和引用夹具，覆盖全部适用字段类型及增删改保存重开；依赖：1.2、4.1、4.2；验收：99 项策展目录与实际版本差异可查，依赖组件、物理/UI/动画后端有效，缺字段用例使覆盖校验失败。
- [ ] 5.2 增加 TypeScript/JavaScript 单文件和跨文件模块、组件字段与引用变更的代码夹具及实际 Creator 编译/预览就绪探针；依赖：3.5、5.1；验收：文本读回、脚本 UUID、真实编译、原生组件绑定、预览加载均检查，故障注入和有效零日志 campaign 分开记录。
- [ ] 5.3 将组件/代码矩阵与资源 runner、raw 日志和 coverage validator 集成，修复全部实际发现的操作错误；依赖：2.2、4.3、5.1、5.2；验收：离线定向回归和实机定向分片零缺口、零非预期失败；影响共享 schema 的修复由 checkpoint owner 串行审阅。

## 6. 新候选与双版本最终验收

- [ ] 6.1 在最终 tree 执行实际根工作区定向检查、生成/构建、Core prerequisite pack、canonical verify 和 pack，核对新 Host/Core/descriptor 身份；依赖：3.5、5.3；验收：所有命令 exit 0、结构/类型/兼容/测试通过，必要产物顺序和新摘要有证据，不复用旧 669 测试作为新结果。
- [ ] 6.2 Creator 3.8.7 在新隔离副本安装同一候选，顺序执行全量资源/组件/代码矩阵、至少 100 文件有界批读写、30m 常规＋10m 超载＋冷却及正常退出；依赖：6.1 与实机登记；验收：coverage 零遗漏、原始各阶段 warning/error 零新增、非预期失败和残留为零，control P95 ≤1s，身份和引用全部通过。
- [ ] 6.3 Creator 3.8.3 在另一新隔离副本执行同样完整验收；依赖：6.2 完成并关闭所属实例；验收：同候选摘要、精确版本及 6.2 同等级门槛全部通过；不把另一版结果当本版证据。
- [ ] 6.4 独立回读两版报告、raw 日志、覆盖分母、逐文件结果与原工程基线，形成完整验收摘要；依赖：6.2、6.3；验收：所有统计能从原始证据重算，旧报告保留，原工程未改，未通过项不能打勾。

## 7. 知识与交付

- [ ] 7.1 更新批量用法、限制迁移、版本支持与验收文档及所属知识卡，执行 scoped build/check-sync 并保存 sync；依赖：6.4；验收：知识与实际源码/新制品一致，无 raw 日志、凭据、本机路径或 `.rag/` 进入提交范围。
- [ ] 7.2 checkpoint owner 在授权 Git 范围内提交同一验收 tree，交由 integration owner 集成与远端回读；依赖：7.1 与明确 checkpoint/集成登记；验收：checkpoint、目标分支 tree、远端回读 receipt 可核对，仅 remote-verified 才标代码交付完成。

## 8. Execution Notes

任务 1.1 的契约、目录与定向离线验证已验收，其余实现任务均未完成。Kernel 现有 schema matcher 的 oneOf/minItems/maxItems/pattern 支持缺口必须在任务 3.1 或 3.5 发包时包含精确 kernel 文件与测试；此处不开放其源码。实施前逐 task id 发包，声明依赖、owned paths、非目标和验收。4.1/4.2 可在 1.2 完成、夹具格式确认、宿主可用且路径无重叠后评估临时子 Agent；共享目录/schema、runner、构建、Git、知识、Creator 实机和性能测量保持串行。上述候选 lane 不是已经执行或批准的并行登记。
