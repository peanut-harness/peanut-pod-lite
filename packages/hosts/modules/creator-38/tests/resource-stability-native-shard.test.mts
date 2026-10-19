import { ResourceStabilityNativeRuntime } from '../scripts/resource-stability-native-runtime.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityNativeShard, type IResourceNativeShardFixture } from '../scripts/resource-stability-native-shard.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('native shard keeps every full denominator row and follows the real public import target contract', async () => {
    const kinds = ResourceStabilityNativeRuntime.kinds;
    const actions = ['create', 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'];
    const inventory: ICoverageInventory = { creatorVersion: '3.8.3',
        sources: [{ id: 'unit/catalog', kind: 'product_catalog', creatorVersion: null, sha256: 'a'.repeat(64) }],
        nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [],
        nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [],
        targets: [...[...kinds, 'newNativeKind'].map((kind) => ({ id: `asset:${kind}`, domain: 'asset' as const, subject: kind, actions,
            fieldKind: null, availability: 'unverified' as const, availabilitySourceId: null })),
            ...ResourceStabilityNativeShard.physicsFields.map((name) => ({ id: `field:asset:physicsMaterial:${name}`, domain: 'field' as const,
                subject: `asset:physicsMaterial.${name}`, actions: ['read', 'set', 'reject_invalid'], fieldKind: name === 'name' ? 'string' : 'number',
                availability: 'unverified' as const, availabilitySourceId: null }))],
    };
    const identity: IResourceSessionIdentity = { creatorVersion: '3.8.3', owner: 'unit-owner', change: 'unit-change', projectPath: '/private/tmp/unit',
        projectName: 'unit', runId: 'unit', creatorPid: 12, creatorStartedAt: '2026-10-19T00:00:00Z',
        hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };
    const fixtures: IResourceNativeShardFixture[] = kinds.flatMap((kind) => actions.map((action) => ({ kind,
        caseId: `3.8.3|asset:${kind}|${action}`, source: `/private/tmp/inputs/${kind}-${action}.pmtl`,
        sourceMeta: `/private/tmp/inputs/${kind}-${action}.pmtl.meta`, filename: `${kind}-${action}.pmtl`,
        initial: { '/name': `${kind}-${action}` }, patch: { name: 'patched' }, expectedPatch: { '/name': 'patched' } })));
    for (const name of ResourceStabilityNativeShard.physicsFields) for (const action of ['read', 'set', 'reject_invalid']) {
        fixtures.push({ kind: 'physicsMaterial', caseId: `3.8.3|field:asset:physicsMaterial:${name}|${action}`,
            source: `/private/tmp/inputs/${name}-${action}.pmtl`, sourceMeta: `/private/tmp/inputs/${name}-${action}.pmtl.meta`,
            filename: `${name}-${action}.pmtl`, initial: { '/name': 'initial' }, patch: {}, expectedPatch: {},
            field: { name, initial: name === 'name' ? 'initial' : 0.5, expected: name === 'name' ? 'changed' : 0.7,
                patch: { [name]: name === 'name' ? 'changed' : 0.7 }, invalidPatch: { [name]: name === 'name' ? false : 'invalid' },
                rejectionCode: `lumen_property_type:${name}:${name === 'name' ? 'string' : 'number>=0'}` } });
    }
    const hashes = Object.fromEntries(fixtures.flatMap((item) => [[item.source, 'e'.repeat(64)], [item.sourceMeta, 'f'.repeat(64)]]));
    const result = ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(result.plan.cases.length, 95); assert.equal(result.fullResourceCaseIds.length, 105);
    assert.equal(result.plan.cases.filter((row) => row.expectedRejection).length, 5);
    assert.ok(result.plan.cases.filter((row) => row.expectedRejection).every((row) => row.afterCommands?.length === 0 && row.rejectionCodes.length === 1));
    assert.equal(result.blocked.length, 10); assert.equal(result.task43Complete, false);
    assert.ok(result.plan.cases.filter((row) => ['create', 'patch'].includes(row.action)).every((row) => row.afterCommands?.length === 1));
    const imports = result.plan.cases.flatMap((row) => [...row.setup, row.command])
        .filter((command) => command.name === 'peanut.editor-mcp.asset-import');
    assert.ok(imports.length > 0);
    assert.ok(imports.every((command) => typeof command.input.target === 'string'
        && command.input.target.startsWith('db://assets/fixtures/resource-stability/unit/')));
    const executorUrl = new URL('../../../../../packages/engine/modules/lumen/source/asset-import/asset-import-batch-executor.ts', import.meta.url);
    const { AssetImportBatchExecutor } = await import(executorUrl.href) as { AssetImportBatchExecutor: new (port: {
        request(target: string, message: string, ...args: unknown[]): Promise<unknown> }) => {
            importBatch(request: { sources: readonly string[]; target: string; expandClosure: boolean }): Promise<unknown> } };
    const temporary = mkdtempSync(join(tmpdir(), 'resource-import-contract-')); let sdkCalls = 0;
    try {
        const source = join(temporary, 'source.pmtl'); writeFileSync(source, '{"__type__":"cc.PhysicsMaterial"}');
        const target = String(imports[0]?.input.target);
        const executor = new AssetImportBatchExecutor({ request: async (channel, method, ...args) => {
            sdkCalls += 1; assert.equal(channel, 'asset-db'); assert.equal(method, 'import-asset');
            assert.equal(args[1], `${target}/source.pmtl`);
            throw new Error('offline_native_boundary_not_executed');
        } });
        await assert.rejects(executor.importBatch({ sources: [source], target: target.slice(5), expandClosure: false }),
            /asset_import_target_must_be_db_assets/u);
        assert.equal(sdkCalls, 0);
        await assert.rejects(executor.importBatch({ sources: [source], target, expandClosure: false }),
            /offline_native_boundary_not_executed/u);
        assert.equal(sdkCalls, 1);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    assert.throws(() => ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures.slice(1), hashes), /fixture_scope_mismatch/u);
    const expanded = { ...inventory, targets: [...inventory.targets, { id: 'field:asset:physicsMaterial:newField', domain: 'field' as const,
        subject: 'asset:physicsMaterial.newField', actions: ['read'], fieldKind: 'number', availability: 'unverified' as const, availabilitySourceId: null }] };
    const fresh = ResourceStabilityNativeShard.create(expanded, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(fresh.fullResourceCaseIds.length, 106);
    assert.ok(fresh.blocked.some((row) => row.caseId.endsWith('newField|read') && row.reason === 'native_field_contract_not_bound'));
});
