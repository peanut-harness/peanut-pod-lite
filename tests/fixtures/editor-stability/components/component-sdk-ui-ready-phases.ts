/**
 * @description 只旁观实际SDK Metrics.trackTimeEnd成功删除的两项启动计时，完成后立即恢复自身Map包装。
 */
export class ComponentSdkUiReadyPhases {
    /**
     * @description 不补造起点、结果或计时；只有真实SDK结束栈与实际删除成功才推进兼容安装。
     */
    public static install(map: Map<unknown, unknown>, completed: (labels: string[]) => void,
        stack: () => string = () => new Error('sdk-ui-ready-phase').stack ?? '') {
        const names = ['main-window:ready', 'hierarchy:render-tree']; const observed = new Set<string>();
        const descriptor = Object.getOwnPropertyDescriptor(map, 'delete'); const original = map.delete;
        const state = { installed: true }; const control = { restore(): void {
            if (!state.installed) return;
            if (map.delete !== shim.delete) throw new Error('component_sdk_ui_ready_phase_identity_changed');
            if (descriptor) Object.defineProperty(map, 'delete', descriptor); else Reflect.deleteProperty(map, 'delete'); state.installed = false;
        } };
        const shim = { delete(this: Map<unknown, unknown>, key: unknown): boolean {
            const result = original.call(this, key);
            if (this === map && result === true && typeof key === 'string' && names.includes(key)) {
                const trace = stack();
                if (trace.includes('Metrics.trackTimeEnd') && trace.includes('/app.asar/builtin/metrics/dist/libs/metrics.ccc')) {
                    observed.add(key);
                    if (observed.size === names.length) { control.restore(); queueMicrotask(() => completed([...observed])); }
                }
            }
            return result;
        } };
        Object.defineProperty(map, 'delete', { configurable: true, writable: true, value: shim.delete });
        return { state, restore: (): void => control.restore() };
    }
}
