import { createHash } from 'crypto';

/**
 * @description 仅修复已核验 SDK 冷数据库入口缺失的真实计时开始，不替换计时结束或诊断。
 */
export class SdkStartupTimerCompat {
    /**
     * @description 实际 3.8.7 SDK 方法指纹；未知实现不安装修复。
     */
    private static readonly sources: Readonly<Record<string, string>> = {
        _preStartDB: 'a41fe8780641cd6ef0fe461042b1f1f29fe1ea0b900b92452a8badeef209bc17',
        _startupDB: 'e64333f68fd5b27e834d3a9091adfbe3b58b6538256d2f92121b093e5505996d',
        _startDB: '17ca21aa6daadc8a48b730c22e9aa8864888e7380888b768083340c7a5c3d9c1',
    };

    /**
     * @description 在原预启动数据库工作之前调用 SDK 自己的真实 start；仅恢复本次安装的引用。
     * @param manager 实际 worker 的数据库管理器。
     * @param metrics 实际 SDK Metrics 对象。
     * @param version 实际 Creator 版本。
     * @returns 可观测安装状态与精确恢复函数。
     */
    public static install(manager: unknown, metrics: unknown, version: string): { readonly state: { installed: boolean; starts: number }; restore(): void } {
        if (version !== '3.8.7') throw new Error('peanut_sdk_timer_version_unverified');
        if (!this.record(manager) || !this.record(metrics)) throw new Error('peanut_sdk_timer_context_missing');
        for (const [name, hash] of Object.entries(this.sources)) {
            if (typeof manager[name] !== 'function' || this.hash(manager[name]) !== hash)
                throw new Error('peanut_sdk_timer_source_mismatch:' + name);
        }
        const start = metrics.trackTimeStart;
        if (typeof start !== 'function' || this.hash(start) !== '4fcbe419ba23a2b08918d539b8ac7f4558bb154fe18a3332c8855e2874cc3d4f')
            throw new Error('peanut_sdk_timer_metrics_source_mismatch');
        const original = manager._preStartDB as Function;
        const descriptor = Object.getOwnPropertyDescriptor(manager, '_preStartDB');
        const state = { installed: true, starts: 0 };
        const replacement = function(this: unknown, database: unknown): unknown {
            if (!SdkStartupTimerCompat.record(database) || !SdkStartupTimerCompat.record(database.options)
                || !SdkStartupTimerCompat.record(manager.assetDBMap)) throw new Error('peanut_sdk_timer_database_identity_invalid');
            const name = database.options.name;
            if (this !== manager || typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(name)
                || manager.assetDBMap[name] !== database) throw new Error('peanut_sdk_timer_database_identity_invalid');
            Reflect.apply(start, metrics, [`asset-db:worker-startup-database[${name}]`]);
            state.starts += 1;
            return Reflect.apply(original, this, [database]);
        };
        Object.defineProperty(manager, '_preStartDB', { configurable: true, writable: true, value: replacement });
        return { state, restore: (): void => {
            if (!state.installed) return;
            if (manager._preStartDB !== replacement) throw new Error('peanut_sdk_timer_patch_identity_changed');
            if (descriptor) Object.defineProperty(manager, '_preStartDB', descriptor); else delete manager._preStartDB;
            state.installed = false;
        } };
    }

    /**

     * @description 只读取函数原始文本以核对来源，不解析或执行文本。

     */
    private static hash(method: Function): string { return createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex'); }

    /**

     * @description 在 SDK 未知值边界只允许非数组对象。

     */
    private static record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
}
