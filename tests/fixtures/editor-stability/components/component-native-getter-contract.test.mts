import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ComponentNativeGetterContract } from './component-native-getter-contract.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

for (const [type, name, aliases, directory] of [
    ['cc.Camera', 'Camera', { color: 'clearColor', depth: 'clearDepth', stencil: 'clearStencil' }, 'misc'],
    ['cc.ParticleSystem', 'ParticleSystem', { enableCulling: 'dataCulling' }, 'particle'],
] as const) {
    test(type + ' deprecated getters use only source-proven modern accessors and preserve suffixes', () => {
        const root = mkdtempSync(join(tmpdir(), 'native-getter-proof-'));
        try {
            const path = directory + '/component.ts'; const deprecated = join(root, 'cocos', directory, 'deprecated.ts');
            mkdirSync(join(root, 'cocos', directory), { recursive: true });
            const source = `class ${name} { ${Object.values(aliases).map(alias => `get ${alias}() { return 1; }`).join(' ')} }`;
            const sha256 = createHash('sha256').update(source).digest('hex');
            writeFileSync(join(root, 'cocos', path), source);
            const forward = `replaceProperty(${name}.prototype, '${name}.prototype', [${Object.entries(aliases).map(([old, modern]) => `{ name: '${old}', newName: '${modern}' }`).join(',')}]);`;
            writeFileSync(deprecated, forward);
            const declaration: IComponentNativeDeclaration = { type, sources: [{ reference: path, line: 1, sha256 }], requiredComponents: [], dependencyProofs: [],
                baseTypes: [], unresolvedDependencies: [], classification: 'source-declared-runtime-unverified',
                properties: Object.values(aliases).map(alias => ({ name: '_' + alias, type: 'number', reference: path, line: 1, sha256, registeredTypes: [], numericEnumValues: [] })) };
            for (const [old, modern] of Object.entries(aliases)) {
                const result = ComponentNativeGetterContract.resolve(root, type, [old, 'x'], declaration);
                assert(result); assert.deepEqual(result.selector, [modern, 'x']);
                assert.equal(result.proof.deprecation.original, old);
                assert.equal(result.proof.deprecation.replacement, modern);
                assert.equal(result.proof.deprecation.sha256, createHash('sha256').update(forward).digest('hex'));
            }
            const first = Object.keys(aliases)[0]; assert(first);
            writeFileSync(deprecated, forward.replace(name + '.prototype', 'Unrelated.prototype'));
            assert.throws(() => ComponentNativeGetterContract.resolve(root, type, [first], declaration), /deprecation_forward_missing/);
            writeFileSync(deprecated, forward);
            writeFileSync(join(root, 'cocos', path), source + '// drift');
            assert.throws(() => ComponentNativeGetterContract.resolve(root, type, [first], declaration), /getter_source_changed/);
            assert.throws(() => ComponentNativeGetterContract.resolve(root, type, [first], undefined), /getter_source_missing/);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('Camera alias mapping never changes another component color getter', () => {
    assert.equal(ComponentNativeGetterContract.resolve('/not-read', 'cc.Label', ['color'], undefined), null);
});
