/**
 * @description 组件属性值类型（编辑器可检视的标量、资源与节点/组件引用）。
 */
export type LumenPropertyValueKind =
    | 'string'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'size'
    | 'vec2'
    | 'vec3'
    | 'rect'
    | 'color'
    | 'uuid'
    | 'uuidList'
    | 'vec2List'
    | 'vec3List'
    | 'stringList'
    | 'numberList'
    | 'nodeRef'
    | 'componentRef'
    | 'nodeRefList'
    | 'componentRefList'
    | 'curveRange'
    | 'gradientRange'
    | 'objectPatch'
    | 'objectList'
    | 'eventHandlerList';

/**
 * @description 将公开路径解析为 Prefab `__id__` 引用（由文档注入）。
 */
export interface ILumenPropertyRefResolver {
    /**
     * @description 解析节点路径为 `{ __id__ }`；`null` 表示清空引用。
     * @param nodePath 节点路径，如 `/Root/Content`
     * @returns 节点引用或 `null`
     */
    resolveNodeRef(nodePath: string | null): { __id__: number } | null;

    /**
     * @description 解析节点上指定类型组件为 `{ __id__ }`；`null` 表示清空引用。
     * @param nodePath 组件所在节点路径
     * @param componentType 目标组件 `__type__`
     * @returns 组件引用或 `null`
     */
    resolveComponentRef(nodePath: string | null, componentType: string): { __id__: number } | null;
}

/**
 * @description Prefab 内嵌条目宿主（CurveRange / 粒子模块等经 `__id__` 引用）。
 */
export interface ILumenEmbeddedEntryHost {
    /**
     * @description 读取组件字段指向的内嵌条目；不存在时返回 `null`。
     * @param serializedName 组件上的字段名
     * @returns 内嵌对象或 `null`
     */
    readEmbedded(serializedName: string): Record<string, unknown> | null;

    /**
     * @description 解析或创建内嵌条目，并写回组件字段为 `{ __id__ }`。
     * @param serializedName 组件上的字段名
     * @param embeddedType 如 `cc.CurveRange` / `cc.ShapeModule`
     * @returns 可写的内嵌对象
     */
    resolveOrCreateEmbedded(serializedName: string, embeddedType: string): Record<string, unknown>;

    /**
     * @description 分配独立内嵌条目（用于数组元素，如 ClickEvent / Burst）。
     * @param embeddedType 条目 `__type__`
     * @returns `{ __id__ }` 与可写 body
     */
    allocateEmbedded(embeddedType: string): { readonly id: number; readonly body: Record<string, unknown> };

    /**
     * @description 把宿主绑定到另一对象（粒子子模块上的 CurveRange / GradientRange）。
     * @param owner 作为字段容器的内嵌对象
     * @returns 针对该对象字段的宿主
     */
    forkForOwner(owner: Record<string, unknown>): ILumenEmbeddedEntryHost;
}

/**
 * @description 单条属性映射：公开 API 名 → Prefab 序列化字段。
 */
export interface ILumenPropertyFieldSpec {
    /**
     * @description 公开属性名（与编辑器 / d.ts getter 一致，如 `string`）。
     */
    readonly apiName: string;

    /**
     * @description Prefab JSON 字段名（如 `_string`）。
     */
    readonly serializedName: string;

    /**
     * @description 值类型。
     */
    readonly kind: LumenPropertyValueKind;

    /**
     * @description `componentRef` 时目标组件类型（如 `cc.Sprite`）。
     */
    readonly refComponentType?: string;

    /**
     * @description `curveRange` / `gradientRange` / `objectPatch` / 列表元素创建时的 `__type__`。
     */
    readonly embeddedType?: string;

    /**
     * @description `objectPatch` / `objectList` 元素可写字段；`eventHandlerList` 忽略（固定契约）。
     */
    readonly nestedFields?: readonly ILumenPropertyFieldSpec[];

    /**
     * @description 策展 JSON 中引用的内嵌类型名；加载后展开为 `nestedFields`，运行时不保留。
     */
    readonly typeRef?: string;

    /**
     * @description 枚举取值提示；非 enum 或未登记时省略。
     */
    readonly enumHints?: readonly ILumenEnumHint[];

    /**
     * @description 示例值。
     */
    readonly example?: unknown;

    /**
     * @description `objectList` 元素以内联对象写入数组（非 `__id__`）；默认 `false`。
     */
    readonly inlineItems?: boolean;

    /**
     * @description 该字段起始可用的 Creator 版本（含）；省略表示无下限。
     */
    readonly since?: string;

    /**
     * @description 该字段截止版本（不含）；达到此版本起不再暴露。
     */
    readonly until?: string;

    /**
     * @description 规格来源；省略视为策展白名单。
     */
    readonly origin?: 'curated' | 'discovered' | 'engine';
}
/**
 * @description 枚举取值提示（名称 → 整型，供 AI / 配方作者参考）。
 */
export interface ILumenEnumHint {
    /**
     * @description 枚举成员名（引擎习惯名）。
     */
    readonly name: string;

    /**
     * @description Prefab 中写入的整型值。
     */
    readonly value: number;
}

/**
 * @description 属性描述（含类型与枚举提示）。
 */
export interface ILumenPropertyDescriptor {
    /**
     * @description 公开 API 名。
     */
    readonly apiName: string;

    /**
     * @description 序列化字段名。
     */
    readonly serializedName: string;

    /**
     * @description 值类型。
     */
    readonly kind: LumenPropertyValueKind;

    /**
     * @description `componentRef` 时目标组件类型。
     */
    readonly refComponentType?: string;

    /**
     * @description `curveRange` / `gradientRange` / `objectPatch` / 列表元素 `__type__`。
     */
    readonly embeddedType?: string;

    /**
     * @description `objectPatch` / `objectList` 嵌套属性描述。
     */
    readonly nestedProps?: readonly ILumenPropertyDescriptor[];

    /**
     * @description `objectList` 是否内联元素。
     */
    readonly inlineItems?: boolean;

    /**
     * @description 起始版本（含）。
     */
    readonly since?: string;

    /**
     * @description 截止版本（不含）。
     */
    readonly until?: string;

    /**
     * @description 枚举提示；非 enum 或未登记时省略。
     */
    readonly enumHints?: readonly ILumenEnumHint[];

    /**
     * @description 示例值。
     */
    readonly example?: unknown;

    /**
     * @description 规格来源；省略视为策展白名单。
     */
    readonly origin?: 'curated' | 'discovered' | 'engine';
}
