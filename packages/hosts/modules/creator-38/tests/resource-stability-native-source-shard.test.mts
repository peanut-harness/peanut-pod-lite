import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ResourceStabilityNativeFixture } from '../scripts/resource-stability-native-fixture.mts';
import { ResourceStabilityNativeShard } from '../scripts/resource-stability-native-shard.mts';
import { ResourceStabilityNativeSourceText } from '../scripts/resource-stability-native-source-text.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/serialized/resource-source-text-fixtures.json'), 'utf8'));
const actions = ['import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'];

/**
 * @description A focused manifest retains all18 target IDs and explicitly blocks both unwritable patch actions.
 */
test('source lifecycle plan has16 real operations,2 blocked patch IDs and no runtime/name/open authority', () => {
    const inventory: ICoverageInventory = { creatorVersion: '3.8.3', sources: [{ id: 'product/assets.json', kind: 'product_catalog', creatorVersion: null, sha256: sha(readFileSync(join(root, 'packages/engine/modules/lumen/bundled/schema/assets.json'))) }], nativeImporterModules: [], nativeRegisteredClasses: [], nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [],
        targets: ['text', 'json'].map(kind => ({ id: 'asset:' + kind, domain: 'asset', subject: kind, actions,
            fieldKind: null, availability: 'unverified', availabilitySourceId: null })) } as unknown as ICoverageInventory;
    const fixtures = catalog.fixtures.flatMap((row: any) => actions.filter(action => action !== 'patch').map(action => {
        const source = join(root, row.files.source.path); const sourceMeta = join(root, row.files.meta.path);
        const bytes = readFileSync(source); assert.equal(sha(bytes), row.files.source.sha256); assert.equal(sha(readFileSync(sourceMeta)), row.files.meta.sha256);
        const prepared = ResourceStabilityNativeFixture.prepare(row.assetKind, bytes, row.assetKind + '-' + action, row.initialPublic);
        assert.ok(prepared.source.equals(bytes)); assert.deepEqual(prepared.initial, row.initialPublic);
        return { kind: row.assetKind, caseId: '3.8.3|asset:' + row.assetKind + '|' + action, source, sourceMeta,
            filename: row.assetKind + '-' + action + '.' + (row.assetKind === 'text' ? 'txt' : 'json'), initial: prepared.initial, patch: {}, expectedPatch: {} };
    }));
    const hashes = Object.fromEntries(fixtures.flatMap((fixture: any) => [[fixture.source, sha(readFileSync(fixture.source))], [fixture.sourceMeta, sha(readFileSync(fixture.sourceMeta))]]));
    const session: IResourceSessionIdentity = { creatorVersion: '3.8.3', owner: 'offline-owner', change: 'offline-change', projectPath: '/private/tmp/source-plan',
        projectName: 'offline-plan', runId: 'offline', creatorPid: 1, creatorStartedAt: '2026-10-19T00:00:00Z', hostSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40) };
    const result = ResourceStabilityNativeShard.create(inventory, session, 'assets/fixtures/resource-stability/offline', fixtures, hashes);
    assert.equal(result.fullResourceCaseIds.length, 18); assert.equal(result.plan.cases.length, 16);
    assert.deepEqual(result.blocked.map(row => row.caseId).sort(), ['3.8.3|asset:json|patch', '3.8.3|asset:text|patch']);
    assert.ok(result.blocked.every(row => row.reason === 'native_no_writable_fields')); assert.equal(result.task43Complete, false);
    for (const row of result.plan.cases) {
        assert.ok(!row.command.name.includes('open')); assert.equal(row.expectedSemantic['/name'], undefined);
        assert.ok(Object.values(row.expectedAuthorities ?? {}).every(authority => authority.kind !== 'runtime-object'));
        assert.equal(row.expectedSemantic['/assetType'], row.caseId.includes('|asset:text|') ? 'cc.TextAsset' : 'cc.JsonAsset');
        assert.equal(row.expectedAuthorities?.['/assetType']?.kind, 'asset-db');
        assert.equal(row.expectedAuthorities?.['/importer']?.kind, 'importer-meta'); assert.equal(row.expectedAuthorities?.['/sourceSha256']?.kind, 'source-text');
        if (row.action === 'rename') assert.equal(row.expectedSourceContentSha256, row.expectedSemantic['/sourceSha256']);
    }
    const bindings = ResourceStabilityNativeSourceText.bindings(result);
    assert.ok(bindings.size >= 16); assert.ok([...bindings].every(([path, binding]) => path.endsWith(binding.kind === 'text' ? '.txt' : '.json')));
    assert.equal(basename(fixtures[0].source).endsWith('.txt'), true);
});
