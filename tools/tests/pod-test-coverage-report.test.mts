import assert from 'node:assert/strict';
import test from 'node:test';

import { PodCoverageContracts } from '../pod-test-coverage/contracts.mjs';
import type { IPodCoverageEvidenceAssessment } from '../pod-test-coverage/evidence.mjs';
import type { IPodCoverageInventoryAssessment } from '../pod-test-coverage/inventory.mjs';
import type { IPodCoverageMappingAssessment } from '../pod-test-coverage/mapping.mjs';
import { PodCoverageReport } from '../pod-test-coverage/report.mjs';

/**
 * @description 报告测试只提供已核对的状态，不伪造产品通过。
 * @param reverse 改变输入排列。
 * @returns 报告所需四个轴。
 * @oopException 测试夹具仅是离线数据。
 */
const fixture = (reverse = false): Parameters<typeof PodCoverageReport.build> => {
    const cases = ['a', 'b'].map((id) => ({ id, capabilityIds: ['cap'], layer: id === 'a' ? 'unit' : 'creator-native',
        environment: 'creator-3.8.7', preconditions: [], fixtureRefs: [], commandRef: { repository: 'lite', cwdRelative: '.',
            executable: 'node', argv: [] }, expectedOutcome: '<script>|unsafe', allowedEffects: [], readback: 'independent',
        recovery: 'none', depends: [] }));
    const workflows = ['a', 'b'].map((id) => ({ id, kind: 'basic-editing', caseIds: [id],
        depends: id === 'b' ? ['a'] : [], stopCondition: 'stop', cleanupRule: 'none' }));
    const input = PodCoverageContracts.validateInput({ schemaVersion: 'pod-test-coverage-input.v1',
        candidate: { id: 'candidate', repositories: {}, environments: [], inputDigests: {} }, sources: [],
        capabilities: [{ id: 'cap', ownerRepo: 'lite', sourceId: 'source', sourceSubject: 'subject',
            applicability: 'current', unverifiedReason: null, traceRefs: [] }],
        cases: reverse ? cases.reverse() : cases, workflows: reverse ? workflows.reverse() : workflows, results: [] });
    const inventory: IPodCoverageInventoryAssessment = { sources: [], capabilities: [{ id: 'cap', sourceId: 'source',
        sourceSubject: 'subject', ownerRepo: 'lite', origin: 'curated-business' }], missingRepositories: [],
        missingSourceIds: [], complete: true };
    const mapping: IPodCoverageMappingAssessment = { mappedCapabilityIds: ['cap'], unmappedSourceCapabilities: [],
        uncoveredCapabilityIds: [], casesWithoutWorkflow: [], orderedCaseIds: ['a', 'b'], orderedWorkflowIds: ['a', 'b'], complete: true };
    const evidence: IPodCoverageEvidenceAssessment = { results: [], conflicts: [] };
    return [input, inventory, mapping, evidence];
};

test('empty results stay zero pass and input order cannot change report bytes', () => {
    const report = PodCoverageReport.build(...fixture());
    const reversed = PodCoverageReport.build(...fixture(true));
    assert.equal(PodCoverageReport.json(report), PodCoverageReport.json(reversed));
    assert.equal((report.counts as Record<string, number>).currentPassed, 0);
    assert.equal((report.counts as Record<string, number>).notRun, 2);
    assert.equal(report.acceptanceComplete, false);
    assert.equal(report.completionRate, 0);
    assert.deepEqual(Object.keys(report.byLayer as object), ['creator-native', 'unit']);
    const markdown = PodCoverageReport.markdown(report);
    assert.doesNotMatch(markdown, /<script>/u);
    assert.match(markdown, /&lt;script&gt;/u);
    assert.match(markdown, /&#124;/u);
});

test('three-axis result counts are independent and historical pass cannot satisfy workflow', () => {
    const [input, inventory, mapping] = fixture();
    const result = (id: string, caseId: string, status: 'current' | 'historical', evidenceStatus: 'verified' | 'missing') =>
        ({ id, caseId, executionOutcome: 'passed' as const, rawOutcome: 'passed', evidenceStatus,
            evidenceReason: evidenceStatus, applicability: status, applicabilityReason: status,
            synthetic: false, reused: false, conflict: false, supersededBy: null,
            countsAsCurrentPass: status === 'current' && evidenceStatus === 'verified' });
    const report = PodCoverageReport.build(input, inventory, mapping, { results: [result('old', 'b', 'historical', 'verified'),
        result('missing', 'a', 'current', 'missing')], conflicts: [] });
    const counts = report.counts as Record<string, number>;
    assert.equal(counts.resultTotal, 2);
    assert.equal(counts.historical, 1);
    assert.equal(counts.evidenceMissing, 1);
    assert.equal(counts.currentPassed, 0);
    assert.equal(counts.unverified, 1);
    assert.equal(report.acceptanceComplete, false);
});

test('CPM source completeness and public release availability are separate report fields', () => {
    const [input, inventory, mapping, evidence] = fixture();
    const source = { id: 'cpm-public', repository: 'cpm-install', kind: 'cpm-release-manifest-v2',
        completeness: 'complete' as const, reason: null, capabilities: [], liteInventory: null, liteManifest: null,
        releaseAvailable: false };
    const report = PodCoverageReport.build(input, { ...inventory, sources: [source] }, mapping, evidence);
    const sources = (report.denominator as { sources: readonly Readonly<Record<string, unknown>>[] }).sources;
    assert.equal(sources[0]?.completeness, 'complete');
    assert.equal(sources[0]?.releaseAvailable, false);
    assert.equal(report.acceptanceComplete, false);
    assert.match(PodCoverageReport.markdown(report), /cpm-public.*false/u);
});
