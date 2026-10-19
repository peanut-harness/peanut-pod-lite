import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityManagedPort, type IResourceManagedConnection } from '../scripts/resource-stability-managed-port.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCommand } from '../scripts/resource-stability-contracts.mts';
import { ResourceStabilityRunner } from '../scripts/resource-stability-runner.mts';
import { ResourceStabilityNativeRuntime } from '../scripts/resource-stability-native-runtime.mts';
import { ResourceStabilityPreparationRefusal } from '../scripts/resource-stability-preparation-refusal.mts';
import { ResourceStabilityNativeClient } from '../scripts/resource-stability-native-client.mts';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('source content port requires a real reader and forwards only the requested source', async () => {
    const f = fixture(); assert.throws(() => f.port.sourceContentSha256(f.plan.cases[0]!.beforePath), /source_content_reader_missing/u);
    let path: string | null = null;
    f.connection.sourceContentSha256 = async value => { path = value; return 'b'.repeat(64); };
    assert.equal(await f.port.sourceContentSha256(f.plan.cases[0]!.beforePath), 'b'.repeat(64));
    assert.equal(path, f.plan.cases[0]!.beforePath); assert.equal(f.calls.length, 0);
});

test('native source digest hashes exact binary bytes independent of filename/meta and rejects escaped or linked files', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'resource-content-digest-')));
    const namespace = 'assets/fixtures/resource-stability/content-test'; mkdirSync(join(project, namespace), { recursive: true });
    const path = `${namespace}/original.terrain`; const renamed = `${namespace}/renamed.terrain`;
    const bytes = Buffer.from([8, 0, 1, 1, 0, 255]); writeFileSync(join(project, path), bytes);
    // Only the pure filesystem reader is exercised; no authenticated client constructor or native call is used.
    const client = Object.assign(Object.create(ResourceStabilityNativeClient.prototype) as ResourceStabilityNativeClient,
        { project, registration: { namespace } });
    try {
        const expected = createHash('sha256').update(bytes).digest('hex');
        assert.equal(await client.sourceContentSha256(path), expected);
        writeFileSync(join(project, `${path}.meta`), 'different metadata'); renameSync(join(project, path), join(project, renamed));
        assert.equal(await client.sourceContentSha256(renamed), expected);
        const link = `${namespace}/link.terrain`; symlinkSync(join(project, renamed), join(project, link));
        for (const rejected of [link, `${namespace}/../escape.terrain`, `${namespace}/%2e%2e/escape`, 'assets/outside.terrain', namespace]) {
            await assert.rejects(client.sourceContentSha256(rejected), /source_content_out_of_scope/u);
        }
    } finally { rmSync(project, { recursive: true, force: true }); }
});

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

test('a later transport failure retains earlier recorded observations for the final partial result', async () => {
    const f = fixture(); const first = f.plan.cases[0]; assert.ok(first);
    const second = { ...first, caseId: '3.8.3|asset:physicsMaterial|patch', command: { ...f.command } };
    const plan = { ...f.plan, cases: [first, second] };
    const expected = { ...f.expected, requiredCaseIds: plan.cases.map((row) => row.caseId) };
    const original = f.connection.mcp; let actualCalls = 0; let speed = 1; let recorded = 0;
    f.connection.mcp = async (body) => {
        if (body.action === 'call') {
            if (++actualCalls === 2) throw new Error('later_transport_uncertainty');
            speed = 2;
        }
        return original(body);
    };
    f.connection.nativeSnapshot = async (path) => ({ path, exists: true,
        metaUuid: '11111111-1111-4111-8111-111111111111', assetDbUuid: '11111111-1111-4111-8111-111111111111',
        subassets: [], unresolvedReferences: [], semantic: { speed }, readbackOrigin: 'creator-native' });
    f.connection.recordObservation = async () => { recorded += 1; };
    const port = new ResourceStabilityManagedPort(plan, expected, f.connection);
    await assert.rejects(ResourceStabilityRunner.run(plan, expected, port), /incomplete_or_failed/u);
    assert.equal(actualCalls, 2); assert.equal(recorded, 1);
    assert.equal(port.observations.length, 1); assert.equal(port.observations[0]?.caseId, first.caseId);
});

test('native binding uses the actual registered UUID before one approval without mutating the reviewed plan', async () => {
    const f = fixture(); const source = `${f.plan.namespace}/local.effect`;
    const authority = ResourceStabilityNativeRuntime.authority('cc.EffectAsset', '/type');
    const uuid = '22222222-2222-4222-8222-222222222222';
    const command: IResourceCommand = { ...f.command, input: { ...f.command.input,
        props: { effectAsset: null }, resources: [source, `${f.plan.namespace}/clip.anim`] },
        nativeBindings: { '/props/effectAsset': { assetPath: source, expectedType: 'cc.EffectAsset', expectedAuthority: authority } } };
    const first = f.plan.cases[0]; assert.ok(first);
    const plan = { ...f.plan, cases: [{ ...first, command }] };
    f.connection.nativeSnapshot = async (path) => ({ path, exists: true, metaUuid: uuid, assetDbUuid: uuid,
        subassets: [], unresolvedReferences: [], semantic: { type: 'cc.EffectAsset' }, authorities: { '/type': authority }, readbackOrigin: 'creator-native' });
    const before = JSON.stringify(command);
    await new ResourceStabilityManagedPort(plan, f.expected, f.connection).call(command, plan.namespace);
    assert.equal(JSON.stringify(command), before);
    const called = f.calls.find((item) => item.action === 'call');
    assert.equal(((called?.input as Record<string, unknown>).props as Record<string, unknown>).effectAsset, uuid);
    assert.equal(f.calls.filter((item) => item.action === 'issueApprovalToken').length, 1);
    assert.equal(f.calls.filter((item) => item.action === 'catalog').length, 2);
    f.calls.length = 0;
    f.connection.nativeSnapshot = async (path) => ({ path, exists: true, metaUuid: uuid, assetDbUuid: uuid,
        subassets: [], unresolvedReferences: [], semantic: { type: 'cc.EffectAsset' }, authorities: { '/type': { ...authority, sourceSha256: 'a'.repeat(64) } }, readbackOrigin: 'creator-native' });
    await assert.rejects(new ResourceStabilityManagedPort(plan, f.expected, f.connection).call(command, plan.namespace));
    assert.equal(f.calls.some((item) => item.action === 'issueApprovalToken' || item.action === 'call'), false);
});

test('direct managed-port construction rejects unsafe binding shape before native reads or approvals', () => {
    const f = fixture(); let nativeReads = 0;
    f.connection.nativeSnapshot = async () => { nativeReads += 1; throw new Error('must_not_read'); };
    const first = f.plan.cases[0]; assert.ok(first);
    const reference = { assetPath: `${f.plan.namespace}/local.effect`, expectedType: 'cc.EffectAsset',
        expectedAuthority: ResourceStabilityNativeRuntime.authority('cc.EffectAsset', '/type') };
    for (const pointer of ['/assetRelativePath', '/props/__proto__', '/props/effectAsset']) {
        const command: IResourceCommand = { ...f.command, input: { ...f.command.input,
            props: { effectAsset: 'not-a-null-binding-slot' } }, nativeBindings: { [pointer]: reference } };
        assert.throws(() => new ResourceStabilityManagedPort({ ...f.plan, cases: [{ ...first, command }] }, f.expected, f.connection));
    }
    assert.equal(nativeReads, 0); assert.equal(f.calls.length, 0);
});

test('only the exact expected negative case can accept a complete failed-before-writer DTO', async () => {
    const f = fixture(); const first = f.plan.cases[0]; assert.ok(first);
    const code = 'lumen_property_type:speed:number>0';
    const payload = { ok: false, error: code, failure: { schemaVersion: 1, code, category: 'invalid_input', state: 'unchanged',
        retryable: true, recommendedAction: 'fix_input', operation: 'lumen.assetSet', taskId: 'synthetic-task', taskStatus: 'failed',
        assetFieldPreparationRefusal: { schemaVersion: 1, code, phase: 'prepare_before_writer', projectState: 'unchanged', taskId: 'synthetic-task' } } };
    const refusal = ResourceStabilityPreparationRefusal.fromResponse(payload, f.command.name); assert.ok(refusal);
    const original = f.connection.mcp;
    f.connection.mcp = async (body) => { if (body.action === 'call') throw refusal; return original(body); };
    await assert.rejects(new ResourceStabilityManagedPort(f.plan, f.expected, f.connection).call(f.command, f.plan.namespace));
    const row = { ...first, action: 'reject_invalid', caseId: '3.8.3|field:asset:animationClip:speed|reject_invalid',
        expectedRejection: true, rejectionCodes: [code] };
    const plan = { ...f.plan, cases: [row] }; const expected = { ...f.expected, requiredCaseIds: [row.caseId] };
    const outcome = await new ResourceStabilityManagedPort(plan, expected, f.connection).call(f.command, plan.namespace);
    assert.deepEqual(outcome, { status: 'rejected', rejectionCode: code, postflightVerified: false });
    assert.equal(refusal.failure.taskStatus, 'failed');
    f.connection.mcp = async (body) => body.action === 'call' ? { taskStatus: 'rejected', code } : original(body);
    await assert.rejects(new ResourceStabilityManagedPort(plan, expected, f.connection).call(f.command, plan.namespace), /untrusted_rejection/u);
    f.connection.mcp = async (body) => { if (body.action === 'call') throw refusal; return original(body); };
    refusal.message = 'some-other-code';
    await assert.rejects(new ResourceStabilityManagedPort(plan, expected, f.connection).call(f.command, plan.namespace));
});
