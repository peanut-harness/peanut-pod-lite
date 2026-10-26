import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { PodCoverageContracts, type IPodCoverageInput } from '../pod-test-coverage/contracts.mjs';
import { PodCoverageInputReader } from '../pod-test-coverage/input-reader.mjs';
import { PodCoverageInventory } from '../pod-test-coverage/inventory.mjs';
import { PodCoverageMapping } from '../pod-test-coverage/mapping.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * @description 建立仅用于验证映射的合成来源输入。
 * @param source 单个来源。
 * @param capabilities 显式策展能力。
 * @param cases 显式测试定义。
 * @param workflows 显式主线。
 * @returns 不带执行结果的输入。
 * @oopException 合成夹具无独立生命周期。
 */
const inputFor = (source: Record<string, unknown>, capabilities: Record<string, unknown>[] = [],
    cases: Record<string, unknown>[] = [], workflows: Record<string, unknown>[] = []): IPodCoverageInput =>
    PodCoverageContracts.validateInput({ schemaVersion: 'pod-test-coverage-input.v1',
        candidate: { id: 'candidate-1', repositories: { [String(source.repository)]: { commit: source.commit, tree: source.tree } },
            environments: [`creator-${String(source.creatorVersion)}`], inputDigests: { [String(source.id)]: source.sha256 } },
        sources: [source], capabilities, cases, workflows, results: [] });

/**
 * @description 为当前临时根构造内容绑定的单个来源。
 * @param kind 固定来源类型。
 * @param path 根内相对路径。
 * @param bytes 原始文件字节。
 * @param repository 责任仓库。
 * @returns v1 来源记录。
 * @oopException 纯 JSON 测试值不承载业务状态。
 */
const sourceFor = (kind: string, path: string, bytes: Uint8Array, repository = 'peanut-pod-pro'): Record<string, unknown> => {
    const sha256 = PodCoverageContracts.sha256(bytes);
    return { id: `source-${kind}`, repository, role: 'current-product', commit: 'a'.repeat(40), tree: 'b'.repeat(40),
        sourceRef: { rootId: repository, path, sha256 }, sha256, kind, creatorVersion: '3.8.7', completeness: 'complete' };
};

/**
 * @description 构造具备独立读回判据的合成用例。
 * @param id 用例标识。
 * @param capabilityId 能力标识。
 * @param depends 显式前置用例。
 * @returns 不会被工具执行的命令描述。
 * @oopException 用例夹具仅用于结构校验。
 */
const caseFor = (id: string, capabilityId: string, depends: string[] = []): Record<string, unknown> =>
    ({ id, capabilityIds: [capabilityId], layer: 'protocol', environment: 'creator-3.8.7',
        preconditions: ['isolated fixture'], fixtureRefs: [], commandRef: { repository: 'peanut-pod-pro',
            cwdRelative: '.', executable: 'node', argv: ['--test', 'example.test.mts'] },
        expectedOutcome: 'successful query', allowedEffects: [], readback: 'independent output', recovery: 'remove fixture', depends });

test('both Lite drafts preserve every target/action and native unresolved set without inferring passes', () => {
    for (const version of ['3.8.3', '3.8.7']) {
        const path = `tests/fixtures/editor-stability/coverage/creator-${version}-draft.json`;
        const bytes = readFileSync(join(repositoryRoot, path));
        const lite = PodCoverageInventory.readLiteDraft(bytes);
        const source = { ...sourceFor('lite-coverage-draft', path, bytes, 'peanut-pod-lite'), creatorVersion: version };
        const input = inputFor(source);
        const reader = new PodCoverageInputReader([{ id: 'peanut-pod-lite', path: repositoryRoot }]);
        const inventory = PodCoverageInventory.inspect(input, reader);
        const assessment = PodCoverageMapping.assess(input, inventory);
        assert.equal(inventory.complete, true);
        assert.equal(inventory.capabilities.length, lite.manifest.cases.length);
        assert.deepEqual(inventory.sources[0]?.liteInventory?.targets, lite.inventory.targets);
        assert.deepEqual(inventory.sources[0]?.liteInventory?.nativeRegistrationAlternatives, lite.inventory.nativeRegistrationAlternatives);
        assert.deepEqual(inventory.sources[0]?.liteInventory?.nativeUnresolvedRegistrations, lite.inventory.nativeUnresolvedRegistrations);
        assert.deepEqual(inventory.sources[0]?.liteManifest, lite.manifest);
        assert.equal(assessment.unmappedSourceCapabilities.length, lite.manifest.cases.length);
        assert.equal(assessment.complete, false);
    }
});

test('candidate test-source digest binds evidence without becoming a missing inventory source', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-test-source-'));
    try {
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, operationCount: 1, operations: ['asset.queryInfo'] }));
        writeFileSync(join(root, 'catalog.json'), bytes);
        const source = sourceFor('pro-core-catalog', 'catalog.json', bytes);
        const input = inputFor(source);
        const candidate = { ...input.candidate,
            inputDigests: { [String(source.id)]: source.sha256, 'test-source:case-1': 'c'.repeat(64) } };
        const inventory = PodCoverageInventory.inspect({ ...input, candidate },
            new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]));
        assert.equal(inventory.complete, true);
        assert.deepEqual(inventory.missingSourceIds, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Lite draft rejects a missing action even if its inventory still contains the target', () => {
    const bytes = readFileSync(join(repositoryRoot, 'tests/fixtures/editor-stability/coverage/creator-3.8.7-draft.json'));
    const draft = JSON.parse(bytes.toString('utf8'));
    draft.manifest.cases.pop();
    assert.throws(() => PodCoverageInventory.readLiteDraft(Buffer.from(JSON.stringify(draft))), /lite_draft_manifest_mismatch/u);
});

test('new Pro catalog operation enters the independent denominator as unmapped', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-catalog-'));
    try {
        const catalog = { schemaVersion: 1, operationCount: 1, operations: ['uiPrefab.generate'] };
        const path = 'premium.json';
        writeFileSync(join(root, path), JSON.stringify(catalog));
        const reader = new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]);
        let bytes = readFileSync(join(root, path));
        let source = sourceFor('pro-premium-catalog', path, bytes);
        let inventory = PodCoverageInventory.inspect(inputFor(source), reader);
        assert.deepEqual(inventory.capabilities.map((item) => item.sourceSubject), ['uiPrefab.generate']);
        catalog.operations.push('uiPrefab.importDesign');
        catalog.operationCount = 2;
        writeFileSync(join(root, path), JSON.stringify(catalog));
        bytes = readFileSync(join(root, path));
        source = sourceFor('pro-premium-catalog', path, bytes);
        inventory = PodCoverageInventory.inspect(inputFor(source), new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]));
        const mapping = PodCoverageMapping.assess(inputFor(source), inventory);
        assert.deepEqual(mapping.unmappedSourceCapabilities.map((item) => item.sourceSubject),
            ['uiPrefab.generate', 'uiPrefab.importDesign']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing source root remains incomplete, while source byte drift and declared digest drift fail', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-source-'));
    try {
        const path = 'catalog.json';
        writeFileSync(join(root, path), JSON.stringify({ schemaVersion: 1, operationCount: 1, operations: ['asset.queryInfo'] }));
        const bytes = readFileSync(join(root, path));
        const source = sourceFor('pro-core-catalog', path, bytes);
        const input = inputFor(source);
        const missing = PodCoverageInventory.inspect(input, new PodCoverageInputReader([]));
        assert.equal(missing.complete, false);
        assert.equal(missing.sources[0]?.reason, 'source_root_missing');
        writeFileSync(join(root, path), Buffer.from('changed'));
        assert.throws(() => PodCoverageInventory.inspect(input,
            new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }])), /reference_content_changed/u);
        writeFileSync(join(root, path), bytes);
        const changedCandidate = { ...input, candidate: { ...input.candidate, inputDigests: { [String(source.id)]: '0'.repeat(64) } } };
        assert.throws(() => PodCoverageInventory.inspect(changedCandidate,
            new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }])), /candidate_source_digest_changed/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Pro plugin panel and fixed Lite descriptor are distinct source entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-plugin-'));
    try {
        const manifest = Buffer.from(JSON.stringify({ id: 'peanut.ui-prefab', version: '0.1.0',
            contributions: { panels: [{ id: 'peanut.ui-prefab.panel' }] } }));
        writeFileSync(join(root, 'plugin.json'), manifest);
        const source = sourceFor('pro-plugin-manifest', 'plugin.json', manifest);
        const inspected = PodCoverageInventory.inspect(inputFor(source),
            new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]));
        assert.deepEqual(inspected.capabilities.map((item) => item.sourceSubject),
            ['plugin:peanut.ui-prefab', 'panel:peanut.ui-prefab.panel']);
        const descriptor = Buffer.from(JSON.stringify({ productId: 'peanut.editor-mcp', version: '0.2.0' }));
        writeFileSync(join(root, 'lite.json'), descriptor);
        const fixed = { ...sourceFor('pro-fixed-lite', 'lite.json', descriptor, 'peanut-pod-lite'), role: 'fixed-dependency' };
        const fixedAssessment = PodCoverageInventory.inspect(inputFor(fixed),
            new PodCoverageInputReader([{ id: 'peanut-pod-lite', path: root }]));
        assert.deepEqual(fixedAssessment.capabilities.map((item) => item.sourceSubject),
            ['fixed-lite:peanut.editor-mcp:0.2.0']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Server reviewed routes require original implementation bytes; CPM scoped package keeps bootstrap entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-review-'));
    try {
        const implementation = Buffer.from('export const route = true;');
        writeFileSync(join(root, 'route.ts'), implementation);
        const review = Buffer.from(JSON.stringify({ schemaVersion: 'pod-server-review.v1', reviewer: 'synthetic-reviewer',
            limitations: ['synthetic fixture'], routes: [{ id: 'offer', method: 'GET', path: '/offer',
                implementationRefs: [{ rootId: 'peanut-pod-server', path: 'route.ts', sha256: PodCoverageContracts.sha256(implementation) }] }] }));
        writeFileSync(join(root, 'review.json'), review);
        const source = sourceFor('server-reviewed-routes', 'review.json', review, 'peanut-pod-server');
        let inventory = PodCoverageInventory.inspect(inputFor(source),
            new PodCoverageInputReader([{ id: 'peanut-pod-server', path: root }]));
        assert.deepEqual(inventory.capabilities.map((item) => item.sourceSubject), ['route:offer']);
        writeFileSync(join(root, 'route.ts'), 'changed');
        assert.throws(() => PodCoverageInventory.inspect(inputFor(source),
            new PodCoverageInputReader([{ id: 'peanut-pod-server', path: root }])), /reference_content_changed/u);
        const cpm = Buffer.from(JSON.stringify({ name: '@peanut/cpm', version: '0.1.0', scripts: { bootstrap: 'node bootstrap.mjs' } }));
        writeFileSync(join(root, 'package.json'), cpm);
        const cpmSource = sourceFor('cpm-package', 'package.json', cpm, 'peanut-cpm');
        inventory = PodCoverageInventory.inspect(inputFor(cpmSource),
            new PodCoverageInputReader([{ id: 'peanut-cpm', path: root }]));
        assert.deepEqual(inventory.capabilities.map((item) => item.sourceSubject),
            ['package:@peanut/cpm', 'script:@peanut/cpm:bootstrap']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('public CPM schema v2 empty stable manifest is readable but has no available release', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-cpm-empty-'));
    try {
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, channel: 'stable', publicKey: null, releases: [] }));
        writeFileSync(join(root, 'releases.json'), bytes);
        const source = sourceFor('cpm-release-manifest-v2', 'releases.json', bytes, 'cpm-install');
        const input = inputFor(source);
        const assessment = PodCoverageInventory.inspect(input, new PodCoverageInputReader([{ id: 'cpm-install', path: root }]));
        assert.equal(assessment.complete, true);
        assert.equal(assessment.sources[0]?.releaseAvailable, false);
        assert.deepEqual(assessment.capabilities.map((row) => row.sourceSubject),
            ['channel:stable:public-release-unavailable-or-unverified']);
        assert.equal(PodCoverageMapping.assess(input, assessment).complete, false);
        assert.equal(PodCoverageInventory.inspect(input, new PodCoverageInputReader([])).sources[0]?.completeness, 'missing');
        writeFileSync(join(root, 'releases.json'), '{}');
        assert.throws(() => PodCoverageInventory.inspect(input, new PodCoverageInputReader([{ id: 'cpm-install', path: root }])),
            /reference_content_changed/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('nonempty CPM release stays unverified and malformed manifests fail closed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-cpm-release-'));
    try {
        const release = { id: 'peanut.cpm', version: '1.0.0', channel: 'stable', url: 'https://example.test/cpm.tgz',
            sha256: 'a'.repeat(64), signature: 'untrusted-signature' };
        const manifest = { schemaVersion: 2, channel: 'stable',
            publicKey: { keyId: 'untrusted', algorithm: 'ed25519', format: 'spki-der-base64', value: 'untrusted-key' },
            releases: [release] };
        const inspect = (value: unknown) => {
            const bytes = Buffer.from(JSON.stringify(value));
            writeFileSync(join(root, 'releases.json'), bytes);
            const source = sourceFor('cpm-release-manifest-v2', 'releases.json', bytes, 'cpm-install');
            return PodCoverageInventory.inspect(inputFor(source), new PodCoverageInputReader([{ id: 'cpm-install', path: root }]));
        };
        const assessment = inspect(manifest);
        assert.equal(assessment.complete, false);
        assert.equal(assessment.sources[0]?.completeness, 'unverified');
        assert.equal(assessment.sources[0]?.reason, 'cpm_release_signature_and_install_unverified');
        assert.equal(assessment.sources[0]?.releaseAvailable, null);
        assert.equal(assessment.capabilities.length, 2);
        for (const invalid of [{ ...manifest, schemaVersion: 3 }, { ...manifest, channel: 'unknown' },
            { ...manifest, unexpected: true }, { ...manifest, releases: [release, release] },
            { ...manifest, releases: [{ ...release, url: 'http://example.test/cpm.tgz' }] },
            { ...manifest, releases: [{ ...release, url: 'https://example.test/cpm.tgz#fragment' }] }]) {
            assert.throws(() => inspect(invalid), /pod_coverage_cpm_/u);
        }
        const source = sourceFor('cpm-release-manifest-v2', 'releases.json', Buffer.from('{}'), 'cpm-install');
        assert.throws(() => PodCoverageContracts.validateInput({ ...inputFor(source),
            sources: [{ ...source, sourceRef: { ...source.sourceRef as Record<string, unknown>, path: '../escape' } }] }),
        /reference_path_invalid/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mapping rejects unknown capability and dangling or cyclic case/workflow dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-mapping-'));
    try {
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, operationCount: 1, operations: ['asset.queryInfo'] }));
        writeFileSync(join(root, 'catalog.json'), bytes);
        const source = sourceFor('pro-core-catalog', 'catalog.json', bytes);
        const capability = { id: 'cap-query', ownerRepo: 'peanut-pod-pro', sourceId: source.id,
            sourceSubject: 'asset.queryInfo', applicability: 'creator-3.8.7', unverifiedReason: 'synthetic-only', traceRefs: [] };
        const reader = new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]);
        const inventory = PodCoverageInventory.inspect(inputFor(source, [capability]), reader);
        assert.throws(() => PodCoverageMapping.assess(inputFor(source, [capability], [caseFor('case-1', 'missing')]), inventory),
            /case_capability_unknown/u);
        assert.throws(() => PodCoverageMapping.assess(inputFor(source, [capability], [caseFor('case-1', 'cap-query', ['absent'])]), inventory),
            /case_dependency_missing/u);
        const cyclic = [caseFor('case-1', 'cap-query', ['case-2']), caseFor('case-2', 'cap-query', ['case-1'])];
        assert.throws(() => PodCoverageMapping.assess(inputFor(source, [capability], cyclic), inventory), /case_dependency_cycle/u);
        const workflow = (id: string, depends: string[]): Record<string, unknown> =>
            ({ id, kind: 'basic-editing', caseIds: ['case-1'], depends, stopCondition: 'stop on failure', cleanupRule: 'remove fixture' });
        assert.throws(() => PodCoverageMapping.assess(inputFor(source, [capability], [caseFor('case-1', 'cap-query')],
            [workflow('flow-1', ['flow-2']), workflow('flow-2', ['flow-1'])]), inventory), /workflow_dependency_cycle/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('mapping keeps a command-only case unexecuted and rejects absent independent readback', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-command-'));
    try {
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, operationCount: 1, operations: ['asset.queryInfo'] }));
        writeFileSync(join(root, 'catalog.json'), bytes);
        const source = sourceFor('pro-core-catalog', 'catalog.json', bytes);
        const capability = { id: 'cap-query', ownerRepo: 'peanut-pod-pro', sourceId: source.id,
            sourceSubject: 'asset.queryInfo', applicability: 'creator-3.8.7', unverifiedReason: 'synthetic-only', traceRefs: [] };
        const reader = new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]);
        const inventory = PodCoverageInventory.inspect(inputFor(source, [capability]), reader);
        const noCase = PodCoverageMapping.assess(inputFor(source, [capability]), inventory);
        assert.deepEqual(noCase.uncoveredCapabilityIds, ['cap-query']);
        assert.equal(noCase.complete, false);
        const row = caseFor('case-1', 'cap-query');
        const workflow = { id: 'flow-1', kind: 'basic-editing', caseIds: ['case-1'], depends: [],
            stopCondition: 'stop on failure', cleanupRule: 'remove fixture' };
        const input = inputFor(source, [capability], [row], [workflow]);
        const mapping = PodCoverageMapping.assess(input, inventory);
        assert.equal(mapping.complete, false);
        assert.deepEqual(mapping.uncoveredCapabilityIds, []);
        assert.deepEqual(mapping.orderedCaseIds, ['case-1']);
        assert.deepEqual(input.results, []);
        assert.throws(() => PodCoverageMapping.assess(inputFor(source, [capability], [{ ...row, readback: '' }], [workflow]), inventory),
            /case_readback_invalid/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('repository absent from declared sources prevents a complete denominator', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-missing-repo-'));
    try {
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, operationCount: 1, operations: ['asset.queryInfo'] }));
        writeFileSync(join(root, 'catalog.json'), bytes);
        const source = sourceFor('pro-core-catalog', 'catalog.json', bytes);
        const input = inputFor(source);
        const candidate = { ...input.candidate,
            repositories: { ...PodCoverageContracts.record(input.candidate.repositories, null, 'repositories'),
                'peanut-pod-server': { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } },
            inputDigests: { ...PodCoverageContracts.record(input.candidate.inputDigests, null, 'digests'),
                'expected-server-review': '0'.repeat(64) } };
        const modified = { ...input, candidate };
        const inventory = PodCoverageInventory.inspect(modified,
            new PodCoverageInputReader([{ id: 'peanut-pod-pro', path: root }]));
        assert.deepEqual(inventory.missingRepositories, ['peanut-pod-server']);
        assert.deepEqual(inventory.missingSourceIds, ['expected-server-review']);
        assert.equal(inventory.complete, false);
        assert.equal(CoverageManifestGenerator.digest(inventory.capabilities).length, 64);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
