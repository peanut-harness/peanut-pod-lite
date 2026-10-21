import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentSdkRendererTimerTrace } from './component-sdk-renderer-timer-trace.ts';

test('renderer timer tracing preserves SDK this, arguments, exact return identity and synchronous errors', () => {
    const sender = { callback: () => sender }; const failure = Error('actual SDK send error'); const calls: unknown[][] = [];
    const owner = { send(this: any, ...args: unknown[]) { assert.equal(this, owner); calls.push(args); if (args[1] === 'throw') throw failure; return sender; } };
    const original = owner.send; const descriptor = Object.getOwnPropertyDescriptor(owner, 'send');
    const cache = { '/SDK/app.asar/node_modules/@base/electron-base-ipc/dist/renderer.ccc': { exports: owner } };
    const patch = ComponentSdkRendererTimerTrace.install(cache, '3.8.7', '/owned/project', 'scene');
    try {
        const options = { output: false }; assert.equal(owner.send('metrics:track-time-end', 'main-window:ready', options, 123), sender);
        assert.equal(calls[0][2], options); assert.deepEqual(calls[0], ['metrics:track-time-end', 'main-window:ready', options, 123]);
        assert.equal(owner.send('unrelated', 'must-not-export'), sender);
        assert.equal(owner.send('metrics:track-time-end', { toString() { throw Error('observer coerced unknown payload'); } }), sender);
        assert.throws(() => owner.send('unrelated', 'throw'), error => error === failure);
        assert.equal(patch.state.entries.length, 1); assert.match(patch.state.entries[0].stack, /sdk-renderer-timer-observation/u);
        assert.equal(JSON.stringify(patch.state).includes('must-not-export'), false); assert.equal(owner.send.length, original.length);
    } finally { patch.restore(); }
    assert.equal(owner.send, original); assert.deepEqual(Object.getOwnPropertyDescriptor(owner, 'send'), descriptor);
});

test('shared renderer observers use one SDK wrapper and restore it only after their own leases release', () => {
    const returned = Promise.resolve('actual SDK result'); const owner = { send: () => returned }; const original = owner.send;
    const cache = { '/SDK/app.asar/node_modules/@base/electron-base-ipc/dist/index.js': { exports: owner } };
    const first = ComponentSdkRendererTimerTrace.install(cache, '3.8.7', '/owned/project', 'scene');
    const second = ComponentSdkRendererTimerTrace.install(cache, '3.8.7', '/owned/project', 'main-window');
    assert.equal(owner.send(), returned); first.restore(); assert.notEqual(owner.send, original); second.restore(); assert.equal(owner.send, original);
    assert.throws(() => ComponentSdkRendererTimerTrace.install(cache, '3.8.3', '/owned/project', 'scene'), /scope_unverified/u);
});
