import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' MeshRenderer boolean receiveShadow uses the actual native receiving enum in the complete catalogue', () => {
        const fields = new LumenComponentPropertySchema(LumenCocosVersion.parse(version)).describeComponent('cc.MeshRenderer');
        assert.equal(fields.length, 12);
        const field = fields.find(value => value.apiName === 'receiveShadow');
        assert(field);
        assert.equal(field.kind, 'boolean');
        assert.equal(field.serializedName, '_shadowReceivingMode');
        assert.equal(fields.find(value => value.apiName === 'bakeSettings')?.nestedProps?.find(value => value.apiName === 'receiveShadow')?.serializedName, '_receiveShadow');
    });
    test(version + ' MeshRenderer boolean encoding changes only native receiving mode and retains ordinary booleans', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        for (const value of [false, true]) {
            assert.deepEqual(schema.encodeComponentPatch('cc.MeshRenderer', { receiveShadow: value, enableMorph: false }, {}), { _shadowReceivingMode: value ? 1 : 0, _enableMorph: false });
        }
        assert.deepEqual(schema.encodeComponentPatch('cc.Sprite', { grayscale: true }, {}), { _useGrayscale: true });
    });
    test(version + ' MeshRenderer decodes exact native off/on without trusting a shadow field or normalizing unknown modes', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        for (const mode of [0, 1]) assert.equal(schema.decodeComponentSnapshot('cc.MeshRenderer', { _shadowReceivingMode: mode, _receiveShadow: mode === 0 }, () => null).receiveShadow, mode === 1);
        assert.equal(schema.decodeComponentSnapshot('cc.MeshRenderer', { _shadowReceivingMode: 2 }, () => null).receiveShadow, 2);
    });
    test(version + ' MeshRenderer rejects numeric caller booleans without modifying the existing object', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        const existing = { _shadowReceivingMode: 1, _enableMorph: true };
        const before = JSON.stringify(existing);
        assert.throws(() => schema.encodeComponentPatch('cc.MeshRenderer', { enableMorph: false, receiveShadow: 1 }, existing), /lumen_property_type:receiveShadow:boolean/);
        assert.equal(JSON.stringify(existing), before);
    });
    test(version + ' MeshRenderer save and reopen preserve numeric native receiving mode, bake boolean and owned references', () => {
        const root = mkdtempSync(join(tmpdir(), 'peanut-mesh-shadow-'));
        try {
            mkdirSync(join(root, 'assets'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
            const session = new LumenSession({ projectRoot: root, cocosVersion: version });
            session.scaffoldPrefab({ prefabRelativePath: 'assets/Fields.prefab', rootName: 'Fields', template: 'empty' });
            session.addChildFromTemplate({ parentPath: '/Fields', template: '3d/Cube', name: 'Box' });
            for (const value of [false, true]) {
                session.setComponentProperty({ nodePath: '/Fields/Box', componentType: 'cc.MeshRenderer', patch: { receiveShadow: value, enableMorph: false, bakeSettings: { receiveShadow: false } } });
                session.save();
                const doc: unknown = JSON.parse(readFileSync(join(root, 'assets/Fields.prefab'), 'utf8'));
                assert(Array.isArray(doc));
                const renderer = doc.find(entry => entry.__type__ === 'cc.MeshRenderer');
                assert(renderer);
                assert.equal(renderer._shadowReceivingMode, value ? 1 : 0);
                assert.equal(Object.prototype.hasOwnProperty.call(renderer, '_receiveShadow'), false);
                const reference: unknown = renderer.bakeSettings;
                assert(reference !== null && typeof reference === 'object');
                const embedded: unknown = '__id__' in reference && typeof reference.__id__ === 'number' ? doc[reference.__id__] : reference;
                assert(embedded !== null && typeof embedded === 'object' && '_receiveShadow' in embedded);
                assert.equal(embedded._receiveShadow, false);
                const reopened = new LumenSession({ projectRoot: root, cocosVersion: version });
                reopened.openPrefab('assets/Fields.prefab');
                const actual = reopened.inspectNode('/Fields/Box').components.find(entry => entry.type === 'cc.MeshRenderer');
                assert(actual);
                assert.equal(actual.props.receiveShadow, value);
                assert.equal(actual.props.enableMorph, false);
                assert.equal(actual.props.mesh, '1263d74c-8167-4928-91a6-4e2672411f47@a804a');
                assert.deepEqual(actual.props.materials, ['620b6bf3-0369-4560-837f-2a2c00b73c26']);
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('Unverified MeshRenderer version keeps the prior boolean mapping', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    assert.deepEqual(schema.encodeComponentPatch('cc.MeshRenderer', { receiveShadow: false }, {}), { _receiveShadow: false });
});
