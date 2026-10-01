import { McpCapabilityPolicy, type IMcpCapabilityPolicy } from './mcp-capability-policy.js';

/**
 * @description 第一批公开的只读 Cocos MCP operation；未列出的 operation 默认不得由 Core 公开。
 */
export type CoreCocosMcpOperation =
    | 'editor.queryVersion'
    | 'editor.queryProject'
    | 'editor.querySelection'
    | 'asset.queryInfo'
    | 'asset.readText'
    | 'asset.catalog.summary'
    | 'asset.catalog.lookup'
    | 'asset.importPlan'
    | 'asset.managedStatus'
    | 'asset.queryDependencies'
    | 'asset.waitReady'
    | 'asset.scanMissingReferences'
    | 'asset.findReferencingNodes'
    | 'asset.resolve'
    | 'asset.search'
    | 'asset.auditUnmanagedWrites'
    | 'asset.queryPropertySchema'
    | 'asset.queryInheritance'
    | 'asset.queryCompatibleTypes'
    | 'scene.getCurrent'
    | 'scene.getHierarchy'
    | 'scene.queryCurrentEditorResource'
    | 'scene.resolvePrefabRootUuid'
    | 'scene.queryNode'
    | 'prefab.getInfo'
    | 'preview.query'
    | 'preview.queryErrors'
    | 'builder.queryPlatforms'
    | 'builder.querySchema'
    | 'builder.queryDefaultConfig'
    | 'lumen.schema'
    | 'lumen.templates'
    | 'lumen.tree'
    | 'lumen.inspect'
    | 'lumen.validateRefs'
    | 'lumen.compileRecipe'
    | 'lumen.cocosInfo'
    | 'lumen.lodRecalcBounds'
    | 'reference.queryImage';

/**
 * @description Core 对外公开的 Cocos MCP capability 定义。
 */
export interface ICoreCocosMcpCapability {
    /** @description 稳定 operation 标识。 */
    readonly operation: CoreCocosMcpOperation;
    /** @description Hub 执行前必须验证的公开访问策略。 */
    readonly policy: IMcpCapabilityPolicy;
}

/**
 * @description Core 的 fail-closed Cocos MCP capability 目录。
 */
export class CoreCocosMcpCapabilityCatalog {
    /** @description Core 明确允许公开的基础 operation；任何未列项均保持拒绝。 */
    private static readonly operations: readonly CoreCocosMcpOperation[] = Object.freeze([
        'editor.queryVersion',
        'editor.queryProject',
        'editor.querySelection',
        'asset.queryInfo',
        'asset.readText',
        'asset.catalog.summary',
        'asset.catalog.lookup',
        'asset.importPlan',
        'asset.managedStatus',
        'asset.queryDependencies',
        'asset.waitReady',
        'asset.scanMissingReferences',
        'asset.findReferencingNodes',
        'asset.resolve',
        'asset.search',
        'asset.auditUnmanagedWrites',
        'asset.queryPropertySchema',
        'asset.queryInheritance',
        'asset.queryCompatibleTypes',
        'scene.getCurrent',
        'scene.getHierarchy',
        'scene.queryCurrentEditorResource',
        'scene.resolvePrefabRootUuid',
        'scene.queryNode',
        'prefab.getInfo',
        'preview.query',
        'preview.queryErrors',
        'builder.queryPlatforms',
        'builder.querySchema',
        'builder.queryDefaultConfig',
        'lumen.schema',
        'lumen.templates',
        'lumen.tree',
        'lumen.inspect',
        'lumen.validateRefs',
        'lumen.compileRecipe',
        'lumen.cocosInfo',
        'lumen.lodRecalcBounds',
        'reference.queryImage',
    ]);

    /** @description 已冻结的公开基础 capability 列表。 */
    private static readonly capabilities: readonly ICoreCocosMcpCapability[] = Object.freeze(
        CoreCocosMcpCapabilityCatalog.operations.map((operation) =>
            Object.freeze({ operation, policy: McpCapabilityPolicy.create({ name: operation, access: 'local', requiresLocalApproval: false }) }),
        ),
    );

    /**
     * @description 返回不可变的公开基础 capability 快照。
     * @returns Core 允许公开的 capability 列表。
     */
    public static list(): readonly ICoreCocosMcpCapability[] {
        return CoreCocosMcpCapabilityCatalog.capabilities;
    }

    /**
     * @description 查询某 operation 是否明确属于公开 Core。
     * @param operation 未信任的 operation 标识。
     * @returns 命中的公开 capability；未公开或未知 operation 返回 null。
     */
    public static find(operation: unknown): ICoreCocosMcpCapability | null {
        if (typeof operation !== 'string') {
            return null;
        }
        return CoreCocosMcpCapabilityCatalog.capabilities.find((capability) => capability.operation === operation) ?? null;
    }
}
