import { createHash } from 'node:crypto';

/**
 * @description 离线输入中有限且不带产品通过含义的记录。
 */
export interface IPodCoverageInput {
    /**
     * @description 输入协议版本。
     */
    readonly schemaVersion: 'pod-test-coverage-input.v1';
    /**
     * @description 待核对候选的声明身份。
     */
    readonly candidate: Readonly<Record<string, unknown>>;
    /**
     * @description 独立于用例和结果的来源声明。
     */
    readonly sources: readonly Readonly<Record<string, unknown>>[];
    /**
     * @description 来源所声明的能力分母。
     */
    readonly capabilities: readonly Readonly<Record<string, unknown>>[];
    /**
     * @description 与能力关联的测试定义。
     */
    readonly cases: readonly Readonly<Record<string, unknown>>[];
    /**
     * @description 用户业务主线的用例依赖。
     */
    readonly workflows: readonly Readonly<Record<string, unknown>>[];
    /**
     * @description 可为空的历史或当前执行记录。
     */
    readonly results: readonly Readonly<Record<string, unknown>>[];
}

/**
 * @description 显式根目录内的内容摘要引用。
 */
export interface IPodCoverageReference {
    /**
     * @description 由调用方提供的根目录标识。
     */
    readonly rootId: string;
    /**
     * @description 根目录内的规范相对路径。
     */
    readonly path: string;
    /**
     * @description 引用文件的 SHA-256。
     */
    readonly sha256: string;
}

/**
 * @description 覆盖输入的协议常量与无副作用边界检查。
 */
export class PodCoverageContracts {
    /**
     * @description 单文件允许读取的字节数。
     */
    public static readonly maxFileBytes = 32 * 1024 * 1024;

    /**
     * @description 一次会话允许读取的总字节数。
     */
    public static readonly maxTotalBytes = 128 * 1024 * 1024;

    /**
     * @description JSON 容器的最大嵌套深度。
     */
    public static readonly maxJsonDepth = 64;

    /**
     * @description 输入可以声明的最多用例数。
     */
    public static readonly maxCases = 100_000;

    /**
     * @description 一次会话最多读取的引用文件数。
     */
    public static readonly maxReferences = 1024;

    /**
     * @description 校验并缩窄不可信 JSON；此阶段不推断测试是否通过。
     * @param value 解析后的输入。
     * @returns 结构有效、尚待独立来源与证据核对的输入。
     */
    public static validateInput(value: unknown): IPodCoverageInput {
        const input = this.record(value, ['schemaVersion', 'candidate', 'sources', 'capabilities', 'cases', 'workflows', 'results'], 'input');
        if (input.schemaVersion !== 'pod-test-coverage-input.v1') throw new Error('pod_coverage_schema_version_invalid');
        this.record(input.candidate, ['id', 'repositories', 'environments', 'inputDigests'], 'candidate');
        const collections = ['sources', 'capabilities', 'cases', 'workflows', 'results'] as const;
        for (const collection of collections) {
            const rows = input[collection];
            if (!Array.isArray(rows) || rows.length > this.maxCases) {
                throw new Error(`pod_coverage_${collection}_invalid`);
            }
            const ids = new Set<string>();
            for (const row of rows) {
                const record = this.record(row, this.fields(collection), collection);
                const id = this.identifier(record.id);
                if (ids.has(id)) throw new Error(`pod_coverage_${collection}_duplicate_id`);
                ids.add(id);
                this.checkRow(collection, record);
            }
        }
        const candidate = input.candidate as Readonly<Record<string, unknown>>;
        this.identifier(candidate.id);
        this.record(candidate.repositories, null, 'candidate_repositories');
        this.stringArray(candidate.environments, 'candidate_environments');
        this.record(candidate.inputDigests, null, 'candidate_input_digests');
        return input as unknown as IPodCoverageInput;
    }

    /**
     * @description 验证引用只可访问调用方显式提供的根目录。
     * @param value 待核对的引用。
     * @returns 规范化引用。
     */
    public static reference(value: unknown): IPodCoverageReference {
        const record = this.record(value, ['rootId', 'path', 'sha256'], 'reference');
        const rootId = this.identifier(record.rootId);
        if (!this.relativePath(record.path)) throw new Error('pod_coverage_reference_path_invalid');
        if (!this.digest(record.sha256)) throw new Error('pod_coverage_reference_digest_invalid');
        return { rootId, path: record.path, sha256: record.sha256 };
    }

    /**
     * @description 判断文件引用是否为不含 URL、盘符和穿越的相对路径。
     * @param value 路径输入。
     * @returns 可否在显式根内解析。
     */
    public static relativePath(value: unknown): value is string {
        return typeof value === 'string' && value.length > 0 && value.length <= 2048
            && !/[\\:\u0000-\u001f\u007f]/u.test(value) && !value.startsWith('/')
            && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
    }

    /**
     * @description 核验 SHA-256 小写十六进制格式。
     * @param value 摘要输入。
     * @returns 是否为完整摘要。
     */
    public static digest(value: unknown): value is string {
        return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
    }

    /**
     * @description 计算原始字节的 SHA-256。
     * @param value 文件字节。
     * @returns 小写十六进制摘要。
     */
    public static sha256(value: Uint8Array): string {
        return createHash('sha256').update(value).digest('hex');
    }

    /**
     * @description 验证 JSON 层级与总节点数，不丢弃超限内容。
     * @param value 未受信 JSON。
     * @returns 无返回值。
     */
    public static assertJsonBounds(value: unknown): void {
        let remaining = 250_000;
        const visit = (node: unknown, depth: number): void => {
            if (depth > this.maxJsonDepth || --remaining < 0) throw new Error('pod_coverage_json_bounds_exceeded');
            if (node !== null && typeof node === 'object') {
                for (const child of Object.values(node)) visit(child, depth + 1);
            }
        };
        visit(value, 0);
    }

    /**
     * @description 检查对象键集合与必填字段。
     * @param value 待核对的对象。
     * @param fields 必须且仅可出现的字段；null 表示仅要求对象。
     * @param label 用于稳定错误码的字段标识。
     * @returns 保留原始值的只读键值表。
     */
    public static record(value: unknown, fields: readonly string[] | null, label: string): Readonly<Record<string, unknown>> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`pod_coverage_${label}_invalid`);
        const record = value as Record<string, unknown>;
        if (fields !== null && (Object.keys(record).length !== fields.length || fields.some((key) => !Object.hasOwn(record, key)))) {
            throw new Error(`pod_coverage_${label}_fields_invalid`);
        }
        return record;
    }

    /**
     * @description 检查非空且可稳定表示的标识。
     * @param value 标识输入。
     * @returns 有效标识。
     */
    public static identifier(value: unknown): string {
        if (typeof value !== 'string' || value.length === 0 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/|-]*$/u.test(value)) {
            throw new Error('pod_coverage_identifier_invalid');
        }
        return value;
    }

    /**
     * @description 验证仅包含有限文本的列表。
     * @param value 列表输入。
     * @param label 用于稳定错误码的字段标识。
     * @returns 文本列表。
     */
    public static stringArray(value: unknown, label: string): readonly string[] {
        if (!Array.isArray(value) || value.length > this.maxCases || value.some((item) => typeof item !== 'string' || item.length > 2048)) {
            throw new Error(`pod_coverage_${label}_invalid`);
        }
        return value as string[];
    }

    /**
     * @description 返回各类输入记录的允许字段。
     * @param collection 集合名。
     * @returns 固定协议字段。
     */
    private static fields(collection: 'sources' | 'capabilities' | 'cases' | 'workflows' | 'results'): readonly string[] {
        switch (collection) {
            case 'sources': return ['id', 'repository', 'role', 'commit', 'tree', 'sourceRef', 'sha256', 'kind', 'creatorVersion', 'completeness'];
            case 'capabilities': return ['id', 'ownerRepo', 'sourceId', 'sourceSubject', 'applicability', 'unverifiedReason', 'traceRefs'];
            case 'cases': return ['id', 'capabilityIds', 'layer', 'environment', 'preconditions', 'fixtureRefs', 'commandRef', 'expectedOutcome', 'allowedEffects', 'readback', 'recovery', 'depends'];
            case 'workflows': return ['id', 'kind', 'caseIds', 'depends', 'stopCondition', 'cleanupRule'];
            case 'results': return ['id', 'caseId', 'executionOutcome', 'binding', 'evidenceRefs', 'validatorId', 'completedAt', 'diagnosticRef'];
        }
    }

    /**
     * @description 核验任务 1.1 可确定的字段边界，跨记录关联留给后续任务。
     * @param collection 集合名。
     * @param row 当前记录。
     * @returns 无返回值。
     */
    private static checkRow(collection: 'sources' | 'capabilities' | 'cases' | 'workflows' | 'results', row: Readonly<Record<string, unknown>>): void {
        if (collection === 'sources') {
            const reference = this.reference(row.sourceRef);
            if (!this.digest(row.sha256) || row.sha256 !== reference.sha256) throw new Error('pod_coverage_source_digest_invalid');
        }
        if (collection === 'cases') {
            this.stringArray(row.capabilityIds, 'case_capabilities');
            this.stringArray(row.depends, 'case_dependencies');
            for (const ref of this.array(row.fixtureRefs, 'fixtures')) this.reference(ref);
            this.record(row.commandRef, ['repository', 'cwdRelative', 'executable', 'argv'], 'command');
        }
        if (collection === 'workflows') {
            this.stringArray(row.caseIds, 'workflow_cases');
            this.stringArray(row.depends, 'workflow_dependencies');
        }
        if (collection === 'results') {
            this.array(row.evidenceRefs, 'evidence').forEach((ref) => this.reference(ref));
        }
    }

    /**
     * @description 核验有界列表。
     * @param value 列表输入。
     * @param label 用于稳定错误码的字段标识。
     * @returns 未经业务解释的记录列表。
     */
    private static array(value: unknown, label: string): readonly unknown[] {
        if (!Array.isArray(value) || value.length > this.maxReferences) throw new Error(`pod_coverage_${label}_invalid`);
        return value;
    }
}
