# Design

## Context

现有 `EditorMcpAssetDbTransaction` 擅长在资源已经落盘后执行 refresh、UUID/`.meta` 查询、目录注册探针与清理；`lumen.scaffold` 则先由 Lumen session 写出 Prefab/Scene 和 `.meta`，再请求编辑器 refresh barrier。该顺序仍给 Creator Assets 面板留下“磁盘文件已出现但 AssetDB 主资源尚未登记”的观察窗口。`prefab.createFromNode` 等 Creator 消息路径由 AssetDB/Scene 服务创建资源，但目前与 Lumen scaffold 没有共享一个可证明的创建状态机和证据模型。

受管任务已提供完整资源闭包、同目标 FIFO、project writer、取消边界、幂等和唯一 postflight。本设计应复用这些边界，不再引入第二套队列或任务状态。

## Goals / Non-Goals

**Goals:**

- 让新 Prefab/Scene 的首次可见时刻由 AssetDB 创建路径控制，而不是由普通文件系统写入控制。
- 让所有首次创建入口共享目标预留、父目录登记、主资源发布、身份确认、清理与证据语义。
- 在取消、超时和部分失败时给出可证明的 `unchanged` 或保守的 `may_have_changed`，不留下静默残留。
- 保持现有工具名、83 项 operation、同步兼容、审批和 Creator 精确版本门禁不变。

**Non-Goals:**

- 不实现跨调用批次事务或 `task.retry`。
- 不开放新的 Creator 版本写入，也不修改 2.4/3.0–3.5 的实验状态。
- 不把 `scene.save` 恢复为 Agent 写盘路径；Scene/Prefab 仍以声明式序列化和受控 Creator 消息为准。
- 不在本 change 内改变 CPM 安装、签名或公开发布流程。

## Decisions

### 1. 在现有 AssetDB transaction 上增加“创建事务”，不扩展旧的写后 settle 语义

新增一个就近的创建协调器，输入为目标 db URL、资源类型、规范化序列化内容、资源闭包摘要和任务信号。协调器管理 `reserved -> parent_ready -> publishing -> registered -> verified` 状态，并将最终登记证据交给现有 postflight。

现有 `commit(paths)` 保留用于 copy、writeText、已有资源修改等“资源已经存在或已落盘”的路径；新资源不得借 `commit()` 隐式猜测自己是否需要创建。这种分离使调用者必须明确声明 create 与 update，也避免把现有稳定路径一次性重写。

备选方案是直接让 `commit()` 自动检测不存在目标并改走 create-asset。拒绝该方案，因为磁盘已存在但 AssetDB 未登记、真正的新资源、并发创建和覆盖更新在检测时不可可靠区分。

### 2. 目标主资源通过 AssetDB `create-asset` 发布，父目录通过短生命周期登记资源先行就绪

创建事务在主资源发布前查询目标和父目录。父目录未登记时，在目标目录创建并删除受控 JSON 登记资源，确认目录可查询后再调用 `asset-db/create-asset` 发布规范化 Prefab/Scene 内容。主资源内容在内存中形成，不能先写入 `assets/` 再 refresh。

Lumen scaffold 增加不落盘的序列化出口；创建协调器负责唯一落盘。Creator 原生 `prefab.createFromNode` 若其消息本身完成 AssetDB 原子创建，则保留该消息作为发布器，但仍必须进入相同的目标预留和登记确认阶段。

备选方案是写到 `temp/` 后 rename 到 `assets/`。拒绝该方案，因为 rename 的可见性不等于 AssetDB 登记原子性，仍可能重现 Assets 面板竞态。

### 3. 进入主资源发布前才开启不可逆 commit 窗口

目标锁和 project writer 获取、输入序列化、父目录查询与登记资源清理都允许受控取消。调用 `create-asset` 发布主资源前，协调器请求任务进入 commit 窗口；此后取消被拒绝，任务推进到可判定终态。

这样保持现有“等待资源时可取消”的契约，同时避免 AssetDB 已开始创建后被 AbortSignal 强制中断。登记父目录使用的临时资源必须在进入主资源 commit 前完成清理或明确失败。

### 4. 冲突、回滚和失败状态按可证明性分类

- 磁盘或 AssetDB 已存在目标：返回稳定 `asset_create_conflict`，项目 `unchanged`。
- 同幂等作用域相同工作：复用原任务；不同工作：保持现有幂等冲突。
- 主资源发布前失败：清理暂存/登记资源后返回 `not_started` 或 `unchanged`。
- `create-asset` 返回后无法确认 UUID/`.meta`：先执行受控 `delete-asset`，再查询磁盘和 AssetDB；只有两侧都不存在才能返回 `unchanged`。
- 无法证明清理完成：返回 `may_have_changed`，证据列出目标 db URL、已完成阶段和推荐的只读查询，不自动重试。

不删除调用前已存在的目标或 sidecar。所有清理对象都带本事务生成的随机标识或精确目标所有权证据。

### 5. 唯一 postflight 消费创建证据，不重复触发 AssetDB 操作

创建协调器产出 allow-list 证据：目标 db URL 摘要、资源类型、UUID、`.meta` 就绪、子资源 UUID 摘要、父目录登记结果、轮询次数和清理结果。Resource operation executor 的唯一 postflight 读取这些证据，继续执行引用校验、catalog、可选 preview 和项目日志增量检查。

Hub 不再为创建任务补做第二次 settle。任何 `original asset is not exist`、registration pending、引用失败或新日志警告都阻止 `succeeded`。

### 6. 迁移按入口分批，但以同一候选包完成实机验收

先冻结当前 Lumen scaffold、Prefab/Scene Creator 消息和失败分类特征测试，再引入创建协调器。随后依次迁移 `lumen.scaffold`、`prefab.createFromNode` 及代码检索发现的其它首次创建入口。已有资源更新路径继续走原 transaction。

完成后必须用同一 Host/Core digest 在 Creator 3.8.3 与 3.8.7 执行：Prefab 首次创建、Scene 首次创建、同目标双连接竞争、commit 前取消、AssetDB 拒绝/超时清理、引用验证与日志检查。

## Risks / Trade-offs

- [Creator `create-asset` 对 Prefab/Scene 内容格式或大 payload 存在版本差异] -> 用 3.8.3 最低基线建立契约测试与实机矩阵；差异集中在发布器适配层，失败关闭。
- [父目录登记资源本身触发 Assets 面板事件] -> 使用合法 JSON、随机且可识别的名称，等待删除与 AssetDB 不可查询后才发布主资源，并把零残留作为成功条件。
- [原生 `prefab.createFromNode` 无法提供发布前内容] -> 把它视为 AssetDB 原生发布器，但在调用前完成目标预留、调用后完成统一身份确认；无法确认时返回保守状态。
- [清理失败可能删除用户并发创建的同名资源] -> 清理前核对事务获得的 UUID/所有权证据；不匹配时停止删除并返回 `may_have_changed`。
- [增加轮询导致首次创建变慢] -> 只对首次创建启用，复用有界 poll/backoff，并在证据中记录耗时供实机基线约束。

## Migration Plan

1. 为现有创建入口、错误码、日志检查点和任务状态补充迁移前特征测试。
2. 增加创建协调器与内存序列化出口，保持旧入口尚未切换时行为不变。
3. 迁移 Lumen scaffold，再迁移 Creator 原生 Prefab/Scene 创建入口；每个入口完成单元、集成和失败清理测试。
4. 更新工具 AI 契约、验证脚本、安装说明与知识卡。
5. 打包一次候选，在 Creator 3.8.3 和 3.8.7 完成同 digest 实机矩阵后才合入主干。

回滚时恢复创建入口到旧实现并撤销新协调器注册；不得把已生成的新实机证据用于回滚后的产物。若线上工程出现 `may_have_changed`，先用只读 AssetDB 查询确认目标状态，再决定保留或删除。
