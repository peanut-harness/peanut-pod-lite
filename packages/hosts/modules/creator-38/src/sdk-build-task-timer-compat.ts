'use strict';

type TimerMap = {
    set: (key: string, value: number) => unknown;
    has: (key: string) => boolean;
    get: (key: string) => number | undefined;
    delete: (key: string) => boolean;
};
type TimerEntry = { readonly route: string };
type TimerPatch = { retain(): TimerPatch; restore(): boolean };

/**
 * @description Creator 3.8.7 的 Builder 复用同一 Map key 并发计时；在 SDK 共享 Map 上隔离重叠 key。
 */
export class SdkBuildTaskTimerCompat {
    private static readonly labels = new Set([
        '// ---- build task 查询 Asset Bundle ----',
        '// ---- build task 整理部分构建选项内数据到 settings.json ----',
    ]);
    private static readonly installed = new WeakMap<object, TimerPatch>();

    /**
     * @description 只对已实测 3.8.7 和两个复现标签安装；用 SDK 共享计时表处理跨模块调用。
     */
    public static install(editor: unknown): TimerPatch {
        const app = this.field(editor, 'App');
        if (this.field(app, 'version') !== '3.8.7') return { retain() { return this; }, restore: () => true };
        const metrics = this.field(editor, 'Metrics');
        const protectedApi = this.field(metrics, '__protected__');
        const getMap = this.field(protectedApi, 'getTrackTimeStartMap');
        if (typeof getMap !== 'function') throw new Error('peanut_sdk_build_task_timer_map_api_unavailable');
        const map = Reflect.apply(getMap, protectedApi, []);
        if (!this.timerMap(map)) throw new Error('peanut_sdk_build_task_timer_map_invalid');
        const existing = this.installed.get(map);
        if (existing) return existing.retain();

        const original = { set: map.set, has: map.has, get: map.get, delete: map.delete };
        const descriptors = {
            set: Object.getOwnPropertyDescriptor(map, 'set'),
            has: Object.getOwnPropertyDescriptor(map, 'has'),
            get: Object.getOwnPropertyDescriptor(map, 'get'),
            delete: Object.getOwnPropertyDescriptor(map, 'delete'),
        };
        const active = new Map<string, TimerEntry[]>();
        const selected = new Map<string, string>();
        let sequence = 0;
        let restoreRequested = false;
        let restored = false;

        const keyFor = (label: string): string => selected.get(label) ?? active.get(label)?.[0]?.route ?? label;
        const restoreNow = (): boolean => {
            if (restored) return true;
            if ([...active.values()].some(entries => entries.length > 0)) return false;
            if (map.set !== replacement.set || map.has !== replacement.has || map.get !== replacement.get
                || map.delete !== replacement.delete) throw new Error('peanut_sdk_build_task_timer_map_patch_identity_changed');
            for (const key of ['set', 'has', 'get', 'delete'] as const) {
                if (descriptors[key]) Object.defineProperty(map, key, descriptors[key]);
                else delete (map as unknown as Record<string, unknown>)[key];
            }
            restored = true;
            this.installed.delete(map);
            return true;
        };
        const releaseEntry = (label: string, route: string): void => {
            const entries = active.get(label);
            const index = entries?.findIndex(entry => entry.route === route) ?? -1;
            if (entries && index >= 0) {
                entries.splice(index, 1);
                if (entries.length === 0) active.delete(label);
            }
            if (restoreRequested) restoreNow();
        };
        const replacement: Record<keyof TimerMap, TimerMap[keyof TimerMap]> = {
            set: function(this: TimerMap, key: string, value: number): unknown {
                if (typeof key !== 'string' || !SdkBuildTaskTimerCompat.labels.has(key))
                    return Reflect.apply(original.set, this, [key, value]);
                const entries = active.get(key) ?? [];
                const route = entries.length === 0 ? key : `${key} [peanut-overlap-${++sequence}]`;
                const result = Reflect.apply(original.set, this, [route, value]);
                entries.push({ route });
                active.set(key, entries);
                return result;
            },
            has: function(this: TimerMap, key: string): boolean {
                if (typeof key !== 'string' || !SdkBuildTaskTimerCompat.labels.has(key))
                    return Reflect.apply(original.has, this, [key]);
                const route = keyFor(key);
                selected.set(key, route);
                const result = Reflect.apply(original.has, this, [route]);
                if (!result) selected.delete(key);
                return result;
            },
            get: function(this: TimerMap, key: string): number | undefined {
                if (typeof key !== 'string' || !SdkBuildTaskTimerCompat.labels.has(key))
                    return Reflect.apply(original.get, this, [key]);
                return Reflect.apply(original.get, this, [keyFor(key)]);
            },
            delete: function(this: TimerMap, key: string): boolean {
                if (typeof key !== 'string' || !SdkBuildTaskTimerCompat.labels.has(key))
                    return Reflect.apply(original.delete, this, [key]);
                const route = keyFor(key);
                selected.delete(key);
                const result = Reflect.apply(original.delete, this, [route]);
                if (result) releaseEntry(key, route);
                return result;
            },
        };

        const installed = new Set<keyof TimerMap>();
        try {
            for (const key of ['set', 'has', 'get', 'delete'] as const) {
                Object.defineProperty(map, key, { configurable: true, enumerable: descriptors[key]?.enumerable ?? false,
                    writable: true, value: replacement[key] });
                installed.add(key);
            }
        } catch (error) {
            for (const key of installed) {
                if (descriptors[key]) Object.defineProperty(map, key, descriptors[key]);
                else delete (map as unknown as Record<string, unknown>)[key];
            }
            throw error;
        }

        const patch: TimerPatch = {
            retain() { restoreRequested = false; return patch; },
            restore() { restoreRequested = true; return restoreNow(); },
        };
        this.installed.set(map, patch);
        return patch;
    }

    private static field(value: unknown, key: string): unknown {
        return value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
    }

    private static timerMap(value: unknown): value is TimerMap {
        return !!value && typeof value === 'object' && typeof Reflect.get(value, 'set') === 'function'
            && typeof Reflect.get(value, 'has') === 'function' && typeof Reflect.get(value, 'get') === 'function'
            && typeof Reflect.get(value, 'delete') === 'function';
    }
}
