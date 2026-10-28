/**
 * @description UI行为的公开状态约束；实际画布变化和原生身份由共同验收器独立校验。
 */
export class ComponentUiBehaviorContract {
    /**
     * @description 只接纳当前已冻结的14项，不把依赖组件顺便计为通过。
     */
    public static readonly types: ReadonlySet<string> = new Set(['cc.Label', 'cc.RichText', 'cc.Sprite', 'cc.UIOpacity',
        'cc.UITransform', 'cc.UISkew', 'cc.Graphics', 'cc.Mask', 'cc.Layout', 'cc.Widget', 'cc.Sorting2D',
        'cc.ProgressBar', 'cc.ScrollView', 'cc.ScrollBar']);
    /**
     * @description 检查真实属性和布局/滚动结果，只有命令应答或HUD不同仍拒绝。
     * @param type 固定组件类型。
     * @param baseline 未受信的基线公开观测。
     * @param effect 未受信的变化公开观测。
     * @returns 无；未满足行为语义即拒绝。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type)) throw new Error('component_ui_case_unregistered');
        const common: Record<string, unknown> = {}; let before: Record<string, unknown>; let after: Record<string, unknown>;
        switch (type) {
            case 'cc.Label': before = { text: 'BASELINE' }; after = { text: 'CHANGED' }; common.fontSize = 96; break;
            case 'cc.RichText': before = { text: '<color=#ff4433>ONE</color>' }; after = { text: '<color=#33aaff>TWO</color>' }; common.fontSize = 96; break;
            case 'cc.Sprite': before = { color: '30,130,255,255' }; after = { color: '255,60,40,255' }; common.frameBound = true; break;
            case 'cc.UIOpacity': before = { opacity: 255 }; after = { opacity: 32 }; common.frameBound = true; break;
            case 'cc.UITransform': before = { width: 200 }; after = { width: 480 }; Object.assign(common, { height: 180, frameBound: true }); break;
            case 'cc.UISkew': before = { skewX: 0 }; after = { skewX: 30 }; Object.assign(common, { skewY: 0, frameBound: true }); break;
            case 'cc.Graphics': before = { lineWidth: 4 }; after = { lineWidth: 32 }; break;
            case 'cc.Mask': before = { inverted: false }; after = { inverted: true }; common.childFrameBound = true; break;
            case 'cc.Layout': before = { layoutType: 1 }; after = { layoutType: 2 }; Object.assign(common, { childCount: 3, childrenFramesBound: true }); this.layout(a.positions, false); this.layout(b.positions, true); break;
            case 'cc.Widget': before = { left: 120 }; after = { left: 480 }; Object.assign(common, { frameBound: true, targetIsParent: true });
                if (this.number(b.posX) - this.number(a.posX) < 100) throw new Error('component_ui_widget_position_unchanged'); break;
            case 'cc.Sorting2D': before = { order: 0 }; after = { order: 2 }; Object.assign(common, { backdropOrder: 1, frameBound: true, backdropFrameBound: true }); break;
            case 'cc.ProgressBar': before = { progress: 0.25, barWidth: 120 }; after = { progress: 0.75, barWidth: 360 }; Object.assign(common, { totalLength: 480, barFrameBound: true }); break;
            case 'cc.ScrollView': case 'cc.ScrollBar': before = {}; after = {}; Object.assign(common, { childCount: 3, contentFramesBound: true });
                if (Math.abs(this.number(a.offsetY)) > 1e-3 || this.number(b.maxY) < 100
                    || Math.abs(this.number(b.offsetY) - this.number(b.maxY)) > 1e-3
                    || Math.abs(this.number(a.maxY) - this.number(b.maxY)) > 1e-3
                    || this.number(b.contentY) - this.number(a.contentY) < 100) throw new Error('component_ui_scroll_result_invalid');
                if (type === 'cc.ScrollBar') {
                    Object.assign(common, { verticalBarBound: true, handleFrameBound: true });
                    if (Math.abs(this.number(b.handleY) - this.number(a.handleY)) < 20) throw new Error('component_ui_scroll_handle_unchanged');
                } break;
            default: throw new Error('component_ui_case_unregistered');
        }
        if (Object.entries({ ...common, ...before }).some(([key, value]) => a[key] !== value)
            || Object.entries({ ...common, ...after }).some(([key, value]) => b[key] !== value)) throw new Error('component_ui_transition_invalid');
    }
    /**
     * @description 三个真实子节点必须分别呈横向或纵向排列，类型字段变化不能替代位置结果。
     * @param value 实际公开位置数组。
     * @param vertical 是否纵向。
     * @returns 无；位置无效或排列未改变即拒绝。
     */
    private static layout(value: unknown, vertical: boolean): void {
        if (!Array.isArray(value) || value.length !== 3 || value.some(row => !Array.isArray(row) || row.length !== 2))
            throw new Error('component_ui_layout_positions_invalid');
        const points = value.map(row => (row as unknown[]).map(x => this.number(x)));
        const moving = vertical ? 1 : 0; const fixed = vertical ? 0 : 1;
        if (Math.abs(points[0]![fixed]! - points[2]![fixed]!) > 1e-3
            || Math.abs(points[0]![moving]! - points[2]![moving]!) < 100) throw new Error('component_ui_layout_result_invalid');
    }
    /**
     * @description 拒绝NaN等无法举证的数值。
     * @param value 外部JSON值。
     * @returns 有限数值。
     */
    private static number(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('component_ui_number_invalid'); return value;
    }
    /**
     * @description 只接纳普通记录形态的公开观测。
     * @param value 外部JSON值。
     * @returns 观测对象。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_ui_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
