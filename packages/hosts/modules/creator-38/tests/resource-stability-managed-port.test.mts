import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityManagedPort, type IResourceManagedConnection } from '../scripts/resource-stability-managed-port.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCommand } from '../scripts/resource-stability-contracts.mts';

function fixture() {
    const namespace = 'assets/fixtures/resource-stability/managed-unit';
    const command: IResourceCommand = { name: 'peanut.editor-mcp.lumen-asset-set', write: true, destructive: false,
        input: { assetRelativePath: `${namespace}/clip.anim`, props: { speed: 2 }, resources: [`${namespace}/clip.anim`] } };
    const caseId = '3.8.3|asset:animationClip|patch';
    const plan: IResourceCampaignPlan = { creatorVersion: '3.8.3', namespace, inventorySha256: 'a'.repeat(64), cases: [{
        caseId, action: 'patch', setup: [], command, beforePath: `${namespace}/clip.anim`, afterPath: `${namespace}/clip.anim`,
        expectedSemantic: { '/speed': 2 }, expectedRejection: false, rejectionCodes: [],
    }] };
    const expected: IResourceCampaignExpectation = { creatorVersion: '3.8.3', namespace, inventorySha256: plan.inventorySha256,
        requiredCaseIds: [caseId], fixtureSources: {}, owner: 'unit-owner', change: 'unit-change', projectPath: '/private/tmp/unit',
        projectName: 'unit', runId: 'unit', creatorPid: 12, creatorStartedAt: '2026-10-19T00:00:00Z',
        hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64), sourceCommit: 'd'.repeat(40) };
    const calls: Readonly<Record<string, unknown>>[] = [];
    const result = { value: { taskStatus: 'succeeded', postflight: { verified: true } } as unknown };
    const connection: IResourceManagedConnection = {
        identity: async () => expected,
        mcp: async (body) => {
            calls.push(body);
            if (body.action === 'catalog') return { revision: 1, capabilities: [{ name: command.name, readOnly: false }] };
            if (body.action === 'status') return { writeEnabledPluginIds: [] };
            if (body.action === 'queryCapabilityAttachments') return { attachment: { owner: expected.owner,
                projectPath: expected.projectPath, capabilities: [command.name], resourceRoots: [namespace] } };
            if (body.action === 'issueApprovalToken') return { approvalToken: 'private-one-use', liteMirrored: true };
            if (result.value instanceof Error) throw result.value;
            return result.value;
        },
        nativeSnapshot: async () => { throw new Error('not_provided'); }, sourceHashes: async () => 'e'.repeat(64),
        fixtureSourceSha256: async () => 'f'.repeat(64), recordObservation: async () => {}, recordFailure: async () => {},
    };
    return { plan, expected, command, calls, result, connection,
        port: new ResourceStabilityManagedPort(plan, expected, connection) };
}

test('managed port uses one precise approval and one call after live catalog checks', async () => {
    const f = fixture();
    assert.deepEqual(await f.port.call(f.command, f.plan.namespace), { status: 'succeeded', rejectionCode: null, postflightVerified: true });
    assert.deepEqual(f.calls.map((item) => item.action), ['catalog', 'status', 'queryCapabilityAttachments', 'issueApprovalToken', 'call']);
    assert.equal(Object.hasOwn(f.command.input, 'approvalToken'), false);
    const approval = f.calls[3]; assert.deepEqual(approval?.operations, [f.command.name]);
    assert.deepEqual(approval?.resources, f.command.input.resources);
});

test('transport uncertainty and unverified postflight fail without replay', async () => {
    for (const value of [new Error('transport_uncertain'), { taskStatus: 'succeeded', postflight: { verified: false } }]) {
        const f = fixture(); f.result.value = value;
        await assert.rejects(f.port.call(f.command, f.plan.namespace));
        assert.equal(f.calls.filter((item) => item.action === 'call').length, 1);
        assert.equal(f.calls.filter((item) => item.action === 'issueApprovalToken').length, 1);
    }
});

test('foreign command, wrong namespace and missing identity fail before issuing approval', async () => {
    const f = fixture();
    await assert.rejects(f.port.call({ ...f.command }, f.plan.namespace), /not_in_plan/u);
    await assert.rejects(f.port.call(f.command, 'assets/fixtures/foreign'), /not_in_plan/u);
    f.connection.identity = async () => ({ ...f.expected, creatorPid: 13 });
    await assert.rejects(f.port.call(f.command, f.plan.namespace), /identity_mismatch/u);
    assert.equal(f.calls.length, 0);
});

test('snapshot never relabels serialized observations as native', async () => {
    const f = fixture(); f.connection.nativeSnapshot = async (path) => ({ path, exists: true, metaUuid: null,
        assetDbUuid: null, subassets: [], unresolvedReferences: [], semantic: {}, readbackOrigin: 'serialized-only' });
    await assert.rejects(f.port.snapshot(`${f.plan.namespace}/clip.anim`), /native_readback_missing/u);
});
