import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LumenAnimationClipDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-clip.ts';
import { LumenAnimationGraphDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-graph.ts';
import { LumenAnimationGraphVariantDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-graph-variant.ts';
import { LumenAnimationMaskDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-mask.ts';
import { LumenMaterialDocument } from '../../../../packages/engine/modules/lumen/source/standalone/material.ts';
import { LumenJsonAssetDocument } from '../../../../packages/engine/modules/lumen/source/standalone/json-asset-document.ts';
import { LumenRenderPipelineDocument } from '../../../../packages/engine/modules/lumen/source/standalone/render-pipeline.ts';
import { LumenRenderTextureDocument } from '../../../../packages/engine/modules/lumen/source/standalone/render-texture.ts';
import { LumenTerrainDocument } from '../../../../packages/engine/modules/lumen/source/standalone/terrain.ts';
import { LumenEffectDocument } from '../../../../packages/engine/modules/lumen/source/standalone/effect.ts';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenPrefabInspector } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-inspector.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtureRoot = 'tests/fixtures/editor-stability/serialized';
const json = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const catalog = await json(`${fixtureRoot}/resource-fixtures.json`);
const audit = await json(`${fixtureRoot}/resource-coverage-audit.json`);
const rules = await json(`${fixtureRoot}/resource-readback-rules.json`);
const partition = (await json(`${fixtureRoot}/coverage-audit.json`)).scope.targetPartition['4.1'];
const documents = {
    animationClip: LumenAnimationClipDocument, animationGraph: LumenAnimationGraphDocument,
    animationGraphVariant: LumenAnimationGraphVariantDocument, animationMask: LumenAnimationMaskDocument,
    material: LumenMaterialDocument, physicsMaterial: LumenJsonAssetDocument,
    renderFlow: LumenJsonAssetDocument, renderStage: LumenJsonAssetDocument,
    renderPipeline: LumenRenderPipelineDocument, renderTexture: LumenRenderTextureDocument,
    terrain: LumenTerrainDocument, effect: LumenEffectDocument, effectChunk: LumenEffectDocument,
    prefab: LumenPrefabDocument, scene: LumenPrefabDocument,
};
const at = (value, pointer) => pointer.slice(1).split('/').reduce((current, key) => current[key], value);
const hierarchy = (fixture) => ['prefab', 'scene'].includes(fixture.assetKind);
const inspect = (doc, fixture) => hierarchy(fixture)
    ? LumenPrefabInspector.inspectNode(doc.entries, fixture.nodePath, (p) => doc.findNodeIndex(p))
    : doc.inspect();
const patch = (doc, fixture, input) => hierarchy(fixture)
    ? doc.setNodeProperty(fixture.nodePath, input) : doc.applyPatch(input);

function assertPublic(snapshot, expected) {
    for (const [pointer, value] of Object.entries(expected)) assert.deepEqual(at(snapshot, pointer), value, pointer);
}

function checkReferences(data, dependencyUuids) {
    const references = [];
    const visit = (value, pointer) => {
        if (value === null || typeof value !== 'object') return;
        if (Object.hasOwn(value, '__id__')) {
            assert.ok(Array.isArray(data));
            const id = value.__id__;
            assert.ok(Number.isInteger(id) && id >= 0 && id < data.length, pointer);
            assert.ok(typeof data[id].__type__ === 'string', pointer);
            references.push({ pointer, id, type: data[id].__type__ });
        }
        if (Object.hasOwn(value, '__uuid__')) assert.ok(dependencyUuids.has(value.__uuid__), `unresolved UUID ${value.__uuid__}`);
        if (Object.hasOwn(value, '_native')) assert.equal(value._native, '', `missing native file ${pointer}`);
        for (const [key, child] of Object.entries(value)) visit(child, `${pointer}/${key}`);
    };
    visit(data, '');
    return references;
}

function validateMappings(candidate, fixtures) {
    const byId = new Map(fixtures.map((f) => [f.id, f]));
    assert.equal(byId.size, fixtures.length);
    for (const version of ['3.8.3', '3.8.7']) {
        const rows = candidate.versions[version].rows;
        assert.equal(rows.length, 194);
        assert.equal(new Set(rows.map((r) => r.caseId)).size, rows.length);
        for (const row of rows) {
            const fixture = byId.get(row.fixtureId);
            assert.ok(fixture, `missing fixture ${row.fixtureId}`);
            assert.equal(fixture.creatorVersion, version);
            assert.equal(row.status, 'fixture_mapped_static_only');
            assert.equal(row.fixture, fixture.files.source.path);
            assert.equal(row.dependencyClosureRef, `${fixture.id}#dependencies`);
            assert.ok(row.inspectorPatch.startsWith(`${fixture.id}#`));
            assert.equal(row.semanticReadback.fixtureContractRef, fixture.id);
            assert.equal(row.semanticReadback.nativeEvidenceRequired, true);
            assert.equal(row.semanticReadback.actionRuleRef, `${fixtureRoot}/resource-readback-rules.json#${row.action}`);
            assert.ok(rules.actions[row.action]?.length > 0);
            if (row.targetId.startsWith('field:')) {
                const field = row.targetId.split(':')[3];
                assert.ok(fixture.fieldCases[field]);
                assert.equal(row.inspectorPatch, `${fixture.id}#fieldCases/${field}`);
            }
        }
    }
}

function includes(source) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
    return [...clean.matchAll(/^\s*#include\s*[<"]([^>"\n]+)[>"]/gmu)].map((m) => m[1]);
}

// 按两版 TerrainAsset._loadNativeData 的 VERSION8 布局独立读取，不调用产品 terrain decoder。
function assertFlatTerrain(bytes, tileSize, height) {
    let offset = 0;
    const int = () => { const v = bytes.readInt32LE(offset); offset += 4; return v; };
    const short = () => { const v = bytes.readUInt16LE(offset); offset += 2; return v; };
    const double = () => { const v = bytes.readDoubleLE(offset); offset += 8; return v; };
    const float = () => { const v = bytes.readFloatLE(offset); offset += 4; return v; };
    assert.equal(int(), 0x01010008, 'must be complete VERSION8 geometry, not the DEFAULT placeholder');
    assert.equal(double(), tileSize);
    assert.deepEqual([int(), int()], [1, 1]);
    const weightMapSize = short();
    const lightMapSize = short();
    assert.ok(weightMapSize > 0 && lightMapSize > 0);
    assert.equal(int(), 33 * 33);
    for (let i = 0; i < 33 * 33; i += 1) assert.equal((short() - 32768) / 128, height);
    assert.equal(int(), 33 * 33 * 3);
    for (let i = 0; i < 33 * 33; i += 1) {
        // IEEE -0 与 +0 表示相同法线分量；保持其余值的精确检查。
        assert.equal(Math.abs(float()), 0); assert.equal(float(), 1); assert.equal(Math.abs(float()), 0);
    }
    assert.equal(int(), weightMapSize * weightMapSize * 4);
    for (let i = 0; i < weightMapSize * weightMapSize; i += 1) {
        assert.deepEqual([...bytes.subarray(offset, offset + 4)], [255, 0, 0, 0]); offset += 4;
    }
    assert.equal(int(), 4);
    for (let i = 0; i < 4; i += 1) assert.equal(short(), 65535);
    assert.equal(int(), 0, 'no texture layer references');
    assert.equal(offset, bytes.length, 'trailing bytes or incomplete geometry');
}

test('supplemental audit covers exactly all 388 scoped manifest rows without runtime claims', async () => {
    assert.equal(catalog.fixtures.length, 30);
    validateMappings(audit, catalog.fixtures);
    for (const version of ['3.8.3', '3.8.7']) {
        const draft = await json(`tests/fixtures/editor-stability/coverage/creator-${version}-draft.json`);
        const expected = draft.manifest.cases.filter((r) => {
            const parts = r.targetId.split(':');
            return parts[0] === 'asset' ? partition.includes(parts[1]) : parts[0] === 'field' && parts[1] === 'asset' && partition.includes(parts[2]);
        });
        const entry = audit.versions[version];
        assert.equal(entry.inventorySha256, draft.manifest.inventorySha256);
        assert.deepEqual(entry.rows.map((r) => r.caseId).sort(), expected.map((r) => r.id).sort());
        assert.equal(entry.completeFixtureDependencyReadbackMappings, 194);
        assert.equal(entry.gapCount, 0);
        assert.equal(entry.nativeRuntimePassedRows, 0);
        assert.equal(entry.runtimeAcceptance, 'not performed; Creator must not be launched for task 4.1');
        assert.deepEqual(new Set(catalog.fixtures.filter((f) => f.creatorVersion === version).map((f) => f.assetKind)), new Set(partition));
    }
});

test('missing, duplicate and cross-version static mappings are rejected', () => {
    const missing = structuredClone(audit); missing.versions['3.8.7'].rows.pop();
    assert.throws(() => validateMappings(missing, catalog.fixtures));
    const duplicate = structuredClone(audit); duplicate.versions['3.8.3'].rows[1] = duplicate.versions['3.8.3'].rows[0];
    assert.throws(() => validateMappings(duplicate, catalog.fixtures));
    assert.throws(() => validateMappings(audit, catalog.fixtures.slice(1)));
    const wrongVersion = structuredClone(catalog.fixtures); wrongVersion[0].creatorVersion = '3.8.7';
    assert.throws(() => validateMappings(audit, wrongVersion));
});

for (const fixture of catalog.fixtures) {
    test(`${fixture.id}: frozen input, license, native declarations and dependency closure`, async () => {
        const provenance = await json(fixture.provenanceReference);
        assert.equal(provenance.creatorVersion, fixture.creatorVersion);
        assert.equal(provenance.installationIdentity.appVersion, fixture.creatorVersion);
        assert.equal(provenance.installationIdentity.engineVersion, fixture.creatorVersion);
        for (const key of ['appInfoPlistSha256', 'enginePackageSha256']) assert.match(provenance.installationIdentity[key], /^[a-f0-9]{64}$/u);
        assert.equal(provenance.license.spdx, 'MIT');
        assert.equal(digest(await readFile(path.join(root, provenance.license.path))), provenance.license.sha256);
        for (const declaration of provenance.nativeContracts[fixture.assetKind]) {
            assert.match(declaration.sha256, /^[a-f0-9]{64}$/u);
            assert.ok(declaration.reference.startsWith('engine/'));
            if (fixture.assetKind !== 'effectChunk') assert.ok(declaration.excerpts.length > 0);
        }
        const draft = await json(`tests/fixtures/editor-stability/coverage/creator-${fixture.creatorVersion}-draft.json`);
        const nativeImporter = provenance.nativeImporterEvidence[fixture.assetKind];
        assert.deepEqual(nativeImporter.layoutSource, draft.inventory.sources.find((s) => s.kind === 'module_layout'));
        if (nativeImporter.reference === null) {
            assert.equal(fixture.creatorVersion, '3.8.7');
            assert.equal(fixture.assetKind, 'animationGraphVariant');
            assert.equal(nativeImporter.status, 'module_layout_absent_runtime_unverified');
        } else {
            assert.ok(draft.inventory.nativeImporterModules.includes(nativeImporter.reference));
            assert.equal(nativeImporter.status, 'module_layout_present_runtime_unverified');
        }
        assert.equal(digest(await readFile(path.join(root, fixture.publicContractReference))), fixture.publicContractSha256);
        for (const file of [...Object.values(fixture.files), ...fixture.dependencies.filter((d) => d.path)]) {
            assert.ok(file.path.startsWith(`${fixtureRoot}/${fixture.creatorVersion}/native-minimal/`));
            assert.equal(digest(await readFile(path.join(root, file.path))), file.sha256, file.path);
        }
        const meta = await json(fixture.files.meta.path);
        assert.equal(meta.importer, fixture.serializedReadback.metaImporter);
        assert.match(meta.uuid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
        const uuids = new Set(fixture.dependencies.filter((d) => d.uuid).map((d) => d.uuid));
        for (const dep of fixture.dependencies.filter((d) => d.fixtureId)) {
            const target = catalog.fixtures.find((f) => f.id === dep.fixtureId);
            assert.equal(target.creatorVersion, fixture.creatorVersion);
            assert.equal((await json(target.files.meta.path)).uuid, dep.uuid);
        }
        const bytes = await readFile(path.join(root, fixture.files.source.path));
        if (fixture.assetKind === 'terrain') assertFlatTerrain(bytes, 1, 0);
        else if (!['effect', 'effectChunk'].includes(fixture.assetKind)) checkReferences(JSON.parse(bytes), uuids);
        if (fixture.assetKind === 'renderTexture') {
            const sub = meta.subMetas.f9941;
            assert.equal(sub.uuid, `${meta.uuid}@f9941`);
            assert.equal(sub.userData.imageUuidOrDatabaseUri, meta.uuid);
            assert.equal(meta.userData.redirect, sub.uuid);
        }
        if (fixture.assetKind === 'scene') assert.equal(JSON.parse(bytes)[1]._id, meta.uuid);
        if (['material', 'effect', 'effectChunk'].includes(fixture.assetKind)) {
            const shader = fixture.assetKind === 'material'
                ? await readFile(path.join(root, fixture.dependencies.find((d) => d.kind === 'builtin-effect').path), 'utf8') : bytes.toString();
            const local = new Set([...shader.matchAll(/CCProgram\s+([\w-]+)/gu)].map((m) => m[1]));
            const deps = fixture.dependencies.filter((d) => d.kind === 'builtin-shader-chunk');
            const names = new Set(deps.map((d) => d.include));
            for (const source of [shader, ...await Promise.all(deps.map((d) => readFile(path.join(root, d.path), 'utf8')))]) {
                for (const name of includes(source)) assert.ok(local.has(name) || names.has(name), `missing include ${name}`);
            }
            for (const ref of shader.matchAll(/(?:vert|frag):\s*([\w/-]+):/gu)) assert.ok(local.has(ref[1]) || names.has(ref[1]), ref[1]);
            if (fixture.assetKind === 'material') {
                const effectMeta = await json(fixture.dependencies.find((d) => d.kind === 'builtin-effect-meta').path);
                assert.ok(uuids.has(effectMeta.uuid));
            }
        }
    });

    test(`${fixture.id}: real document patch, save/reopen, identity and invalid-input preservation`, async () => {
        const scratch = await mkdtemp(path.join(tmpdir(), 'pod-lite-resource-offline-'));
        try {
            await mkdir(path.join(scratch, 'assets'));
            const relative = `assets/${path.basename(fixture.files.source.path)}`;
            const original = await readFile(path.join(root, fixture.files.source.path));
            const meta = await json(fixture.files.meta.path);
            const sourceUuid = meta.uuid;
            const stagedUuid = randomUUID();
            const remap = (value) => {
                if (typeof value === 'string') return value.replaceAll(sourceUuid, stagedUuid);
                if (Array.isArray(value)) return value.map(remap);
                if (value === null || typeof value !== 'object') return value;
                return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
                    k === 'imported' ? false : k === 'files' ? [] : remap(v)]));
            };
            const stagedMeta = remap(meta);
            stagedMeta.imported = false;
            const metaBytes = `${JSON.stringify(stagedMeta, null, 2)}\n`;
            const stagedSource = fixture.assetKind === 'scene'
                ? Buffer.from(`${JSON.stringify(remap(JSON.parse(original)), null, 2)}\n`) : original;
            await writeFile(path.join(scratch, relative), stagedSource);
            await writeFile(path.join(scratch, `${relative}.meta`), metaBytes);
            const Document = documents[fixture.assetKind];
            const doc = Document.open(scratch, relative);
            assertPublic(inspect(doc, fixture), fixture.initialPublic);
            patch(doc, fixture, fixture.patch.valid);
            assertPublic(inspect(doc, fixture), fixture.patch.expectedPublic);
            doc.save(scratch, false, LumenCocosVersion.parse(fixture.creatorVersion));
            const after = await readFile(path.join(scratch, relative));
            const afterMeta = await readFile(path.join(scratch, `${relative}.meta`));
            const savedMeta = JSON.parse(afterMeta);
            assert.equal(savedMeta.uuid, stagedUuid);
            if (fixture.assetKind === 'renderTexture') {
                assert.equal(savedMeta.subMetas.f9941.uuid, `${stagedUuid}@f9941`);
                assert.equal(savedMeta.subMetas.f9941.userData.imageUuidOrDatabaseUri, stagedUuid);
                assert.equal(savedMeta.subMetas.f9941.userData.width, 128);
                assert.equal(savedMeta.subMetas.f9941.userData.height, 64);
            } else assert.equal(afterMeta.toString(), metaBytes);
            if (fixture.assetKind === 'terrain') assertFlatTerrain(after, 2, 2);
            else if (['effect', 'effectChunk'].includes(fixture.assetKind)) assert.equal(after.toString(), fixture.patch.valid.source);
            else {
                const uuids = new Set(fixture.dependencies.filter((d) => d.uuid).map((d) => d.uuid));
                const beforeRefs = checkReferences(JSON.parse(stagedSource), uuids);
                assert.deepEqual(checkReferences(JSON.parse(after), uuids), beforeRefs);
                const expected = JSON.parse(stagedSource);
                for (const [pointer, value] of Object.entries(fixture.serializedPatchAssertions)) {
                    const keys = pointer.slice(1).split('/');
                    const key = keys.pop();
                    keys.reduce((current, part) => current[part], expected)[key] = value;
                }
                assert.deepEqual(JSON.parse(after), expected, 'patch changed only declared serialized fields');
                if (fixture.assetKind === 'scene') assert.equal(JSON.parse(after)[1]._id, stagedUuid);
            }
            const reopened = Document.open(scratch, relative);
            assertPublic(inspect(reopened, fixture), fixture.patch.expectedPublic);
            const beforeReject = inspect(reopened, fixture);
            assert.throws(() => patch(reopened, fixture, fixture.patch.invalid));
            assert.deepEqual(inspect(reopened, fixture), beforeReject);
            assert.equal(digest(await readFile(path.join(scratch, relative))), digest(after));
            assert.deepEqual(await readFile(path.join(scratch, `${relative}.meta`)), afterMeta);
            for (const [field, descriptor] of Object.entries(fixture.fieldCases)) {
                const fresh = Document.open(scratch, relative);
                if (descriptor.writable) {
                    patch(fresh, fixture, descriptor.patch);
                    assert.deepEqual(inspect(fresh, fixture)[field], descriptor.expected, field);
                    fresh.save(scratch, false, LumenCocosVersion.parse(fixture.creatorVersion));
                    assert.deepEqual(inspect(Document.open(scratch, relative), fixture)[field], descriptor.expected);
                }
                const snapshot = inspect(fresh, fixture);
                const priorSource = await readFile(path.join(scratch, relative));
                const priorMeta = await readFile(path.join(scratch, `${relative}.meta`));
                assert.throws(() => patch(fresh, fixture, descriptor.invalidPatch), field);
                assert.deepEqual(inspect(fresh, fixture), snapshot);
                assert.deepEqual(await readFile(path.join(scratch, relative)), priorSource);
                assert.deepEqual(await readFile(path.join(scratch, `${relative}.meta`)), priorMeta);
            }
        } finally { await rm(scratch, { recursive: true, force: true }); }
    });
}

test('closure and binary checks reject dangling references, native files, truncation and placeholders', async () => {
    assert.throws(() => checkReferences([{ __type__: 'cc.Prefab', data: { __id__: 2 } }], new Set()));
    assert.throws(() => checkReferences({ __uuid__: randomUUID() }, new Set()), /unresolved UUID/u);
    assert.throws(() => checkReferences({ _native: 'missing.bin' }, new Set()), /missing native/u);
    const terrain = catalog.fixtures.find((f) => f.assetKind === 'terrain');
    const bytes = await readFile(path.join(root, terrain.files.source.path));
    assert.throws(() => assertFlatTerrain(bytes.subarray(0, bytes.length - 1), 1, 0));
    const placeholder = Buffer.alloc(4); placeholder.writeInt32LE(0x01010111);
    assert.throws(() => assertFlatTerrain(placeholder, 1, 0), /placeholder/u);
});
