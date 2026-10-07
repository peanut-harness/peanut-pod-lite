import type {
    ContractPayload,
    IMcpAiHandlingGuidance,
    IMcpCapabilityDefinition,
    IMcpJsonSchema,
    LocalizedText,
    McpCapabilityCategory,
    McpCapabilityExecutionModel,
    McpCapabilityExecutionLane,
    McpCapabilityRisk,
    TaskStatus,
} from '@peanut/pod-protocol';

import type { IMcpCapabilityInvocation } from '@peanut/pod-sdk';
import { McpControlFlowRefusal } from './mcp-control-flow-refusal.js';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import type { IProjectWriterBarrierLease } from '@peanut/pod-engine/runtime';

import type { McpPluginExposureMode } from './mcp-capability-registry.js';

/**
 * @description MCP 调用在编辑器审计视图中的当前阶段。
 */
export type McpHubCallStatus = 'pending_approval' | 'approved' | 'succeeded' | 'failed' | 'rejected' | 'expired';

/**
 * @description 面板可展示的 MCP 调用审计摘要；不会包含输入、输出、token 或 bridge 连接标识。
 */
export interface IMcpHubRecentCall extends ContractPayload {
    /**
     * @description 仅用于面板渲染的审计记录标识，不可用于执行操作。
     */
    readonly id: string;
    /**
     * @description 被请求的 capability 名称。
     */
    readonly name: string;
    /**
     * @description capability 的工作台分类。
     */
    readonly category: McpCapabilityCategory;
    /**
     * @description capability 的风险等级。
     */
    readonly risk: McpCapabilityRisk;
    /**
     * @description 调用或写操作计划的当前阶段。
     */
    readonly status: McpHubCallStatus;
    /**
     * @description Hub 接收请求的 Unix 时间戳，单位毫秒。
     */
    readonly requestedAt: number;
    /**
     * @description 终态产生的 Unix 时间戳；仍在等待时为 `null`。
     */
    readonly completedAt: number | null;
    /**
     * @description 已完成调用的执行耗时，单位毫秒；未完成时为 `null`。
     */
    readonly durationMs: number | null;
    /**
     * @description 失败时的安全错误码；不会泄露 capability 原始错误。
     */
    readonly errorCode: string | null;
    /**
     * @description 受管任务标识；inline 调用或尚未入队时为 `null`。
     */
    readonly taskId: string | null;
    /**
     * @description 受管任务状态；inline 调用或尚未入队时为 `null`。
     */
    readonly taskStatus: TaskStatus | null;
}

/**
 * @description 供编辑器面板显示的 MCP capability 摘要。
 */
export interface IMcpHubCapabilitySummary extends ContractPayload {
    /**
     * @description 对外公开的全局工具名称。
     */
    readonly name: string;
    /**
     * @description 工具的人类可读用途。
     */
    readonly description: LocalizedText;
    /**
     * @description capability 的工作台分类。
     */
    readonly category: McpCapabilityCategory;
    /**
     * @description 经 registry 校验的输入 schema。
     */
    readonly inputSchema: IMcpJsonSchema;
    /**
     * @description 写操作成功返回值的最小 schema。
     */
    readonly outputSchema?: IMcpJsonSchema;
    /**
     * @description 工具是否不会修改项目状态。
     */
    readonly readOnly: boolean;
    /**
     * @description 工具对应的风险等级。
     */
    readonly risk: McpCapabilityRisk;
    /**
     * @description capability 的执行模型；未声明时保持 inline。
     */
    readonly executionModel: McpCapabilityExecutionModel;
    /**
     * @description 可选执行车道（editor-mcp 会填）：lumen-offline / editor-ui / preview。
     */
    readonly lane?: McpCapabilityExecutionLane;
    /**
     * @description AI 判定成功、处理失败与重试的机器可读规则。
     */
    readonly aiHandling?: IMcpAiHandlingGuidance;
}

/**
 * @description 供编辑器面板显示的 MCP Hub 当前状态。
 */
export interface IMcpHubStatus extends ContractPayload {
    /**
     * @description 当前宿主是否配置了 MCP Hub。
     */
    readonly isAvailable: boolean;
    /**
     * @description 当前项目是否启用了 MCP Hub。
     */
    readonly isEnabled: boolean;
    /**
     * @description 当前 loopback 监听端口；未启动时为 `null`。
     */
    readonly port: number | null;
    /**
     * @description 本项目偏好的 loopback 端口；仅存于项目 settings，用于重启粘滞，不得跨项目共享。
     */
    readonly preferredPort: number | null;
    /**
     * @description 当前 capability catalog 版本。
     */
    readonly catalogRevision: number;
    /**
     * @description 当前已分享给外部 MCP 客户端的工具。
     */
    readonly capabilities: readonly IMcpHubCapabilitySummary[];
    /**
     * @description 已保持运行但不向 MCP Hub 公开能力的插件标识。
     */
    readonly disabledPluginIds: readonly string[];
    /**
     * @description 已显式允许公开写 capability 的插件标识；其他未关闭插件仅公开只读 capability。
     */
    readonly writeEnabledPluginIds: readonly string[];
    /**
     * @description 测试用直写开关；为 true 时写 capability 可跳过 plan 审批直接执行。
     */
    readonly directWriteEnabled: boolean;
    /**
     * @description 当前编辑器会话内最近的 MCP 调用审计记录。
     */
    readonly recentCalls: readonly IMcpHubRecentCall[];
}

/**
 * @description 等待编辑器用户审批的 MCP 写操作计划摘要。
 */
export interface IMcpHubPendingPlan extends ContractPayload {
    /**
     * @description 一次性计划标识。
     */
    readonly id: string;
    /**
     * @description 要执行的 capability 名称。
     */
    readonly name: string;
    /**
     * @description capability 对应的风险等级。
     */
    readonly risk: McpCapabilityRisk;
    /**
     * @description 用户审批失效的 Unix 时间戳，单位毫秒。
     */
    readonly expiresAt: number;
}

/**
 * @description 由编辑器宿主提供给插件管理面板的 MCP 控制边界。
 */
export interface IMcpHubControl {
    /**
     * @description Creator 直连的统一版本屏障入口，保留宿主原审批及公开策略。
     * @param name 注册能力名称。
     * @param input 业务输入。
     * @param invocation 宿主调用上下文。
     * @returns 原始能力结果；旧控制面可省略，新文本读取必须提供。
     */
    invokeFromHost?(name: string, input: unknown, invocation: IMcpCapabilityInvocation): Promise<unknown>;

    /**
     * @description 获取 MCP Hub 状态及当前公开工具。
     * @returns 当前面板可安全展示的状态快照。
     */
    getStatus(): IMcpHubStatus;

    /**
     * @description 列出尚未执行的写操作计划；请求输入不会暴露给面板。
     * @returns 当前仍可审批的计划摘要。
     */
    listPendingPlans(): readonly IMcpHubPendingPlan[];

    /**
     * @description 列出当前编辑器会话内的最近 MCP 调用审计记录。
     * @returns 不含输入、输出和连接信息的只读审计记录。
     */
    listRecentCalls(): readonly IMcpHubRecentCall[];

    /**
     * @description 修改当前项目的 MCP Hub 启用状态。
     * @param isEnabled 是否启用本地 Hub。
     * @returns Promise 在状态持久化并完成启动或停止后结束。
     */
    setEnabled(isEnabled: boolean): Promise<void>;

    /**
     * @description 修改指定插件的 MCP capability 公开状态。
     * @param pluginId 目标插件标识。
     * @param isEnabled 是否向 MCP Hub 公开该插件 capability。
     * @returns Promise 在项目设置持久化并更新目录后结束。
     */
    setPluginEnabled(pluginId: string, isEnabled: boolean): Promise<void>;

    /**
     * @description 设置测试用直写开关。
     * @param isEnabled 是否跳过 plan 审批直接执行写 capability。
     * @returns Promise 在设置持久化后结束。
     */
    setDirectWriteEnabled(isEnabled: boolean): Promise<void>;

    /**
     * @description 设置指定插件的 MCP capability 公开级别。
     * @param pluginId 目标插件标识。
     * @param mode 关闭、仅只读或全部公开。
     * @returns Promise 在项目设置持久化并更新目录后结束。
     */
    setPluginExposure(pluginId: string, mode: McpPluginExposureMode): Promise<void>;

    /**
     * @description 批准一个等待确认的写操作计划。
     * @param planId 一次性计划标识。
     * @returns 计划存在且仍有效时返回 `true`。
     */
    approvePlan(planId: string): boolean;

    /**
     * @description 拒绝并删除一个等待确认的写操作计划。
     * @param planId 一次性计划标识。
     * @returns 计划存在且仍有效时返回 `true`。
     */
    rejectPlan(planId: string): boolean;
}

/**
 * @description 把完整 capability 定义转换为面板可展示的最小摘要。
 * @param definition 已由 registry 校验的 capability 定义。
 * @returns 不包含输入 schema 的安全摘要。
 */
export function summarizeMcpHubCapability(definition: IMcpCapabilityDefinition): IMcpHubCapabilitySummary {
    return {
        name: definition.name,
        description: definition.description,
        category: definition.category,
        inputSchema: definition.inputSchema,
        ...(definition.outputSchema != null ? { outputSchema: definition.outputSchema } : {}),
        readOnly: definition.readOnly,
        risk: definition.risk,
        executionModel: definition.executionModel ?? 'inline',
        ...(definition.lane != null ? { lane: definition.lane } : {}),
        ...(definition.aiHandling != null ? { aiHandling: definition.aiHandling } : {}),
    };
}

/**
 * @description 封装 Hub 签发的内部调用身份、真实读服务及受管回执边界。
 */
export class McpHubInvocationContext {
    /**
     * @description 同一受管任务保留每次调用的真实租约，避免重复回执覆盖此前 writer。
     */
    private readonly _pendingWriters = new Map<string, Map<IProjectWriterBarrierLease, boolean>>();
    /**
     * @description 已接纳但尚未结算的实际调用租约，覆盖回执尚未返回的停止窗口。
     */
    private readonly _writers = new Set<IProjectWriterBarrierLease>();
    /**
     * @description 尚未绑定受管回执的实际租约，限定提前终态事件的暂存生命周期。
     */
    private readonly _awaitingTaskWriters = new Set<IProjectWriterBarrierLease>();
    /**
     * @description 仅在回执尚未绑定期间暂存可信终态，覆盖终态先于 queued 回执及查询失败的窗口。
     */
    private readonly _terminalTasks = new Set<string>();
    /**
     * @description 非公开文本读写动作保持既有 128 KiB 请求上限。
     */
    private static readonly _legacyInputBytes = 128 * 1024;
    /**
     * @description 注入宿主实际服务，不创建第二套时钟、屏障或审批存储。
     * @param getDefinition 不受外部公开级别影响的宿主定义查询。
     * @param execute Hub 实际执行生命周期。
     * @param projectKey 宿主配置的工程根。
     * @param revision 当前工程真实时钟。
     * @param waitForWriters 同一 Hub 的此前 writer 屏障。
     * @param finishWrite 同一 Hub 的真实版本结算，不创建第二套时钟。
     */
    public constructor(
        private readonly _getDefinition: (name: string) => IMcpCapabilityDefinition | null,
        private readonly _execute: (definition: IMcpCapabilityDefinition, name: string, input: unknown, invocation: IMcpCapabilityInvocation) => Promise<unknown>,
        private readonly _projectKey: () => string,
        private readonly _revision: () => {
            /**
             * @description 同一 Hub 的当前工程版本。
             */
            readonly revision: number;
            /**
             * @description 已接纳但未完成的 writer 数量。
             */
            readonly activeWriters: number;
        },
        private readonly _waitForWriters: () => Promise<void>,
        private readonly _finishWrite: (refreshBoundary: boolean) => void,
    ) {}

    /**
     * @description 记录已经由同一 Hub 接纳并开始版本生命周期的 writer，不再次接纳屏障。
     * @param lease Hub 已创建的真实租约。
     * @param awaitManagedReceipt 是否实际等待受管回执；inline writer 不延长提前终态暂存窗口。
     * @returns 无返回值。
     */
    public retainWriter(lease: IProjectWriterBarrierLease, awaitManagedReceipt = false): void {
        this._writers.add(lease);
        if (awaitManagedReceipt) {
            this._awaitingTaskWriters.add(lease);
        }
    }

    /**
     * @description 同一 queued 任务可对应多个调用租约，保持每个调用的刷新语义。
     * @param taskId 实际受管任务身份。
     * @param lease 本次调用接纳的 writer 租约。
     * @param refreshBoundary 是否属于刷新结算边界。
     * @returns 无返回值。
     */
    public retainTaskWriter(taskId: string, lease: IProjectWriterBarrierLease, refreshBoundary: boolean): void {
        if (!this._writers.has(lease)) {
            return;
        }
        const terminalObserved = this._terminalTasks.has(taskId);
        this._awaitingTaskWriters.delete(lease);
        if (this._awaitingTaskWriters.size === 0) {
            this._terminalTasks.clear();
        }
        if (terminalObserved) {
            this.finishWriter(lease, refreshBoundary);
            return;
        }
        const pending = this._pendingWriters.get(taskId) ?? new Map<IProjectWriterBarrierLease, boolean>();
        pending.set(lease, refreshBoundary);
        this._pendingWriters.set(taskId, pending);
    }

    /**
     * @description 实际任务进入终态时释放该任务全部调用租约，每个真实租约只推进一次版本。
     * @param taskId 已确认终态的实际任务身份。
     * @returns 无返回值。
     */
    public finishTaskWriters(taskId: string): void {
        if (this._awaitingTaskWriters.size !== 0) {
            this._terminalTasks.add(taskId);
        }
        const pending = this._pendingWriters.get(taskId);
        this._pendingWriters.delete(taskId);
        for (const [lease, refreshBoundary] of pending ?? []) {
            this.finishWriter(lease, refreshBoundary);
        }
    }

    /**
     * @description 未绑定任务的失败只撤销当前调用；已绑定 queued 任务的观察失败保持屏障，等待可信终态或停止。
     * @param lease 当前调用真实租约。
     * @returns 无返回值。
     */
    public failWriter(lease: IProjectWriterBarrierLease): void {
        for (const pending of this._pendingWriters.values()) {
            if (pending.has(lease)) {
                return;
            }
        }
        this.finishWriter(lease, false);
    }

    /**
     * @description 以真实租约的幂等释放结果结算版本，防止终态事件和查询或异常重复结算。
     * @param lease 本次调用真实租约。
     * @param refreshBoundary 是否额外记录刷新边界。
     * @returns 无返回值。
     */
    public finishWriter(lease: IProjectWriterBarrierLease, refreshBoundary: boolean): void {
        if (this._writers.delete(lease) && lease.release()) {
            this._awaitingTaskWriters.delete(lease);
            if (this._awaitingTaskWriters.size === 0) {
                this._terminalTasks.clear();
            }
            this._finishWrite(refreshBoundary);
        }
    }

    /**
     * @description Hub 停止时以非刷新边界结算全部实际调用，迟到回执和终态不能再次结算。
     * @returns 无返回值。
     */
    public releasePendingWriters(): void {
        for (const lease of this._writers) {
            this.finishWriter(lease, false);
        }
        this._pendingWriters.clear();
    }

    /**
     * @description 覆盖不可信的同名上下文字段，签发真实工程读服务。
     * @param invocation 经宿主确认的调用身份及授权。
     * @returns 保留原身份并绑定真实服务的调用对象。
     */
    public create(invocation: IMcpCapabilityInvocation): IMcpCapabilityInvocation {
        return { ...invocation, textReadConsistency: {
            projectKey: this._projectKey(),
            waitForPriorWriters: this._waitForWriters,
            getRevision: () => {
                const state = this._revision();
                if (state.activeWriters !== 0) {
                    throw new Error('text_file_io_snapshot_conflict');
                }
                return state.revision;
            },
        } };
    }

    /**
     * @description 查询实际注册定义并进入 Hub 写生命周期，保留宿主直连公开语义。
     * @param name 注册名称。
     * @param input 业务输入。
     * @param invocation 宿主原始上下文。
     * @returns 原始能力结果。
     */
    public invokeFromHost(name: string, input: unknown, invocation: IMcpCapabilityInvocation): Promise<unknown> {
        const definition = this._getDefinition(name);
        if (definition == null) {
            McpControlFlowRefusal.reject(`mcp_capability_unregistered:${name}`);
        }
        return this._execute(definition, name, input, invocation);
    }

    /**
     * @description 解析并校验 Hub 写并发上限。
     * @param value 可选配置。
     * @returns 1–32 之间的整数。
     */
    public readMaxConcurrentWrites(value: number | undefined): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return 16;
        }
        return Math.max(1, Math.min(32, Math.floor(value)));
    }

    /**
     * @description 先按实际原始字节限流，再一次解码 JSON，避免跨网络分块损坏 Unicode 路径。
     * @param request HTTP 调用方拥有的借用字节输入；读取器不提前 return 或销毁流，拒绝回执及连接结束由调用方负责。
     * @returns 经完整编码容量检查的对象请求。
     */
    public async readPayload(request: AsyncIterable<unknown>): Promise<Record<string, unknown>> {
        const chunks: ReturnType<typeof Buffer.from>[] = [];
        let byteCount = 0;
        const iterator = request[Symbol.asyncIterator]();
        while (true) {
            const next = await iterator.next();
            if (next.done) {
                break;
            }
            const chunk: unknown = next.value;
            if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
                throw new Error('cocos_mcp_hub_payload_invalid');
            }
            const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
            byteCount += bytes.length;
            if (byteCount > CoreTextFileIoContract.limits.maxInputBytes) {
                throw new Error('cocos_mcp_hub_request_too_large');
            }
            chunks.push(bytes);
        }
        const body = Buffer.concat(chunks);
        const decoded = body.toString('utf8');
        const encoded = Buffer.from(decoded);
        if (encoded.length !== body.length || encoded.some((byte, index) => byte !== body[index])) {
            throw new Error('cocos_mcp_hub_payload_invalid');
        }
        const parsed: unknown = JSON.parse(decoded);
        if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
            throw new Error('cocos_mcp_hub_payload_invalid');
        }
        const name: unknown = Reflect.get(parsed, 'name');
        const isTextCall = Reflect.get(parsed, 'action') === 'call'
            && CoreTextFileIoContract.isTextFileIoCapability(name);
        if (!isTextCall && byteCount > McpHubInvocationContext._legacyInputBytes) {
            throw new Error('cocos_mcp_hub_request_too_large');
        }
        return { ...parsed };
    }

    /**
     * @description 校验既有受管成功回执，不扩大允许的状态集合。
     * @param result 受管能力实际返回值。
     * @returns 已收窄的任务身份与状态。
     */
    public readManagedTaskReceipt(result: unknown): {
        /**
         * @description 实际受管任务身份。
         */
        readonly taskId: string;
        /**
         * @description 保持既有 queued 或 succeeded 回执语义。
         */
        readonly taskStatus: 'queued' | 'succeeded';
    } {
        if (result == null || typeof result !== 'object' || Array.isArray(result)) {
            throw new Error('cocos_mcp_managed_task_receipt_invalid');
        }
        const taskId: unknown = Reflect.get(result, 'taskId');
        const taskStatus: unknown = Reflect.get(result, 'taskStatus');
        if (typeof taskId !== 'string' || taskId.length === 0 || taskStatus !== 'queued' && taskStatus !== 'succeeded') {
            throw new Error('cocos_mcp_managed_task_receipt_invalid');
        }
        return { taskId, taskStatus };
    }
}
