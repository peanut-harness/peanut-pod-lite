import { CoreCocosMcpToolDefinitionCatalog, type ICoreCocosMcpToolDefinition } from './core-cocos-mcp-tool-definition-catalog.js';
import type { CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';

/**
 * @description Creator 3.8.7 迁移时可由独立写入者维护的 operation 域。
 */
export type Creator38MigrationWorkstream =
    | 'editor-scene-prefab'
    | 'asset-read'
    | 'asset-write'
    | 'preview-builder-reference'
    | 'lumen';

/**
 * @description 一项 Lite operation 在 Creator 3.8.7 迁移中的唯一归属。
 */
export interface ICreator38MigrationWorkstreamEntry {
    readonly operation: CoreCocosMcpPublicOperation;
    readonly workstream: Creator38MigrationWorkstream;
}

/**
 * @description 将 83 项 Lite operation 划分为互不重叠的 Creator 3.8.7 验收工作流。
 */
export class Creator38MigrationWorkstreamCatalog {
    /**
     * @description 当前公开目录对应的冻结工作流快照。
     */
    private readonly entries: readonly ICreator38MigrationWorkstreamEntry[];

    public constructor() {
        const definitions = new CoreCocosMcpToolDefinitionCatalog().list();
        this.entries = Object.freeze(definitions.map((definition) => Object.freeze({
            operation: definition.operation,
            workstream: Creator38MigrationWorkstreamCatalog.classify(definition),
        })));
    }

    /**
     * @description 返回全部 Lite operation 的唯一工作流归属。
     */
    public list(): readonly ICreator38MigrationWorkstreamEntry[] {
        return this.entries;
    }

    /**
     * @description 查询公开 operation 的工作流；Pro 或未知 operation 返回 null。
     * @param operation 未信任 operation 标识
     */
    public find(operation: unknown): ICreator38MigrationWorkstreamEntry | null {
        return typeof operation === 'string'
            ? (this.entries.find((entry) => entry.operation === operation) ?? null)
            : null;
    }

    /**
     * @description 根据稳定前缀和可信读写定义划分工作流。
     * @param definition 公开工具定义
     */
    private static classify(definition: ICoreCocosMcpToolDefinition): Creator38MigrationWorkstream {
        const { operation } = definition;
        if (operation.startsWith('editor.') || operation.startsWith('scene.') || operation.startsWith('prefab.')) {
            return 'editor-scene-prefab';
        }
        if (operation.startsWith('asset.')) {
            return definition.readOnly ? 'asset-read' : 'asset-write';
        }
        if (operation.startsWith('preview.') || operation.startsWith('builder.') || operation.startsWith('reference.')) {
            return 'preview-builder-reference';
        }
        if (operation.startsWith('lumen.')) {
            return 'lumen';
        }
        throw new Error(`creator_38_migration_workstream_unclassified:${operation}`);
    }
}
