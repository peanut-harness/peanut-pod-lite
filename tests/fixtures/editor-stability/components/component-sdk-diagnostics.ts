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
     * @description 只读SDK计时IPC监听器与固定SDK模块中涉及计时的已加载方法，不加载或执行模块。
     */
    public static timerRoutes(cache: Record<string, any>, ipc: any): unknown {
        const names = typeof ipc?.eventNames === 'function' ? ipc.eventNames().filter((name: unknown) => typeof name === 'string') : [];
        const ipcRoutes = names.filter((name: string) => name.startsWith('metrics:')).map((name: string) => ({ name,
            sources: ipc.rawListeners(name).map((listener: Function) => Function.prototype.toString.call(listener)) }));
        const prefixes = ['/app.asar/builtin/asset-db/dist/browser/', '/app.asar/modules/editor-extensions/extensions/hierarchy/dist/',
            '/app.asar/modules/editor-extensions/extensions/scene/dist/',
            '/app.asar/node_modules/@editor/creator/dist/metrics/', '/app.asar/node_modules/@editor/creator/dist/window/'];
        const methods: unknown[] = [];
        for (const [path, entry] of Object.entries(cache)) {
            if (!prefixes.some(prefix => path.includes(prefix))) continue;
            const value = entry?.exports;
            const owners: [string, any][] = [['exports', value], ['methods', value?.methods], ['default', value?.default],
                ['default.methods', value?.default?.methods], ['defaultPrototype', value?.default?.prototype]];
            if (value?.default && typeof value.default === 'object') owners.push(['defaultObjectPrototype', Object.getPrototypeOf(value.default)]);
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value ?? {}))) {
                if (typeof descriptor.value === 'function' && descriptor.value.prototype) owners.push([name + '.prototype', descriptor.value.prototype]);
            }
            for (const [label, owner] of owners) {
                if (!owner || !['object', 'function'].includes(typeof owner)) continue;
                for (const name of Object.getOwnPropertyNames(owner)) {
                    if (name === 'constructor') continue;
                    const method = Object.getOwnPropertyDescriptor(owner, name)?.value;
                    if (typeof method !== 'function') continue;
                    const source = Function.prototype.toString.call(method);
                    if (source.startsWith('class ')) continue;
                    if (!/trackTime(?:Start|End)|metrics:track-time-/u.test(source)) continue;
                    if (source.length > 131072 || methods.length >= 128) throw new Error('component_sdk_timer_routes_over_budget');
                    methods.push({ module: path.slice(path.indexOf('/app.asar/') + '/app.asar/'.length), owner: label, name, source });
                }
            }
        }
        const senders = Object.entries(cache).filter(([path]) => path.endsWith('/app.asar/node_modules/@base/electron-base-ipc/dist/sender.ccc'))
            .map(([path, entry]) => ({ module: path.slice(path.indexOf('/app.asar/') + '/app.asar/'.length),
                exportNames: Object.keys(entry?.exports ?? {}), sources: this.sources(entry?.exports, ['WindowSender', 'Sender']) }));
        return { ipcEventNames: names, ipcRoutes, methods, senders, receivers: this.ipcReceivers(cache) };
    }

    /**
     * @description 通过已登记的asset-db只读钩子读取真实工作进程启动方法，不执行数据库或计时操作。
     */
    public static worker(manager: any, metrics: any, cache: Record<string, any>): unknown {
        const methods: unknown[] = [];
        const owners: [string, any][] = [['assetDBManager', manager?.assetDBManager]];
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(manager?.assetDBManager?.assetDBMap ?? {})))
            if ('value' in descriptor) owners.push(['assetDBMap.' + name, descriptor.value]);
        for (const [label, owner] of owners) {
            for (let current = owner, depth = 0; current && depth < 3; current = Object.getPrototypeOf(current), depth++) {
                for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(current))) {
                    if (name === 'constructor' || typeof descriptor.value !== 'function') continue;
                    const source = Function.prototype.toString.call(descriptor.value);
                    if (!/start|init|ready/iu.test(name) && !/trackTime(?:Start|End)/u.test(source)) continue;
                    if (source.length > 131072 || methods.length >= 128) throw new Error('component_sdk_worker_sources_over_budget');
                    methods.push({ owner: label, depth, name, source });
                }
            }
        }
        return { methods, metrics: this.metrics(metrics), adapters: this.adapters(cache) };
    }

    /**
     * @description 有界读取SDK IPC实例的计时回调及结构名；不调用路由、遍历其它事件内容或读取getter。
     */
    private static ipcReceivers(cache: Record<string, any>): unknown {
        const roots: unknown[] = []; const handlers: unknown[] = []; const seen = new Set<object>(); let complete = true;
        const walk = (value: any, path: string, depth: number): void => {
            if (typeof value === 'function') {
                if (path.includes('metrics:track-time-')) handlers.push({ path, source: Function.prototype.toString.call(value) });
                return;
            }
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 4) return;
            if (seen.size >= 256) { complete = false; return; }
            seen.add(value);
            if (Object.prototype.toString.call(value) === '[object Map]') {
                for (const [name, item] of value.entries()) if (typeof name === 'string' && (name.includes('metrics') || path.includes('metrics')))
                    walk(item, path + '/' + name, depth + 1);
                return;
            }
            for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
                if (['constructor', 'prototype', '__proto__'].includes(name) || !('value' in descriptor)) continue;
                walk(descriptor.value, path + '/' + name, depth + 1);
            }
        };
        for (const [path, entry] of Object.entries(cache)) {
            if (!path.includes('/app.asar/node_modules/@editor/creator/dist/ipc/') && !path.includes('/app.asar/node_modules/@base/electron-base-ipc/')) continue;
            const module = path.slice(path.indexOf('/app.asar/') + '/app.asar/'.length); const value = entry?.exports;
            roots.push({ module, exportNames: Object.keys(value ?? {}), adapterKeys: Object.keys(value?.adapter ?? {}), defaultKeys: Object.keys(value?.default ?? {}) });
            walk(value, module, 0); walk(value?.adapter, module + '/adapter', 0); walk(value?.default, module + '/default', 0);
        }
        return { complete, inspectedObjects: seen.size, roots, handlers };
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
            node: this.sources(cce?.Node, ['initWithScene', 'onSceneOpened', 'onSceneClosed', 'clear', 'registerNodeMgrEvents', 'unregisterNodeMgrEvents']),
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
