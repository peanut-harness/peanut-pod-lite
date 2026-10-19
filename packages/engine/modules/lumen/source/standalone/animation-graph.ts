import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenStandaloneInspectQuery } from './inspect-query';

/**
 * @description 动画图变量类型数值。与引擎 `VariableType` 一致：FLOAT / BOOLEAN / TRIGGER / INTEGER。
 */
const VARIABLE_TYPE_BY_NAME: Readonly<Record<string, number>> = {
    FLOAT: 0,
    BOOLEAN: 1,
    TRIGGER: 2,
    INTEGER: 3,
};

/**
 * @description 动画图层快照。
 */
export interface ILumenAnimationGraphLayerInspect {
    /** @description 图层下标。 */
    readonly index: number;
    /** @description 图层名。 */
    readonly name: string;
    /** @description 图层权重。 */
    readonly weight: number;
    /** @description 绑定的 Animation Mask uuid；未绑定时为 `null`。 */
    readonly mask: string | null;
}

/**
 * @description 动画图变量快照。
 */
export interface ILumenAnimationGraphVariableInspect {
    /** @description 变量名。 */
    readonly name: string;
    /** @description 类型名。 */
    readonly type: string;
    /** @description 引擎类型数值。 */
    readonly typeValue: number;
    /** @description 默认值。 */
    readonly value: boolean | number;
}

/**
 * @description Animation Graph Inspector 快照。不展开状态机节点图。
 */
export interface ILumenAnimationGraphInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'animationGraph';
    /** @description `_name`。 */
    readonly name: string;
    /** @description 图层。 */
    readonly layers: readonly ILumenAnimationGraphLayerInspect[];
    /** @description 变量。 */
    readonly variables: readonly ILumenAnimationGraphVariableInspect[];
}

/**
 * @description `.animgraph` 文档：图层名/权重/Mask 与变量；不增删状态或过渡。
 */
export class LumenAnimationGraphDocument {
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
     * @returns `animationGraph`
     */
    public get kind(): 'animationGraph' {
        return 'animationGraph';
    }

    /**
     * @description 创建空动画图（默认一层 Entry/Exit/Any）。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template 仅 `empty`
     * @returns 文档
     */
    public static createEmpty(
        relativePath: string,
        name: string,
        template: string = 'empty',
    ): LumenAnimationGraphDocument {
        if (template !== 'empty') {
            throw new Error(`lumen_animation_graph_template_unknown:${template}`);
        }
        const entries: Record<string, unknown>[] = [
            {
                __type__: 'cc.animation.AnimationGraph',
                _name: name.trim(),
                _objFlags: 0,
                _native: '',
                _layers: [{ __id__: 1 }],
                _variables: {},
            },
            {
                __type__: 'cc.animation.Layer',
                _stateMachine: { __id__: 2 },
                name: '',
                weight: 1,
                mask: null,
            },
            {
                __type__: 'cc.animation.StateMachine',
                _states: [{ __id__: 3 }, { __id__: 4 }, { __id__: 5 }],
                _transitions: [],
                _entryState: { __id__: 3 },
                _exitState: { __id__: 4 },
                _anyState: { __id__: 5 },
            },
            { __type__: 'cc.animation.State', name: 'Entry' },
            { __type__: 'cc.animation.State', name: 'Exit' },
            { __type__: 'cc.animation.State', name: 'Any' },
        ];
        return new LumenAnimationGraphDocument(relativePath, entries);
    }

    /**
     * @description 从磁盘打开 `.animgraph`。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenAnimationGraphDocument {
        const io = new LumenJsonAssetIo();
        const entries = io.readEntries(
            projectRoot,
            relativePath,
            ['cc.animation.AnimationGraph'],
            'lumen_animation_graph_missing',
            'lumen_animation_graph_json_corrupt',
        );
        return new LumenAnimationGraphDocument(relativePath, entries);
    }

    /**
     * @description 读取图层与变量；不展开状态机。
     * @param query 动画图不接受查询键
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenAnimationGraphInspect {
        LumenStandaloneInspectQuery.rejectIfPresent(query, 'animationGraph');
        const header = this._header();
        return {
            path: this._relativePath,
            kind: 'animationGraph',
            name: typeof header._name === 'string' ? header._name : '',
            layers: this._readLayers(),
            variables: this._readVariables(),
        };
    }

    /**
     * @description 写入名称、图层名/权重/Mask 与变量；拒绝状态机字段。
     * @param patch `name` / `layers` / `variables`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        this._assertOnlyFields(patch, ['name', 'layers', 'variables'], 'animationGraph');
        const header = this._header();
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_animation_graph_property_type:name:string');
            }
            header._name = patch.name;
        }
        if (patch.layers !== undefined) {
            this._patchLayers(patch.layers);
        }
        if (patch.variables !== undefined) {
            this._patchVariables(header, patch.variables);
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
            'animation-graph',
            writeMetaIfMissing,
            cocosVersion,
        );
    }

    /**
     * @description 读取图头。
     * @returns 头对象
     */
    private _header(): Record<string, unknown> {
        const header = this._entries[0];
        if (header == null) {
            throw new Error(`lumen_animation_graph_json_corrupt:${this._relativePath}`);
        }
        return header;
    }

    /**
     * @description 读取图层列表。
     * @returns 图层快照
     */
    private _readLayers(): ILumenAnimationGraphLayerInspect[] {
        const raw = this._header()._layers;
        if (!Array.isArray(raw)) {
            return [];
        }
        const layers: ILumenAnimationGraphLayerInspect[] = [];
        for (let index = 0; index < raw.length; index += 1) {
            const layer = this._io.resolveMutableEntry(this._entries, raw[index]);
            if (layer == null) {
                continue;
            }
            layers.push({
                index,
                name: typeof layer.name === 'string' ? layer.name : '',
                weight: typeof layer.weight === 'number' && Number.isFinite(layer.weight) ? layer.weight : 1,
                mask: this._io.readUuid(layer.mask),
            });
        }
        return layers;
    }

    /**
     * @description 读取变量表。
     * @returns 变量快照
     */
    private _readVariables(): ILumenAnimationGraphVariableInspect[] {
        const raw = this._header()._variables;
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
            return [];
        }
        const variables: ILumenAnimationGraphVariableInspect[] = [];
        for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
            const decoded = this._decodeVariable(value);
            if (decoded != null) {
                variables.push({ name, ...decoded });
            }
        }
        return variables;
    }

    /**
     * @description 解码单个变量。
     * @param value 序列化值
     * @returns 类型与值；无法识别时为 `null`
     */
    private _decodeVariable(
        value: unknown,
    ): Omit<ILumenAnimationGraphVariableInspect, 'name'> | null {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (record.__type__ === 'cc.animation.TriggerVariable') {
            const flags = typeof record._flags === 'number' ? record._flags : 0;
            return { type: 'TRIGGER', typeValue: VARIABLE_TYPE_BY_NAME.TRIGGER, value: (flags & 1) === 1 };
        }
        const typeValue = typeof record._type === 'number' ? record._type : VARIABLE_TYPE_BY_NAME.FLOAT;
        const type = this._typeName(typeValue);
        if (type === 'BOOLEAN') {
            return { type, typeValue, value: record._value === true };
        }
        const numeric = typeof record._value === 'number' && Number.isFinite(record._value) ? record._value : 0;
        return { type, typeValue, value: type === 'INTEGER' ? Math.trunc(numeric) : numeric };
    }

    /**
     * @description 按图层下标或当前名写入 name/weight/mask。
     * @param value 图层补丁列表
     */
    private _patchLayers(value: unknown): void {
        if (!Array.isArray(value)) {
            throw new Error('lumen_animation_graph_property_type:layers:array');
        }
        const raw = this._header()._layers;
        if (!Array.isArray(raw)) {
            throw new Error('lumen_animation_graph_layer_missing:0');
        }
        for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
            const item = value[itemIndex];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_animation_graph_property_type:layers[${itemIndex}]:object`);
            }
            const patch = item as Record<string, unknown>;
            this._assertOnlyFields(patch, ['index', 'name', 'weight', 'mask'], `layers[${itemIndex}]`);
            const layer = this._findLayer(raw, patch, itemIndex);
            if (patch.name !== undefined && patch.index !== undefined) {
                if (typeof patch.name !== 'string') {
                    throw new Error(`lumen_animation_graph_property_type:layers[${itemIndex}].name:string`);
                }
                layer.name = patch.name;
            } else if (patch.name !== undefined && patch.index === undefined) {
                // 用当前名定位时不再改名；改名必须带 index。
            }
            if (patch.weight !== undefined) {
                layer.weight = this._requireRange(patch.weight, `layers[${itemIndex}].weight`, 0, 1, false);
            }
            if (patch.mask !== undefined) {
                layer.mask =
                    patch.mask === null || patch.mask === ''
                        ? null
                        : this._io.encodeUuid(patch.mask, 'cc.animation.AnimationMask');
            }
        }
    }

    /**
     * @description 按 index 或当前 name 定位图层。
     * @param raw `_layers` 引用列表
     * @param patch 单条补丁
     * @param itemIndex 补丁下标
     * @returns 图层对象
     */
    private _findLayer(
        raw: unknown[],
        patch: Readonly<Record<string, unknown>>,
        itemIndex: number,
    ): Record<string, unknown> {
        if (patch.index !== undefined) {
            if (typeof patch.index !== 'number' || !Number.isInteger(patch.index) || patch.index < 0) {
                throw new Error(`lumen_animation_graph_property_type:layers[${itemIndex}].index:integer`);
            }
            const layer = this._io.resolveMutableEntry(this._entries, raw[patch.index]);
            if (layer == null) {
                throw new Error(`lumen_animation_graph_layer_missing:${patch.index}`);
            }
            return layer;
        }
        if (typeof patch.name !== 'string' || patch.name.length === 0) {
            throw new Error(`lumen_animation_graph_property_type:layers[${itemIndex}]:index_or_name`);
        }
        for (const ref of raw) {
            const layer = this._io.resolveMutableEntry(this._entries, ref);
            if (layer != null && layer.name === patch.name) {
                return layer;
            }
        }
        throw new Error(`lumen_animation_graph_layer_missing:${patch.name}`);
    }

    /**
     * @description 按名新增、更新或删除变量。
     * @param header 图头
     * @param value 变量补丁列表
     */
    private _patchVariables(header: Record<string, unknown>, value: unknown): void {
        if (!Array.isArray(value)) {
            throw new Error('lumen_animation_graph_property_type:variables:array');
        }
        const bag = this._ensureRecord(header, '_variables');
        for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
            const item = value[itemIndex];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_animation_graph_property_type:variables[${itemIndex}]:object`);
            }
            const patch = item as Record<string, unknown>;
            this._assertOnlyFields(patch, ['name', 'type', 'value', 'remove'], `variables[${itemIndex}]`);
            if (typeof patch.name !== 'string' || patch.name.trim().length === 0) {
                throw new Error(`lumen_animation_graph_property_type:variables[${itemIndex}].name:string`);
            }
            const name = patch.name.trim();
            if (patch.remove === true) {
                delete bag[name];
                continue;
            }
            const existing = bag[name];
            const encoded = this._encodeVariable(existing, patch, itemIndex);
            bag[name] = encoded;
        }
    }

    /**
     * @description 编码变量对象。
     * @param existing 已有值
     * @param patch 补丁
     * @param itemIndex 补丁下标
     * @returns 序列化变量
     */
    private _encodeVariable(
        existing: unknown,
        patch: Readonly<Record<string, unknown>>,
        itemIndex: number,
    ): Record<string, unknown> {
        const decoded = this._decodeVariable(existing);
        const typeName = this._resolveTypeName(patch.type, decoded?.type, itemIndex);
        const typeValue = VARIABLE_TYPE_BY_NAME[typeName];
        if (typeValue == null) {
            throw new Error(`lumen_animation_graph_property_range:variables[${itemIndex}].type:FLOAT|BOOLEAN|TRIGGER|INTEGER`);
        }
        if (typeName === 'TRIGGER') {
            const flagsBase =
                existing != null && typeof existing === 'object' && !Array.isArray(existing)
                    ? typeof (existing as { _flags?: unknown })._flags === 'number'
                        ? (existing as { _flags: number })._flags
                        : 0
                    : 0;
            const nextValue =
                patch.value === undefined ? (decoded?.value === true) : this._requireBoolean(patch.value, itemIndex);
            return {
                __type__: 'cc.animation.TriggerVariable',
                _flags: nextValue ? flagsBase | 1 : flagsBase & ~1,
            };
        }
        const nextValue =
            patch.value === undefined ? decoded?.value : patch.value;
        if (typeName === 'BOOLEAN') {
            return {
                __type__: 'cc.animation.PlainVariable',
                _type: typeValue,
                _value: this._requireBoolean(nextValue === undefined ? false : nextValue, itemIndex),
            };
        }
        const numeric = this._requireFinite(nextValue === undefined ? 0 : nextValue, itemIndex);
        return {
            __type__: 'cc.animation.PlainVariable',
            _type: typeValue,
            _value: typeName === 'INTEGER' ? Math.trunc(numeric) : numeric,
        };
    }

    /**
     * @description 解析变量类型名。
     * @param raw 补丁类型
     * @param fallback 已有类型
     * @param itemIndex 补丁下标
     * @returns 类型名
     */
    private _resolveTypeName(raw: unknown, fallback: string | undefined, itemIndex: number): string {
        if (raw === undefined) {
            if (fallback == null) {
                throw new Error(`lumen_animation_graph_property_type:variables[${itemIndex}].type:required`);
            }
            return fallback;
        }
        if (typeof raw === 'number' && Number.isInteger(raw)) {
            return this._typeName(raw);
        }
        if (typeof raw === 'string') {
            const upper = raw.trim().toUpperCase();
            if (upper in VARIABLE_TYPE_BY_NAME) {
                return upper;
            }
        }
        throw new Error(`lumen_animation_graph_property_range:variables[${itemIndex}].type:FLOAT|BOOLEAN|TRIGGER|INTEGER`);
    }

    /**
     * @description 类型数值转名。
     * @param typeValue 引擎数值
     * @returns 类型名
     */
    private _typeName(typeValue: number): string {
        for (const [name, value] of Object.entries(VARIABLE_TYPE_BY_NAME)) {
            if (value === typeValue) {
                return name;
            }
        }
        return 'FLOAT';
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
     * @description 校验布尔值。
     * @param value 未受信值
     * @param itemIndex 补丁下标
     * @returns 布尔值
     */
    private _requireBoolean(value: unknown, itemIndex: number): boolean {
        if (typeof value !== 'boolean') {
            throw new Error(`lumen_animation_graph_property_type:variables[${itemIndex}].value:boolean`);
        }
        return value;
    }

    /**
     * @description 校验有限数字。
     * @param value 未受信值
     * @param itemIndex 补丁下标
     * @returns 数字
     */
    private _requireFinite(value: unknown, itemIndex: number): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`lumen_animation_graph_property_type:variables[${itemIndex}].value:number`);
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
            throw new Error(`lumen_animation_graph_property_range:${fieldName}:${minimum}..${maximum}`);
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
                    `lumen_animation_graph_property_not_editable:${scope}.${key}:allowed=${allowed.join(',')}`,
                );
            }
        }
    }
}
