import type { CreatorPhase } from '../cocos/creator-version.js';
import type { EditorMcpOperationId } from './editor-mcp-contracts.js';

/**
 * @description 产品线 MCP 可用性判定结果。
 */
export type ProductLineMcpDecision = 'allow' | 'refuse';

/**
 * @description Creator 产品线对 Editor MCP operation 的门禁（分线 allowlist）。
 */
export class ProductLineMcpPolicy {
    /**
     * @description Pro 独占操作；Lite 的任何 Creator 产品线都不得放行。
     */
    private static readonly _proExclusive = new Set<EditorMcpOperationId>([
        'preview.capture',
        'snowb.bmfont.export',
    ]);

    /**
     * @description early3x 明确拒绝的写/破坏性 operation。
     */
    private static readonly _early3xRefuse = new Set<EditorMcpOperationId>([
        'editor.setSelection',
        'asset.catalog.refresh',
        'asset.import',
        'asset.copy',
        'asset.move',
        'asset.rename',
        'asset.createFolder',
        'asset.delete',
        'asset.replaceReferences',
        'asset.reimport',
        'asset.writeText',
        'asset.ensureSpriteFramesBatch',
        'asset.open',
        'scene.open',
        'scene.save',
        'scene.reload',
        'scene.focusNode',
        'viewport.focusNodes',
        'viewport.setState',
        'scene.createNode',
        'prefab.createFromNode',
        'prefab.apply',
        'prefab.revert',
        'prefab.unpack',
        'prefab.unlink',
        'preview.refresh',
        'preview.capture',
        'builder.build',
        'snowb.bmfont.export',
        'lumen.scaffold',
        'lumen.structure',
        'lumen.compileRecipe',
        'lumen.nodeAdd',
        'lumen.nodeRm',
        'lumen.nodeRename',
        'lumen.nodeReorder',
        'lumen.compAdd',
        'lumen.compRm',
        'lumen.compSet',
        'lumen.assetSet',
        'lumen.nodeSet',
        'lumen.bindClick',
        'lumen.bindSprite',
        'lumen.bindSpriteBatch',
        'lumen.bindRef',
        'lumen.bindController',
        'lumen.refresh',
        'lumen.commit',
    ]);

    /**
     * @description creator2x 在 lumen-24 scaffold 切片下额外允许的写操作。
     */
    private static readonly _creator2xWriteAllow = new Set<EditorMcpOperationId>([
        'asset.createFolder',
        'asset.catalog.refresh',
        'asset.copy',
        'asset.move',
        'asset.rename',
        'asset.delete',
        'asset.replaceReferences',
        'asset.reimport',
        'asset.writeText',
        'asset.import',
        'asset.ensureSpriteFramesBatch',
        'scene.open',
        'preview.refresh',
        'preview.capture',
        'lumen.scaffold',
        'lumen.refresh',
        'lumen.commit',
        'lumen.nodeAdd',
        'lumen.nodeRm',
        'lumen.nodeRename',
        'lumen.nodeReorder',
        'lumen.nodeSet',
        'lumen.compAdd',
        'lumen.compRm',
        'lumen.compSet',
        'lumen.assetSet',
        'lumen.bindSprite',
        'lumen.bindSpriteBatch',
        'lumen.bindClick',
        'lumen.bindRef',
        'lumen.bindController',
        'lumen.structure',
        'lumen.compileRecipe',
    ]);

    /**
     * @description 判断当前 Creator phase 是否允许执行指定 MCP operation。
     * @param phase Creator 产品线 phase
     * @param operation MCP operation id
     * @returns allow 或 refuse
     */
    public static decide(phase: CreatorPhase, operation: EditorMcpOperationId): ProductLineMcpDecision {
        if (ProductLineMcpPolicy._proExclusive.has(operation)) {
            return 'refuse';
        }
        if (phase === 'editor_api_stable') {
            return 'allow';
        }
        if (phase === 'creator_2x') {
            if (ProductLineMcpPolicy._creator2xWriteAllow.has(operation)) {
                return 'allow';
            }
            return ProductLineMcpPolicy._early3xRefuse.has(operation) ? 'refuse' : 'allow';
        }
        if (phase === 'creator_3x_early') {
            return ProductLineMcpPolicy._early3xRefuse.has(operation) ? 'refuse' : 'allow';
        }
        return 'refuse';
    }

    /**
     * @description 拒绝时的稳定错误码。
     * @param phase Creator phase
     * @param operation operation id
     * @returns 错误字符串
     */
    public static refuseError(phase: CreatorPhase, operation: EditorMcpOperationId): string {
        if (ProductLineMcpPolicy._proExclusive.has(operation)) {
            return `product_line_mcp_refused:pro_exclusive:${operation}`;
        }
        if (phase === 'creator_2x') {
            return `product_line_mcp_refused:creator2x:${operation}:await_lumen_24_or_adapter_write`;
        }
        return `product_line_mcp_refused:${phase}:${operation}:await_host_verified`;
    }
}
