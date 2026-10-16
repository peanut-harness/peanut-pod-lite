import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';

test('UI model observation keeps real mesh/shared-material identities without invoking instance-creating getters', () => {
    const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('./component-native-scene.ts', import.meta.url))],
        platform: 'node', format: 'cjs', target: 'node14', write: false, bundle: true, external: ['cc'] });
    const code = compiled.outputFiles?.[0]?.text; assert(code);
    const node = { name: 'Root', uuid: 'scene', children: [], getComponents: () => [component] };
    const model = { type: 'cc.MeshRenderer', node, enabled: true,
        mesh: { type: 'cc.Mesh', _uuid: 'native-mesh' }, sharedMaterials: [{ type: 'cc.Material', _uuid: 'native-material' }] };
    let instanceReads = 0;
    for (const field of ['material', 'materials']) Object.defineProperty(model, field, { get: () => {
        instanceReads++; throw Error('material instance getter invoked');
    } });
    const component = { type: 'cc.UIMeshRenderer', node, uuid: 'component', modelComponent: model };
    const cc = { director: { getScene: () => node }, Component: class {}, macro: { CUSTOM_PIPELINE_NAME: '' },
        js: { getClassName: (value: { type: string }) => value.type }, isValid: () => true };
    const output = { exports: {} };
    const observedProcess = { traceProcessWarnings: false };
    const manager = new EventEmitter();
    function observeAdd(): void {}
    function observeRemove(): void {}
    manager.on('add', observeAdd); manager.on('remove', observeRemove);
    const maximum = manager.getMaxListeners();
    runInNewContext(code, { process: observedProcess, EditorExtends: { Component: manager }, module: output, exports: output.exports, require: (id: string): unknown => {
        if (id === 'cc') return cc;
        throw Error('unexpected module:' + id);
    } });
    const methods: unknown = Reflect.get(output.exports, 'methods'); assert(methods && typeof methods === 'object');
    const snapshot: unknown = Reflect.get(methods, 'snapshot'); assert.equal(typeof snapshot, 'function');
    if (typeof snapshot !== 'function') throw Error('snapshot missing');
    const result = JSON.parse(JSON.stringify(Reflect.apply(snapshot, methods, [])));
    assert.deepEqual(result.nodes[0].components[0].observed, { modelPresent: true, modelType: 'cc.MeshRenderer', modelValid: true,
        modelNodeMatches: true, modelEnabled: true, mesh: { uuid: 'native-mesh', type: 'cc.Mesh', valid: true },
        sharedMaterials: [{ uuid: 'native-material', type: 'cc.Material', valid: true }] });
    assert.equal(instanceReads, 0);
    assert.equal(result.warningStacksEnabled, true);
    assert.equal(observedProcess.traceProcessWarnings, true);
    assert.deepEqual(result.componentManagerListeners, { max: maximum, add: 1, remove: 1,
        callbackNames: [{ event: 'add', names: ['observeAdd'] }, { event: 'remove', names: ['observeRemove'] }] });
    assert.equal(manager.getMaxListeners(), maximum);
    assert.deepEqual(manager.rawListeners('add'), [observeAdd]);
    assert.deepEqual(manager.rawListeners('remove'), [observeRemove]);
});
