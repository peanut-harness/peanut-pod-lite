import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { ComponentSdkStartupTimerCompat } from './component-sdk-startup-timer-compat.ts';

/**
 * @description 离线重放实机冻结的SDK原方法，对照冷启动遗漏与真实入口start配对，不在产品中执行文本。
 */
function sdk() {
    const proof = JSON.parse(readFileSync(new URL('./3.8.7/sdk-startup-timer-source.json', import.meta.url), 'utf8'));
    const starts = new Map<string, number>(); const events: string[] = [];
    const adapter = { trackTimeStart: (label: string): void => { events.push('start:' + label); starts.set(label, Date.now()); },
        trackTimeEnd: (label: string): void => { events.push('end:' + label); if (!starts.has(label)) throw Error('missing_real_start:' + label); starts.delete(label); } };
    const context = { publicModule: { adapter }, Editor: { Metrics: adapter }, name: 'actual-sdk-window',
        console: { debug: () => {}, error: (message: string) => { throw Error(message); } },
        console_1: { newConsole: { trackMemoryEnd: () => {} } }, afterScan: () => {}, afterPreImport: async () => {} };
    const metrics: any = runInNewContext(`({${proof.methods.trackTimeStart.source}})`, context);
    Object.assign(metrics, { trackTimeEnd: adapter.trackTimeEnd }); context.Editor.Metrics = metrics;
    const manager: any = { assetDBInfo: {}, assetDBMap: {}, emit: () => {} };
    for (const name of ['_preStartDB', '_startupDB', '_startDB']) manager[name] = runInNewContext(`({${proof.methods[name].source}}).${name}`, context);
    for (const name of ['internal', 'assets']) {
        manager.assetDBInfo[name] = { state: 'none' };
        manager.assetDBMap[name] = { options: { name }, start: async ({ hooks }: any) => {
            events.push('database-begin:' + name); await hooks.afterPreImport(); events.push('database-complete:' + name); await hooks.afterStart();
        } };
    }
    return { manager, metrics, events, starts };
}

test('real SDK cold-start source misses worker start; exact compatibility starts before actual DB work and keeps original end', async () => {
    const broken = sdk(); const stage = await broken.manager._preStartDB(broken.manager.assetDBMap.internal);
    await assert.rejects(broken.manager._startupDB(stage), /missing_real_start:asset-db:worker-startup-database\[internal\]/u);
    const fixed = sdk(); const original = fixed.manager._preStartDB;
    const patch = ComponentSdkStartupTimerCompat.install(fixed.manager, fixed.metrics, '3.8.7');
    for (const name of ['internal', 'assets']) {
        const stage = await fixed.manager._preStartDB(fixed.manager.assetDBMap[name]); await fixed.manager._startupDB(stage);
        const label = 'asset-db:worker-startup-database[' + name + ']';
        assert(fixed.events.indexOf('start:' + label) < fixed.events.indexOf('database-begin:' + name));
        assert(fixed.events.indexOf('database-complete:' + name) < fixed.events.indexOf('end:' + label));
        assert.equal(fixed.events.filter(event => event === 'start:' + label).length, 1);
        assert.equal(fixed.events.filter(event => event === 'end:' + label).length, 1);
    }
    assert.deepEqual([...fixed.starts], []); assert.equal(patch.state.starts.length, 2);
    assert.throws(() => fixed.manager._preStartDB({ options: { name: 'internal' } }), /database_identity_invalid/u);
    patch.restore(); assert.equal(fixed.manager._preStartDB, original); assert.equal(patch.state.installed, false);
});

test('startup compatibility refuses unknown SDKs and changed implementations before any timer start', () => {
    const current = sdk();
    assert.throws(() => ComponentSdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.3'), /version_unverified/u);
    current.manager._startupDB = async () => {};
    assert.throws(() => ComponentSdkStartupTimerCompat.install(current.manager, current.metrics, '3.8.7'), /source_mismatch:_startupDB/u);
    assert.deepEqual(current.events, []);
});
