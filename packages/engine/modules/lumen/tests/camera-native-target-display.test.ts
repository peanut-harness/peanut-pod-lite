import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' Camera keeps15 fields but honestly discloses unsupported targetDisplay', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        assert.equal(schema.listApiNames('cc.Camera').length, 15);
        const field = schema.describeComponent('cc.Camera').find(value => value.apiName === 'targetDisplay');
        assert(field);
        assert.equal(field.writable, false);
        assert.equal(field.writeRefusedReason, 'native_unsupported');
        assert.equal(schema.describeComponent('cc.UITransform').find(value => value.apiName === 'priority')?.writeRefusedReason, 'native_runtime_only');
    });

    test(version + ' unsupported Camera mixed patch rejects before earlier primitive or reference mutation', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        const component = { _fov: 45, _projection: 0, _color: { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 } };
        const before = structuredClone(component);
        const resolver = {
            resolveNodeRef: () => { throw new Error('unexpected node reference'); },
            resolveComponentRef: () => { throw new Error('unexpected component reference'); },
        };
        const host = {
            readEmbedded: () => { throw new Error('unexpected embedded read'); },
            resolveOrCreateEmbedded: () => { throw new Error('unexpected embedded create'); },
            allocateEmbedded: () => { throw new Error('unexpected embedded allocation'); },
            forkForOwner: () => { throw new Error('unexpected embedded fork'); },
        };
        assert.throws(() => schema.applyComponentPatch('cc.Camera', component,
            { fov: 52, targetDisplay: 2 }, resolver, host), /lumen_property_not_persistent:cc.Camera.targetDisplay/);
        assert.deepEqual(component, before);
        assert.throws(() => schema.encodeComponentPatch('cc.Camera', { fov: 52, targetDisplay: 2 }, component),
            /lumen_property_not_persistent:cc.Camera.targetDisplay/);
        assert.deepEqual(component, before);
    });

    test(version + ' Camera direct session refuses unsupported field before save and preserves other14 fields', () => {
        const root = mkdtempSync(join(tmpdir(), 'peanut-camera-native-contract-'));
        try {
            mkdirSync(join(root, 'assets'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
            const session = new LumenSession({ projectRoot: root, cocosVersion: version });
            const path = 'assets/Fields.prefab';
            session.scaffoldPrefab({ prefabRelativePath: path, rootName: 'Fields', template: 'Camera' });
            const before = [path, path + '.meta'].map(value => readFileSync(join(root, value)));
            assert.throws(() => session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.Camera',
                patch: { fov: 52, targetDisplay: 2 } }), /lumen_property_not_persistent:cc.Camera.targetDisplay/);
            session.save();
            for (const [i, value] of [path, path + '.meta'].entries()) assert.deepEqual(readFileSync(join(root, value)), before[i]);
            const patch = { projection: 0, priority: 9, fov: 52, orthoHeight: 137.5, near: 3, far: 2200,
                color: { r: 31, g: 79, b: 127, a: 211 }, depth: .75, stencil: 3, clearFlags: 7,
                rect: { x: .1, y: .15, width: .7, height: .6 }, visibility: 41943040, screenScale: .85, usePostProcess: true };
            session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.Camera', patch });
            session.save();
            const reopened = new LumenSession({ projectRoot: root, cocosVersion: version });
            reopened.openPrefab(path);
            const actual = reopened.inspectNode('/Fields').components.find(value => value.type === 'cc.Camera');
            assert(actual);
            for (const [key, value] of Object.entries(patch)) {
                const expected = key === 'color' ? { __type__: 'cc.Color', ...patch.color }
                    : key === 'rect' ? { __type__: 'cc.Rect', ...patch.rect } : value;
                assert.deepEqual(actual.props[key], expected);
            }
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}

test('Unverified Camera version does not inherit a guessed native unsupported contract', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    assert.equal(schema.describeComponent('cc.Camera').find(value => value.apiName === 'targetDisplay')?.writable, undefined);
    assert.deepEqual(schema.encodeComponentPatch('cc.Camera', { targetDisplay: 2 }, {}), { _targetDisplay: 2 });
});
