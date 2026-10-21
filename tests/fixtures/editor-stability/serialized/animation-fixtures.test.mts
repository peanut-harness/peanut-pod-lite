import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LumenAnimationClipDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-clip.ts';
import { LumenAnimationGraphDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-graph.ts';
import { LumenAnimationMaskDocument } from '../../../../packages/engine/modules/lumen/source/standalone/animation-mask.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';

const root = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const fixtureRoot = 'tests/fixtures/editor-stability/serialized';
const catalog = JSON.parse(await readFile(path.join(root, fixtureRoot, 'fixture-catalog.json'), 'utf8'));
const patches = JSON.parse(await readFile(path.join(root, fixtureRoot, 'inspector-patches.json'), 'utf8'));
const fixtures = catalog.fixtures.filter((fixture) => fixture.id?.startsWith('creator-3.8.3-animation'));
const documents = {
    animationClip: LumenAnimationClipDocument,
    animationGraph: LumenAnimationGraphDocument,
    animationMask: LumenAnimationMaskDocument,
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const at = (value, pointer) => pointer.slice(1).split('/').reduce((current, key) => current[key], value);

function assertPublicReadback(snapshot, assertions) {
    for (const [pointer, expected] of Object.entries(assertions)) {
        assert.deepEqual(at(snapshot, pointer), expected, pointer);
    }
}

function inspectClosure(data) {
    const references = [];
    const walk = (value, pointer) => {
        if (value === null || typeof value !== 'object') return;
        assert.ok(!Object.hasOwn(value, '__uuid__'), `unresolved external UUID at ${pointer}`);
        if (Object.hasOwn(value, '_native')) assert.equal(value._native, '', `native dependency at ${pointer}`);
        if (Object.hasOwn(value, '__id__')) {
            assert.ok(Array.isArray(data));
            assert.ok(Number.isInteger(value.__id__) && value.__id__ >= 0 && value.__id__ < data.length, pointer);
            references.push({ pointer, index: value.__id__, targetType: data[value.__id__].__type__ });
        }
        for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${key}`);
    };
    walk(data, '');
    return references;
}

test('animation provenance binds source versions, license and native registration declarations', async () => {
    assert.equal(fixtures.length, 3);
    const provenance = await json(`${fixtureRoot}/3.8.3/animation-source-provenance.json`);
    assert.equal(provenance.creatorVersion, '3.8.3');
    assert.equal(provenance.installationIdentity.appVersion, '3.8.3');
    assert.equal(provenance.installationIdentity.engineVersion, '3.8.3');
    for (const field of ['appInfoPlistSha256', 'enginePackageSha256']) {
        assert.match(provenance.installationIdentity[field], /^[a-f0-9]{64}$/u);
    }
    assert.equal(provenance.license.spdx, 'MIT');
    const license = await readFile(path.join(root, provenance.license.reference));
    assert.equal(digest(license), provenance.license.sha256);
    assert.match(license.toString(), /Permission is hereby granted/u);
    for (const fixture of fixtures) {
        const contracts = provenance.nativeContracts[fixture.assetKind];
        assert.ok(contracts.length > 0);
        for (const contract of contracts) {
            assert.match(contract.sha256, /^[a-f0-9]{64}$/u);
            const excerpts = contract.excerpts.map((entry) => entry.text).join('\n');
            for (const marker of contract.requiredMarkers) assert.ok(excerpts.includes(marker), marker);
        }
    }
    const maskDeclarations = provenance.nativeContracts.animationMask;
    assert.ok(maskDeclarations[0].requiredMarkers.includes('@ccclass(`${CLASS_NAME_PREFIX_ANIM}AnimationMask`)'));
    assert.ok(maskDeclarations[1].requiredMarkers.includes("export const CLASS_NAME_PREFIX_ANIM = 'cc.animation.';"));
});

for (const fixture of fixtures) {
    test(`${fixture.assetKind}: exact source hashes, UUID, importer and explicit dependency closure`, async () => {
        assert.equal(fixture.creatorVersion, '3.8.3');
        const source = await readFile(path.join(root, fixture.files.source.path));
        const metaBytes = await readFile(path.join(root, fixture.files.meta.path));
        assert.equal(digest(source), fixture.files.source.sha256);
        assert.equal(digest(source), fixture.source.sourceSha256);
        assert.equal(digest(metaBytes), fixture.files.meta.sha256);
        assert.equal(digest(metaBytes), fixture.source.sourceMetaSha256);
        assert.ok(fixture.source.reference.startsWith('engine/editor/assets/default_file_content/'));
        const data = JSON.parse(source);
        const meta = JSON.parse(metaBytes);
        const header = Array.isArray(data) ? data[0] : data;
        assert.equal(header.__type__, fixture.identity.rootType);
        assert.equal(meta.uuid, fixture.identity.metaUuid);
        assert.match(meta.uuid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
        assert.equal(meta.importer, fixture.identity.metaImporter);
        assert.equal(meta.ver, fixture.identity.metaImporterVersion);
        assert.deepEqual(meta.subMetas, {});
        assert.deepEqual(fixture.dependencyClosure.externalUuids, []);
        assert.deepEqual(fixture.dependencyClosure.nativeFiles, []);
        assert.deepEqual(fixture.dependencyClosure.generatedFiles, meta.files);
        assert.deepEqual(inspectClosure(data), fixture.dependencyClosure.internalReferences);
        if (fixture.assetKind === 'animationGraph') {
            assert.equal(data[0]._layers[0].__id__, 1);
            assert.equal(data[1]._stateMachine.__id__, 2);
            assert.equal(data[1].mask, null);
            for (const [field, index, name] of [['_entryState', 3, 'Entry'], ['_exitState', 4, 'Exit'], ['_anyState', 5, 'Any']]) {
                assert.equal(data[2][field].__id__, index);
                assert.equal(data[index].__type__, 'cc.animation.State');
                assert.equal(data[index].name, name);
            }
            assert.deepEqual(data[2]._transitions, []);
        }
        assert.match(fixture.evidenceLimit, /do not prove Creator runtime import/u);
    });

    test(`${fixture.assetKind}: actual document patch, save/reload and invalid-input preservation (offline only)`, async () => {
        const scratch = await mkdtemp(path.join(tmpdir(), 'pod-lite-animation-fixture-'));
        try {
            const relative = `assets/${path.basename(fixture.files.source.path)}`;
            await mkdir(path.join(scratch, 'assets'));
            const original = await readFile(path.join(root, fixture.files.source.path));
            const originalMeta = await json(fixture.files.meta.path);
            const stagedMeta = { ...originalMeta, uuid: randomUUID(), imported: false, files: [] };
            await writeFile(path.join(scratch, relative), original);
            const stagedMetaBytes = `${JSON.stringify(stagedMeta, null, 2)}\n`;
            await writeFile(path.join(scratch, `${relative}.meta`), stagedMetaBytes);
            const Document = documents[fixture.assetKind];
            const document = Document.open(scratch, relative);
            assertPublicReadback(document.inspect(), fixture.semanticReadback.initialPublic);
            const descriptor = patches.patches.find((entry) => entry.id === fixture.inspectorPatchId);
            assert.ok(descriptor);
            assert.equal(digest(await readFile(path.join(root, descriptor.publicContractReference))), descriptor.publicContractSha256);
            document.applyPatch(descriptor.patch);
            assertPublicReadback(document.inspect(), fixture.semanticReadback.patchedPublic);
            document.save(scratch, false, LumenCocosVersion.parse('3.8.3'));
            const afterBytes = await readFile(path.join(scratch, relative));
            const after = JSON.parse(afterBytes);
            const expected = JSON.parse(original);
            for (const [pointer, value] of Object.entries(fixture.semanticReadback.serializedPatchAssertions)) {
                const parts = pointer.slice(1).split('/');
                const key = parts.pop();
                const owner = parts.reduce((current, part) => current[part], expected);
                owner[key] = value;
            }
            assert.deepEqual(after, expected, 'patch changed only declared serialized fields');
            assert.deepEqual(inspectClosure(after), fixture.dependencyClosure.internalReferences);
            assert.equal(await readFile(path.join(scratch, `${relative}.meta`), 'utf8'), stagedMetaBytes);
            const reopened = Document.open(scratch, relative);
            assertPublicReadback(reopened.inspect(), fixture.semanticReadback.patchedPublic);
            const snapshot = reopened.inspect();
            assert.throws(() => reopened.applyPatch(descriptor.invalidPatch));
            assert.deepEqual(reopened.inspect(), snapshot);
            assert.equal(digest(await readFile(path.join(scratch, relative))), digest(afterBytes));
            assert.equal(await readFile(path.join(scratch, `${relative}.meta`), 'utf8'), stagedMetaBytes);
        } finally {
            await rm(scratch, { recursive: true, force: true });
        }
    });
}

test('closure checks reject out-of-range references, external UUIDs and native-file dependencies', async () => {
    const graph = fixtures.find((fixture) => fixture.assetKind === 'animationGraph');
    const data = await json(graph.files.source.path);
    const broken = structuredClone(data);
    broken[0]._layers[0].__id__ = data.length;
    assert.throws(() => inspectClosure(broken));
    const foreign = structuredClone(data);
    foreign[1].mask = { __uuid__: randomUUID() };
    assert.throws(() => inspectClosure(foreign), /unresolved external UUID/u);
    const native = structuredClone(data);
    native[0]._native = 'missing.bin';
    assert.throws(() => inspectClosure(native), /native dependency/u);
});

test('all thirty animation rows have action-specific rules, a same-version fixture and a patch', async () => {
    const audit = await json(`${fixtureRoot}/coverage-audit.json`);
    const rules = await json(`${fixtureRoot}/animation-readback-rules.json`);
    for (const fixture of fixtures) {
        const rows = audit.versions['3.8.3'].rows.filter((row) => row.targetId === `asset:${fixture.assetKind}`);
        assert.equal(rows.length, 10);
        for (const row of rows) {
            assert.equal(row.status, 'fixture_mapped_static_only');
            assert.equal(row.fixtureId, fixture.id);
            assert.equal(row.fixture, fixture.files.source.path);
            assert.deepEqual(row.dependencies, fixture.dependencyClosure.internalReferences);
            assert.equal(row.inspectorPatch, fixture.inspectorPatchId);
            assert.equal(row.semanticReadback.fixtureContractRef, fixture.id);
            assert.equal(row.semanticReadback.nativeEvidenceRequired, true);
            assert.equal(row.semanticReadback.actionRuleRef, `${fixtureRoot}/animation-readback-rules.json#${row.action}`);
            assert.ok(rules.actions[row.action]?.length > 0);
        }
    }
    assert.equal(audit.versions['3.8.3'].nativeRuntimePassedRows, 0);
    assert.match(rules.nativeExecution, /not performed/u);
});
