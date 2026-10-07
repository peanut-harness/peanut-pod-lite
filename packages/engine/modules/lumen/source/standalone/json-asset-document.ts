import type { ILumenAssetSchemaEntry } from '../schema/codec';
import { LumenCuratedSchemaCatalog } from '../schema/catalog';
import { LumenAssetScaffoldTemplate } from '../schema/scaffold-template';
import { LumenHierarchyEntry, type LumenStandaloneAssetKind } from '../hierarchy/entry';
import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenSidecarFieldCodec } from './sidecar-field-codec';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description 物理材质 Inspector 快照。
 */
export interface ILumenPhysicsMaterialInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'physicsMaterial';
    /** @description `_name`。 */
    readonly name: string;
    /** @description 滑动摩擦。 */
    readonly friction: number;
    /** @description 滚动摩擦。 */
    readonly rollingFriction: number;
    /** @description 自旋摩擦。 */
    readonly spinningFriction: number;
    /** @description 弹性。 */
    readonly restitution: number;
}

/**
 * @description Render Flow Inspector 快照。不做 dump 树。
 */
export interface ILumenRenderFlowInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'renderFlow';
    /** @description 头 `__type__`。 */
    readonly type: string;
    /** @description `_name`。 */
    readonly name: string;
    /** @description `_priority`。 */
    readonly priority: number;
    /** @description `_tag`。 */
    readonly tag: number;
    /** @description `_stages` 中的 uuid 引用。 */
    readonly stageUuids: readonly string[];
}

/**
 * @description Render Stage Inspector 快照。不做 dump 树。
 */
export interface ILumenRenderStageInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'renderStage';
    /** @description 头 `__type__`。 */
    readonly type: string;
    /** @description `_name`。 */
    readonly name: string;
    /** @description `_priority`。 */
    readonly priority: number;
    /** @description `_tag`。 */
    readonly tag: number;
}

/**
 * @description 源 JSON 对象资产 Inspector 快照。
 */
export type ILumenJsonAssetInspect =
    | ILumenPhysicsMaterialInspect
    | ILumenRenderFlowInspect
    | ILumenRenderStageInspect;

/**
 * @description 配置驱动的源 JSON 对象文档（物理材质等）。
 */
export class LumenJsonAssetDocument {
    /**
     * @description JSON 读写。
     */
    private readonly _io = new LumenJsonAssetIo();

    /**
     * @description 字段编解码。
     */
    private readonly _fields = new LumenSidecarFieldCodec();

    /**
     * @description scaffold 占位符绑定。
     */
    private static readonly _scaffold = new LumenAssetScaffoldTemplate();

    /**
     * @description 项目相对路径。
     */
    private readonly _relativePath: string;

    /**
     * @description 策展登记。
     */
    private readonly _entry: ILumenAssetSchemaEntry;

    /**
     * @description 源 JSON 记录。
     */
    private _record: Record<string, unknown>;

    /**
     * @description 从已校验记录创建文档。
     * @param relativePath 相对路径
     * @param entry 资产登记
     * @param record 源 JSON
     */
    public constructor(
        relativePath: string,
        entry: ILumenAssetSchemaEntry,
        record: Record<string, unknown>,
    ) {
        this._relativePath = relativePath;
        this._entry = entry;
        this._record = record;
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
        return LumenJsonAssetDocument._asStandaloneKind(this._entry.assetKind);
    }

    /**
     * @description 创建空源 JSON 资产。
     * @param relativePath 相对路径
     * @param name `$name` 占位
     * @param template 仅 `empty`
     * @param entry 资产登记；省略则按路径查表
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
        entry?: ILumenAssetSchemaEntry,
    ): LumenJsonAssetDocument {
        const resolved =
            entry ??
            LumenCuratedSchemaCatalog.shared().jsonAssetEntry(
                LumenHierarchyEntry.assetKindFromPath(relativePath),
            );
        const prefix = resolved?.errorPrefix ?? 'lumen_json';
        if (resolved == null || resolved.scaffold !== true || resolved.scaffoldRecord == null) {
            throw new Error(`${prefix}_scaffold_unsupported:${relativePath}`);
        }
        if (template !== 'empty') {
            throw new Error(`${prefix}_template_unknown:${template}`);
        }
        const record = LumenJsonAssetDocument._scaffold.instantiate(resolved.scaffoldRecord, {
            $name: name.trim(),
        });
        return new LumenJsonAssetDocument(relativePath, resolved, record);
    }

    /**
     * @description 打开已有源 JSON。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @param entry 资产登记；省略则按扩展名解析
     * @returns 文档
     */
    public static open(
        projectRoot: string,
        relativePath: string,
        entry?: ILumenAssetSchemaEntry,
    ): LumenJsonAssetDocument {
        const kind = LumenHierarchyEntry.resolveAssetKind(projectRoot, relativePath);
        const resolved = entry ?? LumenCuratedSchemaCatalog.shared().jsonAssetEntry(kind);
        if (resolved == null || resolved.assetKind !== kind) {
            throw new Error(`lumen_not_standalone_asset:${relativePath}`);
        }
        const prefix = resolved.errorPrefix ?? 'lumen_json';
        const allowedTypes = resolved.allowedTypes ?? [];
        const io = new LumenJsonAssetIo();
        const record = io.readRecord(
            projectRoot,
            relativePath,
            allowedTypes,
            `${prefix}_missing`,
            `${prefix}_json_corrupt`,
        );
        return new LumenJsonAssetDocument(relativePath, resolved, record);
    }

    /**
     * @description 读取公开字段。
     * @param query json-asset 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenJsonAssetInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, this._entry.assetKind);
        return this._asInspect(this._fields.inspectRecord(this._entry, this._relativePath, this._record));
    }

    /**
     * @description 写入可写字段；拒绝只读键。
     * @param patch 公开字段
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._record = this._fields.applyPatchToRecord(this._entry, this._record, patch);
    }

    /**
     * @description 写回源 JSON 与最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     */
    /**
     * @description 序列化内存源文档，交给原生首次创建接口。
     * @returns 源 JSON 文本；不包含伪造的 AssetDB 登记。
     */
    public serializeNativeSource(): string {
        return `${JSON.stringify(this._record, null, 2)}\n`;
    }

    /**
     * @description 写回源文档和 meta。
     * @param projectRoot 工程根。
     * @param writeMetaIfMissing 是否写入缺失 meta。
     * @param cocosVersion Creator 版本。
     */
    /**
   * @description 写回源文档和 meta。
   * @param projectRoot 工程根。
   * @param writeMetaIfMissing 是否写入缺失 meta。
   * @param cocosVersion Creator 版本。
   */
  public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        const importer = this._entry.importers[0];
        if (importer == null || importer.length === 0) {
            throw new Error(`lumen_curated_schema_corrupt:assets.json:${this._entry.assetKind}:importers`);
        }
        this._io.writeRecord(
            projectRoot,
            this._relativePath,
            this._record,
            importer,
            writeMetaIfMissing,
            cocosVersion,
        );
    }

    /**
     * @description 把字段快照收成 json-asset 检视联合。
     * @param snapshot 已按规格组装的记录
     * @returns 检视快照
     */
    private _asInspect(snapshot: Readonly<Record<string, unknown>>): ILumenJsonAssetInspect {
        if (snapshot.kind !== this._entry.assetKind) {
            throw new Error(`${this._entry.errorPrefix}_json_corrupt:${this._relativePath}`);
        }
        const copied: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(snapshot)) {
            copied[key] = value;
        }
        const boxed: unknown = copied;
        return boxed as ILumenJsonAssetInspect;
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
        if (
            assetKind !== 'physicsMaterial' &&
            assetKind !== 'renderFlow' &&
            assetKind !== 'renderStage'
        ) {
            throw new Error(`lumen_not_standalone_asset:${assetKind}`);
        }
        return assetKind;
    }
}

/**
 * @description 兼容旧导出：物理材质文档即通用 json-asset 文档。
 */
export { LumenJsonAssetDocument as LumenPhysicsMaterialDocument };
