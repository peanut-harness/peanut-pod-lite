/**
 * @description 实际渲染与灯光用例必须有真实资源、明确生命周期及游戏像素变化。
 */
export class ComponentVisualBehaviorContract {
    /**
     * @description 固定灯光范围。
     */
    public static readonly lights = new Set(['cc.DirectionalLight', 'cc.PointLight', 'cc.SphereLight', 'cc.SpotLight', 'cc.RangedDirectionalLight']);
    /**
     * @description 固定新增范围。
     */
    public static readonly types = new Set([...this.lights, 'cc.MeshRenderer', 'cc.Canvas', 'cc.SpriteRenderer', 'cc.Billboard', 'cc.Line']);
    /**
     * @description 校验真正参与呈现的资源和生命周期。
     * @param type 类型。
     * @param baseline 实际基线。
     * @param effect 实际效果。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type) || a.enabled !== false || b.enabled !== true) throw new Error('component_visual_transition_invalid');
        for (const row of [a, b]) {
            if (this.lights.has(type)) {
                if (row.geometryBound !== true || row.materialBound !== true || row.standardEffect !== true
                    || row.effectBound !== true || row.passesReady !== true
                    || row.sphereEnabled !== true || row.ambientIllum !== 0) throw new Error('component_visual_lighting_dependency_missing');
            } else if (type === 'cc.MeshRenderer') {
                if (row.geometryBound !== true || row.materialBound !== true) throw new Error('component_visual_mesh_dependency_missing');
            } else if (type === 'cc.Canvas') {
                if (row.frameBound !== true || row.cameraBound !== true) throw new Error('component_visual_canvas_dependency_missing');
            } else if (type === 'cc.SpriteRenderer') {
                if (row.frameBound !== true || row.geometryBound !== true || row.materialBound !== true
                    || row.textureBound !== true || row.passesReady !== true) throw new Error('component_visual_sprite_dependency_missing');
            } else if (type === 'cc.Billboard') {
                if (row.textureBound !== true || row.width !== 4 || row.height !== 4) throw new Error('component_visual_billboard_dependency_missing');
            } else if (row.lineWidth !== 0.3 || row.materialBound !== true
                || JSON.stringify(row.positions) !== '[[-2,-1,0],[0,1,0],[2,-1,0]]') throw new Error('component_visual_line_dependency_missing');
        }
    }
    /**
     * @description 仅接受记录。
     * @param value 外部值。
     * @returns 实际观测记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_visual_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
