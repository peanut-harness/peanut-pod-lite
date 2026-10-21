import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description Animation Graph Variant 剪辑覆盖项。
 */
export interface ILumenAnimationGraphVariantClipInspect {
    /** @description 原剪辑 uuid。 */
    readonly original: string | null;
    /** @description 覆盖剪辑 uuid。 */
    readonly substitution: string | null;
}

/**
 * @description Animation Graph Variant Inspector 快照。
 */
export interface ILumenAnimationGraphVariantInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'animationGraphVariant';
    /** @description `_name`。 */
    readonly name: string;
    /** @description 原始 Animation Graph uuid；未绑定时为 `null`。 */
    readonly graph: string | null;
    /** @description 剪辑覆盖表。 */
    readonly clips: readonly ILumenAnimationGraphVariantClipInspect[];
}

/**
 * @description `.animgraphvari` 文档：绑定原图与剪辑覆盖；不打开图编辑器。
 */
export class LumenAnimationGraphVariantDocument {
    /** @description 读写辅助。 */
    private readonly _io = new LumenJsonAssetIo();

    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description Prefab 式序列化数组。 */
    private readonly _entries: Record<string, unknown>[];

    /**
     * @description 从已有条目创建文档。
     * @param relativePath 相对路径
     * @param entries 序列化数组
     */
    public constructor(relativePath: string, entries: Record<string, unknown>[]) {
        this._relativePath = relativePath;
        this._entries = entries;
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
     * @returns `animationGraphVariant`
     */
    public get kind(): 'animationGraphVariant' {
        return 'animationGraphVariant';
    }

    /**
     * @description 创建空 Variant。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template 仅 `empty`
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenAnimationGraphVariantDocument {
        if (template !== 'empty') {
            throw new Error(`lumen_animation_graph_variant_template_unknown:${template}`);
        }
        return new LumenAnimationGraphVariantDocument(relativePath, [
            {
                __type__: 'cc.animation.AnimationGraphVariant',
                _name: name.trim(),
                _objFlags: 0,
                _native: '',
                _graph: null,
                _clipOverrides: { __id__: 1 },
            },
            {
                __type__: 'cc.animation.ClipOverrideMap',
                _entries: [],
            },
        ]);
    }

    /**
     * @description 从磁盘打开 `.animgraphvari`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenAnimationGraphVariantDocument {
        const io = new LumenJsonAssetIo();
        const entries = io.readEntries(
            projectRoot,
            relativePath,
            ['cc.animation.AnimationGraphVariant'],
            'lumen_animation_graph_variant_missing',
            'lumen_animation_graph_variant_json_corrupt',
        );
        return new LumenAnimationGraphVariantDocument(relativePath, entries);
    }

    /**
     * @description 读取原图与剪辑覆盖。
     * @param query Variant 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenAnimationGraphVariantInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'animationGraphVariant');
        const header = this._header();
        return {
            path: this._relativePath,
            kind: 'animationGraphVariant',
            name: typeof header._name === 'string' ? header._name : '',
            graph: this._io.readUuid(header._graph),
            clips: this._readClips(),
        };
    }

    /**
     * @description 写入名称、原图 uuid 与剪辑覆盖表。
     * @param patch `name` / `graph` / `clips`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['name', 'graph', 'clips'], 'animationGraphVariant');
        const header = this._header();
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_animation_graph_variant_property_type:name:string');
            }
            header._name = patch.name;
        }
        if (patch.graph !== undefined) {
            header._graph =
                patch.graph === null || patch.graph === ''
                    ? null
                    : this._io.encodeUuid(patch.graph, 'cc.animation.AnimationGraph');
        }
        if (patch.clips !== undefined) {
            this._replaceClips(patch.clips);
        }
    }

    /**
     * @description 在内存中序列化原生源，由AssetDB首次创建并分配meta。
     * @returns 完整原生JSON源。
     */
    public serializeNativeSource(): string {
        return `${JSON.stringify(this._entries, null, 2)}\n`;
    }

    /**
     * @description 写回磁盘与最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        this._io.writeEntries(
            projectRoot,
            this._relativePath,
            this._entries,
            'animation-graph-variant',
            writeMetaIfMissing,
            cocosVersion,
        );
    }

    /**
     * @description 读取头对象。
     * @returns 头
     */
    private _header(): Record<string, unknown> {
        const header = this._entries[0];
        if (header == null) {
            throw new Error(`lumen_animation_graph_variant_json_corrupt:${this._relativePath}`);
        }
        return header;
    }

    /**
     * @description 定位 ClipOverrideMap。
     * @returns 覆盖表
     */
    private _overrideMap(): Record<string, unknown> {
        const map = this._io.resolveMutableEntry(this._entries, this._header()._clipOverrides);
        if (map == null) {
            throw new Error(`lumen_animation_graph_variant_json_corrupt:${this._relativePath}`);
        }
        return map;
    }

    /**
     * @description 读取剪辑覆盖。
     * @returns 覆盖项
     */
    private _readClips(): ILumenAnimationGraphVariantClipInspect[] {
        const raw = this._overrideMap()._entries;
        if (!Array.isArray(raw)) {
            return [];
        }
        const clips: ILumenAnimationGraphVariantClipInspect[] = [];
        for (const item of raw) {
            const entry = this._io.resolveMutableEntry(this._entries, item);
            if (entry == null) {
                continue;
            }
            clips.push({
                original: this._io.readUuid(entry.original),
                substitution: this._io.readUuid(entry.substitution),
            });
        }
        return clips;
    }

    /**
     * @description 整表替换剪辑覆盖。
     * @param value `{ original, substitution }[]`
     */
    private _replaceClips(value: unknown): void {
        if (!Array.isArray(value)) {
            throw new Error('lumen_animation_graph_variant_property_type:clips:array');
        }
        const encoded: Record<string, unknown>[] = [];
        for (let index = 0; index < value.length; index += 1) {
            const item = value[index];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_animation_graph_variant_property_type:clips[${index}]:object`);
            }
            const patch = item as Record<string, unknown>;
            this._assertOnlyFields(patch, ['original', 'substitution'], `clips[${index}]`);
            encoded.push({
                __type__: 'cc.animation.ClipOverrideEntry',
                original: this._encodeClipUuid(patch.original, `clips[${index}].original`),
                substitution: this._encodeClipUuid(patch.substitution, `clips[${index}].substitution`),
            });
        }
        this._overrideMap()._entries = encoded;
    }

    /**
     * @description 编码动画剪辑 uuid；允许 `null`。
     * @param value uuid 或 `null`
     * @param fieldName 字段名
     * @returns 序列化值
     */
    private _encodeClipUuid(value: unknown, fieldName: string): Record<string, unknown> | null {
        if (value === undefined) {
            throw new Error(`lumen_animation_graph_variant_property_type:${fieldName}:uuid`);
        }
        if (value === null || value === '') {
            return null;
        }
        try {
            return this._io.encodeUuid(value, 'cc.AnimationClip');
        } catch {
            throw new Error(`lumen_animation_graph_variant_property_type:${fieldName}:uuid`);
        }
    }

    /**
     * @description 拒绝不在白名单内的补丁字段。
     * @param value 补丁
     * @param allowed 允许字段
     * @param scope 分组
     */
    private _assertOnlyFields(
        value: Readonly<Record<string, unknown>>,
        allowed: readonly string[],
        scope: string,
    ): void {
        const allowedSet = new Set(allowed);
        for (const key of Object.keys(value)) {
            if (!allowedSet.has(key)) {
                throw new Error(
                    `lumen_animation_graph_variant_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`,
                );
            }
        }
    }
}
