import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { SdkStartupTimerCompat } from '../src/sdk-startup-timer-compat.ts';
import { SdkBuildTaskTimerCompat } from '../src/sdk-build-task-timer-compat.ts';
import { SdkStartupTimerWorker } from '../src/sdk-startup-timer-worker.ts';

interface IDatabase { options: { name: string }; start(input: { hooks: { afterPreImport(): Promise<unknown>; afterStart?(): void } }): Promise<void> }
interface IManager {
    _preStartDB(database: IDatabase): Promise<unknown>; _startupDB(stage: unknown): Promise<void>; _startDB(name: string): Promise<void>;
    assetDBInfo: Record<string, { state: string }>; assetDBMap: Record<string, IDatabase>; emit(): void;
}
/**
 * @description 仅测试重放实机冻结 SDK 方法；生产实现不读取或执行函数文本。
 */
function sdk() {
    const proof = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/editor-stability/components/3.8.7/sdk-startup-timer-source.json', import.meta.url), 'utf8'));
    const starts = new Map<string, number>(); const events: string[] = [];
    const adapter = { trackTimeStart(label: string): void { events.push('start:' + label); starts.set(label, 1); },
        trackTimeEnd(label: string): void { events.push('end:' + label); if (!starts.has(label)) throw Error('missing_real_start:' + label); starts.delete(label); } };
    const context = { publicModule: { adapter }, Editor: { Metrics: adapter }, name: 'sdk-replay',
        console: { debug(): void {}, error(message: string): never { throw Error(message); } },
        getPreImporterHandler(): undefined { return undefined; },
        console_1: { newConsole: { trackMemoryStart(): void {}, trackMemoryEnd(): void {} } }, afterScan(): void {}, async afterPreImport(): Promise<void> {} };
    const metrics = runInNewContext(`({${proof.methods.trackTimeStart.source}})`, context) as typeof adapter;
    metrics.trackTimeEnd = adapter.trackTimeEnd; context.Editor.Metrics = metrics;
    const manager = { assetDBInfo: {}, assetDBMap: {}, emit(): void {} } as IManager;
    for (const name of ['_preStartDB', '_startupDB', '_startDB'] as const)
        manager[name] = runInNewContext(`({${proof.methods[name].source}}).${name}`, context);
    for (const name of ['internal', 'assets']) {
        manager.assetDBInfo[name] = { state: 'none' };
        manager.assetDBMap[name] = { options: { name }, async start({ hooks }): Promise<void> {
            events.push('database-begin:' + name); await hooks.afterPreImport(); events.push('database-complete:' + name); hooks.afterStart?.();
        } };
    }
    return { manager, metrics, events, starts };
}

test('real frozen SDK cold path is broken, product starts before real work and preserves the actual end', async () => {
    const broken = sdk(); const stage = await broken.manager._preStartDB(broken.manager.assetDBMap.internal);
    await assert.rejects(broken.manager._startupDB(stage), /missing_real_start/u);
    const fixed = sdk(); const original = fixed.manager._preStartDB;
    const end = fixed.metrics.trackTimeEnd; const patch = SdkStartupTimerCompat.install(fixed.manager, fixed.metrics, '3.8.7');
    for (const name of ['internal', 'assets']) {
        const next = await fixed.manager._preStartDB(fixed.manager.assetDBMap[name]); await fixed.manager._startupDB(next);
        const label = `asset-db:worker-startup-database[${name}]`;
        assert(fixed.events.indexOf('start:' + label) < fixed.events.indexOf('database-begin:' + name));
        assert(fixed.events.indexOf('database-complete:' + name) < fixed.events.indexOf('end:' + label));
        assert.equal(fixed.events.filter(value => value === 'start:' + label).length, 1);
        assert.equal(fixed.events.filter(value => value === 'end:' + label).length, 1);
    }
    assert.equal(fixed.metrics.trackTimeEnd, end); assert.equal(fixed.starts.size, 0); assert.equal(patch.state.starts, 2);
    assert.throws(() => Reflect.apply(fixed.manager._preStartDB, {}, [fixed.manager.assetDBMap.internal]), /database_identity/u);
    assert.throws(() => fixed.manager._preStartDB({ options: { name: 'internal' } } as IDatabase), /database_identity/u);
    patch.restore(); patch.restore(); assert.equal(fixed.manager._preStartDB, original);
});

test('unknown SDK methods and metrics fail before installing or starting any timer', () => {
    for (const name of ['_preStartDB', '_startupDB', '_startDB'] as const) {
        const current = sdk(); const original = current.manager._preStartDB;
        Object.defineProperty(current.manager, name, { configurable: true, writable: true, value: async () => undefined });
        const prior = current.manager._preStartDB;
        assert.throws(() => SdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.7'), /source_mismatch/u);
        assert.equal(current.manager._preStartDB, prior); assert.equal(current.events.length, 0);
        assert.equal(typeof original, 'function');
    }
    const current = sdk(); current.metrics.trackTimeStart = (): void => {};
    assert.throws(() => SdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.7'), /metrics_source_mismatch/u);
    assert.throws(() => SdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.3'), /version_unverified/u);
});

test('worker is idempotent, skips 3.8.3 and restores only its own method reference', () => {
    const skipped = new SdkStartupTimerWorker(); skipped.load({ App: { version: '3.8.3' } }, null);
    assert.deepEqual(skipped.status(), { installed: false, starts: 0 }); skipped.unload();
    const current = sdk(); const worker = new SdkStartupTimerWorker(); const original = current.manager._preStartDB;
    const editor = { App: { version: '3.8.7' }, Metrics: current.metrics }; const manager = { assetDBManager: current.manager };
    worker.load(editor, manager); const own = current.manager._preStartDB; worker.load(editor, manager);
    assert.equal(current.manager._preStartDB, own); assert.equal(worker.status().installed, true);
    worker.unload(); assert.equal(current.manager._preStartDB, original); worker.unload();
    worker.load(editor, manager); current.manager._preStartDB = async () => undefined;
    assert.throws(() => worker.unload(), /patch_identity_changed/u);
    assert.notEqual(current.manager._preStartDB, original);
});


test('hot database start keeps its original single start/end pair and does not pass through the cold wrapper', async () => {
    const current = sdk(); const patch = SdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.7');
    await current.manager._startDB('internal');
    const label = 'asset-db:worker-startup-database[internal]';
    assert.equal(current.events.filter(value => value === 'start:' + label).length, 1);
    assert.equal(current.events.filter(value => value === 'end:' + label).length, 1);
    assert.equal(patch.state.starts, 0); assert.equal(current.starts.size, 0); patch.restore();
});

test('Creator 3.8.7 Builder timer compatibility preserves each overlapping start/end and leaves unmatched ends visible', () => {
    const starts = new Map<string, number>();
    const original = { set: starts.set, has: starts.has, get: starts.get, delete: starts.delete };
    const editor = { App: { version: '3.8.7' }, Metrics: { __protected__: { getTrackTimeStartMap: () => starts } } };
    const trackTimeStart = (label: string): void => { starts.set(label, Date.now()); };
    const trackTimeEnd = (label: string, options?: { output?: boolean }): number => {
            if (!starts.has(label)) throw new Error(`trackTimeEnd failed! Can not find the track time ${label} start`);
            starts.delete(label); return options?.output ? 1 : 0;
        };
    const label = '// ---- build task 查询 Asset Bundle ----';
    const patch = SdkBuildTaskTimerCompat.install(editor);

    trackTimeStart(label);
    trackTimeStart(label);
    assert.deepEqual([...starts.keys()], [label, `${label} [peanut-overlap-1]`]);
    assert.equal(starts.size, 2);
    assert.equal(trackTimeEnd(label, { output: true }), 1);
    assert.equal(trackTimeEnd(label), 0);
    assert.equal(starts.size, 0);
    assert.throws(() => trackTimeEnd(label), /trackTimeEnd failed! Can not find the track time/u);

    trackTimeStart('ordinary timer'); trackTimeEnd('ordinary timer');
    assert.equal(patch.restore(), true);
    assert.equal(starts.set, original.set); assert.equal(starts.has, original.has);
    assert.equal(starts.get, original.get); assert.equal(starts.delete, original.delete);
});

test('Creator 3.8.3 does not receive the 3.8.7 Builder timer compatibility patch', () => {
    const starts = new Map<string, number>(); const original = { set: starts.set, has: starts.has, get: starts.get, delete: starts.delete };
    const patch = SdkBuildTaskTimerCompat.install({ App: { version: '3.8.3' }, Metrics: { __protected__: { getTrackTimeStartMap: () => starts } } });
    assert.equal(starts.set, original.set); assert.equal(starts.has, original.has);
    assert.equal(starts.get, original.get); assert.equal(starts.delete, original.delete);
    assert.equal(patch.restore(), true);
});
