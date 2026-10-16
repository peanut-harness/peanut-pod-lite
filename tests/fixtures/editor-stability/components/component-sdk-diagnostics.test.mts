import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentSdkDiagnostics } from './component-sdk-diagnostics.ts';

test('SDK diagnostics read exact timer data and method source without calling lifecycle, reset or registration', () => {
    let mutations = 0; const starts = new Map([['actual-start', 123]]);
    const reset = (): void => { mutations++; }; const init = (): void => { mutations++; };
    const queue = [
        { index: 1, time: 123, funcName: 'trackTimeStart', info: { message: 'actual-start' } },
        { index: 2, time: 150, funcName: 'trackEvent', info: { privateAccount: 'must-not-export' } },
    ];
    const api = { getTrackTimeStartMap: () => starts, getTrackInfoList: () => queue, reset, register: reset };
    const result: any = ComponentSdkDiagnostics.metrics({ __protected__: api, trackTimeStart: init, trackTimeEnd: reset });
    assert.deepEqual(result.starts, [['actual-start', 123]]);
    assert.deepEqual(result.timers, [{ index: 1, time: 123, funcName: 'trackTimeStart', message: 'actual-start', explicitDuration: undefined }]);
    assert.equal(JSON.stringify(result).includes('must-not-export'), false);
    assert.equal(result.sources.protected.reset, reset.toString());
    const manager = Object.create({ init });
    Object.defineProperty(manager, 'clear', { get: () => { throw Error('getter invoked'); } });
    const lifecycle: any = ComponentSdkDiagnostics.lifecycle({ Component: manager });
    assert.equal(lifecycle.component.init, init.toString()); assert.equal(lifecycle.component.clear, null);
    assert.equal(mutations, 0); assert.deepEqual([...starts.entries()], [['actual-start', 123]]);
});

test('timer route diagnostics inspect fixed SDK timer methods and IPC callbacks without executing either', () => {
    let calls = 0;
    function timingMethod(): void { calls++; const trackTimeStart = 'real SDK timer method marker'; void trackTimeStart; }
    const ipc = { eventNames: () => ['metrics:track-time-start', 'unrelated'], rawListeners: (name: string) => {
        assert.equal(name, 'metrics:track-time-start'); return [timingMethod];
    } };
    const result: any = ComponentSdkDiagnostics.timerRoutes({
        '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/app.asar/builtin/asset-db/dist/browser/index.ccc': { exports: { timingMethod } },
        '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/app.asar/node_modules/@editor/creator/dist/ipc/index.ccc': {
            exports: { default: { _events: { 'metrics:track-time-start': [timingMethod] }, privateValue: 'must-not-export' } },
        },
    }, ipc);
    assert.equal(result.methods.length, 1); assert.equal(result.methods[0].source, timingMethod.toString());
    assert.equal(result.ipcRoutes.length, 1); assert.equal(calls, 0);
    assert.equal(result.receivers.complete, true); assert.equal(result.receivers.handlers.length, 1);
    assert.equal(result.receivers.handlers[0].source, timingMethod.toString());
    assert.equal(JSON.stringify(result).includes('must-not-export'), false);
});

test('adapter observation reads only already cached SDK metric modules and never calls timer methods', () => {
    let calls = 0;
    const adapter = { trackTimeStart: (): void => { calls++; }, trackTimeEnd: (): void => { calls++; } };
    const outside = { get exports(): never { throw Error('unrelated cache read'); } };
    const result: any = ComponentSdkDiagnostics.adapters({
        '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/app.asar/node_modules/@editor/creator/dist/metrics/public/index.ccc': { exports: { adapter } },
        '/unrelated/user-module.js': outside,
    });
    assert.equal(result.length, 1); assert.equal(result[0].module, 'public/index.ccc');
    assert.equal(result[0].adapter.trackTimeStart, adapter.trackTimeStart.toString());
    assert.equal(calls, 0);
});

test('worker observation captures actual startup methods without calling them or reading database getters', () => {
    let calls = 0;
    const db = Object.create({ async start(): Promise<void> { calls++; } });
    Object.defineProperty(db, 'secret', { get: () => { throw Error('database getter read'); } });
    const map = new Map([['actual', 123]]);
    const metrics = { __protected__: { getTrackTimeStartMap: () => map, getTrackInfoList: () => [] } };
    const result: any = ComponentSdkDiagnostics.worker({ assetDBManager: { assetDBMap: { internal: db } } }, metrics, {});
    assert.equal(result.methods.length, 1); assert.equal(result.methods[0].name, 'start');
    assert.equal(result.methods[0].source, Object.getPrototypeOf(db).start.toString());
    assert.deepEqual(result.metrics.starts, [['actual', 123]]); assert.equal(calls, 0);
});
