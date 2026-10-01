import type {
    ICoverageEvidenceReader,
    ICoverageInventory,
    ICoverageResolvedFixture,
    ICoverageResolvedResult,
    ICoverageValidation,
} from './coverage-contracts.mjs';
import { CoverageManifestGenerator } from './coverage-manifest-generator.mjs';

/**
 * @description 对照独立分母与原始证据验收清单，拒绝伪通过、减分母及跨版本证明。
 */
export class CoverageManifestValidator {
    /**
     * @description 完整校验未知 JSON 清单；草稿、缺夹具、跳过和未核实目录均不会通过。
     * @param manifest 未受信的 JSON 数据。
     * @param inventory 独立重新读取的权威分母。
     * @param reader 从实际证据读取的可信端口。
     * @returns 保留完整分母的有界验收结果。
     */
    public static validate(manifest: unknown, inventory: ICoverageInventory, reader: ICoverageEvidenceReader): ICoverageValidation {
        const issues: string[] = [];
        let issueCount = 0;
        const issue = (code: string): void => {
            issueCount += 1;
            if (issues.length < 100) {
                issues.push(code);
            }
        };
        const required = new Map(inventory.targets.flatMap((target) => target.actions.map((action) =>
            [CoverageManifestGenerator.caseId(inventory.creatorVersion, target.id, action), { target, action }] as const)));
        let passed = 0;
        let notApplicable = 0;
        let inventorySha256: string;
        try {
            CoverageManifestGenerator.assertInventory(inventory);
            inventorySha256 = CoverageManifestGenerator.digest(inventory);
        } catch {
            issue('coverage_inventory_invalid');
            return { ok: false, requiredCases: required.size, passed, notApplicable, issueCount, issues };
        }
        if (!this.record(manifest) || !this.exactKeys(manifest, ['schemaVersion', 'creatorVersion', 'inventorySha256', 'cases'])
            || manifest.schemaVersion !== 1 || manifest.creatorVersion !== inventory.creatorVersion
            || manifest.inventorySha256 !== inventorySha256
            || !Array.isArray(manifest.cases) || manifest.cases.length > 40_000) {
            issue('coverage_manifest_binding_or_shape_invalid');
            return { ok: false, requiredCases: required.size, passed, notApplicable, issueCount, issues };
        }
        const seen = new Set<string>();
        const rows: readonly unknown[] = manifest.cases;
        for (const row of rows) {
            if (!this.record(row) || !this.exactKeys(row, ['id', 'targetId', 'action', 'fixture', 'dependencies', 'readback', 'status', 'result'])
                || typeof row.id !== 'string' || row.id.length > 512 || typeof row.targetId !== 'string'
                || row.targetId.length > 512 || typeof row.action !== 'string' || row.action.length > 128) {
                issue('coverage_case_shape_invalid');
                continue;
            }
            const expected = required.get(row.id);
            if (expected == null || expected.target.id !== row.targetId || expected.action !== row.action) {
                issue('coverage_case_unexpected');
                continue;
            }
            if (seen.has(row.id)) {
                issue(`coverage_case_duplicate:${row.id}`);
                continue;
            }
            seen.add(row.id);
            if (row.status !== 'passed' && row.status !== 'not_applicable') {
                issue(`coverage_case_unverified:${row.id}`);
                continue;
            }
            if (expected.target.availability === 'unverified'
                || (row.status === 'not_applicable') !== (expected.target.availability === 'unsupported')) {
                issue(`coverage_case_availability_unsubstantiated:${row.id}`);
                continue;
            }
            try {
                if (row.status === 'passed') {
                    const actualFixture = this.fixture(row.fixture, reader);
                    if (actualFixture == null || typeof row.readback !== 'string' || row.readback.trim().length === 0
                        || row.readback.length > 2048 || !Array.isArray(row.dependencies) || row.dependencies.length > 1024) {
                        issue(`coverage_fixture_or_readback_missing:${row.id}`);
                        continue;
                    }
                    const dependencies = new Set<string>();
                    let dependenciesValid = true;
                    const dependencyEntries: readonly unknown[] = row.dependencies;
                    for (const dependency of dependencyEntries) {
                        if (!this.fixture(dependency, reader) || !this.record(dependency) || typeof dependency.reference !== 'string'
                            || dependencies.has(dependency.reference)) {
                            dependenciesValid = false;
                            break;
                        }
                        dependencies.add(dependency.reference);
                    }
                    if (!dependenciesValid) {
                        issue(`coverage_dependency_invalid:${row.id}`);
                        continue;
                    }
                    if (dependencyEntries.length !== actualFixture.dependencies.length
                        || !actualFixture.dependencies.every((expectedDependency) => dependencyEntries.some((dependency) =>
                            this.reference(dependency) && dependency.reference === expectedDependency.reference
                            && dependency.sha256 === expectedDependency.sha256))) {
                        issue(`coverage_dependency_closure_mismatch:${row.id}`);
                        continue;
                    }
                } else if (row.fixture !== null || row.readback !== null || !Array.isArray(row.dependencies)
                    || row.dependencies.length !== 0) {
                    issue(`coverage_not_applicable_shape_invalid:${row.id}`);
                    continue;
                }
                const result = this.result(row.result, reader);
                if (result == null || result.creatorVersion !== inventory.creatorVersion || result.caseId !== row.id
                    || result.outcome !== row.status || result.nativeVerified !== true || result.rawLogsVerified !== true
                    || result.warnings !== 0 || result.errors !== 0 || result.readback !== row.readback
                    || row.status === 'passed' && result.readbackVerified !== true) {
                    issue(`coverage_result_unverified:${row.id}`);
                    continue;
                }
                if (row.status === 'passed') {
                    passed += 1;
                } else {
                    notApplicable += 1;
                }
            } catch {
                issue(`coverage_evidence_unavailable:${row.id}`);
            }
        }
        for (const id of required.keys()) {
            if (!seen.has(id)) {
                issue(`coverage_case_missing:${id}`);
            }
        }
        return { ok: issueCount === 0, requiredCases: required.size, passed, notApplicable, issueCount, issues };
    }

    /**
     * @description 复核真实夹具的引用、存在性、摘要和语义有效性。
     * @param value 未受信的夹具描述。
     * @param reader 真实夹具读取端口。
     * @returns 通过摘要绑定的完整夹具证明；缺失或无效时为空。
     */
    private static fixture(value: unknown, reader: ICoverageEvidenceReader): ICoverageResolvedFixture | null {
        if (!this.reference(value)) {
            return null;
        }
        const resolved = reader.fixture(value.reference);
        return resolved != null && resolved.valid === true && resolved.sha256 === value.sha256 ? resolved : null;
    }

    /**
     * @description 复核真实结果的引用及原始内容摘要。
     * @param value 未受信的结果描述。
     * @param reader 独立结果读取端口。
     * @returns 通过摘要绑定的原始结果；缺失时为空。
     */
    private static result(value: unknown, reader: ICoverageEvidenceReader): ICoverageResolvedResult | null {
        if (!this.reference(value)) {
            return null;
        }
        const resolved = reader.result(value.reference);
        return resolved?.sha256 === value.sha256 ? resolved : null;
    }

    /**
     * @description 收窄两个字段的规范证据引用，拒绝额外字段和本机路径。
     * @param value 未受信对象。
     * @returns 是否满足相对引用与完整摘要。
     */
    private static reference(value: unknown): value is { readonly reference: string; readonly sha256: string } {
        return this.record(value) && this.exactKeys(value, ['reference', 'sha256'])
            && CoverageManifestGenerator.relativeReference(value.reference)
            && typeof value.sha256 === 'string' && /^[0-9a-f]{64}(?![\s\S])/u.test(value.sha256);
    }

    /**
     * @description 检查普通 JSON 对象。
     * @param value 待收窄的数据。
     * @returns 是否为非数组对象。
     */
    private static record(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    }

    /**
     * @description 严格拒绝缺失字段和未知字段。
     * @param value 已收窄对象。
     * @param keys 当前契约的全部字段。
     * @returns 字段集合是否完全相同。
     */
    private static exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
        return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
    }
}
