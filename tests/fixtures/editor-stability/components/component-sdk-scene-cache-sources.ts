/**
 * @description 只观察已装载的固定SDK场景缓存模块方法文本，不调用缓存、加载模块或读取场景数据。
 */
export class ComponentSdkSceneCacheSources {
    /**
     * @description 有界读取原模块自身及导出类的原型数据描述符，不求值getter或执行任何方法。
     */
    public static read(cache: Readonly<Record<string, unknown>>): unknown {
        const suffix = '/app.asar/builtin/scene/dist/browser/scene-cache.ccc';
        return Object.entries(cache).filter(([path]) => path.endsWith(suffix)).map(([path, module]) => {
            const exported = this.data(module, 'exports');
            const owners: [string, unknown][] = [['exports', exported]];
            const descriptors = exported && ['object', 'function'].includes(typeof exported) ? Object.getOwnPropertyDescriptors(exported) : {};
            if (Object.keys(descriptors).length > 32) throw new Error('component_sdk_cache_exports_over_budget');
            for (const [key, descriptor] of Object.entries(descriptors)) {
                const value: unknown = descriptor.value;
                if (typeof value === 'function') owners.push([key + '.prototype', this.data(value, 'prototype')]);
                else if (value && typeof value === 'object') owners.push([key, value], [key + '.prototype', Object.getPrototypeOf(value)]);
            }
            const methods: unknown[] = []; let bytes = 0;
            for (const [owner, object] of owners) {
                if (!object || !['object', 'function'].includes(typeof object)) continue;
                for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
                    const method: unknown = descriptor.value;
                    if (name === 'constructor' || typeof method !== 'function') continue;
                    const source = Function.prototype.toString.call(method);
                    if (source.startsWith('class ') || source.includes('[native code]')) continue;
                    bytes += source.length;
                    if (source.length > 65536 || bytes > 262144 || methods.length >= 64) throw new Error('component_sdk_cache_methods_over_budget');
                    methods.push({ owner, name, source });
                }
            }
            return { module: path.slice(path.indexOf('/app.asar/') + '/app.asar/'.length), exportNames: Object.keys(descriptors), methods };
        });
    }

    /**
     * @description 只取数据描述符；拒绝把第三方getter当只读字段。
     */
    private static data(value: unknown, key: string): unknown {
        return value && ['object', 'function'].includes(typeof value) ? Object.getOwnPropertyDescriptor(value, key)?.value : null;
    }
}
