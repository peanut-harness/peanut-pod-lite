import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @description 修复精确3.8.3 SDK清理尚未创建缓存目录的非幂等路径，保留存在目录的原SDK删除及全部诊断。
 */
export class ComponentSdkSceneCacheCompat {
    /**
     * @description 来自实际已加载SDK的原方法摘要，未知实现不得进入修复分支。
     */
    private static readonly hashes: Readonly<Record<string, string>> = {
        getCachePath: '569dd8b05e3595a346925d7f5c2bdb3f6b30339ec218ce2e32cde21209e7809e',
        clearSceneCache: '020a514f09dd5fe1d4a2a128285ce9fcb0a459a6a3a67513d882a406231863f3',
        getCurrentSceneUUID: '9dc9d97e4172ba348a17d34d45fc472deb1f097ed066200f6b20a35d93adf121',
        getCurrentCacheID: '8325cd2f120e5cfb18e2ae50f076125c551f46e4ddf82742ca56db450dec70fa',
        onSceneReady: '277efba2ac38b022afca563f3be91ab103ccead01070e16efd5b4e6ceb55c115',
    };

    /**
     * @description 仅替换当前工程单例的clear；lstat是只读，除ENOENT外的IO问题完整抛出。
     */
    public static install(namespace: unknown, project: string, version: string, changed: () => void = () => {},
        directoryExists: (path: string) => boolean = path => {
            try { if (!lstatSync(path).isDirectory()) throw new Error('component_sdk_cache_path_not_directory'); return true; }
            catch (error) { if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return false; throw error; }
        }) {
        if (version !== '3.8.3') throw new Error('component_sdk_cache_version_unverified');
        const manager = this.data(namespace, 'sceneCacheManager');
        if (!manager || typeof manager !== 'object') throw new Error('component_sdk_cache_manager_missing');
        const methods = new Map<string, Function>();
        for (const [name, hash] of Object.entries(this.hashes)) {
            const method = this.data(name === 'getCachePath' ? namespace : manager, name);
            if (typeof method !== 'function' || this.hash(method) !== hash) throw new Error('component_sdk_cache_source_mismatch:' + name);
            methods.set(name, method);
        }
        const invoke = (name: string, args: unknown[] = []): unknown => {
            const method = methods.get(name); if (!method) throw new Error('component_sdk_cache_method_missing');
            return Reflect.apply(method, name === 'getCachePath' ? namespace : manager, args);
        };
        const root = join(project, 'temp/scene/cache');
        const sample = invoke('getCachePath', ['00000000-0000-0000-0000-000000000000', 0]);
        if (typeof sample !== 'string' || dirname(dirname(sample)) !== root) throw new Error('component_sdk_cache_project_scope_mismatch');
        const original = methods.get('clearSceneCache'); if (!original) throw new Error('component_sdk_cache_original_missing');
        const descriptor = Object.getOwnPropertyDescriptor(manager, 'clearSceneCache');
        const state: { installed: boolean; creatorVersion: string; absentCleared: number; originalDelegated: number;
            last: { kind: string; sceneUuid: string; cacheId: string } | null } = {
            installed: true, creatorVersion: version, absentCleared: 0, originalDelegated: 0, last: null,
        };
        const replacement = async function(this: unknown, input?: unknown): Promise<unknown> {
            if (this !== manager) throw new Error('component_sdk_cache_receiver_mismatch');
            if (ComponentSdkSceneCacheCompat.data(manager, 'disabled')) return;
            const sceneUuid = input || await invoke('getCurrentSceneUUID'); if (!sceneUuid) return;
            const cacheId = await invoke('getCurrentCacheID', [sceneUuid]);
            if (typeof sceneUuid !== 'string' || typeof cacheId !== 'string'
                || !/^(?:unSave|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/iu.test(cacheId)) throw new Error('component_sdk_cache_identity_invalid');
            const path = invoke('getCachePath', [cacheId, 0]);
            if (typeof path !== 'string' || dirname(path) !== join(root, cacheId)) throw new Error('component_sdk_cache_directory_scope_mismatch');
            if (directoryExists(dirname(path))) {
                state.originalDelegated++; state.last = { kind: 'original-sdk-delete', sceneUuid, cacheId }; changed();
                return Reflect.apply(original, manager, [sceneUuid]);
            }
            const timers = ComponentSdkSceneCacheCompat.data(manager, 'cacheTimerList');
            const json = ComponentSdkSceneCacheCompat.data(manager, 'cacheJsonList');
            if (!timers || typeof timers !== 'object' || !json || typeof json !== 'object') throw new Error('component_sdk_cache_state_changed');
            if (!Reflect.deleteProperty(timers, cacheId) || !Reflect.deleteProperty(json, cacheId)
                || !Reflect.set(manager, '_currentSceneUUID', '')) throw new Error('component_sdk_cache_state_cleanup_failed');
            state.absentCleared++; state.last = { kind: 'absent-cache-state-cleared', sceneUuid, cacheId }; changed();
        };
        Object.defineProperty(manager, 'clearSceneCache', { value: replacement, configurable: true, writable: true });
        return { state, isInstalled: (): boolean => Object.getOwnPropertyDescriptor(manager, 'clearSceneCache')?.value === replacement, restore: (): void => {
            if (Object.getOwnPropertyDescriptor(manager, 'clearSceneCache')?.value !== replacement) throw new Error('component_sdk_cache_patch_identity_changed');
            if (descriptor) Object.defineProperty(manager, 'clearSceneCache', descriptor); else Reflect.deleteProperty(manager, 'clearSceneCache');
            state.installed = false; changed();
        } };
    }

    /**
     * @description 沿有界原型链只读数据描述符，不执行getter。
     */
    private static data(value: unknown, key: string): unknown {
        let current = value;
        for (let depth = 0; current && ['object', 'function'].includes(typeof current) && depth < 8; depth++) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor) return descriptor.value;
            current = Object.getPrototypeOf(current);
        }
        return undefined;
    }

    /**
     * @description 只比较原方法文本摘要，不求值或重编译SDK源码。
     */
    private static hash(method: Function): string { return createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex'); }
}
