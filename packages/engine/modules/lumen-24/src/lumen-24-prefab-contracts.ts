/**
 * @description Creator 2.4 Prefab / Scene JSON 条目。
 */
export type Lumen24PrefabEntry = Record<string, unknown>;

/**
 * @description 文档种类（`.prefab` 或 `.fire`）。
 */
export type Lumen24DocumentKind = 'prefab' | 'scene';

/**
 * @description 树节点摘要。
 */
export interface ILumen24TreeNode {
    /**
     * @description 层级路径（`Root/Child`）。
     */
    readonly path: string;
    /**
     * @description 节点名。
     */
    readonly name: string;
    /**
     * @description entries 下标。
     */
    readonly index: number;
    /**
     * @description 是否激活。
     */
    readonly active: boolean;
    /**
     * @description 子节点。
     */
    readonly children: readonly ILumen24TreeNode[];
}

/**
 * @description 节点检视摘要。
 */
export interface ILumen24InspectNode {
    /**
     * @description 路径。
     */
    readonly path: string;
    /**
     * @description 名称。
     */
    readonly name: string;
    /**
     * @description entries 下标。
     */
    readonly index: number;
    /**
     * @description 是否激活。
     */
    readonly active: boolean;
    /**
     * @description 透明度。
     */
    readonly opacity: number;
    /**
     * @description 位置（来自 `_trs`）。
     */
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    /**
     * @description 缩放。
     */
    readonly scale: { readonly x: number; readonly y: number; readonly z: number };
    /**
     * @description 子节点名列表。
     */
    readonly childNames: readonly string[];
    /**
     * @description 组件 `__type__` 列表。
     */
    readonly components: readonly string[];
}

/**
 * @description 节点属性补丁（2.x 最小集）。
 */
export interface ILumen24NodePropsPatch {
    /**
     * @description 是否激活。
     */
    readonly active?: boolean;
    /**
     * @description 透明度 0–255。
     */
    readonly opacity?: number;
    /**
     * @description 世界/本地 x。
     */
    readonly x?: number;
    /**
     * @description 本地 y。
     */
    readonly y?: number;
    /**
     * @description 本地 z。
     */
    readonly z?: number;
    /**
     * @description 缩放 x。
     */
    readonly scaleX?: number;
    /**
     * @description 缩放 y。
     */
    readonly scaleY?: number;
    /**
     * @description 缩放 z。
     */
    readonly scaleZ?: number;
}
