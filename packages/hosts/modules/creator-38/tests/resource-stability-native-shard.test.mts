import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityNativeShard, type IResourceNativeShardFixture } from '../scripts/resource-stability-native-shard.mts';
import type { ICoverageInventory } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';

test('native shard keeps every full denominator row and explicitly blocks unsupported fields and types', () => {
    const kinds = ['physicsMaterial', 'animationGraphVariant', 'renderPipeline', 'animationMask'];
    const actions = ['create', 'import', 'query', 'inspect', 'patch', 'copy', 'move', 'rename', 'refresh', 'delete'];
    const inventory: ICoverageInventory = { creatorVersion: '3.8.3',
        sources: [{ id: 'unit/catalog', kind: 'product_catalog', creatorVersion: null, sha256: 'a'.repeat(64) }],
        nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [], nativeUnresolvedRegistrations: [],
        nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [], curatedComponentsWithoutDeclaration: [],
        targets: [...kinds, 'newNativeKind'].map((kind) => ({ id: `asset:${kind}`, domain: 'asset', subject: kind, actions,
            fieldKind: null, availability: 'unverified', availabilitySourceId: null })),
    };
    const identity: IResourceSessionIdentity = { creatorVersion: '3.8.3', owner: 'unit-owner', change: 'unit-change', projectPath: '/private/tmp/unit',
        projectName: 'unit', runId: 'unit', creatorPid: 12, creatorStartedAt: '2026-10-19T00:00:00Z',
        hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };
    const fixtures: IResourceNativeShardFixture[] = kinds.flatMap((kind) => actions.map((action) => ({ kind,
        caseId: `3.8.3|asset:${kind}|${action}`, source: `/private/tmp/inputs/${kind}-${action}.pmtl`,
        sourceMeta: `/private/tmp/inputs/${kind}-${action}.pmtl.meta`, filename: `${kind}-${action}.pmtl`,
        initial: { '/name': `${kind}-${action}` }, patch: { name: 'patched' }, expectedPatch: { '/name': 'patched' } })));
    const hashes = Object.fromEntries(fixtures.flatMap((item) => [[item.source, 'e'.repeat(64)], [item.sourceMeta, 'f'.repeat(64)]]));
    const result = ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(result.plan.cases.length, 40); assert.equal(result.fullResourceCaseIds.length, 50);
    assert.equal(result.blocked.length, 10); assert.equal(result.task43Complete, false);
    assert.ok(result.plan.cases.filter((row) => ['create', 'patch'].includes(row.action)).every((row) => row.afterCommands?.length === 1));
    assert.throws(() => ResourceStabilityNativeShard.create(inventory, identity, 'assets/fixtures/resource-stability/unit', fixtures.slice(1), hashes), /fixture_scope_mismatch/u);
    const expanded = { ...inventory, targets: [...inventory.targets, { id: 'field:asset:physicsMaterial:newField', domain: 'field' as const,
        subject: 'asset:physicsMaterial.newField', actions: ['read'], fieldKind: 'number', availability: 'unverified' as const, availabilitySourceId: null }] };
    const fresh = ResourceStabilityNativeShard.create(expanded, identity, 'assets/fixtures/resource-stability/unit', fixtures, hashes);
    assert.equal(fresh.fullResourceCaseIds.length, 51);
    assert.ok(fresh.blocked.some((row) => row.caseId.endsWith('newField|read') && row.reason === 'native_field_contract_not_bound'));
});
