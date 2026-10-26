import { PodCoverageContracts, type IPodCoverageInput } from './contracts.mjs';

/**
 * @description 最小实机链的静态计划步骤；工具从不执行 entryRef。
 */
export interface IPodAcceptanceStep {
    readonly id: string;
    readonly ownerRepo: string;
    readonly requiredInputs: readonly string[];
    readonly entryRef: string;
    readonly readback: string;
    readonly depends: readonly string[];
    readonly onFailure: 'stop' | 'inspect-and-clean';
    readonly cleanupScope: string;
    readonly budget: string;
    readonly status: 'planned' | 'blocked';
    readonly blockReason: string | null;
}

/**
 * @description 只生成候选安装至编辑链，不创建项目、授权或产品结果。
 */
export class PodAcceptancePlan {
    /**
     * @description 为精确 Creator 版本和隔离工程生成固定顺序的门禁。
     * @param input 已校验输入。
     * @param creatorVersion 精确 3.8.3 或 3.8.7。
     * @param projectBinding 现有隔离工程的外部绑定，null 为缺失。
     * @param writeApproved 外部是否已经取得实际写入授权。
     * @returns 含阻塞原因和保守清理规则的计划。
     */
    public static build(input: IPodCoverageInput, creatorVersion: string, projectBinding: string | null = null,
        writeApproved = false): Readonly<Record<string, unknown>> {
        if (!['3.8.3', '3.8.7'].includes(creatorVersion)) throw new Error('pod_coverage_plan_creator_version_invalid');
        const candidate = PodCoverageContracts.record(input.candidate, null, 'candidate');
        const repositories = PodCoverageContracts.record(candidate.repositories, null, 'candidate_repositories');
        const lite = PodCoverageContracts.record(repositories['peanut-pod-lite'], null, 'candidate_lite_repository');
        const frozen = typeof lite.commit === 'string' && /^[0-9a-f]{40,64}$/u.test(lite.commit)
            && typeof lite.tree === 'string' && /^[0-9a-f]{40,64}$/u.test(lite.tree);
        const available = PodCoverageContracts.stringArray(candidate.environments, 'candidate_environments')
            .includes(`creator-${creatorVersion}`);
        const project = projectBinding !== null && projectBinding.trim().length > 0 && projectBinding.length <= 256;
        const commonReason = !frozen ? 'candidate_identity_not_frozen' : !available ? 'creator_version_not_bound'
            : !project ? 'isolated_project_not_bound' : null;
        const definitions = [
            ['identity', [], 'docs/INSTALLATION.md', '候选包、来源提交与摘要独立核对', 'identity'],
            ['host-ready', ['identity'], 'docs/INSTALLATION.md', '精确宿主版本与隔离工程已就绪', 'host'],
            ['install', ['host-ready'], 'docs/INSTALLATION.md', 'Peanut Packaging 活动索引、版本与 Host/Core 候选摘要读回', 'install'],
            ['read-only-smoke', ['install'], 'docs/INSTALLATION.md', 'query-status 与只读探针输出', 'smoke'],
            ['approved-write', ['read-only-smoke'], 'packages/hosts/modules/creator-38/scripts/verify-managed-task-live.mts',
                'Prefab/Scene 写入结果及 postflight 独立读回', 'write'],
            ['save-reopen', ['approved-write'], '待定义：保存并重开隔离工程', '重开后资源与引用独立读回；既有脚本未覆盖', 'reopen'],
            ['independent-readback', ['save-reopen'], 'docs/INSTALLATION.md', 'AssetDB/meta/引用/日志增量及残留核对', 'readback'],
            ['cleanup', ['independent-readback'], 'docs/INSTALLATION.md', '按实际创建清单核对本任务进程与资源', 'cleanup'],
        ] as const;
        const steps: IPodAcceptanceStep[] = definitions.map(([id, depends, entryRef, readback, scope]) => {
            const blockReason = commonReason ?? (id === 'approved-write' && !writeApproved ? 'write_approval_missing'
                : id === 'save-reopen' ? 'save_reopen_entry_undefined' : null);
            return { id, ownerRepo: 'peanut-pod-lite', requiredInputs: ['candidateId', `creator-${creatorVersion}`,
                'isolatedProjectBinding', ...(id === 'approved-write' ? ['actualWriteApproval'] : [])], entryRef, readback,
                depends, onFailure: id === 'cleanup' ? 'inspect-and-clean' : 'stop', cleanupScope: scope,
                budget: 'bounded-single-attempt', status: blockReason === null ? 'planned' : 'blocked', blockReason };
        });
        const blocked = new Set(steps.filter((step) => step.status === 'blocked').map((step) => step.id));
        for (const step of steps) {
            if (step.id !== 'cleanup' && step.depends.some((dependency) => blocked.has(dependency))) blocked.add(step.id);
        }
        return { schemaVersion: 'pod-acceptance-plan.v1', candidateId: candidate.id, creatorVersion,
            projectBinding: projectBinding === null ? null : 'provided-externally', writeApproved,
            steps: steps.map((step) => blocked.has(step.id) && step.status !== 'blocked'
                ? { ...step, status: 'blocked', blockReason: 'dependency_blocked' } : step),
            cleanupRule: '仅核对本次已创建资源清单；may_have_changed 保留诊断并先核验工程，不盲删、不重复写入、不声称回滚',
            executionPerformed: false };
    }
}
