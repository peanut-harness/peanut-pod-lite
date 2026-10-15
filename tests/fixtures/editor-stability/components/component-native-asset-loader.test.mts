import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentNativeAssetLoader as Loader } from './component-native-asset-loader.ts';

const particle = { type: 'cc.ParticleAsset', uuid: 'actual-particle' };
const registered = { uuid: 'actual-frame', type: 'cc.SpriteFrame', imported: true, invalid: false,
    url: 'db://assets/fixtures/particle/checker.png/spriteFrame' };
const metadata = { uuid: particle.uuid, importer: 'particle', userData: { spriteFrameUuid: registered.uuid } };

test('particle preflight rejects a missing generated SpriteFrame registration before native load', async () => {
    for (const frame of [null, { ...registered, type: 'cc.Texture2D' }, { ...registered, imported: false },
        { ...registered, invalid: true }, { ...registered, uuid: 'other' }, { ...registered, url: 'db://assets/user.png/spriteFrame' }]) {
        await assert.rejects(Loader.dependencies(particle, async message => message === 'query-asset-meta' ? metadata : frame), /sprite_frame_not_registered/);
    }
    for (const meta of [null, { ...metadata, uuid: 'other' }, { ...metadata, userData: {} }]) {
        await assert.rejects(Loader.dependencies(particle, async () => meta), /particle_dependency_missing/);
    }
    assert.deepEqual(await Loader.dependencies(particle, async message => message === 'query-asset-meta' ? metadata : registered), [registered.uuid]);
    assert.deepEqual(await Loader.dependencies({ type: 'cc.Texture2D', uuid: 'texture' }, async () => { throw Error('unexpected query'); }), []);
});

test('particle root validity cannot substitute for loading and binding its actual SpriteFrame', async () => {
    const frame = { _uuid: registered.uuid, type: registered.type, valid: true };
    const asset = { _uuid: particle.uuid, type: particle.type, valid: true, spriteFrame: frame };
    const calls: string[] = [];
    const port = { load: async (uuid: string) => { calls.push(uuid); return uuid === particle.uuid ? asset : frame; },
        valid: (value: any) => value.valid, type: (value: any) => value.type };
    const loaded = await Loader.load(particle.uuid, [frame._uuid], port);
    assert.deepEqual(calls, [particle.uuid, frame._uuid]); assert.equal(loaded.dependencies.length, 1);
    await assert.rejects(Loader.load(particle.uuid, [], port), /dependency_missing/);
    for (const broken of [null, { ...frame, type: 'cc.Texture2D' }, { ...frame, valid: false }, { ...frame, _uuid: 'other' }]) {
        await assert.rejects(Loader.load(particle.uuid, [frame._uuid], {
            ...port, load: async uuid => uuid === particle.uuid ? { ...asset, spriteFrame: broken } : frame,
        }), /asset_invalid|sprite_frame_type_mismatch/);
    }
    await assert.rejects(Loader.load(particle.uuid, [frame._uuid], { ...port, load: async uuid => {
        if (uuid === frame._uuid) throw Error('dependency download failed'); return asset;
    } }), /dependency download failed/);
});

test('matrix gate requires every staged type in the same candidate and process plus particle dependency proof', () => {
    const expected = { candidateSourceCommit: 'candidate', creatorVersion: '3.8.3', pid: 12, types: [particle.type] };
    const row = { type: particle.type, status: 'native-loaded', loaded: { info: particle,
        native: { type: particle.type, actualUuid: particle.uuid, valid: true,
            dependencies: [{ uuid: registered.uuid, actualUuid: registered.uuid, type: registered.type, valid: true }] } } };
    const report = { ...expected, rows: [row] };
    Loader.assertResources(report, expected);
    for (const bad of [{ ...report, pid: 13 }, { ...report, candidateSourceCommit: 'old' }, { ...report, rows: [] },
        { ...report, rows: [row, row] }, { ...report, rows: [{ ...row, status: 'failed' }] }]) {
        assert.throws(() => Loader.assertResources(bad, expected), /resource_preflight/);
    }
    const missing = structuredClone(report); missing.rows[0]!.loaded.native.dependencies = [];
    assert.throws(() => Loader.assertResources(missing, expected), /particle_dependency_unproven/);
});
