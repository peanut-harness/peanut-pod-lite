import { LumenCuratedSchemaCatalog } from '../schema/catalog';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenHierarchyEntry, type LumenAssetKind, type LumenStandaloneAssetKind } from '../hierarchy/entry';
import { LumenAnimationClipDocument, type ILumenAnimationClipInspect } from './animation-clip';
import {
    LumenAnimationGraphDocument,
    type ILumenAnimationGraphInspect,
} from './animation-graph';
import {
    LumenAnimationGraphVariantDocument,
    type ILumenAnimationGraphVariantInspect,
} from './animation-graph-variant';
import { LumenAnimationMaskDocument, type ILumenAnimationMaskInspect } from './animation-mask';
import { LumenEffectDocument, type ILumenEffectChunkInspect, type ILumenEffectInspect } from './effect';
import { LumenImageMetaDocument, type ILumenImageMetaInspect } from './image-meta';
import { LumenJsonAssetDocument, type ILumenJsonAssetInspect } from './json-asset-document';
import { LumenMaterialDocument, type ILumenMaterialInspect } from './material';
import { LumenModelMetaDocument, type ILumenModelMetaInspect } from './model-meta';
import {
    LumenRenderPipelineDocument,
    type ILumenRenderPipelineInspect,
} from './render-pipeline';
import { LumenRenderTextureDocument, type ILumenRenderTextureInspect } from './render-texture';
import { LumenTerrainDocument, type ILumenTerrainInspect } from './terrain';
import { LumenSidecarMetaDocument } from './sidecar-document';
import type {
    ILumenAudioMetaInspect,
    ILumenAutoAtlasInspect,
    ILumenBufferMetaInspect,
    ILumenConfigMetaInspect,
    ILumenCubeMapMetaInspect,
    ILumenDirectoryMetaInspect,
    ILumenDragonBonesInspect,
    ILumenFontMetaInspect,
    ILumenJavascriptMetaInspect,
    ILumenLabelAtlasInspect,
    ILumenMeshMetaInspect,
    ILumenParticleMetaInspect,
    ILumenScriptMetaInspect,
    ILumenSkeletonMetaInspect,
    ILumenInstantiationAnimationMetaInspect,
    ILumenInstantiationMaterialMetaInspect,
    ILumenSpineMetaInspect,
    ILumenSpriteAtlasMetaInspect,
    ILumenTiledMapMetaInspect,
    ILumenVideoMetaInspect,
} from './sidecar-inspect';

export type { LumenStandaloneAssetKind };

/**
 * @description 非层次资产 Inspector 快照。
 */
export type ILumenStandaloneInspect =
    | ILumenMaterialInspect
    | ILumenAnimationClipInspect
    | ILumenJsonAssetInspect
    | ILumenTerrainInspect
    | ILumenImageMetaInspect
    | ILumenEffectInspect
    | ILumenEffectChunkInspect
    | ILumenModelMetaInspect
    | ILumenAutoAtlasInspect
    | ILumenLabelAtlasInspect
    | ILumenAnimationGraphInspect
    | ILumenAnimationGraphVariantInspect
    | ILumenAnimationMaskInspect
    | ILumenRenderTextureInspect
    | ILumenRenderPipelineInspect
    | ILumenAudioMetaInspect
    | ILumenVideoMetaInspect
    | ILumenFontMetaInspect
    | ILumenSpineMetaInspect
    | ILumenDragonBonesInspect
    | ILumenCubeMapMetaInspect
    | ILumenTiledMapMetaInspect
    | ILumenDirectoryMetaInspect
    | ILumenParticleMetaInspect
    | ILumenSpriteAtlasMetaInspect
    | ILumenConfigMetaInspect
    | ILumenBufferMetaInspect
    | ILumenScriptMetaInspect
    | ILumenJavascriptMetaInspect
    | ILumenMeshMetaInspect
    | ILumenSkeletonMetaInspect
    | ILumenInstantiationAnimationMetaInspect
    | ILumenInstantiationMaterialMetaInspect;

/**
 * @description 非层次资产文档：open / inspect / patch / save。
 */
export interface ILumenStandaloneAssetDocument {
    /** @description 项目相对路径。 */
    readonly relativePath: string;
    /** @description 资产种类。 */
    readonly kind: LumenStandaloneAssetKind;
    /**
     * @description 检视公开字段。
     * @param query 地形可传 `{ region }`；其它种类必须省略
     * @returns 快照
     */
    inspect(query?: Readonly<Record<string, unknown>>): ILumenStandaloneInspect;
    /**
     * @description 写入 Inspector 补丁。
     * @param patch 公开字段
     */
    applyPatch(patch: Readonly<Record<string, unknown>>): void;
    /**
     * @description 写回磁盘。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     * @param cocosVersion Creator 版本（决定 meta `ver`）
     */
    save(projectRoot: string, writeMetaIfMissing?: boolean, cocosVersion?: LumenCocosVersion): void;
    /**
     * @description 仅编辑 meta 的文档返回独立内存快照，供原生 AssetDB 单次保存；混合源文档不提供。
     * @returns 可原生提交的 meta 副本，或 null。
     */
    getNativeMetaSnapshot?(): Record<string, unknown> | null;
    /**
     * @description 提供新源资产的内存内容，首次创建交给 Creator；不提前写源或 meta。
     * @returns Creator 源 JSON 文本。
     */
    serializeNativeSource?(): string;
}

/**
 * @description 按 `bundled/schema/assets.json` 创建或打开非层次资产文档。
 */
export class LumenStandaloneAsset {
    /**
     * @description 判断种类是否为非层次资产。
     * @param kind 资产种类
     * @returns 是否独立文档
     */
    public static isStandaloneKind(kind: LumenAssetKind): kind is LumenStandaloneAssetKind {
        return kind !== 'prefab' && kind !== 'scene';
    }

    /**
     * @description 创建空文档。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template 模板 id
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): ILumenStandaloneAssetDocument {
        if (relativePath.toLowerCase().endsWith('.plist')) {
            throw new Error(`lumen_plist_scaffold_unsupported:${relativePath}`);
        }
        const kind = LumenHierarchyEntry.assetKindFromPath(relativePath);
        const entry = LumenCuratedSchemaCatalog.shared().assetEntry(kind);
        if (entry?.document === 'sidecar-meta') {
            return LumenSidecarMetaDocument.createEmpty(relativePath, name, template, entry);
        }
        if (entry?.document === 'json-asset') {
            return LumenJsonAssetDocument.createEmpty(relativePath, name, template, entry);
        }
        if (kind === 'material') {
            return LumenMaterialDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'animationClip') {
            return LumenAnimationClipDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'terrain') {
            return LumenTerrainDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'image') {
            throw new Error(`lumen_image_scaffold_unsupported:${relativePath}`);
        }
        if (kind === 'model') {
            throw new Error(`lumen_model_scaffold_unsupported:${relativePath}`);
        }
        if (kind === 'animationGraph') {
            return LumenAnimationGraphDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'animationGraphVariant') {
            return LumenAnimationGraphVariantDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'animationMask') {
            return LumenAnimationMaskDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'renderTexture') {
            return LumenRenderTextureDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'renderPipeline') {
            return LumenRenderPipelineDocument.createEmpty(relativePath, name, template);
        }
        if (kind === 'effect' || kind === 'effectChunk') {
            return LumenEffectDocument.createEmpty(relativePath, name, template);
        }
        throw new Error(`lumen_not_standalone_asset:${relativePath}`);
    }

    /**
     * @description 打开已有文档。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): ILumenStandaloneAssetDocument {
        const kind = LumenHierarchyEntry.resolveAssetKind(projectRoot, relativePath);
        const entry = LumenCuratedSchemaCatalog.shared().assetEntry(kind);
        if (entry?.document === 'sidecar-meta') {
            return LumenSidecarMetaDocument.open(projectRoot, relativePath, entry);
        }
        if (entry?.document === 'json-asset') {
            return LumenJsonAssetDocument.open(projectRoot, relativePath, entry);
        }
        if (kind === 'material') {
            return LumenMaterialDocument.open(projectRoot, relativePath);
        }
        if (kind === 'animationClip') {
            return LumenAnimationClipDocument.open(projectRoot, relativePath);
        }
        if (kind === 'terrain') {
            return LumenTerrainDocument.open(projectRoot, relativePath);
        }
        if (kind === 'image') {
            return LumenImageMetaDocument.open(projectRoot, relativePath);
        }
        if (kind === 'model') {
            return LumenModelMetaDocument.open(projectRoot, relativePath);
        }
        if (kind === 'animationGraph') {
            return LumenAnimationGraphDocument.open(projectRoot, relativePath);
        }
        if (kind === 'animationGraphVariant') {
            return LumenAnimationGraphVariantDocument.open(projectRoot, relativePath);
        }
        if (kind === 'animationMask') {
            return LumenAnimationMaskDocument.open(projectRoot, relativePath);
        }
        if (kind === 'renderTexture') {
            return LumenRenderTextureDocument.open(projectRoot, relativePath);
        }
        if (kind === 'renderPipeline') {
            return LumenRenderPipelineDocument.open(projectRoot, relativePath);
        }
        if (kind === 'effect' || kind === 'effectChunk') {
            return LumenEffectDocument.open(projectRoot, relativePath);
        }
        throw new Error(`lumen_not_standalone_asset:${relativePath}`);
    }
}
