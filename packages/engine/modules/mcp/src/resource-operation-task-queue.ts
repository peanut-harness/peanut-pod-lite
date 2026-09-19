import { randomUUID } from 'node:crypto';

import { McpFailurePresenter } from '@peanut/pod-engine/kernel';

import type {
    IResourceOperationTaskPlan,
    IResourceOperationTaskRecord,
    ResourceOperationTaskStatus,
} from './resource-operation-contracts.js';
import { ResourceOperationTaskError } from './resource-operation-task-error.js';

/**
 * @description 调度器内部等待任务。
 */
interface IQueuedResourceOperation {
    /**
     * @description 原子独占资源键集合。
     */
    readonly resourceKeys: ReadonlySet<string>;
    /**
     * @description 是否占用项目 writer。
     */
    readonly requiresProjectWriter: boolean;
    /**
     * @description 锁授予后启动任务。
     */
    readonly start: () => void;
}

const PROJECT_FALLBACK_RESOURCE = 'resource:project';
const DEFAULT_RECORD_LIMIT = 256;

/**
 * @description 进程内共享的项目级资源调度器；跨 Router 协调 writer 与资源锁。
 */
export class ResourceOperationTaskQueue {
    /**
     * @description Router 默认复用的进程级调度器。
     */
    private static _shared: ResourceOperationTaskQueue | null = null;
    /**
     * @description 每个工程的等待任务。
     */
    private readonly _pendingByProject = new Map<string, IQueuedResourceOperation[]>();
    /**
     * @description 每个工程当前持有的资源键。
     */
    private readonly _heldResourcesByProject = new Map<string, Set<string>>();
    /**
     * @description 当前占用 writer 的工程集合。
     */
    private readonly _writerProjects = new Set<string>();
    /**
     * @description 最近任务记录；完成记录按上限回收。
     */
    private readonly _records = new Map<string, IResourceOperationTaskRecord<unknown>>();
    /**
     * @description 已完成任务标识，按完成顺序回收。
     */
    private readonly _completedTaskIds: string[] = [];
    /**
     * @description 最多保留的完成记录数。
     */
    private readonly _recordLimit: number;

    /**
     * @description 创建隔离调度器。
     * @param recordLimit 最多保留的完成记录数。
     */
    public constructor(recordLimit: number = DEFAULT_RECORD_LIMIT) {
        this._recordLimit = Math.max(1, Math.floor(recordLimit));
    }

    /**
     * @description 返回 Router 默认复用的进程级调度器。
     * @returns 共享调度器。
     */
    public static shared(): ResourceOperationTaskQueue {
        if (ResourceOperationTaskQueue._shared == null) {
            ResourceOperationTaskQueue._shared = new ResourceOperationTaskQueue();
        }
        return ResourceOperationTaskQueue._shared;
    }

    /**
     * @description 测试专用：重置 Router 默认共享调度器。
     * @returns 无返回值。
     */
    public static resetSharedForTests(): void {
        ResourceOperationTaskQueue._shared = null;
    }

    /**
     * @description 按项目 writer 与资源闭包调度写 operation 并等待完成。
     * @param plan 已归一调度计划。
     * @param worker 实际执行器；调度器不绕过输入、审批或路径校验。
     * @returns 带 taskId 和最终状态的执行记录。
     */
    public async run<T>(
        plan: IResourceOperationTaskPlan,
        worker: () => Promise<T>,
    ): Promise<IResourceOperationTaskRecord<T>> {
        const taskId = randomUUID();
        const queuedAt = Date.now();
        this._records.set(taskId, this._record(taskId, plan.operation, 'queued', queuedAt, null, null, null, null, null));
        return new Promise<IResourceOperationTaskRecord<T>>((resolveTask, rejectTask) => {
            const pending = this._pendingByProject.get(plan.projectKey) ?? [];
            const resourceKeys = new Set(plan.resourceKeys.length > 0 ? plan.resourceKeys : [PROJECT_FALLBACK_RESOURCE]);
            pending.push({
                resourceKeys,
                requiresProjectWriter: plan.requiresProjectWriter,
                start: () => {
                    void this._executeReservedTask(plan, taskId, queuedAt, resourceKeys, worker, resolveTask, rejectTask);
                },
            });
            this._pendingByProject.set(plan.projectKey, pending);
            this._drain(plan.projectKey);
        });
    }

    /**
     * @description 查询最近创建的任务。
     * @param taskId 任务标识。
     * @returns 任务不存在或已回收时返回 null。
     */
    public get<T>(taskId: string): IResourceOperationTaskRecord<T> | null {
        const record = this._records.get(taskId);
        if (record == null) {
            return null;
        }
        return record as IResourceOperationTaskRecord<T>;
    }

    /**
     * @description 执行已原子保留全部资源的任务。
     * @param plan 调度计划。
     * @param taskId 任务标识。
     * @param queuedAt 入队时间。
     * @param resourceKeys 已保留资源键。
     * @param worker 实际执行器。
     * @param resolveTask 成功完成器。
     * @param rejectTask 失败完成器。
     * @returns 无返回值。
     */
    private async _executeReservedTask<T>(
        plan: IResourceOperationTaskPlan,
        taskId: string,
        queuedAt: number,
        resourceKeys: ReadonlySet<string>,
        worker: () => Promise<T>,
        resolveTask: (record: IResourceOperationTaskRecord<T>) => void,
        rejectTask: (error: unknown) => void,
    ): Promise<void> {
        const startedAt = Date.now();
        this._records.set(taskId, this._record(taskId, plan.operation, 'running', queuedAt, startedAt, null, null, null, null));
        try {
            const result = await worker();
            const record = this._record(taskId, plan.operation, 'succeeded', queuedAt, startedAt, Date.now(), result, null, null);
            this._records.set(taskId, record);
            this._rememberCompleted(taskId);
            resolveTask(record);
        } catch (error: unknown) {
            const presented = McpFailurePresenter.present(error);
            const failure = Object.freeze({
                ...presented,
                taskId,
                taskStatus: 'failed' as const,
                operation: plan.operation,
            });
            const record = this._record(taskId, plan.operation, 'failed', queuedAt, startedAt, Date.now(), null, failure.code, failure);
            this._records.set(taskId, record);
            this._rememberCompleted(taskId);
            rejectTask(new ResourceOperationTaskError(record, error));
        } finally {
            this._release(plan.projectKey, resourceKeys, plan.requiresProjectWriter);
            this._drain(plan.projectKey);
        }
    }

    /**
     * @description 启动当前工程所有可安全并行的等待任务。
     * @param projectKey 已归一工程键。
     * @returns 无返回值。
     */
    private _drain(projectKey: string): void {
        const pending = this._pendingByProject.get(projectKey);
        if (pending == null || pending.length === 0) {
            this._pendingByProject.delete(projectKey);
            return;
        }
        let index = 0;
        while (index < pending.length) {
            const task = pending[index];
            if (task == null || !this._canStart(projectKey, task, pending.slice(0, index))) {
                index += 1;
                continue;
            }
            pending.splice(index, 1);
            this._reserve(projectKey, task.resourceKeys, task.requiresProjectWriter);
            task.start();
        }
        if (pending.length === 0) {
            this._pendingByProject.delete(projectKey);
        }
    }

    /**
     * @description 判断任务能否在不越过冲突前序任务的前提下启动。
     * @param projectKey 已归一工程键。
     * @param task 待检查任务。
     * @param earlierTasks 更早入队但尚未启动的任务。
     * @returns 可原子保留全部资源时返回 true。
     */
    private _canStart(
        projectKey: string,
        task: IQueuedResourceOperation,
        earlierTasks: readonly IQueuedResourceOperation[],
    ): boolean {
        if (this._writerProjects.has(projectKey)) {
            return false;
        }
        const heldResources = this._heldResourcesByProject.get(projectKey);
        if (task.requiresProjectWriter && heldResources != null && heldResources.size > 0) {
            return false;
        }
        if (heldResources != null && this._intersects(task.resourceKeys, heldResources)) {
            return false;
        }
        return !earlierTasks.some((earlier) => {
            if (task.requiresProjectWriter || earlier.requiresProjectWriter) {
                return true;
            }
            return this._intersects(task.resourceKeys, earlier.resourceKeys);
        });
    }

    /**
     * @description 原子登记任务持有的全部资源与 writer。
     * @param projectKey 已归一工程键。
     * @param resourceKeys 资源闭包。
     * @param requiresProjectWriter 是否占用 writer。
     * @returns 无返回值。
     */
    private _reserve(projectKey: string, resourceKeys: ReadonlySet<string>, requiresProjectWriter: boolean): void {
        const heldResources = this._heldResourcesByProject.get(projectKey) ?? new Set<string>();
        for (const resourceKey of resourceKeys) {
            heldResources.add(resourceKey);
        }
        this._heldResourcesByProject.set(projectKey, heldResources);
        if (requiresProjectWriter) {
            this._writerProjects.add(projectKey);
        }
    }

    /**
     * @description 一次性释放任务持有的全部资源与 writer。
     * @param projectKey 已归一工程键。
     * @param resourceKeys 资源闭包。
     * @param requiresProjectWriter 是否占用 writer。
     * @returns 无返回值。
     */
    private _release(projectKey: string, resourceKeys: ReadonlySet<string>, requiresProjectWriter: boolean): void {
        const heldResources = this._heldResourcesByProject.get(projectKey);
        if (heldResources != null) {
            for (const resourceKey of resourceKeys) {
                heldResources.delete(resourceKey);
            }
            if (heldResources.size === 0) {
                this._heldResourcesByProject.delete(projectKey);
            }
        }
        if (requiresProjectWriter) {
            this._writerProjects.delete(projectKey);
        }
    }

    /**
     * @description 判断两个资源集合是否相交。
     * @param left 左集合。
     * @param right 右集合。
     * @returns 存在相同资源键时返回 true。
     */
    private _intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
        for (const value of left) {
            if (right.has(value)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description 记录完成顺序并回收超限历史记录。
     * @param taskId 已完成任务标识。
     * @returns 无返回值。
     */
    private _rememberCompleted(taskId: string): void {
        this._completedTaskIds.push(taskId);
        while (this._completedTaskIds.length > this._recordLimit) {
            const expiredTaskId = this._completedTaskIds.shift();
            if (expiredTaskId != null) {
                this._records.delete(expiredTaskId);
            }
        }
    }

    /**
     * @description 创建不可变任务记录。
     * @param taskId 任务标识。
     * @param operation operation。
     * @param status 状态。
     * @param queuedAt 入队时间。
     * @param startedAt 开始时间。
     * @param completedAt 完成时间。
     * @param result 结果。
     * @param error 错误。
     * @param failure 结构化失败详情。
     * @returns 不可变记录。
     */
    private _record<T>(
        taskId: string,
        operation: string,
        status: ResourceOperationTaskStatus,
        queuedAt: number,
        startedAt: number | null,
        completedAt: number | null,
        result: T | null,
        error: string | null,
        failure: IResourceOperationTaskRecord<T>['failure'],
    ): IResourceOperationTaskRecord<T> {
        return Object.freeze({ taskId, operation, status, queuedAt, startedAt, completedAt, result, error, failure });
    }
}
