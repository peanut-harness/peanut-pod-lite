# Tasks

## 1. 基线与创建契约

- [ ] 1.1 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/tests/**, packages/engine/modules/lumen/tests/**] [depends: none] [serial] [owner: coordinator] 冻结 `lumen.scaffold`、`prefab.createFromNode`、Scene 首次创建、目标已存在、AssetDB pending、日志检查点和现有更新路径的迁移前行为；以 MCP/Lumen 定向测试通过并记录当前失败分类为验收。
- [ ] 1.2 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/**asset-db**, packages/engine/modules/mcp/tests/editor-mcp-asset-db-*.test.mts] [depends: 1.1] [serial] [owner: coordinator] 定义首次创建请求、阶段、AssetDB 身份、清理结果和 allow-list 证据类型，明确 create 与既有 commit/update 的调用边界；以类型检查和构造/非法输入单测验收。
- [ ] 1.3 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/resource-operation-*, packages/engine/modules/mcp/tests/resource-operation-*.test.mts] [depends: 1.2] [serial] [owner: coordinator] 将目标路径、父目录、`.meta` 和已知依赖纳入首次创建资源闭包，保持同目标跨连接 FIFO 与不同目标并行；以并发同目标、已存在目标和幂等复用/冲突测试验收。

## 2. AssetDB 原子创建事务

- [ ] 2.1 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/editor-mcp-asset-db-transaction.ts, packages/engine/modules/mcp/src/**creation**, packages/engine/modules/mcp/tests/editor-mcp-asset-db-*.test.mts] [depends: 1.3] [serial] [owner: coordinator] 提取可复用的父目录登记与探针清理边界，并实现 `reserved -> parent_ready` 阶段；以父目录未登记、探针创建失败、删除失败和零残留测试验收。
- [ ] 2.2 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/**creation**, packages/engine/modules/mcp/tests/editor-mcp-asset-db-*.test.mts] [depends: 2.1] [serial] [owner: coordinator] 通过 AssetDB `create-asset` 发布规范化 Prefab/Scene 内容并等待真实 UUID、`.meta` 和子资源，禁止普通磁盘写入充当首次发布；以成功、超时、空 UUID、缺 `.meta` 和子资源 pending 测试验收。
- [ ] 2.3 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/**creation**, packages/engine/modules/mcp/src/resource-operation-task-executor.ts, packages/engine/modules/mcp/tests/**] [depends: 2.2] [serial] [owner: coordinator] 把不可逆 commit 窗口推迟到主资源发布前，并实现发布前取消、发布后拒绝取消、受控 delete/query 回滚和 `unchanged|may_have_changed` 分类；以取消/超时/部分发布/所有权不匹配清理测试验收。
- [ ] 2.4 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/**postflight**, packages/engine/modules/mcp/src/resource-operation-task-executor.ts, packages/engine/modules/mcp/tests/**] [depends: 2.3] [serial] [owner: coordinator] 将创建身份与清理证据接入唯一 postflight，确保 pending、引用失败、`original asset is not exist` 或新增日志警告阻止成功且 Hub 不重复 settle；以成功/失败各仅一次 postflight 和安全证据投影测试验收。

## 3. Lumen、Prefab 与 Scene 入口迁移

- [ ] 3.1 [repo: peanut-pod-lite] [paths: packages/engine/modules/lumen/source/**, packages/engine/modules/lumen/tests/**] [depends: 1.2] [serial] [owner: coordinator] 为 Prefab/Scene scaffold 增加不落盘的规范化序列化出口，并保持既有模板、根节点、UUID 引用和 Creator 2.4 路径兼容；以 Lumen 全量测试和序列化快照验收。
- [ ] 3.2 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/editor-mcp-lumen-gateway.ts, packages/engine/modules/mcp/src/editor-mcp-lumen-commit-facade.ts, packages/engine/modules/mcp/tests/**] [depends: 2.4, 3.1] [serial] [owner: coordinator] 将 3.x `lumen.scaffold` 首次创建迁移到原子创建事务，已有资源结构/组件更新继续走原 commit；以 Prefab/Scene 首次创建、重复目标拒绝、后续编辑和引用校验集成测试验收。
- [ ] 3.3 [repo: peanut-pod-lite] [paths: packages/engine/modules/mcp/src/editor-mcp-scene-gateway.ts, packages/engine/modules/mcp/src/editor-mcp-scene-host-routes.ts, packages/engine/modules/mcp/src/editor-mcp-action-router.ts, packages/engine/modules/mcp/tests/**] [depends: 2.4] [serial] [owner: coordinator] 盘点并迁移 `prefab.createFromNode` 及其它 Creator 原生首次创建入口，使其共享目标预留和身份确认，同时保持 `scene.save` fail-closed；以 Creator 消息模拟、目标冲突、失败清理和既有 Scene/Prefab 操作回归验收。
- [ ] 3.4 [repo: peanut-pod-lite] [paths: packages/engine/modules/policy/tests/**, packages/engine/modules/kernel/tests/**, packages/engine/modules/mcp/tests/**] [depends: 3.2, 3.3] [serial] [owner: coordinator] 运行跨层契约矩阵，确认 83 项 operation、45 项 managed write、默认同步结果、审批租约、幂等和非创建 update 路径无漂移；以相关 package 全量测试与 catalog parity 通过验收。

## 4. 失败契约、文档与自动化证据

- [ ] 4.1 [repo: peanut-pod-lite] [paths: packages/protocol/src/**, packages/engine/modules/policy/src/**, packages/hosts/modules/creator-38/src/**, packages/**/tests/**] [depends: 2.4] [serial] [owner: coordinator] 若现有 DTO 不足，仅追加兼容的创建冲突、registration pending、清理结果和保守项目状态字段，并确保 Host/Hub 原样透传且不泄露绝对路径或内容；以 protocol/policy/kernel/host 契约测试验收。
- [ ] 4.2 [repo: peanut-pod-lite] [paths: packages/hosts/modules/creator-38/scripts/**, packages/engine/modules/mcp/docs/CREATOR-VERIFY.md] [depends: 3.4, 4.1] [serial] [owner: coordinator] 扩展实机脚本覆盖 Prefab/Scene 首次创建、双连接同目标竞争、commit 前取消、发布失败清理、UUID/`.meta`/引用和增量日志，并输出不含 token 的结构化报告；以脚本 syntax/typecheck 与模拟 fixture 验收。
- [ ] 4.3 [repo: peanut-pod-lite] [paths: README.md, docs/MCP-TASK-QUEUE-DESIGN.md, docs/INSTALLATION.md, knowledge/**] [depends: 4.2] [serial] [owner: coordinator] 更新安装、设计、AI 成功判据和知识卡，移除“写后 refresh 可作为首次创建成功”的旧描述并保持 Creator 版本画像准确；以文档检索、Hub card 范围检查和 `git diff --check` 验收。

## 5. 全量验证与 Creator 实机矩阵

- [ ] 5.1 [repo: peanut-pod-lite] [paths: repository-wide read-only validation] [depends: 4.3] [serial] [owner: coordinator] 执行 `npm run verify`、`npm run pack`、`git diff --check` 和 OpenSpec strict validation，确认 lockfile、83 项目录和未相关源码无意外变化，并保存明确退出码与候选 Host/Core digest。
- [ ] 5.2 [repo: peanut-pod-lite] [paths: Creator 3.8.3/3.8.7 external QA evidence] [depends: 5.1] [serial] [owner: coordinator] 在 Creator 3.8.3 与 3.8.7 安装同一候选包并运行完整原子创建矩阵，证明真实 UUID/`.meta`、同目标无覆盖、取消/失败零残留、每任务唯一 postflight、无 `original asset is not exist` 且日志增量零 error/warn；以两个精确版本的结构化报告与产物身份一致为验收。
- [ ] 5.3 [repo: peanut-pod-lite + peanut-hub] [paths: openspec/changes/stabilize-prefab-scene-assetdb-creation/**, peanut-pod-lite/knowledge/**, peanut-hub/knowledge/repositories/peanut-pod-lite.md, peanut-hub/knowledge/sync.json] [depends: 5.2] [serial] [owner: coordinator] 同步最终 Lite/Hub 知识，执行 Hub RAG `build` 与 `check-sync --brief --repo peanut-pod-lite`，再运行 `openspec status`、`openspec validate --strict` 和最终 Git/远端状态检查，确认实现、规格、证据与状态卡一致。
