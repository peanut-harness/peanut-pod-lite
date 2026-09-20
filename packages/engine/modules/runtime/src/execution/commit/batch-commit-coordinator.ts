import type { ContractPayload, IChangeSetEntry } from '@peanut/pod-protocol';

import type { ITaskMergeGroup } from '../merge/task-merger.js';
import type { IAcceptedTask } from '../ingress/task-ingress.js';
import type { IWorkerPlanSummary } from '../workers/worker-pool.js';
import type { ITaskCommitOutcome } from './runtime-task-commit-dispatcher.js';
import { RuntimeTaskCommitDispatcher } from './runtime-task-commit-dispatcher.js';
import { TaskSnapshotInspector } from '../snapshot/task-snapshot-inspector.js';

/**
 * @description 批提交摘要。
 */
export interface IBatchCommitSummary {
    /**
     * @description 当前提交批次标识。
     */
    readonly batchId: string;

    /**
     * @description 当前提交包含的任务标识列表。
     */
    readonly taskIds: readonly string[];

    /**
     * @description 本次提交窗口内各任务的执行结果。
     */
    readonly outcomes: readonly ITaskCommitOutcome[];

    /**
     * @description 当前提交窗口产生的变更摘要集合。
     */
    readonly changes: readonly IChangeSetEntry[];
}

/**
 * @description 批提交协调器骨架，后续用于把多个任务重写为统一提交窗口。
 */
export class BatchCommitCoordinator {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _dispatcher: RuntimeTaskCommitDispatcher | null;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _snapshotInspector: TaskSnapshotInspector | null;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _commitDelayMs: number;

    /**
     * @description 创建一个新的批提交协调器。
     * @param dispatcher 可选 Runtime 提交派发器；未提供时返回骨架摘要
     * @param snapshotInspector 可选任务快照检查器
     * @param commitDelayMs 可选提交阶段延迟，单位毫秒
     */
    public constructor(dispatcher?: RuntimeTaskCommitDispatcher | null, snapshotInspector?: TaskSnapshotInspector | null, commitDelayMs: number = 0) {
        this._dispatcher = dispatcher ?? null;
        this._snapshotInspector = snapshotInspector ?? null;
        this._commitDelayMs = commitDelayMs;
    }

    /**
     * @description 协调提交指定任务组。
     * @param taskGroup 任务合并组
     * @param tasks 当前合并组内的任务列表
     * @param planSummary 当前任务组的规划摘要
     * @returns Promise 返回批提交摘要
     */
    public async commit(
        taskGroup: ITaskMergeGroup,
        tasks: readonly IAcceptedTask[],
        planSummary: IWorkerPlanSummary,
    ): Promise<IBatchCommitSummary> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const batchId = `batch:${taskGroup.groupId}`;
        if (this._dispatcher == null) {
            return {
                batchId,
                taskIds: taskGroup.taskIds,
                outcomes: [],
                changes: [],
            };
        }

        if (this._commitDelayMs > 0) {
            await new Promise((resolve) => {
                setTimeout(resolve, this._commitDelayMs);
            });
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const snapshotValidationResult = this._validateSnapshots(tasks, planSummary);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const effectivePlanSummary = snapshotValidationResult.replanned ? this._rebuildPlanSummary(planSummary, tasks) : planSummary;
        if (!snapshotValidationResult.ok) {
            throw new Error(snapshotValidationResult.reason ?? 'task_snapshot_stale');
        }

        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const outcomes = await this._buildOutcomes(taskGroup, tasks, batchId, effectivePlanSummary, snapshotValidationResult.replanned);

        const changes = [];
        for (const outcome of outcomes) {
            changes.push(...outcome.changes);
        }

        return {
            batchId,
            taskIds: taskGroup.taskIds,
            outcomes,
            changes,
        };
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _buildOutcomes(
        taskGroup: ITaskMergeGroup,
        tasks: readonly IAcceptedTask[],
        batchId: string,
        planSummary: IWorkerPlanSummary,
        replanned: boolean,
    ): Promise<readonly ITaskCommitOutcome[]> {
        if (taskGroup.mergePolicy === 'dedupe' && tasks.length > 0) {
            return this._buildDedupeOutcomes(taskGroup, tasks);
        }

        if (tasks.length > 1 && (taskGroup.mergePolicy === 'batch_commit' || taskGroup.mergePolicy === 'coalesce')) {
            return this._annotateOutcomes(
                await (this._dispatcher?.dispatchBatch(tasks, batchId, taskGroup.mergePolicy) ?? []),
                planSummary,
                replanned,
            );
        }

        return this._annotateOutcomes(await Promise.all(
            tasks.map(async (task) => {
                if (this._dispatcher == null) {
                    throw new Error('task_commit_dispatcher_unavailable');
                }
                // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
                const outcome = await this._dispatcher.dispatch(task);
                return {
                    ...outcome,
                    data: {
                        ...(outcome.data ?? {}),
                        batchId,
                        batchSize: tasks.length,
                    },
                };
            }),
        ), planSummary, replanned);
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _buildDedupeOutcomes(taskGroup: ITaskMergeGroup, tasks: readonly IAcceptedTask[]): Promise<readonly ITaskCommitOutcome[]> {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const canonicalTask = tasks.find((task) => {
            return task.taskId === taskGroup.canonicalTaskId;
        });
        if (canonicalTask == null || this._dispatcher == null) {
            return [];
        }

        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const canonicalOutcome = await this._dispatcher.dispatch(canonicalTask);
        return tasks.map((task) => {
            if (task.taskId === canonicalTask.taskId) {
                return canonicalOutcome;
            }

            return {
                ...canonicalOutcome,
                taskId: task.taskId,
            };
        });
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _validateSnapshots(
        tasks: readonly IAcceptedTask[],
        planSummary: IWorkerPlanSummary,
    ): {
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        readonly ok: boolean;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        readonly replanned: boolean;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        readonly reason?: string;
    } {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const snapshotInspector = this._snapshotInspector;
        if (snapshotInspector == null || planSummary.snapshots.length === 0) {
            return {
                ok: true,
                replanned: false,
            };
        }

        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const staleTasks = tasks.filter((task) => {
            // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
            const snapshot = planSummary.snapshots.find((item) => {
                return item.taskId === task.taskId;
            });
            return snapshot != null && !snapshotInspector.validate(task, snapshot);
        });

        if (staleTasks.length === 0) {
            return {
                ok: true,
                replanned: false,
            };
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const canReplan = staleTasks.every((task) => {
            return snapshotInspector.canReplan(task);
        });
        if (!canReplan) {
            return {
                ok: false,
                replanned: false,
                reason: 'task_snapshot_stale_non_replanable',
            };
        }

        return {
            ok: true,
            replanned: true,
        };
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _rebuildPlanSummary(planSummary: IWorkerPlanSummary, tasks: readonly IAcceptedTask[]): IWorkerPlanSummary {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const snapshotInspector = this._snapshotInspector;
        if (snapshotInspector == null) {
            return planSummary;
        }
        return {
            ...planSummary,
            snapshots: tasks.map((task) => {
                return snapshotInspector.capture(task);
            }),
        };
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _annotateOutcomes(
        outcomes: readonly ITaskCommitOutcome[],
        planSummary: IWorkerPlanSummary,
        replanned: boolean,
    ): readonly ITaskCommitOutcome[] {
        return outcomes.map((outcome) => {
            return {
                ...outcome,
                data: {
                    ...((outcome.data ?? {}) as ContractPayload),
                    plannedTaskCount: planSummary.taskCount,
                    plannedTargets: planSummary.targets,
                    replanned,
                },
            };
        });
    }
}
