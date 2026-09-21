import type { IChangeSetEntry, TaskMergePolicy } from '@peanut/pod-protocol';

import type { IAcceptedTask } from '../ingress/task-ingress.js';
import type { ITaskExecutor } from '../registry/task-executor-registry.js';
import { TaskExecutorRegistry } from '../registry/task-executor-registry.js';

/**
 * @description 单个任务提交完成后的结构化结果。
 */
export interface ITaskCommitOutcome {
    /** @description 对应的任务标识。 */
    readonly taskId: string;
    /** @description 实际执行的任务种类。 */
    readonly kind: string;
    /** @description 任务执行返回数据。 */
    readonly data?: Record<string, unknown>;
    /** @description 本次提交产生的变更摘要。 */
    readonly changes: readonly IChangeSetEntry[];
}

/**
 * @description Runtime 提交派发器，通过显式 executor registry 路由任务。
 */
export class RuntimeTaskCommitDispatcher {
    /** @description 实例级 executor registry。 */
    private readonly _registry: TaskExecutorRegistry;
    /** @description 将任务映射到提供 executor 的插件。 */
    private readonly _providerPluginId: (task: IAcceptedTask) => string;

    /** @description 创建 registry 驱动的提交派发器。 */
    public constructor(registry: TaskExecutorRegistry, providerPluginId: string | ((task: IAcceptedTask) => string)) {
        this._registry = registry;
        this._providerPluginId = typeof providerPluginId === 'string' ? () => providerPluginId : providerPluginId;
    }

    /** @description 执行一个标准化提交任务。 */
    public async dispatch(task: IAcceptedTask): Promise<ITaskCommitOutcome> {
        return this._resolve(task).execute(task);
    }

    /** @description 通过同一 executor 执行一个批次；不支持批处理时逐任务执行。 */
    public async dispatchBatch(
        tasks: readonly IAcceptedTask[],
        batchId: string,
        mergePolicy: TaskMergePolicy,
    ): Promise<readonly ITaskCommitOutcome[]> {
        const firstTask = tasks[0];
        if (firstTask == null) {
            return [];
        }
        const providerPluginId = this._providerPluginId(firstTask);
        const kind = firstTask.request.kind;
        for (const task of tasks) {
            if (this._providerPluginId(task) !== providerPluginId || task.request.kind !== kind) {
                throw new Error('task_executor_batch_mixed');
            }
        }
        const executor = this._resolve(firstTask);
        if (executor.executeBatch != null) {
            return executor.executeBatch(tasks, batchId, mergePolicy);
        }
        const outcomes: ITaskCommitOutcome[] = [];
        for (const task of tasks) {
            outcomes.push(await executor.execute(task));
        }
        return outcomes;
    }

    /** @description 解析任务 executor。 */
    private _resolve(task: IAcceptedTask): ITaskExecutor {
        try {
            return this._registry.resolve(this._providerPluginId(task), task.request.kind);
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('task_executor_unavailable:')) {
                throw new Error(`unsupported_task_kind:${task.request.kind}`);
            }
            throw error;
        }
    }
}
