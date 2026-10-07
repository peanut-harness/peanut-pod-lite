import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

const lights = [
    { type: 'cc.DirectionalLight', fields: 20 },
    { type: 'cc.SphereLight', fields: 6 },
    { type: 'cc.SpotLight', fields: 11 },
];
for (const version of ['3.8.3', '3.8.7']) {
    for (const light of lights) {
        test(version + ' ' + light.type + ' keeps complete catalogue and discloses unsupported intensity', () => {
            const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
            assert.equal(schema.listApiNames(light.type).length, light.fields);
            const field = schema.describeComponent(light.type).find(value => value.apiName === 'intensity');
            assert(field);
            assert.equal(field.writable, false);
            assert.equal(field.writeRefusedReason, 'native_unsupported');
            assert.equal(schema.describeComponent('cc.UITransform').find(value => value.apiName === 'priority')?.writeRefusedReason, 'native_runtime_only');
            assert.equal(schema.describeComponent('cc.Camera').find(value => value.apiName === 'targetDisplay')?.writeRefusedReason, 'native_unsupported');
        });
        test(version + ' ' + light.type + ' refuses single and mixed intensity before any mutation', () => {
            const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
            const component = { _colorTemperature: 6500, _intensity: 99, _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 } };
            const before = structuredClone(component);
            const resolver = { resolveNodeRef: () => { throw new Error('unexpected node reference'); }, resolveComponentRef: () => { throw new Error('unexpected component reference'); } };
            const host = { readEmbedded: () => { throw new Error('unexpected embedded read'); }, resolveOrCreateEmbedded: () => { throw new Error('unexpected embedded create'); }, allocateEmbedded: () => { throw new Error('unexpected embedded allocation'); }, forkForOwner: () => { throw new Error('unexpected embedded fork'); } };
            for (const patch of [{ intensity: 23456 }, { colorTemperature: 4200, intensity: 23456 }]) {
                assert.throws(() => schema.applyComponentPatch(light.type, component, patch, resolver, host), error => error instanceof Error && error.message === 'lumen_property_not_persistent:' + light.type + '.intensity');
                assert.deepEqual(component, before);
                assert.throws(() => schema.encodeComponentPatch(light.type, patch, component), error => error instanceof Error && error.message === 'lumen_property_not_persistent:' + light.type + '.intensity');
                assert.deepEqual(component, before);
            }
        });
        test(version + ' ' + light.type + ' session preserves saved bytes while supported light fields remain writable', () => {
            const root = mkdtempSync(join(tmpdir(), 'peanut-light-native-contract-'));
            try {
                mkdirSync(join(root, 'assets'));
                writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
                const session = new LumenSession({ projectRoot: root, cocosVersion: version });
                const path = 'assets/Fields.prefab';
                session.scaffoldPrefab({ prefabRelativePath: path, rootName: 'Fields', template: 'empty' });
                session.attachComponent({ nodePath: '/Fields', builtinType: light.type });
                session.save();
                const before = [path, path + '.meta'].map(value => readFileSync(join(root, value)));
                assert.throws(() => session.setComponentProperty({ nodePath: '/Fields', componentType: light.type, patch: { colorTemperature: 4200, intensity: 23456 } }), error => error instanceof Error && error.message === 'lumen_property_not_persistent:' + light.type + '.intensity');
                session.save();
                for (const [i, value] of [path, path + '.meta'].entries()) assert.deepEqual(readFileSync(join(root, value)), before[i]);
                const patch = { colorTemperature: 4200, useColorTemperature: true, color: { r: 73, g: 129, b: 201, a: 255 } };
                session.setComponentProperty({ nodePath: '/Fields', componentType: light.type, patch });
                session.save();
                const reopened = new LumenSession({ projectRoot: root, cocosVersion: version });
                reopened.openPrefab(path);
                const actual = reopened.inspectNode('/Fields').components.find(value => value.type === light.type);
                assert(actual);
                assert.equal(actual.props.colorTemperature, patch.colorTemperature);
                assert.equal(actual.props.useColorTemperature, patch.useColorTemperature);
                assert.deepEqual(actual.props.color, { __type__: 'cc.Color', ...patch.color });
            } finally { rmSync(root, { recursive: true, force: true }); }
        });
    }
}
test('Unverified light versions retain prior codec behavior without guessed native support claims', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    for (const light of lights) {
        assert.equal(schema.describeComponent(light.type).find(value => value.apiName === 'intensity')?.writable, undefined);
        assert.deepEqual(schema.encodeComponentPatch(light.type, { intensity: 23456 }, {}), { _intensity: 23456 });
    }
});
