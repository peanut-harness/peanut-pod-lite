import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceStabilityNativeSnapshot, type IResourceNativeReadPort } from '../scripts/resource-stability-native-snapshot.mts';

const rootUuid = '11111111-1111-4111-8111-111111111111';
const subUuid = `${rootUuid}@f9941`;
function fixture() {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'resource-native-')));
    const namespace = 'assets/fixtures/resource-stability/native-unit';
    const path = `${namespace}/clip.anim`; mkdirSync(join(project, namespace), { recursive: true });
    writeFileSync(join(project, path), '{}');
    writeFileSync(join(project, `${path}.meta`), JSON.stringify({ uuid: rootUuid, subMetas: { clip: { uuid: subUuid } } }));
    const native: IResourceNativeReadPort = {
        assetInfo: async (value) => ({ uuid: value === `db://${path}` ? rootUuid : value, url: `db://${path}`, imported: true }),
        dependencies: async () => [],
        inspector: async () => ({ origin: 'creator-native', actualUuid: rootUuid, valid: true, semantic: { speed: 1 } }),
    };
    return { project, namespace, path, native, reader: new ResourceStabilityNativeSnapshot(project, namespace, native) };
}

test('snapshot joins disk metadata with independent native registration and Inspector', async () => {
    const f = fixture();
    try {
        const value = await f.reader.read(f.path);
        assert.equal(value.metaUuid, rootUuid); assert.equal(value.assetDbUuid, rootUuid);
        assert.deepEqual(value.subassets, [{ metaUuid: subUuid, assetDbUuid: subUuid }]);
        assert.deepEqual(value.semantic, { speed: 1 });
    } finally { rmSync(f.project, { recursive: true, force: true }); }
});

test('missing native subasset or nested unresolved reference is preserved as a failure fact', async () => {
    const f = fixture();
    try {
        f.native.assetInfo = async (value) => value === `db://${f.path}`
            ? { uuid: rootUuid, url: value, imported: true } : null;
        f.native.dependencies = async () => ['missing-reference'];
        const value = await f.reader.read(f.path);
        assert.equal(value.subassets[0]?.assetDbUuid, null);
        assert.deepEqual(value.unresolvedReferences, ['missing-reference']);
    } finally { rmSync(f.project, { recursive: true, force: true }); }
});

test('disk deletion cannot conceal a retained AssetDB registration or meta file', async () => {
    const f = fixture();
    try {
        rmSync(join(f.project, f.path));
        const value = await f.reader.read(f.path);
        assert.equal(value.exists, false); assert.equal(value.assetDbUuid, rootUuid); assert.equal(value.metaUuid, rootUuid);
    } finally { rmSync(f.project, { recursive: true, force: true }); }
});

test('foreign Inspector identity, missing meta, symlink and path escape fail closed', async () => {
    const f = fixture();
    try {
        f.native.inspector = async () => ({ origin: 'creator-native', actualUuid: 'foreign', valid: true, semantic: {} });
        await assert.rejects(f.reader.read(f.path), /inspector_identity/u);
        await assert.rejects(f.reader.read('assets/foreign.anim'), /out_of_scope/u);
        rmSync(join(f.project, `${f.path}.meta`));
        await assert.rejects(f.reader.read(f.path), /meta_missing/u);
        symlinkSync(join(f.project, f.path), join(f.project, `${f.namespace}/link.anim`));
        await assert.rejects(f.reader.read(`${f.namespace}/link.anim`), /symlink/u);
    } finally { rmSync(f.project, { recursive: true, force: true }); }
});
