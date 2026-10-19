import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityNativeInspector, type IResourceNativeInspectorQueries } from '../scripts/resource-stability-native-inspector.mts';

test('native Inspector keeps exact SDK dump and authentic loaded identity', async () => {
    const called: string[] = [];
    const queries: IResourceNativeInspectorQueries = {
        loadIdentity: async (uuid) => ({ actualUuid: uuid, type: 'cc.PhysicsMaterial', valid: true }),
        physicsMaterial: async (uuid) => { called.push(uuid); return { friction: { value: 0.5 } }; },
        animationGraphVariant: async () => { throw new Error('unexpected_reader'); },
        renderPipeline: async () => { throw new Error('unexpected_reader'); },
        animationMask: async () => { throw new Error('unexpected_reader'); },
    };
    const value = await new ResourceStabilityNativeInspector(queries).read('own-uuid');
    assert.deepEqual(called, ['own-uuid']);
    assert.deepEqual(value.semantic, { friction: { value: 0.5 } });
    assert.equal(value.actualUuid, 'own-uuid');
});

test('unsupported native kinds and stale loaded identity cannot become partial success', async () => {
    let actualUuid = 'own'; let type = 'cc.TextAsset'; let calls = 0;
    const queries: IResourceNativeInspectorQueries = {
        loadIdentity: async () => ({ actualUuid, type, valid: true }),
        physicsMaterial: async () => { calls += 1; return {}; }, animationGraphVariant: async () => ({}),
        renderPipeline: async () => ({}), animationMask: async () => ({}),
    };
    const reader = new ResourceStabilityNativeInspector(queries);
    await assert.rejects(reader.read('own'), /type_blocked:cc.TextAsset/u);
    type = 'cc.PhysicsMaterial'; actualUuid = 'foreign';
    await assert.rejects(reader.read('own'), /identity_mismatch/u);
    assert.equal(calls, 0);
});
