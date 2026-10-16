/**
 * @description 固定SDK计时器和场景生命周期的只读诊断，不调用重置、注册或释放接口。
 */
export class ComponentSdkDiagnostics {
    /**
     * @description 只观察已经装载的固定SDK模块，不require新模块，也不读取统计事件数据。
     */
    public static adapters(cache: Record<string, any>): unknown {
        const prefix = '/app.asar/node_modules/@editor/creator/dist/metrics/';
        return Object.entries(cache).filter(([path]) => path.includes(prefix)).map(([path, entry]) => {
            const value = entry?.exports;
            return { module: path.slice(path.indexOf(prefix) + prefix.length), exportNames: Object.keys(value ?? {}).sort(),
                sources: this.sources(value, ['trackTimeStart', 'trackTimeEnd', 'reset']),
                adapter: this.sources(value?.adapter, ['trackTimeStart', 'trackTimeEnd']),
                default: this.sources(value?.default, ['trackTimeStart', 'trackTimeEnd']),
                defaultPrototype: this.sources(typeof value?.default === 'function' ? value.default.prototype : null,
                    ['trackTimeStart', 'trackTimeEnd']) };
        });
    }
    /**
     * @description 只返回真实计时事件与起始缓存，不读取账号或其它统计事件内容。
     */
    public static metrics(metrics: any): unknown {
        const api = metrics?.__protected__;
        if (typeof api?.getTrackTimeStartMap !== 'function' || typeof api?.getTrackInfoList !== 'function')
            throw new Error('component_sdk_metrics_diagnostics_unavailable');
        const starts = api.getTrackTimeStartMap(); const queue = api.getTrackInfoList();
        if (Object.prototype.toString.call(starts) !== '[object Map]' || !Array.isArray(queue)) throw new Error('component_sdk_metrics_diagnostics_shape_invalid');
        return { starts: [...starts.entries()], timers: queue.filter(item => ['trackTimeStart', 'trackTimeEnd'].includes(item.funcName))
            .map(item => ({ index: item.index, time: item.time, funcName: item.funcName,
                message: typeof item.info === 'string' ? item.info : item.info?.message, explicitDuration: item.info?.options?.value })),
            sources: { public: this.sources(metrics, ['trackTimeStart', 'trackTimeEnd']),
                protected: this.sources(api, ['register', 'reset', 'getTrackTimeStartMap', 'getTrackInfoList']) } };
    }

    /**
     * @description 固定读取SDK已装载生命周期方法的函数文本，既不执行文本也不更改监听器。
     */
    public static lifecycle(cce: any): unknown {
        return { component: this.sources(cce?.Component, ['init', 'registerCompMgrEvents', 'unregisterCompMgrEvents', 'clear']),
            node: this.sources(cce?.Node, ['initWithScene', 'onSceneOpened', 'onSceneClosed', 'clear']),
            facade: this.sources(cce?.SceneFacadeManager, ['openScene', 'closeScene', 'onSceneOpened', 'getCurrentFacade']) };
    }

    /**
     * @description 仅允许调用方固定的方法名，沿至多两层原型读取数据属性，不触发getter。
     */
    private static sources(owner: any, names: readonly string[]): Record<string, string | null> {
        return Object.fromEntries(names.map(name => {
            let current = owner; let value: unknown;
            for (let depth = 0; current && depth < 3; depth++, current = Object.getPrototypeOf(current)) {
                const descriptor = Object.getOwnPropertyDescriptor(current, name);
                if (descriptor) { value = descriptor.value; break; }
            }
            const source = typeof value === 'function' ? Function.prototype.toString.call(value) : null;
            if (source && source.length > 65536) throw new Error('component_sdk_diagnostic_source_over_budget');
            return [name, source];
        }));
    }
}
