/**
 * @description 原生输入用例必须同时提供真实事件、组件结果与游戏像素差。
 */
export class ComponentInputBehaviorContract {
    /**
     * @description 冻结的交互组件范围。
     */
    public static readonly types = new Set(['cc.Button', 'cc.Toggle', 'cc.ToggleContainer', 'cc.Slider', 'cc.BlockInputEvents']);
    /**
     * @description 校验公开输入事件与组件结果，不能用面板赋值代替交互。
     * @param type 被测类型。
     * @param baseline 基线实际观测。
     * @param effect 输入后的实际观测。
     */
    public static validate(type: string, baseline: unknown, effect: unknown): void {
        const a = this.record(baseline); const b = this.record(effect);
        if (!this.types.has(type) || a.frameBound !== true || b.frameBound !== true) throw new Error('component_input_dependency_invalid');
        if (type === 'cc.BlockInputEvents') {
            if (a.nativeEvents !== 1 || b.nativeEvents !== 1 || a.callbacks !== 1 || b.callbacks !== 0
                || a.blockEnabled !== false || b.blockEnabled !== true) throw new Error('component_input_bubbling_invalid');
            return;
        }
        if (a.nativeEvents !== 0 || b.nativeEvents !== 1 || a.callbacks !== 0 || b.callbacks !== 1)
            throw new Error('component_input_real_event_missing');
        if (type === 'cc.Toggle' && (a.checked !== false || b.checked !== true || a.checkmarkActive !== false
            || b.checkmarkActive !== true || a.checkmarkBound !== true || b.checkmarkBound !== true)) throw new Error('component_input_toggle_invalid');
        if (type === 'cc.ToggleContainer' && (JSON.stringify(a.checked) !== '[true,false]'
            || JSON.stringify(b.checked) !== '[false,true]')) throw new Error('component_input_exclusive_group_invalid');
        if (type === 'cc.Slider' && (a.progress !== 0.25 || this.number(b.progress) < 0.6 || this.number(b.progress) > 0.9
            || this.number(b.handleX) - this.number(a.handleX) < 100 || a.handleBound !== true || b.handleBound !== true))
            throw new Error('component_input_slider_result_invalid');
    }
    /**
     * @description 拒绝非有限数值。
     * @param value 外部值。
     * @returns 有限数值。
     */
    private static number(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('component_input_number_invalid'); return value;
    }
    /**
     * @description 只接纳记录。
     * @param value 外部值。
     * @returns 公开观测记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_input_state_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
