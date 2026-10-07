import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

const MODEL_IMPORTERS = ['fbx', 'gltf', 'glb'] as const;
const ANIMATION_BAKE_RATES = [0, 24, 25, 30, 60] as const;

/**
 * @description 模型 Inspector Model 页。
 */
export interface ILumenModelMeshInspect {
    /** @description 法线导入模式。 */
    readonly normals: number;
    /** @description 切线导入模式。 */
    readonly tangents: number;
    /** @description Morph 法线导入模式。 */
    readonly morphNormals: number;
    /** @description 是否跳过校验。 */
    readonly skipValidation: boolean;
    /** @description 是否禁用网格拆分。 */
    readonly disableMeshSplit: boolean;
    /** @description 是否允许运行时读网格数据。 */
    readonly allowMeshDataAccess: boolean;
    /** @description 缺失时是否补顶点色。 */
    readonly addVertexColor: boolean;
    /** @description 单根节点是否提升为 Prefab 根。 */
    readonly promoteSingleRootNode: boolean;
    /** @description 是否生成 Lightmap UV。 */
    readonly generateLightmapUVNode: boolean;
}

/**
 * @description 模型 Inspector FBX 页。
 */
export interface ILumenModelFbxInspect {
    /** @description 动画烘焙帧率；`0` 为 auto。 */
    readonly animationBakeRate: number;
    /** @description 是否优先使用文件内时间范围。 */
    readonly preferLocalTimeSpan: boolean;
    /** @description 是否启用智能材质转换。 */
    readonly smartMaterialEnabled: boolean;
    /** @description 是否使用旧版 FBX Importer。 */
    readonly legacyFbxImporter: boolean;
}

/**
 * @description 模型 Inspector Material 页。
 */
export interface ILumenModelMaterialInspect {
    /** @description 是否抽出材质到工程。 */
    readonly dumpMaterials: boolean;
    /** @description 抽出目录 db URL；未设时为空串。 */
    readonly materialDumpDir: string;
    /** @description 材质是否使用顶点色。 */
    readonly useVertexColors: boolean;
    /** @description Alpha Blend 时是否写深度。 */
    readonly depthWriteInAlphaModeBlend: boolean;
}

/**
 * @description 模型子资源摘要，供绑定 uuid。
 */
export interface ILumenModelSubAssetInspect {
    /** @description subMetas 键。 */
    readonly id: string;
    /** @description 子资源 importer。 */
    readonly importer: string;
    /** @description 子资源 uuid。 */
    readonly uuid: string;
    /** @description 子资源名。 */
    readonly name: string;
    /** @description 显示名。 */
    readonly displayName: string;
}

/**
 * @description 模型内嵌图映射。
 */
export interface ILumenModelImageMetaInspect {
    /** @description 下标。 */
    readonly index: number;
    /** @description 内嵌图名。 */
    readonly name: string;
    /** @description 原始 uri 或 uuid。 */
    readonly uri: string;
    /** @description 重映射目标 uuid；未绑定时为空串。 */
    readonly remap: string;
}

/**
 * @description FBX / glTF `.meta` Inspector 快照。
 */
export interface ILumenModelMetaInspect {
    /** @description 模型项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'model';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description Model 页。 */
    readonly model: ILumenModelMeshInspect;
    /** @description FBX 页。 */
    readonly fbx: ILumenModelFbxInspect;
    /** @description Material 页。 */
    readonly material: ILumenModelMaterialInspect;
    /** @description 子资源列表。 */
    readonly subAssets: readonly ILumenModelSubAssetInspect[];
    /** @description 内嵌图 remap。 */
    readonly imageMetas: readonly ILumenModelImageMetaInspect[];
}

/**
 * @description `.fbx` / `.gltf` / `.glb` 的 Creator `.meta` 文档。
 */
export class LumenModelMetaDocument {
    /** @description 模型项目相对路径。 */
    private readonly _relativePath: string;

    /** @description Creator meta 记录。 */
    private _meta: Record<string, unknown>;

    /**
     * @description 从已校验的模型 meta 创建文档。
     * @param relativePath 模型项目相对路径
     * @param meta Creator meta 记录
     */
    public constructor(relativePath: string, meta: Record<string, unknown>) {
        this._relativePath = relativePath;
        this._meta = meta;
    }

    /**
     * @description 相对项目根的模型路径。
     * @returns 模型路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 资产种类。
     * @returns `model`
     */
    public get kind(): 'model' {
        return 'model';
    }

    /**
     * @description 从磁盘打开模型及其 `.meta`。
     * @param projectRoot Creator 项目根
     * @param relativePath 模型项目相对路径
     * @returns 模型 meta 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenModelMetaDocument {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_model_missing:${relativePath}`);
        }
        const metaPath = `${absolutePath}.meta`;
        if (!existsSync(metaPath)) {
            throw new Error(`lumen_model_meta_missing:${relativePath}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
        } catch {
            throw new Error(`lumen_model_meta_corrupt:${relativePath}`);
        }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`lumen_model_meta_corrupt:${relativePath}`);
        }
        const meta = parsed as Record<string, unknown>;
        if (typeof meta.importer !== 'string' || !LumenModelMetaDocument._isModelImporter(meta.importer)) {
            throw new Error(`lumen_model_meta_corrupt:${relativePath}`);
        }
        return new LumenModelMetaDocument(relativePath, meta);
    }

    /**
     * @description 读取 Model / FBX / Material 页与子资源。
     * @param query 模型不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenModelMetaInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'model');
        const userData = this._readOptionalRecord(this._meta.userData);
        const fbx = this._readOptionalRecord(userData.fbx);
        return {
            path: this._relativePath,
            kind: 'model',
            uuid: this._readString(this._meta.uuid, 'uuid'),
            importer: this._readString(this._meta.importer, 'importer'),
            model: {
                normals: this._readNumber(userData.normals, 2),
                tangents: this._readNumber(userData.tangents, 2),
                morphNormals: this._readNumber(userData.morphNormals, 1),
                skipValidation: this._readBoolean(userData.skipValidation, true),
                disableMeshSplit: this._readBoolean(userData.disableMeshSplit, true),
                allowMeshDataAccess: this._readBoolean(userData.allowMeshDataAccess, true),
                addVertexColor: this._readBoolean(userData.addVertexColor, false),
                promoteSingleRootNode: this._readBoolean(userData.promoteSingleRootNode, false),
                generateLightmapUVNode: this._readBoolean(userData.generateLightmapUVNode, false),
            },
            fbx: {
                animationBakeRate: this._readNumber(fbx.animationBakeRate, 0),
                preferLocalTimeSpan: this._readBoolean(fbx.preferLocalTimeSpan, true),
                smartMaterialEnabled: this._readBoolean(fbx.smartMaterialEnabled, false),
                legacyFbxImporter: this._readBoolean(userData.legacyFbxImporter, false),
            },
            material: {
                dumpMaterials: this._readBoolean(userData.dumpMaterials, false),
                materialDumpDir: typeof userData.materialDumpDir === 'string' ? userData.materialDumpDir : '',
                useVertexColors: this._readBoolean(userData.useVertexColors, false),
                depthWriteInAlphaModeBlend: this._readBoolean(userData.depthWriteInAlphaModeBlend, false),
            },
            subAssets: this._readSubAssets(),
            imageMetas: this._readImageMetas(userData.imageMetas),
        };
    }

    /**
     * @description 写入 Model / FBX / Material 设置或内嵌图 remap。
     * @param patch `model` / `fbx` / `material` / `imageMetas`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['model', 'fbx', 'material', 'imageMetas'], 'model');
        const next = this._cloneRecord(this._meta);
        const userData = this._ensureRecord(next, 'userData');
        if (patch.model !== undefined) {
            this._patchModel(userData, this._readRecord(patch.model, 'model'));
        }
        if (patch.fbx !== undefined) {
            this._patchFbx(userData, this._readRecord(patch.fbx, 'fbx'));
        }
        if (patch.material !== undefined) {
            this._patchMaterial(userData, this._readRecord(patch.material, 'material'));
        }
        if (patch.imageMetas !== undefined) {
            this._patchImageMetas(userData, patch.imageMetas);
        }
        this._meta = next;
    }

    /**
     * @description 返回模型 meta 的独立内存副本，供 AssetDB 提交，不写源或缓存。
     * @returns meta 副本。
     */
    public getNativeMetaSnapshot(): Record<string, unknown> {
        return this._cloneRecord(this._meta);
    }

    /**
     * @description 原子写回模型 `.meta`，不改模型源与缓存目录。
     * @param projectRoot Creator 项目根
     * @param writeMetaIfMissing 模型必须已有 meta
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
            throw new Error(`lumen_model_missing:${this._relativePath}`);
        }
        LumenAtomicFileWriter.writeUtf8(`${absolutePath}.meta`, `${JSON.stringify(this._meta, null, 2)}\n`);
    }

    /**
     * @description 写入 Model 页字段。
     * @param userData meta.userData
     * @param patch 已校验对象
     */
    private _patchModel(userData: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        const intFields = ['normals', 'tangents', 'morphNormals'] as const;
        const boolFields = [
            'skipValidation',
            'disableMeshSplit',
            'allowMeshDataAccess',
            'addVertexColor',
            'promoteSingleRootNode',
            'generateLightmapUVNode',
        ] as const;
        this._assertOnlyFields(patch, [...intFields, ...boolFields], 'model');
        for (const key of intFields) {
            const value = patch[key];
            if (value !== undefined) {
                userData[key] = this._requireRange(value, `model.${key}`, 0, 3, true);
            }
        }
        for (const key of boolFields) {
            const value = patch[key];
            if (value !== undefined) {
                userData[key] = this._requireBoolean(value, `model.${key}`);
            }
        }
    }

    /**
     * @description 写入 FBX 页字段。
     * @param userData meta.userData
     * @param patch 已校验对象
     */
    private _patchFbx(userData: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(
            patch,
            ['animationBakeRate', 'preferLocalTimeSpan', 'smartMaterialEnabled', 'legacyFbxImporter'],
            'fbx',
        );
        if (patch.legacyFbxImporter !== undefined) {
            userData.legacyFbxImporter = this._requireBoolean(patch.legacyFbxImporter, 'fbx.legacyFbxImporter');
        }
        const fbx = this._ensureRecord(userData, 'fbx');
        if (patch.animationBakeRate !== undefined) {
            const rate = this._requireRange(patch.animationBakeRate, 'fbx.animationBakeRate', 0, 60, true);
            if (!LumenModelMetaDocument._isAnimationBakeRate(rate)) {
                throw new Error('lumen_model_property_range:fbx.animationBakeRate:0|24|25|30|60');
            }
            fbx.animationBakeRate = rate;
        }
        if (patch.preferLocalTimeSpan !== undefined) {
            fbx.preferLocalTimeSpan = this._requireBoolean(patch.preferLocalTimeSpan, 'fbx.preferLocalTimeSpan');
        }
        if (patch.smartMaterialEnabled !== undefined) {
            fbx.smartMaterialEnabled = this._requireBoolean(patch.smartMaterialEnabled, 'fbx.smartMaterialEnabled');
        }
    }

    /**
     * @description 写入 Material 页字段。
     * @param userData meta.userData
     * @param patch 已校验对象
     */
    private _patchMaterial(userData: Record<string, unknown>, patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(
            patch,
            ['dumpMaterials', 'materialDumpDir', 'useVertexColors', 'depthWriteInAlphaModeBlend'],
            'material',
        );
        if (patch.dumpMaterials !== undefined) {
            userData.dumpMaterials = this._requireBoolean(patch.dumpMaterials, 'material.dumpMaterials');
        }
        if (patch.materialDumpDir !== undefined) {
            if (typeof patch.materialDumpDir !== 'string') {
                throw new Error('lumen_model_property_type:material.materialDumpDir:string');
            }
            userData.materialDumpDir = patch.materialDumpDir;
        }
        if (patch.useVertexColors !== undefined) {
            userData.useVertexColors = this._requireBoolean(patch.useVertexColors, 'material.useVertexColors');
        }
        if (patch.depthWriteInAlphaModeBlend !== undefined) {
            userData.depthWriteInAlphaModeBlend = this._requireBoolean(
                patch.depthWriteInAlphaModeBlend,
                'material.depthWriteInAlphaModeBlend',
            );
        }
    }

    /**
     * @description 按 index 或 name 写入内嵌图 remap。
     * @param userData meta.userData
     * @param patch 列表
     */
    private _patchImageMetas(userData: Record<string, unknown>, patch: unknown): void {
        if (!Array.isArray(patch)) {
            throw new Error('lumen_model_property_type:imageMetas:array');
        }
        const current = this._ensureImageMetaList(userData);
        for (let index = 0; index < patch.length; index += 1) {
            const item = patch[index];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_model_property_type:imageMetas[${index}]:object`);
            }
            const record = item as Record<string, unknown>;
            this._assertOnlyFields(record, ['index', 'name', 'remap'], `imageMetas[${index}]`);
            const target = this._findImageMeta(current, record, index);
            if (record.remap === undefined) {
                throw new Error(`lumen_model_property_type:imageMetas[${index}].remap:string`);
            }
            if (record.remap !== null && typeof record.remap !== 'string') {
                throw new Error(`lumen_model_property_type:imageMetas[${index}].remap:string`);
            }
            target.remap = record.remap ?? '';
        }
    }

    /**
     * @description 定位要改的内嵌图项。
     * @param current 现有列表
     * @param record 补丁项
     * @param patchIndex 补丁下标
     * @returns 目标记录
     */
    private _findImageMeta(
        current: Array<Record<string, unknown>>,
        record: Readonly<Record<string, unknown>>,
        patchIndex: number,
    ): Record<string, unknown> {
        if (typeof record.index === 'number') {
            const found = current[record.index];
            if (found == null) {
                throw new Error(`lumen_model_image_meta_missing:${record.index}`);
            }
            return found;
        }
        if (typeof record.name === 'string' && record.name.length > 0) {
            const found = current.find((item) => item.name === record.name);
            if (found == null) {
                throw new Error(`lumen_model_image_meta_missing:${record.name}`);
            }
            return found;
        }
        throw new Error(`lumen_model_property_type:imageMetas[${patchIndex}]:index_or_name`);
    }

    /**
     * @description 读取子资源列表。
     * @returns 子资源摘要
     */
    private _readSubAssets(): ILumenModelSubAssetInspect[] {
        const subMetas = this._meta.subMetas;
        if (subMetas == null || typeof subMetas !== 'object' || Array.isArray(subMetas)) {
            return [];
        }
        const out: ILumenModelSubAssetInspect[] = [];
        for (const [id, value] of Object.entries(subMetas as Record<string, unknown>)) {
            if (value == null || typeof value !== 'object' || Array.isArray(value)) {
                continue;
            }
            const record = value as Record<string, unknown>;
            out.push({
                id,
                importer: typeof record.importer === 'string' ? record.importer : '',
                uuid: typeof record.uuid === 'string' ? record.uuid : '',
                name: typeof record.name === 'string' ? record.name : '',
                displayName: typeof record.displayName === 'string' ? record.displayName : '',
            });
        }
        return out;
    }

    /**
     * @description 读取内嵌图列表。
     * @param raw userData.imageMetas
     * @returns 映射列表
     */
    private _readImageMetas(raw: unknown): ILumenModelImageMetaInspect[] {
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.map((item, index) => {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                return { index, name: '', uri: '', remap: '' };
            }
            const record = item as Record<string, unknown>;
            return {
                index,
                name: typeof record.name === 'string' ? record.name : String(index),
                uri: typeof record.uri === 'string' ? record.uri : '',
                remap: typeof record.remap === 'string' ? record.remap : '',
            };
        });
    }

    /**
     * @description 确保 imageMetas 为对象数组。
     * @param userData meta.userData
     * @returns 可写列表
     */
    private _ensureImageMetaList(userData: Record<string, unknown>): Array<Record<string, unknown>> {
        if (!Array.isArray(userData.imageMetas)) {
            throw new Error('lumen_model_image_meta_missing');
        }
        const list: Array<Record<string, unknown>> = [];
        for (const item of userData.imageMetas) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error('lumen_model_image_meta_missing');
            }
            list.push(item as Record<string, unknown>);
        }
        userData.imageMetas = list;
        return list;
    }

    /**
     * @description 判断 importer 是否为模型。
     * @param importer meta.importer
     * @returns 是否模型 importer
     */
    private static _isModelImporter(importer: string): boolean {
        for (const allowed of MODEL_IMPORTERS) {
            if (allowed === importer) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description 判断动画烘焙帧率是否为 Creator 合法值。
     * @param rate 已校验整数
     * @returns 是否 `0|24|25|30|60`
     */
    private static _isAnimationBakeRate(rate: number): boolean {
        for (const allowed of ANIMATION_BAKE_RATES) {
            if (allowed === rate) {
                return true;
            }
        }
        return false;
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
     * @description 读取可选对象，缺失时返回空对象。
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
            throw new Error(`lumen_model_property_type:${fieldName}:object`);
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 读取快照字符串。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 字符串
     */
    private _readString(value: unknown, fieldName: string): string {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`lumen_model_property_type:${fieldName}:string`);
        }
        return value;
    }

    /**
     * @description 读取快照布尔值。
     * @param value 未受信值
     * @param fallback 缺省
     * @returns 布尔值
     */
    private _readBoolean(value: unknown, fallback: boolean): boolean {
        return typeof value === 'boolean' ? value : fallback;
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
     * @description 校验布尔值。
     * @param value 未受信值
     * @param fieldName 字段名
     * @returns 布尔值
     */
    private _requireBoolean(value: unknown, fieldName: string): boolean {
        if (typeof value !== 'boolean') {
            throw new Error(`lumen_model_property_type:${fieldName}:boolean`);
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
            throw new Error(`lumen_model_property_range:${fieldName}:${minimum}..${maximum}`);
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
                throw new Error(`lumen_model_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`);
            }
        }
    }

    /**
     * @description 深拷贝 JSON 记录。
     * @param value JSON 记录
     * @returns 深拷贝
     */
    private _cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    }
}
