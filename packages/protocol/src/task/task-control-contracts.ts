import type { ContractPayload, IsoDateTimeString, PluginId, TaskId } from '../shared/common-contracts.js';
import type { TaskStatus } from './task-contracts.js';

/**
 * @description 受管任务的调用方式；默认同步等待，异步模式必须显式请求。
 */
export type TaskExecutionMode = 'sync' | 'async';

/**
 * @description 任务失败后项目状态的保守判定。
 */
export type TaskProjectState = 'not_started' | 'unchanged' | 'may_have_changed' | 'unknown';

/**
 * @description 受管任务失败的稳定分类。
 */
export type TaskFailureCategory =
    | 'invalid_input'
    | 'authorization_required'
    | 'confirmation_required'
    | 'resource_pending'
    | 'postflight_failed'
    | 'timeout'
    | 'cancelled'
    | 'unavailable'
    | 'idempotency_conflict'
    | 'execution_failed';

/**
 * @description 受管任务失败后的推荐动作。
 */
export type TaskFailureRecommendedAction =
    | 'fix_input'
    | 'request_authorization'
    | 'confirm_destructive'
    | 'query_state_before_retry'
    | 'retry_same_request'
    | 'restore_service'
    | 'inspect_project_log'
    | 'stop';

/**
 * @description 任务证据的稳定类别。
 */
export type TaskEvidenceKind = 'planning' | 'resource_closure' | 'assetdb_settle' | 'postflight' | 'artifact';

/**
 * @description 任务证据步骤状态。
 */
export type TaskEvidenceStatus = 'completed' | 'failed' | 'skipped';

/**
 * @description 调用方可选的任务执行控制；owner、工程和资源锁不接受外部覆盖。
 */
export interface ITaskExecutionControl extends ContractPayload {
    /**
     * @description 调用方选择同步等待或显式异步受理。
     */
    readonly mode?: TaskExecutionMode;
    /**
     * @description 调用方提供的幂等键。
     */
    readonly idempotencyKey?: string;
    /**
     * @description 受控截止时间，单位为毫秒。
     */
    readonly timeoutMs?: number;
}

/**
 * @description 由宿主在任务受理时固定的不可变 owner。
 */
export interface ITaskOwner extends ContractPayload {
    /**
     * @description 提供任务执行器的插件标识。
     */
    readonly pluginId: PluginId;
    /**
     * @description 发起调用的 Bridge 或宿主连接标识。
     */
    readonly connectionId: string;
    /**
     * @description 任务所属工程的稳定键。
     */
    readonly projectKey: string;
    /**
     * @description 发起任务的 capability 名称。
     */
    readonly capability: string;
}

/**
 * @description 可向 owner 返回的受管任务失败摘要。
 */
export interface ITaskFailureSummary extends ContractPayload {
    /**
     * @description 可稳定匹配且不包含敏感数据的错误码。
     */
    readonly code: string;
    /**
     * @description 失败所属的处理类别。
     */
    readonly category: TaskFailureCategory;
    /**
     * @description 面向调用方的受控失败原因。
     */
    readonly reason: string;
    /**
     * @description 完成推荐动作后是否允许重试。
     */
    readonly retryable: boolean;
    /**
     * @description 失败后项目是否可能已经改变。
     */
    readonly projectState: TaskProjectState;
    /**
     * @description 调用方下一步应执行的动作。
     */
    readonly recommendedAction: TaskFailureRecommendedAction;
    /**
     * @description 失败对应的稳定 operation。
     */
    readonly operation?: string;
}

/**
 * @description 不包含原始输入、token 或未筛选日志的任务状态摘要。
 */
export interface ITaskStatusSummary extends ContractPayload {
    /**
     * @description 运行时分配的任务标识。
     */
    readonly taskId: TaskId;
    /**
     * @description 提供任务执行器的插件标识。
     */
    readonly pluginId: PluginId;
    /**
     * @description 发起任务的 capability 名称。
     */
    readonly capability: string;
    /**
     * @description 当前任务状态。
     */
    readonly status: TaskStatus;
    /**
     * @description 任务创建时间。
     */
    readonly createdAt: IsoDateTimeString;
    /**
     * @description 最近更新时间。
     */
    readonly updatedAt: IsoDateTimeString;
    /**
     * @description 当前安全等待原因摘要。
     */
    readonly waitReason?: string;
    /**
     * @description 终态失败摘要。
     */
    readonly failure?: ITaskFailureSummary;
}

/**
 * @description 单条任务证据索引项。
 */
export interface ITaskEvidenceEntry extends ContractPayload {
    /**
     * @description 证据步骤稳定标识。
     */
    readonly id: string;
    /**
     * @description 证据类别。
     */
    readonly kind: TaskEvidenceKind;
    /**
     * @description 证据步骤状态。
     */
    readonly status: TaskEvidenceStatus;
    /**
     * @description 受控摘要，不得包含绝对路径或完整日志。
     */
    readonly summary: string;
    /**
     * @description 可选的稳定内容摘要。
     */
    readonly digest?: string;
    /**
     * @description 证据记录时间。
     */
    readonly recordedAt: IsoDateTimeString;
}

/**
 * @description 遵守 owner 与保留期的任务证据索引。
 */
export interface ITaskEvidenceIndex extends ContractPayload {
    /**
     * @description 关联任务标识。
     */
    readonly taskId: TaskId;
    /**
     * @description 安全证据索引项。
     */
    readonly entries: readonly ITaskEvidenceEntry[];
    /**
     * @description 证据可查询截止时间。
     */
    readonly retainedUntil: IsoDateTimeString;
}
