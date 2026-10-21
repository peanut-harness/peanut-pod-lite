import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { ComponentSdkListenerCompat } from './component-sdk-listener-compat.ts';

/**
 * @description 使用原生只读提取的真实SDK实现复现，生产路径从不执行函数文本。
 */
function fixture(): { manager: any; emitter: EventEmitter } {
    const proof = JSON.parse(readFileSync(new URL('./3.8.7/sdk-listener-lifecycle-source.json', import.meta.url), 'utf8'));
    const emitter = new EventEmitter();
    const methods = ['init', 'registerCompMgrEvents', 'unregisterCompMgrEvents'].map(name => proof.methods[name].source);
    const manager = runInNewContext('({' + methods.join(',') + ',add(){},remove(){}})', { CompMgr: emitter });
    return { manager, emitter };
}

test('actual SDK registration leaks on repeated init; compatibility preserves one own pair and unrelated listeners', () => {
    const control = fixture(); for (let i = 0; i < 3; i++) control.manager.init();
    assert.equal(control.emitter.listenerCount('add'), 3); assert.equal(control.emitter.listenerCount('remove'), 3);
    const { manager, emitter } = fixture(); manager.init(); const original = manager.registerCompMgrEvents;
    const patch = ComponentSdkListenerCompat.install(manager, emitter, '3.8.7');
    function unrelated(): void {}
    emitter.on('add', unrelated); emitter.on('remove', unrelated);
    for (let i = 0; i < 20; i++) manager.init();
    assert.equal(patch.state.registrations, 20); assert.equal(emitter.getMaxListeners(), 10);
    assert.deepEqual(emitter.rawListeners('add'), [unrelated, manager._onCompAdded]);
    assert.deepEqual(emitter.rawListeners('remove'), [unrelated, manager._onCompRemoved]);
    patch.restore(); assert.equal(manager.registerCompMgrEvents, original);
    manager.unregisterCompMgrEvents(); assert.deepEqual(emitter.rawListeners('add'), [unrelated]);
    assert.deepEqual(emitter.rawListeners('remove'), [unrelated]);
});

test('listener compatibility rejects unknown SDKs, changed functions and already leaked processes', () => {
    const { manager, emitter } = fixture();
    assert.throws(() => ComponentSdkListenerCompat.install(manager, emitter, '3.8.3'), /version_unverified/u);
    const original = manager.init; manager.init = (): void => {};
    assert.throws(() => ComponentSdkListenerCompat.install(manager, emitter, '3.8.7'), /source_mismatch:init/u);
    manager.init = original; manager.init(); manager.init();
    assert.throws(() => ComponentSdkListenerCompat.install(manager, emitter, '3.8.7'), /requires_fresh_scene_process/u);
    assert.equal(emitter.listenerCount('add'), 2); assert.equal(emitter.getMaxListeners(), 10);
});
