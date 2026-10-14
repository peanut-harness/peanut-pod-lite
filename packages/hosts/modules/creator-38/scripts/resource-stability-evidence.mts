import { LifecycleRawLogValidator } from '../../../../../tools/editor-stability/lifecycle-raw-log-validator.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCaseObservation,
    IResourceSessionIdentity } from './resource-stability-contracts.mts';

/**
 * @description 一个精确版本的全 scope 观察及完整原始生命周期证据。
 */
export interface IResourceCampaignEvidence {
    /**
     * @description 原生端口回读的会话身份。
     */
    readonly session: IResourceSessionIdentity;
    /**
     * @description 本次从当前 tree 重算的 inventory 摘要。
     */
    readonly inventorySha256: string;
    /**
     * @description 原生用例观察，不从 manifest passed 状态生成。
     */
    readonly observations: readonly IResourceCaseObservation[];
    /**
     * @description 独立文件读取器恢复原始 bytes 后的 lifecycle 输入。
     */
    readonly lifecycle: unknown;
}

/**
 * @description 不截断分母和失败计数的资源验收结论。
 */
export interface IResourceCampaignValidation {
    /**
     * @description scope、身份、原生观察和全部 raw 阶段同时通过。
     */
    readonly ok: boolean;
    /**
     * @description 当前 scope 的完整分母。
     */
    readonly requiredCases: number;
    /**
     * @description 身份、原生语义及 raw 阶段均通过的行数。
     */
    readonly passed: number;
    /**
     * @description 完整问题总数。
     */
    readonly issueCount: number;
    /**
     * @description 有界的稳定问题代码；不复制日志正文或 token。
     */
    readonly issues: readonly string[];
}

/**
 * @description 从实际用例观察与原始日志重算结论，不接受摘要中的 passed 声明。
 */
export class ResourceStabilityEvidenceValidator {
    /**
     * @description 独立核对全 scope、候选归属和每条语义读回。
     * @param plan 对应当前 inventory 的完整计划。
     * @param expected 从 registry、当前 Git 与候选独立读取的预期。
     * @param evidence 已从原始结果文件与日志解析的观察。
     * @returns 不能由静态 manifest 状态转出的原生验收结论。
     */
    public static validate(plan: IResourceCampaignPlan, expected: IResourceCampaignExpectation,
        evidence: IResourceCampaignEvidence): IResourceCampaignValidation {
        const issues: string[] = [];
        try { ResourceStabilityRunner.validatePlan(plan, expected); }
        catch { issues.push('resource_plan_invalid'); }
        for (const key of ['creatorVersion', 'owner', 'change', 'hostSha256', 'coreSha256', 'sourceCommit',
            'projectPath', 'projectName', 'runId', 'creatorPid', 'creatorStartedAt'] as const) {
            if (evidence.session?.[key] !== expected[key]) issues.push(`resource_evidence_session_mismatch:${key}`);
        }
        if (evidence.inventorySha256 !== expected.inventorySha256) issues.push('resource_evidence_inventory_mismatch');
        const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
        const byId = new Map<string, IResourceCaseObservation>();
        const required = new Set(expected.requiredCaseIds);
        for (const observation of observations) {
            if (typeof observation?.caseId !== 'string' || byId.has(observation.caseId) || !required.has(observation.caseId)) {
                issues.push('resource_evidence_duplicate_or_unknown_case'); continue;
            }
            byId.set(observation.caseId, observation);
        }
        if (byId.size !== required.size) issues.push('resource_evidence_missing_case');
        let passed = 0;
        for (const row of plan.cases) {
            const observation = byId.get(row.caseId);
            if (!observation) continue;
            let rowIssues: string[];
            try { rowIssues = ResourceStabilityRunner.validateObservation(row, observation); }
            catch { rowIssues = ['observation_shape_invalid']; }
            issues.push(...rowIssues.map((issue) => `${row.caseId}:${issue}`));
            if (rowIssues.length === 0) passed += 1;
        }
        const raw = LifecycleRawLogValidator.validate(evidence.lifecycle);
        if (!raw.ok) issues.push('resource_lifecycle_raw_failed');
        const lifecycle = evidence.lifecycle;
        if (lifecycle === null || typeof lifecycle !== 'object'
            || (lifecycle as Record<string, unknown>).hostSha256 !== expected.hostSha256
            || (lifecycle as Record<string, unknown>).coreSha256 !== expected.coreSha256
            || (lifecycle as Record<string, unknown>).runId !== expected.runId
            || (lifecycle as Record<string, unknown>).projectName !== expected.projectName) {
            issues.push('resource_lifecycle_candidate_mismatch');
        }
        const globalFailure = issues.some((i) => !plan.cases.some((row) => i.startsWith(`${row.caseId}:`)));
        return { ok: issues.length === 0 && passed === required.size, requiredCases: required.size,
            passed: globalFailure ? 0 : passed, issueCount: issues.length, issues: issues.slice(0, 100) };
    }
}
