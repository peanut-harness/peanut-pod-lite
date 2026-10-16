import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ComponentSdkTimerTrace } from './component-sdk-timer-trace.ts';

test('timer trace preserves actual Map values, API return identity and original methods without creating missing starts', () => {
    const map = new Map<unknown, unknown>([['preexisting', 123]]); const events: Record<string, unknown>[] = [];
    const original = map.set; const restore = ComponentSdkTimerTrace.install(map, event => events.push(event));
    assert.equal(map.has('missing'), false); assert.equal(map.size, 1);
    assert.equal(map.set('actual', 456), map); assert.equal(map.get('actual'), 456);
    assert.equal(map.delete('actual'), true); assert.equal(map.get('preexisting'), 123);
    assert.deepEqual([...map.entries()], [['preexisting', 123]]);
    restore(); assert.equal(map.set, original); assert.equal(Object.hasOwn(map, 'set'), false);
    assert.equal(events[0]?.result, false); assert.equal(events[0]?.key, 'missing');
    assert.equal(events.find(event => event.method === 'set')?.value, 456);
});

test('IPC timer observer preserves original zero-duration payload and handler, then removes only itself', () => {
    const ipc = new EventEmitter(); let originalCalls = 0;
    const original = (_event: unknown, _message: unknown, options: { value: number }): void => { originalCalls++; assert.equal(options.value, 0); };
    ipc.on('metrics:track-time-end', original); const events: Record<string, unknown>[] = [];
    const remove = ComponentSdkTimerTrace.observeIpc(ipc, event => events.push(event));
    ipc.emit('metrics:track-time-end', {}, 'actual-operation', { value: 0 }, 123);
    assert.equal(originalCalls, 1); assert.equal(events[0]?.explicitValue, 0);
    remove(); assert.deepEqual(ipc.rawListeners('metrics:track-time-end'), [original]);
    assert.equal(ipc.listenerCount('metrics:track-time-start'), 0);
});
