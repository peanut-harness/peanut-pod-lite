import type { IResourceCampaignExpectation, IResourceCampaignPlan, IResourceCampaignPort, IResourceCaseObservation,
    IResourceCallOutcome, IResourceCommand, IResourceSessionIdentity, IResourceSnapshot } from './resource-stability-contracts.mts';
import { ResourceStabilityReadiness } from './resource-stability-readiness.mts';
import { ResourceStabilityRunner } from './resource-stability-runner.mts';
import { ResourceStabilityPreparationRefusal } from './resource-stability-preparation-refusal.mts';

/**
 * @description 工程专属认证连接与独立只读观测端口；实现方每次请求重读 descriptor 和原进程身份。
 */
export interface IResourceManagedConnection {
    mcp(body: Readonly<Record<string, unknown>>): Promise<unknown>;
    identity(): Promise<IResourceSessionIdentity>;
    nativeSnapshot(relativePath: string): Promise<IResourceSnapshot>;
    sourceHashes(relativePath: string): Promise<string>;
    sourceContentSha256?(relativePath: string): Promise<string>;
    fixtureSourceSha256(absolutePath: string): Promise<string>;
    recordObservation(observation: IResourceCaseObservation): Promise<void>;
    recordFailure(caseId: string, code: string): Promise<void>;
}

/**
 * @description 仅调用既有公共 MCP 控制入口；没有内部 SDK 写端口，也不切换 all。
 */
export class ResourceStabilityManagedPort implements IResourceCampaignPort {
    /**
     * @description 已追加到本轮证据的观察，包括后续语义校验失败的事实；异常不能清空此前步骤。
     */
    public readonly observations: IResourceCaseObservation[] = [];
    public constructor(private readonly plan: IResourceCampaignPlan,
        private readonly expected: IResourceCampaignExpectation, private readonly connection: IResourceManagedConnection) {
        ResourceStabilityRunner.validatePlan(plan, expected);
    }

    /**
     * @description 每次写前由 runner 比对实际身份；准入检查不修改附件。
     */
    public async preflight(): Promise<IResourceSessionIdentity> {
        const identity = await this.connection.identity();
        for (const key of ['creatorVersion', 'owner', 'change', 'hostSha256', 'coreSha256', 'sourceCommit',
            'projectPath', 'projectName', 'runId', 'creatorPid', 'creatorStartedAt'] as const) {
            if (identity[key] !== this.expected[key]) throw new Error('resource_managed_identity_mismatch');
        }
        const catalog = await this.connection.mcp({ action: 'catalog' });
        const status = await this.connection.mcp({ action: 'status' });
        const attachment = this.record(await this.connection.mcp({ action: 'queryCapabilityAttachments' })).attachment;
        if (!ResourceStabilityReadiness.check(this.plan, this.expected, { catalog, status, attachment }).ready) {
            throw new Error('resource_managed_readiness_failed');
        }
        return identity;
    }

    /**
     * @description 每笔单独签发与资源精确匹配的一次性令牌；失败及状态未知均不重试。
     */
    public async call(command: IResourceCommand, namespace: string): Promise<IResourceCallOutcome> {
        if (namespace !== this.plan.namespace || !this.plan.cases.some((row) => [row.command, ...row.setup, ...row.afterCommands ?? []].includes(command))) {
            throw new Error('resource_managed_command_not_in_plan');
        }
        await this.preflight();
        let input: Readonly<Record<string, unknown>> = command.input;
        if (command.nativeBindings !== undefined) {
            const bound = structuredClone(command.input);
            for (const [pointer, reference] of Object.entries(command.nativeBindings)) {
                const snapshot = await this.snapshot(reference.assetPath);
                const uuid = ResourceStabilityRunner.referenceUuid(reference, snapshot);
                const keys = pointer.slice(1).split('/'); let current: Record<string, unknown> = bound;
                for (const key of keys.slice(0, -1)) {
                    const child: unknown = current[key];
                    if (!child || typeof child !== 'object') throw new Error('resource_managed_binding_slot_missing');
                    current = child as Record<string, unknown>;
                }
                const key = keys.at(-1);
                if (!key || current[key] !== null) throw new Error('resource_managed_binding_slot_not_null');
                current[key] = uuid;
            }
            input = bound;
            await this.preflight();
        }
        if (command.write) {
            if (!Array.isArray(input.resources) || input.resources.length === 0) throw new Error('resource_managed_resources_missing');
            const issued = this.record(await this.connection.mcp({ action: 'issueApprovalToken', operations: [command.name],
                resources: input.resources, maxRisk: command.destructive ? 'destructive' : 'write' }));
            if (typeof issued.approvalToken !== 'string' || !issued.approvalToken || issued.liteMirrored !== true) {
                throw new Error('resource_managed_approval_mirror_missing');
            }
            input = { ...input, approvalToken: issued.approvalToken };
        }
        let response: unknown;
        try { response = await this.connection.mcp({ action: 'call', name: command.name, input }); }
        catch (error) {
            const negative = this.plan.cases.find((row) => row.command === command && row.expectedRejection === true);
            if (!(error instanceof ResourceStabilityPreparationRefusal) || !negative
                || !negative.rejectionCodes.includes(error.message)
                || !ResourceStabilityPreparationRefusal.fromResponse({ ok: false, error: error.message, failure: error.failure }, command.name)) throw error;
            return { status: 'rejected', rejectionCode: error.message, postflightVerified: false };
        }
        const result = this.record(response);
        if (result.taskStatus === 'rejected') throw new Error('resource_managed_untrusted_rejection');
        if (command.write) {
            const postflight = this.record(result.postflight ?? result.taskPostflight);
            if (result.taskStatus !== 'succeeded' || postflight.verified !== true || result.available === false) {
                throw new Error('resource_managed_write_unverified');
            }
        } else if (result.available === false || result.taskStatus === 'failed') {
            throw new Error('resource_managed_read_unavailable');
        }
        return { status: 'succeeded', rejectionCode: null, postflightVerified: command.write };
    }

    /**
     * @description 读回仍须真正的原生观测；禁止把 serialized-only 重标成 native。
     */
    public async snapshot(path: string): Promise<IResourceSnapshot> {
        const value = await this.connection.nativeSnapshot(path);
        if (value.path !== path || value.readbackOrigin !== 'creator-native') throw new Error('resource_managed_native_readback_missing');
        return value;
    }
    /**
     * @description 源和 metadata 的原始摘要。
     */
    public sourceHashes(path: string): Promise<string> { return this.connection.sourceHashes(path); }
    /**
     * @description 不以包含path/meta的摘要替代单源proof；缺少真实读取口拒绝。
     */
    public sourceContentSha256(path: string): Promise<string> {
        if (!this.connection.sourceContentSha256) throw new Error('resource_managed_source_content_reader_missing');
        return this.connection.sourceContentSha256(path);
    }
    /**
     * @description 导入前对已审查输入再计算摘要。
     */
    public fixtureSourceSha256(path: string): Promise<string> { return this.connection.fixtureSourceSha256(path); }
    /**
     * @description 仅持久化 runner 观察，不复制令牌或内部响应。
     */
    public async recordObservation(observation: IResourceCaseObservation): Promise<void> {
        await this.connection.recordObservation(observation);
        this.observations.push(observation);
    }
    /**
     * @description 失败也追加保留。
     */
    public recordFailure(caseId: string, code: string): Promise<void> { return this.connection.recordFailure(caseId, code); }
    /**
     * @description 未受信 Hub 响应必须为对象。
     */
    private record(value: unknown): Record<string, unknown> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource_managed_response_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
