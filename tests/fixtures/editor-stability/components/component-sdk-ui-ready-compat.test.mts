import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { ComponentSdkUiReadyCompat } from './component-sdk-ui-ready-compat.ts';
import { ComponentSdkUiReadyPhases } from './component-sdk-ui-ready-phases.ts';

/**
 * @description 离线重放实机冻结的两个SDK函数，真实计时配对、刷新次数及异常均由原SDK逻辑产生。
 */
function sdk(version = '3.8.7') {
    const proof = JSON.parse(readFileSync(new URL('./3.8.7/sdk-ui-ready-timer-source.json', import.meta.url), 'utf8'));
    if (version === '3.8.3') {
        const captured = JSON.parse(readFileSync(new URL('./3.8.3/sdk-ui-ready-source.json', import.meta.url), 'utf8'));
        proof.methods.broadcastApply = captured.methods.find((item: { path: string }) => item.path.endsWith('/broadcast.ccc/apply'));
        proof.methods.hierarchyReady = captured.methods.find((item: { path: string }) => item.path.endsWith('/panel.ccc/methods/ready'));
    }
    const starts = new Map<string, number>(); const events: string[] = []; const window = { __InitializationTimeEnd__: Date.now() };
    let hidden = 0; let refreshed = 0; let failure: Error | null = null;
    const metrics = { trackTimeStart(label: string): void { starts.set(label, Date.now()); events.push('start:' + label); },
        trackTimeEnd(label: string): void { events.push('end:' + label); if (!starts.delete(label)) throw Error('missing_real_start:' + label); } };
    const hierarchy: any = { methods: { unstaging: async () => {} } };
    const context = { window, Editor: { Metrics: metrics }, exports: hierarchy, console: { debug: () => {} },
        hideLoading: () => { hidden++; }, vm: { sceneReady: false, refresh: async () => { refreshed++; await Promise.resolve(); if (failure) { const error = failure; failure = null; throw error; } } },
        panelData: { $: { tree: { reselected: () => {} } } } };
    const broadcast = { apply: runInNewContext('(' + proof.methods.broadcastApply.source + ')', context) };
    hierarchy.methods.ready = runInNewContext('({' + proof.methods.hierarchyReady.source + '}).ready', context);
    const runtimeMethods = { ready: hierarchy.methods.ready };
    const panel = { panel: { methods: runtimeMethods } };
    const element = { query: runInNewContext('({query(e){const t=name2panel[e];return t?0===t.length?t[0]:t:null}}).query', { name2panel: { hierarchy: [panel] } }) };
    const cache = { '/sdk/app.asar/builtin/scene/dist/panel/message/broadcast.ccc': { exports: broadcast },
        '/sdk/app.asar/modules/editor-extensions/extensions/hierarchy/dist/panel.ccc': { exports: hierarchy },
        '/sdk/app.asar/node_modules/@editor/panel/lib/element.ccc': { exports: element } };
    const handlers: any = {}; broadcast.apply(handlers);
    return { cache, window, hierarchy, runtimeMethods, handlers, metrics, events, starts, hidden: () => hidden, refreshed: () => refreshed,
        fail: (error: Error) => { failure = error; } };
}

test('original scene broadcast repeats one startup end; compatibility consumes completed marker and retains every hideLoading', async () => {
    const broken = sdk(); broken.metrics.trackTimeStart('main-window:ready'); broken.handlers['scene:ready']();
    assert.throws(() => broken.handlers['scene:ready'](), /missing_real_start:main-window:ready/u);
    const fixed = sdk(); fixed.metrics.trackTimeStart('main-window:ready'); fixed.handlers['scene:ready']();
    await fixed.hierarchy.methods.ready();
    const original = fixed.hierarchy.methods.ready; const marker = fixed.window.__InitializationTimeEnd__;
    const patch = ComponentSdkUiReadyCompat.install(fixed.cache, fixed.window, '3.8.7');
    for (let i = 0; i < 20; i++) fixed.handlers['scene:ready']();
    assert.equal(fixed.hidden(), 21); assert.equal(patch.state.initializationTimeEnd, marker);
    assert.equal(fixed.events.filter(event => event === 'end:main-window:ready').length, 1);
    patch.restore(); assert.equal(fixed.hierarchy.methods.ready, original); assert.equal(fixed.window.__InitializationTimeEnd__, undefined);
});

test('real hierarchy ready overlaps one label; compatibility serializes all original refreshes without changing errors', async () => {
    const broken = sdk(); const results = await Promise.allSettled([broken.hierarchy.methods.ready(), broken.hierarchy.methods.ready()]);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const fixed = sdk(); const patch = ComponentSdkUiReadyCompat.install(fixed.cache, fixed.window, '3.8.7');
    await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? fixed.hierarchy.methods.ready() : fixed.runtimeMethods.ready()));
    assert.equal(fixed.refreshed(), 20); assert.equal(patch.state.calls, 20); assert.equal(patch.state.maximumActive, 1);
    assert.equal(fixed.events.filter(event => event === 'start:hierarchy:render-tree').length, 20);
    assert.equal(fixed.events.filter(event => event === 'end:hierarchy:render-tree').length, 20);
    assert.equal(fixed.starts.size, 0);
    const failure = Error('actual-sdk-refresh-failure'); fixed.fail(failure);
    const rejected = fixed.hierarchy.methods.ready(); const next = fixed.hierarchy.methods.ready();
    await assert.rejects(rejected, error => error === failure); await next; await patch.idle();
    assert.equal(fixed.refreshed(), 22); assert.equal(patch.state.active, 0); patch.restore();
});

test('unknown SDK source and immutable startup marker fail before either SDK state changes', () => {
    const current = sdk(); const original = current.hierarchy.methods.ready; const marker = current.window.__InitializationTimeEnd__;
    assert.throws(() => ComponentSdkUiReadyCompat.install(current.cache, current.window, '3.9.0'), /version_unverified/u);
    Object.defineProperty(current.window, '__InitializationTimeEnd__', { configurable: false, writable: false });
    assert.throws(() => ComponentSdkUiReadyCompat.install(current.cache, current.window, '3.8.7'), /state_unverified/u);
    assert.equal(current.hierarchy.methods.ready, original); assert.equal(current.window.__InitializationTimeEnd__, marker);
    current.hierarchy.methods.ready = async () => {};
    assert.throws(() => ComponentSdkUiReadyCompat.install(current.cache, current.window, '3.8.7'), /source_mismatch/u);
    assert.equal(current.window.__InitializationTimeEnd__, marker);
});

test('phase installation requires both actual successful SDK end deletions and restores its own observer before callback', async () => {
    const map = new Map<unknown, unknown>(); const original = map.delete; let trace = ''; const observations: string[][] = [];
    const patch = ComponentSdkUiReadyPhases.install(map, labels => { assert.equal(map.delete, original); observations.push(labels); }, () => trace);
    for (const name of ['main-window:ready', 'hierarchy:render-tree']) { map.set(name, Date.now()); assert.equal(map.delete(name), true); }
    await Promise.resolve(); assert.equal(observations.length, 0);
    trace = 'at Metrics.trackTimeEnd (/sdk/app.asar/builtin/metrics/dist/libs/metrics.ccc:1:5874)';
    assert.equal(map.delete('main-window:ready'), false); await Promise.resolve(); assert.equal(observations.length, 0);
    map.set('main-window:ready', 1); map.delete('main-window:ready'); await Promise.resolve(); assert.equal(observations.length, 0);
    map.set('hierarchy:render-tree', 2); map.delete('hierarchy:render-tree');
    assert.equal(map.delete, original); assert.equal(observations.length, 0); await Promise.resolve();
    assert.deepEqual(observations, [['main-window:ready', 'hierarchy:render-tree']]); assert.equal(patch.state.installed, false); patch.restore();
});


test('3.8.3 uses its separately frozen broadcast with actual end and serial hierarchy refreshes, and rejects cross-version broadcast substitution', async () => {
    const fixed = sdk('3.8.3'); fixed.metrics.trackTimeStart('main-window:ready'); fixed.handlers['scene:ready']();
    await fixed.hierarchy.methods.ready();
    assert.throws(() => ComponentSdkUiReadyCompat.install(fixed.cache, fixed.window, '3.8.7'), /source_mismatch/u);
    const patch = ComponentSdkUiReadyCompat.install(fixed.cache, fixed.window, '3.8.3');
    for (let i = 0; i < 20; i++) fixed.handlers['scene:ready']();
    await Promise.all(Array.from({ length: 20 }, () => fixed.runtimeMethods.ready()));
    assert.equal(fixed.hidden(), 21); assert.equal(fixed.refreshed(), 21);
    assert.equal(fixed.events.filter(event => event === 'end:main-window:ready').length, 1);
    assert.equal(patch.state.maximumActive, 1); assert.equal(fixed.starts.size, 0); patch.restore();
});
