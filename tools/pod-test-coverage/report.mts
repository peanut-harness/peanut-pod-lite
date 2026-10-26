import { PodCoverageContracts, type IPodCoverageInput } from './contracts.mjs';
import type { IPodCoverageEvidenceAssessment, IPodCoverageResultAssessment } from './evidence.mjs';
import type { IPodCoverageInventoryAssessment } from './inventory.mjs';
import type { IPodCoverageMappingAssessment } from './mapping.mjs';

/**
 * @description 稳定、可重算的离线覆盖报告；三个结果轴分别计数。
 */
export class PodCoverageReport {
    /**
     * @description 将来源、映射与结果合成为不含运行时字段的报告。
     * @param input 已校验的输入。
     * @param inventory 独立来源分母。
     * @param mapping 显式映射。
     * @param evidence 证据三轴。
     * @returns 稳定报告对象。
     */
    public static build(input: IPodCoverageInput, inventory: IPodCoverageInventoryAssessment,
        mapping: IPodCoverageMappingAssessment, evidence: IPodCoverageEvidenceAssessment): Readonly<Record<string, unknown>> {
        const sorted = <T extends { readonly id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id, 'en'));
        const results = sorted(evidence.results);
        const cases = sorted(input.cases.map((row) => ({ ...row, id: PodCoverageContracts.identifier(row.id) })) as
            (Readonly<Record<string, unknown>> & { readonly id: string })[]);
        const latest = (caseId: string): IPodCoverageResultAssessment[] => results.filter((row) => row.caseId === caseId
            && row.applicability === 'current' && row.supersededBy === null);
        const currentCase = (caseId: string): string => {
            const rows = latest(caseId);
            if (rows.some((row) => row.conflict)) return 'conflict';
            if (rows.some((row) => row.countsAsCurrentPass)) return 'passed';
            if (rows.some((row) => row.executionOutcome === 'failed')) return 'failed';
            if (rows.some((row) => row.executionOutcome === 'blocked')) return 'blocked';
            if (rows.some((row) => row.executionOutcome === 'not_applicable')) return 'not_applicable';
            if (rows.some((row) => row.executionOutcome === 'passed')) return 'unverified';
            return 'not_run';
        };
        const caseRows = cases.map((row) => ({ id: row.id, layer: String(row.layer), environment: String(row.environment),
            expectedOutcome: String(row.expectedOutcome), capabilityIds: [...PodCoverageContracts.stringArray(row.capabilityIds, 'case_capabilities')].sort(),
            status: currentCase(row.id) }));
        const summaries = (rows: readonly { readonly status: string }[]) => ({ total: rows.length,
            applicable: rows.filter((row) => row.status !== 'not_applicable').length,
            notApplicable: rows.filter((row) => row.status === 'not_applicable').length,
            currentPassed: rows.filter((row) => row.status === 'passed').length,
            currentFailed: rows.filter((row) => row.status === 'failed').length,
            blocked: rows.filter((row) => row.status === 'blocked').length,
            notRun: rows.filter((row) => row.status === 'not_run').length,
            unverified: rows.filter((row) => row.status === 'unverified').length,
            conflict: rows.filter((row) => row.status === 'conflict').length });
        const breakdown = (field: 'layer' | 'environment'): Readonly<Record<string, unknown>> => Object.fromEntries(
            [...new Set(caseRows.map((row) => row[field]))].sort().map((key) => [key, summaries(caseRows.filter((row) => row[field] === key))]));
        const syntheticCase = (caseId: string): boolean => {
            const rows = latest(caseId);
            return rows.length > 0 && rows.some((row) => row.synthetic && row.executionOutcome === 'passed'
                && row.evidenceStatus === 'verified' && !row.conflict);
        };
        const workflows = sorted(input.workflows.map((row) => ({ ...row, id: PodCoverageContracts.identifier(row.id) })) as
            (Readonly<Record<string, unknown>> & { readonly id: string })[])
            .map((row) => {
                const caseIds = [...PodCoverageContracts.stringArray(row.caseIds, 'workflow_cases')].sort();
                const caseStatuses = caseIds.map((id) => ({ id, status: currentCase(id) }));
                return { id: row.id, kind: String(row.kind), caseIds, depends: [...PodCoverageContracts.stringArray(row.depends, 'workflow_dependencies')].sort(),
                    summary: summaries(caseStatuses), complete: inventory.complete && mapping.complete && caseStatuses.length > 0
                        && caseStatuses.every((item) => item.status === 'passed'),
                    syntheticExerciseComplete: inventory.complete && mapping.complete && caseIds.length > 0
                        && caseIds.every(syntheticCase) };
            });
        const workflowStatus = new Map(workflows.map((row) => [row.id, row]));
        const isComplete = (id: string, synthetic: boolean): boolean => {
            const row = workflowStatus.get(id);
            return row !== undefined && (synthetic ? row.syntheticExerciseComplete : row.complete)
                && row.depends.every((dependency) => isComplete(dependency, synthetic));
        };
        const finished = workflows.map((row) => ({ ...row, complete: isComplete(row.id, false),
            syntheticExerciseComplete: isComplete(row.id, true) }));
        const counts = { ...summaries(caseRows), evidenceMissing: results.filter((row) => row.evidenceStatus === 'missing').length,
            evidenceInvalid: results.filter((row) => row.evidenceStatus === 'invalid').length,
            evidenceUnverified: results.filter((row) => row.evidenceStatus === 'unverified').length,
            historical: results.filter((row) => row.applicability === 'historical').length,
            applicabilityUnknown: results.filter((row) => row.applicability === 'unknown').length,
            resultTotal: results.length };
        const denominatorKnown = inventory.complete;
        return { schemaVersion: 'pod-test-coverage-report.v1', candidateId: String(input.candidate.id),
            denominator: { complete: inventory.complete, capabilityTotal: inventory.capabilities.length,
                declaredCapabilityTotal: input.capabilities.length, mapped: mapping.mappedCapabilityIds.length,
                unmapped: mapping.unmappedSourceCapabilities.length, missingRepositories: [...inventory.missingRepositories].sort(),
                missingSourceIds: [...inventory.missingSourceIds].sort(),
                sources: sorted(inventory.sources).map((source) => ({ id: source.id, repository: source.repository,
                    kind: source.kind, completeness: source.completeness, reason: source.reason, capabilityTotal: source.capabilities.length })) },
            mapping: { complete: mapping.complete, uncoveredCapabilityIds: [...mapping.uncoveredCapabilityIds].sort(),
                casesWithoutWorkflow: [...mapping.casesWithoutWorkflow].sort(),
                unmappedSourceCapabilities: [...mapping.unmappedSourceCapabilities].sort((a, b) => a.id.localeCompare(b.id, 'en')) },
            counts, completionRate: denominatorKnown && counts.applicable > 0 ? counts.currentPassed / counts.applicable : null,
            byLayer: breakdown('layer'), byEnvironment: breakdown('environment'), cases: caseRows, workflows: finished,
            results, conflicts: [...evidence.conflicts].sort(), acceptanceComplete: inventory.complete && mapping.complete
                && finished.length > 0 && finished.every((row) => row.complete) };
    }

    /**
     * @description 规范化对象键以得到与输入排列无关的 JSON 字节。
     * @param value 报告数据。
     * @returns 以换行结束的规范 JSON。
     */
    public static json(value: unknown): string {
        const normalize = (node: unknown): unknown => Array.isArray(node) ? node.map(normalize)
            : node !== null && typeof node === 'object' ? Object.fromEntries(Object.entries(node)
                .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, child]) => [key, normalize(child)])) : node;
        return `${JSON.stringify(normalize(value), null, 2)}\n`;
    }

    /**
     * @description 转义所有来自输入的 Markdown 文本并避免原始 HTML。
     * @param value 报告对象。
     * @returns 稳定 Markdown。
     */
    public static markdown(value: Readonly<Record<string, unknown>>): string {
        const escape = (item: unknown): string => String(item).replace(/&/gu, '&amp;').replace(/</gu, '&lt;')
            .replace(/>/gu, '&gt;').replace(/[|\\`*_{}\[\]()#+.!\r\n]/gu, (char) => `&#${char.codePointAt(0)};`);
        const counts = value.counts as Readonly<Record<string, unknown>>;
        const denominator = value.denominator as Readonly<Record<string, unknown>>;
        const rows = value.cases as readonly Readonly<Record<string, unknown>>[];
        const workflows = value.workflows as readonly Readonly<Record<string, unknown>>[];
        return [`# Pod 测试覆盖报告`, '', `候选：${escape(value.candidateId)}`, '',
            `分母完整：${escape(denominator.complete)}；能力总量：${escape(denominator.capabilityTotal)}；未映射：${escape(denominator.unmapped)}`,
            `验收完成：${escape(value.acceptanceComplete)}`, '',
            '## 三轴计数', '', ...Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en'))
                .map(([key, count]) => `- ${escape(key)}: ${escape(count)}`), '',
            '## 用例', '', '| ID | 层级 | 环境 | 预期 | 当前状态 |', '| --- | --- | --- | --- | --- |',
            ...rows.map((row) => `| ${escape(row.id)} | ${escape(row.layer)} | ${escape(row.environment)} | ${escape(row.expectedOutcome)} | ${escape(row.status)} |`),
            '', '## 主线', '', '| ID | 类型 | 完成 |', '| --- | --- | --- |',
            ...workflows.map((row) => `| ${escape(row.id)} | ${escape(row.kind)} | ${escape(row.complete)} |`), ''].join('\n');
    }
}
