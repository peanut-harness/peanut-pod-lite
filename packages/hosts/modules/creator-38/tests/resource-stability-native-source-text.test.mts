import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ResourceStabilityNativeSourceText } from '../scripts/resource-stability-native-source-text.mts';
import { ResourceStabilityNativeSnapshot } from '../scripts/resource-stability-native-snapshot.mts';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
const candidate = repository;
const catalog = JSON.parse(readFileSync(join(candidate, 'tests/fixtures/editor-stability/serialized/resource-source-text-fixtures.json'), 'utf8'));
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * @description Use real frozen source bytes and real filesystem; SDK responses remain explicit test ports, not native evidence.
 */
function fixture(kind: string, supplied?: Buffer) {
    const project = realpathSync(mkdtempSync('/private/tmp/resource433-source-')); const namespace = 'assets/fixtures/resource-stability/source-unit';
    const row = catalog.fixtures.find((row: { assetKind: string }) => row.assetKind === kind);
    const source = supplied ?? readFileSync(join(kind === 'text' ? candidate : repository, row.files.source.path));
    const path = namespace + '/' + kind + '/import/fixture.' + (kind === 'text' ? 'txt' : 'json');
    const absolute = join(project, path); mkdirSync(join(project, namespace, kind, 'import'), { recursive: true }); writeFileSync(absolute, source);
    const meta = { ...JSON.parse(readFileSync(join(candidate, row.files.meta.path), 'utf8')), uuid: '11111111-2222-3333-4444-555555555555', imported: true };
    writeFileSync(absolute + '.meta', JSON.stringify(meta));
    const info: Record<string, unknown> = { uuid: meta.uuid, url: 'db://' + path, file: absolute, importer: kind, type: kind === 'text' ? 'cc.TextAsset' : 'cc.JsonAsset', isDirectory: false, imported: true, invalid: false, depends: [] };
    let queriedMeta: unknown = meta; let queriedPath: unknown = absolute; const calls: string[] = [];
    const reader = new ResourceStabilityNativeSourceText(project, namespace, new Map([[path, { kind, sha256: hash(source) }]]), {
        info: async uuid => { calls.push('info:' + uuid); return info; }, meta: async uuid => { calls.push('meta:' + uuid); return queriedMeta; },
        path: async uuid => { calls.push('path:' + uuid); return queriedPath; },
    });
    return { project, namespace, path, absolute, source, meta, info, reader, calls,
        setMeta: (value: unknown) => { queriedMeta = value; }, setPath: (value: unknown) => { queriedPath = value; }, cleanup: () => rmSync(project, { recursive: true, force: true }) };
}

for (const kind of ['text', 'json']) test(kind + ' real full source and SDK-bound metadata have distinct truthful authorities without runtime calls', async () => {
    const f = fixture(kind); try {
        const snapshot = new ResourceStabilityNativeSnapshot(f.project, f.namespace, { assetInfo: async () => f.info,
            sourceText: (path, info, meta) => f.reader.read(path, info, meta), dependencies: async () => { throw Error('runtime-dependencies-must-not-run'); },
            inspector: async () => { throw Error('runtime-loadAny-must-not-run'); } });
        const value = await snapshot.read(f.path); assert.equal(value.readbackOrigin, 'creator-native'); assert.equal(value.metaUuid, f.meta.uuid);
        assert.equal(value.semantic.assetType, kind === 'text' ? 'cc.TextAsset' : 'cc.JsonAsset');
        assert.equal(value.authorities?.['/assetType']?.kind, 'asset-db');
        assert.equal(value.semantic.source, f.source.toString('utf8')); assert.equal(value.semantic.sourceSha256, hash(f.source));
        assert.equal(value.authorities?.['/source']?.kind, 'source-text'); assert.equal(value.authorities?.['/importer']?.kind, 'importer-meta');
        assert.ok(Object.values(value.authorities ?? {}).every(authority => authority.kind !== 'runtime-object'));
        assert.deepEqual(value.unresolvedReferences, []); assert.deepEqual(f.calls.map(call => call.split(':')[0]), ['info', 'meta', 'path']);
    } finally { f.cleanup(); }
});

test('SDK dependencies must be actually observed empty, never inferred from missing data', async () => {
    const f = fixture('text'); try {
        delete f.info.depends; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /dependencies_unobserved/u);
        f.info.depends = ['real-unbound-uuid']; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /dependencies_unbound/u);
    } finally { f.cleanup(); }
});

test('wrong importer, meta version, source path and UUID are independently rejected', async () => {
    const f = fixture('json'); try {
        f.info.importer = 'spine-data'; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u); f.info.importer = 'json';
        f.setMeta({ ...f.meta, ver: '9.0.0' }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u); f.setMeta(f.meta);
        f.setPath('/private/tmp/outside.json'); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u); f.setPath(f.absolute);
        f.setMeta({ ...f.meta, uuid: 'another' }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u);
        f.setMeta(f.meta); writeFileSync(f.absolute + '.meta', JSON.stringify({ ...f.meta, uuid: 'changed-on-disk' }));
        await assert.rejects(f.reader.read(f.path, f.info, f.meta), /meta_changed/u);
    } finally { f.cleanup(); }
});

test('undeclared source path never falls through to runtime, while runtime roots retain the existing dispatch', async () => {
    const f = fixture('text'); try {
        await assert.rejects(f.reader.read(f.path.replace('/import/', '/query/'), f.info, f.meta), /path_not_bound/u);
        await assert.rejects(f.reader.read(f.path, { ...f.info, importer: 'animation-clip' }, { ...f.meta, importer: 'animation-clip' }), /identity_mismatch/u);
        const unrelated = await f.reader.read(f.namespace + '/animationClip/import/clip.anim', { importer: 'animation-clip' }, { importer: 'animation-clip' });
        assert.equal(unrelated, null);
    } finally { f.cleanup(); }
});

test('source mutation, linked source/ancestor and out-of-namespace binding fail without exposing other content', async () => {
    const f = fixture('text'); try {
        writeFileSync(f.absolute, 'changed'); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /content_not_frozen/u);
        rmSync(f.absolute); symlinkSync('/etc/hosts', f.absolute); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /symlink/u);
        rmSync(f.absolute); rmSync(join(f.project, f.namespace, 'text/import'), { recursive: true });
        symlinkSync('/private/tmp', join(f.project, f.namespace, 'text/import')); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /symlink/u);
        assert.throws(() => new ResourceStabilityNativeSourceText(f.project, f.namespace, new Map([['assets/other/file.txt', { kind: 'text', sha256: hash(f.source) }]]), {
            info: async () => f.info, meta: async () => f.meta, path: async () => f.absolute,
        }), /path_denied/u);
    } finally { f.cleanup(); }
});

test('UTF8, JSON structure and source byte budget are enforced; text is never executed', async () => {
    const bad = fixture('text', Buffer.from([0xff])); try { await assert.rejects(bad.reader.read(bad.path, bad.info, bad.meta), /encoded data|encoding/u); } finally { bad.cleanup(); }
    const json = fixture('json', Buffer.from('{"__proto__":{"execute":true}}')); try { await assert.rejects(json.reader.read(json.path, json.info, json.meta), /json_key/u); } finally { json.cleanup(); }
    const large = fixture('text', Buffer.alloc(1024 * 1024 + 1)); try { await assert.rejects(large.reader.read(large.path, large.info, large.meta), /budget/u); } finally { large.cleanup(); }
    const text = fixture('text', Buffer.from('globalThis.resource433MustNeverExecute = true;'));
    try { await text.reader.read(text.path, text.info, text.meta); assert.equal(Reflect.get(globalThis, 'resource433MustNeverExecute'), undefined); } finally { text.cleanup(); }
});

test('SDK source guards fail closed for unknown version and modified inspector sources', () => {
    const sdk = realpathSync(mkdtempSync('/private/tmp/resource433-sdk-'));
    try {
        writeFileSync(join(sdk, 'package.json'), JSON.stringify({ version: '3.8.7' }));
        assert.throws(() => ResourceStabilityNativeSourceText.assertSdk(sdk, sdk), /sdk_version/u);
        writeFileSync(join(sdk, 'package.json'), JSON.stringify({ version: '3.8.3' }));
        mkdirSync(join(sdk, 'cocos/asset/assets'), { recursive: true }); writeFileSync(join(sdk, 'cocos/asset/assets/text-asset.ts'), 'changed');
        assert.throws(() => ResourceStabilityNativeSourceText.assertSdk(sdk, sdk), /pin_changed/u);
    } finally { rmSync(sdk, { recursive: true, force: true }); }
});


test('real public type must be present and exact; importer alone cannot certify AssetDB identity', async () => {
    for (const kind of ['text', 'json']) {
        const f = fixture(kind); try {
            for (const type of [undefined, '', 'cc.Asset', kind === 'text' ? 'cc.JsonAsset' : 'cc.TextAsset']) {
                f.info.type = type; await assert.rejects(f.reader.read(f.path, f.info, f.meta), /identity_mismatch/u);
            }
        } finally { f.cleanup(); }
    }
});

test('actual generated files must be observed and agree across SDK meta, snapshot meta and independent disk', async () => {
    const f = fixture('text'); try {
        for (const files of [undefined, null, '.json', [1], ['']]) {
            f.setMeta({ ...f.meta, files }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /generated_files_unobserved/u);
        }
        f.setMeta({ ...f.meta, files: ['.different'] }); await assert.rejects(f.reader.read(f.path, f.info, f.meta), /meta_changed/u);
        f.setMeta(f.meta);
        await assert.rejects(f.reader.read(f.path, f.info, { ...f.meta, files: [] }), /meta_changed/u);
        writeFileSync(f.absolute + '.meta', JSON.stringify({ ...f.meta, files: ['.changed'] }));
        await assert.rejects(f.reader.read(f.path, f.info, f.meta), /meta_changed/u);
        // No guessed template default: another actual array is acceptable only when all three witnesses agree.
        const observed = { ...f.meta, files: ['.actual-generated'] }; f.setMeta(observed);
        writeFileSync(f.absolute + '.meta', JSON.stringify(observed));
        assert.equal((await f.reader.read(f.path, f.info, observed))?.valid, true);
    } finally { f.cleanup(); }
});
