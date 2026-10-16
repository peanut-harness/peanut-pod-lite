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
