import { CompatibleUuid } from '@peanut/pod-engine/assets';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenMetaImporterVersions } from '../schema/meta-importer-versions';
import { LumenStandaloneInspectQuery } from './inspect-query';
import { LumenTextureFilterModeCodec } from './texture-filter-mode';

/**
 * @description RenderTexture 贴图过滤。
 */
export interface ILumenRenderTextureFilterInspect {
    /** @description U 方向寻址。 */
    readonly wrapModeS: string;
    /** @description V 方向寻址。 */
    readonly wrapModeT: string;
    /** @description 缩小过滤。 */
    readonly minfilter: string;
    /** @description 放大过滤。 */
    readonly magfilter: string;
    /** @description Mipmap 过滤。 */
    readonly mipfilter: string;
    /** @description 各向异性。 */
    readonly anisotropy: number;
    /** @description Creator 检视器 Filter Mode 面板别名；无法匹配三元组时为 `null`。 */
    readonly filterMode: string | null;
}

/**
 * @description RenderTexture Inspector 快照。不做预览。
 */
export interface ILumenRenderTextureInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'renderTexture';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 宽度。 */
    readonly width: number;
    /** @description 高度。 */
    readonly height: number;
    /** @description 贴图过滤。 */
    readonly texture: ILumenRenderTextureFilterInspect;
}

/**
 * @description `.rt` 文档：尺寸与过滤写 `.meta`，并同步源文件 `content.w/h`。
 */
export class LumenRenderTextureDocument {
    /** @description 读写辅助。 */
    private readonly _io = new LumenJsonAssetIo();

    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description 源 JSON。 */
    private _record: Record<string, unknown>;

    /** @description Creator meta。 */
    private _meta: Record<string, unknown>;

    /**
     * @description 从已校验的源与 meta 创建文档。
     * @param relativePath 相对路径
     * @param record `.rt` JSON
     * @param meta Creator meta
     */
    public constructor(
        relativePath: string,
        record: Record<string, unknown>,
        meta: Record<string, unknown>,
    ) {
        this._relativePath = relativePath;
        this._record = record;
        this._meta = meta;
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
     * @returns `renderTexture`
     */
    public get kind(): 'renderTexture' {
        return 'renderTexture';
    }

    /**
     * @description 创建空 RenderTexture（256×256）。
     * @param relativePath 相对路径
     * @param name 写入子资源 displayName
     * @param template 仅 `empty`
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenRenderTextureDocument {
        if (template !== 'empty') {
            throw new Error(`lumen_render_texture_template_unknown:${template}`);
        }
        const uuid = CompatibleUuid.create();
        const displayName = name.trim().length > 0 ? name.trim() : 'render-texture';
        return new LumenRenderTextureDocument(
            relativePath,
            {
                __type__: 'cc.RenderTexture',
                _objFlags: 0,
                _native: '',
                content: {
                    base: '2,2,0,0,0,0',
                    w: 256,
                    h: 256,
                    n: '',
                },
            },
            {
                ver: '1.2.1',
                importer: 'render-texture',
                imported: false,
                uuid,
                files: ['.json'],
                subMetas: {
                    f9941: {
                        importer: 'rt-sprite-frame',
                        uuid: `${uuid}@f9941`,
                        displayName,
                        id: 'f9941',
                        name: 'spriteFrame',
                        userData: {
                            imageUuidOrDatabaseUri: uuid,
                            width: 256,
                            height: 256,
                        },
                        ver: '1.0.0',
                        imported: false,
                        files: ['.json'],
                        subMetas: {},
                    },
                },
                userData: {
                    width: 256,
                    height: 256,
                    anisotropy: 0,
                    minfilter: 'linear',
                    magfilter: 'linear',
                    mipfilter: 'none',
                    wrapModeS: 'repeat',
                    wrapModeT: 'repeat',
                    redirect: `${uuid}@f9941`,
                },
            },
        );
    }

    /**
     * @description 打开已有 `.rt` 与 `.meta`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenRenderTextureDocument {
        const io = new LumenJsonAssetIo();
        const record = io.readRecord(
            projectRoot,
            relativePath,
            ['cc.RenderTexture'],
            'lumen_render_texture_missing',
            'lumen_render_texture_json_corrupt',
        );
        const metaPath = `${join(projectRoot, relativePath)}.meta`;
        if (!existsSync(metaPath)) {
            throw new Error(`lumen_render_texture_meta_missing:${relativePath}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
        } catch {
            throw new Error(`lumen_render_texture_meta_corrupt:${relativePath}`);
        }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`lumen_render_texture_meta_corrupt:${relativePath}`);
        }
        const meta = parsed as Record<string, unknown>;
        if (meta.importer !== 'render-texture') {
            throw new Error(`lumen_render_texture_meta_corrupt:${relativePath}`);
        }
        return new LumenRenderTextureDocument(relativePath, record, meta);
    }

    /**
     * @description 读取尺寸与贴图过滤。
     * @param query RenderTexture 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenRenderTextureInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'renderTexture');
        const userData = this._readOptionalRecord(this._meta.userData);
        const content = this._readOptionalRecord(this._record.content);
        return {
            path: this._relativePath,
            kind: 'renderTexture',
            uuid: this._readRequiredString(this._meta.uuid, 'uuid'),
            importer: this._readRequiredString(this._meta.importer, 'importer'),
            width: this._readNumber(userData.width, this._readNumber(content.w, 256)),
            height: this._readNumber(userData.height, this._readNumber(content.h, 256)),
            texture: (() => {
                const minfilter = typeof userData.minfilter === 'string' ? userData.minfilter : 'linear';
                const magfilter = typeof userData.magfilter === 'string' ? userData.magfilter : 'linear';
                const mipfilter = typeof userData.mipfilter === 'string' ? userData.mipfilter : 'none';
                return {
                    wrapModeS: typeof userData.wrapModeS === 'string' ? userData.wrapModeS : 'repeat',
                    wrapModeT: typeof userData.wrapModeT === 'string' ? userData.wrapModeT : 'repeat',
                    minfilter,
                    magfilter,
                    mipfilter,
                    anisotropy: this._readNumber(userData.anisotropy, 0),
                    filterMode: LumenTextureFilterModeCodec.inferFilterMode({ minfilter, magfilter, mipfilter }),
                };
            })(),
        };
    }

    /**
     * @description 写入宽高与贴图过滤；同步源 `content.w/h` 与 sprite-frame 子 meta。
     * @param patch `width` / `height` / `texture`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['width', 'height', 'texture'], 'renderTexture');
        const nextMeta = this._cloneRecord(this._meta);
        const nextRecord = this._cloneRecord(this._record);
        const userData = this._ensureRecord(nextMeta, 'userData');
        const content = this._ensureRecord(nextRecord, 'content');
        if (patch.width !== undefined) {
            const width = this._requireRange(patch.width, 'width', 1, 8192, true);
            userData.width = width;
            content.w = width;
            this._syncSubMetaSize(nextMeta, 'width', width);
        }
        if (patch.height !== undefined) {
            const height = this._requireRange(patch.height, 'height', 1, 8192, true);
            userData.height = height;
            content.h = height;
            this._syncSubMetaSize(nextMeta, 'height', height);
        }
        if (patch.texture !== undefined) {
            this._patchTexture(userData, this._readRecord(patch.texture, 'texture'));
        }
        this._meta = nextMeta;
        this._record = nextRecord;
    }

    /**
     * @description 写回 `.rt` 源与 `.meta`；不改 library、不重写 `content.base`。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing RenderTexture 始终写 meta
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
        void writeMetaIfMissing;
        const absolutePath = join(projectRoot, this._relativePath);
        mkdirSync(dirname(absolutePath), { recursive: true });
        LumenAtomicFileWriter.writeUtf8(absolutePath, `${JSON.stringify(this._record, null, 2)}\n`);
        const meta = {
            ...this._meta,
            ver: LumenMetaImporterVersions.shared().resolve(cocosVersion, 'render-texture'),
            importer: 'render-texture',
        };
        LumenAtomicFileWriter.writeUtf8(`${absolutePath}.meta`, `${JSON.stringify(meta, null, 2)}\n`);
    }

    /**
     * @description 同步 rt-sprite-frame 子资源宽高。
     * @param meta meta 根
     * @param key `width` 或 `height`
     * @param value 尺寸
     */
    private _syncSubMetaSize(meta: Record<string, unknown>, key: 'width' | 'height', value: number): void {
        const subMetas = this._readOptionalRecord(meta.subMetas);
        const frame = this._readOptionalRecord(subMetas.f9941);
        if (Object.keys(frame).length === 0) {
            return;
        }
        const userData = this._ensureRecord(frame, 'userData');
        userData[key] = value;
        subMetas.f9941 = frame;
        meta.subMetas = subMetas;
    }

    /**
     * @description 写入贴图过滤到 meta.userData。
     * @param userData meta.userData
     * @param patch 已校验对象
     */
    private _patchTexture(userData: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        const fields = ['wrapModeS', 'wrapModeT', 'minfilter', 'magfilter', 'mipfilter', 'anisotropy', 'filterMode'] as const;
        this._assertOnlyFields(patch, fields, 'texture');
        const expanded = LumenTextureFilterModeCodec.expandPatch(patch);
        for (const key of fields.filter((fieldName) => fieldName !== 'filterMode')) {
            const value = expanded[key];
            if (value === undefined) {
                continue;
            }
            userData[key] =
                key === 'anisotropy'
                    ? this._requireRange(value, 'texture.anisotropy', 0, 16, true)
                    : this._requireString(value, `texture.${key}`);
        }
    }

    /**
     * @description 确保对象字段存在。
     * @param owner 父对象
     * @param key 字段名
     * @returns 对象记录
     */
    private _ensureRecord(owner: Record<string, unknown>, key: string): Record<string, unknown> {
        const existing = owner[key];
        if (existing != null && typeof existing === 'object' && !Array.isArray(existing)) {
            return existing as Record<string, unknown>;
        }
        const created: Record<string, unknown> = {};
        owner[key] = created;
        return created;
    }

    /**
     * @description 读取可选对象。
     * @param value 未受信值
     * @returns 对象
     */
    private _readOptionalRecord(value: unknown): Record<string, unknown> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 读取对象值。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 对象记录
     */
    private _readRecord(value: unknown, fieldName: string): Record<string, unknown> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`lumen_render_texture_property_type:${fieldName}:object`);
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 读取非空字符串。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _readRequiredString(value: unknown, fieldName: string): string {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`lumen_render_texture_property_type:${fieldName}:string`);
        }
        return value;
    }

    /**
     * @description 读取快照数字。
     * @param value 未受信值
     * @param fallback 缺省
     * @returns 数字
     */
    private _readNumber(value: unknown, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * @description 校验非空字符串。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _requireString(value: unknown, fieldName: string): string {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`lumen_render_texture_property_type:${fieldName}:string`);
        }
        return value;
    }

    /**
     * @description 校验有限数字范围。
     * @param value 未受信值
     * @param fieldName 字段名
     * @param minimum 最小值
     * @param maximum 最大值
     * @param integer 是否整数
     * @returns 已校验数字
     */
    private _requireRange(
        value: unknown,
        fieldName: string,
        minimum: number,
        maximum: number,
        integer: boolean,
    ): number {
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < minimum ||
            value > maximum ||
            (integer && !Number.isInteger(value))
        ) {
            throw new Error(`lumen_render_texture_property_range:${fieldName}:${minimum}..${maximum}`);
        }
        return value;
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
                    `lumen_render_texture_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`,
                );
            }
        }
    }

    /**
     * @description 深拷贝 JSON 记录。
     * @param value JSON 记录
     * @returns 深拷贝
     */
    private _cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
        return this._io.cloneJson(value) as Record<string, unknown>;
    }
}
