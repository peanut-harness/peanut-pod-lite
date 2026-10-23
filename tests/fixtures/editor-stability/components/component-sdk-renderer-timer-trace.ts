import { createHash } from 'node:crypto';

/**
 * @description 透明观察精确SDK renderer发送的两个计时标签，保留原this、参数、Sender/Promise身份及异常。
 */
export class ComponentSdkRendererTimerTrace {
    private static readonly marker = Symbol.for('peanut.component.sdk-renderer-timer-trace');

    /**
     * @description 只包装已缓存SDK IPC导出的send，不加载SDK模块、不改消息或计时数据。
     */
    public static install(cache: Record<string, any>, version: string, scope: string, role: string) {
        if (version !== '3.8.7' || !scope) throw new Error('component_sdk_renderer_trace_scope_unverified');
        const targets = Object.entries(cache).filter(([path]) => /\/app\.asar\/node_modules\/@base\/electron-base-ipc\/dist\/(?:index\.js|renderer\.ccc)$/u.test(path))
            .map(([path, entry]) => ({ path, owner: entry?.exports })).filter(item => typeof Object.getOwnPropertyDescriptor(item.owner ?? {}, 'send')?.value === 'function');
        const owners = targets.filter((item, index) => targets.findIndex(candidate => candidate.owner === item.owner) === index);
        if (!owners.length) throw new Error('component_sdk_renderer_trace_ipc_unavailable');
        for (const item of owners) {
            const descriptor = Object.getOwnPropertyDescriptor(item.owner, 'send')!;
            if (!descriptor.configurable && !descriptor.writable) throw new Error('component_sdk_renderer_trace_send_readonly');
            if (!Reflect.has(item.owner, this.marker) && !Object.isExtensible(item.owner)) throw new Error('component_sdk_renderer_trace_owner_readonly');
        }
        let control: any = owners.map(item => Reflect.get(item.owner, this.marker)).find(Boolean);
        if (control) {
            if (control.state.scope !== scope || !control.state.installed || !owners.every(item => Reflect.get(item.owner, this.marker) === control))
                throw new Error('component_sdk_renderer_trace_owner_mismatch');
            control.leases++; if (!control.state.roles.includes(role)) control.state.roles.push(role);
        } else {
            const state = { installed: true, complete: true, creatorVersion: version, scope, roles: [role], processPid: process.pid,
                sourceOwners: [] as { module: string; sha256: string }[], entries: [] as { label: string; at: number; stack: string | null }[] };
            control = { state, leases: 1, depth: 0, patches: [] as any[] };
            for (const item of owners) {
                const descriptor = Object.getOwnPropertyDescriptor(item.owner, 'send')!; const original = descriptor.value;
                state.sourceOwners.push({ module: item.path.slice(item.path.indexOf('/app.asar/') + '/app.asar/'.length),
                    sha256: createHash('sha256').update(Function.prototype.toString.call(original)).digest('hex') });
                const shim = { send(this: any, ...args: unknown[]): unknown {
                    const label = typeof args[1] === 'string' ? args[1] : null;
                    const relevant = args[0] === 'metrics:track-time-end' && label !== null && ['main-window:ready', 'hierarchy:render-tree'].includes(label);
                    if (relevant && control.depth === 0) {
                        if (state.entries.length < 512) state.entries.push({ label: label!, at: Date.now(), stack: new Error('sdk-renderer-timer-observation').stack ?? null });
                        else state.complete = false;
                    }
                    control.depth++;
                    try { return original.apply(this, args); } finally { control.depth--; }
                } };
                Object.defineProperty(shim.send, 'length', { value: original.length });
                Object.defineProperty(shim.send, 'name', { value: original.name });
                Object.defineProperty(item.owner, 'send', { ...descriptor, value: shim.send });
                Object.defineProperty(item.owner, this.marker, { configurable: true, value: control });
                control.patches.push({ owner: item.owner, descriptor, replacement: shim.send });
            }
        }
        Reflect.set(globalThis, this.marker, control); let released = false;
        return { state: control.state, restore: (): void => {
            if (released) throw new Error('component_sdk_renderer_trace_release_repeated'); released = true;
            if (--control.leases > 0) return;
            for (const patch of control.patches) {
                if (patch.owner.send !== patch.replacement) throw new Error('component_sdk_renderer_trace_patch_identity_changed');
                Object.defineProperty(patch.owner, 'send', patch.descriptor); Reflect.deleteProperty(patch.owner, this.marker);
            }
            control.state.installed = false;
        } };
    }

    /**
     * @description 仅导出本观测器拥有的计时调用栈，不暴露函数引用、其它IPC参数或SDK状态。
     */
    public static snapshot(): unknown { return Reflect.get(globalThis, this.marker)?.state ?? null; }
}
