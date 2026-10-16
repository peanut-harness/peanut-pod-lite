/**
 * @description 透明观察唯一SDK计时Map，记录真实起始值和失败查询，不补造事件或改变结果。
 */
export class ComponentSdkTimerTrace {
    /**
     * @description 只包裹给定Map实例，卸载恢复自身方法，原API异常照常传播。
     */
    public static install(map: Map<unknown, unknown>, record: (event: Record<string, unknown>) => void): () => void {
        if (Object.prototype.toString.call(map) !== '[object Map]') throw new Error('component_sdk_timer_trace_map_invalid');
        const originals = new Map<string, { descriptor?: PropertyDescriptor; method: Function; wrapper: Function }>();
        for (const name of ['set', 'has', 'get', 'delete', 'clear']) {
            const method = Reflect.get(map, name); const descriptor = Object.getOwnPropertyDescriptor(map, name);
            if (typeof method !== 'function') throw new Error('component_sdk_timer_trace_method_missing');
            const wrapper = function(this: Map<unknown, unknown>, ...args: unknown[]): unknown {
                if (this !== map) throw new Error('component_sdk_timer_trace_identity_changed');
                const result = Reflect.apply(method, this, args);
                record({ method: name, key: typeof args[0] === 'string' ? args[0] : null,
                    value: typeof args[1] === 'number' ? args[1] : null,
                    result: typeof result === 'boolean' || typeof result === 'number' ? result : null,
                    at: Date.now(), stack: new Error('sdk-timer-observation').stack });
                return result;
            };
            originals.set(name, { descriptor, method, wrapper });
            Object.defineProperty(map, name, { configurable: true, writable: true, value: wrapper });
        }
        return (): void => {
            for (const [name, original] of originals) {
                if (Reflect.get(map, name) !== original.wrapper) throw new Error('component_sdk_timer_trace_patch_changed');
                if (original.descriptor) Object.defineProperty(map, name, original.descriptor); else Reflect.deleteProperty(map, name);
            }
        };
    }
}
