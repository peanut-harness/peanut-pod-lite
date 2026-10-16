import { createHash } from 'node:crypto';

/**
 * @description 精确SDK启动标记在实际计时后消费；真实层级树ready串行执行，保留SDK逻辑及异常。
 */
export class ComponentSdkUiReadyCompat {
    /**
     * @description 只匹配实机冻结的广播和层级树函数，未知实现拒绝在任何状态改变前安装。
     */
    public static install(cache: Record<string, any>, rootWindow: any, version: string) {
        if (version !== '3.8.7') throw new Error('component_sdk_ui_ready_version_unverified');
        const module = (suffix: string): any => {
            const matches = Object.entries(cache).filter(([path]) => path.endsWith('/app.asar/' + suffix));
            if (matches.length !== 1) throw new Error('component_sdk_ui_ready_module_identity_invalid:' + suffix);
            return matches[0][1]?.exports;
        };
        const broadcast = module('builtin/scene/dist/panel/message/broadcast.ccc');
        const hierarchy = module('modules/editor-extensions/extensions/hierarchy/dist/panel.ccc');
        const owner = hierarchy?.methods; const original = owner?.ready;
        const hash = (value: Function): string => createHash('sha256').update(Function.prototype.toString.call(value)).digest('hex');
        if (typeof broadcast?.apply !== 'function' || hash(broadcast.apply) !== 'b46ca6c691343f753c5964d765b37b71da0d647f26926ee7d469b629a4e2f3a7'
            || typeof original !== 'function' || hash(original) !== 'fa0ed17e2f7a5d5d3630d974800dcb9bde348e7a95cc61d0a7a04ad629820060')
            throw new Error('component_sdk_ui_ready_source_mismatch');
        const descriptor = Object.getOwnPropertyDescriptor(owner, 'ready');
        const marker = Object.getOwnPropertyDescriptor(rootWindow, '__InitializationTimeEnd__');
        if (!descriptor || (!descriptor.configurable && !descriptor.writable) || (marker && (!('value' in marker)
            || typeof marker.value !== 'number' || !Number.isFinite(marker.value) || marker.value <= 0 || (!marker.configurable && !marker.writable))))
            throw new Error('component_sdk_ui_ready_state_unverified');
        const state = { installed: true, creatorVersion: version, initializationTimeEnd: marker?.value ?? null,
            startupMarkerConsumed: true, calls: 0, active: 0, maximumActive: 0 };
        const queue = { tail: Promise.resolve() };
        const shim = { async ready(this: any, ...args: any[]): Promise<unknown> {
            state.calls++; const previous = queue.tail; let release!: () => void;
            queue.tail = new Promise<void>(resolve => { release = resolve; }); await previous;
            state.active++; state.maximumActive = Math.max(state.maximumActive, state.active);
            try { return await original.apply(this, args); } finally { state.active--; release(); }
        } };
        // 原SDK广播的hideLoading分支仍每次运行；这里只消费已经完成的那次启动计时条件。
        if (marker?.configurable) Reflect.deleteProperty(rootWindow, '__InitializationTimeEnd__');
        else if (marker) Object.defineProperty(rootWindow, '__InitializationTimeEnd__', { ...marker, value: undefined });
        Object.defineProperty(owner, 'ready', { ...descriptor, value: shim.ready });
        return { state, idle: (): Promise<void> => queue.tail, restore: (): void => {
            if (owner.ready !== shim.ready) throw new Error('component_sdk_ui_ready_patch_identity_changed');
            Object.defineProperty(owner, 'ready', descriptor); state.installed = false;
            // 已完成的启动阶段不会因卸载兼容扩展而重新开始，故不重新激活旧启动标记。
        } };
    }
}
