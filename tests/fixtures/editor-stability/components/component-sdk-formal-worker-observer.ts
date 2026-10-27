import { createHash } from 'node:crypto';
import { appendFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentSdkCompatScope } from './component-sdk-compat-scope';

/**
 * Record the actual 3.8.7 AssetDB worker sequence without changing SDK methods or timers.
 */
class ComponentSdkFormalWorkerObserver {
    public static observe(phase: string): void {
        const project = realpathSync(join(__dirname, '../..'));
        const { output, registration } = ComponentSdkCompatScope.locate(project);
        if (registration.creatorVersion !== '3.8.7' || registration.sdkFormalTimerTrace !== true
            || !registration.formalSdkStartupTimer) throw new Error('component_formal_worker_observer_unregistered');
        const manager = Reflect.get(globalThis, 'Manager')?.assetDBManager;
        const editor = Reflect.get(globalThis, 'Editor');
        const method = manager?._preStartDB;
        const modules = Object.keys(require.cache).filter(path => path.endsWith('/peanut-pod-lite-host/dist/sdk-startup-timer-worker.js'));
        const starts = editor?.Metrics?.__protected__?.getTrackTimeStartMap?.();
        appendFileSync(join(output, 'formal-worker-observer.ndjson'), JSON.stringify({ phase, pid: process.pid,
            at: Date.now(), creatorVersion: editor?.App?.version ?? null, managerAvailable: !!manager,
            methodSha256: typeof method === 'function' ? createHash('sha256').update(Function.prototype.toString.call(method)).digest('hex') : null,
            formalModuleCount: modules.length, formalModuleLoaded: modules.length === 1 && require.cache[modules[0]]?.loaded === true,
            matchingStartLabels: starts instanceof Map ? [...starts.keys()].filter((key: unknown) => typeof key === 'string'
                && key.startsWith('asset-db:worker-startup-database[')) : null,
        }) + '\n');
    }
}

ComponentSdkFormalWorkerObserver.observe('module-evaluation');
export const load = (): void => ComponentSdkFormalWorkerObserver.observe('load');
export const methods = {
    afterInit: (): void => ComponentSdkFormalWorkerObserver.observe('afterInit'),
    beforePreStart: (): void => ComponentSdkFormalWorkerObserver.observe('beforePreStart'),
    beforeReady: (): void => ComponentSdkFormalWorkerObserver.observe('beforeReady'),
};
