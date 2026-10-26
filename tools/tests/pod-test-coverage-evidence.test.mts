import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { PodCoverageContracts, type IPodCoverageInput } from '../pod-test-coverage/contracts.mjs';
import { PodCoverageEvidence } from '../pod-test-coverage/evidence.mjs';
import { PodCoverageInputReader } from '../pod-test-coverage/input-reader.mjs';

/**
 * @description 为证据轴构造仅含合成来源的候选，不执行输入命令。
 * @param caseRows 合成用例。
 * @param results 待核对结果。
 * @returns 已校验的 v1 输入。
 * @oopException 测试夹具只是 JSON 数据。
 */
const inputFor = (caseRows: Record<string, unknown>[], results: Record<string, unknown>[]): IPodCoverageInput =>
    PodCoverageContracts.validateInput({ schemaVersion: 'pod-test-coverage-input.v1',
        candidate: { id: 'candidate-1', repositories: { 'peanut-pod-lite': { commit: 'b'.repeat(40), tree: 'b'.repeat(40),
            platform: 'darwin-arm64', runtimeVersion: 'node-26.8.2', toolchain: 'tsx-4.23.0',
            artifactDigests: { core: 'd'.repeat(64) } } }, environments: ['creator-3.8.7'],
            inputDigests: { source: 'a'.repeat(64), ...Object.fromEntries(caseRows.map((row) => [`test-source:${String(row.id)}`, 'c'.repeat(64)])) } },
        sources: [{ id: 'source', repository: 'peanut-pod-lite', role: 'current-product', commit: 'b'.repeat(40),
            tree: 'b'.repeat(40), sourceRef: { rootId: 'lite', path: 'source.json', sha256: 'a'.repeat(64) },
            sha256: 'a'.repeat(64), kind: 'product-catalog', creatorVersion: '3.8.7', completeness: 'unverified' }],
        capabilities: [{ id: 'cap-1', ownerRepo: 'peanut-pod-lite', sourceId: 'source', sourceSubject: 'editor.queryVersion',
            applicability: 'creator-3.8.7', unverifiedReason: 'synthetic-only', traceRefs: [] }],
        cases: caseRows, workflows: [], results });

/**
 * @description 带独立读回要求的合成用例。
 * @param id 用例 ID。
 * @param expectedOutcome 预期业务结果。
 * @param layer 测试层。
 * @returns 用例定义。
 * @oopException 合成用例没有业务生命周期。
 */
const caseFor = (id = 'case-normal', expectedOutcome = 'success', layer = 'protocol'): Record<string, unknown> =>
    ({ id, capabilityIds: ['cap-1'], layer, environment: 'creator-3.8.7', preconditions: ['isolated fixture'],
        fixtureRefs: [], commandRef: { repository: 'peanut-pod-lite', cwdRelative: '.', executable: 'node',
            argv: ['--test', 'synthetic.test.mts'] }, expectedOutcome, allowedEffects: [],
        readback: `independent-${id}`, recovery: 'remove fixture', depends: [] });

/**
 * @description 生成完整执行绑定，用于单字段漂移回归。
 * @param caseRow 绑定的用例。
 * @param overrides 待替换字段。
 * @returns 有界绑定。
 * @oopException 纯测试值。
 */
const bindingFor = (caseRow: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> =>
    ({ candidateId: 'candidate-1', repository: 'peanut-pod-lite', commit: 'b'.repeat(40), tree: 'b'.repeat(40),
        environment: 'creator-3.8.7', platform: 'darwin-arm64', runtimeVersion: 'node-26.8.2', creatorVersion: '3.8.7',
        artifactDigests: { core: 'd'.repeat(64) }, relatedInputDigests: { source: 'a'.repeat(64),
            [`test-source:${String(caseRow.id)}`]: 'c'.repeat(64) }, fixtureDigests: {},
        commandDigest: CoverageManifestGenerator.digest(caseRow.commandRef), testSourceDigest: 'c'.repeat(64),
        toolchain: 'tsx-4.23.0', executionKind: 'synthetic', supersedes: null, reuseProof: null, ...overrides });

/**
 * @description 创建与结果绑定的合成原始证明和引用。
 * @param root 临时证据目录。
 * @param id 结果 ID。
 * @param caseRow 用例。
 * @param binding 执行绑定。
 * @param outcome 结果状态。
 * @param proofOverrides 伪造或复用字段。
 * @returns 原始结果记录。
 * @oopException 临时证据文件只属于当前测试。
 */
const resultFor = (root: string, id: string, caseRow: Record<string, unknown>, binding: Record<string, unknown>,
    outcome = 'passed', proofOverrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const proof = { schemaVersion: 'pod-synthetic-proof.v1', caseId: caseRow.id, outcome,
        commandDigest: binding.commandDigest, readback: caseRow.readback, relatedInputDigests: binding.relatedInputDigests,
        reuseProof: binding.reuseProof, ...proofOverrides };
    const bytes = Buffer.from(JSON.stringify(proof));
    writeFileSync(join(root, `${id}.json`), bytes);
    return { id, caseId: caseRow.id, executionOutcome: outcome, binding,
        evidenceRefs: [{ rootId: 'evidence', path: `${id}.json`, sha256: PodCoverageContracts.sha256(bytes) }],
        validatorId: 'pod-synthetic-proof.v1', completedAt: '2026-10-26T00:00:00.000Z', diagnosticRef: null };
};

test('passed marker, missing raw evidence and unknown validator never become current product passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-missing-'));
    try {
        const row = caseFor();
        const binding = bindingFor(row);
        const valid = resultFor(root, 'result-valid', row, binding);
        const missing = { ...valid, id: 'result-missing', evidenceRefs: [] };
        const unknown = { ...valid, id: 'result-unknown', validatorId: 'untrusted-native-claim' };
        const reader = new PodCoverageInputReader([{ id: 'evidence', path: root }]);
        const assessed = PodCoverageEvidence.assess(inputFor([row], [valid, missing, unknown]), reader);
        assert.deepEqual(assessed.results.map((result) => result.evidenceStatus), ['verified', 'missing', 'unverified']);
        assert.deepEqual(assessed.results.map((result) => result.countsAsCurrentPass), [false, false, false]);
        assert.equal(assessed.results[0]?.synthetic, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('forged readback and unavailable evidence are invalid or missing independently of passed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-forged-'));
    try {
        const row = caseFor();
        const binding = bindingFor(row);
        const forged = resultFor(root, 'forged', row, binding, 'passed', { readback: 'fabricated' });
        const absent = { ...forged, id: 'absent', evidenceRefs: [{ rootId: 'unmounted', path: 'proof.json', sha256: '0'.repeat(64) }] };
        const assessed = PodCoverageEvidence.assess(inputFor([row], [forged, absent]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.deepEqual(assessed.results.map((result) => result.evidenceStatus), ['invalid', 'missing']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('candidate, Creator, environment, artifact and related input drift stay historical', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-drift-'));
    try {
        const row = caseFor('native', 'success', 'creator-native');
        const variations = [
            { candidateId: 'old-candidate' }, { creatorVersion: '3.8.3' }, { environment: 'creator-3.8.3' },
            { artifactDigests: { core: 'e'.repeat(64) } }, { relatedInputDigests: { source: 'e'.repeat(64) } },
        ];
        for (const [index, variation] of variations.entries()) {
            const binding = bindingFor(row, variation);
            const result = resultFor(root, `drift-${index}`, row, binding);
            const assessed = PodCoverageEvidence.assess(inputFor([row], [result]),
                new PodCoverageInputReader([{ id: 'evidence', path: root }]));
            assert.equal(assessed.results[0]?.applicability, 'historical');
            assert.equal(assessed.results[0]?.countsAsCurrentPass, false);
        }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('synthetic document-only commit reuse requires matching related inputs and original proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-reuse-'));
    try {
        const row = caseFor();
        const reuseProof = { kind: 'synthetic-document-only', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40),
            changedPaths: ['docs/testing.md'] };
        const binding = bindingFor(row, { commit: 'a'.repeat(40), tree: 'a'.repeat(40), reuseProof });
        const result = resultFor(root, 'reuse', row, binding);
        let assessed = PodCoverageEvidence.assess(inputFor([row], [result]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.equal(assessed.results[0]?.applicability, 'current');
        assert.equal(assessed.results[0]?.reused, true);
        assert.equal(assessed.results[0]?.countsAsCurrentPass, false);
        const forged = resultFor(root, 'wrong-proof', row, binding, 'passed',
            { reuseProof: { ...reuseProof, changedPaths: ['src/engine.ts'] } });
        assessed = PodCoverageEvidence.assess(inputFor([row], [forged]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.equal(assessed.results[0]?.applicability, 'historical');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('substitute cannot upgrade native coverage; blocked, skipped and not-applicable stay separate', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-states-'));
    try {
        const native = caseFor('native', 'success', 'creator-native');
        const binding = bindingFor(native, { executionKind: 'substitute' });
        const substitute = resultFor(root, 'substitute', native, binding);
        const blocked = { ...resultFor(root, 'blocked', native, binding, 'blocked'), evidenceRefs: [] };
        const skipped = { ...resultFor(root, 'skipped', native, binding), executionOutcome: 'skipped', evidenceRefs: [] };
        const notApplicable = resultFor(root, 'not-applicable', native, binding, 'not_applicable');
        const assessed = PodCoverageEvidence.assess(inputFor([native], [substitute, blocked, skipped, notApplicable]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.equal(assessed.results[0]?.applicability, 'unknown');
        assert.deepEqual(assessed.results.map((result) => result.executionOutcome),
            ['passed', 'blocked', 'not_run', 'not_applicable']);
        assert.deepEqual(assessed.results.map((result) => result.rawOutcome),
            ['passed', 'blocked', 'skipped', 'not_applicable']);
        assert.equal(assessed.results[3]?.applicability, 'unknown');
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('normal success and expected rejection remain distinct cases; unsuperseded conflicts are visible', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-evidence-conflict-'));
    try {
        const normal = caseFor('normal', 'success');
        const rejection = caseFor('reject', 'rejected');
        const good = resultFor(root, 'good', normal, bindingFor(normal));
        const bad = resultFor(root, 'bad', normal, bindingFor(normal), 'failed');
        const rejected = resultFor(root, 'rejected', rejection, bindingFor(rejection));
        let assessed = PodCoverageEvidence.assess(inputFor([normal, rejection], [good, bad, rejected]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.deepEqual(assessed.conflicts, ['bad', 'good']);
        assert.equal(assessed.results[2]?.caseId, 'reject');
        assert.equal(assessed.results[2]?.conflict, false);
        const later = { ...resultFor(root, 'later', normal, bindingFor(normal, { supersedes: 'good' }), 'failed'),
            completedAt: '2026-10-26T00:01:00.000Z' };
        assert.throws(() => PodCoverageEvidence.assess(inputFor([normal], [good,
            { ...later, completedAt: '2026-10-25T23:59:00.000Z' }]),
        new PodCoverageInputReader([{ id: 'evidence', path: root }])), /result_supersedes_invalid/u);
        assessed = PodCoverageEvidence.assess(inputFor([normal, rejection], [good, later, rejected]),
            new PodCoverageInputReader([{ id: 'evidence', path: root }]));
        assert.deepEqual(assessed.conflicts, []);
        assert.equal(assessed.results[0]?.supersededBy, 'later');
        assert.equal(assessed.results[1]?.executionOutcome, 'failed');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
