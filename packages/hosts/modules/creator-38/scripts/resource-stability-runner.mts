import { isDeepStrictEqual } from 'node:util';
import { isAbsolute } from 'node:path';
import { ResourceStabilitySafeFailure } from './resource-stability-safe-failure.mts';
import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCampaignPort, IResourceCaseObservation,
    IResourceCasePlan, IResourceCommand, IResourceNativeReference, IResourceSemanticAuthority, IResourceSessionIdentity, IResourceSnapshot } from './resource-stability-contracts.mts';

/**
 * @description 只沿既有原生端口串行执行完整计划；任何不确定结果停止，不盲目重试写入。
 */
export class ResourceStabilityRunner {
    /**
     * @description 在写入前核对完整 scope、字段拒绝码和所有路径。
     * @param plan manifest 驱动计划。
     * @param expected 独立重算的可信预期。
     */
    public static validatePlan(plan: IResourceCampaignPlan, expected: IResourceCampaignExpectation): void {
        if (!/^assets\/fixtures\/resource-stability\/[a-z0-9][a-z0-9-]{0,95}$/u.test(plan.namespace)
            || plan.namespace !== expected.namespace || plan.creatorVersion !== expected.creatorVersion
            || plan.inventorySha256 !== expected.inventorySha256 || !/^[a-f0-9]{64}$/u.test(plan.inventorySha256)) {
            throw new Error('resource_campaign_plan_identity_invalid');
        }
        const required = new Set(expected.requiredCaseIds);
        const actual = new Set(plan.cases.map((row) => row.caseId));
        if (required.size !== expected.requiredCaseIds.length || actual.size !== plan.cases.length
            || required.size !== actual.size || [...required].some((id) => !actual.has(id)) || required.size === 0) {
            throw new Error('resource_campaign_case_scope_mismatch');
        }
        for (const row of plan.cases) {
            if (row.expectedAuthorities !== undefined) {
                if (!row.expectedAuthorities || typeof row.expectedAuthorities !== 'object' || Array.isArray(row.expectedAuthorities)) {
                    throw new Error('resource_campaign_authority_contract_invalid');
                }
                const entries = Object.entries(row.expectedAuthorities);
                if (entries.length === 0 || entries.length > 128 || entries.length !== Object.keys(row.expectedSemantic).length
                    || entries.some(([pointer, authority]) => !authority || typeof authority !== 'object' || Array.isArray(authority)
                        || !Object.hasOwn(row.expectedSemantic, pointer)
                        || !['runtime-object', 'importer-meta', 'source-text', 'asset-db'].includes(authority.kind)
                        || authority.creatorVersion !== plan.creatorVersion || !/^[a-f0-9]{64}$/u.test(authority.sourceSha256)
                        || !/^[A-Za-z0-9._:-]{1,96}$/u.test(authority.readerId))) {
                    throw new Error('resource_campaign_authority_contract_invalid');
                }
            }
            if (!row.caseId.startsWith(`${plan.creatorVersion}|`) || !row.caseId.endsWith(`|${row.action}`)
                || !['create', 'import', 'query', 'inspect', 'read', 'patch', 'set', 'reject_invalid', 'reject_write',
                    'copy', 'move', 'rename', 'refresh', 'delete', 'save', 'reopen'].includes(row.action)) {
                throw new Error('resource_campaign_case_identity_invalid');
            }
            if (row.expectedRejection !== ['reject_invalid', 'reject_write'].includes(row.action)
                || (row.expectedRejection && (row.rejectionCodes.length === 0 || row.rejectionCodes.some((c) => c.includes('*'))))) {
                throw new Error('resource_campaign_rejection_contract_invalid');
            }
            if (row.expectedReferences !== undefined) {
                this.assertReferenceMap(row.expectedReferences, plan.namespace, expected.creatorVersion);
                for (const pointer of Object.keys(row.expectedReferences)) {
                    if (!Object.hasOwn(row.expectedSemantic, pointer) || row.expectedSemantic[pointer] !== null) {
                        throw new Error('resource_campaign_reference_placeholder_invalid');
                    }
                }
            }
            this.assertPath(row.beforePath, plan.namespace);
            this.assertPath(row.afterPath, plan.namespace);
            if (row.expectedRejection && row.afterCommands?.length) throw new Error('resource_campaign_rejection_after_commands');
            for (const command of [...row.setup, row.command, ...row.afterCommands ?? []]) this.assertCommand(command, plan.namespace, expected);
        }
    }

    /**
     * @description 身份核对成功后按依赖顺序执行；此方法不启动或关闭 Creator。
     * @param plan 经过完整性核对的计划。
     * @param expected 当前任务和候选身份。
     * @param port 已登记隔离工程的原生端口。
     * @returns 所有实际用例观察；没有 lifecycle 原始日志验证时不宣称 campaign 通过。
     */
    public static async run(plan: IResourceCampaignPlan, expected: IResourceCampaignExpectation,
        port: IResourceCampaignPort): Promise<readonly IResourceCaseObservation[]> {
        this.validatePlan(plan, expected);
        this.assertSession(await port.preflight(), expected);
        const observations: IResourceCaseObservation[] = [];
        for (const row of plan.cases) {
            try {
                for (const setup of row.setup) {
                    this.assertSession(await port.preflight(), expected);
                    await this.assertFixtureHashes(setup, expected, port);
                    const outcome = await port.call(setup, plan.namespace);
                    if (outcome.status !== 'succeeded' || (setup.write && !outcome.postflightVerified)) {
                        throw new Error(`resource_campaign_setup_failed:${row.caseId}`);
                    }
                }
                const referenceSnapshots: Record<string, IResourceSnapshot> = {};
                for (const [pointer, reference] of Object.entries(row.expectedReferences ?? {})) {
                    referenceSnapshots[pointer] = await port.snapshot(reference.assetPath);
                    this.referenceUuid(reference, referenceSnapshots[pointer]);
                }
                const before = await port.snapshot(row.beforePath);
                const beforeHash = await port.sourceHashes(row.beforePath);
                await this.assertFixtureHashes(row.command, expected, port);
                this.assertSession(await port.preflight(), expected);
                const outcome = await port.call(row.command, plan.namespace);
                if (outcome.status === 'succeeded') for (const command of row.afterCommands ?? []) {
                    const afterOutcome = await port.call(command, plan.namespace);
                    if (afterOutcome.status !== 'succeeded' || command.write && !afterOutcome.postflightVerified) {
                        throw new Error('resource_campaign_after_command_failed');
                    }
                }
                const after = await port.snapshot(row.afterPath);
                const afterHash = await port.sourceHashes(row.expectedRejection ? row.beforePath : row.afterPath);
                this.assertSession(await port.preflight(), expected);
                const observation: IResourceCaseObservation = {
                    caseId: row.caseId, action: row.action, before, after, referenceSnapshots,
                    rejected: outcome.status === 'rejected', failure: outcome.rejectionCode,
                    postflightVerified: outcome.postflightVerified,
                    beforeSourceSha256: beforeHash, afterSourceSha256: afterHash,
                    preservedSource: row.action === 'copy' ? await port.snapshot(row.beforePath) : null,
                    preservedSourceSha256: row.action === 'copy' ? await port.sourceHashes(row.beforePath) : null,
                    obsoletePath: ['move', 'rename'].includes(row.action) ? await port.snapshot(row.beforePath) : null,
                };
                observations.push(observation);
                await port.recordObservation(observation);
                const issues = this.validateObservation(row, observation);
                if (issues.length > 0) throw new Error(`resource_campaign_case_failed:${row.caseId}:${issues.join(',')}`);
            } catch (error: unknown) {
                const code = ResourceStabilitySafeFailure.code(error);
                await port.recordFailure(row.caseId, code);
                throw new Error(`resource_campaign_case_incomplete_or_failed:${row.caseId}:${code}`, { cause: new Error(code) });
            }
        }
        return observations;
    }

    /**
     * @description 核对真实身份、引用和 Inspector 语义；不接受传入 passed 标志。
     * @param row 用例的可信计划。
     * @param observed 原生观察。
     * @returns 全部稳定失败代码。
     */
    public static validateObservation(row: IResourceCasePlan, observed: IResourceCaseObservation): string[] {
        const issues: string[] = [];
        const authoritySnapshot = row.expectedRejection || row.action === 'delete' ? observed.before : observed.after;
        for (const [pointer, expected] of Object.entries(row.expectedAuthorities ?? {})) {
            if (!isDeepStrictEqual(authoritySnapshot.authorities?.[pointer], expected)) issues.push(`semantic_authority_mismatch:${pointer}`);
        }
        if (row.caseId !== observed.caseId || row.action !== observed.action
            || observed.before.path !== row.beforePath || observed.after.path !== row.afterPath) issues.push('observation_mismatch');
        if (!/^[a-f0-9]{64}$/u.test(observed.beforeSourceSha256) || !/^[a-f0-9]{64}$/u.test(observed.afterSourceSha256)) issues.push('source_digest_invalid');
        if (row.expectedRejection) {
            this.checkRegistered(observed.before, issues);
            if (observed.before.readbackOrigin !== 'creator-native') issues.push('native_readback_missing');
            if (!observed.rejected || !row.rejectionCodes.includes(observed.failure ?? '')) issues.push('expected_rejection_missing');
            if (!isDeepStrictEqual(observed.before, observed.after) || observed.beforeSourceSha256 !== observed.afterSourceSha256) issues.push('rejection_changed_source');
            return issues;
        }
        if (observed.rejected || observed.failure !== null) issues.push('operation_failed');
        if (row.command.write && !observed.postflightVerified) issues.push('postflight_missing');
        const after = observed.after;
        if (row.action === 'delete') {
            this.checkRegistered(observed.before, issues);
            if (observed.before.readbackOrigin !== 'creator-native' || after.readbackOrigin !== 'creator-native') issues.push('native_readback_missing');
            if (after.exists || after.metaUuid !== null || after.assetDbUuid !== null || after.subassets.length > 0) issues.push('delete_residue');
            if (after.unresolvedReferences.length > 0) issues.push('unresolved_reference');
            return issues;
        }
        this.checkRegistered(after, issues);
        if (!['create', 'import'].includes(row.action)) this.checkRegistered(observed.before, issues);
        if (after.readbackOrigin !== 'creator-native'
            || !['create', 'import'].includes(row.action) && observed.before.readbackOrigin !== 'creator-native') issues.push('native_readback_missing');
        if (['create', 'import'].includes(row.action) && observed.before.exists) issues.push('creation_overwrote_source');
        if (row.action === 'copy') {
            this.checkRegistered(observed.before, issues);
            if (observed.before.metaUuid === after.metaUuid) issues.push('copy_reused_uuid');
            if (!isDeepStrictEqual(observed.preservedSource, observed.before)
                || observed.preservedSourceSha256 !== observed.beforeSourceSha256) issues.push('copy_changed_source');
            if (observed.before.subassets.some((s) => after.subassets.some((d) => d.metaUuid === s.metaUuid))) issues.push('copy_reused_subasset');
            if (!isDeepStrictEqual(observed.before.subassets.map((s) => s.metaUuid.split('@')[1]).sort(),
                after.subassets.map((s) => s.metaUuid.split('@')[1]).sort())) issues.push('copy_subasset_closure_changed');
        } else if (!['create', 'import'].includes(row.action)) {
            if (observed.before.metaUuid !== after.metaUuid) issues.push('identity_changed');
            if (!isDeepStrictEqual(observed.before.subassets.map((s) => s.metaUuid).sort(),
                after.subassets.map((s) => s.metaUuid).sort())) issues.push('subasset_identity_changed');
        }
        if (['move', 'rename'].includes(row.action)) {
            if (row.beforePath === row.afterPath || observed.obsoletePath === null || observed.obsoletePath.exists
                || observed.obsoletePath.metaUuid !== null || observed.obsoletePath.assetDbUuid !== null
                || observed.obsoletePath.subassets.length > 0) issues.push('old_path_still_registered');
        }
        if (['query', 'inspect', 'read'].includes(row.action)
            && (observed.beforeSourceSha256 !== observed.afterSourceSha256
                || !isDeepStrictEqual(observed.before, after))) issues.push('read_changed_source');
        for (const [pointer, literal] of Object.entries(row.expectedSemantic)) {
            let expected = literal;
            const reference = row.expectedReferences?.[pointer];
            if (reference) {
                try { expected = this.referenceUuid(reference, observed.referenceSnapshots?.[pointer]); }
                catch { issues.push(`reference_identity_invalid:${pointer}`); continue; }
            }
            if (!pointer.startsWith('/') || !isDeepStrictEqual(this.pointer(after.semantic, pointer), expected)) issues.push(`semantic_mismatch:${pointer}`);
        }
        if (Object.keys(row.expectedSemantic).length === 0) issues.push('semantic_contract_missing');
        return issues;
    }

    /**
     * @description 引用必须有同版SDK来源证明且数量有界，禁止原型路径与外部目录。
     */
    private static assertReferenceMap(references: Readonly<Record<string, IResourceNativeReference>>, namespace: string,
        creatorVersion: string): void {
        if (!references || typeof references !== 'object' || Array.isArray(references)
            || Object.keys(references).length === 0 || Object.keys(references).length > 32) throw new Error('resource_campaign_reference_contract_invalid');
        for (const [pointer, reference] of Object.entries(references)) {
            if (!/^\/(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)(?:\/(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+))*$/u.test(pointer)
                || pointer.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
                || !reference || typeof reference !== 'object' || typeof reference.assetPath !== 'string'
                || !/^[A-Za-z][A-Za-z0-9_.]{0,95}$/u.test(reference.expectedType)
                || !this.validAuthority(reference.expectedAuthority, creatorVersion)) throw new Error('resource_campaign_reference_contract_invalid');
            if (reference.expectedAuthority.kind !== 'runtime-object') throw new Error('resource_campaign_reference_authority_invalid');
            this.assertPath(reference.assetPath, namespace);
        }
    }

    /**
     * @description SDK来源必须精确绑定版本、固定reader与源码摘要。
     */
    private static validAuthority(authority: IResourceSemanticAuthority | undefined, version: string): boolean {
        return !!authority && typeof authority === 'object' && !Array.isArray(authority)
            && ['runtime-object', 'importer-meta', 'source-text', 'asset-db'].includes(authority.kind)
            && authority.creatorVersion === version && /^[a-f0-9]{64}$/u.test(authority.sourceSha256)
            && /^[A-Za-z0-9._:-]{1,96}$/u.test(authority.readerId);
    }

    /**
     * @description 从真实原生登记快照解析引用，序列化文件和不匹配来源不能充当UUID依据。
     */
    public static referenceUuid(reference: IResourceNativeReference, snapshot: IResourceSnapshot | undefined): string {
        const issues: string[] = [];
        if (!snapshot) throw new Error('resource_campaign_reference_snapshot_missing');
        this.checkRegistered(snapshot, issues);
        if (reference.expectedAuthority.kind !== 'runtime-object' || issues.length || snapshot.path !== reference.assetPath || snapshot.readbackOrigin !== 'creator-native'
            || this.pointer(snapshot.semantic, '/type') !== reference.expectedType
            || !isDeepStrictEqual(snapshot.authorities?.['/type'], reference.expectedAuthority)) {
            throw new Error('resource_campaign_reference_identity_invalid');
        }
        return snapshot.metaUuid as string;
    }

    /**
     * @description 校验原生登记与引用，防止磁盘文件存在被误报成功。
     */
    private static checkRegistered(snapshot: IResourceSnapshot, issues: string[]): void {
        if (!snapshot.exists || snapshot.metaUuid === null || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(snapshot.metaUuid)
            || snapshot.assetDbUuid !== snapshot.metaUuid) issues.push('root_registration_missing');
        if (snapshot.subassets.some((s) => s.assetDbUuid !== s.metaUuid || !s.metaUuid.startsWith(`${snapshot.metaUuid}@`))) issues.push('subasset_registration_missing');
        if (new Set(snapshot.subassets.map((s) => s.metaUuid)).size !== snapshot.subassets.length) issues.push('subasset_registration_duplicate');
        if (snapshot.unresolvedReferences.length > 0) issues.push('unresolved_reference');
    }

    /**
     * @description 核对项目绑定与精确 Host/Core 候选，不以版本号替代摘要。
     */
    private static assertSession(actual: IResourceSessionIdentity, expected: IResourceCampaignExpectation): void {
        for (const key of ['creatorVersion', 'owner', 'change', 'hostSha256', 'coreSha256', 'sourceCommit',
            'projectPath', 'projectName', 'runId', 'creatorPid', 'creatorStartedAt'] as const) {
            if (actual[key] !== expected[key]) throw new Error(`resource_campaign_session_mismatch:${key}`);
        }
        if (!/^[a-f0-9]{40}$/u.test(actual.sourceCommit)
            || !/^[a-f0-9]{64}$/u.test(actual.hostSha256) || !/^[a-f0-9]{64}$/u.test(actual.coreSha256)
            || !isAbsolute(actual.projectPath) || !Number.isSafeInteger(actual.creatorPid) || actual.creatorPid <= 0
            || !Number.isFinite(Date.parse(actual.creatorStartedAt))
            || !/^[a-z0-9][a-z0-9-]{0,95}$/u.test(actual.runId)) {
            throw new Error('resource_campaign_candidate_identity_invalid');
        }
    }

    /**
     * @description 全部变更目标只允许本次运行独占的命名空间。
     */
    private static assertPath(relative: string, namespace: string): void {
        if (relative !== namespace && !relative.startsWith(`${namespace}/`)) throw new Error('resource_campaign_path_out_of_scope');
        if (relative.includes('\\') || relative.split('/').some((p) => p === '.' || p === '..' || p === '')) throw new Error('resource_campaign_path_invalid');
    }

    /**
     * @description 排除计划注入 token 和跨任务路径；源输入只能由已核实 fixture resolver 装配。
     */
    private static assertCommand(command: IResourceCommand, namespace: string, expected: IResourceCampaignExpectation): void {
        if (command.nativeBindings !== undefined) {
            this.assertReferenceMap(command.nativeBindings, namespace, expected.creatorVersion);
            if (!Array.isArray(command.input.resources) || command.input.resources.length === 0
                || command.input.resources.length > 256) throw new Error('resource_campaign_binding_resources_invalid');
            for (const resource of command.input.resources) {
                if (typeof resource !== 'string') throw new Error('resource_campaign_binding_resources_invalid');
                this.assertPath(resource, namespace);
            }
            if (command.name !== 'peanut.editor-mcp.lumen-asset-set') throw new Error('resource_campaign_binding_command_invalid');
            for (const [pointer, reference] of Object.entries(command.nativeBindings)) {
                if (!/^\/props\/[A-Za-z_][A-Za-z0-9_]*(?:\/(?:0|[1-9][0-9]{0,3}))?$/u.test(pointer)
                    || pointer.split('/').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
                    || this.pointer(command.input, pointer) !== null
                    || !Array.isArray(command.input.resources) || !command.input.resources.includes(reference.assetPath)) {
                    throw new Error('resource_campaign_binding_placeholder_invalid');
                }
            }
        }
        const suffix = command.name.replace(/^peanut\.editor-mcp\./u, '');
        const writeTools = ['asset-import', 'asset-copy', 'asset-move', 'asset-rename', 'asset-create-folder', 'asset-delete',
            'asset-reimport', 'asset-open', 'lumen-scaffold', 'lumen-asset-set', 'lumen-node-set', 'lumen-commit'];
        const readTools = ['asset-query-info', 'asset-query-dependencies', 'asset-import-plan', 'asset-wait-ready', 'lumen-inspect', 'lumen-validate-refs'];
        if (command.name !== `peanut.editor-mcp.${suffix}` || ![...writeTools, ...readTools].includes(suffix)
            || command.write !== writeTools.includes(suffix) || command.destructive && !command.write
            || suffix === 'asset-delete' && !command.destructive) throw new Error('resource_campaign_command_invalid');
        for (const [key, value] of Object.entries(command.input)) {
            this.assertNoCredentials(key, value);
            if (['path', 'url', 'from', 'to', 'target', 'targetDirectory', 'assetRelativePath', 'prefabRelativePath', 'pathOrUuid', 'dbPath'].includes(key)) {
                if (typeof value !== 'string') throw new Error('resource_campaign_path_invalid');
                this.assertPath(value.replace(/^db:\/\//u, ''), namespace);
            }
            if (key === 'paths') {
                if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) throw new Error('resource_campaign_path_invalid');
                for (const relative of value as string[]) this.assertPath(relative.replace(/^db:\/\//u, ''), namespace);
            }
        }
        const required: Record<string, readonly (readonly string[])[]> = {
            'asset-import': [['target']], 'asset-copy': [['paths'], ['targetDirectory']], 'asset-move': [['from'], ['to']],
            'asset-rename': [['path']], 'asset-create-folder': [['path']], 'asset-delete': [['paths']],
            'asset-reimport': [['path', 'paths']], 'asset-open': [['path', 'url']],
            'lumen-scaffold': [['assetRelativePath', 'prefabRelativePath']],
            'lumen-asset-set': [['assetRelativePath', 'prefabRelativePath']],
            'lumen-node-set': [['prefabRelativePath']], 'lumen-commit': [['assetRelativePath', 'prefabRelativePath']],
            'lumen-inspect': [['assetRelativePath', 'prefabRelativePath']], 'lumen-validate-refs': [['assetRelativePath', 'prefabRelativePath']],
            'asset-query-info': [['pathOrUuid']], 'asset-query-dependencies': [['dbPath']], 'asset-wait-ready': [['paths']],
        };
        if ((required[suffix] ?? []).some((alternatives) => !alternatives.some((key) => Object.hasOwn(command.input, key)))) {
            throw new Error('resource_campaign_unbounded_command');
        }
        if (suffix === 'asset-rename' && (typeof command.input.newName !== 'string'
            || !command.input.newName.trim() || /[/\\:]/u.test(command.input.newName)
            || ['.', '..'].includes(command.input.newName))) throw new Error('resource_campaign_rename_invalid');
        if ((command.input.overwrite === true || command.input.mode === 'override' || command.input.reset === true)
            && !command.destructive) throw new Error('resource_campaign_destructive_flag_missing');
        if (['asset-import', 'asset-import-plan'].includes(suffix)) {
            const sources = command.input.sources;
            if (!Array.isArray(sources) || sources.length === 0 || command.input.expandClosure !== false
                || Object.hasOwn(command.input, 'dependencyMap') || command.input.allowMissingDependencies === true
                || sources.some((source) => typeof source !== 'string' || !isAbsolute(source)
                    || !Object.hasOwn(expected.fixtureSources, source)
                    || !/^[a-f0-9]{64}$/u.test(expected.fixtureSources[source] ?? ''))) {
                throw new Error('resource_campaign_fixture_source_unapproved');
            }
        }
    }

    /**
     * @description 审查过的源文件也在每次导入前重新核对，不沿用静态 catalog 结论。
     */
    private static async assertFixtureHashes(command: IResourceCommand, expected: IResourceCampaignExpectation,
        port: IResourceCampaignPort): Promise<void> {
        if (!['peanut.editor-mcp.asset-import', 'peanut.editor-mcp.asset-import-plan'].includes(command.name)) return;
        for (const source of command.input.sources as string[]) {
            if (await port.fixtureSourceSha256(source) !== expected.fixtureSources[source]) {
                throw new Error('resource_campaign_fixture_source_changed');
            }
        }
    }

    /**
     * @description 计划只保存可复审参数，任何嵌套审批凭据均拒绝。
     */
    private static assertNoCredentials(key: string, value: unknown): void {
        if (/token|password|secret/iu.test(key)) throw new Error('resource_campaign_credential_in_plan');
        if (value !== null && typeof value === 'object') {
            for (const [nestedKey, nested] of Object.entries(value)) this.assertNoCredentials(nestedKey, nested);
        }
    }

    /**
     * @description 读取显式 JSON Pointer；缺字段返回 undefined，使语义核对失败。
     */
    private static pointer(value: unknown, pointer: string): unknown {
        let current = value;
        for (const part of pointer.slice(1).split('/')) {
            const key = part.replace(/~1/gu, '/').replace(/~0/gu, '~');
            if (current === null || typeof current !== 'object') return undefined;
            current = (current as Record<string, unknown>)[key];
        }
        return current;
    }
}
