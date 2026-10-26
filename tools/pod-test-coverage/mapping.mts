import { PodCoverageContracts, type IPodCoverageInput } from './contracts.mjs';
import type { IPodCoverageInventoryAssessment, IPodCoverageInventoryCapability } from './inventory.mjs';

/**
 * @description 用例与主线只建立可追溯映射，不赋予执行或通过状态。
 */
export interface IPodCoverageMappingAssessment {
    readonly mappedCapabilityIds: readonly string[];
    readonly unmappedSourceCapabilities: readonly IPodCoverageInventoryCapability[];
    readonly uncoveredCapabilityIds: readonly string[];
    readonly casesWithoutWorkflow: readonly string[];
    readonly orderedCaseIds: readonly string[];
    readonly orderedWorkflowIds: readonly string[];
    readonly complete: boolean;
}

/**
 * @description 校验能力、用例和六条业务主线的显式依赖关系。
 */
export class PodCoverageMapping {
    /**
     * @description 发现新增未映射来源项，同时拒绝悬空引用、循环和缺少判据。
     * @param input 已校验的输入。
     * @param inventory 独立来源分母。
     * @returns 映射缺口与拓扑顺序。
     */
    public static assess(input: IPodCoverageInput, inventory: IPodCoverageInventoryAssessment): IPodCoverageMappingAssessment {
        const sources = new Map(input.sources.map((source) => [PodCoverageContracts.identifier(source.id), source]));
        const sourceAssessments = new Map(inventory.sources.map((source) => [source.id, source]));
        const inventorySubjects = new Set(inventory.capabilities.map((capability) =>
            `${capability.sourceId}\0${capability.sourceSubject}`));
        const mappedSubjects = new Set<string>();
        const capabilityIds = new Set<string>();
        for (const capability of input.capabilities) {
            const id = PodCoverageContracts.identifier(capability.id);
            const sourceId = PodCoverageContracts.identifier(capability.sourceId);
            const subject = this.nonempty(capability.sourceSubject, 'capability_subject');
            if (!sources.has(sourceId)) throw new Error(`pod_coverage_capability_source_missing:${id}`);
            if (capability.ownerRepo !== sources.get(sourceId)?.repository) {
                throw new Error(`pod_coverage_capability_owner_mismatch:${id}`);
            }
            const source = sourceAssessments.get(sourceId);
            const key = `${sourceId}\0${subject}`;
            if (source?.capabilities.length && !inventorySubjects.has(key)) {
                throw new Error(`pod_coverage_capability_source_subject_missing:${id}`);
            }
            if (mappedSubjects.has(key)) throw new Error(`pod_coverage_capability_subject_duplicate:${id}`);
            mappedSubjects.add(key);
            capabilityIds.add(id);
            this.nonempty(capability.applicability, 'capability_applicability');
            if (capability.unverifiedReason !== null && typeof capability.unverifiedReason !== 'string') {
                throw new Error(`pod_coverage_capability_unverified_reason_invalid:${id}`);
            }
            PodCoverageContracts.stringArray(capability.traceRefs, 'capability_trace_refs');
        }
        const cases = new Map(input.cases.map((row) => [PodCoverageContracts.identifier(row.id), row]));
        const caseCoveredCapabilities = new Set<string>();
        for (const [id, row] of cases) {
            const referenced = this.uniqueIds(row.capabilityIds, `case_capabilities:${id}`);
            if (referenced.length === 0) throw new Error(`pod_coverage_case_capability_missing:${id}`);
            for (const capabilityId of referenced) {
                if (!capabilityIds.has(capabilityId)) throw new Error(`pod_coverage_case_capability_unknown:${id}:${capabilityId}`);
                caseCoveredCapabilities.add(capabilityId);
            }
            this.nonempty(row.layer, 'case_layer');
            this.nonempty(row.environment, 'case_environment');
            PodCoverageContracts.stringArray(row.preconditions, 'case_preconditions');
            this.nonempty(row.expectedOutcome, 'case_expected_outcome');
            PodCoverageContracts.stringArray(row.allowedEffects, 'case_allowed_effects');
            this.nonempty(row.readback, 'case_readback');
            this.nonempty(row.recovery, 'case_recovery');
            const command = PodCoverageContracts.record(row.commandRef, ['repository', 'cwdRelative', 'executable', 'argv'], 'case_command');
            this.nonempty(command.repository, 'command_repository');
            if (command.cwdRelative !== '.' && !PodCoverageContracts.relativePath(command.cwdRelative)) {
                throw new Error(`pod_coverage_command_cwd_invalid:${id}`);
            }
            this.nonempty(command.executable, 'command_executable');
            PodCoverageContracts.stringArray(command.argv, 'command_argv');
            for (const dependency of this.uniqueIds(row.depends, `case_dependencies:${id}`)) {
                if (!cases.has(dependency)) throw new Error(`pod_coverage_case_dependency_missing:${id}:${dependency}`);
            }
        }
        const workflows = new Map(input.workflows.map((row) => [PodCoverageContracts.identifier(row.id), row]));
        const workflowCases = new Set<string>();
        const workflowKinds = new Set<string>();
        for (const [id, row] of workflows) {
            const kind = this.nonempty(row.kind, 'workflow_kind');
            if (!this.workflowKinds.has(kind)) throw new Error(`pod_coverage_workflow_kind_invalid:${id}`);
            workflowKinds.add(kind);
            const caseIds = this.uniqueIds(row.caseIds, `workflow_cases:${id}`);
            for (const caseId of caseIds) {
                if (!cases.has(caseId)) throw new Error(`pod_coverage_workflow_case_missing:${id}:${caseId}`);
                workflowCases.add(caseId);
            }
            for (const dependency of this.uniqueIds(row.depends, `workflow_dependencies:${id}`)) {
                if (!workflows.has(dependency)) throw new Error(`pod_coverage_workflow_dependency_missing:${id}:${dependency}`);
            }
            this.nonempty(row.stopCondition, 'workflow_stop_condition');
            this.nonempty(row.cleanupRule, 'workflow_cleanup_rule');
        }
        for (const result of input.results) {
            const resultId = PodCoverageContracts.identifier(result.id);
            if (!cases.has(String(result.caseId))) throw new Error(`pod_coverage_result_case_missing:${resultId}`);
        }
        const orderedCaseIds = this.order(cases, 'case');
        const orderedWorkflowIds = this.order(workflows, 'workflow');
        const unmappedSourceCapabilities = inventory.capabilities.filter((capability) =>
            !mappedSubjects.has(`${capability.sourceId}\0${capability.sourceSubject}`));
        const uncoveredCapabilityIds = [...capabilityIds].filter((id) => !caseCoveredCapabilities.has(id)).sort();
        const casesWithoutWorkflow = [...cases.keys()].filter((id) => !workflowCases.has(id)).sort();
        return { mappedCapabilityIds: [...capabilityIds].sort(), unmappedSourceCapabilities, uncoveredCapabilityIds,
            casesWithoutWorkflow,
            orderedCaseIds, orderedWorkflowIds,
            complete: inventory.complete && unmappedSourceCapabilities.length === 0 && uncoveredCapabilityIds.length === 0
                && casesWithoutWorkflow.length === 0 && cases.size > 0 && workflowKinds.size === this.workflowKinds.size };
    }

    /**
     * @description 对 case/workflow 依赖执行确定性拓扑排序。
     * @param rows 同类记录。
     * @param label 记录类别。
     * @returns 所有 ID 的稳定执行顺序。
     */
    private static order(rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>, label: string): readonly string[] {
        const state = new Map<string, 'visiting' | 'done'>();
        const ordered: string[] = [];
        const visit = (id: string): void => {
            if (state.get(id) === 'done') return;
            if (state.get(id) === 'visiting') throw new Error(`pod_coverage_${label}_dependency_cycle:${id}`);
            state.set(id, 'visiting');
            const row = rows.get(id);
            if (row === undefined) throw new Error(`pod_coverage_${label}_dependency_missing:${id}`);
            for (const dependency of this.uniqueIds(row.depends, `${label}_dependencies:${id}`).sort()) visit(dependency);
            state.set(id, 'done');
            ordered.push(id);
        };
        for (const id of [...rows.keys()].sort()) visit(id);
        return ordered;
    }

    /**
     * @description 收窄非空文本判据。
     * @param value 未知输入。
     * @param label 错误标识。
     * @returns 非空文本。
     */
    private static nonempty(value: unknown, label: string): string {
        if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2048) {
            throw new Error(`pod_coverage_${label}_invalid`);
        }
        return value;
    }

    /**
     * @description 收窄稳定且无重复的标识列表。
     * @param value 未知输入。
     * @param label 错误标识。
     * @returns 标识列表。
     */
    private static uniqueIds(value: unknown, label: string): string[] {
        const ids = PodCoverageContracts.stringArray(value, label).map((id) => PodCoverageContracts.identifier(id));
        if (new Set(ids).size !== ids.length) throw new Error(`pod_coverage_${label}_duplicate`);
        return [...ids];
    }

    /**
     * @description 固定六条业务主线，新增主线须显式升级协议。
     */
    private static readonly workflowKinds = new Set(['installation', 'basic-editing', 'design-to-project',
        'font-content', 'account-permission', 'continuity']);
}
