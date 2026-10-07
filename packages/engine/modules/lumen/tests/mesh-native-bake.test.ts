import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

const patch: Readonly<Record<string, boolean | number>> = { bakeable: true, castShadow: true, receiveShadow: false, lightmapSize: 128, useLightProbe: false, bakeToLightProbe: false, reflectionProbe: 0, bakeToReflectionProbe: false };
const mapping: Readonly<Record<string, string>> = { bakeable: '_bakeable', castShadow: '_castShadow', receiveShadow: '_receiveShadow', lightmapSize: '_lightmapSize', useLightProbe: '_useLightProbe', bakeToLightProbe: '_bakeToLightProbe', reflectionProbe: '_reflectionProbeType', bakeToReflectionProbe: '_bakeToReflectionProbe' };
for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' MeshRenderer complete twelve-field schema declares actual ModelBakeSettings type and aliases', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        const fields = schema.describeComponent('cc.MeshRenderer');
        assert.equal(fields.length, 12);
        const field = fields.find(value => value.apiName === 'bakeSettings');
        assert(field);
        assert.equal(field.embeddedType, 'cc.ModelBakeSettings');
        for (const [name, serialized] of Object.entries(mapping)) assert.equal(field.nestedProps?.find(value => value.apiName === name)?.serializedName, serialized);
    });
    test(version + ' MeshRenderer legal bake settings save and source-only reopen use a typed owned embedded entry', () => {
        const root = mkdtempSync(join(tmpdir(), 'peanut-mesh-bake-'));
        try {
            mkdirSync(join(root, 'assets'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
            const session = new LumenSession({ projectRoot: root, cocosVersion: version });
            session.scaffoldPrefab({ prefabRelativePath: 'assets/Fields.prefab', rootName: 'Fields', template: 'empty' });
            session.addChildFromTemplate({ parentPath: '/Fields', template: '3d/Cube', name: 'Box' });
            session.setComponentProperty({ nodePath: '/Fields/Box', componentType: 'cc.MeshRenderer', patch: { bakeSettings: patch } });
            session.save();
            const doc: unknown = JSON.parse(readFileSync(join(root, 'assets/Fields.prefab'), 'utf8'));
            assert(Array.isArray(doc));
            const renderer = doc.find(value => value.__type__ === 'cc.MeshRenderer');
            assert(renderer);
            const reference: unknown = renderer.bakeSettings;
            assert(reference !== null && typeof reference === 'object');
            const embedded: unknown = '__id__' in reference && typeof reference.__id__ === 'number' ? doc[reference.__id__] : reference;
            assert(embedded !== null && typeof embedded === 'object' && '__type__' in embedded);
            assert.equal(embedded.__type__, 'cc.ModelBakeSettings');
            for (const [name, serialized] of Object.entries(mapping)) assert(serialized in embedded && Reflect.get(embedded, serialized) === patch[name]);
            const reopened = new LumenSession({ projectRoot: root, cocosVersion: version });
            reopened.openPrefab('assets/Fields.prefab');
            const actual = reopened.inspectNode('/Fields/Box').components.find(value => value.type === 'cc.MeshRenderer');
            assert(actual);
            assert.deepEqual(actual.props.bakeSettings, patch);
            assert.equal(actual.props.mesh, '1263d74c-8167-4928-91a6-4e2672411f47@a804a');
            assert.deepEqual(actual.props.materials, ['620b6bf3-0369-4560-837f-2a2c00b73c26']);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
test('Unverified MeshRenderer versions retain prior catalogue without a guessed native bake contract', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    assert.equal(schema.describeComponent('cc.MeshRenderer').find(value => value.apiName === 'bakeSettings')?.embeddedType, undefined);
});
