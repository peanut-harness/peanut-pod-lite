import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityReadiness } from '../scripts/resource-stability-readiness.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCasePlan } from '../scripts/resource-stability-contracts.mts';

const namespace = 'assets/fixtures/resource-stability/readiness-unit';
const write = 'peanut.editor-mcp.lumen-asset-set';
const read = 'peanut.editor-mcp.lumen-inspect';
const row = (action: 'patch' | 'inspect'): IResourceCasePlan => ({
    caseId: `3.8.3|asset:animationClip|${action}`, action, setup: [], beforePath: `${namespace}/clip.anim`,
    afterPath: `${namespace}/clip.anim`, expectedSemantic: {}, expectedRejection: false, rejectionCodes: [],
    command: { name: action === 'patch' ? write : read, input: { assetRelativePath: `${namespace}/clip.anim`, props: {} },
        write: action === 'patch', destructive: false },
});
const plan: IResourceCampaignPlan = { creatorVersion: '3.8.3', namespace,
    inventorySha256: 'a'.repeat(64), cases: [row('patch'), row('inspect')] };
const expected: IResourceCampaignExpectation = { creatorVersion: '3.8.3', namespace, inventorySha256: plan.inventorySha256,
    requiredCaseIds: plan.cases.map((item) => item.caseId), fixtureSources: {}, owner: 'unit-owner', change: 'unit-change',
    projectPath: '/private/tmp/readiness-unit', projectName: 'readiness-unit', runId: 'readiness-unit', creatorPid: 12,
    creatorStartedAt: '2026-10-19T00:00:00Z', hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };
const live = () => ({ catalog: { revision: 1, capabilities: [{ name: write, readOnly: false }, { name: read, readOnly: true }] },
    status: { writeEnabledPluginIds: [] }, attachment: { owner: expected.owner, projectPath: expected.projectPath,
        capabilities: [write], resourceRoots: [namespace] } });

test('exact resource attachment permits readiness but never claims native validation', () => {
    const result = ResourceStabilityReadiness.check(plan, expected, live());
    assert.equal(result.ready, true);
    assert.equal(result.nativeVerified, false);
    assert.equal(result.allEnabled, false);
});

test('missing capability fails every dependent case including setup without reducing manifest', () => {
    const input = live(); input.catalog.capabilities = [{ name: read, readOnly: true }];
    const withSetup = { ...plan, cases: [row('patch'), { ...row('inspect'), setup: [row('patch').command] }] };
    const result = ResourceStabilityReadiness.check(withSetup, expected, input);
    assert.equal(result.ready, false);
    assert.equal(result.cases.length, 2);
    assert.ok(result.cases.every((item) => item.issues.includes(`capability_missing:${write}`)));
});

test('unattached write is rejected even when the catalog advertises it', () => {
    const input = live(); input.attachment.capabilities = [];
    const result = ResourceStabilityReadiness.check(plan, expected, input);
    assert.deepEqual(result.cases[0]?.issues, [`capability_not_attached:${write}`]);
    assert.equal(result.cases[1]?.ready, true);
});

test('all exposure or unknown status blocks every case without changing the input', () => {
    for (const status of [{ writeEnabledPluginIds: ['peanut.editor-mcp'] }, {}, null]) {
        const input = { ...live(), status }; const before = JSON.stringify(input);
        const result = ResourceStabilityReadiness.check(plan, expected, input);
        assert.ok(result.cases.every((item) => !item.ready));
        assert.ok(result.issues.includes('resource_readiness_all_or_unknown_exposure'));
        assert.equal(JSON.stringify(input), before);
    }
});

test('foreign owner/project and broader resource roots cannot authorize the namespace', () => {
    for (const overrides of [{ owner: 'foreign' }, { projectPath: '/private/tmp/foreign' },
        { resourceRoots: ['assets/fixtures'] }, { resourceRoots: [namespace, 'assets/components'] }]) {
        const input = live(); Object.assign(input.attachment, overrides);
        assert.equal(ResourceStabilityReadiness.check(plan, expected, input).ready, false);
    }
});

test('unknown, duplicate or access-mismatched catalog definitions fail closed', () => {
    for (const catalog of [null, { revision: 1, capabilities: [{ name: write }] },
        { revision: 1, capabilities: [{ name: write, readOnly: false }, { name: write, readOnly: false }] },
        { revision: 1, capabilities: [{ name: write, readOnly: true }, { name: read, readOnly: true }] }]) {
        assert.equal(ResourceStabilityReadiness.check(plan, expected, { ...live(), catalog }).ready, false);
    }
});

test('incomplete inventory and old or broad namespace cannot acquire readiness', () => {
    assert.throws(() => ResourceStabilityReadiness.check({ ...plan, cases: [row('patch')] }, expected, live()), /scope_mismatch/u);
    for (const invalid of ['assets/_peanut-resource-stability/readiness-unit', 'assets/fixtures', 'assets/fixtures/resource-stability/a/b']) {
        assert.throws(() => ResourceStabilityReadiness.check({ ...plan, namespace: invalid }, { ...expected, namespace: invalid }, live()), /identity_invalid/u);
    }
});
