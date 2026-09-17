import { McpCapabilityPolicy, type IMcpCapabilityPolicy } from './mcp-capability-policy.js';

/**
 * Cocos 原生写入能力的开源迁移账本。
 * 这些能力不需要订阅或在线许可证，但宿主必须消费本地审批租约后才可执行。
 * SnowB、Figma/PSD 与 UI Prefab 不属于本目录；Lumen 与引用资源写入仍是免费的本地审批能力。
 */
export type CoreCocosNativeWriteOperation =
    | 'editor.setSelection'
    | 'asset.catalog.refresh' | 'asset.import' | 'asset.replaceReferences'
    | 'asset.open' | 'asset.copy' | 'asset.move' | 'asset.rename' | 'asset.createFolder' | 'asset.delete' | 'asset.reimport' | 'asset.writeText' | 'asset.ensureSpriteFramesBatch'
    | 'scene.restoreEditorResource' | 'scene.open' | 'scene.save' | 'scene.reload' | 'scene.focusNode' | 'scene.createNode'
    | 'prefab.createFromNode' | 'prefab.apply' | 'prefab.revert' | 'prefab.unpack' | 'prefab.unlink'
    | 'preview.refresh'
    | 'builder.build'
    | 'lumen.scaffold' | 'lumen.structure' | 'lumen.nodeAdd' | 'lumen.nodeRm' | 'lumen.nodeRename' | 'lumen.nodeReorder'
    | 'lumen.compAdd' | 'lumen.compRm' | 'lumen.compSet' | 'lumen.assetSet' | 'lumen.nodeSet'
    | 'lumen.bindClick' | 'lumen.bindSprite' | 'lumen.bindSpriteBatch' | 'lumen.bindRef' | 'lumen.bindController' | 'lumen.refresh' | 'lumen.commit'
    | 'reference.setImage';

export type CoreCocosNativeWriteRisk = 'write' | 'destructive';

export interface ICoreCocosNativeWriteCapability {
    readonly operation: CoreCocosNativeWriteOperation;
    readonly risk: CoreCocosNativeWriteRisk;
    readonly policy: IMcpCapabilityPolicy;
}

/**
 * 开源原生写入 capability 的 fail-closed 目录。
 * 此账本先固定公开边界和安全要求；每项精确 MCP schema 与 Creator 执行适配器在后续批次接入。
 */
export class CoreCocosNativeWriteCapabilityCatalog {
    private static readonly destructive = new Set<CoreCocosNativeWriteOperation>([
        'asset.delete',
        'asset.replaceReferences',
        'prefab.unpack',
        'prefab.unlink',
        'builder.build',
        'lumen.nodeRm',
        'lumen.compRm',
    ]);
    private static readonly operations: readonly CoreCocosNativeWriteOperation[] = Object.freeze([
        'editor.setSelection',
        'asset.catalog.refresh', 'asset.import', 'asset.replaceReferences',
        'asset.open', 'asset.copy', 'asset.move', 'asset.rename', 'asset.createFolder', 'asset.delete', 'asset.reimport', 'asset.writeText', 'asset.ensureSpriteFramesBatch',
        'scene.restoreEditorResource', 'scene.open', 'scene.save', 'scene.reload', 'scene.focusNode', 'scene.createNode',
        'prefab.createFromNode', 'prefab.apply', 'prefab.revert', 'prefab.unpack', 'prefab.unlink',
        'preview.refresh', 'builder.build',
        'lumen.scaffold', 'lumen.structure', 'lumen.nodeAdd', 'lumen.nodeRm', 'lumen.nodeRename', 'lumen.nodeReorder',
        'lumen.compAdd', 'lumen.compRm', 'lumen.compSet', 'lumen.assetSet', 'lumen.nodeSet',
        'lumen.bindClick', 'lumen.bindSprite', 'lumen.bindSpriteBatch', 'lumen.bindRef', 'lumen.bindController', 'lumen.refresh', 'lumen.commit',
        'reference.setImage',
    ]);
    private static readonly capabilities: readonly ICoreCocosNativeWriteCapability[] = Object.freeze(
        CoreCocosNativeWriteCapabilityCatalog.operations.map((operation) => {
            const risk = CoreCocosNativeWriteCapabilityCatalog.destructive.has(operation) ? 'destructive' : 'write';
            return Object.freeze({ operation, risk, policy: McpCapabilityPolicy.create({ name: operation, access: 'local', requiresLocalApproval: true }) });
        }),
    );

    public static list(): readonly ICoreCocosNativeWriteCapability[] { return CoreCocosNativeWriteCapabilityCatalog.capabilities; }
    public static find(operation: unknown): ICoreCocosNativeWriteCapability | null {
        return typeof operation === 'string' ? CoreCocosNativeWriteCapabilityCatalog.capabilities.find((item) => item.operation === operation) ?? null : null;
    }
}
