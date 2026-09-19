import type { ContractPayload } from '../shared/common-contracts.js';
import type { LocalizedText } from '../plugin/plugin-contracts.js';

/**
 * @description Editor MCP MVP 支持的稳定 action 标识。
 */
export type EditorMcpActionId =
    | 'editor-mcp.capabilities.list'
    | 'editor-mcp.plan'
    | 'editor-mcp.execute'
    | 'cocos.capabilities'
    | 'cocos.plan'
    | 'cocos.call';

/**
 * @description 薄层 MCP 结果的可观测性：live=Creator message 成功；fallback=磁盘/配置/回退路径；refused=策略拒绝或不支持。
 */
export type EditorMcpThinLayerAvailability = 'live' | 'fallback' | 'refused';

/**
 * @description Editor MCP 执行车道：写盘 / 呈现 / 预览验收互不混用。
 *
 * - `lumen-offline`：静默改盘（lumen.*、资产导入/目录/诊断等）；**不**打开/保存 Creator 场景。
 * - `editor-ui`：给人看或 live 选区/层级（`scene.open`、选区、聚焦等）；**不是** lumen 写盘前置。
 * - `preview`：写后验收（`preview.refresh` / `queryErrors` / `capture`）；与场景页签是否打开无关。
 */
export type EditorMcpExecutionLane = 'lumen-offline' | 'editor-ui' | 'preview';

/**
 * @description 按 operation 解析 Editor MCP 执行车道。
 */
export class EditorMcpExecutionLaneResolver {
    /**
     * @description 将稳定 operation 映射到唯一执行车道。
     * @param operation 稳定操作标识。
     * @returns 执行车道。
     */
    public static resolve(operation: EditorMcpOperationId): EditorMcpExecutionLane {
        if (operation.startsWith('preview.')) {
            return 'preview';
        }
        if (
            operation.startsWith('scene.') ||
            operation.startsWith('prefab.') ||
            operation.startsWith('editor.') ||
            operation === 'asset.open'
        ) {
            return 'editor-ui';
        }
        // lumen.* / asset.*（除 open）/ builder.* / snowb.* → 离线工程操作，不依赖场景页签。
        return 'lumen-offline';
    }

    /**
     * @description 车道说明前缀（写入能力 description，供 Agent / catalog 分流）。
     * @param lane 执行车道。
     * @returns 中英 LocalizedText 片段。
     */
    public static descriptionPrefix(lane: EditorMcpExecutionLane): LocalizedText {
        switch (lane) {
            case 'lumen-offline':
                return {
                    'en-US': '[lane:lumen-offline] Offline project ops; does NOT open/save Creator scene. ',
                    'zh-CN': '[lane:lumen-offline] 离线工程操作；不打开/保存 Creator 场景。 ',
                };
            case 'editor-ui':
                return {
                    'en-US': '[lane:editor-ui] Live editor presentation only (show/select/focus); never a lumen write prerequisite. ',
                    'zh-CN': '[lane:editor-ui] 仅编辑器呈现/选区/聚焦；不是 lumen 写盘前置。 ',
                };
            case 'preview':
                return {
                    'en-US': '[lane:preview] Verify after lumen.commit; independent of open scene tabs. ',
                    'zh-CN': '[lane:preview] lumen.commit 后的预览验收；与场景页签无关。 ',
                };
            default: {
                const _exhaustive: never = lane;
                return _exhaustive;
            }
        }
    }
}

/**
 * @description Editor MCP MVP 支持的稳定操作标识。
 */
export type EditorMcpOperationId =
    | 'editor.queryVersion'
    | 'editor.queryProject'
    | 'editor.querySelection'
    | 'editor.setSelection'
    | 'asset.queryInfo'
    | 'asset.catalog.summary'
    | 'asset.catalog.lookup'
    | 'asset.catalog.refresh'
    | 'asset.importPlan'
    | 'asset.import'
    | 'asset.managedStatus'
    | 'asset.queryDependencies'
    | 'asset.replaceReferences'
    | 'asset.waitReady'
    | 'asset.scanMissingReferences'
    | 'asset.findReferencingNodes'
    | 'asset.resolve'
    | 'asset.search'
    | 'asset.auditUnmanagedWrites'
    | 'asset.queryPropertySchema'
    | 'asset.queryInheritance'
    | 'asset.queryCompatibleTypes'
    | 'asset.open'
    | 'asset.copy'
    | 'asset.move'
    | 'asset.rename'
    | 'asset.createFolder'
    | 'asset.delete'
    | 'asset.reimport'
    | 'asset.writeText'
    | 'asset.ensureSpriteFramesBatch'
    | 'scene.getCurrent'
    | 'scene.getHierarchy'
    | 'scene.queryCurrentEditorResource'
    | 'scene.restoreEditorResource'
    | 'scene.resolvePrefabRootUuid'
    | 'scene.open'
    | 'scene.save'
    | 'scene.reload'
    | 'scene.queryNode'
    | 'scene.focusNode'
    | 'scene.createNode'
    | 'prefab.createFromNode'
    | 'prefab.apply'
    | 'prefab.revert'
    | 'prefab.unpack'
    | 'prefab.unlink'
    | 'prefab.getInfo'
    | 'preview.query'
    | 'preview.refresh'
    | 'preview.queryErrors'
    | 'preview.capture'
    | 'builder.queryPlatforms'
    | 'builder.querySchema'
    | 'builder.queryDefaultConfig'
    | 'builder.build'
    | 'snowb.bmfont.export'
    | 'lumen.schema'
    | 'lumen.templates'
    | 'lumen.tree'
    | 'lumen.inspect'
    | 'lumen.validateRefs'
    | 'lumen.scaffold'
    | 'lumen.structure'
    | 'lumen.compileRecipe'
    | 'lumen.nodeAdd'
    | 'lumen.nodeRm'
    | 'lumen.nodeRename'
    | 'lumen.nodeReorder'
    | 'lumen.compAdd'
    | 'lumen.compRm'
    | 'lumen.compSet'
    | 'lumen.assetSet'
    | 'lumen.nodeSet'
    | 'lumen.bindClick'
    | 'lumen.bindSprite'
    | 'lumen.bindSpriteBatch'
    | 'lumen.bindRef'
    | 'lumen.bindController'
    | 'lumen.refresh'
    | 'lumen.commit'
    | 'lumen.cocosInfo'
    | 'lumen.lodRecalcBounds'
    | 'reference.queryImage'
    | 'reference.setImage';

/**
 * @description 资产目录 MCP 快查输入。
 */
export interface IAssetCatalogLookupMcpInput extends ContractPayload {
    /** @description 精确 UUID；提供时忽略其它过滤条件。 */
    readonly uuid?: string;
    /** @description 类型分桶，如 script/prefab/spriteFrame。 */
    readonly type?: string;
    /** @description 文件名子串。 */
    readonly name?: string;
    /** @description 路径子串。 */
    readonly path?: string;
    /** @description 返回条数上限（默认 20，最大 50）。 */
    readonly limit?: number;
}

/**
 * @description 依赖分层导入计划输入（只读分析，不写盘）。
 */
export interface IAssetImportPlanMcpInput extends ContractPayload {
    /** @description 待分析的源文件路径列表。 */
    readonly sources: readonly string[];
    /** @description 显式依赖表。 */
    readonly dependencyMap?: Readonly<Record<string, readonly string[]>>;
    /** @description 是否从磁盘展开依赖闭包；默认 true。 */
    readonly expandClosure?: boolean;
}

/**
 * @description 依赖分层导入执行输入。
 */
export interface IAssetImportMcpInput extends IAssetImportPlanMcpInput {
    /** @description 目标 `db://assets/...` 目录。 */
    readonly target: string;
    /** @description 覆盖模式；`override` 或 `overwrite: true`。 */
    readonly mode?: string;
    /** @description 是否覆盖已有资源。 */
    readonly overwrite?: boolean;
    /** @description 层内并发度（1–8）。 */
    readonly concurrency?: number;
    /** @description 层后是否刷新并等待 AssetDB；默认 true。 */
    readonly refreshAfter?: boolean;
    /** @description 是否允许缺失依赖继续；默认 false。 */
    readonly allowMissingDependencies?: boolean;
    /** @description 对应 `asset.importPlan` 返回的 planId；受管模式下建议提供。 */
    readonly planId?: string;
}

/**
 * @description 查询 MCP 导入账本受管状态。
 */
export interface IAssetManagedStatusMcpInput extends ContractPayload {
    /** @description 目标 `db://assets/...` 路径列表。 */
    readonly targets: readonly string[];
}

/**
 * @description 磁盘依赖图查询输入。
 */
export interface IAssetQueryDependenciesMcpInput extends ContractPayload {
    /** @description `db://assets/...` 路径。 */
    readonly dbPath?: string;
    /** @description 标准或压缩 uuid。 */
    readonly uuid?: string;
    /** @description 查询方向。 */
    readonly direction?: 'dependencies' | 'dependents' | 'both';
    /** @description 是否强制重建索引。 */
    readonly refreshIndex?: boolean;
    /**
     * @description 依赖展开：`materialTextures` 把材质依赖再展开到贴图。
     */
    readonly expand?: readonly 'materialTextures'[];
}

/**
 * @description 批量替换序列化资产中的 `__uuid__` 引用。
 */
export interface IAssetReplaceReferencesMcpInput extends ContractPayload {
    /** @description 被替换 uuid（可带 `@sub`）。 */
    readonly fromUuid: string;
    /** @description 目标 uuid（可带 `@sub`）。 */
    readonly toUuid: string;
    /** @description 路径子串过滤。 */
    readonly pathContains?: string;
    /** @description 只报告不写盘。 */
    readonly dryRun?: boolean;
    /** @description 允许目标 uuid 不在 catalog。 */
    readonly allowMissingTarget?: boolean;
    /** @description 强制重建依赖索引。 */
    readonly refreshIndex?: boolean;
}

/**
 * @description 等待 AssetDB `query-ready`。
 */
export interface IAssetWaitReadyMcpInput extends ContractPayload {
    /** @description 最长等待毫秒；默认 1500。 */
    readonly timeoutMs?: number;
    /** @description 轮询间隔毫秒；默认 40。 */
    readonly intervalMs?: number;
    /** @description 超时是否抛错；默认 false。 */
    readonly throwOnTimeout?: boolean;
}

/**
 * @description 工程级缺失引用扫描输入。
 */
export interface IAssetScanMissingReferencesMcpInput extends ContractPayload {
    /** @description 路径子串过滤。 */
    readonly pathContains?: string;
    /** @description 类型分桶过滤。 */
    readonly type?: string;
    /** @description 返回条数上限；默认 50，最大 200。 */
    readonly limit?: number;
    /** @description 是否强制重建索引。 */
    readonly refreshIndex?: boolean;
}

/**
 * @description 节点级反向引用查询输入。
 */
export interface IAssetFindReferencingNodesMcpInput extends ContractPayload {
    /**
     * @description 目标资源 uuid。
     * `missingOnly` 为 false 时必填；为 true 时可省略，或用作缺失 uuid 二次筛选。
     */
    readonly uuid?: string;
    /** @description 为 true 时只返回引用 unresolved uuid 的节点（对齐 PinK 33）。 */
    readonly missingOnly?: boolean;
    /** @description 限定 Prefab/Scene 路径。 */
    readonly assetPath?: string;
    /** @description 按节点名称子串二次筛选。 */
    readonly nodeNameContains?: string;
    /** @description 按节点路径子串二次筛选。 */
    readonly nodePathContains?: string;
    /** @description 返回条数上限；默认 50，最大 200。 */
    readonly limit?: number;
}

/**
 * @description uuid / path / url 互查输入。
 */
export interface IAssetResolveMcpInput extends ContractPayload {
    /** @description 标准或压缩 uuid。 */
    readonly uuid?: string;
    /** @description `db://` 或相对路径。 */
    readonly path?: string;
    /** @description 与 path 同义的 url。 */
    readonly url?: string;
}

/**
 * @description 资产多模式搜索输入。
 */
export interface IAssetSearchMcpInput extends ContractPayload {
    /**
     * @description 搜索模式。
     * `name`/`uuid`/`path`/`type` 走 catalog；`dependencies`/`dependents` 需 uuid 或 path；
     * `missing` 工程缺失引用；`bundle` 按 bundle 名/路径子串过滤 folder bundle。
     * `type` 时 `query` 为分桶名（如 `scene` / `prefab`）。
     */
    readonly mode: 'name' | 'uuid' | 'path' | 'type' | 'dependencies' | 'dependents' | 'missing' | 'bundle';
    /** @description 查询文本（name/path/bundle/type）或 uuid。 */
    readonly query?: string;
    /** @description 依赖查询目标 path。 */
    readonly path?: string;
    /** @description 依赖查询目标 uuid。 */
    readonly uuid?: string;
    /** @description 路径子串过滤（文件夹范围，如 `assets/ui`）。 */
    readonly pathContains?: string;
    /** @description 返回条数上限；默认 20，最大 50。 */
    readonly limit?: number;
}

/**
 * @description 审计非 MCP 账本管理的资产写盘输入。
 */
export interface IAssetAuditUnmanagedWritesMcpInput extends ContractPayload {
    /** @description 路径子串过滤（相对 `assets/`）。 */
    readonly pathContains?: string;
    /** @description 仅报告该时间戳（ISO）之后修改的文件。 */
    readonly modifiedSince?: string;
    /** @description 返回条数上限；默认 50，最大 200。 */
    readonly limit?: number;
    /** @description 为 true 时尽力附加 `git status --porcelain assets`。 */
    readonly includeGit?: boolean;
}

/**
 * @description 资产 meta 字段 schema 查询输入。
 */
export interface IAssetQueryPropertySchemaMcpInput extends ContractPayload {
    /** @description 标准或压缩 uuid。 */
    readonly uuid?: string;
    /** @description `db://` 或相对路径。 */
    readonly path?: string;
    /** @description 与 path 同义的 url。 */
    readonly url?: string;
}

/**
 * @description 资产继承 / 兼容子资源查询输入。
 */
export interface IAssetQueryInheritanceMcpInput extends ContractPayload {
    /** @description 标准或压缩 uuid。 */
    readonly uuid?: string;
    /** @description `db://` 或相对路径。 */
    readonly path?: string;
    /** @description 与 path 同义的 url。 */
    readonly url?: string;
}

/**
 * @description RefPicker 风格兼容类型查询输入。
 */
export interface IAssetQueryCompatibleTypesMcpInput extends ContractPayload {
    /** @description 显式类型名，如 `SpriteFrame` / `cc.Node`。 */
    readonly typeName?: string;
    /** @description 脚本相对路径；与 field 联用解析 `@property` 声明类型。 */
    readonly scriptRelativePath?: string;
    /** @description 脚本字段名。 */
    readonly field?: string;
    /** @description 资源 uuid（按该资源类型反查可绑类型）。 */
    readonly uuid?: string;
    /** @description 资源 path/url。 */
    readonly path?: string;
    /** @description 与 path 同义。 */
    readonly url?: string;
    /** @description catalog 命中上限。 */
    readonly limit?: number;
}

/**
 * @description 在 Creator 资源管理器中打开/揭示资产（薄层 message）。
 */
export interface IAssetOpenMcpInput extends ContractPayload {
    /** @description 标准或压缩 uuid。 */
    readonly uuid?: string;
    /** @description `db://` 或相对路径。 */
    readonly path?: string;
    /** @description 与 path 同义。 */
    readonly url?: string;
}

/**
 * @description 静默依赖闭包复制输入（磁盘为真源，不弹 AssetDB 覆盖确认）。
 */
export interface IAssetCopyMcpInput extends ContractPayload {
    /** @description 待复制资源相对路径列表（种子；依赖闭包会一并复制并换新 uuid）。 */
    readonly paths: readonly string[];
    /** @description 复制产物根目录（`db://assets/...` 或工程相对路径）。 */
    readonly targetDirectory: string;
}

/**
 * @description 静默移动/重命名输入（保留 uuid，仅搬迁磁盘路径）。
 */
export interface IAssetMoveMcpInput extends ContractPayload {
    /** @description 源相对路径（文件或文件夹）。 */
    readonly from: string;
    /** @description 目标相对路径；不得已存在。 */
    readonly to: string;
}

/**
 * @description 静默重命名输入（同目录改名，保留 uuid）。
 */
export interface IAssetRenameMcpInput extends ContractPayload {
    /** @description 待重命名资源相对路径（文件或文件夹）。 */
    readonly path: string;
    /** @description 新文件/文件夹名（不含路径分隔符）。 */
    readonly newName: string;
}

/**
 * @description 静默新建资源文件夹输入。
 */
export interface IAssetCreateFolderMcpInput extends ContractPayload {
    /** @description 待创建文件夹相对路径；缺失的父目录会一并创建。 */
    readonly path: string;
}

/**
 * @description 静默删除输入（destructive：必须 `confirmDestructive: true`）。
 */
export interface IAssetDeleteMcpInput extends ContractPayload {
    /** @description 待删除资源相对路径列表（文件或文件夹，递归）。 */
    readonly paths: readonly string[];
}

/**
 * @description 静默重新导入输入：等价于 `lumen.refresh`（磁盘为真源刷入 library，无弹窗）。
 */
export interface IAssetReimportMcpInput extends ContractPayload {
    /** @description 可选相对路径列表；省略则刷新 `db://assets`。 */
    readonly paths?: readonly string[];
    /** @description 单路径别名；会并入 `paths`。 */
    readonly path?: string;
}

/**
 * @description 静默写入文本资产输入（单文件或批量；磁盘为真源，禁止 save-asset）。
 */
export interface IAssetWriteTextMcpInput extends ContractPayload {
    /** @description 单文件相对路径；与 `files` 二选一。 */
    readonly path?: string;
    /** @description 单文件 UTF-8 内容；与 `path` 成对。 */
    readonly content?: string;
    /** @description 批量文件；提供时忽略 `path`/`content`。 */
    readonly files?: readonly IAssetWriteTextFileMcpInput[];
}

/**
 * @description 静默文本写盘的单条文件。
 */
export interface IAssetWriteTextFileMcpInput extends ContractPayload {
    /** @description 相对路径（`assets/...`）。 */
    readonly path: string;
    /** @description UTF-8 文本内容。 */
    readonly content: string;
}

/**
 * @description 批量把已导入 PNG 提升为含 `@f9941` 的 SpriteFrame（经 `save-asset-meta`，避免改盘 `.meta` + reimport 竞态）。
 */
export interface IAssetEnsureSpriteFramesBatchMcpInput extends ContractPayload {
    /** @description `db://assets/...` 或 `assets/...` 的 PNG 路径列表。 */
    readonly dbPaths: readonly string[];
    /** @description 可选批量刷新根；省略则逐项 `refresh-asset` 并等待就绪。 */
    readonly refreshRoot?: string;
}

/**
 * @description 预览截图输入。
 */
export interface IPreviewCaptureMcpInput extends ContractPayload {
    /** @description 可选预览 URL；省略时先 `preview.query`。 */
    readonly url?: string;
    /** @description 输出相对工程路径；默认 `.peanut-ai/artifacts/preview-capture.png`。 */
    readonly outputRelativePath?: string;
    /** @description 视口宽；默认 1280。 */
    readonly width?: number;
    /** @description 视口高；默认 720。 */
    readonly height?: number;
    /** @description 截图前等待毫秒；默认 500。 */
    readonly waitMs?: number;
    /**
     * @description 可选工程相对场景路径（assets/.../*.scene）。省略则保持当前预览/启动场景行为。
     * 提供时：在 Creator 允许且无确认框的前提下准备该场景再截图；否则 availability refused。
     */
    readonly scenePath?: string;
    /**
     * @description scenePath 别名（与 lumen 路径字段对齐）；二者都给时以 scenePath 为准。
     */
    readonly assetRelativePath?: string;
}

/**
 * @description LODGroup 包围盒重算输入（无稳定 Creator/lumen API 时网关拒绝，不假成功）。
 */
export interface ILumenLodRecalcBoundsMcpInput extends ContractPayload {
    /** @description 可选节点路径。 */
    readonly nodePath?: string;
    /** @description 可选工程相对 prefab/scene 路径。 */
    readonly prefabRelativePath?: string;
    /** @description prefabRelativePath 别名。 */
    readonly assetRelativePath?: string;
}

/**
 * @description 场景参考图查询输入（MVP；无 Creator message 时拒绝）。
 */
export interface IReferenceQueryImageMcpInput extends ContractPayload {
    /** @description 可选场景路径。 */
    readonly scenePath?: string;
}

/**
 * @description 场景参考图设置输入（MVP；无确认框安全 API 时拒绝）。
 */
export interface IReferenceSetImageMcpInput extends ContractPayload {
    /** @description Absolute / assets-relative / db:// image path. */
    readonly imagePath: string;
    /** @description Optional scene path hint (reference-image binds per scene UUID). */
    readonly scenePath?: string;
    /** @description Optional opacity (0-1 agent scale, or 0-100 Creator scale). */
    readonly opacity?: number;
    /** @description Optional X offset (Creator set-image-data). */
    readonly x?: number;
    /** @description Optional Y offset (Creator set-image-data). */
    readonly y?: number;
    /** @description Optional X scale (Creator set-image-data). */
    readonly sx?: number;
    /** @description Optional Y scale (Creator set-image-data). */
    readonly sy?: number;
    /** @description Optional visibility; false maps to opacity 0 (no dedicated public show message). */
    readonly visible?: boolean;
}

/**
 * @description 构建平台列表查询输入。
 */
export interface IBuilderQueryPlatformsMcpInput extends ContractPayload {
    /** @description 预留过滤；当前忽略。 */
    readonly filter?: string;
}

/**
 * @description 构建选项 schema 查询输入。
 */
export interface IBuilderQuerySchemaMcpInput extends ContractPayload {
    /** @description 平台 id；省略时返回通用 schema。 */
    readonly platform?: string;
}

/**
 * @description 默认构建配置查询输入。
 */
export interface IBuilderQueryDefaultConfigMcpInput extends ContractPayload {
    /** @description 平台 id。 */
    readonly platform?: string;
}

/**
 * @description 触发构建输入（destructive）。
 */
export interface IBuilderBuildMcpInput extends ContractPayload {
    /** @description 平台 id（如 `web-desktop`）。 */
    readonly platform: string;
    /** @description 可选构建配置覆盖（透传 Creator）。 */
    readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * @description 打开场景输入（仅合法 `db://assets/*.scene`）。
 */
export interface ISceneOpenMcpInput extends ContractPayload {
    /** @description 场景 `db://` 或项目相对路径。 */
    readonly path: string;
}

/**
 * @description 保存当前场景输入。
 */
export interface ISceneSaveMcpInput extends ContractPayload {
    /**
     * @description 可选场景路径（仅用于拒绝响应里的建议）；不会调用 Creator save-scene。
     * 场景持久化请 lumen 离线写盘后 `lumen.commit`，再 `scene.reload` / `preview.refresh`。
     */
    readonly path?: string;
}

/**
 * @description 软重载当前场景输入。
 */
export interface ISceneReloadMcpInput extends ContractPayload {
    /** @description 预留；当前无额外选项。 */
    readonly soft?: boolean;
}

/**
 * @description 按路径查询场景节点输入。
 */
export interface ISceneQueryNodeMcpInput extends ContractPayload {
    /** @description 节点路径（如 `Canvas/Panel/Title`）或节点名。 */
    readonly path: string;
    /** @description 是否包含编辑器内部节点；默认 false。 */
    readonly includeEditorNodes?: boolean;
}

/**
 * @description 聚焦 / 揭示场景节点输入。
 */
export interface ISceneFocusNodeMcpInput extends ContractPayload {
    /** @description 节点路径或 uuid。 */
    readonly path: string;
}

/**
 * @description 在当前场景创建节点输入（薄层 live message）。
 */
export interface ISceneCreateNodeMcpInput extends ContractPayload {
    /** @description 父节点路径；省略时挂场景根。 */
    readonly parentPath?: string;
    /** @description 节点名。 */
    readonly name?: string;
    /** @description 类型提示：`empty` / `Camera` / `Light` 等。 */
    readonly type?: string;
}

/**
 * @description 设置编辑器选区输入。
 */
export interface IEditorSetSelectionMcpInput extends ContractPayload {
    /** @description 节点路径列表（优先）。 */
    readonly paths?: readonly string[];
    /** @description 节点 uuid / id 列表。 */
    readonly ids?: readonly string[];
    /** @description 为 true 时清空选区。 */
    readonly clear?: boolean;
}

/**
 * @description 从场景节点创建 Prefab 输入。
 */
export interface IPrefabCreateFromNodeMcpInput extends ContractPayload {
    /** @description 源节点路径或 uuid。 */
    readonly nodePath: string;
    /** @description 目标 Prefab `db://assets/.../*.prefab`。 */
    readonly prefabPath: string;
}

/**
 * @description Prefab 实例操作输入（apply / revert / unpack / unlink）。
 */
export interface IPrefabInstanceOpMcpInput extends ContractPayload {
    /** @description 实例根节点路径或 uuid。 */
    readonly nodePath: string;
}

/**
 * @description Prefab 信息查询输入。
 */
export interface IPrefabGetInfoMcpInput extends ContractPayload {
    /** @description Prefab 路径 / uuid，或实例节点 path。 */
    readonly pathOrUuid: string;
}

/**
 * @description 预览查询输入（可空）。
 */
export interface IPreviewQueryMcpInput extends ContractPayload {
    /** @description 预留平台提示，如 `browser`。 */
    readonly platform?: string;
}

/**
 * @description 预览刷新输入。
 */
export interface IPreviewRefreshMcpInput extends ContractPayload {
    /** @description 是否同时请求 AssetDB refresh；默认 true。 */
    readonly refreshAssets?: boolean;
}

/**
 * @description 预览/编辑器错误查询输入。
 */
export interface IPreviewQueryErrorsMcpInput extends ContractPayload {
    /** @description 返回条数上限；默认 50。 */
    readonly limit?: number;
    /** @description 错误行关键字过滤（大小写不敏感）。 */
    readonly contains?: string;
    /**
     * @description 仅返回 project.log 该字节偏移之后的新增错误（验收流水线用，避免历史噪声）。
     * 可从上一次 queryErrors / postflight 的 `logOffset` 传入。
     */
    readonly sinceOffset?: number;
}

/**
 * @description 场景层次查询输入。
 */
export interface ISceneGetHierarchyMcpInput extends ContractPayload {
    /** @description 是否包含编辑器内部节点；默认 false。 */
    readonly includeEditorNodes?: boolean;
}

/**
 * @description 安全恢复编辑器资源的输入。
 */
export interface ISceneRestoreEditorResourceMcpInput extends ContractPayload {
    /** @description 资源 uuid；与 url 至少提供一个，或都省略表示恢复「当前」资源查询结果。 */
    readonly uuid?: string;
    /** @description 资源 url / db 路径。 */
    readonly url?: string;
}

/**
 * @description Prefab 编辑器根节点 uuid 解析输入。
 */
export interface ISceneResolvePrefabRootUuidMcpInput extends ContractPayload {
    /** @description 根节点名；省略时从 prefabRelativePath 推导。 */
    readonly rootName?: string;
    /** @description Prefab 相对路径，用于推导根名。 */
    readonly prefabRelativePath?: string;
    /** @description 等待超时毫秒；默认 10000。 */
    readonly timeoutMs?: number;
}

/**
 * @description 通过 MCP 调用 SnowB 导出 BMFont 的受控输入。
 */
export interface ISnowbBmfontExportMcpInput extends ContractPayload {
    /** @description 项目相对 JSON 配置路径；与 `sbfName` 必须且只能提供一个。 */
    readonly configRelativePath?: string;
    /** @description SnowB 缓存中的 `.sbf` 文件名；与 `configRelativePath` 必须且只能提供一个。 */
    readonly sbfName?: string;
    /** @description 项目相对输出目录；未提供时由 SnowB 写入其受控缓存目录。 */
    readonly outputRelativePath?: string;
    /** @description BMFont 输出格式；未提供时使用 `text`。 */
    readonly exportFormat?: 'text' | 'xml' | 'binary';
}

/**
 * @description lumen MCP：查询组件 schema。
 */
export interface ILumenSchemaMcpInput extends ContractPayload {
    /** @description 组件类型，如 `cc.Label`；省略时返回清单。 */
    readonly type?: string;
    /** @description 可选 Creator 版本覆盖。 */
    readonly cocosVersion?: string;
}

/**
 * @description lumen MCP：列出模板。
 */
export interface ILumenTemplatesMcpInput extends ContractPayload {
    /** @description 可选 Creator 版本覆盖。 */
    readonly cocosVersion?: string;
}

/**
 * @description lumen MCP：打开 prefab / scene / 独立资产。
 */
export interface ILumenPrefabMcpInput extends ContractPayload {
    /**
     * @description 项目相对路径（`.prefab` / `.scene` / `.mtl` / `.anim` / `.pmtl` / `.terrain` / `.effect` / `.chunk` / `.fbx` / `.gltf` / `.glb` / `.pac` / `.labelatlas` / `.animgraph` / `.animgraphvari` / `.animask` / `.rt` / `.rpp` / `.flow` / `.stg` / 常见图片 / `.wav` `.mp3` 等音频 / `.mp4` 等视频 / `.ttf` `.otf` / `.fnt` / `.skel` / `.dbbin` / `.cubemap` / `.tmx` / `.plist` 粒子或 Sprite Atlas / `.json` 配置 / `.txt` 等文本 / `.bin` Buffer / 文件夹 / Spine 或 DragonBones `.json`）。
     * 调用方可改传 `assetRelativePath` 别名；二者同时提供时必须相等。
     */
    readonly prefabRelativePath: string;
    /** @description `prefabRelativePath` 的别名。 */
    readonly assetRelativePath?: string;
    /** @description 可选 Creator 版本覆盖。 */
    readonly cocosVersion?: string;
    /** @description 为 true 时由 router 在写盘后自动执行 `lumen.commit`。 */
    readonly autoCommit?: boolean;
}

/**
 * @description lumen MCP：检视节点，或检视独立资产（此时省略 nodePath）。
 */
export interface ILumenInspectMcpInput extends ILumenPrefabMcpInput {
    /**
     * @description 节点路径，如 `/Root/Title`。
     * 独立资产可省略；Prefab/Scene 省略时默认检视根节点。
     */
    readonly nodePath?: string;
    /**
     * @description 仅 `.terrain`：顶点盒 `{ iMin, iMax, jMin, jMax }` 或本地圆 `{ x, z, radius }`。
     * 与 `lumen.assetSet` 的 `props.region` 同一套寻址。
     */
    readonly region?: Readonly<Record<string, unknown>>;
}

/**
 * @description lumen MCP：脚手架创建 prefab、scene 或独立资产。
 */
export interface ILumenScaffoldMcpInput extends ContractPayload {
    /**
     * @description 项目相对路径（`.prefab` / `.scene` / `.mtl` / `.anim` / `.pmtl` / `.terrain` / `.effect` / `.chunk` / `.pac` / `.labelatlas` / `.animgraph` / `.animgraphvari` / `.animask` / `.rt` / `.rpp` / `.flow` / `.stg`）。
     * 调用方可改传 `assetRelativePath` 别名。图片、模型、音频、视频、TTF、BitmapFont、Spine、DragonBones 不走 scaffold，只打开已有源文件。
     */
    readonly prefabRelativePath: string;
    /** @description `prefabRelativePath` 的别名。 */
    readonly assetRelativePath?: string;
    /** @description 根节点名。 */
    readonly rootName?: string;
    /** @description 模板 id：Prefab/Scene 为 `empty` 或 `ui/Label`；材质为 `empty` / `standard`；Render Pipeline 为 `empty` / `forward`；其它独立资产为 `empty`。 */
    readonly template?: string;
    /** @description 可选 Creator 版本覆盖。 */
    readonly cocosVersion?: string;
    /** @description 为 true 时由 router 在写盘后自动执行 `lumen.commit`。 */
    readonly autoCommit?: boolean;
    /**
     * @description 为 true 且目标已存在时先删源文件与 `.meta` 再重建；默认 false（已存在则只打开，避免误删）。
     * `structure` 始终追加子节点，重复搭树前应对 scaffold 传 `reset: true`，或先 `lumen.nodeRm`。
     */
    readonly reset?: boolean;
}

/**
 * @description lumen MCP：按配方搭树。
 */
export interface ILumenStructureMcpInput extends ILumenPrefabMcpInput {
    /** @description 父节点路径。 */
    readonly parentPath: string;
    /** @description 内联配方树（对象或数组）。 */
    readonly recipe: unknown;
}

/**
 * @description lumen MCP：按配方编译内存 Prefab 条目，不写盘。
 */
export interface ILumenCompileRecipeMcpInput extends ContractPayload {
    /** @description 结果中的相对路径标签。 */
    readonly prefabRelativePath: string;
    /** @description 空壳根节点名。 */
    readonly rootName: string;
    /** @description `replaceRoot` 替换根；`appendChildren` 挂到空根下。 */
    readonly mode: 'replaceRoot' | 'appendChildren';
    /** @description `replaceRoot` 的根配方。 */
    readonly recipe?: unknown;
    /** @description `appendChildren` 的同级子配方。 */
    readonly recipes?: readonly unknown[];
    /** @description `appendChildren` 时空根 contentSize。 */
    readonly rootContentSize?: Readonly<{ width: number; height: number }>;
    /** @description `appendChildren` 时空根 anchorPoint。 */
    readonly rootAnchorPoint?: Readonly<{ x: number; y: number }>;
}

/**
 * @description lumen MCP：从模板挂子节点。
 */
export interface ILumenNodeAddMcpInput extends ILumenPrefabMcpInput {
    /** @description 父节点路径。 */
    readonly parentPath: string;
    /** @description 模板 id。 */
    readonly template: string;
    /** @description 可选子节点名。 */
    readonly name?: string;
}

/**
 * @description lumen MCP：删除节点。
 */
export interface ILumenNodeRmMcpInput extends ILumenPrefabMcpInput {
    /** @description 要删除的节点路径。 */
    readonly nodePath: string;
}

/**
 * @description lumen MCP：重命名节点。
 */
export interface ILumenNodeRenameMcpInput extends ILumenPrefabMcpInput {
    /** @description 节点路径。 */
    readonly nodePath: string;
    /** @description 新名称。 */
    readonly name: string;
}

/**
 * @description lumen MCP：重排子节点。
 */
export interface ILumenNodeReorderMcpInput extends ILumenPrefabMcpInput {
    /** @description 父节点路径。 */
    readonly parentPath: string;
    /** @description 子节点名。 */
    readonly childName: string;
    /** @description 目标下标（从 0 起）。 */
    readonly index: number;
}

/**
 * @description lumen MCP：挂载组件。
 */
export interface ILumenCompAddMcpInput extends ILumenPrefabMcpInput {
    /** @description 节点路径。 */
    readonly nodePath: string;
    /** @description 内置组件类型；与 `scriptName` 二选一。 */
    readonly builtinType?: string;
    /** @description 脚本名（catalog）；与 `builtinType` 二选一。 */
    readonly scriptName?: string;
}

/**
 * @description lumen MCP：移除组件。
 */
export interface ILumenCompRmMcpInput extends ILumenPrefabMcpInput {
    /** @description 节点路径。 */
    readonly nodePath: string;
    /** @description 组件类型。 */
    readonly componentType: string;
}

/**
 * @description lumen MCP：设置组件属性。
 */
export interface ILumenCompSetMcpInput extends ILumenPrefabMcpInput {
    /** @description 节点路径。 */
    readonly nodePath: string;
    /** @description 组件类型。 */
    readonly componentType: string;
    /** @description 公开属性补丁对象。 */
    readonly props: Readonly<Record<string, unknown>>;
}

/**
 * @description lumen MCP：写入非层次资产 Inspector 字段（Material / AnimationClip / PhysicsMaterial / Terrain / 图片 meta / Effect / 模型 meta / Auto Atlas / LabelAtlas / Animation Graph / Variant / Mask / RenderTexture / Render Pipeline / 音频 / 视频 / TTF / BitmapFont / Spine / DragonBones / CubeMap / TiledMap / 文件夹 Bundle / 粒子 / Sprite Atlas / JSON / 文本 meta）。
 */
export interface ILumenAssetSetMcpInput extends ILumenPrefabMcpInput {
    /** @description 公开属性补丁；地形窗口写为 `{ region, heights }` 或 `{ samples }`；图片写 `{ image, texture, spriteFrame }`；Effect 写 `{ properties, programs, effectYaml, source }`；模型写 `{ model, fbx, material, imageMetas }`；Auto Atlas 写 `{ pack, texture }`；LabelAtlas 写 `{ spriteFrameUuid, itemWidth, itemHeight, startChar }`；Animation Graph 写 `{ name, layers, variables }`；Variant 写 `{ graph, clips }`；Mask 写 `{ joints }`；RenderTexture 写 `{ width, height, texture }`；Pipeline 写 `{ name, tag, flows, flowUuids }`；音频写 `{ downloadMode }`；视频与 TTF 仅允许空对象；BitmapFont 写 `{ textureUuid, fontSize }`；Spine 写 `{ atlasUuid }`；DragonBones、TiledMap、粒子、Sprite Atlas、JSON 与文本仅允许空对象；CubeMap 写 `{ faces, texture }`；文件夹写 `{ isBundle, bundleName, priority, compressionType, isRemoteBundle }`。 */
    readonly props: Readonly<Record<string, unknown>>;
}

/**
 * @description lumen MCP：设置节点属性。
 */
export interface ILumenNodeSetMcpInput extends ILumenPrefabMcpInput {
    /** @description 节点路径。 */
    readonly nodePath: string;
    /** @description 节点属性补丁对象。 */
    readonly props: Readonly<Record<string, unknown>>;
}

/**
 * @description lumen MCP：绑定 Button 点击。
 */
export interface ILumenBindClickMcpInput extends ILumenPrefabMcpInput {
    /** @description Button 节点路径。 */
    readonly buttonNodePath: string;
    /** @description 目标节点路径。 */
    readonly targetNodePath: string;
    /** @description 脚本组件类名。 */
    readonly component: string;
    /** @description 回调方法名。 */
    readonly handler: string;
    /** @description 自定义事件数据。 */
    readonly customEventData?: string;
}

/**
 * @description lumen MCP：离线绑定同名控制器脚本到 Prefab 根节点。
 */
export interface ILumenBindControllerMcpInput extends ContractPayload {
    /** @description Prefab 项目相对路径，如 `assets/ui/Panel.prefab`。 */
    readonly prefabRelativePath: string;
    /** @description 控制器脚本项目相对路径，如 `assets/ui/Panel.ts`。 */
    readonly scriptRelativePath: string;
    /** @description 脚本类名。 */
    readonly className: string;
    /** @description 属性名到节点路径的绑定表。 */
    readonly propertyBindings: Readonly<Record<string, string>>;
    /** @description 属性名到 Cocos 组件类型的绑定表（如 `cc.Label`）。 */
    readonly propertyComponents?: Readonly<Record<string, string>>;
    /** @description 按钮点击事件绑定。 */
    readonly buttonEvents?: readonly Readonly<{
        readonly nodeName: string;
        readonly nodePath?: string;
        readonly handler: string;
        readonly customEventData?: string;
    }>[];
}

/**
 * @description lumen MCP：绑定 SpriteFrame。
 */
export interface ILumenBindSpriteMcpInput extends ILumenPrefabMcpInput {
    /** @description Sprite 节点路径。 */
    readonly nodePath: string;
    /** @description SpriteFrame uuid。 */
    readonly spriteFrameUuid: string;
}

/**
 * @description lumen MCP：批量绑定 SpriteFrame。
 */
export interface ILumenBindSpriteBatchMcpInput extends ILumenPrefabMcpInput {
    /** @description 绑定项列表。 */
    readonly bindings: readonly Readonly<{
        readonly nodePath: string;
        readonly spriteFrameUuid: string;
    }>[];
}

/**
 * @description lumen MCP：绑定节点或组件引用到脚本/组件字段。
 */
export interface ILumenBindRefMcpInput extends ILumenPrefabMcpInput {
    /** @description 持有字段的节点路径。 */
    readonly nodePath: string;
    /** @description 组件类型。 */
    readonly componentType: string;
    /** @description 字段名。 */
    readonly field: string;
    /** @description 节点引用路径；与 componentRef 二选一。 */
    readonly nodeRef?: string;
    /** @description 组件引用；与 nodeRef 二选一。 */
    readonly componentRef?: Readonly<{
        readonly nodePath: string;
        readonly type: string;
    }>;
}

/**
 * @description lumen MCP：校验 Prefab/Scene 引用健康。
 */
export interface ILumenValidateRefsMcpInput extends ContractPayload {
    /** @description 项目相对 `.prefab` / `.scene` 路径。 */
    readonly prefabRelativePath: string;
    /** @description 路径别名。 */
    readonly assetRelativePath?: string;
}

/**
 * @description lumen MCP：请求 AssetDB 刷新。
 */
export interface ILumenRefreshMcpInput extends ContractPayload {
    /** @description 可选项目相对路径列表；省略则刷新 `db://assets`。 */
    readonly paths?: readonly string[];

    /**
     * @description 单路径别名（与其它 lumen 写操作一致）；会并入 `paths`。
     */
    readonly prefabRelativePath?: string;

    /**
     * @description 单路径别名；与 `prefabRelativePath` 同义，冲突时拒绝。
     */
    readonly assetRelativePath?: string;
}

/**
 * @description lumen MCP：写盘后受管收口（AssetDB refresh + asset-catalog 重建）。
 */
export interface ILumenCommitMcpInput extends ILumenRefreshMcpInput {}

/**
 * @description lumen MCP：探测项目 Creator 版本与可选引擎对照。
 */
export interface ILumenCocosInfoMcpInput extends ContractPayload {
    /**
     * @description 可选引擎根或 `cc.d.ts` 路径（可为绝对路径）。
     */
    readonly engineRoot?: string;

    /**
     * @description 可选 Creator 版本覆盖。
     */
    readonly cocosVersion?: string;

    /**
     * @description 缺口列表起始偏移；缺省 0。
     */
    readonly gapOffset?: number;

    /**
     * @description 缺口列表每页条数；缺省 40，最大 200。
     */
    readonly gapLimit?: number;
}

/**
 * @description MCP 操作请求。
 */
export interface IEditorMcpOperationRequest extends ContractPayload {
    /** @description 要调用的稳定操作标识。 */
    readonly operation: EditorMcpOperationId;
    /** @description 操作参数；不需要参数时可以省略。 */
    readonly input?: ContractPayload;
}

/**
 * @description MCP 能力描述。
 */
export interface IEditorMcpCapabilityDescriptor extends ContractPayload {
    /** @description 稳定操作标识。 */
    readonly operation: EditorMcpOperationId;
    /** @description 当前能力是否只读。 */
    readonly readOnly: boolean;
    /**
     * @description 风险等级：`read` / `write` / `destructive`（删除、覆盖、不可逆场景改动）。
     */
    readonly risk: 'read' | 'write' | 'destructive';
    /**
     * @description 执行车道：`lumen-offline` 写盘 / `editor-ui` 呈现 / `preview` 验收。
     */
    readonly lane: EditorMcpExecutionLane;
    /** @description 面向调用方的能力说明。 */
    readonly description: LocalizedText;
    /** @description 是否要求输入参数。 */
    readonly requiresInput: boolean;
}

/**
 * @description MCP 操作计划。
 */
export interface IEditorMcpActionPlan extends ContractPayload {
    /** @description 已校验的操作标识。 */
    readonly operation: EditorMcpOperationId;
    /** @description 操作是否只读。 */
    readonly readOnly: boolean;
    /** @description 风险等级。 */
    readonly risk: 'read' | 'write' | 'destructive';
    /** @description 执行车道。 */
    readonly lane: EditorMcpExecutionLane;
    /** @description 操作是否可立即执行。 */
    readonly executable: boolean;
}

/**
 * @description MCP 操作执行结果。
 */
export interface IEditorMcpActionResult extends ContractPayload {
    /** @description 已执行的稳定操作标识。 */
    readonly operation: EditorMcpOperationId;
    /** @description 实际查询结果；未命中时为 `null`。 */
    readonly data: unknown | null;
    /**
     * @description 写操作任务标识；只读 operation 不提供。
     */
    readonly taskId?: string;
    /**
     * @description 写操作任务完成状态；同步调用成功时为 succeeded。
     */
    readonly taskStatus?: 'succeeded';
}
