import { PodCoverageContracts } from './contracts.mjs';
import { PodCoverageInputReader } from './input-reader.mjs';

/**
 * @description 原始证据解析结果；合成证明不具备产品通过权限。
 */
export interface IPodCoverageEvidenceReadout {
    readonly status: 'missing' | 'unverified' | 'verified' | 'invalid';
    readonly reason: string;
    readonly synthetic: boolean;
    readonly reuseProofVerified: boolean;
}

/**
 * @description 固定证据类型的只读解析器；未知类型绝不从摘要升级为通过。
 */
export class PodCoverageEvidenceReaders {
    /**
     * @description 核验一个结果的原始引用和类型专属读回。
     * @param result 原始结果记录。
     * @param caseRow 对应测试定义。
     * @param binding 已缩窄的执行绑定。
     * @param reader 显式证据根读取器。
     * @returns 与适用性独立的证据状态。
     */
    public static inspect(result: Readonly<Record<string, unknown>>, caseRow: Readonly<Record<string, unknown>>,
        binding: Readonly<Record<string, unknown>>, reader: PodCoverageInputReader): IPodCoverageEvidenceReadout {
        const refs = result.evidenceRefs;
        if (!Array.isArray(refs) || refs.length === 0) {
            return { status: 'missing', reason: 'raw_evidence_missing', synthetic: false, reuseProofVerified: false };
        }
        if (refs.length > PodCoverageContracts.maxReferences) throw new Error('pod_coverage_evidence_count_exceeded');
        const validatorId = result.validatorId;
        if (validatorId !== 'pod-synthetic-proof.v1') {
            for (const ref of refs) {
                const checked = this.read(reader, ref);
                if (checked.status !== 'verified') return checked;
            }
            return { status: 'unverified', reason: 'validator_has_no_trusted_adapter', synthetic: false, reuseProofVerified: false };
        }
        if (refs.length !== 1) return { status: 'invalid', reason: 'synthetic_reference_count_invalid', synthetic: true, reuseProofVerified: false };
        const checked = this.read(reader, refs[0]);
        if (checked.status !== 'verified' || checked.bytes === undefined) {
            return { status: checked.status, reason: checked.reason, synthetic: true, reuseProofVerified: false };
        }
        let parsed: unknown;
        try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(checked.bytes)); }
        catch { return { status: 'invalid', reason: 'synthetic_json_invalid', synthetic: true, reuseProofVerified: false }; }
        PodCoverageContracts.assertJsonBounds(parsed);
        let proof: Readonly<Record<string, unknown>>;
        try {
            proof = PodCoverageContracts.record(parsed,
                ['schemaVersion', 'caseId', 'outcome', 'commandDigest', 'readback', 'relatedInputDigests', 'reuseProof'], 'synthetic_proof');
        } catch {
            return { status: 'invalid', reason: 'synthetic_shape_invalid', synthetic: true, reuseProofVerified: false };
        }
        if (proof.schemaVersion !== 'pod-synthetic-proof.v1' || proof.caseId !== result.caseId
            || proof.outcome !== result.executionOutcome || proof.commandDigest !== binding.commandDigest
            || proof.readback !== caseRow.readback || !this.sameDigests(proof.relatedInputDigests, binding.relatedInputDigests)) {
            return { status: 'invalid', reason: 'synthetic_binding_or_readback_mismatch', synthetic: true, reuseProofVerified: false };
        }
        const reuseProofVerified = this.syntheticReuseProof(proof.reuseProof, binding.reuseProof);
        return { status: 'verified', reason: 'synthetic_only', synthetic: true, reuseProofVerified };
    }

    /**
     * @description 读取摘要引用，缺根与损坏分开保留。
     * @param reader 安全读取器。
     * @param ref 未受信引用。
     * @returns 原始字节或稳定缺口。
     */
    private static read(reader: PodCoverageInputReader, ref: unknown): IPodCoverageEvidenceReadout & { readonly bytes?: Uint8Array } {
        try {
            return { status: 'verified', reason: 'reference_bytes_match', synthetic: false, reuseProofVerified: false,
                bytes: reader.readReference(ref) };
        } catch (error) {
            if (error instanceof Error && error.message === 'pod_coverage_reference_root_missing'
                || error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return { status: 'missing', reason: 'evidence_source_missing', synthetic: false, reuseProofVerified: false };
            }
            return { status: 'invalid', reason: 'evidence_reference_invalid', synthetic: false, reuseProofVerified: false };
        }
    }

    /**
     * @description 精确比较相关输入摘要表，忽略 JSON 对象键顺序。
     * @param left 证据绑定。
     * @param right 执行绑定。
     * @returns 摘要集合是否逐项相同。
     */
    private static sameDigests(left: unknown, right: unknown): boolean {
        try {
            const a = PodCoverageContracts.record(left, null, 'proof_inputs');
            const b = PodCoverageContracts.record(right, null, 'binding_inputs');
            return Object.keys(a).length === Object.keys(b).length
                && Object.entries(a).every(([key, value]) => PodCoverageContracts.digest(value) && b[key] === value);
        } catch { return false; }
    }

    /**
     * @description 仅为合成夹具核对文档变更复用声明，真实 Git 复用仍需可信适配器。
     * @param proof 原始合成证明中的复用依据。
     * @param binding 执行绑定中的复用依据。
     * @returns 合成复用依据是否完整一致。
     */
    private static syntheticReuseProof(proof: unknown, binding: unknown): boolean {
        if (proof === null && binding === null) return false;
        try {
            const a = PodCoverageContracts.record(proof, ['kind', 'fromCommit', 'toCommit', 'changedPaths'], 'synthetic_reuse');
            const b = PodCoverageContracts.record(binding, ['kind', 'fromCommit', 'toCommit', 'changedPaths'], 'binding_reuse');
            if (a.kind !== 'synthetic-document-only' || b.kind !== a.kind || a.fromCommit !== b.fromCommit
                || a.toCommit !== b.toCommit || !Array.isArray(a.changedPaths) || !Array.isArray(b.changedPaths)) return false;
            const paths = PodCoverageContracts.stringArray(a.changedPaths, 'reuse_paths');
            const boundPaths = PodCoverageContracts.stringArray(b.changedPaths, 'bound_reuse_paths');
            return paths.length > 0 && paths.length === boundPaths.length
                && paths.every((path, index) => path === boundPaths[index]
                    && PodCoverageContracts.relativePath(path) && /^(docs\/|README\.md$)/u.test(path));
        } catch { return false; }
    }
}
