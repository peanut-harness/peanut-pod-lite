import { LumenCuratedSchemaCatalog } from './catalog';

/**
 * @description 节点挂载约定：Renderer 互斥族与 Layers 规范（对照 Creator 3.8）。
 *
 * - `@disallowMultiple` 作用于同类型及子类；`cc.Renderer` 为渲染互斥根。
 * - Layer：`UI_2D = 1<<25`，`DEFAULT = 1<<30`；相机 Visibility 与节点 Layer 做 `&`。
 * - 互斥族与 Layer 类型表来自 `bundled/schema/conventions.json`；位值仍是引擎契约。
 * @see https://docs.cocos.com/creator/3.8/manual/zh/scripting/decorator.html
 * @see https://docs.cocos.com/creator/3.8/manual/zh/concepts/scene/layer.html
 */

/**
 * @description 内置 Layer 位值（与 `cc.Layers.Enum` 一致）。
 */
export enum LumenNodeLayer {
    /** @description 2D UI（Canvas / Label / Sprite 等） */
    UI_2D = 1 << 25,
    /** @description 默认 3D / 世界物体 */
    DEFAULT = 1 << 30,
}

/**
 * @description 节点层角色（Agent 选型用）。
 */
export type LumenLayerRole = 'ui2d' | 'world3d';

/**
 * @description 节点挂载与 Layer 约定校验器。
 */
export class LumenNodeConventions {
    /**
     * @description 包内策展约定表。
     * @returns 目录表
     */
    private static _catalog(): LumenCuratedSchemaCatalog {
        return LumenCuratedSchemaCatalog.shared();
    }

    /**
     * @description 是否属于 Renderer 互斥族。
     * @param componentType 组件 `__type__`
     * @returns 是否渲染互斥成员
     */
    public static isRendererExclusive(componentType: string): boolean {
        return LumenNodeConventions._catalog().isRendererExclusive(componentType);
    }

    /**
     * @description 推断组件倾向的 Layer 角色；无法判断时返回 `null`。
     * @param componentType 组件类型
     * @returns 角色或 `null`
     */
    public static layerRoleForComponent(componentType: string): LumenLayerRole | null {
        return LumenNodeConventions._catalog().layerRoleForComponent(componentType);
    }

    /**
     * @description 角色 → Layer 位值。
     * @param role 层角色
     * @returns Layer 数值
     */
    public static layerValue(role: LumenLayerRole): number {
        return role === 'ui2d' ? LumenNodeLayer.UI_2D : LumenNodeLayer.DEFAULT;
    }

    /**
     * @description Layer 数值 → 角色（仅识别内置 UI_2D / DEFAULT）。
     * @param layer 节点 `_layer`
     * @returns 角色；自定义层返回 `null`
     */
    public static roleForLayer(layer: number): LumenLayerRole | null {
        if (layer === LumenNodeLayer.UI_2D) {
            return 'ui2d';
        }
        if (layer === LumenNodeLayer.DEFAULT) {
            return 'world3d';
        }
        return null;
    }

    /**
     * @description 根据拟挂组件列表选择默认 Layer；UI模型桥接节点使用UI层，其余3D优先。
     * @param componentTypes 组件类型列表
     * @returns Layer 位值
     */
    public static preferredLayerForComponents(componentTypes: readonly string[]): number {
        if (componentTypes.includes('cc.UIMeshRenderer')) {
            return LumenNodeLayer.UI_2D;
        }
        for (const type of componentTypes) {
            if (LumenNodeConventions.layerRoleForComponent(type) === 'world3d') {
                return LumenNodeLayer.DEFAULT;
            }
        }
        for (const type of componentTypes) {
            if (LumenNodeConventions.layerRoleForComponent(type) === 'ui2d') {
                return LumenNodeLayer.UI_2D;
            }
        }
        return LumenNodeLayer.UI_2D;
    }

    /**
     * @description 校验拟挂渲染组件是否与节点已有渲染组件冲突。
     * @param componentType 拟挂类型
     * @param existingComponentTypes 节点已有类型
     */
    public static assertRendererCompatible(
        componentType: string,
        existingComponentTypes: readonly string[],
    ): void {
        if (!LumenNodeConventions.isRendererExclusive(componentType)) {
            return;
        }
        for (const existing of existingComponentTypes) {
            if (existing === componentType) {
                continue;
            }
            if (LumenNodeConventions.isRendererExclusive(existing)
                && !LumenNodeConventions._isUIModelPair(componentType, existing)) {
                throw new Error(
                    `lumen_renderer_exclusive:${componentType}:conflicts=${existing}:hint=split_to_child_node`,
                );
            }
        }
    }

    /**
     * @description 校验同一批拟挂组件内部是否含多个渲染互斥成员。
     * @param componentTypes 组件类型列表
     */
    public static assertRendererCompatibleAmong(componentTypes: readonly string[]): void {
        const renderers = componentTypes.filter((type) => LumenNodeConventions.isRendererExclusive(type));
        if (renderers.length <= 1) {
            return;
        }
        if (renderers.length === 2 && renderers[0] != null && renderers[1] != null
            && LumenNodeConventions._isUIModelPair(renderers[0], renderers[1])) {
            return;
        }
        throw new Error(
            `lumen_renderer_exclusive_batch:${renderers.join('+')}:hint=one_renderer_per_node`,
        );
    }

    /**
     * @description 校验渲染类组件与节点 Layer 是否匹配；非渲染组件不强制。
     * @param componentType 拟挂类型
     * @param nodeLayer 当前节点 `_layer`
     * @param existingComponentTypes 同节点已有组件，用于UI模型载体的层语义。
     */
    public static assertLayerCompatible(componentType: string, nodeLayer: number, existingComponentTypes: readonly string[] = []): void {
        const needed = LumenNodeConventions._effectiveLayerRole(componentType, existingComponentTypes);
        if (needed == null) {
            return;
        }
        if (!LumenNodeConventions.isRendererExclusive(componentType) && needed !== 'world3d') {
            return;
        }
        const current = LumenNodeConventions.roleForLayer(nodeLayer);
        if (current == null || current === needed) {
            return;
        }
        throw new Error(
            `lumen_layer_mismatch:${componentType}:need=${needed}:nodeLayer=${nodeLayer}:hint=set_layer_${needed === 'ui2d' ? 'UI_2D' : 'DEFAULT'}_or_move_node`,
        );
    }

    /**
     * @description 挂载时建议写回的 Layer；无建议时返回 `null`（保留原值）。
     * @param componentType 拟挂类型
     * @param nodeLayer 当前 Layer
     * @param existingComponentTypes 已有组件
     * @returns 建议 Layer 或 `null`
     */
    public static suggestLayerOnAttach(
        componentType: string,
        nodeLayer: number,
        existingComponentTypes: readonly string[],
    ): number | null {
        const needed = LumenNodeConventions._effectiveLayerRole(componentType, existingComponentTypes);
        if (needed == null) {
            return null;
        }
        const preferred = LumenNodeConventions.layerValue(needed);
        if (nodeLayer === preferred) {
            return null;
        }
        const hasOtherRenderer = existingComponentTypes.some(
            (type) => type !== componentType && LumenNodeConventions.isRendererExclusive(type)
                && !LumenNodeConventions._isUIModelPair(componentType, type),
        );
        if (hasOtherRenderer) {
            return null;
        }
        const hasBlockingRole = existingComponentTypes.some((type) => {
            const role = LumenNodeConventions.layerRoleForComponent(type);
            return role != null && role !== needed && LumenNodeConventions.isRendererExclusive(type)
                && !LumenNodeConventions._isUIModelPair(componentType, type);
        });
        if (hasBlockingRole) {
            return null;
        }
        return preferred;
    }

    /**
     * @description SDK的UI模型桥接器是Component，必须与真实模型或粒子载体共用节点；不放行其它渲染组合。
     * @param left 一侧组件类型。
     * @param right 另一侧组件类型。
     * @returns 是否为官方支持的桥接器与载体组合。
     */
    private static _isUIModelPair(left: string, right: string): boolean {
        return (left === 'cc.UIMeshRenderer' && ['cc.MeshRenderer', 'cc.ParticleSystem'].includes(right))
            || (right === 'cc.UIMeshRenderer' && ['cc.MeshRenderer', 'cc.ParticleSystem'].includes(left));
    }

    /**
     * @description 同节点UI模型的载体随桥接器进入UI批次，其余组件保持目录层语义。
     * @param componentType 当前组件。
     * @param existingComponentTypes 同节点已有组件。
     * @returns 当前节点中的实际层角色。
     */
    private static _effectiveLayerRole(componentType: string, existingComponentTypes: readonly string[]): LumenLayerRole | null {
        if (existingComponentTypes.some(type => LumenNodeConventions._isUIModelPair(componentType, type))) {
            return 'ui2d';
        }
        return LumenNodeConventions.layerRoleForComponent(componentType);
    }

    /**
     * @description Agent / MCP 可见的挂载约定摘要。
     * @returns 互斥族与 Layer 规范
     */
    public static describeConventions(): {
        readonly rendererExclusive: readonly string[];
        readonly layers: {
            readonly UI_2D: number;
            readonly DEFAULT: number;
            readonly ui2dTypes: readonly string[];
            readonly world3dTypes: readonly string[];
        };
        readonly rules: readonly string[];
    } {
        const types = LumenNodeConventions._catalog().describeConventions();
        return {
            rendererExclusive: types.rendererExclusive,
            layers: {
                UI_2D: LumenNodeLayer.UI_2D,
                DEFAULT: LumenNodeLayer.DEFAULT,
                ui2dTypes: types.ui2dTypes,
                world3dTypes: types.world3dTypes,
            },
            rules: [
                'same_node_at_most_one_cc.Renderer_subclass',
                'UIMeshRenderer_requires_same_node_MeshRenderer_or_ParticleSystem_and_UI_2D_layer',
                'ui_nodes_use_layer_UI_2D_1<<25',
                'world3d_nodes_use_layer_DEFAULT_1<<30',
                'camera_visibility_must_include_node_layer',
                'combine_visuals_via_child_nodes_not_stacked_renderers',
            ],
        };
    }
}
