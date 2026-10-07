# Peanut Editor MCP Plugin

`peanut.editor-mcp` 是面向 MCP 宿主的 Cocos Creator 编辑器能力插件。除只读查询外，它可调用 **lumen 资产编辑**（Prefab / Scene / 独立资产源文件），供 AI 或自动化脚本使用。付费 operation 由可选 Pro 插件通过统一 MCP capability registry 独立注册，Lite 不实现也不代理付费执行。

## MVP 范围

- **进程内 action（`dispatchMcpAction`，测试/宿主内部用）：** `cocos.capabilities`、`cocos.plan`、`cocos.call`；兼容别名 `editor-mcp.capabilities.list`、`editor-mcp.plan`、`editor-mcp.execute`
- **Hub MCP 工具（一级铺平）：** 每个 operation 一个带命名空间的一级工具 `peanut.editor-mcp.<op-kebab>`（如 `editor-query-version`、`asset-import`、`lumen-comp-set`、`lumen-node-rm`），各带精确 `inputSchema`；**不再有** `capabilities/plan/query/call` 通用入口，也不再把 operation 藏进 payload。MCP 客户端直接按工具名调用，输入即该 operation 的原始入参（写/删的 `confirmDestructive`、批准 `approvalToken` 一并放在该工具输入里）。
- 操作：… **preview query/refresh/errors**、**queryCompatibleTypes**、builder、lumen、导入账本
- **验收路径：** `validateRefs` → `preview.refresh` → `preview.queryErrors`
- **整包规划：** [`docs/LUMEN-ROADMAP.md`](./docs/LUMEN-ROADMAP.md)

## 资产目录快查（给 AI 用）

不要让模型读 `.peanut-ai/asset-catalog/*.json`。应调用：

```typescript
await pluginModule.dispatchMcpAction('cocos.call', { operation: 'asset.catalog.summary' });
await pluginModule.dispatchMcpAction('cocos.call', {
  operation: 'asset.catalog.lookup',
  input: { type: 'script', name: 'SeatItem', limit: 5 },
});
await pluginModule.dispatchMcpAction('cocos.call', { operation: 'asset.catalog.refresh' });
```

## lumen 资产编辑（给 AI 用）

定位：Creator 检视器能改的资产，经 lumen 改源文件 / `.meta`；不写 `library/`。当前已通 Prefab / Scene、`.mtl` / `.anim` / `.pmtl` / `.terrain`、图片 Texture / SpriteFrame `.meta`、Effect `.effect` / chunk、FBX / glTF `.meta`、Auto Atlas `.pac`、LabelAtlas `.labelatlas`、Animation Graph / Variant / Mask、RenderTexture `.rt`、Render Pipeline `.rpp`、Render Flow `.flow`、Render Stage `.stg`、音频 / 视频 / TTF / BitmapFont `.meta`、Spine / DragonBones `.meta`、CubeMap / TiledMap / 文件夹 Bundle `.meta`、粒子 / Sprite Atlas `.plist`、JSON / 文本 `.meta`、Buffer `.bin` `.meta`、脚本 `.ts` / `.js` `.meta`、instantiation dump `.mesh` / `.skeleton` / `.animation` / `.material` `.meta`；其余种类见 [`docs/LUMEN-ROADMAP.md`](./docs/LUMEN-ROADMAP.md)。

音频 `downloadMode` 在已验证 Creator 3.8.3/3.8.7 的原生导入器中固定为 0，检视返回 `downloadModeWritable=false`；写请求在任何源/meta 保存和 commit 前明确拒绝。读取仍呈现实际 meta 值，不强制修改已有文件。显式 `cocosVersion` 必须匹配当前受信 Host 版本，不能用该参数切换旧版写入桥。

管线：`schema` / `templates` → `scaffold` → `structure` / `assetSet` → **`lumen.commit`**（AssetDB + catalog）→ `compSet` / `bind*` → 必要时 `tree` / `inspect` 验收。

完整步骤与黄金样例见 [`docs/LUMEN-AI-PLAYBOOK.md`](./docs/LUMEN-AI-PLAYBOOK.md)。  
Creator 实机验收见 [`docs/CREATOR-VERIFY.md`](./docs/CREATOR-VERIFY.md)。

```typescript
await pluginModule.dispatchMcpAction('cocos.call', { operation: 'lumen.templates' });
await pluginModule.dispatchMcpAction('cocos.call', {
  operation: 'lumen.schema',
  input: { type: 'cc.Label' },
});
await pluginModule.dispatchMcpAction('cocos.call', {
  operation: 'lumen.scaffold',
  input: { prefabRelativePath: 'assets/ui/Demo.prefab', rootName: 'Demo', template: 'empty' },
});
await pluginModule.dispatchMcpAction('cocos.call', {
  operation: 'lumen.structure',
  input: {
    prefabRelativePath: 'assets/ui/Demo.prefab',
    parentPath: '/Demo',
    recipe: {
      name: 'Title',
      template: 'ui/Label',
      props: { string: 'Hello' },
    },
  },
});
await pluginModule.dispatchMcpAction('cocos.call', {
  operation: 'lumen.commit',
  input: { paths: ['assets/ui/Demo.prefab'] },
});
```

MCP tools（节选）：`peanut.editor-mcp.lumen-schema` / `lumen-templates` / `lumen-tree` / `lumen-inspect` / `lumen-scaffold` / `lumen-structure` / `lumen-comp-set` / `lumen-bind-click` / `lumen-commit` 等。

约束：

- `prefabRelativePath` 必须是项目相对路径，拒绝绝对路径与 `..`
- 节点路径必须以 `/` 开头
- `compSet` / `nodeSet` 的 `props` 为内联对象；字段须在 `lumen.schema` 白名单内
- `structure.recipe` 为内联配方（对象或数组），不要传磁盘 recipe 路径
- 写操作会自动 `save`，并返回 `recommendedNext` → `lumen.commit`；可设 `autoCommit: true` 一步收口
- 另提供 `lumen.cocosInfo`；playbook 冒烟：`node scripts/lumen-ai-playbook.smoke.mjs`

所有输入都由 `EditorMcpActionRouter` / `EditorMcpLumenGateway` 校验；不支持任意 Editor 消息或网络服务器。

## 验证

```bash
npm run --workspace @peanut/pod-engine/mcp typecheck
npm run --workspace @peanut/pod-engine/mcp test
# Headless 门禁（无 Creator）
npm run verify:mcp-gate
# macOS nightly（Creator 3.8.7 + test-demos/cocos-plugin-verify）
npm run verify:mcp-nightly
# 产品轨全量装包（权威）
npm run pack:demo -- --project <abs> [--with-host-extension]
# 仅 lumen + editor-mcp 子集（可选）
npm run install-lumen-ai-demo
```

**文档入口（按此顺序）：** 本 README → [`LUMEN-AI-PLAYBOOK.md`](./docs/LUMEN-AI-PLAYBOOK.md) → [`CREATOR-VERIFY.md`](./docs/CREATOR-VERIFY.md) → [`LUMEN-ROADMAP.md`](./docs/LUMEN-ROADMAP.md)。

**Agent / Cursor 发现（工程内）：** `npm run seed-cursor-mcp-agent -- --project <abs>` 或 `lumen-ai-doctor` 写入 `.cursor/mcp.json`、`.cursor/skills/peanut-editor-mcp/SKILL.md`、`.peanut-ai/AGENT-MCP-QUICKREF.md`。

薄层 operation 返回 **`availability`**：`live`（Creator message 成功）、`fallback`（磁盘/端口/query-node-tree 回退）、`refused`（策略拒绝或不支持，含 `scene.save`）。

Creator 实机步骤见 [`docs/CREATOR-VERIFY.md`](./docs/CREATOR-VERIFY.md)；AI 管线见 [`docs/LUMEN-AI-PLAYBOOK.md`](./docs/LUMEN-AI-PLAYBOOK.md)。


### Builder 完成证据

`builder.build` 仅提交一次 `add-task(options, false)`，使用新生成的 `taskId`，并在 30 秒内查询该任务。返回新增 `status`：`busy`（未接收）、`accepted`（已接收但未证明完成）、`failed`（参数错误/任务失败/取消）、`blocked`（接口或证据不可用）、`completed`。`success: true` 现在只对应 `completed`；调用方不可把 `available: true` 或提交枚举 `1` 当构建成功。超时不取消 Creator 任务，不应自动重复提交。

实现依据 Creator 3.8.7 安装包的 `builtin/builder/@types/protected/message.d.ts`（`add-task`、`query-task`）与 `@types/public/options.d.ts`（`taskId`、任务 `id/state/stage/options`），未假设其它 Creator 版本已实机通过。

目前完成证据支持 `web-desktop` / `web-mobile`：同一任务返回 `state: success`、`stage: build`，其实际 `options.dest` 必须位于当前工程内，且存在本次提交后写入的非空 `index.html`。符号链接逃逸、旧产物、只有目录提示均不通过；其它平台缺少制品验证规则时返回 `blocked`。此检查证明构建入口产物存在，不替代浏览器运行验收。

post-build hook 仅对已验证完成触发。`scripts/probe-builder-build-live.mjs` 额外独立检查文件存在、大小、修改时间与工程边界，并要求 `availability: live` 和破坏性确认拒绝测试通过。离线 mocked 回归只验证此协议，不计作宿主实机完成。
