'use strict';

type Metrics = {
    trackTimeStart: (...args: unknown[]) => unknown;
    trackTimeEnd: (...args: unknown[]) => unknown;
};

type TimerEntry = { readonly route: string; ending: boolean };
type TimerPatch = { retain(): TimerPatch; restore(): boolean };

/**
 * @description Creator 3.8.7 的 Builder 复用同一 Map key 并发计时；给重叠计时分配不同 SDK key。
 */
export class SdkBuildTaskTimerCompat {
    private static readonly labels = new Set([
        '// ---- build task 查询 Asset Bundle ----',
        '// ---- build task 整理部分构建选项内数据到 settings.json ----',
    ]);
    private static readonly installed = new WeakMap<object, TimerPatch>();

    /**
     * @description 只对已实测 3.8.7 和两个复现标签安装；未知版本不改 Metrics。
     */
    public static install(editor: unknown): TimerPatch {
        const app = this.field(editor, 'App');
        if (this.field(app, 'version') !== '3.8.7') return { retain() { return this; }, restore: () => true };
        const metrics = this.field(editor, 'Metrics');
        if (!this.record(metrics) || typeof metrics.trackTimeStart !== 'function' || typeof metrics.trackTimeEnd !== 'function')
            throw new Error('peanut_sdk_build_task_timer_api_unavailable');
        const existing = this.installed.get(metrics);
        if (existing) return existing.retain();

        const originalStart = metrics.trackTimeStart;
        const originalEnd = metrics.trackTimeEnd;
        const startDescriptor = Object.getOwnPropertyDescriptor(metrics, 'trackTimeStart');
        const endDescriptor = Object.getOwnPropertyDescriptor(metrics, 'trackTimeEnd');
        const active = new Map<string, TimerEntry[]>();
        let sequence = 0;
        let restoreRequested = false;
        let restored = false;

        const restoreNow = (): boolean => {
            if (restored) return true;
            if ([...active.values()].some(entries => entries.length > 0)) return false;
            if (metrics.trackTimeStart !== replacementStart || metrics.trackTimeEnd !== replacementEnd)
                throw new Error('peanut_sdk_build_task_timer_patch_identity_changed');
            if (startDescriptor) Object.defineProperty(metrics, 'trackTimeStart', startDescriptor);
            else delete metrics.trackTimeStart;
            if (endDescriptor) Object.defineProperty(metrics, 'trackTimeEnd', endDescriptor);
            else delete metrics.trackTimeEnd;
            restored = true;
            this.installed.delete(metrics);
            return true;
        };
        const releaseEntry = (label: string, entry: TimerEntry): void => {
            const entries = active.get(label);
            const index = entries?.indexOf(entry) ?? -1;
            if (entries && index >= 0) {
                entries.splice(index, 1);
                if (entries.length === 0) active.delete(label);
            }
            if (restoreRequested) restoreNow();
        };
        const replacementStart = function(this: unknown, label: unknown, ...args: unknown[]): unknown {
            if (typeof label !== 'string' || !SdkBuildTaskTimerCompat.labels.has(label))
                return Reflect.apply(originalStart, this, [label, ...args]);
            const entries = active.get(label) ?? [];
            const route = entries.length === 0 ? label : `${label} [peanut-overlap-${++sequence}]`;
            const result = Reflect.apply(originalStart, this, [route, ...args]);
            entries.push({ route, ending: false });
            active.set(label, entries);
            return result;
        };
        const replacementEnd = function(this: unknown, label: unknown, ...args: unknown[]): unknown {
            if (typeof label !== 'string' || !SdkBuildTaskTimerCompat.labels.has(label))
                return Reflect.apply(originalEnd, this, [label, ...args]);
            const entry = active.get(label)?.find(item => !item.ending);
            if (!entry) return Reflect.apply(originalEnd, this, [label, ...args]);
            entry.ending = true;
            let result: unknown;
            try {
                result = Reflect.apply(originalEnd, this, [entry.route, ...args]);
            } catch (error) {
                releaseEntry(label, entry);
                throw error;
            }
            if (result && (typeof result === 'object' || typeof result === 'function')
                && typeof Reflect.get(result, 'then') === 'function') {
                return Promise.resolve(result).finally(() => releaseEntry(label, entry));
            }
            releaseEntry(label, entry);
            return result;
        };

        Object.defineProperty(metrics, 'trackTimeStart', { configurable: true, enumerable: startDescriptor?.enumerable ?? true,
            writable: true, value: replacementStart });
        try {
            Object.defineProperty(metrics, 'trackTimeEnd', { configurable: true, enumerable: endDescriptor?.enumerable ?? true,
                writable: true, value: replacementEnd });
        } catch (error) {
            if (startDescriptor) Object.defineProperty(metrics, 'trackTimeStart', startDescriptor);
            else delete metrics.trackTimeStart;
            throw error;
        }

        const patch: TimerPatch = {
            retain() { restoreRequested = false; return patch; },
            restore() { restoreRequested = true; return restoreNow(); },
        };
        this.installed.set(metrics, patch);
        return patch;
    }

    private static field(value: unknown, key: string): unknown {
        return value && typeof value === 'object' ? Reflect.get(value, key) : undefined;
    }

    private static record(value: unknown): value is Record<string, (...args: unknown[]) => unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }
}
