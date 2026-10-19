import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityRunner } from '../scripts/resource-stability-runner.mts';
import { ResourceStabilityEvidenceValidator } from '../scripts/resource-stability-evidence.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCampaignPort, IResourceCaseObservation,
    IResourceCasePlan, IResourceCallOutcome, IResourceCommand, IResourceSessionIdentity, IResourceSnapshot } from '../scripts/resource-stability-contracts.mts';
import { createHash } from 'node:crypto';

const namespace = 'assets/fixtures/resource-stability/synthetic-test';
const source = `${namespace}/source.anim`;
const uuid = '11111111-2222-4333-8444-555555555555';
const destinationUuid = '99999999-2222-4333-8444-555555555555';
const identity: IResourceSessionIdentity = {
    projectPath: '/private/tmp/synthetic-resource-project', projectName: 'peanut-resource-stability', runId: 'synthetic-resource-run',
    creatorPid: 123, creatorStartedAt: '2026-10-13T00:00:00Z',
    creatorVersion: '3.8.7', owner: 'unit-test-owner', change: 'stabilize-editor-operations-and-bulk-file-io',
    hostSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64), sourceCommit: 'c'.repeat(40),
};
const snapshot = (relativePath = source, value = 1): IResourceSnapshot => ({ path: relativePath, exists: true,
    metaUuid: uuid, assetDbUuid: uuid, subassets: [], unresolvedReferences: [], semantic: { value }, readbackOrigin: 'creator-native' });
const absent = (relativePath = source): IResourceSnapshot => ({ ...snapshot(relativePath), exists: false,
    metaUuid: null, assetDbUuid: null, semantic: {}, subassets: [] });
const command = (): IResourceCommand => ({ name: 'peanut.editor-mcp.lumen-asset-set',
    input: { assetRelativePath: source, props: { value: 2 }, autoCommit: true }, write: true, destructive: false });
const row = (action = 'patch'): IResourceCasePlan => ({ caseId: `3.8.7|asset:animationClip|${action}`, action,
    setup: [], command: command(), beforePath: source, afterPath: source, expectedSemantic: { '/value': 2 },
    expectedRejection: ['reject_invalid', 'reject_write'].includes(action), rejectionCodes: ['field_value_invalid'] });
const expectation = (rows: readonly IResourceCasePlan[]): IResourceCampaignExpectation => ({ ...identity,
    namespace, inventorySha256: 'd'.repeat(64), requiredCaseIds: rows.map((r) => r.caseId), fixtureSources: {} });
const plan = (rows: readonly IResourceCasePlan[]): IResourceCampaignPlan => ({ namespace, creatorVersion: '3.8.7',
    inventorySha256: 'd'.repeat(64), cases: rows });
const observation = (r: IResourceCasePlan, overrides: Partial<IResourceCaseObservation> = {}): IResourceCaseObservation => ({
    caseId: r.caseId, action: r.action, before: snapshot(r.beforePath), after: snapshot(r.afterPath, 2),
    rejected: false, failure: null, postflightVerified: true,
    beforeSourceSha256: 'e'.repeat(64), afterSourceSha256: 'f'.repeat(64),
    preservedSource: null, preservedSourceSha256: null, obsoletePath: null, ...overrides,
});

/**
 * @description 纯内存端口，仅验证 runner 状态机；不构成 Creator 原生结果。
 */
class SyntheticPort implements IResourceCampaignPort {
    public fixtureHash = 'e'.repeat(64);
    public async fixtureSourceSha256(_absolutePath: string): Promise<string> { return this.fixtureHash; }
    public calls = 0;
    public recorded: IResourceCaseObservation[] = [];
    public failures: string[] = [];
    public session = { ...identity };
    public state = snapshot();
    public outcome: IResourceCallOutcome = { status: 'succeeded', rejectionCode: null, postflightVerified: true };
    public throwCall = false;
    public async preflight(): Promise<IResourceSessionIdentity> { return this.session; }
    public async call(_command: IResourceCommand, _namespace: string): Promise<IResourceCallOutcome> {
        this.calls += 1;
        if (this.throwCall) throw new Error('synthetic transport failure with private body');
        if (this.outcome.status === 'succeeded') this.state = snapshot(source, 2);
        return this.outcome;
    }
    public async snapshot(relative: string): Promise<IResourceSnapshot> { return { ...structuredClone(this.state), path: relative }; }
    public async sourceHashes(_relative: string): Promise<string> { return this.state.semantic.value === 1 ? 'e'.repeat(64) : 'f'.repeat(64); }
    public async recordObservation(value: IResourceCaseObservation): Promise<void> { this.recorded.push(structuredClone(value)); }
    public async recordFailure(caseId: string, code: string): Promise<void> { this.failures.push(`${caseId}:${code}`); }
}

test('explicit bounded commit completes before native readback and its failure stops the case', async () => {
    const commit: IResourceCommand = { name: 'peanut.editor-mcp.lumen-commit',
        input: { assetRelativePath: source, paths: [source] }, write: true, destructive: false };
    const r = { ...row(), afterCommands: [commit] }; const port = new SyntheticPort();
    await ResourceStabilityRunner.run(plan([r]), expectation([r]), port);
    assert.equal(port.calls, 2);
    const failed = new SyntheticPort();
    failed.call = async (command) => {
        if (command === commit) return { status: 'succeeded', rejectionCode: null, postflightVerified: false };
        failed.state = snapshot(source, 2); return failed.outcome;
    };
    await assert.rejects(ResourceStabilityRunner.run(plan([r]), expectation([r]), failed), /incomplete_or_failed/u);
    assert.equal(failed.recorded.length, 0);
});

test('rejection cases cannot append commit or another hidden mutation', () => {
    const r = { ...row('reject_invalid'), afterCommands: [command()] };
    assert.throws(() => ResourceStabilityRunner.validatePlan(plan([r]), expectation([r])), /rejection_after_commands/u);
});

test('synthetic runner executes one exact scope and records the actual observation before returning', async () => {
    const r = row(); const port = new SyntheticPort();
    const observations = await ResourceStabilityRunner.run(plan([r]), expectation([r]), port);
    assert.equal(port.calls, 1);
    assert.equal(port.recorded.length, 1);
    assert.deepEqual(observations[0]?.after.semantic, { value: 2 });
});

test('context drift between initial preflight and execution stops before mutation and is recorded', async () => {
    const r = row(); const port = new SyntheticPort(); let reads = 0;
    port.preflight = async () => ({ ...identity, owner: ++reads === 1 ? identity.owner : 'new-owner' });
    await assert.rejects(ResourceStabilityRunner.run(plan([r]), expectation([r]), port), /incomplete_or_failed/u);
    assert.equal(port.calls, 0); assert.equal(port.failures.length, 1);
});

for (const key of ['creatorVersion', 'owner', 'change', 'hostSha256', 'coreSha256', 'sourceCommit'] as const) {
    test(`session mismatch refuses before mutation: ${key}`, async () => {
        const r = row(); const port = new SyntheticPort(); port.session[key] = 'mismatch';
        await assert.rejects(ResourceStabilityRunner.run(plan([r]), expectation([r]), port), /session_mismatch/u);
        assert.equal(port.calls, 0);
    });
}

for (const modify of [
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, beforePath: 'assets/user-content.anim' }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, afterPath: `${namespace}/../other.anim` }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, command: { ...r.command, input: { approvalToken: 'private' } } }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, command: { ...r.command, input: { props: { secret: 'private' } } } }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, command: { ...r.command, name: 'peanut.editor-mcp.builder-build' } }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, command: { ...r.command, name: 'peanut.editor-mcp.asset-reimport', input: {} } }),
    (r: IResourceCasePlan): IResourceCasePlan => ({ ...r, command: { ...r.command, name: 'peanut.editor-mcp.asset-import', input: { target: 'db://assets/outside' } } }),
]) {
    test('out-of-scope, unbounded commands and credentials refuse before the port is invoked', async () => {
        const r = row(); const port = new SyntheticPort();
        await assert.rejects(ResourceStabilityRunner.run(plan([modify(r)]), expectation([r]), port));
        assert.equal(port.calls, 0);
    });
}

test('missing, duplicated and injected cases cannot reduce or extend the scope', () => {
    const r = row(); const expected = expectation([r]);
    for (const rows of [[], [r, r], [{ ...r, caseId: '3.8.7|asset:other|patch' }]]) {
        assert.throws(() => ResourceStabilityRunner.validatePlan(plan(rows), expected), /scope_mismatch/u);
    }
});

test('every write requires explicit bounded targets, including empty lists and rename traversal', () => {
    const r = row();
    const invalid: IResourceCommand[] = [
        { name: 'peanut.editor-mcp.asset-delete', write: true, destructive: true, input: {} },
        { name: 'peanut.editor-mcp.asset-delete', write: true, destructive: true, input: { paths: [] } },
        { name: 'peanut.editor-mcp.asset-move', write: true, destructive: false, input: { from: source } },
        { name: 'peanut.editor-mcp.asset-rename', write: true, destructive: false, input: { path: source, newName: '..' } },
        { ...command(), input: { props: { value: 2 } } },
        { name: 'peanut.editor-mcp.lumen-scaffold', write: true, destructive: false, input: { assetRelativePath: source, reset: true } },
    ];
    for (const command of invalid) assert.throws(() => ResourceStabilityRunner.validatePlan(plan([{ ...r, command }]), expectation([r])));
});

test('import requires reviewed full closure and actual source hashes immediately before calling the port', async () => {
    const fixture = '/private/tmp/reviewed-synthetic.anim';
    const r: IResourceCasePlan = { ...row('import'), command: { name: 'peanut.editor-mcp.asset-import',
        write: true, destructive: false, input: { sources: [fixture], target: namespace, expandClosure: false } } };
    const expected: IResourceCampaignExpectation = { ...expectation([r]), fixtureSources: { [fixture]: 'e'.repeat(64) } };
    assert.doesNotThrow(() => ResourceStabilityRunner.validatePlan(plan([r]), expected));
    assert.throws(() => ResourceStabilityRunner.validatePlan(plan([r]), expectation([r])), /source_unapproved/u);
    for (const extra of [{ expandClosure: true }, { allowMissingDependencies: true }, { dependencyMap: {} }]) {
        assert.throws(() => ResourceStabilityRunner.validatePlan(plan([{ ...r, command: { ...r.command,
            input: { ...r.command.input, ...extra } } }]), expected), /source_unapproved/u);
    }
    const port = new SyntheticPort(); port.fixtureHash = '0'.repeat(64);
    await assert.rejects(ResourceStabilityRunner.run(plan([r]), expected, port), /incomplete_or_failed/u);
    assert.equal(port.calls, 0);
    assert.equal(port.failures.length, 1);
});

test('refresh cannot lose or duplicate registered subassets while preserving the root UUID', () => {
    const r = row('refresh');
    const subassets = [{ metaUuid: `${uuid}@child`, assetDbUuid: `${uuid}@child` }];
    const before = { ...snapshot(), subassets };
    assert.ok(ResourceStabilityRunner.validateObservation(r, observation(r, { before })).includes('subasset_identity_changed'));
    const after = { ...snapshot(source, 2), subassets: [...subassets, ...subassets] };
    assert.ok(ResourceStabilityRunner.validateObservation(r, observation(r, { before, after })).includes('subasset_registration_duplicate'));
});

test('read-only observations cannot hide file mutation or native state changes', () => {
    for (const action of ['query', 'inspect', 'read']) {
        const r = { ...row(action), expectedSemantic: { '/value': 1 } };
        const good = observation(r, { after: snapshot(), afterSourceSha256: 'e'.repeat(64) });
        assert.deepEqual(ResourceStabilityRunner.validateObservation(r, good), []);
        assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, afterSourceSha256: 'f'.repeat(64) }).includes('read_changed_source'));
        assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, after: snapshot(source, 2) }).includes('read_changed_source'));
    }
});

for (const [name, value] of [
    ['missing AssetDB registration', { ...snapshot(source, 2), assetDbUuid: null }],
    ['wrong UUID', { ...snapshot(source, 2), metaUuid: destinationUuid, assetDbUuid: destinationUuid }],
    ['missing subasset', { ...snapshot(source, 2), subassets: [{ metaUuid: `${uuid}@sub`, assetDbUuid: null }] }],
    ['unresolved reference', { ...snapshot(source, 2), unresolvedReferences: ['missing-texture'] }],
    ['serialized-only Inspector', { ...snapshot(source, 2), readbackOrigin: 'serialized-only' as const }],
    ['incorrect semantic value', snapshot(source, 0)],
] as const) {
    test(`independent observation fails: ${name}`, () => {
        const r = row();
        assert.ok(ResourceStabilityRunner.validateObservation(r, observation(r, { after: value })).length > 0);
    });
}

test('copy requires a new UUID and independently rechecks the unchanged original', () => {
    const r = { ...row('copy'), afterPath: `${namespace}/copy.anim` };
    const after = { ...snapshot(r.afterPath, 2), metaUuid: destinationUuid, assetDbUuid: destinationUuid };
    const good = observation(r, { after, preservedSource: snapshot(), preservedSourceSha256: 'e'.repeat(64) });
    assert.deepEqual(ResourceStabilityRunner.validateObservation(r, good), []);
    assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, preservedSourceSha256: '0'.repeat(64) }).includes('copy_changed_source'));
    assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, after: snapshot(r.afterPath, 2) }).includes('copy_reused_uuid'));
});

for (const action of ['move', 'rename']) {
    test(`${action} fails when the old path remains registered`, () => {
        const r = { ...row(action), afterPath: `${namespace}/destination.anim` };
        const good = observation(r, { obsoletePath: absent() });
        assert.deepEqual(ResourceStabilityRunner.validateObservation(r, good), []);
        assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, obsoletePath: snapshot() }).includes('old_path_still_registered'));
    });
}

test('delete checks both source registration and all destination metadata/AssetDB residue', () => {
    const r = { ...row('delete'), command: { ...command(), name: 'peanut.editor-mcp.asset-delete', input: { paths: [source] }, destructive: true } };
    assert.deepEqual(ResourceStabilityRunner.validateObservation(r, observation(r, { after: absent() })), []);
    assert.ok(ResourceStabilityRunner.validateObservation(r, observation(r, { after: { ...absent(), assetDbUuid: uuid } })).includes('delete_residue'));
});

test('field rejection needs the precise input error and unchanged snapshot/source/meta hashes', () => {
    const r = row('reject_invalid');
    const good = observation(r, { rejected: true, failure: 'field_value_invalid', after: snapshot(), afterSourceSha256: 'e'.repeat(64), postflightVerified: false });
    assert.deepEqual(ResourceStabilityRunner.validateObservation(r, good), []);
    assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, failure: 'approval_required' }).includes('expected_rejection_missing'));
    assert.ok(ResourceStabilityRunner.validateObservation(r, { ...good, afterSourceSha256: '0'.repeat(64) }).includes('rejection_changed_source'));
});

test('postflight failure and transport uncertainty persist failure and never retry a write', async () => {
    for (const transportFailure of [false, true]) {
        const r = row(); const port = new SyntheticPort();
        port.throwCall = transportFailure; port.outcome = { ...port.outcome, postflightVerified: false };
        await assert.rejects(ResourceStabilityRunner.run(plan([r]), expectation([r]), port), /case_incomplete_or_failed/u);
        assert.equal(port.calls, 1);
        assert.equal(port.failures.length, 1);
        if (!transportFailure) assert.equal(port.recorded.length, 1);
    }
});

const cleanLifecycle = () => ({ runId: identity.runId, projectName: identity.projectName, hostSha256: identity.hostSha256,
    coreSha256: identity.coreSha256, stages: ['startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics'].map((name, index) => ({
        name, startedAt: new Date(Date.UTC(2026, 9, 13, 0, index)).toISOString(), endedAt: new Date(Date.UTC(2026, 9, 13, 0, index + 1)).toISOString(),
        logs: ['stdout', 'stderr', 'project.log'].map((channel) => ({ channel, reference: `raw/${channel}.log`, offsetStart: 0, offsetEnd: 0,
            capturedAt: new Date(Date.UTC(2026, 9, 13, 0, index + 1)).toISOString(), byteLength: 0,
            sha256: createHash('sha256').update('').digest('hex'), bytes: Buffer.alloc(0) })),
    })) });

test('evidence validator recomputes all rows and raw phases; caller passed flags are irrelevant', () => {
    const r = row(); const body = { session: identity, inventorySha256: 'd'.repeat(64), observations: [observation(r)], lifecycle: cleanLifecycle() };
    const checked = ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), body);
    assert.equal(checked.ok, true);
    assert.equal(checked.passed, 1);
    assert.equal(ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { ...body, observations: [] }).ok, false);
    assert.equal(ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { ...body, observations: [observation(r), observation(r)] }).ok, false);
    assert.equal(ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { ...body, lifecycle: {} }).passed, 0);
    assert.equal(ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { ...body,
        lifecycle: { ...cleanLifecycle(), runId: 'previous-native-run' } }).passed, 0);
    assert.equal(ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { ...body,
        session: { ...identity, projectPath: '/private/tmp/another-project' } }).passed, 0);
});

test('raw diagnostics and delayed warnings invalidate every claimed resource pass', () => {
    const r = row(); const lifecycle = cleanLifecycle(); const bytes = Buffer.from('Warning: delayed synthetic diagnostic\n');
    const log = lifecycle.stages[4]?.logs[2]; assert.ok(log);
    Object.assign(log, { bytes, byteLength: bytes.length, offsetEnd: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const checked = ResourceStabilityEvidenceValidator.validate(plan([r]), expectation([r]), { session: identity,
        inventorySha256: 'd'.repeat(64), observations: [observation(r)], lifecycle });
    assert.equal(checked.ok, false); assert.equal(checked.passed, 0);
});
