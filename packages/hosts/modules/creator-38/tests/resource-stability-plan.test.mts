import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityPlanFactory } from '../scripts/resource-stability-plan.mts';
import type { ICoverageInventory, ICoverageTarget } from '../../../../../tools/editor-stability/coverage-contracts.mts';
import type { IResourceCasePlan, IResourceSessionIdentity } from '../scripts/resource-stability-contracts.mts';

const namespace = 'assets/_peanut-resource-stability/plan-unit';
const identity: IResourceSessionIdentity = { creatorVersion: '3.8.7', owner: 'unit-owner', change: 'unit-change',
    projectPath: '/private/tmp/plan-unit', projectName: 'plan-unit', runId: 'plan-unit', creatorPid: 123, creatorStartedAt: '2026-10-13T00:00:00Z',
    hostSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40) };
const target: ICoverageTarget = { id: 'asset:animationClip', domain: 'asset', subject: 'animationClip',
    actions: ['patch'], fieldKind: null, availability: 'unverified', availabilitySourceId: null };
const inventory = (targets: readonly ICoverageTarget[] = [target]): ICoverageInventory => ({ creatorVersion: '3.8.7',
    sources: [{ id: 'product/assets.json', kind: 'product_catalog', sha256: 'd'.repeat(64), creatorVersion: null }],
    nativeImporterModules: [], nativeRegisteredClasses: [], nativeRegistrationAlternatives: [],
    nativeUnresolvedRegistrations: [], nativeComponentDeclarations: [], nativeAbstractComponentDeclarations: [],
    curatedComponentsWithoutDeclaration: [], targets });
const row = (targetId = target.id, action = 'patch'): IResourceCasePlan => ({
    caseId: `3.8.7|${targetId}|${action}`, action, setup: [],
    beforePath: `${namespace}/source.anim`, afterPath: `${namespace}/source.anim`,
    command: { name: 'peanut.editor-mcp.lumen-asset-set', input: { assetRelativePath: `${namespace}/source.anim`, props: { speed: 2 } },
        write: true, destructive: false }, expectedSemantic: { '/speed': 2 }, expectedRejection: false, rejectionCodes: [],
});

test('resource plan binds all current resource actions without claiming other domains passed', () => {
    const component = { ...target, id: 'component:cc.Animation', domain: 'component' as const, subject: 'cc.Animation', actions: ['add'] };
    const { plan, expected } = ResourceStabilityPlanFactory.create(inventory([target, component]), identity, namespace, {}, [row()]);
    assert.deepEqual(expected.requiredCaseIds, [row().caseId]);
    assert.equal(plan.inventorySha256, expected.inventorySha256);
});

test('a new resource field or action requires another case rather than disappearing from coverage', () => {
    const field = { ...target, id: 'field:asset:animationClip:speed', domain: 'field' as const, subject: 'asset:animationClip.speed', actions: ['read'] };
    assert.throws(() => ResourceStabilityPlanFactory.create(inventory([target, field]), identity, namespace, {}, [row()]), /scope_mismatch/u);
    assert.throws(() => ResourceStabilityPlanFactory.create(inventory([{ ...target, actions: ['patch', 'copy'] }]), identity, namespace, {}, [row()]), /scope_mismatch/u);
    const fieldRow = { ...row(field.id, 'read'), command: { name: 'peanut.editor-mcp.lumen-inspect',
        input: { assetRelativePath: `${namespace}/source.anim` }, write: false, destructive: false } };
    const result = ResourceStabilityPlanFactory.create(inventory([target, field]), identity, namespace, {}, [row(), fieldRow]);
    assert.equal(result.expected.requiredCaseIds.length, 2);
});

test('source drift changes the bound digest and exact version mismatch refuses', () => {
    const first = ResourceStabilityPlanFactory.create(inventory(), identity, namespace, {}, [row()]);
    const changed = { ...inventory(), sources: [{ id: 'product/assets.json', kind: 'product_catalog' as const,
        sha256: 'e'.repeat(64), creatorVersion: null }] };
    const second = ResourceStabilityPlanFactory.create(changed, identity, namespace, {}, [row()]);
    assert.notEqual(first.plan.inventorySha256, second.plan.inventorySha256);
    assert.throws(() => ResourceStabilityPlanFactory.create(inventory(), { ...identity, creatorVersion: '3.8.3' }, namespace, {}, [row()]), /session_mismatch/u);
});
