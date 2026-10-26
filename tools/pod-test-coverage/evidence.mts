import { CoverageManifestGenerator } from '../editor-stability/coverage-manifest-generator.mjs';
import { PodCoverageContracts, type IPodCoverageInput } from './contracts.mjs';
import { PodCoverageEvidenceReaders, type IPodCoverageEvidenceReadout } from './evidence-readers.mjs';
import { PodCoverageInputReader } from './input-reader.mjs';

/**
 * @description 一个原始结果的三轴状态，不覆盖或删除历史记录。
 */
export interface IPodCoverageResultAssessment {
    readonly id: string;
    readonly caseId: string;
    readonly executionOutcome: 'not_run' | 'passed' | 'failed' | 'blocked' | 'not_applicable';
    readonly rawOutcome: string;
    readonly evidenceStatus: 'missing' | 'unverified' | 'verified' | 'invalid';
    readonly applicability: 'current' | 'historical' | 'unknown';
    readonly evidenceReason: string;
    readonly applicabilityReason: string;
    readonly synthetic: boolean;
    readonly reused: boolean;
    readonly conflict: boolean;
    readonly supersededBy: string | null;
    readonly countsAsCurrentPass: boolean;
}

/**
 * @description 固定证据解析后的当前结果与完整历史结果集合。
 */
export interface IPodCoverageEvidenceAssessment {
    readonly results: readonly IPodCoverageResultAssessment[];
    readonly conflicts: readonly string[];
}

/**
 * @description 分离执行、证据和候选适用性；不信任结果自报的 passed。
 */
export class PodCoverageEvidence {
    /**
     * @description 核对原始结果，保留冲突和旧候选记录。
     * @param input 已校验的输入。
     * @param reader 显式根读取器。
     * @returns 每条结果的独立三轴状态。
     */
    public static assess(input: IPodCoverageInput, reader: PodCoverageInputReader): IPodCoverageEvidenceAssessment {
        const cases = new Map(input.cases.map((row) => [PodCoverageContracts.identifier(row.id), row]));
        const provisional = input.results.map((result) => {
            const id = PodCoverageContracts.identifier(result.id);
            const caseId = PodCoverageContracts.identifier(result.caseId);
            const caseRow = cases.get(caseId);
            if (caseRow === undefined) throw new Error(`pod_coverage_result_case_missing:${id}`);
            const rawOutcome = String(result.executionOutcome);
            const executionOutcome = this.outcome(rawOutcome);
            const binding = this.binding(result.binding);
            const evidence = PodCoverageEvidenceReaders.inspect(result, caseRow, binding.value, reader);
            const applicability = this.applicability(input, caseRow, binding, evidence, reader, executionOutcome);
            return { id, caseId, rawOutcome, executionOutcome, evidenceStatus: evidence.status,
                evidenceReason: evidence.reason, applicability: applicability.status, applicabilityReason: applicability.reason,
                synthetic: evidence.synthetic, reused: applicability.reused, candidateId: binding.value.candidateId,
                supersedes: binding.value.supersedes, completedAt: result.completedAt };
        });
        const byId = new Map(provisional.map((row) => [row.id, row]));
        const supersededBy = new Map<string, string>();
        for (const row of provisional) {
            if (typeof row.supersedes !== 'string') continue;
            const old = byId.get(row.supersedes);
            if (old === undefined || old.caseId !== row.caseId || old.candidateId !== row.candidateId
                || supersededBy.has(old.id) || typeof row.completedAt !== 'string' || typeof old.completedAt !== 'string'
                || !Number.isFinite(Date.parse(row.completedAt)) || !Number.isFinite(Date.parse(old.completedAt))
                || Date.parse(row.completedAt) <= Date.parse(old.completedAt)) {
                throw new Error(`pod_coverage_result_supersedes_invalid:${row.id}`);
            }
            supersededBy.set(old.id, row.id);
        }
        const groups = new Map<string, typeof provisional>();
        for (const row of provisional) {
            if (row.applicability !== 'current' || supersededBy.has(row.id)) continue;
            const key = `${row.caseId}\0${String(row.candidateId)}`;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
        }
        const conflictIds = new Set<string>();
        for (const group of groups.values()) {
            if (new Set(group.map((row) => row.executionOutcome)).size > 1) {
                for (const row of group) conflictIds.add(row.id);
            }
        }
        const results: IPodCoverageResultAssessment[] = provisional.map((row) => ({
            id: row.id, caseId: row.caseId, rawOutcome: row.rawOutcome, executionOutcome: row.executionOutcome,
            evidenceStatus: row.evidenceStatus, evidenceReason: row.evidenceReason,
            applicability: row.applicability, applicabilityReason: row.applicabilityReason,
            synthetic: row.synthetic, reused: row.reused, conflict: conflictIds.has(row.id),
            supersededBy: supersededBy.get(row.id) ?? null,
            countsAsCurrentPass: row.executionOutcome === 'passed' && row.evidenceStatus === 'verified'
                && row.applicability === 'current' && !row.synthetic && !conflictIds.has(row.id)
                && !supersededBy.has(row.id),
        }));
        return { results, conflicts: [...conflictIds].sort() };
    }

    /**
     * @description 保留旧 pending/skipped 的原始值并映射为未执行。
     * @param value 旧或当前执行状态。
     * @returns 规范执行轴。
     */
    private static outcome(value: string): IPodCoverageResultAssessment['executionOutcome'] {
        if (value === 'pending' || value === 'skipped') return 'not_run';
        if (value === 'not_run' || value === 'passed' || value === 'failed' || value === 'blocked'
            || value === 'not_applicable') return value;
        throw new Error(`pod_coverage_execution_outcome_invalid:${value}`);
    }

    /**
     * @description 收窄执行绑定，缺字段保留为未知适用性而非丢弃历史。
     * @param value 未受信结果绑定。
     * @returns 原始字段和完整性标记。
     */
    private static binding(value: unknown): { value: Readonly<Record<string, unknown>>; valid: boolean } {
        const fields = ['candidateId', 'repository', 'commit', 'tree', 'environment', 'platform', 'runtimeVersion',
            'creatorVersion', 'artifactDigests', 'relatedInputDigests', 'fixtureDigests', 'commandDigest',
            'testSourceDigest', 'toolchain', 'executionKind', 'supersedes', 'reuseProof'];
        try {
            const record = PodCoverageContracts.record(value, fields, 'result_binding');
            if (typeof record.candidateId !== 'string' || typeof record.repository !== 'string'
                || typeof record.commit !== 'string' || typeof record.tree !== 'string'
                || typeof record.environment !== 'string' || typeof record.platform !== 'string'
                || typeof record.runtimeVersion !== 'string' || typeof record.toolchain !== 'string'
                || typeof record.executionKind !== 'string' || !PodCoverageContracts.digest(record.commandDigest)
                || !PodCoverageContracts.digest(record.testSourceDigest)
                || record.creatorVersion !== null && typeof record.creatorVersion !== 'string'
                || record.supersedes !== null && typeof record.supersedes !== 'string') {
                return { value: record, valid: false };
            }
            for (const field of ['artifactDigests', 'relatedInputDigests', 'fixtureDigests']) {
                const digests = PodCoverageContracts.record(record[field], null, `binding_${field}`);
                if (Object.values(digests).some((digest) => !PodCoverageContracts.digest(digest))) {
                    return { value: record, valid: false };
                }
            }
            return { value: record, valid: true };
        } catch {
            return { value: value !== null && typeof value === 'object' && !Array.isArray(value)
                ? value as Readonly<Record<string, unknown>> : {}, valid: false };
        }
    }

    /**
     * @description 用候选、相关输入、命令、夹具和环境核对适用性。
     * @param input 当前候选。
     * @param caseRow 用例定义。
     * @param binding 结果原始绑定。
     * @param evidence 独立证据读回。
     * @param reader 只读引用读取器。
     * @param outcome 执行状态。
     * @returns 当前、历史或未知及原因。
     */
    private static applicability(input: IPodCoverageInput, caseRow: Readonly<Record<string, unknown>>,
        binding: { value: Readonly<Record<string, unknown>>; valid: boolean }, evidence: IPodCoverageEvidenceReadout,
        reader: PodCoverageInputReader, outcome: IPodCoverageResultAssessment['executionOutcome']):
        { status: IPodCoverageResultAssessment['applicability']; reason: string; reused: boolean } {
        const unknown = (reason: string) => ({ status: 'unknown' as const, reason, reused: false });
        const historical = (reason: string) => ({ status: 'historical' as const, reason, reused: false });
        const value = binding.value;
        if (!binding.valid) return unknown('binding_incomplete');
        if (value.candidateId !== input.candidate.id) return historical('candidate_id_changed');
        const command = PodCoverageContracts.record(caseRow.commandRef, null, 'case_command');
        if (value.repository !== command.repository) return historical('repository_changed');
        const repositories = PodCoverageContracts.record(input.candidate.repositories, null, 'candidate_repositories');
        const candidateRepo = repositories[String(value.repository)];
        if (candidateRepo === undefined) return unknown('candidate_repository_missing');
        const repo = PodCoverageContracts.record(candidateRepo, null, 'candidate_repository');
        if (value.environment !== caseRow.environment
            || !PodCoverageContracts.stringArray(input.candidate.environments, 'candidate_environments').includes(String(value.environment))) {
            return historical('environment_changed');
        }
        const creator = /^creator-(\d+\.\d+\.\d+)$/u.exec(String(value.environment));
        if (creator !== null && value.creatorVersion !== creator[1]) return historical('creator_version_changed');
        if (CoverageManifestGenerator.digest(command) !== value.commandDigest) return historical('command_changed');
        const related = PodCoverageContracts.record(value.relatedInputDigests, null, 'binding_inputs');
        const expectedInputs = PodCoverageContracts.record(input.candidate.inputDigests, null, 'candidate_inputs');
        if (Object.keys(related).length === 0) return unknown('related_inputs_missing');
        for (const [id, digest] of Object.entries(related)) {
            if (expectedInputs[id] !== digest) return historical(`related_input_changed:${id}`);
        }
        if (related[`test-source:${String(caseRow.id)}`] !== value.testSourceDigest) {
            return unknown('test_source_binding_missing');
        }
        if (typeof value.platform !== 'string' || value.platform.length === 0
            || typeof value.runtimeVersion !== 'string' || value.runtimeVersion.length === 0
            || typeof value.toolchain !== 'string' || value.toolchain.length === 0) return unknown('environment_binding_incomplete');
        if (repo.platform === undefined || repo.runtimeVersion === undefined || repo.toolchain === undefined) {
            return unknown('candidate_environment_identity_missing');
        }
        if (repo.platform !== value.platform || repo.runtimeVersion !== value.runtimeVersion
            || repo.toolchain !== value.toolchain) return historical('platform_runtime_or_toolchain_changed');
        const fixtures = PodCoverageContracts.record(value.fixtureDigests, null, 'binding_fixtures');
        if (!Array.isArray(caseRow.fixtureRefs)) return unknown('fixture_binding_missing');
        for (const rawRef of caseRow.fixtureRefs) {
            const ref = PodCoverageContracts.reference(rawRef);
            if (fixtures[`${ref.rootId}:${ref.path}`] !== ref.sha256) return historical('fixture_digest_changed');
            try { reader.readReference(ref); }
            catch { return unknown('fixture_bytes_unavailable_or_changed'); }
        }
        const artifacts = PodCoverageContracts.record(value.artifactDigests, null, 'binding_artifacts');
        const candidateArtifacts = repo.artifactDigests === undefined ? null
            : PodCoverageContracts.record(repo.artifactDigests, null, 'candidate_artifacts');
        if (this.needsArtifact(caseRow.layer) && (Object.keys(artifacts).length === 0 || candidateArtifacts === null)) {
            return unknown('artifact_binding_missing');
        }
        if (candidateArtifacts !== null && Object.entries(artifacts).some(([id, digest]) => candidateArtifacts[id] !== digest)) {
            return historical('artifact_changed');
        }
        if ((value.executionKind === 'substitute' || value.executionKind === 'synthetic')
            && this.needsRealExecution(caseRow.layer)) return unknown('substitute_cannot_verify_real_layer');
        if (outcome === 'not_applicable') return unknown('not_applicable_basis_unverified');
        const commitMatch = repo.commit === value.commit && repo.tree === value.tree;
        if (commitMatch) return { status: 'current', reason: 'candidate_binding_match', reused: false };
        if (evidence.synthetic && evidence.reuseProofVerified && this.syntheticReuseMatches(value.reuseProof, value.commit, repo.commit)) {
            return { status: 'current', reason: 'synthetic_document_reuse', reused: true };
        }
        return historical('source_commit_or_tree_changed');
    }

    /**
     * @description 合成文档复用只承认原提交与候选提交的精确方向。
     * @param proof 合成复用字段。
     * @param fromCommit 原执行提交。
     * @param toCommit 当前候选提交。
     * @returns 是否匹配。
     */
    private static syntheticReuseMatches(proof: unknown, fromCommit: unknown, toCommit: unknown): boolean {
        try {
            const record = PodCoverageContracts.record(proof, null, 'reuse_proof');
            return record.kind === 'synthetic-document-only' && record.fromCommit === fromCommit
                && record.toCommit === toCommit;
        } catch { return false; }
    }

    /**
     * @description 制品或实机层必须独立绑定候选制品。
     * @param layer 用例层级。
     * @returns 是否需要制品摘要。
     */
    private static needsArtifact(layer: unknown): boolean {
        return ['package', 'creator-native', 'business', 'reliability', 'service-live'].includes(String(layer));
    }

    /**
     * @description 替身仅可支撑协议或单元层，不得升级真实环境层。
     * @param layer 用例层级。
     * @returns 是否需要真实依赖。
     */
    private static needsRealExecution(layer: unknown): boolean {
        return ['creator-native', 'business', 'reliability', 'service-live'].includes(String(layer));
    }
}
