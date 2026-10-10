# Cocos AI Copilot 参考评估与 Peanut Pod 落地路线

> 状态：产品与工程方向建议，不构成已批准实现任务。
>
> 评估日期：2026-10-11。
>
> 外部参考：[Renshuxian-ai/Cocos-ai-copilot](https://github.com/Renshuxian-ai/Cocos-ai-copilot)。

## 1. 结论

Cocos AI Copilot 对 Peanut Pod 有较高的**产品形态与验收流程参考价值**，但当前公开仓库主要包含 README、安装说明、发布说明、变更记录和许可证，未提供足以审计其 Runtime、权限、事务、撤销和 MCP 桥接实现的源码。因此：

- 借鉴它如何把聊天、Creator 上下文、执行活动、Artifact、Preview、错误诊断和 Review/Undo 组织成一个编辑器内工作流。
- 不把其产品声明当作可复用实现，也不以其 3.8.8/Windows 验收替代 Peanut 自己的 3.8.3、3.8.7 与后续版本实机矩阵。
- 保留 Peanut 已建立的 schema、审批租约、资源闭包、工程 writer、任务状态、AssetDB postflight、签名 CPM 和 Pro 权益边界；外部项目不应倒逼这些边界降级。
- 优先建设“可检查、可解释、可恢复”的用户体验层，而不是再造一套编辑器内核或复制一套 MCP Runtime。

建议将后续工作作为独立 OpenSpec change 规划，暂定名称：

```text
integrate-copilot-workspace-into-lite
```

它不应并入 `publish-signed-public-cpm-release` 或 `stabilize-editor-operations-and-bulk-file-io`。前者负责可信分发，后者负责操作与实机稳定性；Copilot Workspace 是新的产品交互层，三者只有依赖关系，不应共用模糊验收。

## 2. 外部项目可确认的基线

截至评估日期，外部项目公开描述的 0.1.0 能力包括：

- Cocos Creator 内的可停靠 AI 面板，通过 Codex app-server 驱动模型、Skills 和 Cocos Runtime。
- Scene、Hierarchy、Node、Component、Prefab、资源和脚本诊断工作流。
- 图片、音频 Artifact 的会话持久化、处理、AssetDB 导入及场景绑定。
- Preview 输入、运行时语义读取、截图和 Runtime Error Capture。
- Turn 级 Activity、Review 和带身份/前置条件检查的 Undo。
- 本地 stdio 与远程 HTTP MCP 配置。
- 随产品交付的四项版本化 Skills。

其公开支持矩阵是 Creator 3.8.8、Windows x64，Codex 最低兼容版本为 0.160.1。正式 0.1.0 ZIP 声明沿用第二台全新电脑验收过的 RC 字节，仅调整文件名，公开 SHA-256 为 `38121A724018D93F95CB4A0E5FC03DF6B193FF8F1CFF140E87CE22B4919B3426`。

这些信息适合用来理解产品体验和发布叙事，但不能证明其内部安全、并发、恢复或长期兼容性。公开仓库的规模、提交数和关注数也不应作为技术正确性的替代证据。

参考资料：

- [项目 README](https://github.com/Renshuxian-ai/Cocos-ai-copilot/blob/main/README.md)
- [Changelog](https://github.com/Renshuxian-ai/Cocos-ai-copilot/blob/main/CHANGELOG.md)
- [安装说明](https://github.com/Renshuxian-ai/Cocos-ai-copilot/blob/main/docs/INSTALLATION.md)
- [首次使用说明](https://github.com/Renshuxian-ai/Cocos-ai-copilot/blob/main/docs/FIRST_USE.md)
- [0.1.0 Release Notes](https://github.com/Renshuxian-ai/Cocos-ai-copilot/blob/main/docs/RELEASE_NOTES_0.1.0.md)

## 3. Peanut 当前基础与差异

Peanut Pod 已经拥有比外部项目公开文档更严格的底层安全与交付基础：

- 84 项免费操作按 39 项只读、45 项写入/破坏性分类，并由版本画像、schema、policy 和审批共同门控。
- 写任务绑定 connection、operation、风险和精确资源集合；资源闭包、共享 writer、FIFO、取消、超时、幂等和任务证据已有基础实现。
- 写操作成功不仅依赖调用返回，还必须满足 `taskStatus=succeeded` 与 `postflight.verified=true`；文本批量写入还有逐文件 verified 判据。
- AssetDB 创建、父目录登记、UUID、`.meta`、引用、settle 和 `project.log` 增量已经进入事务与 postflight。
- Lite、Pro、Server 职责分离；订阅不等于写盘许可，Pro 不得成为第二套编辑器内核。
- CPM 方向是签名 manifest、不可变版本、原子切换与失败恢复，而不是直接覆盖旧扩展目录。

现阶段差距主要不在“能不能操作 Creator”，而在“用户是否能在一个界面中理解一次 AI 工作发生了什么”：

1. 任务、审批、执行步骤和最终证据仍偏向底层接口。
2. Artifact、运行时错误、Review 和恢复没有形成统一用户心智。
3. Preview 证据、任务证据与会话 Turn 尚未形成稳定的一对多关联。
4. 插件面板已有产品生命周期能力，但不是完整的创作工作台。
5. 当前稳定性矩阵仍有大量真实 Creator 用例待完成，不能让新 UI 掩盖底层未验证项。

## 4. 借鉴与拒绝清单

### 4.1 应当借鉴

#### 编辑器内统一入口

用户不应在 Creator、终端、日志目录和多个独立面板之间拼接上下文。统一工作台至少应同时呈现：

- 当前工程、Scene、选中节点与 Creator 精确版本；
- 会话与 Turn；
- 本 Turn 计划调用的能力与风险；
- 审批、排队、执行、验证和失败状态；
- Artifact、资源身份、Preview 结果和错误；
- Review、恢复建议和安全撤销入口。

#### Activity 与证据同屏

“调用成功”不等于“项目修改成功”。用户界面应直接使用 Peanut 的任务状态机和结构化失败，而不是重新从日志文字猜测状态。

#### 会话边界内的 Runtime Error Capture

运行时错误需要绑定精确 Preview 会话、启动时间和日志 offset，至少记录：

- message、stack、source、line、column；
- error、unhandled rejection、uncaught exception 分类；
- 首次/最近发生时间与重复次数；
- Preview 会话、任务和 Turn 标识；
- 捕获范围和可能遗漏的平台。

#### 冲突安全的 Review/Undo

外部项目强调身份和前置条件，这一点与 Peanut 的资源闭包和摘要体系一致。Peanut 应进一步把 Undo 定义成“生成并执行一个新的受控恢复任务”，而不是无条件反向修改。

#### 随产品发布的版本化 Skills

面向 Cocos 的使用规则应和目标 Host/Core 版本一起验证、签名和分发。Skill revision 必须能追溯到对应产品版本与能力目录，不能依赖开发机上的临时文件。

#### 发布物原样晋级

通过真实环境验收的候选字节应原样晋级，避免验收后重新打包引入漂移。Peanut 的 candidate、beta、stable manifest 应把这一点做成机器门禁，而不只写在发布说明里。

### 4.2 不应照搬

- 不采用删除旧目录再解压覆盖的升级模型；继续使用签名目录、不可变版本仓和原子切换。
- 不让面板、Codex app-server 或模型直接调用 Creator 私有实现；所有操作继续经过稳定 capability contract。
- 不把截图当作写入成功、运行正确或无回归的唯一证据；截图只作为人工辅助。
- 不让 Undo 绕过审批、资源锁、Creator 版本画像、AssetDB settle 和 postflight。
- 不将 API key、登录 token、Pro entitlement 或签名计划交给 panel 保存。
- 不把外部 MCP “已配置/已连接”解释为可信；每个服务仍需来源、权限、能力和错误隔离边界。
- 不因外部项目支持 Creator 3.8.8 就自动扩大 Peanut 的 write-enabled 画像。

## 5. 目标产品形态

建议把目标命名为 **Peanut Copilot Workspace**，它是 Lite 内置的产品工作台，不是新的执行内核。

```text
用户自然语言请求
  ↓
Lite Panel：会话、计划、审批、Activity、Artifact、Review
  ↓ 稳定消息协议
Creator Host：工程/Scene/Preview 生命周期与安全桥接
  ↓
Engine Kernel：能力目录、schema、policy、task、evidence
  ↓
Creator Adapters / AssetDB / Preview

可选侧路：
  Lite Account Surface → Pod Server 身份、订阅、checkout
  Pro Admission       → 签名计划、权益和宿主能力探针
  External MCP        → 明确隔离的额外服务，不获得隐式 Creator 权限
```

依赖方向继续遵守 [ARCHITECTURE.md](ARCHITECTURE.md)：`protocol <- sdk <- engine <- hosts`。`apps/panel` 仍然只消费稳定消息协议，不直接装配 Runtime、读取凭据或调用 Creator API。

## 6. 仓库职责映射

### 6.1 peanut-pod-lite

主承载仓，负责：

- Copilot Workspace 静态面板与稳定消息协议；
- 会话到 Turn、任务、Artifact、Preview 和证据的本地关联；
- Activity、审批、任务状态、结构化失败和 Review 投影；
- Runtime Error Capture 的 Host 桥接与受控查询；
- Lite 内置 Skills 的 manifest、revision、兼容范围和加载状态；
- 本地安全恢复任务与 Undo 可用性判断；
- Creator 版本画像和实机验收。

不得负责：

- 服务端权益签发；
- Pro 私有算法；
- 账单和 webhook；
- 把 panel 变成第二个 Kernel；
- 存储模型或账号秘密。

### 6.2 peanut-pod-pro

仅负责付费能力的可发现性与受控执行：

- 在 Workspace 中提供 Pro 能力描述、可用性和升级入口；
- 在执行前验证签名计划、最新权益和宿主能力；
- 把执行状态和证据按 Lite 稳定协议投影给 Workspace；
- 保持缺少 Pro、掉线或权益失败不影响 Lite 工作流。

不得复制会话系统、任务队列、Review/Undo 或面板内核。

### 6.3 peanut-pod-server

只负责可信服务端事实：

- OIDC 身份与设备状态；
- 订阅、offer、checkout 和账单 webhook；
- entitlement 与撤销；
- Pro 签名计划和验证；
- 可选的产品/Skill 目录服务契约。

不得接收项目资产内容、Scene、Prompt、截图或本地任务明细作为默认遥测，也不得执行 Creator API。

## 7. 核心数据模型建议

### 7.1 Workspace Turn

```ts
interface ICopilotWorkspaceTurn {
  readonly turnId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly createdAt: string;
  readonly intentSummary: string;
  readonly taskIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly previewSessionIds: readonly string[];
  readonly reviewId: string | null;
  readonly status:
    | 'planning'
    | 'awaiting_approval'
    | 'running'
    | 'verifying'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'needs_attention';
}
```

Turn 是 UI 聚合单位，不替代 `ResourceOperationTask`。一个 Turn 可以包含多个任务；每个写任务仍独立绑定审批、资源闭包和证据。

### 7.2 Activity Event

```ts
interface ICopilotActivityEvent {
  readonly eventId: string;
  readonly turnId: string;
  readonly taskId: string | null;
  readonly kind:
    | 'context_read'
    | 'approval_requested'
    | 'task_state_changed'
    | 'artifact_created'
    | 'runtime_error_captured'
    | 'review_ready'
    | 'recovery_recommended';
  readonly occurredAt: string;
  readonly summary: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly evidenceRef: string | null;
}
```

事件只保存有界、脱敏摘要。原始 token、完整源码、二进制 Artifact 和任意日志不得塞进 Activity 索引。

### 7.3 Artifact

Artifact 应区分：

- `conversation_attachment`：用户输入附件；
- `generated_candidate`：尚未进入工程的生成结果；
- `project_asset`：已进入 AssetDB 且具有 UUID/`.meta` 的资源；
- `runtime_evidence`：Preview/运行时观察；
- `validation_report`：任务或矩阵验收摘要。

Artifact 的内容寻址摘要用于去重，但“摘要相同”不自动意味着 Creator 导入状态、UUID 或引用身份相同。

### 7.4 Review 与恢复计划

Review 应从任务证据生成，而不是重新扫描后猜测：

```ts
interface IWorkspaceReviewItem {
  readonly resource: string;
  readonly operation: string;
  readonly beforeIdentity: string | null;
  readonly afterIdentity: string | null;
  readonly currentIdentity: string | null;
  readonly recoverability: 'safe' | 'conflicted' | 'unsupported' | 'unknown';
  readonly evidenceRef: string;
}
```

点击 Undo 后先产生恢复预览，再签发新的 destructive/write 审批并进入同一个任务队列。若当前身份与 `afterIdentity` 不匹配，必须显示冲突并禁止自动覆盖。

## 8. 分阶段落地路线

### Phase 0：契约与范围冻结

目标：在不写新执行逻辑的前提下，确定 Workspace 与现有 Kernel 的边界。

工作项：

- 建立独立 OpenSpec change，明确 capabilities、non-goals 和仓库职责。
- 盘点现有 panel、plugin manager、task control、failure、evidence、Preview 与账号消息协议。
- 定义 Turn、Activity、Artifact、Runtime Error、Review 和 Recovery DTO。
- 定义数据保留、容量、脱敏和工程关闭时的清理规则。
- 定义 Creator 3.8.3/3.8.7 首批验收矩阵；3.8.8 只能作为新增候选画像单独取证。

验收门槛：

- 没有 panel → engine 或 panel → Creator API 逆向依赖。
- 新 DTO 不携带凭据、任意环境变量或无限日志正文。
- 每个写入口仍能追溯到现有 task、approval 和 evidence。
- 与三个现有 active change 的依赖和非目标写清楚。

### Phase 1：Activity 与任务证据工作台

目标：先把 Peanut 已有的可靠底层证据做成用户可理解的界面。

工作项：

- 在面板中展示 task 状态、资源摘要、审批、排队、执行、验证和最终状态。
- 投影结构化 `failure`、`recommendedAction` 和 `may_have_changed`，禁止 UI 自行推断重试。
- 将 `task.evidence` 映射为有界证据卡片。
- 提供任务取消，但只在现有控制面允许的阶段启用。
- 支持按 Turn 聚合多个任务，不改变底层任务语义。

验收门槛：

- 同一状态在普通 JSON、流式响应、Host 和面板显示一致。
- Activity 丢事件、乱序或重连后必须明确标记不完整，不能误报成功。
- 失败卡片能区分 unchanged、may_have_changed 和 unknown。
- 不需要运行模型也能用 fixture 重放完整 Activity。

### Phase 2：Runtime Error Capture 与 Preview 会话

目标：把 Preview 的语义状态和运行时错误绑定到精确 Turn/任务。

工作项：

- 定义 Preview session 生命周期、启动身份和日志 offset。
- 捕获 `console.error`、unhandled rejection 和 uncaught exception。
- 提供按会话读取、去重计数、来源位置和堆栈。
- 将错误检查纳入需要 Preview 的任务 postflight；不要求所有写任务都启动 Preview。
- 视觉截图保持可选辅助证据，语义读取和原始文本错误是自动验收主证据。

验收门槛：

- 旧 Preview 错误不能污染新会话。
- 延迟错误在规定冷却窗内归属正确。
- 重复错误去重不丢失首次、最近时间和计数。
- Preview 重启、关闭、崩溃和连接中断都有确定状态。

### Phase 3：Review 与冲突安全恢复

目标：让用户知道改了什么，并能在证据充分时安全恢复。

工作项：

- 基于任务证据生成文件、AssetDB、Scene、Node、Component 和引用变更摘要。
- 先支持 Peanut 能证明 before/after/current identity 的资源类型。
- Undo 生成恢复计划和新的审批任务，不直接写盘。
- 冲突、外部修改、未知状态和不可逆操作必须 fail-closed。
- Git 恢复继续由 Git 工具负责；Workspace Undo 不冒充版本控制。

验收门槛：

- Turn 后人工修改目标时 Undo 必须拒绝或要求人工处理。
- 多任务共享资源时不能撤销掉后续任务的合法变更。
- 恢复任务同样经过锁、AssetDB settle、引用检查和日志 postflight。
- 无法证明恢复完成时返回 `may_have_changed`，不能显示“已撤销”。

### Phase 4：Artifact 工作流

目标：先做好图片和音频，再扩展到更复杂资源。

工作项：

- 用内容摘要管理会话候选和去重显示。
- 候选进入工程时走现有 `asset.import`、资源闭包、审批和 AssetDB 事务。
- 图片支持尺寸、透明边缘、像素过滤、SpriteFrame/Nine-Slice 元数据与场景放置。
- 音频支持受控转换参数、AudioClip 就绪和 AudioSource 配置。
- 生成服务和处理器通过可替换接口接入；模型服务失败不影响已有 Artifact。

验收门槛：

- 候选文件、项目资源和运行时引用身份不可混淆。
- 重开会话后 Artifact 元数据可恢复；缺失内容明确显示不可用。
- 相同内容重复检视不产生重复卡片或重复导入。
- 导入成功要求真实 UUID、`.meta`、类型就绪与引用验证。

### Phase 5：版本化 Skills 与可选外部 MCP

目标：让工作流可扩展，同时保持权限边界清晰。

工作项：

- 为内置 Skills 定义 id、revision、兼容产品版本、所需 capability 和摘要。
- Skills 随签名产品目录包分发并进入 release descriptor。
- 外部 MCP 默认无 Creator 写权限；能力需显式映射并经过本地审批。
- 面板展示来源、transport、工作目录、权限、健康状态和最后错误。
- 环境变量只显示键名和来源，不回显秘密值。

验收门槛：

- Skill 与 Host/Core/capability catalog 版本不匹配时 fail-closed。
- 外部 MCP 连接成功不自动成为受信 Creator service。
- 删除或禁用外部 MCP 不影响 Lite 内置 Runtime。
- 配置导入导出不包含 token、私钥或本机敏感路径。

### Phase 6：可信发布与独立验收

目标：只在现有发布与稳定性门禁完成后宣布正式可用。

工作项：

- 将 Workspace、Skills 和 Runtime 身份加入 release descriptor。
- candidate 字节在独立 Creator 工程通过后原样晋级。
- 对 3.8.3、3.8.7 分别运行功能、错误注入、恢复、重连和长时稳定矩阵。
- 由独立 QA 从公开候选端点安装，不读取相邻 checkout 或本机构建。
- 公开文档只声明逐版本、逐平台真实验证过的范围。

验收门槛：

- 面板、Host、Core、Skills、catalog 和安装索引身份一致。
- 远端下载字节与冻结 evidence manifest 一致。
- 失败路径不残留临时包、过期索引、孤立资源或秘密。
- 只有远端 SHA/字节回读与独立安装通过后才是 `remote-verified`。

## 9. 建议优先级

### P0：立即规划

1. Activity 与 task evidence 投影。
2. Preview session 与 Runtime Error Capture 契约。
3. Review/Recovery 数据模型。
4. 新 OpenSpec change 的边界、依赖和验收矩阵。

原因：这些工作主要复用 Peanut 已有的任务、安全和证据基础，能最快提高用户对“发生了什么”的理解，不需要先引入新的模型或媒体服务。

### P1：首个可交付增量

1. 只读 Activity 面板。
2. 结构化失败与建议动作。
3. Runtime Error 列表与来源跳转。
4. Review 只读摘要，不提供 Undo。

这个增量应先做到“看得懂”，再开放“可撤销”。

### P2：受控写入体验

1. 恢复预览与安全 Undo。
2. 图片 Artifact 导入与 SpriteFrame 工作流。
3. 音频 Artifact 与 AudioSource 工作流。
4. 需要 Preview 的任务闭环。

### P3：生态与分发

1. 版本化内置 Skills。
2. 外部 MCP 管理。
3. 3.8.8 新画像评估。
4. 候选原样晋级与公开发布。

## 10. 与现有 OpenSpec 的关系

### integrate-plugin-lifecycle-management-into-lite

可复用插件面板、签名目录、安装事务和 Host 更新能力。该 change 已有自己的验收记录，不应通过新增 Copilot Workspace 需求重新打开已完成任务；完成必要规范同步后应独立归档。

### publish-signed-public-cpm-release

是 Copilot Workspace 正式公开分发的前置门禁，但不是本地开发和 fixture 验证的前置条件。Workspace 不得自行实现另一套下载、签名或更新逻辑。

### stabilize-editor-operations-and-bulk-file-io

为 Artifact 导入、Review 身份、恢复任务和大批量创作提供底层可靠性。Workspace 可以消费其结果，但不能用 UI 验收替代资源矩阵、双版本 Creator、原始日志和远端验证。

## 11. 风险与控制

### 状态爆炸

Turn、task、Preview、Artifact、Review 都有生命周期。控制方式是保持 task 为写入真相源，其余对象只引用 task/evidence，不复制执行状态机。

### Undo 误覆盖

恢复必须检查 current identity，并作为新任务经过审批和 postflight。第一版宁可少支持，也不能“尽力而为”覆盖用户后续修改。

### 日志和会话泄密

Activity、Runtime Error 和 Artifact 索引必须设容量上限与脱敏规则。凭据、Authorization header、签名计划原文、任意环境变量值和项目外绝对路径不得进入持久会话。

### Panel 变成业务内核

所有业务判断在 protocol/engine/host；panel 只做渲染、用户输入收集和稳定消息交互。UI 禁止自行判定审批有效、任务成功或恢复安全。

### 外部服务扩大权限

模型服务、图片服务和外部 MCP 都是不受信输入源。它们可以提出操作或生成候选内容，但不能签发本地审批、Pro entitlement 或 Creator 写入结果。

### 新功能掩盖旧矩阵缺口

任何 Copilot Workspace 发布都必须显式列出底层 capability 的 verified/unverified 状态。静态目录、Node fixture、截图或人工演示不能替代 Creator 实机证据。

## 12. 建议验收场景

最低验收集应包含：

1. 只读请求：读取 Scene/Hierarchy，不产生审批和项目修改。
2. 单资源写入：审批、执行、UUID/`.meta`、日志和 Activity 一致。
3. 多资源写入：资源闭包、FIFO、逐项结果和 Review 顺序正确。
4. 审批拒绝：下载、写入和 Pro 执行均未开始。
5. 外部修改冲突：Review 可见，Undo 拒绝覆盖。
6. 写后 postflight 失败：界面显示 `may_have_changed` 并先建议只读检查。
7. Preview 旧错误：新会话不误报。
8. Preview 延迟错误：冷却窗内正确归属当前任务。
9. Artifact 重复打开：不重复登记或导入。
10. Pro 无权益：Lite 正常，Pro 在下载或执行前失败关闭。
11. 断网/重连：本地任务状态不丢失，远程数据明确标记过期。
12. Creator 关闭/崩溃：进行中任务进入确定的失败或未知状态，不伪造成功。
13. 面板重载：从受控状态投影恢复，不重复执行写任务。
14. candidate 安装：Host/Core/Skills/catalog/release descriptor 身份一致。
15. 独立机器验收：从候选端点安装并完成同一最小闭环。

## 13. Go / No-Go 门槛

进入实现前必须满足：

- 新 change 的产品边界、数据保留和安全非目标获确认。
- 现有 active changes 的依赖关系明确，不共享未登记写路径。
- Turn/task/evidence/Preview/Review DTO 通过契约审查。
- 首个实现批次只读优先，不把 Undo、媒体处理和外部 MCP 同批落地。

进入公开候选前必须满足：

- 根 verify、pack 与 OpenSpec strict validation 通过。
- Creator 3.8.3、3.8.7 使用同一候选完成独立实机矩阵。
- Review/Undo 冲突和故障注入全部 fail-closed。
- Runtime Error Capture 不跨会话污染。
- candidate 字节、摘要、descriptor 和安装索引冻结。
- 独立 QA 从远端端点复验，不使用相邻 checkout。

出现以下任一情况应 No-Go：

- UI 与 task/evidence 对同一操作给出不同终态；
- 无法区分 unchanged、may_have_changed 和 unknown；
- Undo 可覆盖 Turn 后的人工或其它任务修改；
- panel 持有 token、私钥或 Pro entitlement 判定权；
- 截图或人工观察被当作唯一自动成功证据；
- 验收后重新构建或重新打包候选；
- 只验证一个 Creator 版本却扩大整个 3.8.x 写入画像。

## 14. 推荐下一步

1. 以本文为输入建立 `integrate-copilot-workspace-into-lite` OpenSpec proposal。
2. 首个 change 只纳入 Phase 0、Phase 1 和 Runtime Error Capture 的最小垂直切片。
3. Review 首版只读；Undo 另设依赖 task，在身份和恢复事务验证完成后开放。
4. Artifact 首版从图片开始，音频随后；模型生成与工程导入保持独立事务。
5. 3.8.8 作为新的 Creator profile 候选单独取证，不借用外部项目结论。
6. 完成后再评估是否需要把完整 Codex app-server 会话嵌入 Creator；不要把它作为第一阶段的必要条件。

最终方向可以概括为：**借鉴外部项目的产品闭环，用 Peanut 自己的安全内核、证据体系和发布门禁实现。**
