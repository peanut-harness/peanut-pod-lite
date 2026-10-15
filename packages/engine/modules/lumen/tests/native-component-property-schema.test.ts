import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';

for (const version of ['3.8.3', '3.8.7']) {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
    test(version + ' Billboard public degrees survive serialized radians and native getter rounding', () => {
        assert.equal(schema.decodeComponentSnapshot('cc.Billboard', {}, () => null).rotation, null);
        assert.equal(schema.decodeComponentSnapshot('cc.PolygonCollider2D', {}, () => null).threshold, null);
        for (const degrees of [0, 1, -45, 90, 180, 360, 12.345]) {
            const encoded = schema.encodeComponentPatch('cc.Billboard', { rotation: degrees, width: 2 }, {});
            assert.equal(encoded._rotation, degrees * (Math.PI / 180));
            assert.equal(encoded._width, 2);
            const native = Math.round(Number(encoded._rotation) * (180 / Math.PI) * 100) / 100;
            assert.equal(schema.decodeComponentSnapshot('cc.Billboard', encoded, () => null).rotation, native);
            assert.equal(native, Math.round(degrees * 100) / 100);
        }
    });
    test(version + ' invalid mixed Billboard patch leaves document unchanged', () => {
        const document = LumenPrefabDocument.createEmptyScene('assets/Angles.scene', 'Root');
        document.setPropertySchema(schema);
        document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.Billboard'] });
        for (const rotation of ['1', null, NaN, Infinity]) {
            const before = JSON.stringify(document.entries);
            assert.throws(() => document.setComponentProperty('/Root/Target', 'cc.Billboard', { width: 7, rotation }), /lumen_property_(type|value)/);
            assert.equal(JSON.stringify(document.entries), before);
        }
        document.setComponentProperty('/Root/Target', 'cc.Billboard', { rotation: 90 });
        const reopened = new LumenPrefabDocument('assets/Angles.scene', JSON.parse(JSON.stringify(document.entries)), schema);
        const component = reopened.entries.find(entry => entry.__type__ === 'cc.Billboard');
        assert(component);
        assert.equal(component._rotation, Math.PI / 2);
        assert.equal(schema.decodeComponentSnapshot('cc.Billboard', component, () => null).rotation, 90);
    });
    test(version + ' FixedConstraint uses the JSON names read by formerlySerializedAs', () => {
        const encoded = schema.encodeComponentPatch('cc.FixedConstraint', { breakForce: 19, breakTorque: 23 }, {});
        assert.deepEqual(encoded, { breakForce: 19, breakTorque: 23 });
        const snapshot = schema.decodeComponentSnapshot('cc.FixedConstraint', encoded, () => null);
        assert.equal(snapshot.breakForce, 19);
        assert.equal(snapshot.breakTorque, 23);
        assert.equal(Object.hasOwn(encoded, '_breakForce'), false);
    });
    test(version + ' HingeConstraint writes actual JSON aliases for vectors and embedded limits', () => {
        const document = LumenPrefabDocument.createEmptyScene('assets/Hinge.scene', 'Root');
        document.setPropertySchema(schema);
        document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.HingeConstraint'] });
        document.setComponentProperty('/Root/Target', 'cc.HingeConstraint', { pivotA: { x: 1, y: 2, z: 3 },
            axis: { x: 1, y: 0, z: 0 }, limit: { enabled: true, lowerLimit: -20, upperLimit: 30 },
            motor: { enabled: true, motorVelocity: 4, motorForceLimit: 5 } });
        const component = document.entries.find(entry => entry.__type__ === 'cc.HingeConstraint');
        assert(component);
        assert.deepEqual(component.pivotA, { __type__: 'cc.Vec3', x: 1, y: 2, z: 3 });
        assert.deepEqual(component.axisA, { __type__: 'cc.Vec3', x: 1, y: 0, z: 0 });
        const limit = component.limitData;
        const motor = component.motorData;
        assert(limit && typeof limit === 'object' && !Array.isArray(limit));
        assert(motor && typeof motor === 'object' && !Array.isArray(motor));
        assert.equal(limit.upperLimit, 30); assert.equal(limit.lowerLimit, -20);
        assert.equal(motor.motorVelocity, 4); assert.equal(motor.motorForceLimit, 5);
        const snapshot = schema.decodeComponentSnapshot('cc.HingeConstraint', component, () => null, index => document.entries[index] ?? null);
        assert.deepEqual(snapshot.limit, { enabled: true, upperLimit: 30, lowerLimit: -20 });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/Target', 'cc.HingeConstraint', { pivotA: { x: 9, y: 0, z: 0 }, limit: { upperLimit: 'wrong' } }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
    });
    test(version + ' Label computed actualFontSize remains listed and rejects writes atomically', () => {
        const field = schema.describeComponent('cc.Label').find(entry => entry.apiName === 'actualFontSize');
        assert(field); assert.equal(field.writable, false); assert.equal(field.writeRefusedReason, 'native_runtime_only');
        const document = LumenPrefabDocument.createEmptyScene('assets/Label.scene', 'Root');
        document.setPropertySchema(schema); document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.UITransform', 'cc.Label'] });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/Target', 'cc.Label', { string: 'partial', actualFontSize: 24 }), /lumen_property_not_persistent/);
        assert.equal(JSON.stringify(document.entries), before);
    });
}
test('Unknown versions preserve previous field mappings and angle units', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    assert.deepEqual(schema.encodeComponentPatch('cc.Billboard', { rotation: 1 }, {}), { _rotation: 1 });
    assert.deepEqual(schema.encodeComponentPatch('cc.FixedConstraint', { breakForce: 1 }, {}), { _breakForce: 1 });
    assert.notEqual(schema.describeComponent('cc.Label').find(field => field.apiName === 'actualFontSize')?.writable, false);
});
