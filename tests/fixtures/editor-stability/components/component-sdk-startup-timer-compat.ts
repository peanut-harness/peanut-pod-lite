import { createHash } from 'node:crypto';

/**
 * @description 在精确SDK真实数据库预启动入口补齐遗漏的start，保留SDK自身end与原始诊断。
 */
export class ComponentSdkStartupTimerCompat {
    private static readonly sources: Record<string, string> = {
        _preStartDB: 'a41fe8780641cd6ef0fe461042b1f1f29fe1ea0b900b92452a8badeef209bc17',
        _startupDB: 'e64333f68fd5b27e834d3a9091adfbe3b58b6538256d2f92121b093e5505996d',
        _startDB: '17ca21aa6daadc8a48b730c22e9aa8864888e7380888b768083340c7a5c3d9c1',
    };

    /**
     * @description 只替换当前管理器的预启动方法，不重放启动、不处理end、不写入任何合成时间。
     */
    public static install(manager: any, metrics: any, version: string, changed: () => void = () => {}) {
        if (version !== '3.8.7') throw new Error('component_sdk_startup_timer_version_unverified');
        for (const [name, hash] of Object.entries(this.sources)) {
            if (typeof manager?.[name] !== 'function' || this.hash(manager[name]) !== hash)
                throw new Error('component_sdk_startup_timer_source_mismatch:' + name);
        }
        if (typeof metrics?.trackTimeStart !== 'function'
            || this.hash(metrics.trackTimeStart) !== '4fcbe419ba23a2b08918d539b8ac7f4558bb154fe18a3332c8855e2874cc3d4f')
            throw new Error('component_sdk_startup_timer_metrics_source_mismatch');
        const original = manager._preStartDB; const descriptor = Object.getOwnPropertyDescriptor(manager, '_preStartDB');
        const state = { installed: true, creatorVersion: version, starts: [] as { database: string; label: string; observedAt: number }[] };
        const replacement = function(this: any, database: any): unknown {
            const name = database?.options?.name;
            if (this !== manager || typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/u.test(name)
                || manager.assetDBMap?.[name] !== database) throw new Error('component_sdk_startup_timer_database_identity_invalid');
            const label = `asset-db:worker-startup-database[${name}]`;
            metrics.trackTimeStart(label);
            state.starts.push({ database: name, label, observedAt: Date.now() }); changed();
            return original.call(this, database);
        };
        Object.defineProperty(manager, '_preStartDB', { configurable: true, writable: true, value: replacement });
        return { state, restore: (): void => {
            if (manager._preStartDB !== replacement) throw new Error('component_sdk_startup_timer_patch_identity_changed');
            if (descriptor) Object.defineProperty(manager, '_preStartDB', descriptor); else delete manager._preStartDB;
            state.installed = false; changed();
        } };
    }

    /**
     * @description 对真实函数文本取摘要，不解析或执行函数文本。
     */
    private static hash(method: Function): string { return createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex'); }
}
