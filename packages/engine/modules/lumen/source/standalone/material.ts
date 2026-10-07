import { CompatibleUuid } from '@peanut/pod-engine/assets';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenMetaImporterVersions } from '../schema/meta-importer-versions';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description Creator 3.8 内置 builtin-unlit effect（`default.mtl`）。
 */
const BUILTIN_UNLIT_EFFECT_UUID = 'c8f66d17-351a-48da-a12c-0212d28575c4';

/**
 * @description Creator 3.8 内置 builtin-standard effect（`default-material.mtl`）。
 */
const BUILTIN_STANDARD_EFFECT_UUID = '1baf0fc9-befa-459c-8bdd-af1a450a0319';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(@[0-9a-z]+)?$/i;

/**
 * @description 材质 Inspector 快照。
 */
export interface ILumenMaterialInspect {
    /**
     * @description 项目相对路径。
     */
    readonly path: string;

    /**
     * @description 资产种类。
     */
    readonly kind: 'material';

    /**
     * @description `_name`。
     */
    readonly name: string;

    /**
     * @description Effect 资源 uuid；未绑定时为 `null`。
     */
    readonly effectAsset: string | null;

    /**
     * @description technique 下标（`_techIdx`）。
     */
    readonly technique: number;

    /**
     * @description 各 pass 宏定义。
     */
    readonly defines: readonly Readonly<Record<string, unknown>>[];

    /**
     * @description 各 pass 材质参数（贴图 uuid 已解码为字符串）。
     */
    readonly props: readonly Readonly<Record<string, unknown>>[];

    /**
     * @description 各 pass 渲染状态。
     */
    readonly states: readonly Readonly<Record<string, unknown>>[];
}

/**
 * @description `.mtl` 文档：Inspector 对齐的 effect / technique / defines / props 读写。
 */
export class LumenMaterialDocument {
    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description 序列化对象。 */
    private readonly _record: Record<string, unknown>;

    /**
     * @description 从已有记录创建文档。
     * @param relativePath 相对路径
     * @param record 材质 JSON
     */
    public constructor(relativePath: string, record: Record<string, unknown>) {
        this._relativePath = relativePath;
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
     * @returns `material`
     */
    public get kind(): 'material' {
        return 'material';
    }

    /**
     * @description 创建空材质。
     * @param relativePath 相对路径
     * @param name 材质名
     * @param template `empty`（unlit）或 `standard`（PBR）
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenMaterialDocument {
        const trimmed = name.trim();
        if (template === 'standard') {
            return new LumenMaterialDocument(relativePath, {
                __type__: 'cc.Material',
                _name: trimmed,
                _objFlags: 0,
                _native: '',
                _effectAsset: {
                    __uuid__: BUILTIN_STANDARD_EFFECT_UUID,
                    __expectedType__: 'cc.EffectAsset',
                },
                _techIdx: 0,
                _defines: [{}],
                _states: [],
                _props: [{ roughness: 0.8, metallic: 0.6 }],
            });
        }
        if (template !== 'empty') {
            throw new Error(`lumen_material_template_unknown:${template}`);
        }
        return new LumenMaterialDocument(relativePath, {
            __type__: 'cc.Material',
            _name: trimmed,
            _objFlags: 0,
            _native: '',
            _effectAsset: {
                __uuid__: BUILTIN_UNLIT_EFFECT_UUID,
                __expectedType__: 'cc.EffectAsset',
            },
            _techIdx: 0,
            _defines: [],
            _states: [],
            _props: [],
        });
    }

    /**
     * @description 从磁盘打开 `.mtl`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenMaterialDocument {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_material_missing:${relativePath}`);
        }
        const parsed: unknown = JSON.parse(readFileSync(absolutePath, 'utf8'));
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`lumen_material_json_corrupt:${relativePath}`);
        }
        const record = parsed as Record<string, unknown>;
        if (record.__type__ !== 'cc.Material') {
            throw new Error(`lumen_material_json_corrupt:${relativePath}`);
        }
        return new LumenMaterialDocument(relativePath, record);
    }

    /**
     * @description 检视公开字段。
     * @param query 材质不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenMaterialInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'material');
        return {
            path: this._relativePath,
            kind: 'material',
            name: typeof this._record._name === 'string' ? this._record._name : '',
            effectAsset: this._readUuid(this._record._effectAsset),
            technique: typeof this._record._techIdx === 'number' ? this._record._techIdx : 0,
            defines: this._clonePassObjects(this._record._defines),
            props: this._clonePassObjects(this._record._props).map((pass) => this._decodePropPass(pass)),
            states: this._clonePassObjects(this._record._states),
        };
    }

    /**
     * @description 写入 Inspector 公开补丁。
     * @param patch `name` / `effectAsset` / `technique` / `defines` / `props` / `states`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        for (const key of Object.keys(patch)) {
            if (!['name', 'effectAsset', 'technique', 'defines', 'props', 'states'].includes(key)) {
                throw new Error(
                    `lumen_material_property_not_editable:${key}:allowed=name,effectAsset,technique,defines,props,states`,
                );
            }
        }
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_property_type:name:string');
            }
            this._record._name = patch.name;
        }
        if (patch.effectAsset !== undefined) {
            this._record._effectAsset = this._encodeEffectAsset(patch.effectAsset);
        }
        if (patch.technique !== undefined) {
            if (typeof patch.technique !== 'number' || !Number.isInteger(patch.technique) || patch.technique < 0) {
                throw new Error('lumen_property_type:technique:int>=0');
            }
            this._record._techIdx = patch.technique;
        }
        if (patch.defines !== undefined) {
            this._record._defines = this._mergePassObjects(this._record._defines, patch.defines, 'defines', false);
        }
        if (patch.states !== undefined) {
            this._record._states = this._mergePassObjects(this._record._states, patch.states, 'states', false);
        }
        if (patch.props !== undefined) {
            this._record._props = this._mergePassObjects(this._record._props, patch.props, 'props', true);
        }
    }

    /**
     * @description 写回磁盘与最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建；为 true 时同时校正错误的 importer `ver`
     * @param cocosVersion Creator 版本（决定 material meta `ver`）
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
        const absolutePath = join(projectRoot, this._relativePath);
        mkdirSync(dirname(absolutePath), { recursive: true });
        LumenAtomicFileWriter.writeUtf8(absolutePath, `${JSON.stringify(this._record, null, 2)}\n`);
        if (writeMetaIfMissing) {
            this._ensureMaterialMeta(`${absolutePath}.meta`, cocosVersion);
        }
    }

    /**
     * @description 写入或校正材质 `.meta`（`ver` 来自当前 Creator 版本策展表）。
     * @param metaPath `.mtl.meta` 绝对路径
     * @param cocosVersion Creator 版本
     * @returns 无返回值
     */
    private _ensureMaterialMeta(metaPath: string, cocosVersion: LumenCocosVersion): void {
        const materialMetaVer = LumenMetaImporterVersions.shared().resolve(cocosVersion, 'material');
        let uuid: string = CompatibleUuid.create();
        let imported = false;
        let files: unknown[] = [];
        let subMetas: Record<string, unknown> = {};
        let userData: Record<string, unknown> = {};
        if (existsSync(metaPath)) {
            try {
                const existing = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
                if (typeof existing.uuid === 'string' && existing.uuid.length > 0) {
                    uuid = existing.uuid;
                }
                if (typeof existing.imported === 'boolean') {
                    imported = existing.imported;
                }
                if (Array.isArray(existing.files)) {
                    files = existing.files;
                }
                if (existing.subMetas != null && typeof existing.subMetas === 'object' && !Array.isArray(existing.subMetas)) {
                    subMetas = existing.subMetas as Record<string, unknown>;
                }
                if (existing.userData != null && typeof existing.userData === 'object' && !Array.isArray(existing.userData)) {
                    userData = existing.userData as Record<string, unknown>;
                }
                if (
                    existing.ver === materialMetaVer &&
                    existing.importer === 'material' &&
                    typeof existing.uuid === 'string'
                ) {
                    return;
                }
            } catch {
                // 损坏 meta 直接重写
            }
        }
        LumenAtomicFileWriter.writeUtf8(
            metaPath,
            `${JSON.stringify(
                {
                    ver: materialMetaVer,
                    importer: 'material',
                    imported,
                    uuid,
                    files,
                    subMetas,
                    userData,
                },
                null,
                2,
            )}\n`,
        );
    }

    /**
     * @description 读取 `{ __uuid__ }`。
     * @param value 序列化值
     * @returns uuid 或 `null`
     */
    private _readUuid(value: unknown): string | null {
        if (value == null) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            const uuid = (value as { __uuid__?: unknown }).__uuid__;
            return typeof uuid === 'string' ? uuid : null;
        }
        return null;
    }

    /**
     * @description 编码 effect 引用。
     * @param value uuid 或 `null`
     * @returns 序列化值
     */
    private _encodeEffectAsset(value: unknown): Record<string, unknown> | null {
        if (value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('lumen_property_type:effectAsset:uuid');
        }
        return { __uuid__: value.trim(), __expectedType__: 'cc.EffectAsset' };
    }

    /**
     * @description 复制 pass 对象数组。
     * @param raw `_defines` / `_props` / `_states`
     * @returns 对象列表
     */
    private _clonePassObjects(raw: unknown): Array<Record<string, unknown>> {
        if (!Array.isArray(raw)) {
            return [];
        }
        const out: Array<Record<string, unknown>> = [];
        for (const item of raw) {
            if (item != null && typeof item === 'object' && !Array.isArray(item)) {
                out.push({ ...(item as Record<string, unknown>) });
            } else {
                out.push({});
            }
        }
        return out;
    }

    /**
     * @description 解码单 pass 参数（贴图 uuid → 字符串）。
     * @param pass pass 对象
     * @returns 公开参数
     */
    private _decodePropPass(pass: Readonly<Record<string, unknown>>): Record<string, unknown> {
        const decoded: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(pass)) {
            const uuid = this._readUuid(value);
            decoded[key] = uuid ?? value;
        }
        return decoded;
    }

    /**
     * @description 对象补丁合并进 pass[0]，或整表替换。
     * @param existing 当前数组
     * @param incoming 对象或数组
     * @param apiName 属性名
     * @param encodeProps 是否按材质参数编码
     * @returns 新数组
     */
    private _mergePassObjects(
        existing: unknown,
        incoming: unknown,
        apiName: string,
        encodeProps: boolean,
    ): Array<Record<string, unknown>> {
        if (Array.isArray(incoming)) {
            return incoming.map((item, index) => {
                if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                    throw new Error(`lumen_property_type:${apiName}[${index}]:object`);
                }
                const record = item as Record<string, unknown>;
                return encodeProps ? this._encodePropPass(record) : { ...record };
            });
        }
        if (incoming == null || typeof incoming !== 'object') {
            throw new Error(`lumen_property_type:${apiName}:object_or_array`);
        }
        const current = this._clonePassObjects(existing);
        const first = current[0] ?? {};
        const patch = incoming as Record<string, unknown>;
        const merged = encodeProps
            ? { ...first, ...this._encodePropPass(patch) }
            : { ...first, ...patch };
        if (current.length === 0) {
            return [merged];
        }
        current[0] = merged;
        return current;
    }

    /**
     * @description 编码材质参数：uuid 字符串与颜色简写。
     * @param pass 公开参数
     * @returns 序列化 pass
     */
    private _encodePropPass(pass: Readonly<Record<string, unknown>>): Record<string, unknown> {
        const encoded: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(pass)) {
            encoded[key] = this._encodePropValue(value);
        }
        return encoded;
    }

    /**
     * @description 编码单个材质参数值。
     * @param value 公开值
     * @returns 序列化值
     */
    private _encodePropValue(value: unknown): unknown {
        if (typeof value === 'string' && UUID_PATTERN.test(value)) {
            return { __uuid__: value };
        }
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (typeof record.__uuid__ === 'string' || typeof record.__type__ === 'string') {
                return { ...record };
            }
            if (
                typeof record.r === 'number' &&
                typeof record.g === 'number' &&
                typeof record.b === 'number' &&
                typeof record.a === 'number'
            ) {
                return { __type__: 'cc.Color', r: record.r, g: record.g, b: record.b, a: record.a };
            }
        }
        return value;
    }
}
