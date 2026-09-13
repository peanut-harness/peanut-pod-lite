import { LumenCocosVersion } from './cocos-version';
import { LumenCuratedSchemaCatalog } from './catalog';
import type { ILumenCuratedTypeLifecycle } from './codec';
import type { LumenEngineSerializableCatalog } from './engine-serializable-probe';
import { LumenPropertyDenyList } from './deny-list';
import { LumenSerializedFieldDiscoverer } from './field-discoverer';
import type {
    ILumenEmbeddedEntryHost,
    ILumenPropertyDescriptor,
    ILumenPropertyFieldSpec,
    ILumenPropertyRefResolver,
    LumenPropertyValueKind,
} from './component-property-contracts';

export type {
    ILumenEmbeddedEntryHost,
    ILumenEnumHint,
    ILumenPropertyDescriptor,
    ILumenPropertyFieldSpec,
    ILumenPropertyRefResolver,
    LumenPropertyValueKind,
} from './component-property-contracts';


/**
 * @description 基于 `bundled/schema/` 策展 JSON 的可编辑属性表（按 Creator 版本门控）。
 *
 * 覆盖 `default_prefab` 主组件 + 引擎常见可编辑组件（UI / 2D / Spine / 龙骨 / 音频 / 动画 / 物理等）。
 * 对照引擎 `@serializable` 字段；**拒绝**已废弃组件（如 `cc.LabelOutline` / `cc.LabelShadow`），
 * 描边/阴影走 `cc.Label` 自 3.8.2 起的字段。策展表之外，允许从 Prefab 实例 JSON 发现标量字段（Inspector parity）。
 * 支持列表/引用数组/事件数组/GradientRange/objectList，以及运行时注册的脚本 `@property` 清单。
 */
export class LumenComponentPropertySchema {
    /**
     * @description 当前目标 Creator 版本。
     */
    private readonly _version: LumenCocosVersion;

    /**
     * @description 策展表。
     */
    private readonly _curated: LumenCuratedSchemaCatalog;

    /**
     * @description 脚本组件属性表（ownerKey = compressedUuid 或类名）。
     */
    private readonly _scriptSchemas = new Map<string, readonly ILumenPropertyFieldSpec[]>();

    /**
     * @description 引擎 `@serializable` 覆盖层（不写回策展表）。
     */
    private _engineCatalog: LumenEngineSerializableCatalog = new Map();

    /**
     * @description 构造按版本过滤的属性表。
     * @param version Creator 版本；缺省 `3.8.3`（引擎对照基线）
     * @param curated 策展表；缺省包内 `bundled/schema/`
     */
    public constructor(
        version: LumenCocosVersion = LumenCocosVersion.DEFAULT,
        curated: LumenCuratedSchemaCatalog = LumenCuratedSchemaCatalog.shared(),
    ) {
        this._version = version;
        this._curated = curated;
    }

    /**
     * @description 当前策展表。
     * @returns 目录表
     */
    private _catalog(): LumenCuratedSchemaCatalog {
        return this._curated;
    }

    /**
     * @description 当前绑定的 Creator 版本。
     * @returns 版本对象
     */
    public get version(): LumenCocosVersion {
        return this._version;
    }

    /**
     * @description 列出当前版本下已登记的内置组件类型（不含废弃组件与脚本）。
     * @returns 组件 `__type__` 列表
     */
    public listSupportedComponents(): readonly string[] {
        return [...this._catalog().listComponentTypes()].filter((type) => this._isComponentListed(type));
    }

    /**
     * @description 注册脚本组件可编辑属性清单（ownerKey 通常为 compressedUuid）。
     * @param ownerKey 脚本 compressedUuid 或稳定类名键
     * @param fields 字段规格（与内置同一套 kind）
     */
    public registerScriptProperties(ownerKey: string, fields: readonly ILumenPropertyFieldSpec[]): void {
        const key = ownerKey.trim();
        if (key.length === 0) {
            throw new Error('lumen_script_schema_owner_empty');
        }
        if (this._catalog().hasComponent(key)) {
            throw new Error(`lumen_script_schema_conflicts_builtin:${key}`);
        }
        if (this._catalog().deprecatedBuiltin(key) != null) {
            throw new Error(`lumen_script_schema_conflicts_deprecated:${key}`);
        }
        this._scriptSchemas.set(
            key,
            fields.map((field) => ({
                ...field,
                ...(field.nestedFields != null
                    ? { nestedFields: field.nestedFields.map((nested) => ({ ...nested })) }
                    : {}),
            })),
        );
    }

    /**
     * @description 移除已注册的脚本属性清单。
     * @param ownerKey 脚本键
     */
    public unregisterScriptProperties(ownerKey: string): void {
        this._scriptSchemas.delete(ownerKey.trim());
    }

    /**
     * @description 列出已注册脚本 ownerKey。
     * @returns 排序后的键列表
     */
    public listRegisteredScripts(): readonly string[] {
        return [...this._scriptSchemas.keys()].sort();
    }

    /**
     * @description 绑定引擎 `@serializable` 覆盖层（不修改策展表）。
     * @param catalog ccclass → 字段
     */
    public bindEngineSerializableCatalog(catalog: LumenEngineSerializableCatalog): void {
        this._engineCatalog = catalog;
    }

    /**
     * @description 当前引擎覆盖层中的类型数。
     * @returns 类型数量
     */
    public engineCatalogSize(): number {
        return this._engineCatalog.size;
    }

    /**
     * @description 描述某组件在当前版本下的可编辑属性。
     * @param componentType 如 `cc.Label` 或脚本 compressedUuid
     * @returns 属性描述列表
     */
    public describeComponent(componentType: string): readonly ILumenPropertyDescriptor[] {
        return this._overlaySpecs(componentType).map((spec) => this._toDescriptor(componentType, spec));
    }

    /**
     * @description 描述节点可编辑属性。
     * @returns 属性描述列表
     */
    public describeNodeProperties(): readonly ILumenPropertyDescriptor[] {
        return this._catalog()
            .nodeFields()
            .filter((spec) => this._isFieldAvailable(spec))
            .map((spec) => this._toDescriptor('node', spec));
    }

    /**
     * @description 读取组件生命周期（与当前 Creator 版本无关）。
     * @param componentType 组件 `__type__`
     * @returns 生命周期；无边界为 `undefined`
     */
    public describeComponentLifecycle(componentType: string): ILumenCuratedTypeLifecycle | undefined {
        return this._catalog().componentLifecycle(componentType);
    }

    /**
     * @description 校验内置组件是否允许挂载（拒绝废弃类型与抽象基类；其余引擎组件默许）。
     * @param componentType 如 `cc.Button` / `cc.LabelOutline`
     */
    public assertBuiltinAttachAllowed(componentType: string): void {
        const deprecated = this._catalog().deprecatedBuiltin(componentType);
        if (deprecated != null) {
            if (this._version.isAtLeast(deprecated.deprecatedSince)) {
                throw new Error(
                    `lumen_component_deprecated:${componentType}:since=${deprecated.deprecatedSince}:use=${deprecated.useInstead}:cocos=${this._version.toString()}`,
                );
            }
            throw new Error(
                `lumen_component_not_supported:${componentType}:use=${deprecated.useInstead}:cocos=${this._version.toString()}`,
            );
        }
        this._assertComponentLifecycle(componentType, 'attach');
        if (LumenPropertyDenyList.isAttachDenied(componentType)) {
            throw new Error(
                `lumen_component_not_supported:${componentType}:reason=abstract_or_internal:cocos=${this._version.toString()}`,
            );
        }
        if (
            this._catalog().hasComponent(componentType) ||
            LumenPropertyDenyList.isEngineComponentType(componentType)
        ) {
            return;
        }
        throw new Error(
            `lumen_component_not_supported:${componentType}:cocos=${this._version.toString()}`,
        );
    }

    /**
     * @description 列出某组件在当前版本下支持的公开属性名。
     * @param componentType 如 `cc.Label`
     * @returns 属性名列表
     */
    public listApiNames(componentType: string): readonly string[] {
        return this._overlaySpecs(componentType).map((spec) => spec.apiName);
    }

    /**
     * @description 列出节点可编辑属性名。
     * @returns 属性名列表
     */
    public listNodeApiNames(): readonly string[] {
        return this._catalog()
            .nodeFields()
            .filter((spec) => this._isFieldAvailable(spec))
            .map((spec) => spec.apiName);
    }

    /**
     * @description 将公开属性补丁写入组件条目（含 CurveRange / 模块内嵌对象 / 列表）。
     * @param componentType 组件类型
     * @param component 可变组件条目
     * @param patch 公开属性 → 值
     * @param refResolver 节点/组件引用解析器
     * @param embeddedHost Prefab 内嵌条目宿主
     * @param resolveEntry 解析 `__id__` 条目（实例发现引用字段）
     */
    public applyComponentPatch(
        componentType: string,
        component: Record<string, unknown>,
        patch: Readonly<Record<string, unknown>>,
        refResolver: ILumenPropertyRefResolver,
        embeddedHost: ILumenEmbeddedEntryHost,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): void {
        this._assertPropsOwnerAllowed(componentType);
        const specs = this._specsIncludingDiscovered(componentType, component, resolveEntry);
        const byApi = new Map(specs.map((spec) => [spec.apiName, spec]));
        const occupiedForWrite = new Set([
            ...byApi.keys(),
            ...this._curatedOccupancy(componentType).apiNames,
        ]);
        for (const [apiName, rawValue] of Object.entries(patch)) {
            const spec =
                byApi.get(apiName) ??
                LumenSerializedFieldDiscoverer.resolveWriteSpec(
                    component,
                    apiName,
                    rawValue,
                    occupiedForWrite,
                    resolveEntry,
                );
            if (spec == null) {
                throw new Error(
                    `lumen_property_not_editable:${componentType}.${apiName}:allowed=${[...byApi.keys()].join(',')}:cocos=${this._version.toString()}`,
                );
            }
            if (spec.kind === 'curveRange') {
                this._applyCurveRange(spec, rawValue, apiName, embeddedHost);
                continue;
            }
            if (spec.kind === 'gradientRange') {
                this._applyGradientRange(spec, rawValue, apiName, embeddedHost);
                continue;
            }
            if (spec.kind === 'objectPatch') {
                this._applyObjectPatch(spec, rawValue, apiName, refResolver, embeddedHost, resolveEntry);
                continue;
            }
            if (spec.kind === 'objectList') {
                this._applyObjectList(component, spec, rawValue, apiName, refResolver, embeddedHost);
                continue;
            }
            if (spec.kind === 'eventHandlerList') {
                this._applyEventHandlerList(component, spec, rawValue, apiName, refResolver, embeddedHost);
                continue;
            }
            const encoded: Record<string, unknown> = {};
            this._applyEncoded(encoded, component, spec, rawValue, apiName, refResolver);
            for (const [key, value] of Object.entries(encoded)) {
                component[key] = value;
            }
        }
    }

    /**
     * @description 将公开属性补丁编码为可写入 Prefab 的字段补丁。
     * @param componentType 组件类型
     * @param patch 公开属性 → 值
     * @param existing 当前组件条目（用于 width/height 等局部更新）
     * @param refResolver 节点/组件引用解析器；含 nodeRef/componentRef 时必填
     * @returns 序列化字段补丁
     */
    public encodeComponentPatch(
        componentType: string,
        patch: Readonly<Record<string, unknown>>,
        existing: Readonly<Record<string, unknown>>,
        refResolver?: ILumenPropertyRefResolver,
    ): Record<string, unknown> {
        this._assertPropsOwnerAllowed(componentType);
        const specs = this._specsIncludingDiscovered(componentType, existing);
        const byApi = new Map(specs.map((spec) => [spec.apiName, spec]));
        const occupiedForWrite = new Set([
            ...byApi.keys(),
            ...this._curatedOccupancy(componentType).apiNames,
        ]);
        const encoded: Record<string, unknown> = {};
        for (const [apiName, rawValue] of Object.entries(patch)) {
            const spec =
                byApi.get(apiName) ??
                LumenSerializedFieldDiscoverer.resolveWriteSpec(
                    existing,
                    apiName,
                    rawValue,
                    occupiedForWrite,
                );
            if (spec == null) {
                throw new Error(
                    `lumen_property_not_editable:${componentType}.${apiName}:allowed=${[...byApi.keys()].join(',')}:cocos=${this._version.toString()}`,
                );
            }
            if (
                spec.kind === 'curveRange' ||
                spec.kind === 'gradientRange' ||
                spec.kind === 'objectPatch' ||
                spec.kind === 'objectList' ||
                spec.kind === 'eventHandlerList'
            ) {
                throw new Error(
                    `lumen_property_needs_embedded_host:${componentType}.${apiName}:kind=${spec.kind}`,
                );
            }
            this._applyEncoded(encoded, existing, spec, rawValue, apiName, refResolver);
        }
        return encoded;
    }

    /**
     * @description 将组件序列化字段解码为公开属性快照（供 inspect）。
     * @param componentType 组件类型
     * @param component 组件条目
     * @param pathForNodeIndex 节点下标 → 路径；无法解析时返回 `null`
     * @param resolveEntry 条目下标 → 对象（解析 `__id__` 内嵌）
     * @returns 公开属性名 → 可读值
     */
    public decodeComponentSnapshot(
        componentType: string,
        component: Readonly<Record<string, unknown>>,
        pathForNodeIndex: (nodeIndex: number) => string | null,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): Record<string, unknown> {
        const snapshot: Record<string, unknown> = {};
        for (const spec of this._specsIncludingDiscovered(componentType, component, resolveEntry)) {
            const raw = component[spec.serializedName];
            snapshot[spec.apiName] = this._decodeValue(
                spec,
                raw,
                pathForNodeIndex,
                component,
                resolveEntry,
            );
        }
        return snapshot;
    }

    /**
     * @description 编码节点属性补丁。
     * @param patch 公开属性
     * @param existing 当前节点
     * @returns 序列化字段补丁
     */
    public encodeNodePatch(
        patch: Readonly<Record<string, unknown>>,
        existing: Readonly<Record<string, unknown>>,
    ): Record<string, unknown> {
        const byApi = new Map(
            this._catalog()
                .nodeFields()
                .filter((spec) => this._isFieldAvailable(spec))
                .map((spec) => [spec.apiName, spec]),
        );
        const encoded: Record<string, unknown> = {};
        for (const [apiName, rawValue] of Object.entries(patch)) {
            const spec = byApi.get(apiName);
            if (spec == null) {
                throw new Error(
                    `lumen_node_property_not_editable:${apiName}:cocos=${this._version.toString()}`,
                );
            }
            this._applyEncoded(encoded, existing, spec, rawValue, apiName);
        }
        return encoded;
    }

    /**
     * @description 校验组件是否允许按属性表写入（内置或已注册脚本）。
     * @param componentType 组件类型或脚本键
     */
    private _assertPropsOwnerAllowed(componentType: string): void {
        const deprecated = this._catalog().deprecatedBuiltin(componentType);
        if (deprecated != null) {
            throw new Error(
                `lumen_component_deprecated:${componentType}:since=${deprecated.deprecatedSince}:use=${deprecated.useInstead}:cocos=${this._version.toString()}`,
            );
        }
        this._assertComponentLifecycle(componentType, 'props');
        if (
            this._catalog().hasComponent(componentType) ||
            this._scriptSchemas.has(componentType) ||
            LumenPropertyDenyList.isEngineComponentType(componentType)
        ) {
            return;
        }
        throw new Error(
            `lumen_component_props_unsupported:${componentType}:cocos=${this._version.toString()}`,
        );
    }

    /**
     * @description 策展 + 引擎覆盖 + 实例发现。
     * @param componentType 组件类型
     * @param existing 当前序列化对象
     * @returns 合并后的规格
     */
    private _specsIncludingDiscovered(
        componentType: string,
        existing: Readonly<Record<string, unknown>>,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): readonly ILumenPropertyFieldSpec[] {
        const overlay = this._overlaySpecs(componentType);
        const occupancy = this._curatedOccupancy(componentType);
        const occupiedApi = new Set([...occupancy.apiNames, ...overlay.map((spec) => spec.apiName)]);
        const occupiedSerialized = new Set([
            ...occupancy.serializedNames,
            ...overlay.map((spec) => spec.serializedName),
        ]);
        const discovered = LumenSerializedFieldDiscoverer.discover(
            existing,
            occupiedApi,
            occupiedSerialized,
            resolveEntry,
        );
        return [...overlay, ...discovered];
    }

    /**
     * @description 当前版本可用策展字段叠加引擎覆盖层。
     * @param componentType 组件类型
     * @returns 规格
     */
    private _overlaySpecs(componentType: string): readonly ILumenPropertyFieldSpec[] {
        const curated = this._availableSpecs(componentType);
        const engine = this._engineCatalog.get(componentType) ?? [];
        return this._mergeEngineSpecs(curated, engine, this._curatedOccupancy(componentType).apiNames);
    }

    /**
     * @description 引擎字段补缺口；同名 objectPatch 合并 nestedFields。
     * @param curated 策展（或已合并）规格
     * @param engine 引擎规格
     * @param occupiedApi 禁止覆盖的公开名（含版本门控字段）
     * @returns 合并规格
     */
    private _mergeEngineSpecs(
        curated: readonly ILumenPropertyFieldSpec[],
        engine: readonly ILumenPropertyFieldSpec[],
        occupiedApi: ReadonlySet<string>,
    ): readonly ILumenPropertyFieldSpec[] {
        const byApi = new Map(curated.map((spec) => [spec.apiName, spec]));
        const out: ILumenPropertyFieldSpec[] = [...curated];
        for (const spec of engine) {
            const existing = byApi.get(spec.apiName);
            if (existing == null) {
                if (occupiedApi.has(spec.apiName)) {
                    continue;
                }
                out.push(spec);
                byApi.set(spec.apiName, spec);
                continue;
            }
            if (existing.kind !== 'objectPatch' || spec.kind !== 'objectPatch') {
                continue;
            }
            const existingNested = existing.nestedFields ?? [];
            const occupiedNested = new Set(existingNested.map((nested) => nested.apiName));
            const mergedNested = this._mergeEngineSpecs(existingNested, spec.nestedFields ?? [], occupiedNested);
            const merged: ILumenPropertyFieldSpec = { ...existing, nestedFields: mergedNested };
            const index = out.findIndex((item) => item.apiName === existing.apiName);
            if (index >= 0) {
                out[index] = merged;
            }
            byApi.set(existing.apiName, merged);
        }
        return out;
    }

    /**
     * @description 全部策展字段名（含版本门控未开放的），避免发现层绕过 since/until。
     * @param componentType 组件类型
     * @returns 占用的 api / 序列化名
     */
    private _curatedOccupancy(componentType: string): {
        readonly apiNames: ReadonlySet<string>;
        readonly serializedNames: ReadonlySet<string>;
    } {
        const builtin = this._catalog().componentFields(componentType);
        const specs = builtin ?? this._scriptSchemas.get(componentType) ?? [];
        return {
            apiNames: new Set(specs.map((spec) => spec.apiName)),
            serializedNames: new Set(specs.map((spec) => spec.serializedName)),
        };
    }

    /**
     * @description 内嵌模块：策展 nestedFields 叠加实例发现字段。
     * @param curated 策展嵌套规格
     * @param existing 模块对象
     * @returns 合并规格
     */
    private _nestedSpecsIncludingDiscovered(
        curated: readonly ILumenPropertyFieldSpec[],
        existing: Readonly<Record<string, unknown>>,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): readonly ILumenPropertyFieldSpec[] {
        const occupiedApi = new Set(curated.map((spec) => spec.apiName));
        const occupiedSerialized = new Set(curated.map((spec) => spec.serializedName));
        const discovered = LumenSerializedFieldDiscoverer.discover(
            existing,
            occupiedApi,
            occupiedSerialized,
            resolveEntry,
        );
        return [...curated, ...discovered];
    }

    /**
     * @description 当前版本下某组件的可用字段规格。
     * @param componentType 组件类型
     * @returns 规格列表
     */
    private _availableSpecs(componentType: string): readonly ILumenPropertyFieldSpec[] {
        const builtin = this._catalog().componentFields(componentType);
        const specs = builtin ?? this._scriptSchemas.get(componentType);
        if (specs == null) {
            return [];
        }
        return specs.filter((spec) => this._isFieldAvailable(spec));
    }

    /**
     * @description 字段是否在当前 Creator 版本可用。
     * @param spec 字段规格
     * @returns 是否可用
     */
    private _isFieldAvailable(spec: ILumenPropertyFieldSpec): boolean {
        if (spec.since != null && this._version.isBelow(spec.since)) {
            return false;
        }
        if (spec.until != null && this._version.isAtLeast(spec.until)) {
            return false;
        }
        return true;
    }

    /**
     * @description 当前版本是否把该策展组件列入可挂载清单。
     * @param componentType 组件类型
     * @returns 是否列出
     */
    private _isComponentListed(componentType: string): boolean {
        const lifecycle = this._catalog().componentLifecycle(componentType);
        if (lifecycle?.since != null && this._version.isBelow(lifecycle.since)) {
            return false;
        }
        if (lifecycle?.removedSince != null && this._version.isAtLeast(lifecycle.removedSince)) {
            return false;
        }
        if (lifecycle?.deprecatedSince != null && this._version.isAtLeast(lifecycle.deprecatedSince)) {
            return false;
        }
        return true;
    }

    /**
     * @description 按组件生命周期拒绝尚未支持、已废弃或已移除的类型。
     * @param componentType 组件类型
     * @param action 挂载或写属性
     */
    private _assertComponentLifecycle(componentType: string, action: 'attach' | 'props'): void {
        const lifecycle = this._catalog().componentLifecycle(componentType);
        if (lifecycle == null) {
            return;
        }
        const cocos = this._version.toString();
        if (lifecycle.since != null && this._version.isBelow(lifecycle.since)) {
            throw new Error(
                `lumen_component_not_supported:${componentType}:since=${lifecycle.since}:cocos=${cocos}`,
            );
        }
        if (lifecycle.removedSince != null && this._version.isAtLeast(lifecycle.removedSince)) {
            throw new Error(
                `lumen_component_removed:${componentType}:since=${lifecycle.removedSince}:cocos=${cocos}`,
            );
        }
        if (lifecycle.deprecatedSince != null && this._version.isAtLeast(lifecycle.deprecatedSince)) {
            const use = lifecycle.useInstead ?? '';
            throw new Error(
                `lumen_component_deprecated:${componentType}:since=${lifecycle.deprecatedSince}:use=${use}:cocos=${cocos}:action=${action}`,
            );
        }
    }

    /**
     * @description 规格转描述（附枚举/示例）。
     * @param ownerKey 组件类型或 `node`
     * @param spec 字段规格
     * @returns 描述
     */
    private _toDescriptor(ownerKey: string, spec: ILumenPropertyFieldSpec): ILumenPropertyDescriptor {
        const enumHints = spec.enumHints;
        const example = spec.example;
        return {
            apiName: spec.apiName,
            serializedName: spec.serializedName,
            kind: spec.kind,
            ...(spec.refComponentType != null ? { refComponentType: spec.refComponentType } : {}),
            ...(spec.embeddedType != null ? { embeddedType: spec.embeddedType } : {}),
            ...(spec.nestedFields != null
                ? {
                      nestedProps: spec.nestedFields.map((nested) =>
                          this._toDescriptor(`${ownerKey}.${spec.apiName}`, nested),
                      ),
                  }
                : {}),
            ...(spec.inlineItems === true ? { inlineItems: true } : {}),
            ...(spec.since != null ? { since: spec.since } : {}),
            ...(spec.until != null ? { until: spec.until } : {}),
            ...(enumHints != null ? { enumHints } : {}),
            ...(example !== undefined ? { example } : {}),
            ...(spec.origin != null ? { origin: spec.origin } : {}),
        };
    }

    /**
     * @description 写入 CurveRange。数字简写为 Constant（mode=0）；`keys` 为 Curve（mode=1）；`keysMin`/`keysMax` 为 TwoCurves（mode=2）。
     * @param spec 字段规格
     * @param rawValue 数字或 `{ mode, constant, constantMin, constantMax, multiplier, keys, keysMin, keysMax }`
     * @param apiName 属性名
     * @param embeddedHost 内嵌宿主
     */
    private _applyCurveRange(
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        embeddedHost: ILumenEmbeddedEntryHost,
    ): void {
        const embeddedType = spec.embeddedType ?? 'cc.CurveRange';
        const target = embeddedHost.resolveOrCreateEmbedded(spec.serializedName, embeddedType);
        target.__type__ = embeddedType;
        if (typeof rawValue === 'number') {
            target.mode = 0;
            target.constant = rawValue;
            if (typeof target.multiplier !== 'number') {
                target.multiplier = 1;
            }
            return;
        }
        if (rawValue == null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
            throw new Error(`lumen_property_type:${apiName}:curveRange`);
        }
        const record = rawValue as Record<string, unknown>;
        const keysMinRaw = record.keysMin;
        const keysMaxRaw = record.keysMax;
        if (Array.isArray(keysMinRaw) || Array.isArray(keysMaxRaw)) {
            if (!Array.isArray(keysMinRaw) || !Array.isArray(keysMaxRaw)) {
                throw new Error(`lumen_property_type:${apiName}:curveRange:twoCurves`);
            }
            target.mode = 2;
            target.splineMin = this._encodeRealCurve(keysMinRaw, `${apiName}.keysMin`);
            target.splineMax = this._encodeRealCurve(keysMaxRaw, `${apiName}.keysMax`);
            if (record.multiplier !== undefined) {
                target.multiplier = this._asNumber(record.multiplier, `${apiName}.multiplier`);
            } else if (typeof target.multiplier !== 'number') {
                target.multiplier = 1;
            }
            return;
        }
        const keysRaw = record.keys ?? record.points;
        if (Array.isArray(keysRaw)) {
            target.mode = 1;
            target.spline = this._encodeRealCurve(keysRaw, `${apiName}.keys`);
            if (record.multiplier !== undefined) {
                target.multiplier = this._asNumber(record.multiplier, `${apiName}.multiplier`);
            } else if (typeof target.multiplier !== 'number') {
                target.multiplier = 1;
            }
            return;
        }
        for (const key of ['mode', 'constant', 'constantMin', 'constantMax', 'multiplier'] as const) {
            if (record[key] !== undefined) {
                target[key] = this._asNumber(record[key], `${apiName}.${key}`);
            }
        }
        if (typeof target.mode !== 'number') {
            target.mode = 0;
        }
        if (typeof target.multiplier !== 'number') {
            target.multiplier = 1;
        }
        if (target.mode === 3) {
            if (typeof target.constantMin !== 'number' || typeof target.constantMax !== 'number') {
                throw new Error(`lumen_property_type:${apiName}:curveRange:twoConstants`);
            }
        }
    }

    /**
     * @description 将简易关键帧列表编码为 `cc.RealCurve`。
     * @param keysRaw `{ time, value }` 列表
     * @param apiName 属性路径
     * @returns RealCurve 序列化对象
     */
    private _encodeRealCurve(keysRaw: readonly unknown[], apiName: string): Record<string, unknown> {
        if (keysRaw.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:empty`);
        }
        const frames: Array<{ readonly time: number; readonly value: number }> = [];
        for (const [index, item] of keysRaw.entries()) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:{time,value}`);
            }
            const record = item as Record<string, unknown>;
            const time = record.time;
            const value = record.value;
            if (typeof time !== 'number' || !Number.isFinite(time) || typeof value !== 'number' || !Number.isFinite(value)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:{time,value}`);
            }
            frames.push({ time, value });
        }
        frames.sort((left, right) => left.time - right.time);
        return {
            __type__: 'cc.RealCurve',
            _times: frames.map((frame) => frame.time),
            _values: frames.map((frame) => ({ value: frame.value })),
            preExtrapolation: 1,
            postExtrapolation: 1,
        };
    }

    /**
     * @description 写入 GradientRange。颜色对象简写为 Color（mode=0）；`colorKeys` 为 Gradient（mode=1）；`colorKeysMin`/`colorKeysMax` 为 TwoGradients（mode=3）。
     * @param spec 字段规格
     * @param rawValue 颜色或 `{ mode, color, colorMin, colorMax, colorKeys, alphaKeys }`
     * @param apiName 属性名
     * @param embeddedHost 内嵌宿主
     */
    private _applyGradientRange(
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        embeddedHost: ILumenEmbeddedEntryHost,
    ): void {
        const embeddedType = spec.embeddedType ?? 'cc.GradientRange';
        const target = embeddedHost.resolveOrCreateEmbedded(spec.serializedName, embeddedType);
        target.__type__ = embeddedType;
        if (rawValue != null && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            const record = rawValue as Record<string, unknown>;
            const looksLikeColor =
                typeof record.r === 'number' &&
                typeof record.g === 'number' &&
                typeof record.b === 'number' &&
                typeof record.a === 'number' &&
                record.mode === undefined &&
                record.color === undefined &&
                record.colorKeys === undefined &&
                record.colorKeysMin === undefined &&
                record.colorKeysMax === undefined;
            if (looksLikeColor) {
                target._mode = 0;
                target.color = this._asColor(rawValue);
                return;
            }
            if (Array.isArray(record.colorKeysMin) || Array.isArray(record.colorKeysMax)) {
                if (!Array.isArray(record.colorKeysMin) || !Array.isArray(record.colorKeysMax)) {
                    throw new Error(`lumen_property_type:${apiName}:gradientRange:twoGradients`);
                }
                target._mode = 3;
                target.gradientMin = this._encodeGradient(
                    record.colorKeysMin,
                    record.alphaKeysMin,
                    `${apiName}.colorKeysMin`,
                );
                target.gradientMax = this._encodeGradient(
                    record.colorKeysMax,
                    record.alphaKeysMax,
                    `${apiName}.colorKeysMax`,
                );
                return;
            }
            if (Array.isArray(record.colorKeys)) {
                target._mode = 1;
                target.gradient = this._encodeGradient(
                    record.colorKeys,
                    record.alphaKeys,
                    `${apiName}.colorKeys`,
                );
                return;
            }
            if (record.mode !== undefined) {
                target._mode = this._asNumber(record.mode, `${apiName}.mode`);
            } else if (typeof target._mode !== 'number') {
                target._mode = 0;
            }
            if (record.color !== undefined) {
                target.color = this._asColor(record.color);
            }
            if (record.colorMin !== undefined) {
                target.colorMin = this._asColor(record.colorMin);
            }
            if (record.colorMax !== undefined) {
                target.colorMax = this._asColor(record.colorMax);
            }
            return;
        }
        throw new Error(`lumen_property_type:${apiName}:gradientRange`);
    }

    /**
     * @description 将颜色关键帧编码为 `cc.Gradient`。
     * @param colorKeysRaw `{ time, color }` 列表
     * @param alphaKeysRaw 可选 `{ time, alpha }` 列表
     * @param apiName 属性路径
     * @returns Gradient 序列化对象
     */
    private _encodeGradient(
        colorKeysRaw: readonly unknown[],
        alphaKeysRaw: unknown,
        apiName: string,
    ): Record<string, unknown> {
        if (colorKeysRaw.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:empty`);
        }
        const colorKeys: Array<Record<string, unknown>> = [];
        for (const [index, item] of colorKeysRaw.entries()) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:{time,color}`);
            }
            const record = item as Record<string, unknown>;
            const time = record.time;
            if (typeof time !== 'number' || !Number.isFinite(time)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:time`);
            }
            colorKeys.push({
                __type__: 'cc.ColorKey',
                time,
                color: this._asColor(record.color),
            });
        }
        const alphaKeys: Array<Record<string, unknown>> = [];
        if (alphaKeysRaw != null) {
            if (!Array.isArray(alphaKeysRaw)) {
                throw new Error(`lumen_property_type:${apiName}:alphaKeys`);
            }
            for (const [index, item] of alphaKeysRaw.entries()) {
                if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                    throw new Error(`lumen_property_type:${apiName}.alphaKeys[${index}]:{time,alpha}`);
                }
                const record = item as Record<string, unknown>;
                const time = record.time;
                const alpha = record.alpha;
                if (typeof time !== 'number' || !Number.isFinite(time) || typeof alpha !== 'number' || !Number.isFinite(alpha)) {
                    throw new Error(`lumen_property_type:${apiName}.alphaKeys[${index}]:{time,alpha}`);
                }
                alphaKeys.push({
                    __type__: 'cc.AlphaKey',
                    time,
                    alpha,
                });
            }
        }
        return {
            __type__: 'cc.Gradient',
            colorKeys,
            alphaKeys,
            mode: 0,
        };
    }

    /**
     * @description 写入内嵌模块/对象补丁。
     * @param spec 字段规格
     * @param rawValue 嵌套公开属性对象
     * @param apiName 属性名
     * @param refResolver 引用解析器
     * @param embeddedHost 内嵌宿主
     * @param resolveEntry 解析 `__id__`
     */
    private _applyObjectPatch(
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        refResolver: ILumenPropertyRefResolver,
        embeddedHost: ILumenEmbeddedEntryHost,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): void {
        if (rawValue == null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
            throw new Error(`lumen_property_type:${apiName}:objectPatch`);
        }
        const embeddedType = spec.embeddedType;
        if (embeddedType == null || embeddedType.trim().length === 0) {
            throw new Error(`lumen_property_embedded_type_missing:${apiName}`);
        }
        const nestedFields = spec.nestedFields ?? [];
        const target = embeddedHost.resolveOrCreateEmbedded(spec.serializedName, embeddedType);
        target.__type__ = embeddedType;
        const byApi = new Map(
            this._nestedSpecsIncludingDiscovered(nestedFields, target, resolveEntry).map((field) => [
                field.apiName,
                field,
            ]),
        );
        const nestedHost = embeddedHost.forkForOwner(target);
        for (const [nestedApi, nestedValue] of Object.entries(rawValue as Record<string, unknown>)) {
            const nestedSpec =
                byApi.get(nestedApi) ??
                LumenSerializedFieldDiscoverer.resolveWriteSpec(
                    target,
                    nestedApi,
                    nestedValue,
                    new Set(byApi.keys()),
                    resolveEntry,
                );
            if (nestedSpec == null) {
                throw new Error(
                    `lumen_property_not_editable:${apiName}.${nestedApi}:allowed=${[...byApi.keys()].join(',')}`,
                );
            }
            const nestedPath = `${apiName}.${nestedApi}`;
            if (nestedSpec.kind === 'curveRange') {
                this._applyCurveRange(nestedSpec, nestedValue, nestedPath, nestedHost);
                continue;
            }
            if (nestedSpec.kind === 'gradientRange') {
                this._applyGradientRange(nestedSpec, nestedValue, nestedPath, nestedHost);
                continue;
            }
            if (nestedSpec.kind === 'objectPatch') {
                this._applyObjectPatch(nestedSpec, nestedValue, nestedPath, refResolver, nestedHost, resolveEntry);
                continue;
            }
            const encoded: Record<string, unknown> = {};
            this._applyEncoded(encoded, target, nestedSpec, nestedValue, nestedApi, refResolver);
            for (const [key, value] of Object.entries(encoded)) {
                target[key] = value;
            }
            if (nestedApi === 'shapeType' && typeof nestedValue === 'number') {
                target.shapeType = nestedValue;
                target._shapeType = nestedValue;
            }
        }
    }

    /**
     * @description 写入对象数组（Burst / BlitScreenMaterial 等）。
     * @param component 组件条目
     * @param spec 字段规格
     * @param rawValue 元素公开属性数组
     * @param apiName 属性名
     * @param refResolver 引用解析器
     * @param embeddedHost 内嵌宿主
     */
    private _applyObjectList(
        component: Record<string, unknown>,
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        refResolver: ILumenPropertyRefResolver,
        embeddedHost: ILumenEmbeddedEntryHost,
    ): void {
        if (!Array.isArray(rawValue)) {
            throw new Error(`lumen_property_type:${apiName}:objectList`);
        }
        const embeddedType = spec.embeddedType;
        if (embeddedType == null || embeddedType.trim().length === 0) {
            throw new Error(`lumen_property_embedded_type_missing:${apiName}`);
        }
        const nestedFields = spec.nestedFields ?? [];
        const byApi = new Map(nestedFields.map((field) => [field.apiName, field]));
        const inlineItems = spec.inlineItems === true;
        const next: unknown[] = [];
        for (let index = 0; index < rawValue.length; index += 1) {
            const item = rawValue[index];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:object`);
            }
            let body: Record<string, unknown>;
            if (inlineItems) {
                body = { __type__: embeddedType };
                next.push(body);
            } else {
                const allocated = embeddedHost.allocateEmbedded(embeddedType);
                body = allocated.body;
                body.__type__ = embeddedType;
                next.push({ __id__: allocated.id });
            }
            for (const [nestedApi, nestedValue] of Object.entries(item as Record<string, unknown>)) {
                const nestedSpec = byApi.get(nestedApi);
                if (nestedSpec == null) {
                    throw new Error(
                        `lumen_property_not_editable:${apiName}[${index}].${nestedApi}:allowed=${[...byApi.keys()].join(',')}`,
                    );
                }
                const encoded: Record<string, unknown> = {};
                this._applyEncoded(encoded, body, nestedSpec, nestedValue, nestedApi, refResolver);
                for (const [key, value] of Object.entries(encoded)) {
                    body[key] = value;
                }
            }
        }
        component[spec.serializedName] = next;
    }

    /**
     * @description 写入 EventHandler / ClickEvent 数组。
     * @param component 组件条目
     * @param spec 字段规格
     * @param rawValue 事件对象数组
     * @param apiName 属性名
     * @param refResolver 引用解析器
     * @param embeddedHost 内嵌宿主
     */
    private _applyEventHandlerList(
        component: Record<string, unknown>,
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        refResolver: ILumenPropertyRefResolver,
        embeddedHost: ILumenEmbeddedEntryHost,
    ): void {
        if (!Array.isArray(rawValue)) {
            throw new Error(`lumen_property_type:${apiName}:eventHandlerList`);
        }
        const embeddedType = spec.embeddedType ?? 'cc.ClickEvent';
        const next: Array<{ __id__: number }> = [];
        for (let index = 0; index < rawValue.length; index += 1) {
            const item = rawValue[index];
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:eventHandler`);
            }
            const record = item as Record<string, unknown>;
            const allocated = embeddedHost.allocateEmbedded(embeddedType);
            const body = allocated.body;
            body.__type__ = embeddedType;
            body.target = this._encodeNodeRef(record.target ?? null, `${apiName}[${index}].target`, refResolver);
            if (typeof record.component !== 'string' || record.component.trim().length === 0) {
                throw new Error(`lumen_property_type:${apiName}[${index}].component:string`);
            }
            if (typeof record.handler !== 'string' || record.handler.trim().length === 0) {
                throw new Error(`lumen_property_type:${apiName}[${index}].handler:string`);
            }
            body.component = record.component;
            body.handler = record.handler;
            body.customEventData =
                typeof record.customEventData === 'string' ? record.customEventData : '';
            body._componentId = typeof record.componentId === 'string' ? record.componentId : '';
            next.push({ __id__: allocated.id });
        }
        component[spec.serializedName] = next;
    }

    /**
     * @description 写入单字段到编码结果。
     * @param encoded 输出
     * @param existing 现有对象
     * @param spec 字段规格
     * @param rawValue 原始值
     * @param apiName API 名（width/height 特例）
     * @param refResolver 引用解析器
     */
    private _applyEncoded(
        encoded: Record<string, unknown>,
        existing: Readonly<Record<string, unknown>>,
        spec: ILumenPropertyFieldSpec,
        rawValue: unknown,
        apiName: string,
        refResolver?: ILumenPropertyRefResolver,
    ): void {
        if ((apiName === 'width' || apiName === 'height') && spec.serializedName === '_contentSize') {
            const size = this._asSize(existing[spec.serializedName]);
            if (apiName === 'width') {
                size.width = this._asNumber(rawValue, apiName);
            } else {
                size.height = this._asNumber(rawValue, apiName);
            }
            encoded[spec.serializedName] = size;
            return;
        }
        if ((apiName === 'anchorX' || apiName === 'anchorY') && spec.serializedName === '_anchorPoint') {
            const point = this._asVec2(existing[spec.serializedName]);
            if (apiName === 'anchorX') {
                point.x = this._asNumber(rawValue, apiName);
            } else {
                point.y = this._asNumber(rawValue, apiName);
            }
            encoded[spec.serializedName] = point;
            return;
        }
        encoded[spec.serializedName] = this._encodeValue(spec, rawValue, apiName, refResolver);
    }

    /**
     * @description 按类型编码值。
     * @param spec 字段规格
     * @param value 原始值
     * @param apiName 属性名（错误信息）
     * @param refResolver 引用解析器
     * @returns 可序列化值
     */
    private _encodeValue(
        spec: ILumenPropertyFieldSpec,
        value: unknown,
        apiName: string,
        refResolver?: ILumenPropertyRefResolver,
    ): unknown {
        const kind = spec.kind;
        switch (kind) {
            case 'string':
                if (typeof value !== 'string') {
                    throw new Error(`lumen_property_type:${apiName}:string`);
                }
                return value;
            case 'number':
            case 'enum':
                return this._asNumber(value, apiName);
            case 'boolean':
                if (typeof value !== 'boolean') {
                    throw new Error(`lumen_property_type:${apiName}:boolean`);
                }
                return value;
            case 'size':
                return this._asSize(value);
            case 'vec2':
                return this._asVec2(value);
            case 'vec3':
                return this._asVec3(value);
            case 'rect':
                return this._asRect(value);
            case 'color':
                return this._asColor(value);
            case 'uuid':
                return this._asUuidRef(value, apiName);
            case 'uuidList':
                return this._asUuidList(value, apiName);
            case 'vec2List':
                return this._asVec2List(value, apiName);
            case 'vec3List':
                return this._asVec3List(value, apiName);
            case 'stringList':
                return this._asStringList(value, apiName);
            case 'numberList':
                return this._asNumberList(value, apiName);
            case 'nodeRef':
                return this._encodeNodeRef(value, apiName, refResolver);
            case 'componentRef':
                return this._encodeComponentRef(value, apiName, spec.refComponentType, refResolver);
            case 'nodeRefList':
                return this._encodeNodeRefList(value, apiName, refResolver);
            case 'componentRefList':
                return this._encodeComponentRefList(value, apiName, spec.refComponentType, refResolver);
            default:
                throw new Error(`lumen_property_kind_unknown:${kind}`);
        }
    }

    /**
     * @description 编码节点引用。
     * @param value 路径字符串或 `null`
     * @param apiName 属性名
     * @param refResolver 解析器
     * @returns `{ __id__ }` 或 `null`
     */
    private _encodeNodeRef(
        value: unknown,
        apiName: string,
        refResolver?: ILumenPropertyRefResolver,
    ): { __id__: number } | null {
        if (refResolver == null) {
            throw new Error(`lumen_property_ref_resolver_required:${apiName}`);
        }
        if (value === null) {
            return refResolver.resolveNodeRef(null);
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`lumen_property_type:${apiName}:nodeRef_path`);
        }
        return refResolver.resolveNodeRef(value);
    }

    /**
     * @description 编码组件引用。
     * @param value 节点路径或 `null`
     * @param apiName 属性名
     * @param refComponentType 目标组件类型
     * @param refResolver 解析器
     * @returns `{ __id__ }` 或 `null`
     */
    private _encodeComponentRef(
        value: unknown,
        apiName: string,
        refComponentType: string | undefined,
        refResolver?: ILumenPropertyRefResolver,
    ): { __id__: number } | null {
        if (refResolver == null) {
            throw new Error(`lumen_property_ref_resolver_required:${apiName}`);
        }
        if (refComponentType == null || refComponentType.trim().length === 0) {
            throw new Error(`lumen_property_ref_component_type_missing:${apiName}`);
        }
        if (value === null) {
            return refResolver.resolveComponentRef(null, refComponentType);
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`lumen_property_type:${apiName}:componentRef_path`);
        }
        return refResolver.resolveComponentRef(value, refComponentType);
    }

    /**
     * @description 编码节点引用数组。
     * @param value 路径字符串数组
     * @param apiName 属性名
     * @param refResolver 解析器
     * @returns `{ __id__ }[]`
     */
    private _encodeNodeRefList(
        value: unknown,
        apiName: string,
        refResolver?: ILumenPropertyRefResolver,
    ): Array<{ __id__: number } | null> {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:nodeRefList`);
        }
        return value.map((item, index) => this._encodeNodeRef(item, `${apiName}[${index}]`, refResolver));
    }

    /**
     * @description 编码组件引用数组。
     * @param value 节点路径数组
     * @param apiName 属性名
     * @param refComponentType 目标组件类型
     * @param refResolver 解析器
     * @returns `{ __id__ }[]`
     */
    private _encodeComponentRefList(
        value: unknown,
        apiName: string,
        refComponentType: string | undefined,
        refResolver?: ILumenPropertyRefResolver,
    ): Array<{ __id__: number } | null> {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:componentRefList`);
        }
        return value.map((item, index) =>
            this._encodeComponentRef(item, `${apiName}[${index}]`, refComponentType, refResolver),
        );
    }

    /**
     * @description 解码单字段为公开可读值。
     * @param spec 字段规格
     * @param raw 序列化值
     * @param pathForNodeIndex 节点下标 → 路径
     * @param component 整组件（width/height 读 size）
     * @param resolveEntry 条目下标 → 对象
     * @returns 公开值
     */
    private _decodeValue(
        spec: ILumenPropertyFieldSpec,
        raw: unknown,
        pathForNodeIndex: (nodeIndex: number) => string | null,
        component: Readonly<Record<string, unknown>>,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): unknown {
        if ((spec.apiName === 'width' || spec.apiName === 'height') && spec.serializedName === '_contentSize') {
            const size = component[spec.serializedName];
            if (size != null && typeof size === 'object') {
                const record = size as { width?: unknown; height?: unknown };
                return spec.apiName === 'width' ? record.width : record.height;
            }
            return null;
        }
        if (
            (spec.apiName === 'anchorX' || spec.apiName === 'anchorY') &&
            spec.serializedName === '_anchorPoint'
        ) {
            const point = component[spec.serializedName];
            if (point != null && typeof point === 'object') {
                const record = point as { x?: unknown; y?: unknown };
                return spec.apiName === 'anchorX' ? record.x : record.y;
            }
            return null;
        }
        switch (spec.kind) {
            case 'uuid':
                if (raw != null && typeof raw === 'object' && '__uuid__' in raw) {
                    const uuid = (raw as { __uuid__?: unknown }).__uuid__;
                    return typeof uuid === 'string' ? uuid : null;
                }
                return raw === null ? null : raw;
            case 'uuidList':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => {
                    if (item != null && typeof item === 'object' && '__uuid__' in item) {
                        const uuid = (item as { __uuid__?: unknown }).__uuid__;
                        return typeof uuid === 'string' ? uuid : null;
                    }
                    return item;
                });
            case 'vec2List':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => {
                    if (item != null && typeof item === 'object') {
                        const record = item as { x?: unknown; y?: unknown };
                        return {
                            x: typeof record.x === 'number' ? record.x : 0,
                            y: typeof record.y === 'number' ? record.y : 0,
                        };
                    }
                    return { x: 0, y: 0 };
                });
            case 'vec3List':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => {
                    if (item != null && typeof item === 'object') {
                        const record = item as { x?: unknown; y?: unknown; z?: unknown };
                        return {
                            x: typeof record.x === 'number' ? record.x : 0,
                            y: typeof record.y === 'number' ? record.y : 0,
                            z: typeof record.z === 'number' ? record.z : 0,
                        };
                    }
                    return { x: 0, y: 0, z: 0 };
                });
            case 'stringList':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => (typeof item === 'string' ? item : String(item)));
            case 'numberList':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => (typeof item === 'number' ? item : Number(item)));
            case 'curveRange': {
                const target = this._resolveEmbeddedRaw(raw, resolveEntry);
                if (target == null) {
                    return null;
                }
                const keys = this._decodeRealCurveKeys(target.spline);
                const keysMin = this._decodeRealCurveKeys(target.splineMin);
                const keysMax = this._decodeRealCurveKeys(target.splineMax);
                return {
                    mode: typeof target.mode === 'number' ? target.mode : 0,
                    constant: typeof target.constant === 'number' ? target.constant : 0,
                    multiplier: typeof target.multiplier === 'number' ? target.multiplier : 1,
                    ...(typeof target.constantMin === 'number' ? { constantMin: target.constantMin } : {}),
                    ...(typeof target.constantMax === 'number' ? { constantMax: target.constantMax } : {}),
                    ...(keys != null ? { keys } : {}),
                    ...(keysMin != null ? { keysMin } : {}),
                    ...(keysMax != null ? { keysMax } : {}),
                };
            }
            case 'gradientRange': {
                const target = this._resolveEmbeddedRaw(raw, resolveEntry);
                if (target == null) {
                    return null;
                }
                const mode =
                    typeof target._mode === 'number'
                        ? target._mode
                        : typeof target.mode === 'number'
                          ? target.mode
                          : 0;
                const colorKeys = this._decodeGradientColorKeys(target.gradient);
                const colorKeysMin = this._decodeGradientColorKeys(target.gradientMin);
                const colorKeysMax = this._decodeGradientColorKeys(target.gradientMax);
                return {
                    mode,
                    ...(target.color != null ? { color: target.color } : {}),
                    ...(target.colorMin != null ? { colorMin: target.colorMin } : {}),
                    ...(target.colorMax != null ? { colorMax: target.colorMax } : {}),
                    ...(colorKeys != null ? { colorKeys } : {}),
                    ...(colorKeysMin != null ? { colorKeysMin } : {}),
                    ...(colorKeysMax != null ? { colorKeysMax } : {}),
                };
            }
            case 'objectPatch': {
                const target = this._resolveEmbeddedRaw(raw, resolveEntry);
                if (target == null) {
                    return null;
                }
                const nested: Record<string, unknown> = {};
                for (const nestedSpec of this._nestedSpecsIncludingDiscovered(
                    spec.nestedFields ?? [],
                    target,
                    resolveEntry,
                )) {
                    nested[nestedSpec.apiName] = this._decodeValue(
                        nestedSpec,
                        target[nestedSpec.serializedName],
                        pathForNodeIndex,
                        target,
                        resolveEntry,
                    );
                }
                return nested;
            }
            case 'objectList': {
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => {
                    const target = this._resolveEmbeddedRaw(item, resolveEntry);
                    if (target == null) {
                        return null;
                    }
                    const nested: Record<string, unknown> = {};
                    for (const nestedSpec of spec.nestedFields ?? []) {
                        nested[nestedSpec.apiName] = this._decodeValue(
                            nestedSpec,
                            target[nestedSpec.serializedName],
                            pathForNodeIndex,
                            target,
                            resolveEntry,
                        );
                    }
                    return nested;
                });
            }
            case 'eventHandlerList': {
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => {
                    const target = this._resolveEmbeddedRaw(item, resolveEntry);
                    if (target == null) {
                        return null;
                    }
                    return {
                        target: this._decodeIdRef(target.target, pathForNodeIndex, null),
                        component: typeof target.component === 'string' ? target.component : '',
                        handler: typeof target.handler === 'string' ? target.handler : '',
                        customEventData:
                            typeof target.customEventData === 'string' ? target.customEventData : '',
                        componentId:
                            typeof target._componentId === 'string' ? target._componentId : '',
                    };
                });
            }
            case 'nodeRef':
                return this._decodeIdRef(raw, pathForNodeIndex, null);
            case 'componentRef':
                return this._decodeIdRef(raw, pathForNodeIndex, spec.refComponentType ?? null);
            case 'nodeRefList':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) => this._decodeIdRef(item, pathForNodeIndex, null));
            case 'componentRefList':
                if (!Array.isArray(raw)) {
                    return [];
                }
                return raw.map((item) =>
                    this._decodeIdRef(item, pathForNodeIndex, spec.refComponentType ?? null),
                );
            default:
                return raw === undefined ? null : raw;
        }
    }

    /**
     * @description 解析 `__id__` 或内联对象。
     * @param raw 序列化值
     * @param resolveEntry 条目解析
     * @returns 对象或 `null`
     */
    private _resolveEmbeddedRaw(
        raw: unknown,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): Record<string, unknown> | null {
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const record = raw as Record<string, unknown>;
        if ('__id__' in record) {
            const id = record.__id__;
            if (typeof id !== 'number' || resolveEntry == null) {
                return null;
            }
            return resolveEntry(id);
        }
        return record;
    }

    /**
     * @description 将 `{ __id__ }` 解码为路径（组件引用附带类型）。
     * @param raw 序列化引用
     * @param pathForNodeIndex 节点下标 → 路径
     * @param componentType 组件类型；节点引用时为 `null`
     * @returns 路径字符串、带类型对象或 `null`
     */
    private _decodeIdRef(
        raw: unknown,
        pathForNodeIndex: (nodeIndex: number) => string | null,
        componentType: string | null,
    ): unknown {
        if (raw === null) {
            return null;
        }
        if (raw == null || typeof raw !== 'object' || !('__id__' in raw)) {
            return null;
        }
        const id = (raw as { __id__?: unknown }).__id__;
        if (typeof id !== 'number') {
            return null;
        }
        if (componentType == null) {
            return pathForNodeIndex(id);
        }
        // 组件引用：pathForNodeIndex 对组件下标无效，由调用方传入「组件下标 → 宿主节点路径」包装。
        const path = pathForNodeIndex(id);
        if (path == null) {
            return { componentType, index: id };
        }
        return { nodePath: path, componentType, index: id };
    }

    /**
     * @description 解析数字。
     * @param value 输入
     * @param apiName 属性名
     * @returns 数字
     */
    private _asNumber(value: unknown, apiName: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`lumen_property_type:${apiName}:number`);
        }
        return value;
    }

    /**
     * @description 从 RealCurve 读回简易关键帧。
     * @param spline 内嵌曲线
     * @returns `{ time, value }` 列表；无法识别时为 null
     */
    private _decodeRealCurveKeys(spline: unknown): readonly { readonly time: number; readonly value: number }[] | null {
        if (spline == null || typeof spline !== 'object' || Array.isArray(spline)) {
            return null;
        }
        const record = spline as Record<string, unknown>;
        const times = record._times;
        const values = record._values;
        if (!Array.isArray(times) || !Array.isArray(values) || times.length === 0 || times.length !== values.length) {
            return null;
        }
        const keys: Array<{ readonly time: number; readonly value: number }> = [];
        for (const [index, timeRaw] of times.entries()) {
            if (typeof timeRaw !== 'number') {
                return null;
            }
            const valueRaw = values[index];
            let value = 0;
            if (typeof valueRaw === 'number') {
                value = valueRaw;
            } else if (valueRaw != null && typeof valueRaw === 'object' && !Array.isArray(valueRaw)) {
                const frame = valueRaw as Record<string, unknown>;
                if (typeof frame.value !== 'number') {
                    return null;
                }
                value = frame.value;
            } else {
                return null;
            }
            keys.push({ time: timeRaw, value });
        }
        return keys;
    }

    /**
     * @description 从 Gradient 读回颜色关键帧。
     * @param gradient 内嵌渐变
     * @returns `{ time, color }` 列表；无法识别时为 null
     */
    private _decodeGradientColorKeys(gradient: unknown): readonly Record<string, unknown>[] | null {
        if (gradient == null || typeof gradient !== 'object' || Array.isArray(gradient)) {
            return null;
        }
        const record = gradient as Record<string, unknown>;
        const colorKeys = record.colorKeys;
        if (!Array.isArray(colorKeys) || colorKeys.length === 0) {
            return null;
        }
        const decoded: Array<Record<string, unknown>> = [];
        for (const item of colorKeys) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                return null;
            }
            const frame = item as Record<string, unknown>;
            decoded.push({
                time: typeof frame.time === 'number' ? frame.time : 0,
                color: frame.color,
            });
        }
        return decoded;
    }

    /**
     * @description 解析 Size。
     * @param value 输入
     * @returns Size 对象
     */
    private _asSize(value: unknown): { __type__: 'cc.Size'; width: number; height: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            const width = record.width;
            const height = record.height;
            if (typeof width === 'number' && typeof height === 'number') {
                return { __type__: 'cc.Size', width, height };
            }
        }
        throw new Error('lumen_property_type:size:{width,height}');
    }

    /**
     * @description 解析 Vec2。
     * @param value 输入
     * @returns Vec2
     */
    private _asVec2(value: unknown): { __type__: 'cc.Vec2'; x: number; y: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (typeof record.x === 'number' && typeof record.y === 'number') {
                return { __type__: 'cc.Vec2', x: record.x, y: record.y };
            }
        }
        throw new Error('lumen_property_type:vec2:{x,y}');
    }

    /**
     * @description 解析 Vec3。
     * @param value 输入
     * @returns Vec3
     */
    private _asVec3(value: unknown): { __type__: 'cc.Vec3'; x: number; y: number; z: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (typeof record.x === 'number' && typeof record.y === 'number' && typeof record.z === 'number') {
                return { __type__: 'cc.Vec3', x: record.x, y: record.y, z: record.z };
            }
        }
        throw new Error('lumen_property_type:vec3:{x,y,z}');
    }

    /**
     * @description 解析 Rect。
     * @param value 输入
     * @returns Rect
     */
    private _asRect(value: unknown): { __type__: 'cc.Rect'; x: number; y: number; width: number; height: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (
                typeof record.x === 'number' &&
                typeof record.y === 'number' &&
                typeof record.width === 'number' &&
                typeof record.height === 'number'
            ) {
                return {
                    __type__: 'cc.Rect',
                    x: record.x,
                    y: record.y,
                    width: record.width,
                    height: record.height,
                };
            }
        }
        throw new Error('lumen_property_type:rect:{x,y,width,height}');
    }

    /**
     * @description 解析 Color。
     * @param value 输入
     * @returns Color
     */
    private _asColor(value: unknown): { __type__: 'cc.Color'; r: number; g: number; b: number; a: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (
                typeof record.r === 'number' &&
                typeof record.g === 'number' &&
                typeof record.b === 'number' &&
                typeof record.a === 'number'
            ) {
                return { __type__: 'cc.Color', r: record.r, g: record.g, b: record.b, a: record.a };
            }
        }
        throw new Error('lumen_property_type:color:{r,g,b,a}');
    }

    /**
     * @description 解析资源 uuid 引用；`null` 表示清空引用。
     * @param value 字符串 uuid、已有引用对象或 `null`
     * @param apiName 属性名
     * @returns `{ __uuid__ }` 或 `null`
     */
    private _asUuidRef(value: unknown, apiName: string): { __uuid__: string } | null {
        if (value === null) {
            return null;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            return { __uuid__: value };
        }
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const uuid = (value as { __uuid__?: unknown }).__uuid__;
            if (typeof uuid === 'string' && uuid.length > 0) {
                return { __uuid__: uuid };
            }
        }
        throw new Error(`lumen_property_type:${apiName}:uuid`);
    }

    /**
     * @description 解析 uuid 引用列表（如 MeshRenderer.materials）。
     * @param value 字符串数组 / 引用对象数组 / 单 uuid
     * @param apiName 属性名
     * @returns `{ __uuid__ }[]`
     */
    private _asUuidList(value: unknown, apiName: string): Array<{ __uuid__: string }> {
        if (typeof value === 'string' || (value != null && typeof value === 'object' && !Array.isArray(value))) {
            const item = this._asUuidRef(value, apiName);
            if (item == null) {
                throw new Error(`lumen_property_type:${apiName}:uuidList`);
            }
            return [item];
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:uuidList`);
        }
        return value.map((entry, index) => {
            const item = this._asUuidRef(entry, `${apiName}[${index}]`);
            if (item == null) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:uuid`);
            }
            return item;
        });
    }

    /**
     * @description 解析 Vec2 点列（如 PolygonCollider2D.points）。
     * @param value `{x,y}[]`
     * @param apiName 属性名
     * @returns 引擎序列化点列
     */
    private _asVec2List(
        value: unknown,
        apiName: string,
    ): Array<{ __type__: 'cc.Vec2'; x: number; y: number }> {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:vec2List`);
        }
        return value.map((item, index) => {
            try {
                return this._asVec2(item);
            } catch {
                throw new Error(`lumen_property_type:${apiName}[${index}]:vec2`);
            }
        });
    }

    /**
     * @description 解析 Vec3 列表（如 Line.positions / SimplexCollider.vertices）。
     * @param value `{x,y,z}[]`
     * @param apiName 属性名
     * @returns 引擎序列化点列
     */
    private _asVec3List(
        value: unknown,
        apiName: string,
    ): Array<{ __type__: 'cc.Vec3'; x: number; y: number; z: number }> {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:vec3List`);
        }
        return value.map((item, index) => {
            try {
                return this._asVec3(item);
            } catch {
                throw new Error(`lumen_property_type:${apiName}[${index}]:vec3`);
            }
        });
    }

    /**
     * @description 解析字符串列表。
     * @param value 字符串数组
     * @param apiName 属性名
     * @returns 字符串数组
     */
    private _asStringList(value: unknown, apiName: string): string[] {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:stringList`);
        }
        return value.map((item, index) => {
            if (typeof item !== 'string') {
                throw new Error(`lumen_property_type:${apiName}[${index}]:string`);
            }
            return item;
        });
    }

    /**
     * @description 解析数字列表。
     * @param value 数字数组
     * @param apiName 属性名
     * @returns 数字数组
     */
    private _asNumberList(value: unknown, apiName: string): number[] {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:numberList`);
        }
        return value.map((item, index) => this._asNumber(item, `${apiName}[${index}]`));
    }
}
