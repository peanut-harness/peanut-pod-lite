/**
 * @description editor-mcp 能力种子目录（与执行分流解耦，减薄 action-router）。
 */
import type { EditorMcpOperationId, LocalizedText } from '@peanut/pod-protocol';

/**
 * @description 能力种子（lane / description 前缀由 listCapabilities 注入；不继承 ContractPayload，避免索引签名冲掉字段类型）。
 */
export interface EditorMcpCapabilitySeed {
    /** @description 稳定操作标识。 */
    readonly operation: EditorMcpOperationId;
    /** @description 是否只读。 */
    readonly readOnly: boolean;
    /** @description 风险等级。 */
    readonly risk: 'read' | 'write' | 'destructive';
    /** @description 面向调用方的能力说明。 */
    readonly description: LocalizedText;
    /** @description 是否要求输入参数。 */
    readonly requiresInput: boolean;
}

export const EDITOR_MCP_CAPABILITY_SEEDS: readonly EditorMcpCapabilitySeed[] = [
    {
        operation: 'editor.queryVersion',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current Cocos Creator version.',
            'zh-CN': '查询当前 Cocos Creator 版本。',
        },
        requiresInput: false,
    },
    {
        operation: 'editor.queryProject',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current project name and path.',
            'zh-CN': '查询当前项目名称和路径。',
        },
        requiresInput: false,
    },
    {
        operation: 'editor.querySelection',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current editor selection.',
            'zh-CN': '查询当前编辑器选区。',
        },
        requiresInput: false,
    },
    {
        operation: 'editor.setSelection',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Set editor selection by node paths and/or ids (clear with clear:true).',
            'zh-CN': '按节点路径和/或 id 设置编辑器选区（clear:true 清空）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.queryInfo',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query asset information by path/UUID, or batch via paths[] / uuids[].',
            'zh-CN': '按路径/UUID 查询资源信息；可用 paths[] / uuids[] 批量。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.readText',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Read one or multiple UTF-8 text files within assets in input order. Default limits: 32 files, 1 MiB per file, 4 MiB encoded request and response. Success requires all files and a consistent revision.',
            'zh-CN': '按输入顺序读取 assets 内单个或多个 UTF-8 文本。默认每批 32 文件、每文件 1 MiB、编码请求及响应各 4 MiB；全部文件成功且 revision 一致才算成功。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.catalog.summary',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Return asset-catalog size summary for the current project.',
            'zh-CN': '返回当前项目资产目录规模摘要。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.catalog.lookup',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Fast-lookup assets by uuid/type/name/path from the local catalog index.',
            'zh-CN': '从本地资产目录索引按 uuid/类型/名称/路径快查资源。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.catalog.refresh',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Rebuild the local asset-catalog index after assets change.',
            'zh-CN': '资源变更后重建本地资产目录索引。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.importPlan',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Analyze sources and return dependency-ordered import layers (Spine/DragonBones/BMFont closure).',
            'zh-CN': '分析源资源并返回依赖分层导入计划（含 Spine/DragonBones/BMFont 闭包）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.import',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Import assets in dependency order with per-layer AssetDB stability wait.',
            'zh-CN': '按依赖拓扑分层导入资源，并在每层后等待 AssetDB 稳定。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.managedStatus',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Verify managed-import ledger status for project assets (source hash / uuid).',
            'zh-CN': '校验 MCP 导入账本中资产的受管状态（源哈希 / uuid）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.queryDependencies',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                "Query asset dependencies and reverse dependencies from a disk file graph. Optional expand:['materialTextures'] adds material→texture hops.",
            'zh-CN': "基于磁盘序列化图查询资产依赖与反向依赖。expand:['materialTextures'] 可展开材质→贴图二跳。",
        },
        requiresInput: true,
    },
    {
        operation: 'asset.replaceReferences',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US':
                'Batch-replace __uuid__ references from A to B in serialized assets (prefab/scene/mtl/…). Supports @sub and dryRun; then refresh changed paths.',
            'zh-CN': '在序列化资产中批量把 __uuid__ 引用从 A 换成 B（prefab/scene/mtl 等）。支持 @sub 与 dryRun；写后刷新改动路径。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.waitReady',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Wait until Creator asset-db query-ready is true (shared import/refresh settle contract for plugins and agents).',
            'zh-CN': '等待 Creator asset-db query-ready 为 true（导入/刷新共用就绪契约，供插件与 Agent）。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.scanMissingReferences',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Scan the project for unresolved asset UUID references.',
            'zh-CN': '扫描工程中未能解析的资源 UUID 引用。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.findReferencingNodes',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Find prefab/scene nodes referencing a UUID; missingOnly finds unresolved refs; optional nodeNameContains/nodePathContains filters (PinK 33).',
            'zh-CN':
                '查找引用指定 UUID 的 Prefab/Scene 节点；missingOnly 扫缺失引用；可用 nodeNameContains/nodePathContains 二次筛选（对齐 PinK 33）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.resolve',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Resolve between asset uuid, path, and db:// url, including subAssets.',
            'zh-CN': '在资源 uuid / 路径 / db:// url 之间互查，并返回 subAssets。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.search',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Search assets by name/uuid/path/type/dependencies/dependents/missing/bundle; optional pathContains folder filter.',
            'zh-CN': '按名称/uuid/路径/类型/依赖/被依赖/缺失引用/Bundle 搜索；可用 pathContains 限文件夹。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.auditUnmanagedWrites',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Find assets/ files missing from or drifted vs MCP import ledger (detect hand-edits).',
            'zh-CN': '找出未入账或相对 MCP 导入账本漂移的 assets/（侦测旁路手改）。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.queryPropertySchema',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Describe disk .meta fields for an asset (Inspector component fields use lumen.schema).',
            'zh-CN': '描述资产磁盘 .meta 字段（组件 Inspector 字段请用 lumen.schema）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.queryInheritance',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query asset extends / compatible child importers and subAssets.',
            'zh-CN': '查询资产 extends / 兼容子资源 importer 与 subAssets。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.queryCompatibleTypes',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'RefPicker-style compatible types for a typeName, script field, or asset.',
            'zh-CN': '按类型名 / 脚本字段 / 资源做 RefPicker 风格兼容类型查询。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.open',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Open or reveal an asset in Creator Asset panel (thin message layer).',
            'zh-CN': '在 Creator 资源面板打开/揭示资产（薄层 message）。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.copy',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                "Silently copy an asset's dependency closure to a target directory on disk (new uuids, no AssetDB overwrite dialog), then refresh.",
            'zh-CN': '静默把资产依赖闭包复制到目标目录（磁盘为真源，换新 uuid，不弹 AssetDB 覆盖确认），随后刷新。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.move',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Silently move a file or folder (with its .meta) on disk, keeping uuid, then refresh.',
            'zh-CN': '静默移动文件/文件夹（含 .meta），保留 uuid，随后刷新。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.rename',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Silently rename a file or folder in place (with its .meta), keeping uuid, then refresh.',
            'zh-CN': '静默原地重命名文件/文件夹（含 .meta），保留 uuid，随后刷新。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.createFolder',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Silently mkdir -p and write minimal directory .meta for any missing ancestor, then refresh.',
            'zh-CN': '静默创建目录（含缺失的中间目录 .meta），随后刷新。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.delete',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US':
                'Silently delete files/folders (with .meta) on disk without the recycle-bin confirm dialog. Requires confirmDestructive:true and refuses when external dependents exist outside the deletion set.',
            'zh-CN': '静默删除文件/文件夹（含 .meta），不弹回收站确认。需 confirmDestructive:true；若删除集合外仍有依赖方会拒绝。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.reimport',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Reimport existing registered assets through native reimport-asset, verifying their source bytes and UUIDs. Use lumen.refresh to discover externally added files.',
            'zh-CN': '经原生 reimport-asset 重新导入已登记资源，并校验源字节和 UUID。外部新增文件请使用 lumen.refresh 扫描入库。',
        },
        requiresInput: false,
    },
    {
        operation: 'asset.writeText',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Silently write UTF-8 text under assets/ (mkdir + directory .meta as needed), then one coalesced lumen.refresh. Prefer this over IDE writeFile while Creator is open to reduce Assets-panel races. Use files[] for batch. Never save-asset.',
            'zh-CN':
                '静默写入 assets/ 下 UTF-8 文本（按需建目录与 directory .meta），再一次合并 lumen.refresh。Creator 开着时优先于 IDE 直写，降低 Assets 面板竞态。批量用 files[]。禁止 save-asset。',
        },
        requiresInput: true,
    },
    {
        operation: 'asset.ensureSpriteFramesBatch',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Ensure imported PNGs have SpriteFrame sub-assets (@f9941) via AssetDB save-asset-meta (not disk .meta surgery).',
            'zh-CN': '经 AssetDB save-asset-meta 批量确保已导入 PNG 具备 SpriteFrame 子资源（@f9941），避免改盘 .meta + reimport 竞态。',
        },
        requiresInput: true,
    },
    {
        operation: 'scene.getCurrent',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current scene root snapshot.',
            'zh-CN': '查询当前场景根节点快照。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.getHierarchy',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current scene hierarchy snapshot (editor-only nodes filtered by default).',
            'zh-CN': '查询当前场景节点快照列表（默认过滤编辑器内部节点）。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.queryCurrentEditorResource',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query the current editor resource with a safe open-scene plan (never treats logs/temp as scenes).',
            'zh-CN': '查询当前编辑器资源并给出安全恢复计划（绝不把 log/temp 当场景）。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.restoreEditorResource',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Safely restore a prior editor resource (open-scene only for valid db://assets/*.scene).',
            'zh-CN': '安全恢复先前编辑器资源（仅合法 db://assets/*.scene 才 open-scene）。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.resolvePrefabRootUuid',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Resolve the real Prefab-editor root node uuid by root name (skips hidden facade wrappers).',
            'zh-CN': '按根名解析 Prefab 编辑器真实根节点 uuid（跳过隐藏 facade）。',
        },
        requiresInput: true,
    },
    {
        operation: 'scene.open',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'OPTIONAL presentation: open a scene so the user can see it (UUID or guarded db://assets/*.scene → UUID). Not required for lumen edits; lumen writes the .scene file offline.',
            'zh-CN': '可选呈现：打开场景给人看（UUID 或经守卫的 db://assets/*.scene → UUID）。lumen 离线写 .scene 不需要先打开。',
        },
        requiresInput: true,
    },
    {
        operation: 'scene.save',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'REFUSED: Creator save-scene opens confirm UI and hangs Agents. Persist via lumen.* offline write → lumen.commit → preview.refresh (lane:preview). Do NOT use scene.open/reload as a write prerequisite; scene.open is presentation-only after edits.',
            'zh-CN':
                '已拒绝：Creator save-scene 会弹确认框卡住自动化。持久化走 lumen 离线写 → lumen.commit → preview.refresh（preview 车道）。禁止把 scene.open/reload 当写盘前置；scene.open 仅改完后给人看。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.reload',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'OPTIONAL: soft-reload the currently open scene tab to match disk after lumen.commit. Not part of the default accept pipeline; prefer preview.refresh for verify.',
            'zh-CN': '可选：当前已打开的场景页签在 lumen.commit 后跟磁盘对齐。不进默认验收链；验收优先 preview.refresh。',
        },
        requiresInput: false,
    },
    {
        operation: 'scene.queryNode',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Find a node in the current hierarchy by path or name.',
            'zh-CN': '按路径或名称在当前场景层次中查找节点。',
        },
        requiresInput: true,
    },
    {
        operation: 'scene.focusNode',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Focus / reveal a hierarchy node and select it (best-effort message).',
            'zh-CN': '聚焦/揭示层级节点并选中（尽力 message）。',
        },
        requiresInput: true,
    },
    {
        operation: 'scene.createNode',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Create a live scene node (empty/Camera/Light) via Creator message.',
            'zh-CN': '通过 Creator 消息在当前场景创建节点（empty/Camera/Light）。',
        },
        requiresInput: false,
    },
    {
        operation: 'prefab.createFromNode',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Create a Prefab asset from a scene node (best-effort).',
            'zh-CN': '从场景节点创建 Prefab 资产（尽力）。',
        },
        requiresInput: true,
    },
    {
        operation: 'prefab.apply',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Apply Prefab instance overrides to the asset (best-effort).',
            'zh-CN': '将 Prefab 实例覆盖写回资产（尽力）。',
        },
        requiresInput: true,
    },
    {
        operation: 'prefab.revert',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Revert Prefab instance overrides (best-effort).',
            'zh-CN': '还原 Prefab 实例覆盖（尽力）。',
        },
        requiresInput: true,
    },
    {
        operation: 'prefab.unpack',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US': 'Unpack a Prefab instance into plain nodes (best-effort).',
            'zh-CN': '将 Prefab 实例解包为普通节点（尽力）。',
        },
        requiresInput: true,
    },
    {
        operation: 'prefab.unlink',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US': 'Unlink a Prefab instance (best-effort; may fall back to unpack).',
            'zh-CN': '解除 Prefab 实例关联（尽力；失败时可回退 unpack）。',
        },
        requiresInput: true,
    },
    {
        operation: 'prefab.getInfo',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query Prefab asset or instance info.',
            'zh-CN': '查询 Prefab 资产或实例信息。',
        },
        requiresInput: true,
    },
    {
        operation: 'preview.query',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query preview URL/port/startScene when Creator exposes preview messages.',
            'zh-CN': '在 Creator 暴露预览消息时查询预览 URL/端口/启动场景。',
        },
        requiresInput: false,
    },
    {
        operation: 'preview.refresh',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Accept pipeline step 2 after lumen.commit validation ok: refresh preview (optional AssetDB refresh). Then preview.queryErrors. Does not open scene tabs.',
            'zh-CN':
                '验收第 2 步（lumen.commit 且 validation 通过后）：刷新预览（可先 AssetDB refresh），接着 preview.queryErrors。不打开场景页签。',
        },
        requiresInput: false,
    },
    {
        operation: 'preview.queryErrors',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Accept pipeline step 3 after preview.refresh: read preview/editor errors. MUST pass sinceOffset (from prior logOffset) — then trust verdict pass/fail. Without sinceOffset verdict=observe (historical only, NOT failure). Ignore console.error stack frames.',
            'zh-CN':
                '验收第 3 步（preview.refresh 后）：读预览/编辑器错误。必须传 sinceOffset（用上次 logOffset），再看 verdict=pass/fail。无 sinceOffset 时 verdict=observe（仅历史观测，不算失败）。忽略 console.error 栈帧。',
        },
        requiresInput: false,
    },
    {
        operation: 'builder.queryPlatforms',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'List builder platforms when Creator exposes builder messages.',
            'zh-CN': '在 Creator 暴露 builder 消息时列出构建平台。',
        },
        requiresInput: false,
    },
    {
        operation: 'builder.querySchema',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query build option schema for a platform (best-effort).',
            'zh-CN': '查询指定平台构建选项 schema（尽力）。',
        },
        requiresInput: false,
    },
    {
        operation: 'builder.queryDefaultConfig',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Query default build config for a platform (best-effort).',
            'zh-CN': '查询指定平台默认构建配置（尽力）。',
        },
        requiresInput: false,
    },
    {
        operation: 'builder.build',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US': 'Start a Creator build task (destructive; requires confirmDestructive).',
            'zh-CN': '启动 Creator 构建任务（destructive；需 confirmDestructive）。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.schema',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'List lumen component property schema or describe one component type.',
            'zh-CN': '列出 lumen 组件属性白名单，或描述单个组件类型。',
        },
        requiresInput: false,
    },
    {
        operation: 'lumen.templates',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'List bundled lumen default_prefab template ids.',
            'zh-CN': '列出 lumen 内置 default_prefab 模板 id。',
        },
        requiresInput: false,
    },
    {
        operation: 'lumen.tree',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Read a prefab node tree via lumen.',
            'zh-CN': '通过 lumen 只读查看 Prefab 节点树。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.inspect',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Inspect a prefab/scene node, or a standalone asset when nodePath is omitted.',
            'zh-CN': '检视 Prefab/Scene 节点；独立资产可省略 nodePath。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.validateRefs',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Validate prefab/scene UUIDs, serialized __id__ graph, ownership, script reference types, sprite asset types, and click targets. Engine/default_prefab builtins are ignored (ignoredEngineDefaultUuid). Call after write before preview.',
            'zh-CN':
                '校验 Prefab/Scene UUID、序列化 __id__ 图、节点组件归属、脚本引用类型、Sprite 资源类型与点击目标；引擎/default_prefab 内置 uuid 计入 ignoredEngineDefaultUuid。写后、预览前调用。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.scaffold',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Scaffold or open a prefab with lumen. Pass reset:true to delete and recreate an existing asset before scaffolding.',
            'zh-CN': '用 lumen 脚手架创建或打开 Prefab；已存在时传 reset:true 可先删再建。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.structure',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Build a prefab subtree from an inline lumen recipe.',
            'zh-CN': '用内联 lumen 配方在 Prefab 下搭节点树。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.compileRecipe',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US': 'Compile a lumen recipe into in-memory Prefab entries without writing files.',
            'zh-CN': '按 lumen 配方编译内存 Prefab 条目，不写盘。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.nodeAdd',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Add a child node from a lumen template.',
            'zh-CN': '从 lumen 模板添加子节点。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.nodeRm',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US': 'Remove a prefab node via lumen.',
            'zh-CN': '用 lumen 删除 Prefab 节点。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.nodeRename',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Rename a prefab node via lumen.',
            'zh-CN': '用 lumen 重命名 Prefab 节点。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.nodeReorder',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Reorder a child node under a parent via lumen.',
            'zh-CN': '用 lumen 重排父节点下的子节点。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.compAdd',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Attach a builtin or script component via lumen. scriptName: assets/.../*.ts path or filename (not @ccclass alone when ambiguous). Run asset.catalog.refresh before bind*.',
            'zh-CN':
                '用 lumen 挂载内置或脚本组件。scriptName 传 assets/.../*.ts 或文件名；多脚本同名时勿只用 @ccclass。bind* 前先 catalog.refresh。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.compRm',
        readOnly: false,
        risk: 'destructive',
        description: {
            'en-US': 'Remove a component from a node via lumen.',
            'zh-CN': '用 lumen 从节点移除组件。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.compSet',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Set whitelisted component properties via lumen. nodeRef/componentRef fields: node path string (e.g. sampleLabel: "/Root/Title"). Prefer over lumen.bindRef for @property(Label) etc.',
            'zh-CN':
                '用 lumen 写入白名单组件属性。nodeRef/componentRef 字段值为节点路径字符串（如 sampleLabel: "/Root/Title"）。@property 引用优先 comp-set，不必 bind-ref。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.assetSet',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Patch standalone asset Inspector fields. For .anim prefer curves/events; raw tracks need allowRawTracks.',
            'zh-CN': '写独立资产 Inspector 字段。.anim 优先 curves/events；原始 tracks 须 allowRawTracks。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.nodeSet',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Set node properties via lumen.',
            'zh-CN': '用 lumen 写入节点属性。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.bindClick',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Bind a Button click handler via lumen. component: script path/filename/uuid or unique @ccclass; handler: method name. Requires lumen-comp-add on target first.',
            'zh-CN':
                '用 lumen 绑定 Button 点击。component 传脚本路径/文件名/uuid 或唯一 @ccclass；handler 为方法名。目标节点须先 lumen-comp-add 挂载脚本。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.bindSprite',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Bind a SpriteFrame uuid via lumen.',
            'zh-CN': '用 lumen 绑定 SpriteFrame uuid。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.bindSpriteBatch',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Bind multiple SpriteFrame uuids in one lumen call.',
            'zh-CN': '一次 lumen 调用批量绑定多个 SpriteFrame。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.bindRef',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Bind node/component reference onto a script field. componentRef: { nodePath, type }; type is cc.Label etc. Requires comp-add + lumen-schema first. Equivalent: lumen-comp-set with path string in props.',
            'zh-CN':
                '绑定脚本 @property 引用。componentRef 为 { nodePath, type }（type 如 cc.Label）。须先 comp-add 与 lumen-schema。等效：lumen-comp-set 的 props 里写节点路径字符串。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.bindController',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Offline bind a same-name TypeScript controller onto a prefab root with path-based node refs and button click handlers.',
            'zh-CN': '离线把同名 TypeScript 控制器绑到 Prefab 根节点，支持按路径节点引用与按钮点击。',
        },
        requiresInput: true,
    },
    {
        operation: 'lumen.refresh',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US': 'Request Creator AssetDB refresh after lumen writes.',
            'zh-CN': 'lumen 写盘后请求 Creator AssetDB 刷新。',
        },
        requiresInput: false,
    },
    {
        operation: 'lumen.commit',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Accept pipeline step 1: AssetDB refresh + catalog rebuild; pass .prefab/.scene paths for validateRefs. On ok follow recommendedNext → preview.refresh → preview.queryErrors. Never scene.save/open/reload for writing.',
            'zh-CN':
                '验收第 1 步：AssetDB 刷新并重建 catalog；prefab/scene 路径附带 validateRefs。通过后跟 recommendedNext → preview.refresh → preview.queryErrors。写盘禁止 scene.save/open/reload。',
        },
        requiresInput: false,
    },
    {
        operation: 'lumen.cocosInfo',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Probe project Creator version and optional engine d.ts compare. inEngineNotInWhitelist is paginated; with engine TS source also returns inEngineNotInWhitelistFields. Field auto-map is not trusted.',
            'zh-CN':
                '探测项目 Creator 版本；可选对照引擎 d.ts。缺口见 inEngineNotInWhitelist（可分页）；引擎 TS 源另有 inEngineNotInWhitelistFields。禁止自动写入白名单。',
        },
        requiresInput: false,
    },
    {
        operation: 'lumen.lodRecalcBounds',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Recalculate cc.LODGroup bounds via Creator scene execute-component-method(recalculateBounds). Requires live Hub + nodePath. Returns serializable fields + lumen.compSet/commit guidance (never scene.save). Refuses without message grant (no fake success).',
            'zh-CN':
                '?? Creator scene execute-component-method(recalculateBounds) ?? cc.LODGroup ?????? Hub ?? + nodePath???????????? lumen.compSet/commit??? scene.save??? message ? refused???????',
        },
        requiresInput: false,
    },
    {
        operation: 'reference.queryImage',
        readOnly: true,
        risk: 'read',
        description: {
            'en-US':
                'Query scene reference image via Creator reference-image public messages (query-current / query-config). Requires Hub message grant; refuses cleanly when unavailable.',
            'zh-CN':
                '?? Creator reference-image ?????query-current / query-config??????????? Hub message??????? refused?',
        },
        requiresInput: false,
    },
    {
        operation: 'reference.setImage',
        readOnly: false,
        risk: 'write',
        description: {
            'en-US':
                'Set scene reference image via Creator reference-image public messages (add-image / switch-image / set-image-data). Supports opacity/transform; never calls remove-image (UI confirm). No custom overlay panel.',
            'zh-CN':
                '?? Creator reference-image ?????add-image / switch-image / set-image-data??????????????/??????????? remove-image???? overlay?',
        },
        requiresInput: true,
    },
];

/** @description router 兼容别名。 */
export const CAPABILITIES = EDITOR_MCP_CAPABILITY_SEEDS;
