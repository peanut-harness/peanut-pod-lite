import type { ITaskBatchReceipt, ITaskCancelResult, ITaskEvidenceEntry, ITaskEvidenceIndex, ITaskOwner, ITaskReceipt, ITaskRequest, ITaskResult, ITaskSnapshot, ITaskStatusSummary, ITaskTrace, TaskStatus } from '@peanut/pod-protocol';

import { BatchCommitCoordinator } from './commit/batch-commit-coordinator.js';
import type { ITaskCommitOutcome } from './commit/runtime-task-commit-dispatcher.js';
import { TaskControlPlane } from './control/task-control-plane.js';
import type { IAcceptedTask } from './ingress/task-ingress.js';
import { TaskIngress } from './ingress/task-ingress.js';
import { TaskLedger } from './ledger/task-ledger.js';
import { ResourceLockManager } from './locks/resource-lock-manager.js';
import type { ITaskMergeGroup } from './merge/task-merger.js';
import { TaskMerger } from './merge/task-merger.js';
import { TaskScheduler } from './scheduler/task-scheduler.js';
import type { ITaskExecutor } from './registry/task-executor-registry.js';
import { TaskExecutorRegistry } from './registry/task-executor-registry.js';
import { TimeoutAndCancelController } from './timeout/timeout-and-cancel-controller.js';
import { TracePipeline } from './trace/trace-pipeline.js';
import { WorkerPool } from './workers/worker-pool.js';
import type {
    ExecutionDiagnosticGroupStatus,
    ExecutionGroupStage,
    IExecutionDiagnosticGroupSnapshot,
    IExecutionDiagnosticTaskSnapshot,
    IExecutionDiagnosticsSnapshot,
    IExecutionGroupSnapshot,
    IExecutionQueueSnapshot,
    IExecutionRuntimeService,
} from './execution-runtime-types.js';

export type {
    ExecutionDiagnosticGroupStatus,
    ExecutionGroupStage,
    IExecutionDiagnosticGroupSnapshot,
    IExecutionDiagnosticTaskSnapshot,
    IExecutionDiagnosticsSnapshot,
    IExecutionGroupSnapshot,
    IExecutionQueueSnapshot,
    IExecutionRuntimeService,
} from './execution-runtime-types.js';

interface IPlannedTaskGroupContext {
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly commitTaskGroup: ITaskMergeGroup;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly commitReadyTasks: readonly IAcceptedTask[];
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly kind: string;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly taskTrace: ReturnType<TracePipeline['create']> | ReturnType<TracePipeline['append']>;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly workerPlanSummary: Awaited<ReturnType<WorkerPool['plan']>>;
}

interface IQueuedCommitGroup {
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly plannedTaskGroupContext: IPlannedTaskGroupContext;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly resolve: () => void;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly reject: (error: unknown) => void;
}

interface IExecutionDiagnosticGroupRecord {
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly groupId: string;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly priority: ITaskMergeGroup['priority'];
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly mergePolicy: ITaskMergeGroup['mergePolicy'];
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly sequence: number;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly taskIds: readonly string[];
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    readonly kind: string;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    stage: ExecutionGroupStage;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    targets: readonly string[];
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    status: ExecutionDiagnosticGroupStatus;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    traceTaskId: string | null;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    startedAt: string;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    finishedAt: string | null;
}

/**
 * @description Runtime 统一执行服务骨架。
 */
export class ExecutionRuntimeService implements IExecutionRuntimeService {
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly MAX_CONSECUTIVE_COMMITS_PER_PRIORITY: number = 2;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly MAX_RECENT_DIAGNOSTIC_GROUPS: number = 20;

    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _ingress: TaskIngress;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _scheduler: TaskScheduler;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _controlPlane: TaskControlPlane;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _taskExecutorRegistry: TaskExecutorRegistry;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _workerPool: WorkerPool;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _taskMerger: TaskMerger;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _resourceLockManager: ResourceLockManager;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _batchCommitCoordinator: BatchCommitCoordinator;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _planningGroupSnapshots = new Map<string, IExecutionGroupSnapshot>();
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _executionDiagnosticGroupRecords = new Map<string, IExecutionDiagnosticGroupRecord>();
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _recentExecutionDiagnosticGroupIds: string[] = [];
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pendingCommitQueue: IQueuedCommitGroup[] = [];
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _activeCommitGroupSnapshot: IExecutionGroupSnapshot | null = null;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _isDrainingCommitQueue: boolean = false;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _lastCommittedPriority: ITaskMergeGroup['priority'] | null = null;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _consecutiveCommitCount: number = 0;

    /**
     * @description 创建一个新的 Runtime 执行服务。
     * @param ingress 任务入口
     * @param scheduler 任务调度器
     * @param ledger 任务账本
     * @param workerPool Worker 池
     * @param taskMerger 任务合并器
     * @param resourceLockManager 资源锁管理器
     * @param batchCommitCoordinator 批提交协调器
     * @param tracePipeline Trace 管线
     * @param timeoutAndCancelController 超时与取消控制器
     * @param taskExecutorRegistry 受管任务 executor 注册表
     */
    public constructor(
        ingress: TaskIngress,
        scheduler: TaskScheduler,
        ledger: TaskLedger,
        workerPool: WorkerPool,
        taskMerger: TaskMerger,
        resourceLockManager: ResourceLockManager,
        batchCommitCoordinator: BatchCommitCoordinator,
        tracePipeline: TracePipeline,
        timeoutAndCancelController: TimeoutAndCancelController = new TimeoutAndCancelController(),
        taskExecutorRegistry: TaskExecutorRegistry = new TaskExecutorRegistry(),
    ) {
        this._ingress = ingress;
        this._scheduler = scheduler;
        this._controlPlane = new TaskControlPlane(ledger, timeoutAndCancelController, tracePipeline);
        this._taskExecutorRegistry = taskExecutorRegistry;
        this._workerPool = workerPool;
        this._taskMerger = taskMerger;
        this._resourceLockManager = resourceLockManager;
        this._batchCommitCoordinator = batchCommitCoordinator;
    }

    /**
     * @description 提交一个新的任务请求。
     * @param request 外部任务请求
     * @returns Promise 返回任务受理回执
     */
    public async submit(request: ITaskRequest): Promise<ITaskReceipt> {
        const taskBatchReceipt = await this._submitBatch([{ request }]);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const firstReceipt = taskBatchReceipt.receipts[0];
        if (firstReceipt == null) {
            throw new Error('Expected at least one task receipt after submitBatch processing.');
        }
        return firstReceipt;
    }

    /** @description 提交一个由宿主固定 owner 的受管任务。 */
    public async submitOwned(request: ITaskRequest, owner: ITaskOwner): Promise<ITaskReceipt> {
        const taskBatchReceipt = await this._submitBatch([{ request, owner }], false);
        const firstReceipt = taskBatchReceipt.receipts[0];
        if (firstReceipt == null) {
            throw new Error('Expected at least one task receipt after owned submit processing.');
        }
        return firstReceipt;
    }

    /** @description 返回宿主受理时固定的任务 owner。 */
    public getOwner(taskId: string): ITaskOwner | null {
        return this._controlPlane.getOwner(taskId);
    }

    /**
     * @description 批量提交多个任务请求。
     * @param requests 外部任务请求列表
     * @returns Promise 返回批量受理回执
     */
    public async submitBatch(requests: readonly ITaskRequest[]): Promise<ITaskBatchReceipt> {
        return this._submitBatch(requests.map((request) => ({ request })));
    }

    /** @description 执行带可选 owner 的统一批量提交。 */
    private async _submitBatch(
        entries: readonly { readonly request: ITaskRequest; readonly owner?: ITaskOwner }[],
        waitForCommit: boolean = true,
    ): Promise<ITaskBatchReceipt> {
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const admissions = entries.map((entry) => {
            const acceptedTask = this._ingress.accept(entry.request);
            if (entry.owner == null || entry.request.idempotencyKey == null) {
                return { acceptedTask, owner: entry.owner, taskId: acceptedTask.taskId, reused: false };
            }
            const claim = this._controlPlane.claimIdempotency(
                entry.owner,
                entry.request.idempotencyKey,
                this._workDigest(entry.request),
                acceptedTask.taskId,
            );
            return { acceptedTask, owner: entry.owner, taskId: claim.taskId, reused: claim.reused };
        });
        const acceptedTasks = admissions.filter((admission) => !admission.reused).map((admission) => admission.acceptedTask);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const admission of admissions) {
            if (!admission.reused) {
                this._controlPlane.register(admission.taskId, admission.acceptedTask.request.timeoutMs, admission.owner);
            }
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const acceptedTask of acceptedTasks) {
            this._scheduler.schedule(acceptedTask);
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskGroups = await this._taskMerger.merge(acceptedTasks);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const plannedTaskGroupContexts = await Promise.all(
            taskGroups.map(async (taskGroup) => {
                return this._planGroup(taskGroup, acceptedTasks);
            }),
        );
        await this._enqueuePlannedTaskGroups(
            plannedTaskGroupContexts
            .filter((plannedTaskGroupContext): plannedTaskGroupContext is IPlannedTaskGroupContext => {
                return plannedTaskGroupContext != null;
            }),
            waitForCommit,
        );

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const finalReceipts = admissions.map((admission) => {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const taskSnapshot = this._controlPlane.query(admission.taskId);
            return {
                taskId: admission.taskId,
                status: taskSnapshot?.status ?? 'queued',
            };
        });

        return {
            batchId: `batch:${Date.now()}`,
            receipts: finalReceipts,
        };
    }

    /** @description 生成幂等绑定使用的稳定工作摘要，不包含请求标识、幂等键或超时等待偏好。 */
    private _workDigest(request: ITaskRequest): string {
        return this._stableSerialize({
            pluginId: request.pluginId,
            scope: request.scope,
            priority: request.priority,
            kind: request.kind,
            payload: request.payload ?? null,
            mergePolicy: request.mergePolicy ?? null,
            requiresConfirm: request.requiresConfirm ?? false,
        });
    }

    /** @description 对 JSON 兼容值递归排序对象键。 */
    private _stableSerialize(value: unknown): string {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this._stableSerialize(item)).join(',')}]`;
        }
        if (value != null && typeof value === 'object') {
            return `{${Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => `${JSON.stringify(key)}:${this._stableSerialize(item)}`)
                .join(',')}}`;
        }
        return JSON.stringify(value) ?? 'null';
    }

    /** @description 为提供插件注册 kind executor。 */
    public registerExecutor(pluginId: string, kind: string, executor: ITaskExecutor): () => void {
        return this._taskExecutorRegistry.register(pluginId, kind, executor);
    }

    /** @description 记录经过 allow-list 筛选的任务证据。 */
    public recordEvidence(taskId: string, evidence: ITaskEvidenceEntry): void {
        this._controlPlane.recordEvidence(taskId, evidence);
    }

    /**
     * @description 查询指定任务的当前快照。
     * @param taskId 任务标识
     * @returns Promise 命中时返回任务快照，否则返回 `null`
     */
    public async query(taskId: string): Promise<ITaskSnapshot | null> {
        return this._controlPlane.query(taskId);
    }

    /**
     * @description 取消指定任务。
     * @param taskId 任务标识
     * @returns Promise 返回任务取消结果
     */
    public async cancel(taskId: string): Promise<ITaskCancelResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const cancelResult = this._controlPlane.cancel(taskId);
        if (cancelResult.cancelled) {
            this._scheduler.remove(taskId);
        }
        return cancelResult;
    }

    /** @description 仅向完全匹配的 owner 返回安全状态摘要。 */
    public async getOwnedStatus(taskId: string, owner: ITaskOwner): Promise<ITaskStatusSummary | null> {
        return this._controlPlane.getStatusSummary(taskId, owner);
    }

    /** @description 仅允许完全匹配的 owner 取消任务。 */
    public async cancelOwned(taskId: string, owner: ITaskOwner): Promise<ITaskCancelResult> {
        const cancelResult = this._controlPlane.cancelOwned(taskId, owner);
        if (cancelResult.cancelled) {
            this._scheduler.remove(taskId);
        }
        return cancelResult;
    }

    /** @description 仅向完全匹配的 owner 返回 allow-list 证据。 */
    public async getOwnedEvidence(taskId: string, owner: ITaskOwner): Promise<ITaskEvidenceIndex | null> {
        return this._controlPlane.getEvidence(taskId, owner);
    }

    /**
     * @description 返回指定任务的最终结果；任务尚未结束或不存在时返回 `null`。
     * @param taskId 任务标识
     * @returns Promise 命中时返回任务结果，否则返回 `null`
     */
    public async getResult(taskId: string): Promise<ITaskResult | null> {
        return this._controlPlane.getResult(taskId);
    }

    /**
     * @description 返回当前执行调度队列与提交窗口的观测快照。
     * @returns Promise 返回当前执行队列快照
     */
    public async inspectQueue(): Promise<IExecutionQueueSnapshot> {
        return {
            queuedTaskIds: [...this._scheduler.listQueuedTaskIds()],
            planningGroups: [...this._planningGroupSnapshots.values()].map((groupSnapshot) => {
                return {
                    ...groupSnapshot,
                    taskIds: [...groupSnapshot.taskIds],
                    targets: [...groupSnapshot.targets],
                };
            }),
            pendingCommitGroups: this._pendingCommitQueue.map((queuedCommitGroup) => {
                return this._toExecutionGroupSnapshot(queuedCommitGroup.plannedTaskGroupContext, 'pending_commit');
            }),
            activeCommitGroup:
                this._activeCommitGroupSnapshot == null
                    ? null
                    : {
                          ...this._activeCommitGroupSnapshot,
                          taskIds: [...this._activeCommitGroupSnapshot.taskIds],
                          targets: [...this._activeCommitGroupSnapshot.targets],
                      },
            isDrainingCommitQueue: this._isDrainingCommitQueue,
            lastCommittedPriority: this._lastCommittedPriority,
            consecutiveCommitCount: this._consecutiveCommitCount,
        };
    }

    /**
     * @description 返回当前执行队列与近期历史的诊断快照。
     * @returns Promise 返回当前执行诊断快照
     */
    public async inspectDiagnostics(): Promise<IExecutionDiagnosticsSnapshot> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const queue = await this.inspectQueue();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const currentGroupIds = [
            ...queue.planningGroups.map((groupSnapshot) => {
                return groupSnapshot.groupId;
            }),
            ...queue.pendingCommitGroups.map((groupSnapshot) => {
                return groupSnapshot.groupId;
            }),
            ...(queue.activeCommitGroup == null ? [] : [queue.activeCommitGroup.groupId]),
        ];
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const dedupedCurrentGroupIds = [...new Set(currentGroupIds)];

        return {
            queue,
            currentGroups: dedupedCurrentGroupIds.map((groupId) => {
                return this._toExecutionDiagnosticGroupSnapshot(groupId);
            }).filter((groupSnapshot): groupSnapshot is IExecutionDiagnosticGroupSnapshot => {
                return groupSnapshot != null;
            }),
            recentGroups: [...this._recentExecutionDiagnosticGroupIds].reverse().map((groupId) => {
                return this._toExecutionDiagnosticGroupSnapshot(groupId);
            }).filter((groupSnapshot): groupSnapshot is IExecutionDiagnosticGroupSnapshot => {
                return groupSnapshot != null;
            }),
            updatedAt: new Date().toISOString(),
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _planGroup(
        taskGroup: ITaskMergeGroup,
        acceptedTasks: readonly IAcceptedTask[],
    ): Promise<IPlannedTaskGroupContext | null | undefined> {
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const groupTasks = acceptedTasks.filter((acceptedTask) => {
            return taskGroup.taskIds.includes(acceptedTask.taskId);
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskKind = groupTasks[0]?.request.kind ?? 'unknown';
        this._upsertExecutionDiagnosticGroupRecord(
            taskGroup.groupId,
            taskGroup.priority,
            taskGroup.mergePolicy,
            taskGroup.sequence,
            groupTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
            taskKind,
            'planning',
            this._resolveTargetsFromTasks(groupTasks),
            groupTasks[0]?.taskId ?? null,
        );
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const activeGroupTasks = groupTasks.filter((acceptedTask) => {
            return !this._controlPlane.isCancelled(acceptedTask.taskId) && !this._controlPlane.isTimedOut(acceptedTask.taskId);
        });
        await this._finalizeInactiveTasks(groupTasks, activeGroupTasks, 'planning');
        if (activeGroupTasks.length === 0) {
            this._settleExecutionDiagnosticGroup(taskGroup.groupId);
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const effectiveTaskGroup: ITaskMergeGroup = {
            ...taskGroup,
            canonicalTaskId: activeGroupTasks[0]?.taskId ?? taskGroup.canonicalTaskId,
            taskIds: activeGroupTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
        };
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const canonicalTask = activeGroupTasks.find((acceptedTask) => {
            return acceptedTask.taskId === effectiveTaskGroup.canonicalTaskId;
        });
        if (canonicalTask == null) {
            throw new Error(`Cannot find canonical task "${effectiveTaskGroup.canonicalTaskId}" for merge group "${effectiveTaskGroup.groupId}".`);
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。

        for (const taskId of effectiveTaskGroup.taskIds) {
            this._controlPlane.updateStatus(taskId, 'planning');
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        let taskTrace = this._controlPlane.createTrace(canonicalTask.taskId, canonicalTask.request.kind);
        this._planningGroupSnapshots.set(
            effectiveTaskGroup.groupId,
            this._toPlanningExecutionGroupSnapshot(effectiveTaskGroup, canonicalTask.request.kind, activeGroupTasks),
        );
        this._upsertExecutionDiagnosticGroupRecord(
            effectiveTaskGroup.groupId,
            effectiveTaskGroup.priority,
            effectiveTaskGroup.mergePolicy,
            effectiveTaskGroup.sequence,
            groupTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
            canonicalTask.request.kind,
            'planning',
            this._resolveTargetsFromTasks(groupTasks),
            canonicalTask.taskId,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const workerPlanSummary = await this._workerPool.plan(effectiveTaskGroup.groupId, activeGroupTasks, effectiveTaskGroup.mergePolicy);
        await this._finalizeInactiveTasks(activeGroupTasks, this._filterStillActiveTasks(activeGroupTasks), 'planning');
        taskTrace = this._controlPlane.appendTrace(
            taskTrace,
            'planning',
            'Plan tasks',
            'planned',
            `Planned ${workerPlanSummary.taskCount} task(s) with policy "${workerPlanSummary.mergePolicy}" for ${workerPlanSummary.targets.join(', ')}.`,
        );

        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const commitReadyTasks = this._filterStillActiveTasks(activeGroupTasks);
        await this._finalizeInactiveTasks(activeGroupTasks, commitReadyTasks, 'waiting_commit');
        this._planningGroupSnapshots.delete(effectiveTaskGroup.groupId);
        if (commitReadyTasks.length === 0) {
            this._upsertExecutionDiagnosticGroupRecord(
                effectiveTaskGroup.groupId,
                effectiveTaskGroup.priority,
                effectiveTaskGroup.mergePolicy,
                effectiveTaskGroup.sequence,
                groupTasks.map((acceptedTask) => {
                    return acceptedTask.taskId;
                }),
                canonicalTask.request.kind,
                'planning',
                workerPlanSummary.targets,
                canonicalTask.taskId,
            );
            this._settleExecutionDiagnosticGroup(effectiveTaskGroup.groupId);
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const commitTaskGroup: ITaskMergeGroup = {
            ...effectiveTaskGroup,
            canonicalTaskId: commitReadyTasks[0]?.taskId ?? effectiveTaskGroup.canonicalTaskId,
            taskIds: commitReadyTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
        };

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。

        for (const taskId of commitTaskGroup.taskIds) {
            this._controlPlane.updateStatus(taskId, 'waiting_commit');
        }
        this._upsertExecutionDiagnosticGroupRecord(
            commitTaskGroup.groupId,
            commitTaskGroup.priority,
            commitTaskGroup.mergePolicy,
            commitTaskGroup.sequence,
            groupTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
            canonicalTask.request.kind,
            'pending_commit',
            workerPlanSummary.targets,
            canonicalTask.taskId,
        );

        return {
            commitTaskGroup,
            commitReadyTasks,
            kind: canonicalTask.request.kind,
            taskTrace,
            workerPlanSummary,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _commitPlannedGroup(plannedTaskGroupContext: IPlannedTaskGroupContext): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const { commitTaskGroup, commitReadyTasks, kind, taskTrace, workerPlanSummary } = plannedTaskGroupContext;
        this._activeCommitGroupSnapshot = this._toExecutionGroupSnapshot(plannedTaskGroupContext, 'committing');
        this._upsertExecutionDiagnosticGroupRecord(
            commitTaskGroup.groupId,
            commitTaskGroup.priority,
            commitTaskGroup.mergePolicy,
            commitTaskGroup.sequence,
            this._executionDiagnosticGroupRecords.get(commitTaskGroup.groupId)?.taskIds ?? [...commitTaskGroup.taskIds],
            kind,
            'committing',
            workerPlanSummary.targets,
            commitTaskGroup.canonicalTaskId,
        );

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const executorManagedConcurrency = this._hasExecutorManagedConcurrency(commitReadyTasks);
        const acquired = executorManagedConcurrency || this._resourceLockManager.acquire(commitTaskGroup.lockKey);
        if (!acquired) {
            await this._failGroup(commitTaskGroup, kind, 'resource_lock_unavailable');
            this._activeCommitGroupSnapshot = null;
            return;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。

        for (const taskId of commitTaskGroup.taskIds) {
            this._controlPlane.enterCommitWindow(taskId);
            this._controlPlane.updateStatus(taskId, 'running');
            this._scheduler.remove(taskId);
        }

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const batchCommitSummary = await this._batchCommitCoordinator.commit(commitTaskGroup, commitReadyTasks, workerPlanSummary);
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const completedTaskTrace = this._controlPlane.appendTrace(
                taskTrace,
                'commit',
                'Commit task group',
                'completed',
                `Applied ${commitTaskGroup.mergePolicy} group with ${batchCommitSummary.outcomes.length} outcome(s).`,
            );
            this._completeGroup(commitTaskGroup, kind, this._controlPlane.finishTrace(completedTaskTrace), batchCommitSummary.outcomes);
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const errorMessage = error instanceof Error ? error.message : 'unknown_execution_error';
            await this._failGroup(commitTaskGroup, kind, errorMessage);
        } finally {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            for (const taskId of commitTaskGroup.taskIds) {
                this._controlPlane.finalize(taskId);
            }
            if (!executorManagedConcurrency) {
                this._resourceLockManager.release(commitTaskGroup.lockKey);
            }
            this._activeCommitGroupSnapshot = null;
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _completeGroup(
        taskGroup: ITaskMergeGroup,
        kind: string,
        taskTrace: ReturnType<TracePipeline['finish']>,
        outcomes: readonly ITaskCommitOutcome[],
    ): void {
        // 保存当前流程需要复用的索引或缓存状态，归当前作用域或实例管理。
        const outcomeMap = new Map<string, ITaskCommitOutcome>(
            outcomes.map((outcome) => {
                return [outcome.taskId, outcome];
            }),
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const taskId of taskGroup.taskIds) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const outcome = outcomeMap.get(taskId);
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const taskResult: ITaskResult = {
                taskId,
                ok: true,
                status: 'succeeded',
                data: {
                    canonicalTaskId: taskGroup.canonicalTaskId,
                    groupId: taskGroup.groupId,
                    mergePolicy: taskGroup.mergePolicy,
                    taskIds: taskGroup.taskIds,
                    kind,
                    ...(outcome?.data ?? {}),
                },
                changes: this._buildResultChanges(taskGroup, outcome),
                trace: taskTrace.taskId === taskId ? taskTrace : this._buildDerivedTrace(taskTrace, taskId),
            };
            this._controlPlane.setResult(taskResult);
            this._controlPlane.finalize(taskId);
        }
        this._settleExecutionDiagnosticGroup(taskGroup.groupId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _failGroup(taskGroup: ITaskMergeGroup, kind: string, reason: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const taskId of taskGroup.taskIds) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const taskTrace = this._controlPlane.finishTrace(
                this._controlPlane.appendTrace(this._controlPlane.createTrace(taskId, kind), 'commit', 'Commit task group', 'failed', reason),
            );
            this._controlPlane.setResult({
                taskId,
                ok: false,
                status: 'failed',
                changes: [],
                trace: taskTrace,
                error: {
                    code: reason,
                    message: reason,
                },
            });
            this._controlPlane.finalize(taskId);
        }
        this._settleExecutionDiagnosticGroup(taskGroup.groupId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildDerivedTrace(taskTrace: ReturnType<TracePipeline['finish']>, taskId: string): ReturnType<TracePipeline['finish']> {
        return {
            ...taskTrace,
            traceId: `${taskId}:trace`,
            taskId,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildResultChanges(taskGroup: ITaskMergeGroup, outcome?: ITaskCommitOutcome): ITaskResult['changes'] {
        if (outcome != null) {
            return outcome.changes;
        }

        if (taskGroup.mergePolicy === 'none') {
            return [];
        }

        return [
            {
                kind: 'unknown',
                target: taskGroup.lockKey,
                operation: taskGroup.mergePolicy,
                summary: `Merged ${taskGroup.taskIds.length} task(s) with policy "${taskGroup.mergePolicy}".`,
            },
        ];
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _filterStillActiveTasks(tasks: readonly IAcceptedTask[]): readonly IAcceptedTask[] {
        return tasks.filter((acceptedTask) => {
            return !this._controlPlane.isCancelled(acceptedTask.taskId) && !this._controlPlane.isTimedOut(acceptedTask.taskId);
        });
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _finalizeInactiveTasks(
        originalTasks: readonly IAcceptedTask[],
        activeTasks: readonly IAcceptedTask[],
        phase: 'planning' | 'waiting_commit',
    ): Promise<void> {
        // 保存当前流程需要复用的索引或缓存状态，归当前作用域或实例管理。
        const activeTaskIdSet = new Set(
            activeTasks.map((acceptedTask) => {
                return acceptedTask.taskId;
            }),
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const task of originalTasks) {
            if (activeTaskIdSet.has(task.taskId)) {
                continue;
            }

            if (this._controlPlane.isCancelled(task.taskId)) {
                this._controlPlane.updateStatus(task.taskId, 'cancelled');
                this._controlPlane.setResult({
                    taskId: task.taskId,
                    ok: false,
                    status: 'cancelled',
                    changes: [],
                    trace: this._controlPlane.finishTrace(
                        this._controlPlane.appendTrace(
                            this._controlPlane.createTrace(task.taskId, task.request.kind),
                            phase,
                            'Task cancelled before commit',
                            'skipped',
                            'task_cancelled',
                        ),
                    ),
                    error: {
                        code: 'task_cancelled',
                        message: 'task_cancelled',
                    },
                });
                continue;
            }

            if (this._controlPlane.isTimedOut(task.taskId)) {
                this._controlPlane.setResult({
                    taskId: task.taskId,
                    ok: false,
                    status: 'failed',
                    changes: [],
                    trace: this._controlPlane.finishTrace(
                        this._controlPlane.appendTrace(
                            this._controlPlane.createTrace(task.taskId, task.request.kind),
                            phase,
                            'Task timed out before commit',
                            'failed',
                            'task_timeout',
                        ),
                    ),
                    error: {
                        code: 'task_timeout',
                        message: 'task_timeout',
                    },
                });
            }
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _priorityRank(priority: ITaskMergeGroup['priority']): number {
        switch (priority) {
            case 'critical':
                return 4;
            case 'high':
                return 3;
            case 'normal':
                return 2;
            case 'low':
                return 1;
            default:
                return 0;
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _enqueuePlannedTaskGroups(
        plannedTaskGroupContexts: readonly IPlannedTaskGroupContext[],
        waitForCommit: boolean = true,
    ): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const waitPromises = plannedTaskGroupContexts.map((plannedTaskGroupContext) => {
            return new Promise<void>((resolve, reject) => {
                this._pendingCommitQueue.push({
                    plannedTaskGroupContext,
                    resolve,
                    reject,
                });
            });
        });

        void this._drainCommitQueue();
        if (waitForCommit) {
            await Promise.all(waitPromises);
        } else {
            void Promise.all(waitPromises).catch(() => {});
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _drainCommitQueue(): Promise<void> {
        if (this._isDrainingCommitQueue) {
            return;
        }

        this._isDrainingCommitQueue = true;
        try {
            while (this._pendingCommitQueue.length > 0) {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const nextQueuedCommitGroup = this._dequeueNextCommitGroup();
                if (nextQueuedCommitGroup == null) {
                    break;
                }

                if (this._hasExecutorManagedConcurrency(nextQueuedCommitGroup.plannedTaskGroupContext.commitReadyTasks)) {
                    void this._commitPlannedGroup(nextQueuedCommitGroup.plannedTaskGroupContext).then(
                        () => nextQueuedCommitGroup.resolve(),
                        (error: unknown) => nextQueuedCommitGroup.reject(error),
                    );
                    continue;
                }

                try {
                    await this._commitPlannedGroup(nextQueuedCommitGroup.plannedTaskGroupContext);
                    nextQueuedCommitGroup.resolve();
                } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
                    nextQueuedCommitGroup.reject(error);
                }
            }
        } finally {
            this._isDrainingCommitQueue = false;
            if (this._pendingCommitQueue.length > 0) {
                void this._drainCommitQueue();
            } else {
                this._lastCommittedPriority = null;
                this._consecutiveCommitCount = 0;
            }
        }
    }

    /** @description 判断任务组是否由同一显式 executor 自行管理资源并发。 */
    private _hasExecutorManagedConcurrency(tasks: readonly IAcceptedTask[]): boolean {
        if (tasks.length === 0) {
            return false;
        }
        return tasks.every((task) => {
            if (!this._taskExecutorRegistry.has(task.request.pluginId, task.request.kind)) {
                return false;
            }
            return this._taskExecutorRegistry.resolve(task.request.pluginId, task.request.kind).concurrency === 'executor_managed';
        });
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _dequeueNextCommitGroup(): IQueuedCommitGroup | null {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const priorityBuckets = new Map<ITaskMergeGroup['priority'], IQueuedCommitGroup[]>();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const queuedCommitGroup of [...this._pendingCommitQueue].sort((left, right) => {
            return left.plannedTaskGroupContext.commitTaskGroup.sequence - right.plannedTaskGroupContext.commitTaskGroup.sequence;
        })) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const priority = queuedCommitGroup.plannedTaskGroupContext.commitTaskGroup.priority;
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const bucket = priorityBuckets.get(priority) ?? [];
            bucket.push(queuedCommitGroup);
            priorityBuckets.set(priority, bucket);
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const orderedPriorities: ITaskMergeGroup['priority'][] = ['critical', 'high', 'normal', 'low'];
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const highestReadyPriority = orderedPriorities.find((priority) => {
            return (priorityBuckets.get(priority)?.length ?? 0) > 0;
        });
        if (highestReadyPriority == null) {
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        let selectedPriority = highestReadyPriority;
        if (
            this._lastCommittedPriority === highestReadyPriority &&
            this._consecutiveCommitCount >= ExecutionRuntimeService.MAX_CONSECUTIVE_COMMITS_PER_PRIORITY
        ) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const lowerReadyPriority: ITaskMergeGroup['priority'] | undefined = orderedPriorities.find((priority) => {
                return this._priorityRank(priority) < this._priorityRank(highestReadyPriority) && (priorityBuckets.get(priority)?.length ?? 0) > 0;
            });
            if (lowerReadyPriority != null) {
                selectedPriority = lowerReadyPriority;
            }
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextQueuedCommitGroup = priorityBuckets.get(selectedPriority)?.[0] ?? null;
        if (nextQueuedCommitGroup == null) {
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const queueIndex = this._pendingCommitQueue.indexOf(nextQueuedCommitGroup);
        if (queueIndex >= 0) {
            this._pendingCommitQueue.splice(queueIndex, 1);
        }

        if (this._lastCommittedPriority === selectedPriority) {
            this._consecutiveCommitCount += 1;
        } else {
            this._lastCommittedPriority = selectedPriority;
            this._consecutiveCommitCount = 1;
        }

        return nextQueuedCommitGroup;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _toExecutionGroupSnapshot(
        plannedTaskGroupContext: IPlannedTaskGroupContext,
        stage: ExecutionGroupStage,
    ): IExecutionGroupSnapshot {
        return {
            groupId: plannedTaskGroupContext.commitTaskGroup.groupId,
            priority: plannedTaskGroupContext.commitTaskGroup.priority,
            mergePolicy: plannedTaskGroupContext.commitTaskGroup.mergePolicy,
            taskIds: [...plannedTaskGroupContext.commitTaskGroup.taskIds],
            sequence: plannedTaskGroupContext.commitTaskGroup.sequence,
            kind: plannedTaskGroupContext.kind,
            stage,
            targets: [...plannedTaskGroupContext.workerPlanSummary.targets],
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _toPlanningExecutionGroupSnapshot(
        taskGroup: ITaskMergeGroup,
        kind: string,
        tasks: readonly IAcceptedTask[],
    ): IExecutionGroupSnapshot {
        return {
            groupId: taskGroup.groupId,
            priority: taskGroup.priority,
            mergePolicy: taskGroup.mergePolicy,
            taskIds: [...taskGroup.taskIds],
            sequence: taskGroup.sequence,
            kind,
            stage: 'planning',
            targets: this._resolveTargetsFromTasks(tasks),
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _resolveTargetsFromTasks(tasks: readonly IAcceptedTask[]): readonly string[] {
        return tasks.map((task) => {
            if (typeof task.request.payload !== 'object' || task.request.payload == null) {
                return `${task.request.scope}:${task.request.kind}`;
            }

            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const payloadRecord = task.request.payload as Record<string, unknown>;
            if (typeof payloadRecord.pathOrUuid === 'string') {
                return payloadRecord.pathOrUuid;
            }
            if (typeof payloadRecord.nodeId === 'string') {
                return payloadRecord.nodeId;
            }

            return `${task.request.scope}:${task.request.kind}`;
        });
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _upsertExecutionDiagnosticGroupRecord(
        groupId: string,
        priority: ITaskMergeGroup['priority'],
        mergePolicy: ITaskMergeGroup['mergePolicy'],
        sequence: number,
        taskIds: readonly string[],
        kind: string,
        stage: ExecutionGroupStage,
        targets: readonly string[],
        traceTaskId: string | null,
    ): void {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const currentRecord = this._executionDiagnosticGroupRecords.get(groupId);
        if (currentRecord == null) {
            this._executionDiagnosticGroupRecords.set(groupId, {
                groupId,
                priority,
                mergePolicy,
                sequence,
                taskIds: [...taskIds],
                kind,
                stage,
                targets: [...targets],
                status: 'active',
                traceTaskId,
                startedAt: new Date().toISOString(),
                finishedAt: null,
            });
            return;
        }

        currentRecord.stage = stage;
        currentRecord.targets = [...targets];
        currentRecord.status = 'active';
        currentRecord.traceTaskId = traceTaskId ?? currentRecord.traceTaskId;
        currentRecord.finishedAt = null;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _settleExecutionDiagnosticGroup(groupId: string): void {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const record = this._executionDiagnosticGroupRecords.get(groupId);
        if (record == null) {
            return;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskSummaries = record.taskIds.map((taskId) => {
            return this._toExecutionDiagnosticTaskSnapshot(taskId);
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskStatuses = taskSummaries.map((taskSummary) => {
            return taskSummary.status;
        });

        if (taskStatuses.every((status) => status === 'cancelled')) {
            record.status = 'cancelled';
        } else if (taskStatuses.some((status) => status === 'failed')) {
            record.status = 'failed';
        } else if (taskStatuses.some((status) => status === 'cancelled')) {
            record.status = 'cancelled';
        } else if (taskStatuses.some((status) => status === 'planning' || status === 'waiting_commit' || status === 'running' || status === 'queued')) {
            record.status = 'active';
        } else {
            record.status = 'succeeded';
        }

        if (record.status === 'active') {
            record.finishedAt = null;
            return;
        }

        record.finishedAt = new Date().toISOString();
        this._pushRecentExecutionDiagnosticGroup(groupId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _pushRecentExecutionDiagnosticGroup(groupId: string): void {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const existingIndex = this._recentExecutionDiagnosticGroupIds.indexOf(groupId);
        if (existingIndex >= 0) {
            this._recentExecutionDiagnosticGroupIds.splice(existingIndex, 1);
        }
        this._recentExecutionDiagnosticGroupIds.push(groupId);
        while (this._recentExecutionDiagnosticGroupIds.length > ExecutionRuntimeService.MAX_RECENT_DIAGNOSTIC_GROUPS) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const removedGroupId = this._recentExecutionDiagnosticGroupIds.shift();
            if (removedGroupId == null) {
                break;
            }
            if (!this._isExecutionDiagnosticGroupActive(removedGroupId)) {
                this._executionDiagnosticGroupRecords.delete(removedGroupId);
            }
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _isExecutionDiagnosticGroupActive(groupId: string): boolean {
        return this._planningGroupSnapshots.has(groupId)
            || this._pendingCommitQueue.some((queuedCommitGroup) => {
                return queuedCommitGroup.plannedTaskGroupContext.commitTaskGroup.groupId === groupId;
            })
            || this._activeCommitGroupSnapshot?.groupId === groupId;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _toExecutionDiagnosticGroupSnapshot(groupId: string): IExecutionDiagnosticGroupSnapshot | null {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const record = this._executionDiagnosticGroupRecords.get(groupId);
        if (record == null) {
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskSummaries = record.taskIds.map((taskId) => {
            return this._toExecutionDiagnosticTaskSnapshot(taskId);
        });

        return {
            groupId: record.groupId,
            priority: record.priority,
            mergePolicy: record.mergePolicy,
            sequence: record.sequence,
            kind: record.kind,
            taskIds: [...record.taskIds],
            stage: record.stage,
            targets: [...record.targets],
            status: record.status,
            hasTimeout: taskSummaries.some((taskSummary) => {
                return taskSummary.isTimedOut;
            }),
            hasCancellation: taskSummaries.some((taskSummary) => {
                return taskSummary.isCancelled;
            }),
            hasReplan: taskSummaries.some((taskSummary) => {
                return taskSummary.isReplanned;
            }),
            traceTaskId:
                taskSummaries.find((taskSummary) => {
                    return taskSummary.trace != null;
                })?.taskId ?? record.traceTaskId,
            taskSummaries,
            startedAt: record.startedAt,
            finishedAt: record.finishedAt,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _toExecutionDiagnosticTaskSnapshot(taskId: string): IExecutionDiagnosticTaskSnapshot {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskSnapshot = this._controlPlane.query(taskId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const taskResult = this._controlPlane.getResult(taskId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const resultData = typeof taskResult?.data === 'object' && taskResult.data != null ? taskResult.data as Record<string, unknown> : null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const errorCode = taskResult?.error?.code ?? null;

        return {
            taskId,
            status: taskResult?.status ?? taskSnapshot?.status ?? 'unknown',
            isCancelled: taskResult?.status === 'cancelled' || errorCode === 'task_cancelled',
            isTimedOut: errorCode === 'task_timeout',
            isReplanned: resultData?.replanned === true,
            errorCode,
            trace: taskResult?.trace ?? null,
        };
    }
}
