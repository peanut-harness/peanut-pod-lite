# Lumen AI Playbook

本手册说明自动化客户端如何通过 Lite MCP 修改 Creator 可序列化资源。Lumen 只写工程源文件及 `.meta`，不直接修改 `library/`、`temp/` 或编辑器缓存。

权威契约见 [`@peanut/pod-engine/lumen`](../../lumen/README.md)；资产字段覆盖见 [`ASSET-INSPECTOR-PARITY.md`](./ASSET-INSPECTOR-PARITY.md)；产品线门禁见 [`LUMEN-PRODUCT-LINE-PARITY.json`](./LUMEN-PRODUCT-LINE-PARITY.json)。

## 调用边界

```text
MCP client
  → CPM bridge
  → Creator Lite host
  → peanut.editor-mcp
  → approval lease validation
  → EditorMcpLumenGateway
  → LumenSession
```

- 只读 operation 可直接调用。
- 写入与破坏性 operation 必须消费绑定 operation、精确 resources 与 risk 的一次性租约。
- Pro operation、未知 operation、缺 schema 或空资源授权必须拒绝。
- UI 展示、订阅与登录状态不能替代本地写入审批。

## 标准写入流程

1. 用模板和 schema 查询确定输入边界。
2. 新建 Prefab/Scene 时用 `lumen.scaffold` 触发 AssetDB 原子创建；成功结果必须含 `creation.phase=verified`、真实 UUID 与 `.meta`，不得把普通 refresh 当作创建成功。
3. 用 structure、node、component 或 asset operation 编辑已存在资源，并通过 `lumen.commit` 集中提交本批次更新路径。
4. 对资源引用执行 UUID、子资源 UUID、脚本属性和 Prefab 绑定校验。
5. 等待已有资源更新的 AssetDB settle；首次创建的 settle 已由 scaffold 唯一 postflight 完成，不重复触发。
6. 重新读取落盘资源及 `.meta`，再检查本轮 `project.log` 增量。

多个文件必须批量提交，避免每个文件单独触发 AssetDB 刷新。不得用 `scene.save`、外部文件复制或直接改缓存目录绕过 Lumen/MCP 写入边界。

## 资源导入

资源导入按以下顺序执行：

1. `asset.importPlan` 解析来源、依赖闭包和目标路径。
2. 为计划中的精确资源签发一次性审批租约。
3. `asset.import` 分层导入并等待每层 AssetDB 稳定。
4. 必要时调用 SpriteFrame 保证操作，由 Creator 写入标准 subMeta。
5. 重新查询资源 UUID、类型和依赖，不能仅凭文件存在判定成功。

覆盖已有目标时必须显式选择 replace/overwrite，或者返回结构化冲突；禁止触发原生覆盖、重命名或确认对话框。

## 组件与绑定

- 先创建节点，再挂载单个兼容 renderable；同节点存在互斥 renderable 时必须提前拒绝。
- 绑定 SpriteFrame、Prefab、脚本组件或其它资源字段前先查询兼容类型。
- 保存并刷新后重新读取组件属性，确认序列化 UUID 与期望资源一致。
- 对所有 schema 可挂载组件执行矩阵测试；抽象、废弃和冲突组件验证结构化拒绝。

可重复的全组件与绑定验收命令见 [`CREATOR-VERIFY.md`](./CREATOR-VERIFY.md)。

## 验收规则

- 以 MCP 返回、资源落盘内容和 `project.log` 增量为证据，禁止截图判定。
- 写入前记录日志偏移，写入后只分析新增 error 和 warning。
- 无租约拒绝必须零副作用；成功结果必须经刷新和重新读取确认。
- 临时 fixture、日志、轮询快照和机器绝对路径保存在独立 QA 工程，不提交到 Lite 仓库。
