import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ResourceStabilityNativeShard, type IResourceNativeShardFixture } from '../scripts/resource-stability-native-shard.mts';
import { ResourceStabilityNativeFixture } from '../scripts/resource-stability-native-fixture.mts';
import { ResourceStabilityNativeAudioMeta } from '../scripts/resource-stability-native-audio-meta.mts';
import { ResourceStabilityNativeRuntime } from '../scripts/resource-stability-native-runtime.mts';
import { CoverageManifestGenerator } from '../../../../../tools/editor-stability/coverage-manifest-generator.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const schema = read('packages/engine/modules/lumen/bundled/schema/assets.json');
const catalogs = [read('tests/fixtures/editor-stability/serialized/resource-fixtures.json'),
    read('tests/fixtures/editor-stability/serialized/resource-source-text-fixtures.json'), read('tests/fixtures/editor-stability/media/resource-audio-fixtures.json')];

/**
 * @description Canonical portable plan regression uses actual schema and frozen fixture bytes, not historical native observations.
 */
test('independent audio/source flags preserve95/111/105/121 exact planned cases with genuine immutable input derivation', () => {
    const kinds = [...ResourceStabilityNativeRuntime.kinds, 'text', 'json', 'audio'];
    const targets = schema.entries.filter((entry: { assetKind: string }) => kinds.includes(entry.assetKind)).flatMap((entry: any) => [{
        id: 'asset:' + entry.assetKind, domain: 'asset', subject: entry.assetKind,
        actions: [...entry.scaffold ? ['create'] : [], 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'],
        fieldKind: null, availability: 'unverified', availabilitySourceId: null,
    }, ...!['physicsMaterial', 'audio'].includes(entry.assetKind) ? [] : entry.fields.map((field: any) => ({
        id: `field:asset:${entry.assetKind}:${field.apiName}`, domain: 'field', subject: `asset:${entry.assetKind}.${field.apiName}`,
        actions: field.writable === false ? ['read', 'reject_write'] : ['read', 'set', 'reject_invalid'], fieldKind: field.kind,
        availability: 'unverified', availabilitySourceId: null,
    }))]);
    const inventory = { creatorVersion: '3.8.3', targets, sources: [{ id: 'product/assets.json', kind: 'product_catalog', creatorVersion: null, sha256: sha(Buffer.from(JSON.stringify(schema))) }],
        nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [], nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [] } as ICoverageInventory;
    const manifest = CoverageManifestGenerator.createDraft(inventory); assert.equal(manifest.cases.length, 124);
    const project = realpathSync(mkdtempSync('/private/tmp/resource434-plan-')); const namespace = 'assets/fixtures/resource-stability/audio-plan';
    const identity: IResourceSessionIdentity = { creatorVersion: '3.8.3', owner: 'offline', change: 'offline', projectPath: project, projectName: 'offline', runId: 'audio-plan', creatorPid: 1,
        creatorStartedAt: '2026-10-19T00:00:00Z', hostSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40) };
    let oldIds: string[] = []; let textIds: string[] = [];
    try {
        for (const [sourceText, audioMeta, count] of [[false, false, 95], [true, false, 111], [false, true, 105], [true, true, 121]] as const) {
            const fixtures: IResourceNativeShardFixture[] = []; const hashes: Record<string, string> = {};
            for (const fixture of catalogs.flatMap(catalog => catalog.fixtures).filter((row: any) => row.creatorVersion === '3.8.3'
                && (ResourceStabilityNativeRuntime.kinds.includes(row.assetKind) || sourceText && ['text', 'json'].includes(row.assetKind) || audioMeta && row.assetKind === 'audio'))) {
                const rows = manifest.cases.filter(row => row.targetId === `asset:${fixture.assetKind}` && (!['text', 'json', 'audio'].includes(fixture.assetKind) || row.action !== 'patch')
                    || row.targetId.startsWith('field:asset:physicsMaterial:') && fixture.assetKind === 'physicsMaterial'
                    || row.targetId === 'field:asset:audio:downloadMode' && fixture.assetKind === 'audio' && ['read', 'reject_write'].includes(row.action));
                for (const row of rows) {
                    const field = row.targetId.startsWith('field:') ? row.targetId.split(':').at(-1)! : undefined;
                    const name = `${fixture.assetKind}-${field ? field + '-' : ''}${row.action}`; const filename = name + extname(fixture.files.source.path);
                    const original = readFileSync(join(root, fixture.files.source.path)); const prepared = ResourceStabilityNativeFixture.prepare(fixture.assetKind, original, name, fixture.initialPublic);
                    const folder = join(project, 'inputs', fixture.assetKind, field ?? 'asset', row.action); mkdirSync(folder, { recursive: true });
                    const source = join(folder, filename); const sourceMeta = source + '.meta';
                    const meta = { ...read(fixture.files.meta.path), uuid: randomUUID(), imported: false, files: [] };
                    writeFileSync(source, prepared.source); writeFileSync(sourceMeta, JSON.stringify(meta)); hashes[source] = sha(readFileSync(source)); hashes[sourceMeta] = sha(readFileSync(sourceMeta));
                    if (fixture.assetKind === 'audio') { assert.equal(hashes[source], fixture.files.source.sha256); assert.deepEqual(original, prepared.source); }
                    const fieldCase = field ? fixture.fieldCases[field] : undefined;
                    fixtures.push({ kind: fixture.assetKind, caseId: row.id, source, sourceMeta, filename, initial: prepared.initial, patch: fixture.patch.valid, expectedPatch: fixture.patch.expectedPublic,
                        field: field ? { name: field, initial: field === 'name' ? name : fieldCase.initial, expected: fieldCase.expected,
                            patch: fieldCase.patch, invalidPatch: fieldCase.invalidPatch, rejectionCode: fixture.assetKind === 'audio' ? ResourceStabilityNativeAudioMeta.readonlyRefusalCode : `lumen_property_type:${field}:${field === 'name' ? 'string' : 'number>=0'}` } : undefined });
                }
            }
            const result = ResourceStabilityNativeShard.create(inventory, identity, namespace, fixtures, hashes);
            assert.equal(result.plan.cases.length, count); assert.deepEqual(result.fullResourceCaseIds, manifest.cases.map(row => row.id));
            const currentOld = result.plan.cases.filter(row => !/\|(?:asset:(?:text|json|audio)|field:asset:audio:)/u.test(row.caseId)).map(row => row.caseId);
            if (!oldIds.length) oldIds = currentOld; else assert.deepEqual(currentOld, oldIds);
            const currentText = result.plan.cases.filter(row => /\|asset:(?:text|json)\|/u.test(row.caseId)).map(row => row.caseId);
            if (sourceText) { if (!textIds.length) textIds = currentText; else assert.deepEqual(currentText, textIds); }
            assert.ok(result.blocked.some(row => row.caseId === '3.8.3|asset:audio|patch' && row.reason === 'native_no_writable_fields'));
            assert.equal(result.blocked.some(row => row.caseId === '3.8.3|field:asset:audio:downloadMode|reject_write'), !audioMeta);
            const audio = result.plan.cases.filter(row => /\|(?:asset:audio|field:asset:audio:downloadMode)\|/u.test(row.caseId)); assert.equal(audio.length, audioMeta ? 10 : 0);
            for (const row of audio) {
                assert.equal(row.expectedRejection, row.action === 'reject_write');
                assert.deepEqual(row.rejectionCodes, row.action === 'reject_write' ? [ResourceStabilityNativeAudioMeta.readonlyRefusalCode] : []);
                assert.equal(row.afterCommands?.length, 0);
                if (row.action === 'reject_write') {
                    assert.equal(row.command.name, 'peanut.editor-mcp.lumen-asset-set');
                    assert.deepEqual(row.command.input.props, { downloadMode: 1 });
                    assert.equal(row.command.input.autoCommit, false);
                    assert.deepEqual(row.expectedSemantic, { '/downloadMode': 0 });
                    assert.equal(row.setup.length, 1);
                }
                assert.ok(!row.command.name.endsWith('asset-open')); assert.ok(!['patch', 'set'].includes(row.action));
                assert.ok(Object.keys(row.expectedSemantic).every(key => ['/assetType', '/importer', '/downloadMode'].includes(key)));
                assert.ok(Object.values(row.expectedAuthorities ?? {}).every(value => ['asset-db', 'importer-meta'].includes(value.kind)));
                if (row.action === 'rename') assert.equal(row.expectedSourceContentSha256, catalogs[2].fixtures[0].files.source.sha256);
            }
            const bindings = ResourceStabilityNativeAudioMeta.bindings(result); assert.equal(bindings.size, audioMeta ? 13 : 0);
            if (audioMeta) {
                const bad = { ...result, expected: { ...result.expected, fixtureSources: {} } };
                assert.throws(() => ResourceStabilityNativeAudioMeta.bindings(bad), /digest_missing/u);
            }
        }
    } finally { rmSync(project, { recursive: true, force: true }); }
});
