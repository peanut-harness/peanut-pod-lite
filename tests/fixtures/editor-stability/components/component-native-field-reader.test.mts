import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';

const output = buildSync({ entryPoints: [fileURLToPath(new URL('./component-native-field-reader.ts', import.meta.url))],
    platform: 'node', format: 'cjs', target: 'node14', write: false, bundle: true, external: ['cc'] });
const code = output.outputFiles?.[0]?.text;
assert(code);
const sceneUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

for (const [type, old, modern] of [
    ['cc.Camera', 'color', 'clearColor'], ['cc.Camera', 'depth', 'clearDepth'],
    ['cc.Camera', 'stencil', 'clearStencil'], ['cc.ParticleSystem', 'enableCulling', 'dataCulling'],
]) {
    test(type + '.' + old + ' old contract is rejected before deprecated getter execution; modern getter is read', () => {
        let deprecatedReads = 0; let modernReads = 0;
        const component = { uuid: 'owned-component' };
        Object.defineProperty(component, old, { get: () => { deprecatedReads++; throw Error('deprecated getter executed'); } });
        Object.defineProperty(component, modern, { get: () => { modernReads++; return 7; } });
        const contract = { components: [{ componentType: type, cases: [{ id: 'field', selector: [old], safeSelector: [old],
            expectedWrite: 'set-and-readback', validValue: { form: 'literal', value: 7 } }] }] };
        const compiled = { exports: {} };
        const cc = { director: { getScene: () => ({ uuid: sceneUuid, children: [{ name: 'Target', children: [], getComponents: () => [component] }] }) },
            Component: class {}, js: { getClassName: () => type }, isValid: () => true };
        runInNewContext(code, { module: compiled, exports: compiled.exports, __dirname: '/fixture', require: (id: string): unknown => {
            if (id === 'cc') { return cc; }
            if (id === '/fixture/public-field-contract.json') { return contract; }
            throw Error('unexpected module');
        } });
        const reader: unknown = Reflect.get(compiled.exports, 'ComponentNativeFieldReader'); assert.equal(typeof reader, 'function');
        const read: unknown = Reflect.get(Object(reader), 'read'); assert.equal(typeof read, 'function');
        if (typeof read !== 'function') { throw Error('reader missing'); }
        assert.throws(() => Reflect.apply(read, reader, ['/Target', type, sceneUuid]), /deprecated_getter_contract/);
        assert.equal(deprecatedReads, 0); assert.equal(modernReads, 0);
        contract.components[0]?.cases.forEach(field => { field.safeSelector = [modern]; });
        const result: unknown = Reflect.apply(read, reader, ['/Target', type, sceneUuid]);
        assert(JSON.stringify(result).includes('"value":7'));
        assert.equal(modernReads, 1); assert.equal(deprecatedReads, 0);
    });
}

test('expected public refusal preserves the field row without invoking its deprecated getter', () => {
    let reads = 0; const component = { uuid: 'owned-transform' };
    Object.defineProperty(component, 'priority', { get: () => { reads++; throw Error('deprecated priority getter executed'); } });
    const field = { id: 'priority', selector: ['priority'], expectedWrite: 'reject-native-persistence', refusalReason: 'native_runtime_only' };
    const contract = { components: [{ componentType: 'cc.UITransform', cases: [field] }] };
    const compiled = { exports: {} };
    const cc = { director: { getScene: () => ({ uuid: sceneUuid, children: [{ name: 'Target', children: [], getComponents: () => [component] }] }) },
        Component: class {}, js: { getClassName: () => 'cc.UITransform' }, isValid: () => true };
    runInNewContext(code, { module: compiled, exports: compiled.exports, __dirname: '/fixture', require: (id: string): unknown => {
        if (id === 'cc') { return cc; }
        if (id === '/fixture/public-field-contract.json') { return contract; }
        throw Error('unexpected module');
    } });
    const reader: unknown = Reflect.get(compiled.exports, 'ComponentNativeFieldReader');
    const read: unknown = Reflect.get(Object(reader), 'read');
    if (typeof read !== 'function') { throw Error('reader missing'); }
    assert(JSON.stringify(Reflect.apply(read, reader, ['/Target', 'cc.UITransform', sceneUuid])).includes('expected-public-refusal'));
    assert.equal(reads, 0);
    field.expectedWrite = 'unknown';
    assert.throws(() => Reflect.apply(read, reader, ['/Target', 'cc.UITransform', sceneUuid]), /field_write_contract_invalid/);
    assert.equal(reads, 0);
});

test('wrong native scene identity is refused before traversing nodes or executing any getter', () => {
    let reads = 0;
    const scene = { uuid: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' };
    Object.defineProperty(scene, 'children', { get() { reads++; throw Error('must not traverse wrong scene'); } });
    const compiled = { exports: {} };
    runInNewContext(code, { module: compiled, exports: compiled.exports, __dirname: '/fixture', require: (id: string): unknown => {
        if (id === 'cc') return { director: { getScene: () => scene } };
        if (id === '/fixture/public-field-contract.json') return { components: [{ componentType: 'cc.UIOpacity', cases: [] }] };
        throw Error('unexpected module');
    } });
    const reader: unknown = Reflect.get(compiled.exports, 'ComponentNativeFieldReader');
    const read: unknown = Reflect.get(Object(reader), 'read'); assert.equal(typeof read, 'function');
    if (typeof read !== 'function') throw Error('reader missing');
    const result = JSON.parse(JSON.stringify(Reflect.apply(read, reader, ['/Target', 'cc.UIOpacity', sceneUuid])));
    assert.equal(result.reason, 'scene-identity-mismatch'); assert.equal(result.sceneUuid, scene.uuid);
    assert.equal(result.expectedSceneUuid, sceneUuid); assert.equal(reads, 0);
    assert.throws(() => Reflect.apply(read, reader, ['/Target', 'cc.UIOpacity']), /scene_identity_required/);
    assert.equal(reads, 0);
});

test('field reader projects real modern curve and gradient keys instead of fixture expectations', () => {
    const curve = { kind: 'cc.CurveRange', mode: 1, spline: { *keyframes() { yield [0, { value: 17 }]; yield [1, { value: 53 }]; } } };
    Object.defineProperty(curve, 'curve', { get() { throw Error('deprecated curve getter must not execute'); } });
    const gradient = { kind: 'cc.GradientRange', gradient: { colorKeys: [{ time: 0, color: { r: 2, g: 3, b: 4, a: 255 } }] } };
    const component = { uuid: 'particle', rateOverTime: curve, startColor: gradient };
    const cases = [{ id: 'rate', selector: ['rateOverTime'], expectedWrite: 'set-and-readback',
        validValue: { form: 'literal', value: { mode: 1, keys: [{ time: 0, value: 10 }, { time: 1, value: 40 }] } } },
    { id: 'color', selector: ['startColor'], expectedWrite: 'set-and-readback',
        validValue: { form: 'literal', value: { colorKeys: [{ time: 0, color: { r: 255, g: 255, b: 255, a: 255 } }] } } }];
    const cc = { director: { getScene: () => ({ uuid: sceneUuid, children: [{ name: 'Target', children: [], getComponents: () => [component] }] }) },
        Node: class {}, Component: class {}, Asset: class {}, isValid: () => true,
        js: { getClassName: (value: { kind?: string }) => value.kind ?? 'cc.ParticleSystem' } };
    const compiled = { exports: {} };
    runInNewContext(code, { module: compiled, exports: compiled.exports, __dirname: '/fixture', require: (id: string): unknown => {
        if (id === 'cc') return cc;
        if (id === '/fixture/public-field-contract.json') return { components: [{ componentType: 'cc.ParticleSystem', cases }] };
        throw Error('unexpected module');
    } });
    const reader: unknown = Reflect.get(compiled.exports, 'ComponentNativeFieldReader');
    const read: unknown = Reflect.get(Object(reader), 'read'); if (typeof read !== 'function') throw Error('reader missing');
    const result = JSON.parse(JSON.stringify(Reflect.apply(read, reader, ['/Target', 'cc.ParticleSystem', sceneUuid])));
    assert.equal(result.fields[0].status, 'read'); assert.equal(result.fields[1].status, 'read');
    assert.deepEqual(result.fields[0].value.keys, [{ time: 0, value: 17 }, { time: 1, value: 53 }]);
    assert.deepEqual(result.fields[1].value.colorKeys, gradient.gradient.colorKeys);
});
