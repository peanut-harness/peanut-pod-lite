import type { ITaskBatchReceipt, ITaskCancelResult, ITaskEvidenceEntry, ITaskEvidenceIndex, ITaskOwner, ITaskReceipt, ITaskRequest, ITaskResult, ITaskSnapshot, ITaskStatusSummary, ITaskTrace, TaskStatus } from '@peanut/pod-protocol';

import type { ITaskMergeGroup } from './merge/task-merger.js';
import type { ITaskExecutor } from './registry/task-executor-registry.js';

/**
 * @description 执行组当前调度阶段。
 */
export type ExecutionGroupStage = 'planning' | 'pending_commit' | 'committing';

/**
 * @description 单个执行组的运行时调度快照。
 */
export interface IExecutionGroupSnapshot {
    /**
     * @description 合并组标识。
     */
    readonly groupId: string;

    /**
     * @description 组内当前优先级。
     */
    readonly priority: ITaskMergeGroup['priority'];

    /**
     * @description 组内当前合并策略。
     */
    readonly mergePolicy: ITaskMergeGroup['mergePolicy'];

    /**
     * @description 组内当前任务标识列表。
     */
    readonly taskIds: readonly string[];

    /**
     * @description 组的稳定入队顺序。
     */
    readonly sequence: number;

    /**
     * @description 当前组的任务种类。
     */
    readonly kind: string;

    /**
     * @description 当前调度阶段。
     */
    readonly stage: ExecutionGroupStage;

    /**
     * @description 当前组规划目标列表。
     */
    readonly targets: readonly string[];
}

/**
 * @description Runtime 执行队列观测快照。
 */
export interface IExecutionQueueSnapshot {
    /**
     * @description 当前仍在调度器排队中的任务标识列表。
     */
    readonly queuedTaskIds: readonly string[];

    /**
     * @description 当前正在规划中的执行组列表。
     */
    readonly planningGroups: readonly IExecutionGroupSnapshot[];

    /**
     * @description 当前等待进入提交窗口的执行组列表。
     */
    readonly pendingCommitGroups: readonly IExecutionGroupSnapshot[];

    /**
     * @description 当前正在提交的执行组；无活跃提交时返回 `null`。
     */
    readonly activeCommitGroup: IExecutionGroupSnapshot | null;

    /**
     * @description 当前是否正在 drain 全局 commit 队列。
     */
    readonly isDrainingCommitQueue: boolean;

    /**
     * @description 最近一次已提交组的优先级；无历史时返回 `null`。
     */
    readonly lastCommittedPriority: ITaskMergeGroup['priority'] | null;

    /**
     * @description 当前连续提交的同优先级组数量。
     */
    readonly consecutiveCommitCount: number;
}

/**
 * @description 单个执行诊断任务快照。
 */
export interface IExecutionDiagnosticTaskSnapshot {
    /**
     * @description 任务标识。
     */
    readonly taskId: string;

    /**
     * @description 当前任务状态；任务尚未入账时返回 `unknown`。
     */
    readonly status: TaskStatus | 'unknown';

    /**
     * @description 当前任务是否命中过取消路径。
     */
    readonly isCancelled: boolean;

    /**
     * @description 当前任务是否命中过超时路径。
     */
    readonly isTimedOut: boolean;

    /**
     * @description 当前任务是否发生过重规划。
     */
    readonly isReplanned: boolean;

    /**
     * @description 当前任务的失败或取消错误码；无错误时返回 `null`。
     */
    readonly errorCode: string | null;

    /**
     * @description 当前任务的最终 trace；尚未结束时返回 `null`。
     */
    readonly trace: ITaskTrace | null;
}

/**
 * @description 执行诊断组状态。
 */
export type ExecutionDiagnosticGroupStatus = 'active' | 'succeeded' | 'failed' | 'cancelled';

/**
 * @description 单个执行诊断组快照。
 */
export interface IExecutionDiagnosticGroupSnapshot {
    /**
     * @description 合并组标识。
     */
    readonly groupId: string;

    /**
     * @description 组内当前优先级。
     */
    readonly priority: ITaskMergeGroup['priority'];

    /**
     * @description 组内当前合并策略。
     */
    readonly mergePolicy: ITaskMergeGroup['mergePolicy'];

    /**
     * @description 当前组的稳定入队顺序。
     */
    readonly sequence: number;

    /**
     * @description 当前组的任务种类。
     */
    readonly kind: string;

    /**
     * @description 当前组内全部任务标识列表。
     */
    readonly taskIds: readonly string[];

    /**
     * @description 当前调度阶段。
     */
    readonly stage: ExecutionGroupStage;

    /**
     * @description 当前组涉及的目标列表。
     */
    readonly targets: readonly string[];

    /**
     * @description 当前组诊断状态。
     */
    readonly status: ExecutionDiagnosticGroupStatus;

    /**
     * @description 当前组是否命中过超时。
     */
    readonly hasTimeout: boolean;

    /**
     * @description 当前组是否命中过取消。
     */
    readonly hasCancellation: boolean;

    /**
     * @description 当前组是否发生过重规划。
     */
    readonly hasReplan: boolean;

    /**
     * @description 当前组用于展示主 trace 的任务标识；无可用 trace 时返回 `null`。
     */
    readonly traceTaskId: string | null;

    /**
     * @description 当前组内任务诊断快照列表。
     */
    readonly taskSummaries: readonly IExecutionDiagnosticTaskSnapshot[];

    /**
     * @description 当前组开始时间，使用 ISO 时间字符串。
     */
    readonly startedAt: string;

    /**
     * @description 当前组结束时间，使用 ISO 时间字符串；仍活跃时返回 `null`。
     */
    readonly finishedAt: string | null;
}

/**
 * @description Runtime 执行诊断快照。
 */
export interface IExecutionDiagnosticsSnapshot extends Record<string, unknown> {
    /**
     * @description 当前执行队列轻量快照。
     */
    readonly queue: IExecutionQueueSnapshot;

    /**
     * @description 当前仍活跃的执行诊断组列表。
     */
    readonly currentGroups: readonly IExecutionDiagnosticGroupSnapshot[];

    /**
     * @description 最近结束的执行诊断组列表。
     */
    readonly recentGroups: readonly IExecutionDiagnosticGroupSnapshot[];

    /**
     * @description 当前诊断快照生成时间，使用 ISO 时间字符串。
     */
    readonly updatedAt: string;
}

/**
 * @description Runtime 执行服务接口。
 */
export interface IExecutionRuntimeService {
    /**
     * @description 提交一个新的任务请求。
     * @param request 外部任务请求
     * @returns Promise 返回任务受理回执
     */
    submit(request: ITaskRequest): Promise<ITaskReceipt>;

    /** @description 提交一个由宿主固定 owner 的受管任务。 */
    submitOwned(request: ITaskRequest, owner: ITaskOwner): Promise<ITaskReceipt>;

    /** @description 返回宿主已固定的任务 owner；仅供受信执行边界使用。 */
    getOwner(taskId: string): ITaskOwner | null;

    /**
     * @description 批量提交多个任务请求。
     * @param requests 外部任务请求列表
     * @returns Promise 返回批量受理回执
     */
    submitBatch(requests: readonly ITaskRequest[]): Promise<ITaskBatchReceipt>;

    /**
     * @description 查询指定任务的当前快照。
     * @param taskId 任务标识
     * @returns Promise 命中时返回任务快照，否则返回 `null`
     */
    query(taskId: string): Promise<ITaskSnapshot | null>;

    /**
     * @description 查询指定任务的最终结果。
     * @param taskId 任务标识
     * @returns Promise 命中时返回任务最终结果，否则返回 `null`
     */
    getResult(taskId: string): Promise<ITaskResult | null>;

    /**
     * @description 取消指定任务。
     * @param taskId 任务标识
     * @returns Promise 返回任务取消结果
     */
    cancel(taskId: string): Promise<ITaskCancelResult>;

    /** @description 仅向匹配 owner 返回任务安全状态摘要。 */
    getOwnedStatus(taskId: string, owner: ITaskOwner): Promise<ITaskStatusSummary | null>;

    /** @description 仅允许匹配 owner 取消任务。 */
    cancelOwned(taskId: string, owner: ITaskOwner): Promise<ITaskCancelResult>;

    /** @description 仅向匹配 owner 返回 allow-list 任务证据。 */
    getOwnedEvidence(taskId: string, owner: ITaskOwner): Promise<ITaskEvidenceIndex | null>;

    /** @description 为提供插件注册 kind executor。 */
    registerExecutor(pluginId: string, kind: string, executor: ITaskExecutor): () => void;

    /** @description 记录经过 allow-list 筛选的任务证据。 */
    recordEvidence(taskId: string, evidence: ITaskEvidenceEntry): void;

    /**
     * @description 返回当前执行调度队列与提交窗口的观测快照。
     * @returns Promise 返回当前执行队列快照
     */
    inspectQueue(): Promise<IExecutionQueueSnapshot>;

    /**
     * @description 返回当前执行队列与近期历史的诊断快照。
     * @returns Promise 返回当前执行诊断快照
     */
    inspectDiagnostics(): Promise<IExecutionDiagnosticsSnapshot>;
}
