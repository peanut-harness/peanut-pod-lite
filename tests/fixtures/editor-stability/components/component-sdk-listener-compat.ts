import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';

/**
 * @description 修复精确3.8.7 SDK重复初始化覆盖自身回调引用的问题，不触碰其它监听器或警告阈值。
 */
export class ComponentSdkListenerCompat {
    /**
     * @description 实机读取的SDK函数原始文本摘要；未知实现直接拒绝，不猜测兼容性。
     */
    private static readonly _sources: Record<string, string> = {
        init: 'db2ae3b174d137ab6a9340b4d1f10dca65ec547b6c13e5ffb37eadfcbf700b91',
        registerCompMgrEvents: '7ae0204f1176a4be8d581a33c645597185d8bb0015b8c75e17a7690274bd6864',
        unregisterCompMgrEvents: 'ac9dc6cf0c724d2dd84cb07fdb5037cc8d19071a3c2ad4a4e3b59ce7c8f86a45',
    };

    /**
     * @description 每次重新注册前，通过SDK原有配对方法仅释放该管理器自己保存的旧回调。
     */
    public static install(manager: any, emitter: EventEmitter, version: string) {
        if (version !== '3.8.7') throw new Error('component_sdk_listener_version_unverified');
        for (const [name, expected] of Object.entries(this._sources)) {
            if (typeof manager?.[name] !== 'function' || createHash('sha256').update(Function.prototype.toString.call(manager[name])).digest('hex') !== expected)
                throw new Error('component_sdk_listener_source_mismatch:' + name);
        }
        const initial = { add: emitter.listenerCount('add'), remove: emitter.listenerCount('remove'), maximum: emitter.getMaxListeners() };
        if (initial.add > 1 || initial.remove > 1) throw new Error('component_sdk_listener_requires_fresh_scene_process');
        const original = manager.registerCompMgrEvents; const release = manager.unregisterCompMgrEvents;
        const descriptor = Object.getOwnPropertyDescriptor(manager, 'registerCompMgrEvents');
        const state = { installed: true, creatorVersion: version, initial, registrations: 0, maximum: initial.maximum };
        const replacement = function(this: any): void {
            if (this !== manager) throw new Error('component_sdk_listener_manager_identity_changed');
            const before = { add: emitter.listenerCount('add'), remove: emitter.listenerCount('remove') };
            const ownedAdd = typeof this._onCompAdded === 'function' && emitter.rawListeners('add').includes(this._onCompAdded) ? 1 : 0;
            const ownedRemove = typeof this._onCompRemoved === 'function' && emitter.rawListeners('remove').includes(this._onCompRemoved) ? 1 : 0;
            release.call(this); original.call(this); state.registrations++;
            if (emitter.getMaxListeners() !== initial.maximum || emitter.listenerCount('add') !== before.add - ownedAdd + 1
                || emitter.listenerCount('remove') !== before.remove - ownedRemove + 1) throw new Error('component_sdk_listener_pair_invariant_failed');
        };
        Object.defineProperty(manager, 'registerCompMgrEvents', { configurable: true, writable: true, value: replacement });
        return { state, restore: (): void => {
            if (manager.registerCompMgrEvents !== replacement) throw new Error('component_sdk_listener_patch_identity_changed');
            if (descriptor) Object.defineProperty(manager, 'registerCompMgrEvents', descriptor);
            else delete manager.registerCompMgrEvents;
            state.installed = false;
        } };
    }
}
