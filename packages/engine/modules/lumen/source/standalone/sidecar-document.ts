import { CompatibleUuid } from '@peanut/pod-engine/assets';
import { readFileSync } from 'fs';
import { join } from 'path';

import type { ILumenAssetSchemaEntry } from '../schema/codec';
import { LumenCuratedSchemaCatalog } from '../schema/catalog';
import { LumenAssetScaffoldTemplate } from '../schema/scaffold-template';
import { LumenHierarchyEntry, type LumenStandaloneAssetKind } from '../hierarchy/entry';
import { LumenSidecarFieldCodec } from './sidecar-field-codec';
import type { ILumenSidecarMetaInspect } from './sidecar-inspect';
import { LumenCompressSettingsCodec } from './compress-settings';
import { LumenSidecarMetaIo } from '../io/sidecar-meta';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description 配置驱动的旁路 `.meta` 文档：粒子 / 音频 / 字体 / CubeMap / Auto Atlas / LabelAtlas / Buffer 等共用此类。
 */
export class LumenSidecarMetaDocument {
    /**
     * @description meta 读写。
     */
    private readonly _io = new LumenSidecarMetaIo();

    /**
     * @description 字段编解码。
     */
    private readonly _fields = new LumenSidecarFieldCodec(this._io);

    /**
     * @description 项目相对路径。
     */
    private readonly _relativePath: string;

    /**
     * @description 策展登记。
     */
    private readonly _entry: ILumenAssetSchemaEntry;

    /**
     * @description Creator meta。
     */
    private _meta: Record<string, unknown>;

    /**
     * @description 源文本；`writeSource` 时随 meta 写回。
     */
    private _source: string;

    /**
     * @description scaffold 占位符绑定。
     */
    private static readonly _scaffold = new LumenAssetScaffoldTemplate();

    /**
     * @description 从已校验 meta 创建文档。
     * @param relativePath 相对路径
     * @param entry 资产登记
     * @param meta Creator meta
     * @param source 源文本
     */
    public constructor(
        relativePath: string,
        entry: ILumenAssetSchemaEntry,
        meta: Record<string, unknown>,
        source: string = '',
    ) {
        this._relativePath = relativePath;
        this._entry = entry;
        this._meta = meta;
        this._source = source;
    }

    /**
     * @description 相对项目根路径。
     * @returns 路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 资产种类。
     * @returns 公开 kind
     */
    public get kind(): LumenStandaloneAssetKind {
        return LumenSidecarMetaDocument._asStandaloneKind(this._entry.assetKind);
    }

    /**
     * @description 创建空 sidecar 文档；未登记 scaffold 的种类拒绝。
     * @param relativePath 相对路径
     * @param name 未写入源
     * @param template 仅 `empty`
     * @param entry 资产登记；省略则按路径查表
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
        entry?: ILumenAssetSchemaEntry,
    ): LumenSidecarMetaDocument {
        void name;
        const resolved =
            entry ??
            LumenCuratedSchemaCatalog.shared().sidecarEntry(
                LumenHierarchyEntry.assetKindFromPath(relativePath),
            );
        const prefix = resolved?.errorPrefix ?? 'lumen_json';
        if (resolved == null || resolved.scaffold !== true || resolved.metaScaffold == null) {
            throw new Error(`${prefix}_scaffold_unsupported:${relativePath}`);
        }
        if (template !== 'empty') {
            throw new Error(`${prefix}_template_unknown:${template}`);
        }
        const meta = LumenSidecarMetaDocument._scaffold.instantiate(resolved.metaScaffold, {
            $uuid: CompatibleUuid.create(),
        });
        return new LumenSidecarMetaDocument(relativePath, resolved, meta, resolved.sourceText ?? '');
    }

    /**
     * @description 打开已有源文件与 `.meta`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @param entry 资产登记；省略则按 importer / 扩展名解析
     * @returns 文档
     */
    public static open(
        projectRoot: string,
        relativePath: string,
        entry?: ILumenAssetSchemaEntry,
    ): LumenSidecarMetaDocument {
        const kind = LumenHierarchyEntry.resolveAssetKind(projectRoot, relativePath);
        const resolved = entry ?? LumenCuratedSchemaCatalog.shared().sidecarEntry(kind);
        if (resolved == null || resolved.assetKind !== kind) {
            throw new Error(`lumen_not_standalone_asset:${relativePath}`);
        }
        const prefix = resolved.errorPrefix ?? 'lumen_sidecar';
        const io = new LumenSidecarMetaIo();
        const meta = io.open(
            projectRoot,
            relativePath,
            resolved.importers,
            `${prefix}_missing`,
            `${prefix}_meta_missing`,
            `${prefix}_meta_corrupt`,
        );
        const source =
            resolved.writeSource === true ? readFileSync(join(projectRoot, relativePath), 'utf8') : '';
        return new LumenSidecarMetaDocument(relativePath, resolved, meta, source);
    }

    /**
     * @description 读取公开字段。
     * @param query sidecar 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenSidecarMetaInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, this._entry.assetKind);
        const snapshot = this._fields.inspect(this._entry, this._relativePath, this._meta);
        if (this._entry.writeSource === true) {
            snapshot.source = this._source;
        }
        return this._asInspect(snapshot);
    }

    /**
     * @description 写入可写字段；拒绝只读键。
     * @param patch 公开字段
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        const prefix = this._entry.errorPrefix ?? 'lumen_sidecar';
        let metaPatch = patch;
        if (this._entry.writeSource === true && patch.source !== undefined) {
            if (typeof patch.source !== 'string') {
                throw new Error(`${prefix}_property_type:source:string`);
            }
            this._source = patch.source;
            const cloned: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(patch)) {
                if (key !== 'source') {
                    cloned[key] = value;
                }
            }
            metaPatch = cloned;
        }
        this._meta = this._fields.applyPatch(this._entry, this._meta, metaPatch);
        if (this._entry.assetKind === 'autoAtlas') {
            const userData = this._meta.userData;
            if (userData != null && typeof userData === 'object' && !Array.isArray(userData)) {
                new LumenCompressSettingsCodec().syncTopLevelScalars(userData as Record<string, unknown>);
            }
        }
    }

    /**
     * @description 仅 meta 文档提供副本；含源编辑时保持完整 save 行为。
     * @returns 可单独原生保存的 meta 副本，或 null。
     */
    public getNativeMetaSnapshot(): Record<string, unknown> | null {
        return this._entry.writeSource === true ? null : this._io.cloneRecord(this._meta);
    }

    /**
     * @description 写回 `.meta`；`writeSource` 种类同时写源文件。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing sidecar 必须已有 meta
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        void writeMetaIfMissing;
        void cocosVersion;
        if (this._entry.writeSource === true) {
            this._io.saveSourceAndMeta(projectRoot, this._relativePath, this._source, this._meta);
            return;
        }
        const prefix = this._entry.errorPrefix ?? 'lumen_sidecar';
        this._io.save(projectRoot, this._relativePath, this._meta, `${prefix}_missing`);
    }

    /**
     * @description 把字段快照收成 sidecar 检视联合。
     * @param snapshot 已按规格组装的记录
     * @returns 检视快照
     */
    private _asInspect(snapshot: Readonly<Record<string, unknown>>): ILumenSidecarMetaInspect {
        if (snapshot.kind !== this._entry.assetKind) {
            throw new Error(`${this._entry.errorPrefix}_meta_corrupt:${this._relativePath}`);
        }
        return this._copyInspect(snapshot);
    }

    /**
     * @description 复制已校验快照为检视联合（字段由 `assets.json` 保证）。
     * @param snapshot 记录
     * @returns 检视联合
     */
    private _copyInspect(snapshot: Readonly<Record<string, unknown>>): ILumenSidecarMetaInspect {
        const copied: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(snapshot)) {
            copied[key] = value;
        }
        if (this._entry.assetKind === 'audio') {
            copied.downloadModeWritable = this._entry.fields.some(
                (field) => field.apiName === 'downloadMode' && field.writable,
            );
        }
        const boxed: unknown = copied;
        return boxed as ILumenSidecarMetaInspect;
    }

    /**
     * @description 把种类字符串收成独立资产联合。
     * @param assetKind 登记 kind
     * @returns 独立资产 kind
     */
    private static _asStandaloneKind(assetKind: string): LumenStandaloneAssetKind {
        if (!LumenCuratedSchemaCatalog.shared().isStandaloneKind(assetKind)) {
            throw new Error(`lumen_not_standalone_asset:${assetKind}`);
        }
        return LumenSidecarMetaDocument._narrowStandaloneKind(assetKind);
    }

    /**
     * @description 在已确认属于独立资产后收窄 kind。
     * @param assetKind 登记 kind
     * @returns 独立资产 kind
     */
    private static _narrowStandaloneKind(assetKind: string): LumenStandaloneAssetKind {
        switch (assetKind) {
            case 'material':
            case 'animationClip':
            case 'physicsMaterial':
            case 'terrain':
            case 'image':
            case 'effect':
            case 'effectChunk':
            case 'model':
            case 'autoAtlas':
            case 'labelAtlas':
            case 'animationGraph':
            case 'animationGraphVariant':
            case 'animationMask':
            case 'renderTexture':
            case 'renderPipeline':
            case 'renderFlow':
            case 'renderStage':
            case 'audio':
            case 'video':
            case 'ttfFont':
            case 'bitmapFont':
            case 'spine':
            case 'dragonBones':
            case 'dragonBonesAtlas':
            case 'cubeMap':
            case 'tiledMap':
            case 'directory':
            case 'particle':
            case 'spriteAtlas':
            case 'json':
            case 'text':
            case 'buffer':
            case 'script':
            case 'javascript':
            case 'mesh':
            case 'skeleton':
            case 'instantiationAnimation':
            case 'instantiationMaterial':
                return assetKind;
            default:
                throw new Error(`lumen_not_standalone_asset:${assetKind}`);
        }
    }
}

/**
 * @description 兼容旧导出：粒子旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenParticleMetaDocument };

/**
 * @description 兼容旧导出：Sprite Atlas 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenSpriteAtlasMetaDocument };

/**
 * @description 兼容旧导出：音频旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenAudioMetaDocument };

/**
 * @description 兼容旧导出：视频旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenVideoMetaDocument };

/**
 * @description 兼容旧导出：字体旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenFontMetaDocument };

/**
 * @description 兼容旧导出：Spine 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenSpineMetaDocument };

/**
 * @description 兼容旧导出：DragonBones 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenDragonBonesMetaDocument };

/**
 * @description 兼容旧导出：CubeMap 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenCubeMapMetaDocument };

/**
 * @description 兼容旧导出：TiledMap 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenTiledMapMetaDocument };

/**
 * @description 兼容旧导出：文件夹旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenDirectoryMetaDocument };

/**
 * @description 兼容旧导出：JSON / 文本旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenConfigMetaDocument };

/**
 * @description 兼容旧导出：Buffer `.bin` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenBufferMetaDocument };

/**
 * @description 兼容旧导出：TypeScript `.ts` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenScriptMetaDocument };

/**
 * @description 兼容旧导出：JavaScript `.js` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenJavascriptMetaDocument };

/**
 * @description 兼容旧导出：instantiation-mesh `.mesh` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenMeshMetaDocument };

/**
 * @description 兼容旧导出：instantiation-skeleton `.skeleton` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenSkeletonMetaDocument };

/**
 * @description 兼容旧导出：instantiation-animation `.animation` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenInstantiationAnimationMetaDocument };

/**
 * @description 兼容旧导出：instantiation-material `.material` 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenInstantiationMaterialMetaDocument };

/**
 * @description 兼容旧导出：Auto Atlas 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenAutoAtlasDocument };

/**
 * @description 兼容旧导出：LabelAtlas 旁路文档即通用 sidecar 文档。
 */
export { LumenSidecarMetaDocument as LumenLabelAtlasDocument };
