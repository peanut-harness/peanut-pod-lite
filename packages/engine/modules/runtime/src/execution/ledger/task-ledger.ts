import type { ITaskResult, ITaskSnapshot, TaskStatus } from '@peanut/pod-protocol';

import type { IAcceptedTask } from '../ingress/task-ingress.js';

/**
 * @description 任务账本，负责保存任务快照和最终结果。
 */
export class TaskLedger {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _snapshots = new Map<string, ITaskSnapshot>();
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _results = new Map<string, ITaskResult>();

    /**
     * @description 创建一个新的任务快照。
     * @param task 已标准化的任务模型
     * @param status 首次记录的任务状态
     * @returns 创建后的任务快照
     */
    public create(task: IAcceptedTask, status: TaskStatus): ITaskSnapshot {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ now = new Date().toISOString();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ snapshot: ITaskSnapshot = {
            taskId: task.taskId,
            pluginId: task.request.pluginId,
            status,
            scope: task.request.scope,
            kind: task.request.kind,
            createdAt: now,
            updatedAt: now,
        };
        this._snapshots.set(task.taskId, snapshot);
        return snapshot;
    }

    /**
     * @description 更新指定任务的状态。
     * @param taskId 任务标识
     * @param status 新的任务状态
     * @returns 更新后的任务快照；任务不存在时返回 `null`
     */
    public updateStatus(taskId: string, status: TaskStatus): ITaskSnapshot | null {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ current = this._snapshots.get(taskId);
        if (current == null) {
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ nextSnapshot: ITaskSnapshot = {
            ...current,
            status,
            updatedAt: new Date().toISOString(),
        };
        this._snapshots.set(taskId, nextSnapshot);
        return nextSnapshot;
    }

    /**
     * @description 保存指定任务的最终结果。
     * @param result 结构化任务结果
     * @returns 保存后的任务结果
     */
    public setResult(result: ITaskResult): ITaskResult {
        this._results.set(result.taskId, result);
        this.updateStatus(result.taskId, result.status);
        return result;
    }

    /**
     * @description 查询指定任务的快照。
     * @param taskId 任务标识
     * @returns 命中时返回任务快照，否则返回 `null`
     */
    public query(taskId: string): ITaskSnapshot | null {
        return this._snapshots.get(taskId) ?? null;
    }

    /**
     * @description 查询指定任务的最终结果。
     * @param taskId 任务标识
     * @returns 命中时返回任务结果，否则返回 `null`
     */
    public getResult(taskId: string): ITaskResult | null {
        return this._results.get(taskId) ?? null;
    }

    /**
     * @description 删除超过保留期的任务快照与结果。
     * @param taskId 任务标识。
     * @returns 任一记录被删除时返回 true。
     */
    public delete(taskId: string): boolean {
        const snapshotDeleted = this._snapshots.delete(taskId);
        const resultDeleted = this._results.delete(taskId);
        return snapshotDeleted || resultDeleted;
    }
}
