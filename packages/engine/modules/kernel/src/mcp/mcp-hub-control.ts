import type {
    ContractPayload,
    IMcpAiHandlingGuidance,
    IMcpCapabilityDefinition,
    IMcpJsonSchema,
    LocalizedText,
    McpCapabilityCategory,
    McpCapabilityExecutionLane,
    McpCapabilityRisk,
} from '@peanut/pod-protocol';

import type { McpPluginExposureMode } from './mcp-capability-registry.js';

/**
 * @description MCP 调用在编辑器审计视图中的当前阶段。
 */
export type McpHubCallStatus = 'pending_approval' | 'approved' | 'succeeded' | 'failed' | 'rejected' | 'expired';

/**
 * @description 面板可展示的 MCP 调用审计摘要；不会包含输入、输出、token 或 bridge 连接标识。
 */
export interface IMcpHubRecentCall extends ContractPayload {
    /** @description 仅用于面板渲染的审计记录标识，不可用于执行操作。 */
    readonly id: string;
    /** @description 被请求的 capability 名称。 */
    readonly name: string;
    /** @description capability 的工作台分类。 */
    readonly category: McpCapabilityCategory;
    /** @description capability 的风险等级。 */
    readonly risk: McpCapabilityRisk;
    /** @description 调用或写操作计划的当前阶段。 */
    readonly status: McpHubCallStatus;
    /** @description Hub 接收请求的 Unix 时间戳，单位毫秒。 */
    readonly requestedAt: number;
    /** @description 终态产生的 Unix 时间戳；仍在等待时为 `null`。 */
    readonly completedAt: number | null;
    /** @description 已完成调用的执行耗时，单位毫秒；未完成时为 `null`。 */
    readonly durationMs: number | null;
    /** @description 失败时的安全错误码；不会泄露 capability 原始错误。 */
    readonly errorCode: string | null;
}

/**
 * @description 供编辑器面板显示的 MCP capability 摘要。
 */
export interface IMcpHubCapabilitySummary extends ContractPayload {
    /** @description 对外公开的全局工具名称。 */
    readonly name: string;
    /** @description 工具的人类可读用途。 */
    readonly description: LocalizedText;
    /** @description capability 的工作台分类。 */
    readonly category: McpCapabilityCategory;
    /** @description 经 registry 校验的输入 schema。 */
    readonly inputSchema: IMcpJsonSchema;
    /**
     * @description 写操作成功返回值的最小 schema。
     */
    readonly outputSchema?: IMcpJsonSchema;
    /** @description 工具是否不会修改项目状态。 */
    readonly readOnly: boolean;
    /** @description 工具对应的风险等级。 */
    readonly risk: McpCapabilityRisk;
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
    /** @description 当前宿主是否配置了 MCP Hub。 */
    readonly isAvailable: boolean;
    /** @description 当前项目是否启用了 MCP Hub。 */
    readonly isEnabled: boolean;
    /** @description 当前 loopback 监听端口；未启动时为 `null`。 */
    readonly port: number | null;
    /**
     * @description 本项目偏好的 loopback 端口；仅存于项目 settings，用于重启粘滞，不得跨项目共享。
     */
    readonly preferredPort: number | null;
    /** @description 当前 capability catalog 版本。 */
    readonly catalogRevision: number;
    /** @description 当前已分享给外部 MCP 客户端的工具。 */
    readonly capabilities: readonly IMcpHubCapabilitySummary[];
    /**
     * @description 已保持运行但不向 MCP Hub 公开能力的插件标识。
     */
    readonly disabledPluginIds: readonly string[];
    /** @description 已显式允许公开写 capability 的插件标识；其他未关闭插件仅公开只读 capability。 */
    readonly writeEnabledPluginIds: readonly string[];
    /**
     * @description 测试用直写开关；为 true 时写 capability 可跳过 plan 审批直接执行。
     */
    readonly directWriteEnabled: boolean;
    /** @description 当前编辑器会话内最近的 MCP 调用审计记录。 */
    readonly recentCalls: readonly IMcpHubRecentCall[];
}

/**
 * @description 等待编辑器用户审批的 MCP 写操作计划摘要。
 */
export interface IMcpHubPendingPlan extends ContractPayload {
    /** @description 一次性计划标识。 */
    readonly id: string;
    /** @description 要执行的 capability 名称。 */
    readonly name: string;
    /** @description capability 对应的风险等级。 */
    readonly risk: McpCapabilityRisk;
    /** @description 用户审批失效的 Unix 时间戳，单位毫秒。 */
    readonly expiresAt: number;
}

/**
 * @description 由编辑器宿主提供给插件管理面板的 MCP 控制边界。
 */
export interface IMcpHubControl {
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
        ...(definition.lane != null ? { lane: definition.lane } : {}),
        ...(definition.aiHandling != null ? { aiHandling: definition.aiHandling } : {}),
    };
}
