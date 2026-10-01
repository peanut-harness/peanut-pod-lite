# Spec Delta

## Purpose

定义项目资产源文本的单文件与多文件内容读取和写入协议，使代码及文本变更具有容量边界、工程路径约束、内容冲突检查、逐文件真实结果和可恢复状态，不将请求受理或部分写入误报为整批成功。

## ADDED Requirements

### Requirement: Text file calls are bounded and project confined
系统 SHALL 提供 `asset.readText` 的单个 `path` 或多个 `paths`，并保留 `asset.writeText` 的单文件 `path/content` 与批量 `files` 用法；读取和写入仅访问规范化后真实路径仍在当前工程 `assets/` 内的允许文本文件，拒绝目录、符号链接逃逸、重复目标与误作文本的二进制。

#### Scenario: Equivalent paths refer to the same file
- **WHEN** 同一调用包含经路径规范化或目标平台大小写规则判定为相同的两个目标
- **THEN** 在任何内容写入前返回稳定冲突拒绝，不顺序覆写同一文件；读取也返回明确输入拒绝

#### Scenario: A path leaves the asset root
- **WHEN** 路径穿越、绝对路径或符号链接链指向 `assets/` 外
- **THEN** 读取和写入均在访问源内容前拒绝，不泄露范围外文件

#### Scenario: A call exceeds its capacity
- **WHEN** 请求超过声明的文件数、单文件字节数、编码后输入或输出上限
- **THEN** 系统返回可行动的容量拒绝且不执行任何写入，不截断内容或静默忽略后续文件

### Requirement: Bulk reads preserve content and expose consistency
系统 SHALL 以输入顺序返回逐文件的规范路径、状态、完整 UTF-8 内容、实际字节数与 SHA-256 摘要；有效空文件、BOM、换行和 Unicode 内容必须保持，非法 UTF-8 或缺文件返回逐项结构化失败。默认强一致读取等待已受理 writer，确认整个读取区间的 revision 和目标文件未变化后才可声明一致。

#### Scenario: Valid files are read in one call
- **WHEN** 调用方读取多个存在且有效的 UTF-8 文件
- **THEN** 每项内容与原始字节摘要一致，返回顺序与输入相同，整体成功只在全部分项和一致性检查通过时成立

#### Scenario: A read overlaps managed or external edits
- **WHEN** 已受理写入尚未完成，或读取期间 revision、文件身份、内容快照变化
- **THEN** 读取先等待屏障并在有界预算内重取一致结果，无法证明一致时返回稳定冲突，不宣称多个文件构成同一快照

#### Scenario: One requested file cannot be read
- **WHEN** 批读中出现缺失、非法编码或不可读文件
- **THEN** 整体标记失败，各分项保留各自结果和原因，不能以成功项数量或 HTTP 状态宣称整批成功

### Requirement: Bulk writes validate all work before mutation
系统 SHALL 在任何业务文件、目录或 `.meta` 变化前完成全批 schema、路径、容量、权限、风险、资源闭包和可选摘要前置条件校验，并在 writer 内重验前置条件；每个文件可携带 `expectedSha256`，其中 `absent` 表示目标尚不存在，省略则保留既有写入语义。

#### Scenario: Last file has an invalid precondition
- **WHEN** 整批最后一项的路径、内容、权限或期望摘要不合法或已失效
- **THEN** 整批以 `unchanged` 拒绝，较早分项也不写入，不生成目录、`.meta` 或暂存残留

#### Scenario: File changes while the task waits
- **WHEN** 已排队目标内容在取得 writer 前与 `expectedSha256` 不符
- **THEN** 在第一项提交前拒绝整批并返回内容冲突，不覆盖排队期间的外部修改

#### Scenario: Existing caller omits preconditions
- **WHEN** 旧客户端按原单文件或 `files` 用法提交符合新容量边界的获批文本写入
- **THEN** 工具名、同步或显式异步行为和原结果字段保持，新增字段为可兼容扩展；`files` 与单文件字段同传时保持原来的 `files` 优先语义

### Requirement: Every written file has an authoritative outcome
系统 SHALL 在同一工程 writer 和完整资源闭包内顺序提交获批文本变更，为首次创建取得 AssetDB 身份，为已有文件保持 UUID，并在共享 settle 和唯一 postflight 后返回逐文件路径、状态、前后摘要、字节数及适用 UUID；整体成功必须同时满足所有内容读回、登记和原始日志检查。

#### Scenario: New and existing files are written together
- **WHEN** 一个获批批次同时创建文件并修改已有文件
- **THEN** 新文件和父目录得到真实登记，已有 UUID 保持，每项的内容摘要匹配输入，且仅在整体后验通过后标记成功

#### Scenario: Commit fails after some files changed
- **WHEN** 第 N 项提交或最终后验失败且无法证明全部恢复
- **THEN** 整批失败并返回 `may_have_changed`，区分已写、失败、未执行或待核实分项，保留安全恢复证据并要求查询后处理；不得盲目重放

#### Scenario: Rollback can be proven
- **WHEN** 中途失败后确有证据证明所有变化及 `.meta` 均恢复
- **THEN** 才能返回 `rolled_back`，仍保留失败原因和已执行步骤；不预设 Creator 多文件写入具备全批原子性

### Requirement: Bulk calls obey task ownership and recovery rules
系统 SHALL 将批量写入接入既有审批、任务状态、取消、幂等、保留期和容量控制，控制摘要排除源内容与凭据；只读内容仅返回本次调用方，不得进入共享健康指标或任务证据。

#### Scenario: Same approved work is retried
- **WHEN** 同一连接在保留期内以相同幂等键重复同一多文件变更
- **THEN** 复用原任务及其逐文件结果，不重复提交；相同键对应不同文件或内容时拒绝

#### Scenario: Owner cancels before the commit window
- **WHEN** 所有者在写入前取消批量任务
- **THEN** 所有目标保持不变并释放锁和队列占位；commit 中取消仍遵循既有安全边界

#### Scenario: Another connection queries the batch
- **WHEN** 非所有者查询批量任务或结果
- **THEN** 返回不可用，不暴露源内容、路径、摘要或批次存在性
