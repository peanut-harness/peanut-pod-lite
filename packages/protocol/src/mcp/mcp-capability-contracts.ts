import type { ContractPayload } from '../shared/common-contracts.js';
import type { LocalizedText } from '../plugin/plugin-contracts.js';
import type { ITaskExecutionControl } from '../task/task-control-contracts.js';

/**
 * @description MCP capability 的副作用等级；用于宿主确认策略，不授予额外权限。
 */
export type McpCapabilityRisk = 'read' | 'write' | 'destructive';

/**
 * @description MCP capability 的执行模型；未声明时按 inline 兼容处理。
 */
export type McpCapabilityExecutionModel = 'inline' | 'managed_task';

/**
 * @description Editor MCP 执行车道（与 `EditorMcpExecutionLane` 对齐；可选字段，其它插件可不填）。
 */
export type McpCapabilityExecutionLane = 'lumen-offline' | 'editor-ui' | 'preview';

/** @description MCP capability 的有界吞吐执行画像。 */
export interface IMcpCapabilityThroughputProfile extends ContractPayload {
    /** @description 宿主批次适配使用的稳定业务 operation；普通第三方 capability 可省略。 */
    readonly operationId?: string;
    readonly costClass: 'control' | 'read_light' | 'read_heavy' | 'prepare' | 'writer';
    readonly readCoalescing?: 'none' | 'project';
    readonly readCache?: 'none' | 'revision_lru';
    readonly readConsistency?: 'revision_validated' | 'writer_barrier';
    readonly prepareEligible?: boolean;
    readonly explicitBatchEligible?: boolean;
    readonly automaticBatchEligible?: boolean;
}

/**
 * @description MCP capability 在编辑器工作台中的稳定分类。
 */
export type McpCapabilityCategory = 'cocos' | 'atom' | 'workflow';

/**
 * @description MCP 调用方可选的受管任务执行控制。
 */
export interface IMcpExecutionControl extends ITaskExecutionControl {}

/**
 * @description MCP 调用失败的稳定分类，供 AI 选择修复、审批、查询或停止策略。
 */
export type McpFailureCategory =
    | 'invalid_input'
    | 'approval_required'
    | 'confirmation_required'
    | 'assetdb_pending'
    | 'postflight_failed'
    | 'timeout'
    | 'cancelled'
    | 'unavailable'
    | 'overloaded'
    | 'execution_failed';

/**
 * @description MCP 失败后项目状态的保守判定。
 */
export type McpFailureState = 'not_started' | 'unchanged' | 'may_have_changed' | 'unknown';

/**
 * @description AI 收到失败后必须采用的下一步动作类型。
 */
export type McpFailureRecommendedAction =
    | 'fix_input'
    | 'request_approval'
    | 'confirm_destructive'
    | 'query_state_before_retry'
    | 'retry_same_request'
    | 'restore_service'
    | 'retry_with_backoff'
    | 'inspect_project_log'
    | 'stop';

/**
 * @description MCP Hub 对调用方返回的安全失败详情。
 */
export interface IMcpFailureDetails extends ContractPayload {
    /**
     * @description 失败详情协议版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description 可稳定匹配且不包含敏感数据的错误码。
     */
    readonly code: string;
    /**
     * @description 失败所属的处理类别。
     */
    readonly category: McpFailureCategory;
    /**
     * @description 面向用户与 AI 的受控失败原因。
     */
    readonly reason: string;
    /**
     * @description 完成推荐动作后是否允许重试。
     */
    readonly retryable: boolean;
    /**
     * @description 失败发生后项目是否可能已经改变。
     */
    readonly state: McpFailureState;
    /**
     * @description AI 必须优先执行的下一步动作。
     */
    readonly recommendedAction: McpFailureRecommendedAction;
    /**
     * @description 写任务标识；失败发生在入队前时省略。
     */
    readonly taskId?: string;
    /**
     * @description 写任务最终状态；失败发生在入队前时省略。
     */
    readonly taskStatus?: 'failed' | 'cancelled' | 'timed_out';
    /**
     * @description 失败对应的稳定内部 operation。
     */
    readonly operation?: string;
    /**
     * @description overload 时建议的有界退避时间，单位毫秒。
     */
    readonly retryAfterMs?: number;
    /**
     * @description 仅包含当前连接计数的安全队列摘要。
     */
    readonly queue?: {
        readonly connectionInFlight: number;
        readonly connectionQueued: number;
        readonly saturated: boolean;
    };
}

/**
 * @description 工具目录提供给 AI 的机器可读调用处理规则。
 */
export interface IMcpAiHandlingGuidance extends ContractPayload {
    /**
     * @description 调用处理规则版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description AI 判定调用成功必须同时满足的字段表达式。
     */
    readonly successSignals: readonly string[];
    /**
     * @description 失败详情所在的响应字段。
     */
    readonly failureField: 'failure';
    /**
     * @description 项目状态不明时必须执行的动作。
     */
    readonly unknownStateAction: 'query_before_retry';
    /**
     * @description 是否允许 AI 在未检查 failure 时自动重试。
     */
    readonly blindRetryAllowed: false;
}

/**
 * @description 受限 JSON Schema 子集，用于向 MCP 调用方公开稳定参数边界。
 */
export interface IMcpJsonSchema extends ContractPayload {
    /**
     * @description JSON 值类型。
     */
    readonly type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
    /**
     * @description 面向调用方的字段说明。
     */
    readonly description?: LocalizedText;
    /**
     * @description 对象字段定义。
     */
    readonly properties?: Readonly<Record<string, IMcpJsonSchema>>;
    /**
     * @description 必填对象字段。
     */
    readonly required?: readonly string[];
    /**
     * @description 是否拒绝未声明对象字段；默认拒绝。
     */
    readonly additionalProperties?: boolean;
    /**
     * @description 数组元素 schema。
     */
    readonly items?: IMcpJsonSchema;
    /**
     * @description 字符串枚举值。
     */
    readonly enum?: readonly string[];
}

/**
 * @description 子插件向统一 MCP Hub 注册的公开能力定义。
 */
export interface IMcpCapabilityDefinition extends ContractPayload {
    /**
     * @description 全局唯一且带插件命名空间的工具名称。
     */
    readonly name: string;
    /**
     * @description 面向 MCP Client 的能力说明。
     */
    readonly description: LocalizedText;
    /**
     * @description 提供方声明的工作台分类，不得由宿主根据名称推测。
     */
    readonly category: McpCapabilityCategory;
    /**
     * @description 参数 schema。
     */
    readonly inputSchema: IMcpJsonSchema;
    /**
     * @description 返回值 schema。
     */
    readonly outputSchema?: IMcpJsonSchema;
    /**
     * @description 是否为无副作用查询。
     */
    readonly readOnly: boolean;
    /**
     * @description 宿主执行策略使用的风险等级。
     */
    readonly risk: McpCapabilityRisk;
    /**
     * @description capability 执行模型；省略时保持 inline 行为。
     */
    readonly executionModel?: McpCapabilityExecutionModel;
    /**
     * @description 可选执行车道（editor-mcp 一级工具会填）；其它插件可省略。
     */
    readonly lane?: McpCapabilityExecutionLane;
    /**
     * @description 面向 AI 调用方的成功判据与失败处理规则。
     */
    readonly aiHandling?: IMcpAiHandlingGuidance;
    /**
     * @description 可选的 admission/read/batch 画像；省略时宿主采用保守默认值。
     */
    readonly throughput?: IMcpCapabilityThroughputProfile;
}

/**
 * @description MCP capability 目录快照。
 */
export interface IMcpCapabilityCatalog extends ContractPayload {
    /**
     * @description 目录单调递增版本。
     */
    readonly revision: number;
    /**
     * @description 当前可调用 capability。
     */
    readonly capabilities: readonly IMcpCapabilityDefinition[];
}
