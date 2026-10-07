import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenSession } from '../source/session';

test('3.8.7 Polygon full eight fields disclose runtime-only threshold', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7'));
    const fields = schema.describeComponent('cc.PolygonCollider2D');
    assert.equal(fields.length, 8);
    const threshold = fields.find(field => field.apiName === 'threshold')!;
    assert.equal(threshold.serializedName, 'threshold');
    assert.equal(threshold.writable, false);
    assert.equal(threshold.writeRefusedReason, 'native_runtime_only');
    for (const field of fields.filter(field => field.apiName !== 'threshold')) assert.notEqual(field.writable, false);
});
for (const version of ['3.8.3', '3.8.8']) {
    test(version + ' unverified threshold keeps previous contract without a native support claim', () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
        assert.equal(schema.describeComponent('cc.PolygonCollider2D').length, 8);
        assert.notEqual(schema.describeComponent('cc.PolygonCollider2D').find(field => field.apiName === 'threshold')!.writable, false);
        const raw = { threshold: 1 };
        assert.deepEqual(schema.encodeComponentPatch('cc.PolygonCollider2D', { threshold: 0.5 }, raw), { threshold: 0.5 });
        assert.deepEqual(raw, { threshold: 1 });
    });
}
for (const patch of [{ threshold: 0.5 }, { density: 3, threshold: 0.5 }]) {
    test('3.8.7 threshold encoding refuses the entire patch before mutation: ' + JSON.stringify(patch), () => {
        const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7'));
        const component = { _density: 2.5, threshold: 1, _points: [{ __type__: 'cc.Vec2', x: 1, y: 2 }] };
        const before = structuredClone(component);
        assert.throws(() => schema.encodeComponentPatch('cc.PolygonCollider2D', patch, component), /lumen_property_not_persistent:cc.PolygonCollider2D.threshold/);
        assert.deepEqual(component, before);
    });
}
test('3.8.7 direct session single and mixed threshold refuses before tree/source/meta changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-polygon-threshold-'));
    try {
        mkdirSync(join(root, 'assets'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version: '3.8.7' } }));
        const session = new LumenSession({ projectRoot: root, cocosVersion: '3.8.7' });
        const path = 'assets/Fields.prefab';
        session.scaffoldPrefab({ prefabRelativePath: path, rootName: 'Fields', template: 'empty' });
        session.attachComponent({ nodePath: '/Fields', builtinType: 'cc.PolygonCollider2D' });
        session.save();
        const before = [path, path + '.meta'].map(p => readFileSync(join(root, p)));
        const tree = session.inspectNode('/Fields');
        for (const patch of [{ threshold: 0.5 }, { density: 3, threshold: 0.5 }]) {
            assert.throws(() => session.setComponentProperty({ nodePath: '/Fields', componentType: 'cc.PolygonCollider2D', patch }), /lumen_property_not_persistent:cc.PolygonCollider2D.threshold/);
            assert.deepEqual(session.inspectNode('/Fields'), tree);
            session.save();
            for (const [i, p] of [path, path + '.meta'].entries()) assert.deepEqual(readFileSync(join(root, p)), before[i]);
        }
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('3.8.7 seven persistent Polygon fields and other-component threshold remain writable', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7'));
    assert.deepEqual(schema.encodeComponentPatch('cc.PolygonCollider2D', { density: 3, offset: { x: 7, y: -9 }, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] }, {}), {
        _density: 3, _offset: { __type__: 'cc.Vec2', x: 7, y: -9 }, _points: [{ __type__: 'cc.Vec2', x: 0, y: 0 }, { __type__: 'cc.Vec2', x: 2, y: 0 }, { __type__: 'cc.Vec2', x: 0, y: 2 }],
    });
    assert.equal(schema.encodeComponentPatch('cc.Bloom', { threshold: 0.6 }, {})._threshold, 0.6);
});
