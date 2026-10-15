import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';

const output = buildSync({ entryPoints: [fileURLToPath(new URL('./component-native-field-reader.ts', import.meta.url))],
    platform: 'node', format: 'cjs', target: 'node14', write: false });
const code = output.outputFiles?.[0]?.text;
assert(code);

for (const [type, old, modern] of [
    ['cc.Camera', 'color', 'clearColor'], ['cc.Camera', 'depth', 'clearDepth'],
    ['cc.Camera', 'stencil', 'clearStencil'], ['cc.ParticleSystem', 'enableCulling', 'dataCulling'],
]) {
    test(type + '.' + old + ' old contract is rejected before deprecated getter execution; modern getter is read', () => {
        let deprecatedReads = 0; let modernReads = 0;
        const component = { uuid: 'owned-component' };
        Object.defineProperty(component, old, { get: () => { deprecatedReads++; throw Error('deprecated getter executed'); } });
        Object.defineProperty(component, modern, { get: () => { modernReads++; return 7; } });
        const contract = { components: [{ componentType: type, cases: [{ id: 'field', selector: [old], safeSelector: [old], validValue: { form: 'literal', value: 7 } }] }] };
        const compiled = { exports: {} };
        const cc = { director: { getScene: () => ({ children: [{ name: 'Target', children: [], getComponents: () => [component] }] }) },
            Component: class {}, js: { getClassName: () => type }, isValid: () => true };
        runInNewContext(code, { module: compiled, exports: compiled.exports, __dirname: '/fixture', require: (id: string): unknown => {
            if (id === 'cc') { return cc; }
            if (id === '/fixture/public-field-contract.json') { return contract; }
            throw Error('unexpected module');
        } });
        const reader: unknown = Reflect.get(compiled.exports, 'ComponentNativeFieldReader'); assert.equal(typeof reader, 'function');
        const read: unknown = Reflect.get(Object(reader), 'read'); assert.equal(typeof read, 'function');
        if (typeof read !== 'function') { throw Error('reader missing'); }
        assert.throws(() => Reflect.apply(read, reader, ['/Target', type]), /deprecated_getter_contract/);
        assert.equal(deprecatedReads, 0); assert.equal(modernReads, 0);
        contract.components[0]?.cases.forEach(field => { field.safeSelector = [modern]; });
        const result: unknown = Reflect.apply(read, reader, ['/Target', type]);
        assert(JSON.stringify(result).includes('"value":7'));
        assert.equal(modernReads, 1); assert.equal(deprecatedReads, 0);
    });
}
