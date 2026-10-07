import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenCompressSettingsCodec, type ILumenCompressSettingsSnapshot } from './compress-settings';
import { LumenStandaloneInspectQuery } from './inspect-query';
import { LumenTextureFilterModeCodec } from './texture-filter-mode';

/**
 * @description Creator 图片导入类型枚举。
 */
export type LumenImageImporterType = 'raw' | 'texture' | 'normal map' | 'sprite-frame' | 'texture cube';

/**
 * @description 图片 Importer 顶层设置。
 */
export interface ILumenImageImporterInspect {
    /** @description Creator 图片导入类型。 */
    readonly type: string;
    /** @description 是否检测到透明通道。 */
    readonly hasAlpha: boolean;
    /** @description 是否修复透明像素颜色渗漏。 */
    readonly fixAlphaTransparencyArtifacts: boolean;
    /** @description 是否垂直翻转；缺省为 `false`。 */
    readonly flipVertical: boolean;
    /** @description 是否离线烘焙 Mipmap；缺省为 `false`。 */
    readonly bakeOfflineMipmaps: boolean;
    /** @description 是否为 RGBE 高动态范围贴图（Cube 用）；缺省为 `false`。 */
    readonly isRGBE: boolean;
    /** @description 是否翻转法线贴图绿通道；缺省为 `false`。 */
    readonly flipGreenChannel: boolean;
    /** @description 是否启用压缩纹理；缺省为 `false`。 */
    readonly useCompressTexture: boolean;
    /** @description 压缩预设 id；未绑定时为空串。 */
    readonly presetId: string;
    /** @description 压缩纹理默认与平台覆盖（`meta.userData.compressSettings`）。 */
    readonly compressSettings: ILumenCompressSettingsSnapshot;
}

/**
 * @description 图片 Texture 子资源设置。
 */
export interface ILumenImageTextureInspect {
    /** @description Texture 子资源 uuid。 */
    readonly uuid: string;
    /** @description U 方向寻址模式。 */
    readonly wrapModeS: string;
    /** @description V 方向寻址模式。 */
    readonly wrapModeT: string;
    /** @description 缩小过滤模式。 */
    readonly minfilter: string;
    /** @description 放大过滤模式。 */
    readonly magfilter: string;
    /** @description Mipmap 过滤模式。 */
    readonly mipfilter: string;
    /** @description 各向异性过滤等级。 */
    readonly anisotropy: number;
    /** @description Creator 检视器 Filter Mode 面板别名；无法匹配三元组时为 `null`。 */
    readonly filterMode: string | null;
}

/**
 * @description 图片 SpriteFrame 子资源设置。
 */
export interface ILumenImageSpriteFrameInspect {
    /** @description SpriteFrame 子资源 uuid。 */
    readonly uuid: string;
    /** @description 自动裁剪透明像素的阈值。 */
    readonly trimThreshold: number;
    /** @description SpriteFrame 是否旋转。 */
    readonly rotated: boolean;
    /** @description 九宫格上边距。 */
    readonly borderTop: number;
    /** @description 九宫格下边距。 */
    readonly borderBottom: number;
    /** @description 九宫格左边距。 */
    readonly borderLeft: number;
    /** @description 九宫格右边距。 */
    readonly borderRight: number;
    /** @description 是否允许自动图集打包。 */
    readonly packable: boolean;
    /** @description 每单位像素数。 */
    readonly pixelsToUnit: number;
    /** @description X 轴枢轴比例。 */
    readonly pivotX: number;
    /** @description Y 轴枢轴比例。 */
    readonly pivotY: number;
    /** @description SpriteFrame 网格类型。 */
    readonly meshType: number;
    /** @description SpriteFrame 裁剪类型。 */
    readonly trimType: string;
    /** @description 自定义裁剪矩形左上角 X；仅 `trimType: custom` 时生效，缺省为 `0`。 */
    readonly trimX: number;
    /** @description 自定义裁剪矩形左上角 Y；仅 `trimType: custom` 时生效，缺省为 `0`。 */
    readonly trimY: number;
    /** @description 自定义裁剪矩形宽度；仅 `trimType: custom` 时生效，缺省为 `0`。 */
    readonly width: number;
    /** @description 自定义裁剪矩形高度；仅 `trimType: custom` 时生效，缺省为 `0`。 */
    readonly height: number;
}

/**
 * @description 图片 `.meta` Inspector 快照。
 */
export interface ILumenImageMetaInspect {
    /** @description 图片项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'image';
    /** @description 图片主资源 uuid。 */
    readonly uuid: string;
    /** @description 图片 Importer 设置。 */
    readonly image: ILumenImageImporterInspect;
    /** @description Texture 子资源设置。 */
    readonly texture: ILumenImageTextureInspect;
    /** @description SpriteFrame 子资源设置；纯 Texture 图片可缺省。 */
    readonly spriteFrame: ILumenImageSpriteFrameInspect | null;
}

/**
 * @description `.png` / `.jpg` 等图片的 Creator `.meta` 文档。
 */
export class LumenImageMetaDocument {
    /** @description `image.type` 允许的 Creator 导入类型。 */
    private static readonly _imageTypeValues: readonly LumenImageImporterType[] = [
        'raw',
        'texture',
        'normal map',
        'sprite-frame',
        'texture cube',
    ];

    /** @description `image` 分组布尔字段；校验方式一致，逐一写入。 */
    private static readonly _imageBooleanFields: readonly string[] = [
        'fixAlphaTransparencyArtifacts',
        'flipVertical',
        'bakeOfflineMipmaps',
        'isRGBE',
        'flipGreenChannel',
        'useCompressTexture',
    ];

    /** @description 自定义裁剪矩形字段；写入其中任意一个都会强制 `trimType` 为 `custom`。 */
    private static readonly _spriteFrameTrimRectFields: readonly string[] = ['trimX', 'trimY', 'width', 'height'];

    /** @description 压缩纹理编解码。 */
    private readonly _compressSettings = new LumenCompressSettingsCodec();

    /** @description 图片项目相对路径。 */
    private readonly _relativePath: string;

    /** @description Creator 图片 meta 记录。 */
    private _meta: Record<string, unknown>;

    /**
     * @description 从已校验的图片 meta 创建文档。
     * @param relativePath 图片项目相对路径
     * @param meta Creator meta 记录
     */
    public constructor(relativePath: string, meta: Record<string, unknown>) {
        this._relativePath = relativePath;
        this._meta = meta;
    }

    /**
     * @description 相对项目根的图片路径。
     * @returns 图片路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 资产种类。
     * @returns `image`
     */
    public get kind(): 'image' {
        return 'image';
    }

    /**
     * @description 从磁盘打开图片及其 `.meta`。
     * @param projectRoot Creator 项目根
     * @param relativePath 图片项目相对路径
     * @returns 图片 meta 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenImageMetaDocument {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_image_missing:${relativePath}`);
        }
        const metaPath = `${absolutePath}.meta`;
        if (!existsSync(metaPath)) {
            throw new Error(`lumen_image_meta_missing:${relativePath}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
        } catch {
            throw new Error(`lumen_image_meta_corrupt:${relativePath}`);
        }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`lumen_image_meta_corrupt:${relativePath}`);
        }
        const meta = parsed as Record<string, unknown>;
        if (meta.importer !== 'image') {
            throw new Error(`lumen_image_meta_corrupt:${relativePath}`);
        }
        LumenImageMetaDocument._findSubMeta(meta, 'texture', relativePath);
        return new LumenImageMetaDocument(relativePath, meta);
    }

    /**
     * @description 读取图片、Texture 与 SpriteFrame 的 Inspector 设置。
     * @param query 图片不接受查询键
     * @returns 图片 meta 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenImageMetaInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'image');
        const image = this._readRecord(this._meta.userData, 'image.userData');
        const compressSettings = this._compressSettings.inspect(image);
        const textureMeta = LumenImageMetaDocument._findSubMeta(this._meta, 'texture', this._relativePath);
        const texture = this._readRecord(textureMeta.userData, 'texture.userData');
        const spriteMeta = LumenImageMetaDocument._findOptionalSubMeta(this._meta, 'sprite-frame');
        const sprite = spriteMeta == null ? null : this._readRecord(spriteMeta.userData, 'spriteFrame.userData');
        return {
            path: this._relativePath,
            kind: 'image',
            uuid: this._readString(this._meta.uuid, 'uuid'),
            image: {
                type: this._readString(image.type, 'image.type'),
                hasAlpha: this._readBoolean(image.hasAlpha, 'image.hasAlpha'),
                fixAlphaTransparencyArtifacts: this._readBoolean(
                    image.fixAlphaTransparencyArtifacts,
                    'image.fixAlphaTransparencyArtifacts',
                ),
                flipVertical: this._readBoolean(image.flipVertical, 'image.flipVertical'),
                bakeOfflineMipmaps: this._readBoolean(image.bakeOfflineMipmaps, 'image.bakeOfflineMipmaps'),
                isRGBE: this._readBoolean(image.isRGBE, 'image.isRGBE'),
                flipGreenChannel: this._readBoolean(image.flipGreenChannel, 'image.flipGreenChannel'),
                useCompressTexture: compressSettings.useCompressTexture,
                presetId: compressSettings.presetId,
                compressSettings,
            },
            texture: (() => {
                const minfilter = this._readString(texture.minfilter, 'texture.minfilter');
                const magfilter = this._readString(texture.magfilter, 'texture.magfilter');
                const mipfilter = this._readString(texture.mipfilter, 'texture.mipfilter');
                return {
                    uuid: this._readString(textureMeta.uuid, 'texture.uuid'),
                    wrapModeS: this._readString(texture.wrapModeS, 'texture.wrapModeS'),
                    wrapModeT: this._readString(texture.wrapModeT, 'texture.wrapModeT'),
                    minfilter,
                    magfilter,
                    mipfilter,
                    anisotropy: this._readNumber(texture.anisotropy, 'texture.anisotropy'),
                    filterMode: LumenTextureFilterModeCodec.inferFilterMode({ minfilter, magfilter, mipfilter }),
                };
            })(),
            spriteFrame:
                spriteMeta == null || sprite == null
                    ? null
                    : {
                          uuid: this._readString(spriteMeta.uuid, 'spriteFrame.uuid'),
                          trimThreshold: this._readNumber(sprite.trimThreshold, 'spriteFrame.trimThreshold'),
                          rotated: this._readBoolean(sprite.rotated, 'spriteFrame.rotated'),
                          borderTop: this._readNumber(sprite.borderTop, 'spriteFrame.borderTop'),
                          borderBottom: this._readNumber(sprite.borderBottom, 'spriteFrame.borderBottom'),
                          borderLeft: this._readNumber(sprite.borderLeft, 'spriteFrame.borderLeft'),
                          borderRight: this._readNumber(sprite.borderRight, 'spriteFrame.borderRight'),
                          packable: this._readBoolean(sprite.packable, 'spriteFrame.packable'),
                          pixelsToUnit: this._readNumber(sprite.pixelsToUnit, 'spriteFrame.pixelsToUnit'),
                          pivotX: this._readNumber(sprite.pivotX, 'spriteFrame.pivotX'),
                          pivotY: this._readNumber(sprite.pivotY, 'spriteFrame.pivotY'),
                          meshType: this._readNumber(sprite.meshType, 'spriteFrame.meshType'),
                          trimType: this._readString(sprite.trimType, 'spriteFrame.trimType'),
                          trimX: this._readNumber(sprite.trimX, 'spriteFrame.trimX'),
                          trimY: this._readNumber(sprite.trimY, 'spriteFrame.trimY'),
                          width: this._readNumber(sprite.width, 'spriteFrame.width'),
                          height: this._readNumber(sprite.height, 'spriteFrame.height'),
                      },
        };
    }

    /**
     * @description 写入图片 Importer、Texture 或 SpriteFrame 设置。
     * @param patch `image` / `texture` / `spriteFrame` 分组补丁
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['image', 'texture', 'spriteFrame'], 'image');
        const next = this._cloneRecord(this._meta);
        if (patch.image !== undefined) {
            this._patchImage(next, this._readRecord(patch.image, 'image'));
        }
        if (patch.texture !== undefined) {
            this._patchTexture(next, this._readRecord(patch.texture, 'texture'));
        }
        if (patch.spriteFrame !== undefined) {
            this._patchSpriteFrame(next, this._readRecord(patch.spriteFrame, 'spriteFrame'));
        }
        this._meta = next;
    }

    /**
     * @description 返回图片 meta 的独立内存副本，供 AssetDB 提交，不写源或缓存。
     * @returns meta 副本。
     */
    public getNativeMetaSnapshot(): Record<string, unknown> {
        return this._cloneRecord(this._meta);
    }

    /**
     * @description 原子写回图片 `.meta`，不改图片源文件与缓存目录。
     * @param projectRoot Creator 项目根
     * @param writeMetaIfMissing 图片必须已有 meta；该参数仅用于统一文档契约
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        void writeMetaIfMissing;
        void cocosVersion;
        const absolutePath = join(projectRoot, this._relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_image_missing:${this._relativePath}`);
        }
        LumenAtomicFileWriter.writeUtf8(`${absolutePath}.meta`, `${JSON.stringify(this._meta, null, 2)}\n`);
    }

    /**
     * @description 写入图片顶层 Importer 设置。仅写 `userData.type`，不在此重建 `subMetas`（交由 refresh 处理）。
     * @param meta 待修改的 meta
     * @param patch 已校验为对象的补丁
     */
    private _patchImage(meta: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        const fields = ['type', ...LumenImageMetaDocument._imageBooleanFields, 'presetId', 'compressSettings'];
        this._assertOnlyFields(patch, fields, 'image');
        const userData = this._readRecord(meta.userData, 'image.userData');
        if (patch.compressSettings !== undefined) {
            this._compressSettings.applyPatch(
                userData,
                this._readRecord(patch.compressSettings, 'image.compressSettings'),
                'lumen_image',
            );
        }
        if (patch.type !== undefined) {
            userData.type = this._requireStringEnum(patch.type, 'image.type', LumenImageMetaDocument._imageTypeValues);
        }
        for (const key of LumenImageMetaDocument._imageBooleanFields) {
            const value = patch[key];
            if (value === undefined) {
                continue;
            }
            userData[key] = this._requireBoolean(value, `image.${key}`);
        }
        if (patch.presetId !== undefined) {
            const presetId = this._requireString0(patch.presetId, 'image.presetId');
            if (presetId.length === 0) {
                delete userData.presetId;
            } else {
                userData.presetId = presetId;
            }
        }
        this._compressSettings.syncTopLevelScalars(userData);
    }

    /**
     * @description 写入 Texture 子资源设置。
     * @param meta 待修改的 meta
     * @param patch 已校验为对象的补丁
     */
    private _patchTexture(meta: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        const fields = ['wrapModeS', 'wrapModeT', 'minfilter', 'magfilter', 'mipfilter', 'anisotropy', 'filterMode'];
        this._assertOnlyFields(patch, fields, 'texture');
        const expanded = LumenTextureFilterModeCodec.expandPatch(patch);
        const subMeta = LumenImageMetaDocument._findSubMeta(meta, 'texture', this._relativePath);
        const userData = this._readRecord(subMeta.userData, 'texture.userData');
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
     * @description 写入 SpriteFrame 子资源设置。写入 `trimX` / `trimY` / `width` / `height` 任意一项时，
     * 会自动把 `trimType` 置为 `custom`（即便补丁中同时给出了其它 `trimType` 取值，也以 `custom` 为准），
     * 因为这些字段只有在 `trimType: custom` 下才对 Creator 生效。
     * @param meta 待修改的 meta
     * @param patch 已校验为对象的补丁
     */
    private _patchSpriteFrame(meta: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        const fields = [
            'trimThreshold',
            'borderTop',
            'borderBottom',
            'borderLeft',
            'borderRight',
            'packable',
            'pixelsToUnit',
            'pivotX',
            'pivotY',
            'meshType',
            'trimType',
            ...LumenImageMetaDocument._spriteFrameTrimRectFields,
        ];
        this._assertOnlyFields(patch, fields, 'spriteFrame');
        const subMeta = LumenImageMetaDocument._findSubMeta(meta, 'sprite-frame', this._relativePath);
        const userData = this._readRecord(subMeta.userData, 'spriteFrame.userData');
        for (const key of fields) {
            const value = patch[key];
            if (value === undefined) {
                continue;
            }
            if (key === 'packable') {
                userData[key] = this._requireBoolean(value, `spriteFrame.${key}`);
            } else if (key === 'trimType') {
                userData[key] = this._requireString(value, `spriteFrame.${key}`);
            } else if (key === 'pivotX' || key === 'pivotY' || key === 'trimThreshold') {
                userData[key] = this._requireRange(value, `spriteFrame.${key}`, 0, 1, false);
            } else {
                userData[key] = this._requireRange(value, `spriteFrame.${key}`, 0, Number.MAX_SAFE_INTEGER, true);
            }
        }
        if (LumenImageMetaDocument._spriteFrameTrimRectFields.some((key) => patch[key] !== undefined)) {
            userData.trimType = 'custom';
        }
    }

    /**
     * @description 查找指定 importer 的必需子资源。
     * @param meta Creator meta
     * @param importer 子资源 importer
     * @param relativePath 诊断路径
     * @returns 子资源 meta
     */
    private static _findSubMeta(
        meta: Readonly<Record<string, unknown>>,
        importer: string,
        relativePath: string,
    ): Record<string, unknown> {
        const found = LumenImageMetaDocument._findOptionalSubMeta(meta, importer);
        if (found == null) {
            throw new Error(`lumen_image_submeta_missing:${importer}:${relativePath}`);
        }
        return found;
    }

    /**
     * @description 查找指定 importer 的可选子资源。
     * @param meta Creator meta
     * @param importer 子资源 importer
     * @returns 子资源 meta 或 `null`
     */
    private static _findOptionalSubMeta(
        meta: Readonly<Record<string, unknown>>,
        importer: string,
    ): Record<string, unknown> | null {
        const subMetas = meta.subMetas;
        if (subMetas == null || typeof subMetas !== 'object' || Array.isArray(subMetas)) {
            return null;
        }
        for (const value of Object.values(subMetas as Record<string, unknown>)) {
            if (value != null && typeof value === 'object' && !Array.isArray(value)) {
                const record = value as Record<string, unknown>;
                if (record.importer === importer) {
                    return record;
                }
            }
        }
        return null;
    }

    /**
     * @description 读取对象值。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 对象记录
     */
    private _readRecord(value: unknown, fieldName: string): Record<string, unknown> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`lumen_image_property_type:${fieldName}:object`);
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 读取快照字符串，缺失时返回空串。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _readString(value: unknown, fieldName: string): string {
        return value === undefined ? '' : this._requireString(value, fieldName);
    }

    /**
     * @description 读取快照布尔值，缺失时返回 false。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 布尔值
     */
    private _readBoolean(value: unknown, fieldName: string): boolean {
        return value === undefined ? false : this._requireBoolean(value, fieldName);
    }

    /**
     * @description 读取快照数字，缺失时返回零。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 数字
     */
    private _readNumber(value: unknown, fieldName: string): number {
        if (value === undefined) {
            return 0;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`lumen_image_property_type:${fieldName}:number`);
        }
        return value;
    }

    /**
     * @description 校验非空字符串。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _requireString(value: unknown, fieldName: string): string {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`lumen_image_property_type:${fieldName}:string`);
        }
        return value;
    }

    /**
     * @description 校验允许为空串的字符串（用于 `emptyDeletes` 字段）。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _requireString0(value: unknown, fieldName: string): string {
        if (typeof value !== 'string') {
            throw new Error(`lumen_image_property_type:${fieldName}:string`);
        }
        return value;
    }

    /**
     * @description 校验字符串枚举取值。
     * @param value 未受信值
     * @param fieldName 字段名
     * @param allowed 允许取值
     * @returns 已校验字符串
     */
    private _requireStringEnum(value: unknown, fieldName: string, allowed: readonly string[]): string {
        if (typeof value !== 'string' || !allowed.includes(value)) {
            throw new Error(`lumen_image_property_range:${fieldName}:${allowed.join('|')}`);
        }
        return value;
    }

    /**
     * @description 校验布尔值。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 布尔值
     */
    private _requireBoolean(value: unknown, fieldName: string): boolean {
        if (typeof value !== 'boolean') {
            throw new Error(`lumen_image_property_type:${fieldName}:boolean`);
        }
        return value;
    }

    /**
     * @description 校验有限数字范围。
     * @param value 未受信值
     * @param fieldName 字段名
     * @param minimum 最小值
     * @param maximum 最大值
     * @param integer 是否要求整数
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
            throw new Error(`lumen_image_property_range:${fieldName}:${minimum}..${maximum}`);
        }
        return value;
    }

    /**
     * @description 拒绝不在白名单内的补丁字段。
     * @param value 补丁
     * @param allowed 允许字段
     * @param scope 补丁分组
     */
    private _assertOnlyFields(
        value: Readonly<Record<string, unknown>>,
        allowed: readonly string[],
        scope: string,
    ): void {
        const allowedSet = new Set(allowed);
        for (const key of Object.keys(value)) {
            if (!allowedSet.has(key)) {
                throw new Error(`lumen_image_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`);
            }
        }
    }

    /**
     * @description 深拷贝 JSON 记录，使失败补丁不污染当前文档。
     * @param value JSON 记录
     * @returns 深拷贝
     */
    private _cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    }
}
