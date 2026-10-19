import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ResourceStabilityNativeAudioMeta } from '../scripts/resource-stability-native-audio-meta.mts';
import { ResourceStabilityNativeSnapshot } from '../scripts/resource-stability-native-snapshot.mts';
import { ResourceStabilityNativeSourceText } from '../scripts/resource-stability-native-source-text.mts';
import { LumenSidecarMetaDocument } from '../../../../engine/modules/lumen/source/standalone/sidecar-document.ts';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const fixtureCatalog = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/media/resource-audio-fixtures.json'), 'utf8')).fixtures[0];
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * @description Genuine frozen WAV/meta on disk with explicit SDK test ports; not a native acceptance claim.
 */
function fixture() {
    const project = realpathSync(mkdtempSync('/private/tmp/resource434-audio-')); const namespace = 'assets/fixtures/resource-stability/audio-test';
    const path = namespace + '/audio/import/tone.wav'; const absolute = join(project, path); mkdirSync(join(project, namespace, 'audio/import'), { recursive: true });
    const bytes = readFileSync(join(root, fixtureCatalog.files.source.path)); writeFileSync(absolute, bytes);
    const meta = { ...JSON.parse(readFileSync(join(root, fixtureCatalog.files.meta.path), 'utf8')), uuid: '11111111-2222-3333-4444-555555555555', imported: true };
    writeFileSync(absolute + '.meta', JSON.stringify(meta));
    const info: Record<string, unknown> = { uuid: meta.uuid, type: 'cc.AudioClip', importer: 'audio-clip', file: absolute, url: 'db://' + path, imported: true, invalid: false, isDirectory: false, depends: [] };
    let actualMeta: unknown = meta; let actualPath: unknown = absolute; const calls: string[] = [];
    const reader = new ResourceStabilityNativeAudioMeta(project, namespace, new Map([[path, hash(bytes)]]), {
        info: async () => { calls.push('info'); return info; }, meta: async () => { calls.push('meta'); return actualMeta; }, path: async () => { calls.push('path'); return actualPath; },
    });
    return { project, namespace, path, absolute, bytes, meta, info, reader, calls,
        setMeta: (value: unknown) => { actualMeta = value; }, setPath: (value: unknown) => { actualPath = value; }, cleanup: () => rmSync(project, { recursive: true, force: true }) };
}

test('genuine WAV uses only actual AssetDB/importer metadata; no source-text, runtime load, name or playback', async () => {
    const f = fixture(); try {
        const source = new ResourceStabilityNativeSourceText(f.project, f.namespace, new Map(), { info: async () => { throw Error('not-source'); }, meta: async () => { throw Error('not-source'); }, path: async () => { throw Error('not-source'); } });
        const snapshot = new ResourceStabilityNativeSnapshot(f.project, f.namespace, { assetInfo: async () => f.info,
            sourceText: (path, info, meta) => source.read(path, info, meta), audioMeta: (path, info, meta) => f.reader.read(path, info, meta),
            inspector: async () => { throw Error('runtime-load-play-forbidden'); }, dependencies: async () => { throw Error('runtime-load-play-forbidden'); } });
        const result = await snapshot.read(f.path);
        assert.deepEqual(result.semantic, { assetType: 'cc.AudioClip', importer: 'audio-clip', downloadMode: 0 });
        assert.equal(result.authorities?.['/assetType']?.kind, 'asset-db'); assert.equal(result.authorities?.['/downloadMode']?.kind, 'importer-meta');
        assert.ok(Object.values(result.authorities ?? {}).every(authority => ['asset-db', 'importer-meta'].includes(authority.kind)));
        assert.deepEqual(result.unresolvedReferences, []); assert.deepEqual(f.calls, ['info', 'meta', 'path']);
        assert.equal(hash(readFileSync(f.absolute)), fixtureCatalog.files.source.sha256);
        const originalRead = fs.readFileSync;
        try {
            Reflect.set(fs, 'readFileSync', (...args: unknown[]) => {
                if (args[0] === f.absolute) throw Error('binary-source-text-read-forbidden');
                return Reflect.apply(originalRead, fs, args);
            });
            syncBuiltinESMExports();
            const actual = LumenSidecarMetaDocument.open(f.project, f.path).inspect();
            assert.equal(actual.kind, 'audio'); if (actual.kind !== 'audio') throw Error('wrong-kind');
            assert.equal(actual.downloadMode, result.semantic.downloadMode);
        } finally { Reflect.set(fs, 'readFileSync', originalRead); syncBuiltinESMExports(); }
    } finally { f.cleanup(); }
});

test('missing/defaulted downloadMode or extra/unreviewed native configuration never certifies zero', async () => {
    const f = fixture(); try {
        for (const userData of [{}, { downloadMode: undefined }, { downloadMode: null }, { downloadMode: '0' }, { downloadMode: 1 }, { downloadMode: 0, extra: false }]) {
            f.setMeta({ ...f.meta, userData }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /configuration_unbound/u);
        }
        f.setMeta({ ...f.meta, subMetas: { child: { uuid: 'unexpected' } } }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /configuration_unbound/u);
    } finally { f.cleanup(); }
});

test('public type/importer/UUID/path/version/flags must all match real registration', async () => {
    const f = fixture(); try {
        for (const [key, wrong] of Object.entries({ type: undefined, importer: 'text', uuid: 'wrong', file: '/private/tmp/else', url: 'db://assets/else', invalid: undefined, isDirectory: true, imported: false })) {
            const previous = f.info[key]; f.info[key] = wrong; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u); f.info[key] = previous;
        }
        f.setMeta({ ...f.meta, ver: '9' }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u); f.setMeta(f.meta);
        f.setPath('/private/tmp/else'); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u);
    } finally { f.cleanup(); }
});

test('dependencies must actually be present and empty; unbound audio cannot fall through to runtime', async () => {
    const f = fixture(); try {
        f.info.depends = undefined; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /dependencies_unobserved/u);
        f.info.depends = ['unknown']; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /dependencies_unbound/u);
        await assert.rejects(f.reader.read(f.path.replace('/import/', '/other/'), f.info, f.meta), /path_not_bound/u);
        assert.equal(await f.reader.read(f.namespace + '/runtime/clip.anim', { importer: 'animation-clip' }, { importer: 'animation-clip' }), null);
    } finally { f.cleanup(); }
});

test('query/disk/independent generated-file arrays and exact binary bytes cannot disagree', async () => {
    const f = fixture(); try {
        for (const files of [undefined, '.wav', [1]]) { f.setMeta({ ...f.meta, files }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /files_unobserved/u); }
        f.setMeta({ ...f.meta, files: ['.other'] }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /meta_changed/u); f.setMeta(f.meta);
        await assert.rejects(f.reader.read(f.path, f.info, { ...f.meta, files: [] }), /meta_changed/u);
        writeFileSync(f.absolute + '.meta', JSON.stringify({ ...f.meta, files: ['.changed'] })); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /meta_changed/u);
        writeFileSync(f.absolute + '.meta', JSON.stringify(f.meta)); writeFileSync(f.absolute, Buffer.concat([f.bytes, Buffer.from([0xff])]));
        await assert.rejects(f.reader.read(f.path, f.info, f.meta), /content_not_frozen/u);
    } finally { f.cleanup(); }
});

test('audio authority is closed and unknown SDK version/source is rejected without executing it', () => {
    assert.throws(() => ResourceStabilityNativeAudioMeta.authority('/source'), /authority_unbound/u);
    const sdk = realpathSync(mkdtempSync('/private/tmp/resource434-sdk-')); try {
        writeFileSync(join(sdk, 'package.json'), '{"version":"3.8.7"}'); assert.throws(() => ResourceStabilityNativeAudioMeta.assertSdk(sdk, sdk), /sdk_version/u);
        writeFileSync(join(sdk, 'package.json'), '{"version":"3.8.3"}'); mkdirSync(join(sdk, 'cocos/audio'), { recursive: true }); writeFileSync(join(sdk, 'cocos/audio/audio-clip.ts'), 'changed');
        assert.throws(() => ResourceStabilityNativeAudioMeta.assertSdk(sdk, sdk), /pin_changed/u);
    } finally { rmSync(sdk, { recursive: true, force: true }); }
});


test('actual Lumen default zero never masks absent native metadata; readonly inspect leaves source and meta untouched', async () => {
    const f = fixture(); try {
        const missing = { ...f.meta, userData: {} }; writeFileSync(f.absolute + '.meta', JSON.stringify(missing)); f.setMeta(missing);
        const sourceBefore = hash(readFileSync(f.absolute)); const metaBefore = hash(readFileSync(f.absolute + '.meta'));
        const actual = LumenSidecarMetaDocument.open(f.project, f.path).inspect();
        assert.equal(actual.kind, 'audio'); if (actual.kind !== 'audio') throw Error('wrong-kind');
        assert.equal(actual.downloadMode, 0);
        await assert.rejects(f.reader.read(f.path, f.info, missing), /configuration_unbound/u);
        assert.equal(hash(readFileSync(f.absolute)), sourceBefore); assert.equal(hash(readFileSync(f.absolute + '.meta')), metaBefore);
    } finally { f.cleanup(); }
});

test('real WAV reaches the existing public import executor as an ordinary .wav and preserves binary input before native boundary', async () => {
    const f = fixture(); try {
        const { AssetImportBatchExecutor } = await import('../../../../engine/modules/lumen/source/asset-import/asset-import-batch-executor.ts');
        let calls = 0; const executor = new AssetImportBatchExecutor({ request: async (channel, method, ...args) => {
            calls += 1; assert.equal(channel, 'asset-db'); assert.equal(method, 'import-asset'); assert.equal(args[1], 'db://' + f.namespace + '/target/tone.wav');
            assert.equal(hash(readFileSync(f.absolute)), fixtureCatalog.files.source.sha256); throw Error('offline_audio_native_boundary_not_executed');
        } });
        await assert.rejects(executor.importBatch({ sources: [f.absolute], target: 'db://' + f.namespace + '/target', expandClosure: false, allowMissingDependencies: false }), /offline_audio_native_boundary_not_executed/u);
        assert.equal(calls, 1); assert.equal(hash(readFileSync(f.absolute)), fixtureCatalog.files.source.sha256);
    } finally { f.cleanup(); }
});


test('reader remains usable with Electron13 Node14 missing Object.hasOwn', async () => {
    const f = fixture(); const original = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
    try {
        Reflect.set(Object, 'hasOwn', undefined);
        assert.equal((await f.reader.read(f.path, f.info, f.meta))?.semantic.downloadMode, 0);
    } finally { if (original) Object.defineProperty(Object, 'hasOwn', original); else Reflect.deleteProperty(Object, 'hasOwn'); f.cleanup(); }
});
