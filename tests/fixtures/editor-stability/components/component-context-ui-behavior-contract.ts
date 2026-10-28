/**
 * @description 上下文UI必须提供依赖、实际运行结果和有区分力的画面。
 */
export class ComponentContextUiBehaviorContract {
    /**
     * @description 已登记的六项范围。
     */
    public static readonly types = new Set(['cc.PageView', 'cc.PageViewIndicator', 'cc.EditBox', 'cc.SafeArea', 'cc.RenderRoot2D', 'cc.UICoordinateTracker']);
    /**
     * @description 校验公开运行结果，拒绝只改变配置的记录。
     * @param type 类型。
     * @param baseline 实际基线。
     * @param effect 实际效果。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type)) throw new Error('component_context_case_unknown');
        if (type === 'cc.PageView' || type === 'cc.PageViewIndicator') {
            if (a.pageIndex !== 0 || b.pageIndex !== 2 || a.pageCount !== 3 || b.pageCount !== 3
                || a.pageFramesBound !== true || b.pageFramesBound !== true || a.indicatorFramesBound !== true || b.indicatorFramesBound !== true
                || Math.abs(this.number(b.contentX) - this.number(a.contentX)) < 400
                || JSON.stringify(a.indicatorAlphas) !== '[255,128,128]' || JSON.stringify(b.indicatorAlphas) !== '[128,128,255]')
                throw new Error('component_context_page_result_invalid');
        } else if (type === 'cc.EditBox') {
            if (a.text !== 'BASELINE' || a.labelText !== 'BASELINE' || b.text !== 'TEST' || b.labelText !== 'TEST'
                || a.changed !== 0 || a.ended !== 0 || a.returned !== 0 || this.number(b.changed) < 1 || b.ended !== 1 || b.returned !== 1
                || a.frameBound !== true || b.frameBound !== true) throw new Error('component_context_real_edit_missing');
        } else if (type === 'cc.SafeArea') {
            if (a.enabled !== false || b.enabled !== true || a.width !== 200 || a.height !== 180
                || this.number(b.safeWidth) < 400 || this.number(b.safeHeight) < 400
                || Math.abs(this.number(b.width) - this.number(b.safeWidth)) > 1 || Math.abs(this.number(b.height) - this.number(b.safeHeight)) > 1
                || a.safeWidth !== b.safeWidth || a.safeHeight !== b.safeHeight || a.frameBound !== true || b.frameBound !== true)
                throw new Error('component_context_safe_area_result_invalid');
        } else if (type === 'cc.RenderRoot2D') {
            if (a.enabled !== true || b.enabled !== false || [a, b].some(x => x.detachedFromCanvas !== true || x.frameBound !== true))
                throw new Error('component_context_render_root_dependency_invalid');
        } else if (a.sourceX !== -2 || b.sourceX !== 2 || this.number(b.markerX) - this.number(a.markerX) < 100
            || [a, b].some(x => x.mapped !== true || x.targetBound !== true || x.cameraBound !== true || x.frameBound !== true))
            throw new Error('component_context_mapping_callback_invalid');
    }
    /**
     * @description 仅接纳有限数值。
     * @param value 外部值。
     * @returns 有限数值。
     */
    private static number(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('component_context_number_invalid'); return value;
    }
    /**
     * @description 仅接纳记录。
     * @param value 外部值。
     * @returns 观测记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_context_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
