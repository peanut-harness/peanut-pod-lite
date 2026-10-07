import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' UITransform priority remains listed but discloses nonpersistent native write', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        assert.equal(schema.listApiNames('cc.UITransform').length, 7);
        const priority = schema.describeComponent('cc.UITransform').find(field => field.apiName === 'priority');
        assert.equal(Reflect.get(priority!, 'writable'), false);
        assert.equal(Reflect.get(priority!, 'writeRefusedReason'), 'native_runtime_only');
    });

    test(version + ' nonpersistent field rejects mixed patches before any component mutation', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        const component = {
            _contentSize: { __type__: 'cc.Size', width: 200, height: 40 },
            _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
        };
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
        assert.throws(() => schema.applyComponentPatch('cc.UITransform', component,
            { width: 250, priority: 3 }, resolver, host), /lumen_property_not_persistent:cc.UITransform.priority/);
        assert.deepEqual(component, before);
        assert.throws(() => schema.encodeComponentPatch('cc.UITransform', { width: 250, priority: 3 }, component),
            /lumen_property_not_persistent:cc.UITransform.priority/);
        assert.deepEqual(component, before);
    });

    test(version + ' direct session rejects priority before save and retains six writable aliases', () => {
        const root = mkdtempSync(join(tmpdir(), 'peanut-ui-priority-'));
        try {
            mkdirSync(join(root, 'assets'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
            const session = new LumenSession({ projectRoot: root, cocosVersion: version });
            const path = 'assets/Fields.prefab';
            session.scaffoldPrefab({ prefabRelativePath: path, rootName: 'Fields', template: 'empty' });
            const before = [path, path + '.meta'].map(p => readFileSync(join(root, p)));
            assert.throws(() => session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.UITransform',
                patch: { width: 250, priority: 3 } }), /lumen_property_not_persistent:cc.UITransform.priority/);
            session.save();
            for (const [i, p] of [path, path + '.meta'].entries()) assert.deepEqual(readFileSync(join(root, p)), before[i]);
            session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.UITransform',
                patch: { contentSize: { width: 210, height: 65 }, anchorPoint: { x: 0.2, y: 0.7 } } });
            session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.UITransform',
                patch: { width: 240, height: 72, anchorX: 0.35, anchorY: 0.65 } });
            session.save();
            const reopened = new LumenSession({ projectRoot: root, cocosVersion: version });
            reopened.openPrefab(path);
            const actual = reopened.inspectNode('/Fields').components.find(x => x.type === 'cc.UITransform')!.props;
            assert.deepEqual(actual.contentSize, { __type__: 'cc.Size', width: 240, height: 72 });
            assert.deepEqual(actual.anchorPoint, { __type__: 'cc.Vec2', x: 0.35, y: 0.65 });
            assert.equal(actual.width, 240); assert.equal(actual.height, 72);
            assert.equal(actual.anchorX, 0.35); assert.equal(actual.anchorY, 0.65);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
