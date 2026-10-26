import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { PodCoverageContracts } from '../pod-test-coverage/contracts.mjs';

const cli = resolve(import.meta.dirname, '../pod-test-coverage/cli.mts');

/**
 * @description 建立六主线最小合成目录与未执行输入。
 * @param root 测试专用目录。
 * @returns 输入路径及源根路径。
 * @oopException 临时夹具由测试生命周期清理。
 */
const createInput = (root: string, withSynthetic = false): { input: string; source: string } => {
    const source = join(root, 'catalog.json');
    const sourceBytes = Buffer.from(JSON.stringify({ schemaVersion: 'pod-business-capabilities.v1',
        capabilities: [{ id: 'subject' }] }));
    writeFileSync(source, sourceBytes);
    const digest = PodCoverageContracts.sha256(sourceBytes);
    const kinds = ['installation', 'basic-editing', 'design-to-project', 'font-content', 'account-permission', 'continuity'];
    const caseRow = { id: 'case-1', capabilityIds: ['cap'], layer: 'protocol', environment: 'creator-3.8.7',
        preconditions: [], fixtureRefs: [], commandRef: { repository: 'lite', cwdRelative: '.', executable: 'node', argv: ['--test'] },
        expectedOutcome: 'read-only success', allowedEffects: [], readback: 'independent', recovery: 'none', depends: [] };
    const input = join(root, 'input.json');
    const testSourceDigest = 'c'.repeat(64);
    const relatedInputDigests = { source: digest, 'test-source:case-1': testSourceDigest };
    const binding = { candidateId: 'candidate', repository: 'lite', commit: 'a'.repeat(40), tree: 'b'.repeat(40),
        environment: 'creator-3.8.7', platform: 'test-platform', runtimeVersion: 'node-test', creatorVersion: '3.8.7',
        artifactDigests: {}, relatedInputDigests, fixtureDigests: {},
        commandDigest: CoverageManifestGenerator.digest(caseRow.commandRef), testSourceDigest,
        toolchain: 'tsx-test', executionKind: 'synthetic', supersedes: null, reuseProof: null };
    const proof = Buffer.from(JSON.stringify({ schemaVersion: 'pod-synthetic-proof.v1', caseId: 'case-1',
        outcome: 'passed', commandDigest: binding.commandDigest, readback: caseRow.readback,
        relatedInputDigests, reuseProof: null }));
    if (withSynthetic) writeFileSync(join(root, 'proof.json'), proof);
    const results = withSynthetic ? [{ id: 'synthetic-1', caseId: 'case-1', executionOutcome: 'passed', binding,
        evidenceRefs: [{ rootId: 'evidence', path: 'proof.json', sha256: PodCoverageContracts.sha256(proof) }],
        validatorId: 'pod-synthetic-proof.v1', completedAt: '2026-10-26T00:00:00.000Z', diagnosticRef: null }] : [];
    writeFileSync(input, JSON.stringify({ schemaVersion: 'pod-test-coverage-input.v1',
        candidate: { id: 'candidate', repositories: { lite: { commit: 'a'.repeat(40), tree: 'b'.repeat(40),
            platform: 'test-platform', runtimeVersion: 'node-test', toolchain: 'tsx-test', artifactDigests: {} } },
            environments: ['creator-3.8.7'], inputDigests: { source: digest, 'test-source:case-1': testSourceDigest } },
        sources: [{ id: 'source', repository: 'lite', role: 'current-product', commit: 'a'.repeat(40), tree: 'b'.repeat(40),
            sourceRef: { rootId: 'lite', path: 'catalog.json', sha256: digest }, sha256: digest,
            kind: 'curated-business', creatorVersion: '3.8.7', completeness: 'complete' }],
        capabilities: [{ id: 'cap', ownerRepo: 'lite', sourceId: 'source', sourceSubject: 'subject',
            applicability: 'creator-3.8.7', unverifiedReason: null, traceRefs: [] }],
        cases: [caseRow], workflows: kinds.map((kind) => ({ id: kind, kind, caseIds: ['case-1'], depends: [],
            stopCondition: 'stop', cleanupRule: 'conservative' })), results }));
    return { input, source };
};

/**
 * @description 在子进程中验证 CLI 的真实退出码与文件副作用。
 * @param args 参数。
 * @returns 命令状态与输出。
 * @oopException 子进程只执行本仓库固定 CLI，输入命令始终作为数据。
 */
const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8' });

test('validate and report accept incomplete cases while acceptance exits two', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-report-cli-'));
    try {
        const { input, source } = createInput(root);
        const before = [readFileSync(input), readFileSync(source)];
        const args = ['--input', input, '--source-root', `lite=${root}`];
        assert.equal(run(['validate', ...args]).status, 0);
        assert.equal(run(['check-acceptance', ...args, '--workflow', 'installation']).status, 2);
        const output = join(tmpdir(), `pod-report-output-${process.pid}-${Date.now()}`);
        try {
            const report = run(['report', ...args, '--out', output]);
            assert.equal(report.status, 0, report.stderr);
            assert.equal(JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')).acceptanceComplete, false);
            assert.equal(run(['report', ...args, '--out', output]).status, 1);
        } finally { rmSync(output, { recursive: true, force: true }); }
        assert.deepEqual([readFileSync(input), readFileSync(source)], before);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bad options and output inside a source root fail without writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-report-cli-bad-'));
    try {
        const { input } = createInput(root);
        const output = join(root, 'report-output');
        assert.equal(run(['report', '--input', input, '--source-root', `lite=${root}`, '--out', output]).status, 1);
        assert.equal(existsSync(output), false);
        assert.equal(run(['validate', '--input', input, '--bogus', 'value']).status, 1);
        assert.equal(run(['check-acceptance', '--input', input, '--source-root', `lite=${root}`,
            '--workflow', 'unknown']).status, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('full synthetic exercise exits zero without entering product pass counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-report-cli-synthetic-'));
    try {
        const { input } = createInput(root, true);
        const args = ['--input', input, '--source-root', `lite=${root}`, '--evidence-root', `evidence=${root}`,
            '--workflow', 'installation'];
        const product = run(['check-acceptance', ...args]);
        assert.equal(product.status, 2, product.stderr);
        const exercise = run(['check-acceptance', ...args, '--synthetic-check']);
        assert.equal(exercise.status, 0, `${exercise.stderr}\n${exercise.stdout}`);
        assert.equal(JSON.parse(exercise.stdout).acceptanceComplete, false);
        assert.equal(JSON.parse(exercise.stdout).syntheticExerciseComplete, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
