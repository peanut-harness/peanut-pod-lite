import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const serializedRoot = path.join(root, 'tests/fixtures/editor-stability/serialized');
const roots = new Set([
    'animationClip', 'animationGraph', 'animationGraphVariant', 'animationMask', 'effect', 'effectChunk',
    'material', 'physicsMaterial', 'renderFlow', 'renderPipeline', 'renderStage', 'renderTexture',
    'prefab', 'scene', 'terrain',
]);

async function readJson(relativePath) {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function relevantTargetIds(inventory) {
    return inventory.targets.filter((target) => {
        if (target.domain === 'asset' && target.id.startsWith('asset:')) {
            return roots.has(target.id.slice('asset:'.length));
        }
        if (target.domain === 'field' && target.id.startsWith('field:asset:')) {
            const subject = target.id.slice('field:asset:'.length);
            return roots.has(subject.split(':', 1)[0]);
        }
        return false;
    }).map((target) => target.id);
}

test('coverage audit accounts for every scoped versioned case exactly once', async () => {
    const audit = await readJson('tests/fixtures/editor-stability/serialized/coverage-audit.json');
    assert.equal(audit.schemaVersion, 1);
    assert.equal(audit.purpose, 'task 4.1 offline row audit; it does not alter coverage drafts or imply runtime acceptance');
    const partition = audit.scope.targetPartition;
    for (const version of ['3.8.3', '3.8.7']) {
        const draft = await readJson(`tests/fixtures/editor-stability/coverage/creator-${version}-draft.json`);
        const entry = audit.versions[version];
        assert.equal(entry.inventorySha256, draft.manifest.inventorySha256);
        assert.equal(entry.coverageDraftCaseCount, draft.manifest.cases.length);
        const assetRoots = new Set(draft.inventory.targets.filter((target) => target.domain === 'asset' && target.id.startsWith('asset:')).map((target) => target.id.slice('asset:'.length)));
        const partitionRows = [...partition['4.1'], ...partition['4.2'], ...partition['5.2']];
        assert.equal(new Set(partitionRows).size, partitionRows.length, 'asset target partition has duplicates');
        assert.deepEqual(new Set(partitionRows), assetRoots);
        const targetIds = new Set(relevantTargetIds(draft.inventory));
        const expected = draft.manifest.cases.filter((row) => targetIds.has(row.targetId));
        const ids = entry.rows.map((row) => row.caseId);
        assert.equal(entry.scopedTargetCount, targetIds.size);
        assert.equal(entry.scopedRowCount, expected.length);
        assert.equal(new Set(ids).size, ids.length, `${version} audit duplicates a case`);
        assert.deepEqual([...ids].sort(), expected.map((row) => row.id).sort());
        assert.ok(entry.sourceFixtureCandidateRows <= entry.gapCount);
        assert.equal(expected.length, 194);
        assert.equal(entry.sourceFixtureCandidateRows, version === '3.8.3' ? 12 : 0);
        assert.equal(entry.completeFixtureDependencyReadbackMappings, version === '3.8.3' ? 30 : 0);
        assert.equal(entry.gapCount, version === '3.8.3' ? 164 : 194);
        assert.equal(entry.runtimeAcceptance, 'not performed; Creator must not be launched for task 4.1');
        for (const row of entry.rows) {
            if (row.status === 'fixture_mapped_static_only') {
                assert.equal(version, '3.8.3');
                assert.ok(['asset:animationClip', 'asset:animationGraph', 'asset:animationMask'].includes(row.targetId));
                assert.ok(row.fixtureId);
                assert.equal(row.dependencyClosureRef, row.fixtureId);
                assert.ok(row.inspectorPatch);
                assert.equal(row.semanticReadback.nativeEvidenceRequired, true);
                continue;
            }
            if (row.status === 'gap_no_version_matched_source') {
                assert.equal(row.fixture, null);
                assert.ok(row.gap.length > 0);
                continue;
            }
            assert.equal(row.status, 'source_fixture_candidate_dependency_resolution_gap');
            assert.equal(version, '3.8.3');
            assert.equal(row.targetId, 'asset:prefab');
            assert.ok(row.dependencies.length > 0);
            assert.ok(row.semanticReadback.length > 0);
            assert.ok(row.dependencyResolutionGap.length > 0);
        }
    }
});

test('3.8.3 prefab fixture is an unchanged copy of its declared native-version source', async () => {
    const catalog = await readJson('tests/fixtures/editor-stability/serialized/fixture-catalog.json');
    assert.equal(catalog.fixtures.length, 4);
    const fixture = catalog.fixtures[0];
    assert.equal(fixture.creatorVersion, '3.8.3');
    assert.equal(fixture.source.bundleCocosVersion, '3.8.3');
    for (const file of [fixture.files.prefab, fixture.files.meta]) {
        const bytes = await readFile(path.join(root, file.path));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    const sourceBytes = await readFile(path.join(root, fixture.source.reference));
    const sourceMetaBytes = await readFile(path.join(root, fixture.source.metaReference));
    assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), fixture.source.sourceSha256);
    assert.equal(createHash('sha256').update(sourceMetaBytes).digest('hex'), fixture.source.sourceMetaSha256);
    assert.equal(fixture.source.sourceSha256, fixture.files.prefab.sha256);
    assert.equal(fixture.source.sourceMetaSha256, fixture.files.meta.sha256);

    const prefab = JSON.parse(sourceBytes.toString('utf8'));
    const meta = JSON.parse(sourceMetaBytes.toString('utf8'));
    assert.equal(meta.importer, 'prefab');
    assert.equal(meta.uuid, fixture.identity.metaUuid);
    assert.equal(prefab[0].__type__, 'cc.Prefab');
    assert.equal(prefab[0].data.__id__, 1);
    assert.equal(prefab[1].__type__, 'cc.Node');
    assert.equal(prefab[1]._name, 'Cube');
    assert.equal(prefab[2].__type__, 'cc.MeshRenderer');
    assert.deepEqual(prefab[2]._materials.map((entry) => entry.__uuid__), fixture.dependencies.filter((entry) => entry.role === 'material').map((entry) => entry.uuid));
    assert.equal(prefab[2]._mesh.__uuid__, fixture.dependencies.find((entry) => entry.role === 'mesh-subasset').uuid);
    const verifyReferences = (value) => {
        if (!value || typeof value !== 'object') return;
        if (Number.isInteger(value.__id__)) assert.ok(value.__id__ < prefab.length, `unresolved __id__ ${value.__id__}`);
        for (const child of Object.values(value)) verifyReferences(child);
    };
    verifyReferences(prefab);
    assert.match(fixture.evidenceLimit, /do not prove Creator runtime import/u);
});

test('Inspector patch field and semantic readback agree with the bundled component schema', async () => {
    const patches = await readJson('tests/fixtures/editor-stability/serialized/inspector-patches.json');
    const descriptor = patches.patches.find((patch) => patch.id === 'mesh-renderer-receive-shadow');
    assert.ok(descriptor);
    const schema = await readJson(descriptor.schemaReference);
    const field = schema.fields.find((entry) => entry.apiName === descriptor.target.apiName);
    assert.ok(field);
    assert.equal(field.serializedName, descriptor.target.serializedName);
    assert.equal(field.kind, 'boolean');
    assert.equal(descriptor.patch.receiveShadow, descriptor.semanticReadback.expected);
    assert.equal(descriptor.verificationStatus, 'static-contract-only; Creator Inspector readback pending');
});
