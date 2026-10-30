# Proposal

## Why

对照 PinK 使用的官方 Cocos CLI MCP，Lite 已有审批、任务和资源编辑基础，但读取结果契约、长构建可观测性及部分实时编辑能力仍有明确缺口。本变更只对齐已确认的五项外部能力，避免把 Cocos 4 接口直接当作 Creator 3.8 的可用契约。

2026-10-27 安装包复核与产品路线见 [PinK / cocos-cli 能力拆解](../../../docs/PINK-COCOS-CLI-CAPABILITY-ROADMAP.md)。该 PinK 快照通过原生 `pink_*` 工具调用领域能力，内置 CLI MCP endpoint 已停用；本文的“对齐”指业务契约参考，不表示 PinK 当前 Chat 仍经该 endpoint 执行。独立 CLI 的 MCP 能力与本仓研究快照分别记录。

Pod 的产品重点是已有 Creator 工程与逐版本兼容。近期建议优先完成基础编辑、A1/A2，再规划旧版样板和编辑上下文治理；这些新增路线不并入本 change，也不改变下述五项范围、任务 DAG 或整体完成门槛。

## What Changes

- **P1 / A1 — 读取输出契约**：补齐基线 41 个读取操作中缺失的 40 个 `outputSchema`，校验真实业务结果；本变更新增的读取操作也必须有明确输出契约。
- **P1 / A2 — 长构建生命周期**：通过既有 `task.status/cancel/evidence` 跟踪同一次原生构建，区分受理、执行、完成、失败、取消和无法确认；验证新鲜产物，禁止因等待超时重复提交。
- **P2 / A3 — 粒子实时控制**：新增 `particle.queryState` 和 `particle.control`，覆盖状态查询、速度设置、播放、暂停、停止、重启；操作绑定显式目标，不能误作用于当前选区。
- **P2 / A4 — 反射探针烘焙**：新增 `reflectionProbe.startBake/queryBake/cancelBake/clearResults`，覆盖指定目标、批量、进度、结果、取消和受审批的生成物清理。
- **P2 / A5 — MCP 只读资源**：在本仓拥有的薄标准 MCP 协议适配层提供文档与资产资源的发现和读取，复用已有工具、查询及鉴权，不重建资产索引或执行系统。
- **BREAKING（成功语义修正）**：原生构建仅受理或超出同步等待预算时，不再允许被当作最终成功；返回可续查任务和明确的未完成状态。输出不符合已声明契约时返回结构化失败，不透传为成功。

## Capabilities

### New Capabilities

- `mcp-read-output-contracts`：读取工具完整输出 schema、运行时校验和兼容失败契约。
- `builder-task-lifecycle`：原生构建与受管任务绑定、持续查询、真实取消能力和产物验证。
- `particle-live-control`：显式目标的粒子状态和五类控制动作。
- `reflection-probe-baking`：反射探针有界批量烘焙、查询、取消及生成结果清理。
- `mcp-readonly-resources`：标准 MCP 文档与资产 Resources 的发现、读取和访问边界。

### Modified Capabilities

- `mcp-write-task-execution`：保留既有工具与普通同步成功结果，允许新增业务能力，明确原生长任务的同步等待耗尽语义，替换固定 83 项的历史目录约束。
- `mcp-task-control`：增加原生长任务生命周期关联，避免受理即成功、请求取消即取消及失联即完成。

## Impact

所属仓库为 `peanut-pod-lite`；涉及 protocol/sdk、Engine 的 policy/mcp/runtime/kernel、creator-38 宿主、打包清单及相关测试文档。标准协议适配由本仓 kernel 拥有，保留现有 token 认证私有 action/NDJSON 入口；本提案不依赖修改未确认所有权的外仓 Bridge。

研究基线为远端 `main@064759dc6b4ac624b538d0995c6a785c79d28c5c`：88 项操作（41 读 / 47 写），以及官方 CLI `e683ccc80479aeda84365121f7bb5597f456c38f`。Creator 3.8.3、3.8.7 安装包提供粒子和反射探针的静态接口依据，尚无本候选实机通过证据。现有活动变更 `stabilize-editor-operations-and-bulk-file-io` 的同步兼容 requirement 与本变更重叠，归档时必须由同一协调 owner 收敛为一份完整 requirement，不能用其旧计数覆盖新增目录。

## Non-goals

不增加 AI 模型调用；不移植 Cocos 4 runtime；不重做任务队列、审批、Lumen、参考图现有功能；不加入参考图删除/解绑、光照探针或 Lightmap 烘焙；不放宽 `scene.save` 和 Pro `preview.capture` 边界；不扩大 Creator 写入版本范围；不自动发布、签名上传或迁移用户工程。本轮只生成规划文件，不修改产品代码。

## Acceptance and Priority

P1 先验收，再开放 P2。A1 要求全部读取操作有非空、具体且能校验真实结果的 schema，合法、空结果和畸形结果用例均通过。A2 要求一次超过 30 秒的同任务构建可续查到经产物验证的终态，重复查询不新增构建，跨连接和错误取消被拒绝。A3 要求六类业务语义在显式目标上生效，选区变化不能改变实际目标。A4 要求指定/批量、进度、取消、清理及失败后的实际资源状态均可验证。A5 要求标准 MCP 客户端完成初始化、资源列表/模板/读取，且越权、路径逃逸、过期游标和超量请求失败。

粒子、反射探针及构建必须在 Creator 3.8.3 和 3.8.7 的隔离工程逐版验收，记录候选身份、实际目标、状态读回、产物身份、原始增量日志及清理结果；Node 测试和接口存在性不能替代实机证据。任何能力缺证时不得宣称完成或开放其写路径。

## Rollback

标准适配入口可独立关闭；新增写能力按精确版本和能力门禁关闭后，既有工具仍可用。已开始的原生任务先停止新增受理并排空或报告未确认状态，再回退候选；不强杀 Creator，不删除既有用户资源，不把停止跟踪报告为回滚成功。
