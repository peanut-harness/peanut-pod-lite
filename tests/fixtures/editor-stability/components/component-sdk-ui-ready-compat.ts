import { createHash } from 'node:crypto';

/**
 * @description 精确SDK启动标记在实际计时后消费；真实层级树ready串行执行，保留SDK逻辑及异常。
 */
export class ComponentSdkUiReadyCompat {
    /**
     * @description 只匹配实机冻结的广播和层级树函数，未知实现拒绝在任何状态改变前安装。
     */
    public static install(cache: Record<string, any>, rootWindow: any, version: string) {
        if (!['3.8.3', '3.8.7'].includes(version)) throw new Error('component_sdk_ui_ready_version_unverified');
        const module = (suffix: string): any => {
            const matches = Object.entries(cache).filter(([path]) => path.endsWith('/app.asar/' + suffix));
            if (matches.length !== 1) throw new Error('component_sdk_ui_ready_module_identity_invalid:' + suffix);
            return matches[0][1]?.exports;
        };
        const broadcast = module('builtin/scene/dist/panel/message/broadcast.ccc');
        const hierarchy = module('modules/editor-extensions/extensions/hierarchy/dist/panel.ccc');
        const owner = hierarchy?.methods; const original = owner?.ready;
        const hash = (value: Function): string => createHash('sha256').update(Function.prototype.toString.call(value)).digest('hex');
        const broadcastHash = version === '3.8.3' ? '9104fd9001138adeabcccc8b20b85d95f2f5d0c66efc4f568b18c0f062535e3d'
            : 'b46ca6c691343f753c5964d765b37b71da0d647f26926ee7d469b629a4e2f3a7';
        if (typeof broadcast?.apply !== 'function' || hash(broadcast.apply) !== broadcastHash
            || typeof original !== 'function' || hash(original) !== 'fa0ed17e2f7a5d5d3630d974800dcb9bde348e7a95cc61d0a7a04ad629820060')
            throw new Error('component_sdk_ui_ready_source_mismatch');
        const descriptor = Object.getOwnPropertyDescriptor(owner, 'ready');
        const marker = Object.getOwnPropertyDescriptor(rootWindow, '__InitializationTimeEnd__');
        if (!descriptor || (!descriptor.configurable && !descriptor.writable) || (marker && (!('value' in marker)
            || typeof marker.value !== 'number' || !Number.isFinite(marker.value) || marker.value <= 0 || (!marker.configurable && !marker.writable))))
            throw new Error('component_sdk_ui_ready_state_unverified');
        const element = module('node_modules/@editor/panel/lib/element.ccc');
        const querySource = 'query(e){const t=name2panel[e];return t?0===t.length?t[0]:t:null}';
        if (typeof element?.query !== 'function' || Function.prototype.toString.call(element.query) !== querySource)
            throw new Error('component_sdk_ui_ready_panel_query_unverified');
        const panels = element.query('hierarchy');
        if (!Array.isArray(panels) || panels.length !== 1) throw new Error('component_sdk_ui_ready_panel_not_unique');
        const entries: { owner: any; key: string; descriptor: PropertyDescriptor; original: Function }[] = [];
        const seen = new Set<object>();
        const walk = (value: any, depth: number): void => {
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 4) return;
            if (seen.size >= 64) throw new Error('component_sdk_ui_ready_panel_budget_exceeded'); seen.add(value);
            for (const key of Object.getOwnPropertyNames(value)) {
                if (['$', 'root', 'shadowRoot', 'userData', 'constructor', '__proto__'].includes(key)) continue;
                const property = Object.getOwnPropertyDescriptor(value, key); if (!property || !('value' in property)) continue;
                if (typeof property.value === 'function' && hash(property.value) === 'fa0ed17e2f7a5d5d3630d974800dcb9bde348e7a95cc61d0a7a04ad629820060') {
                    if (!property.configurable && !property.writable) throw new Error('component_sdk_ui_ready_panel_method_immutable');
                    entries.push({ owner: value, key, descriptor: property, original: property.value });
                } else if (property.value && Object.prototype.toString.call(property.value) === '[object Object]') walk(property.value, depth + 1);
            }
        };
        walk(Object.getOwnPropertyDescriptor(panels[0], 'panel')?.value, 0);
        walk(Object.getOwnPropertyDescriptor(panels[0], 'option')?.value, 0);
        if (!entries.some(entry => entry.owner !== owner)) throw new Error('component_sdk_ui_ready_runtime_method_not_found:'
            + JSON.stringify(['panel', 'option'].map(key => ({ key, names: Object.keys(Object.getOwnPropertyDescriptor(panels[0], key)?.value ?? {}) }))));
        if (!entries.some(entry => entry.owner === owner && entry.key === 'ready')) entries.push({ owner, key: 'ready', descriptor, original });
        const state = { installed: true, creatorVersion: version, initializationTimeEnd: marker?.value ?? null,
            startupMarkerConsumed: true, runtimeMethods: entries.length, calls: 0, active: 0, maximumActive: 0 };
        const queue = { tail: Promise.resolve() };
        const replacements = entries.map(entry => ({ ...entry, shim: { async ready(this: any, ...args: any[]): Promise<unknown> {
            state.calls++; const previous = queue.tail; let release!: () => void;
            queue.tail = new Promise<void>(resolve => { release = resolve; }); await previous;
            state.active++; state.maximumActive = Math.max(state.maximumActive, state.active);
            try { return await entry.original.apply(this, args); } finally { state.active--; release(); }
        } } }));
        // 原SDK广播的hideLoading分支仍每次运行；这里只消费已经完成的那次启动计时条件。
        if (marker?.configurable) Reflect.deleteProperty(rootWindow, '__InitializationTimeEnd__');
        else if (marker) Object.defineProperty(rootWindow, '__InitializationTimeEnd__', { ...marker, value: undefined });
        for (const entry of replacements) Object.defineProperty(entry.owner, entry.key, { ...entry.descriptor, value: entry.shim.ready });
        return { state, idle: (): Promise<void> => queue.tail, restore: (): void => {
            if (replacements.some(entry => entry.owner[entry.key] !== entry.shim.ready)) throw new Error('component_sdk_ui_ready_patch_identity_changed');
            for (const entry of replacements) Object.defineProperty(entry.owner, entry.key, entry.descriptor); state.installed = false;
            // 已完成的启动阶段不会因卸载兼容扩展而重新开始，故不重新激活旧启动标记。
        } };
    }
}
