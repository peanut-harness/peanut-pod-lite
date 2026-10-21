import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description Animation Mask 关节项。
 */
export interface ILumenAnimationMaskJointInspect {
    /** @description 关节路径。 */
    readonly path: string;
    /** @description 是否启用该关节的动画。 */
    readonly enabled: boolean;
}

/**
 * @description Animation Mask Inspector 快照。不展开骨架树 UI。
 */
export interface ILumenAnimationMaskInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'animationMask';
    /** @description `_name`。 */
    readonly name: string;
    /** @description 关节遮罩列表。 */
    readonly joints: readonly ILumenAnimationMaskJointInspect[];
}

/**
 * @description `.animask` 文档：按路径维护关节开关；不克隆骨架树。
 */
export class LumenAnimationMaskDocument {
    /** @description 读写辅助。 */
    private readonly _io = new LumenJsonAssetIo();

    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description 序列化对象。 */
    private readonly _record: Record<string, unknown>;

    /**
     * @description 从已有记录创建文档。
     * @param relativePath 相对路径
     * @param record 遮罩 JSON
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
     * @returns `animationMask`
     */
    public get kind(): 'animationMask' {
        return 'animationMask';
    }

    /**
     * @description 创建空遮罩。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template 仅 `empty`
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenAnimationMaskDocument {
        if (template !== 'empty') {
            throw new Error(`lumen_animation_mask_template_unknown:${template}`);
        }
        return new LumenAnimationMaskDocument(relativePath, {
            __type__: 'cc.animation.AnimationMask',
            _name: name.trim(),
            _objFlags: 0,
            _native: '',
            _jointMasks: [],
        });
    }

    /**
     * @description 从磁盘打开 `.animask`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenAnimationMaskDocument {
        const io = new LumenJsonAssetIo();
        const record = io.readRecord(
            projectRoot,
            relativePath,
            ['cc.animation.AnimationMask'],
            'lumen_animation_mask_missing',
            'lumen_animation_mask_json_corrupt',
        );
        return new LumenAnimationMaskDocument(relativePath, record);
    }

    /**
     * @description 读取关节遮罩列表。
     * @param query Mask 不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenAnimationMaskInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'animationMask');
        return {
            path: this._relativePath,
            kind: 'animationMask',
            name: typeof this._record._name === 'string' ? this._record._name : '',
            joints: this._readJoints(),
        };
    }

    /**
     * @description 写入名称或整表替换关节列表。
     * @param patch `name` / `joints`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['name', 'joints'], 'animationMask');
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_animation_mask_property_type:name:string');
            }
            this._record._name = patch.name;
        }
        if (patch.joints !== undefined) {
            this._replaceJoints(patch.joints);
        }
    }

    /**
     * @description 在内存中序列化原生源，由AssetDB首次创建并分配meta。
     * @returns 完整原生JSON源。
     */
    public serializeNativeSource(): string {
        return `${JSON.stringify(this._record, null, 2)}\n`;
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
        this._io.writeRecord(
            projectRoot,
            this._relativePath,
            this._record,
            'animation-mask',
            writeMetaIfMissing,
            cocosVersion,
        );
    }

    /**
     * @description 读取 `_jointMasks`。
     * @returns 关节项
     */
    private _readJoints(): ILumenAnimationMaskJointInspect[] {
        const raw = this._record._jointMasks;
        if (!Array.isArray(raw)) {
            return [];
        }
        const joints: ILumenAnimationMaskJointInspect[] = [];
        for (const item of raw) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            const path = typeof record.path === 'string' ? record.path : '';
            joints.push({
                path,
                enabled: record.enabled !== false,
            });
        }
        return joints;
    }

    /**
     * @description 整表替换关节列表。
     * @param value `{ path, enabled }[]`
     */
    private _replaceJoints(value: unknown): void {
        if (!Array.isArray(value)) {
            throw new Error('lumen_animation_mask_property_type:joints:array');
        }
        const encoded: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (let index = 0; index < value.length; index += 1) {
            const item = value[index];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_animation_mask_property_type:joints[${index}]:object`);
            }
            const patch = item as Record<string, unknown>;
            this._assertOnlyFields(patch, ['path', 'enabled'], `joints[${index}]`);
            if (typeof patch.path !== 'string' || patch.path.length === 0) {
                throw new Error(`lumen_animation_mask_property_type:joints[${index}].path:string`);
            }
            if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
                throw new Error(`lumen_animation_mask_property_type:joints[${index}].enabled:boolean`);
            }
            if (seen.has(patch.path)) {
                throw new Error(`lumen_animation_mask_property_range:joints[${index}].path:duplicate`);
            }
            seen.add(patch.path);
            encoded.push({
                __type__: 'cc.JointMask',
                path: patch.path,
                enabled: patch.enabled !== false,
            });
        }
        this._record._jointMasks = encoded;
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
                    `lumen_animation_mask_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`,
                );
            }
        }
    }
}
