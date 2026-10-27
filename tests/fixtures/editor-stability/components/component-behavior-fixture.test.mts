import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentBehaviorFixture } from './component-behavior-fixture.mts';

const originalUuid = '251de1db-3413-45a3-a15b-5abddfa020fe';
const identity = (type: string) => ({ relativePath: `assets/components/_lifecycle/task51-attempt-28/presentations/${type}.scene`,
    sceneUuid: 'cb80be9a-25c5-48ec-91b4-57a7d87d768b', scriptUuid: '5470762b-a2ac-4ae2-a835-de77b0b8f8b8' });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const meta = bytes({ importer: 'scene', ver: '1.1.50', uuid: originalUuid, userData: {} });
const source = (type: string) => [{ __type__: 'cc.SceneAsset', _name: type }, { __type__: 'cc.Scene', _id: originalUuid },
    { __type__: 'cc.Node', _name: 'Target', _components: [{ __id__: 3 }] },
    { __type__: type, node: { __id__: 2 }, _enabled: true, _mesh: { __uuid__: 'real-mesh' },
        _skeleton: { __uuid__: 'real-skeleton' }, _skinningRoot: { __id__: 2 },
        units: [{ mesh: { __uuid__: 'real-mesh' }, skeleton: { __uuid__: 'real-skeleton' }, material: { __uuid__: 'real-material' } }] },
    { __type__: 'cc.Camera', _usePostProcess: true }, { __type__: 'cc.PostProcess', global: true },
    { __type__: 'cc.SkeletalAnimation', _defaultClip: { __uuid__: 'real-animation' } }];

test('behavior scene preserves original byte inputs, references and component order in a distinct identity', () => {
    for (const type of ['cc.Bloom', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer']) {
        const entries = source(type); const input = bytes(entries); const before = Buffer.from(input);
        const result = ComponentBehaviorFixture.prepare(type, input, meta, identity(type));
        assert(input.equals(before)); assert.equal(result.nativeVerified, false); assert.equal(result.behaviorVerified, false);
        assert.equal(result.task51Complete, false); assert.equal(result.originalSceneUuid, originalUuid);
        const actual = JSON.parse(result.sceneBytes.toString()); assert.deepEqual(actual[3], entries[3]);
        assert.equal(actual[1]._id, identity(type).sceneUuid); assert.equal(actual.at(-1).componentType, type);
        assert.deepEqual(actual[2]._components, [{ __id__: 3 }, { __id__: entries.length }]);
        assert.equal(JSON.parse(result.metaBytes.toString()).uuid, identity(type).sceneUuid);
    }
});

test('behavior preparation rejects source mismatch, duplicate targets, source overwrite and missing dependencies', () => {
    const type = 'cc.Bloom'; const input = source(type);
    for (const value of [{ ...identity(type), sceneUuid: originalUuid }, { ...identity(type), scriptUuid: originalUuid },
        { ...identity(type), relativePath: 'assets/components/cc.Bloom.scene' }, { ...identity(type), sceneUuid: 'bad' }])
        assert.throws(() => ComponentBehaviorFixture.prepare(type, bytes(input), meta, value));
    for (const entries of [[...input, input[3]], input.filter(row => row.__type__ !== 'cc.Camera'),
        input.map(row => row.__type__ === 'cc.PostProcess' ? { ...row, global: false } : row),
        input.map(row => row.__type__ === 'cc.Scene' ? { ...row, _id: 'another' } : row)])
        assert.throws(() => ComponentBehaviorFixture.prepare(type, bytes(entries), meta, identity(type)));
    assert.throws(() => ComponentBehaviorFixture.prepare('cc.TAA', bytes(input), meta, identity('cc.TAA')));
});

test('batch preparation requires real cook inputs and prevents the original renderer from masking batch failure', () => {
    const type = 'cc.SkinnedMeshBatchRenderer'; const input = source(type);
    const missing = input.map(row => row.__type__ === type ? { ...row, units: [] } : row);
    assert.throws(() => ComponentBehaviorFixture.prepare(type, bytes(missing), meta, identity(type)), /units_missing/u);
    const leaking = [...input, { __type__: 'cc.SkinnedMeshRenderer', _enabled: true }];
    assert.throws(() => ComponentBehaviorFixture.prepare(type, bytes(leaking), meta, identity(type)), /source_still_visible/u);
    const cooked = input.map(row => row.__type__ === type ? { ...row, _mesh: null, _skeleton: null } : row);
    assert.equal(ComponentBehaviorFixture.prepare(type, bytes(cooked), meta, identity(type)).behaviorVerified, false);
});
