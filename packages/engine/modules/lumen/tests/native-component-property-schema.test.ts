import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';

for (const version of ['3.8.3', '3.8.7']) {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
    test(version + ' unavailable light and SafeArea fields remain listed and reject scene writes without partial changes', () => {
        const cases = [['cc.PointLight', 'intensity'], ['cc.PointLight', 'size'], ['cc.RangedDirectionalLight', 'intensity'],
            ['cc.SpriteRenderer', 'sortLayer'], ['cc.SpriteRenderer', 'sortOrder'],
            ...(version === '3.8.3' ? [['cc.SafeArea', 'symmetric']] : [])];
        for (const [type, name] of cases) {
            assert(type && name);
            const field = schema.describeComponent(type).find(entry => entry.apiName === name);
            assert(field); assert.equal(field.writable, false); assert.equal(field.writeRefusedReason, 'native_unsupported');
            const document = LumenPrefabDocument.createEmptyScene('assets/Light.scene', 'Root');
            document.setPropertySchema(schema); document.addChildFromSpec('/Root', { name: 'Target', components: [type] });
            const before = JSON.stringify(document.entries);
            assert.throws(() => document.setComponentProperty('/Root/Target', type, {
                ...(type === 'cc.SafeArea' ? {} : { color: { r: 20, g: 40, b: 60, a: 255 } }), [name]: name === 'symmetric' ? false : 1,
            }), /lumen_property_not_persistent/);
            assert.equal(JSON.stringify(document.entries), before);
        }
        if (version === '3.8.7') {
            assert.notEqual(schema.describeComponent('cc.SafeArea').find(field => field.apiName === 'symmetric')?.writable, false);
            assert.deepEqual(schema.encodeComponentPatch('cc.SafeArea', { symmetric: false }, {}), { _symmetric: false });
        }
    });
    test(version + ' ParticleSystem modern and legacy culling names survive true/false serialization through the native JSON slot', () => {
        let document = LumenPrefabDocument.createEmptyScene('assets/Particle.scene', 'Root');
        document.setPropertySchema(schema); document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.ParticleSystem'] });
        for (const [key, value] of [['dataCulling', true], ['enableCulling', false], ['enableCulling', true], ['dataCulling', false]] as const) {
            document.setComponentProperty('/Root/Target', 'cc.ParticleSystem', { [key]: value });
            document = new LumenPrefabDocument('assets/Particle.scene', JSON.parse(JSON.stringify(document.entries)), schema);
            const component = document.entries.find(entry => entry.__type__ === 'cc.ParticleSystem'); assert(component);
            assert.equal(component.enableCulling, value);
            assert.equal(Object.hasOwn(component, '_dataCulling'), false);
            const snapshot = schema.decodeComponentSnapshot('cc.ParticleSystem', component, () => null);
            assert.equal(snapshot.dataCulling, value); assert.equal(snapshot.enableCulling, value);
        }
        const existing = { enableCulling: false, _renderCulling: false }; const before = JSON.stringify(existing);
        assert.throws(() => schema.encodeComponentPatch('cc.ParticleSystem', { renderCulling: true, dataCulling: 1 }, existing), /lumen_property_type:dataCulling:boolean/);
        assert.equal(JSON.stringify(existing), before);
    });
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
        assert('upperLimit' in limit && 'lowerLimit' in limit);
        assert('motorVelocity' in motor && 'motorForceLimit' in motor);
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
    test(version + ' graph and DragonBones public playTimes survive their distinct serialized slots', () => {
        // 此 UUID 仅用于离线编解码测试，不代表 AssetDB 注册或原生加载通过。
        const uuid = '12345678-1234-4234-8234-123456789abc';
        const document = LumenPrefabDocument.createEmptyScene('assets/Animation.scene', 'Root');
        document.setPropertySchema(schema);
        document.addChildFromSpec('/Root', { name: 'Graph', components: ['cc.animation.AnimationController'] });
        document.addChildFromSpec('/Root', { name: 'Dragon', components: ['dragonBones.ArmatureDisplay'] });
        const dragon = document.entries.find(entry => entry.__type__ === 'dragonBones.ArmatureDisplay');
        assert(dragon); dragon._playTimes = -1;
        document.setComponentProperty('/Root/Graph', 'cc.animation.AnimationController', { graph: uuid });
        document.setComponentProperty('/Root/Dragon', 'dragonBones.ArmatureDisplay', { playTimes: 2 });
        const reopened = new LumenPrefabDocument('assets/Animation.scene', JSON.parse(JSON.stringify(document.entries)), schema);
        const graph = reopened.entries.find(entry => entry.__type__ === 'cc.animation.AnimationController');
        const savedDragon = reopened.entries.find(entry => entry.__type__ === 'dragonBones.ArmatureDisplay');
        assert(graph && savedDragon);
        assert.deepEqual(graph.graph, { __uuid__: uuid });
        assert.equal(Object.hasOwn(graph, '_graph'), false);
        assert.equal(savedDragon.playTimes, 2); assert.equal(savedDragon._playTimes, -1);
        assert.equal(schema.decodeComponentSnapshot('cc.animation.AnimationController', graph, () => null).graph, uuid);
        assert.equal(schema.decodeComponentSnapshot('dragonBones.ArmatureDisplay', savedDragon, () => null).playTimes, 2);
        for (const [path, type, patch] of [
            ['/Root/Graph', 'cc.animation.AnimationController', { enabled: false, graph: 7 }],
            ['/Root/Dragon', 'dragonBones.ArmatureDisplay', { timeScale: 2, playTimes: 'wrong' }],
        ] as const) {
            const before = JSON.stringify(reopened.entries);
            assert.throws(() => reopened.setComponentProperty(path, type, patch), /lumen_property_(type|value)/);
            assert.equal(JSON.stringify(reopened.entries), before);
        }
    });
    test(version + ' engine managed reflection probe identity rejects single and mixed writes atomically', () => {
        const field = schema.describeComponent('cc.ReflectionProbe').find(entry => entry.apiName === 'probeId');
        assert(field); assert.equal(field.writable, false); assert.equal(field.writeRefusedReason, 'native_unsupported');
        const document = LumenPrefabDocument.createEmptyScene('assets/Probe.scene', 'Root');
        document.setPropertySchema(schema);
        document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.ReflectionProbe'] });
        for (const patch of [{ probeId: 1 }, { size: { x: 2, y: 3, z: 4 }, probeId: 1 }]) {
            const before = JSON.stringify(document.entries);
            assert.throws(() => document.setComponentProperty('/Root/Target', 'cc.ReflectionProbe', patch), /lumen_property_not_persistent/);
            assert.equal(JSON.stringify(document.entries), before);
        }
    });
}
test('Unknown versions preserve previous field mappings and angle units', () => {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.4'));
    assert.deepEqual(schema.encodeComponentPatch('cc.Billboard', { rotation: 1 }, {}), { _rotation: 1 });
    assert.deepEqual(schema.encodeComponentPatch('cc.FixedConstraint', { breakForce: 1 }, {}), { _breakForce: 1 });
    assert.deepEqual(schema.encodeComponentPatch('cc.ParticleSystem', { dataCulling: true }, {}), { _dataCulling: true });
    assert.deepEqual(schema.encodeComponentPatch('cc.animation.AnimationController', { graph: null }, {}), { _graph: null });
    assert.deepEqual(schema.encodeComponentPatch('dragonBones.ArmatureDisplay', { playTimes: 2 }, {}), { _playTimes: 2 });
    assert.notEqual(schema.describeComponent('cc.ReflectionProbe').find(field => field.apiName === 'probeId')?.writable, false);
    assert.notEqual(schema.describeComponent('cc.Label').find(field => field.apiName === 'actualFontSize')?.writable, false);
    for (const [type, name] of [['cc.PointLight', 'intensity'], ['cc.PointLight', 'size'], ['cc.RangedDirectionalLight', 'intensity'], ['cc.SafeArea', 'symmetric'], ['cc.SpriteRenderer', 'sortLayer'], ['cc.SpriteRenderer', 'sortOrder']]) {
        assert(type && name); assert.notEqual(schema.describeComponent(type).find(field => field.apiName === name)?.writable, false);
    }
});
