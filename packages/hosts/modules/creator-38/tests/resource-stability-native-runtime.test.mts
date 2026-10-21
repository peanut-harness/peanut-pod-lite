import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityNativeRuntime as Runtime } from '../scripts/resource-stability-native-runtime.mts';

test('runtime readers observe fixed public getters without sampling, executing or exposing native data', () => {
    const asset = { name: 'fixture', sample: 60, speed: 1, technique: 0, width: 128, height: 64,
        layers: [{ weight: 0.5 }], get nativeAsset(): never { throw new Error('native_binary_read_forbidden'); },
        play(): never { throw new Error('execution_forbidden'); } };
    assert.deepEqual(Runtime.read(asset, 'cc.AnimationClip'), { name: 'fixture', sample: 60, speed: 1 });
    assert.deepEqual(Runtime.read(asset, 'cc.RenderTexture'), { name: 'fixture', width: 128, height: 64 });
    assert.deepEqual(Runtime.read(asset, 'cc.Material'), { name: 'fixture', technique: 0 });
    assert.deepEqual(Runtime.read(asset, 'cc.animation.AnimationGraph'), { name: 'fixture', layers: [{ weight: 0.5 }] });
    assert.throws(() => Runtime.read({ name: 'bad', sample: undefined, speed: 1 }, 'cc.AnimationClip'), /numeric_getter_missing/u);
    assert.throws(() => Runtime.read(asset, 'cc.UnknownAsset'), /type_blocked/u);
    assert.equal(Runtime.supports('cc.UnknownAsset'), false);
});

test('terrain height decoding follows the pinned SDK constants and exact vertex count', () => {
    const heights = new Uint16Array(33 * 33).fill(32768); heights[0] = 32768 + 2 * 128;
    const terrain = { name: 'flat', tileSize: 2, blockCount: [1, 1], heights, layerInfos: [] };
    assert.deepEqual(Runtime.read(terrain, 'cc.TerrainAsset'), { name: 'flat', tileSize: 2, blockCount: [1, 1],
        heightMin: 0, heightMax: 2, layerInfos: [] });
    assert.throws(() => Runtime.read({ ...terrain, heights: [32768] }, 'cc.TerrainAsset'), /height_count_mismatch/u);
    assert.throws(() => Runtime.read({ ...terrain, blockCount: [0, 1] }, 'cc.TerrainAsset'), /blocks_invalid/u);
    assert.throws(() => Runtime.read({ ...terrain, layerInfos: [{}] }, 'cc.TerrainAsset'), /layer_contract_not_bound/u);
});

test('a malformed iterable cannot turn bounded native inspection into an unbounded walk', () => {
    const forever = { *[Symbol.iterator]() { while (true) yield { weight: 1 }; } };
    assert.throws(() => Runtime.read({ name: 'bad', layers: forever }, 'cc.animation.AnimationGraph'), /budget_exceeded/u);
    assert.throws(() => Runtime.read({ name: 'bad', layers: [{ weight: NaN }] }, 'cc.animation.AnimationGraph'), /graph_weight_missing/u);
});

test('each semantic authority names the actual runtime declaration and inherited name getter separately', () => {
    const semantic = Runtime.read({ name: 'graph', layers: [{ weight: 1 }] }, 'cc.animation.AnimationGraph');
    const authorities = Runtime.authorities('cc.animation.AnimationGraph', semantic);
    assert.equal(authorities['/name']?.sourceSha256, Runtime.publicNameSource.sha256);
    assert.equal(authorities['/layers/0/weight']?.kind, 'runtime-object');
    assert.equal(authorities['/layers/0/weight']?.creatorVersion, '3.8.3');
    assert.equal(authorities['/layers/0/weight']?.sourceSha256,
        '73e7d7119d3b9bc70be164670303d9af7f75cdee9bbd3136ec6ed98814a052c1');
    assert.notEqual(authorities['/name']?.readerId, authorities['/layers/0/weight']?.readerId);
    assert.equal(Runtime.authority('RenderStage', '/name').sourceSha256,
        '683fe587993d25a88df86314b779c7adf166aee5233e8cfcd536b66c1b2e8a7b');
    assert.deepEqual(Runtime.read({ name: 'stage', priority: 2, tag: 1 }, 'RenderStage'), { name: 'stage', priority: 2, tag: 1 });
    assert.deepEqual(Runtime.read({ name: 'effect', techniques: ['not-exposed'] }, 'cc.EffectAsset'), { name: 'effect' });
});
