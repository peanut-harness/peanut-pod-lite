/**
 * @description 单任务超时与取消状态快照。
 */
export interface ITaskControlState {
    /**
     * @description 任务稳定标识。
     */
    readonly taskId: string;

    /**
     * @description 任务是否已被显式取消。
     */
    readonly cancelled: boolean;

    /**
     * @description 任务是否已进入提交窗口。
     */
    readonly inCommitWindow: boolean;

    /**
     * @description 任务是否已完成收尾。
     */
    readonly finalized: boolean;

    /**
     * @description 当前任务超时截止时间戳；未配置超时时返回 `null`。
     */
    readonly deadlineAt: number | null;
}

interface ITaskControlStateMutable {
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    taskId: string;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    cancelled: boolean;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    inCommitWindow: boolean;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    finalized: boolean;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    deadlineAt: number | null;
}

/**
 * @description 超时与取消控制器，负责统一管理任务超时、提交窗口进入状态与取消结果。
 */
export class TimeoutAndCancelController {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _taskStates = new Map<string, ITaskControlStateMutable>();

    /**
     * @description 注册一个任务的超时与取消控制状态。
     * @param taskId 任务标识
     * @param timeoutMs 超时时间，单位毫秒；未配置时返回 `null`
     * @returns 当前任务控制状态快照
     */
    public register(taskId: string, timeoutMs?: number): ITaskControlState {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ nextTaskState: ITaskControlStateMutable = {
            taskId,
            cancelled: false,
            inCommitWindow: false,
            finalized: false,
            deadlineAt: timeoutMs == null ? null : Date.now() + timeoutMs,
        };
        this._taskStates.set(taskId, nextTaskState);
        return this._toSnapshot(nextTaskState);
    }

    /**
     * @description 标记指定任务已进入提交窗口。
     * @param taskId 任务标识
     * @returns 成功标记时返回 `true`
     */
    public enterCommitWindow(taskId: string): boolean {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ taskState = this._taskStates.get(taskId);
        if (taskState == null || taskState.finalized) {
            return false;
        }
        taskState.inCommitWindow = true;
        return true;
    }

    /**
     * @description 结束指定任务的控制状态。
     * @param taskId 任务标识
     * @returns 成功结束时返回 `true`
     */
    public finalize(taskId: string): boolean {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ taskState = this._taskStates.get(taskId);
        if (taskState == null) {
            return false;
        }
        taskState.finalized = true;
        taskState.inCommitWindow = false;
        return true;
    }

    /**
     * @description 请求取消一个任务。
     * @param taskId 任务标识
     * @returns 返回是否取消成功和失败原因
     */
    public cancel(taskId: string): {
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        readonly cancelled: boolean;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        readonly reason?: string;
    } {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ taskState = this._taskStates.get(taskId);
        if (taskState == null) {
            return {
                cancelled: false,
                reason: 'task_not_found',
            };
        }
        if (taskState.finalized) {
            return {
                cancelled: false,
                reason: 'task_already_finalized',
            };
        }
        if (taskState.inCommitWindow) {
            return {
                cancelled: false,
                reason: 'task_in_commit_window',
            };
        }

        taskState.cancelled = true;
        return {
            cancelled: true,
        };
    }

    /**
     * @description 返回指定任务当前是否已被取消。
     * @param taskId 任务标识
     * @returns 已取消时返回 `true`
     */
    public isCancelled(taskId: string): boolean {
        return this._taskStates.get(taskId)?.cancelled ?? false;
    }

    /**
     * @description 返回指定任务当前是否已超时。
     * @param taskId 任务标识
     * @returns 已超时时返回 `true`
     */
    public isTimedOut(taskId: string): boolean {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ deadlineAt = this._taskStates.get(taskId)?.deadlineAt ?? null;
        return deadlineAt != null && Date.now() > deadlineAt;
    }

    /**
     * @description 查询指定任务的控制状态快照。
     * @param taskId 任务标识
     * @returns 命中时返回控制状态快照，否则返回 `null`
     */
    public get(taskId: string): ITaskControlState | null {
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const /* 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。 */ taskState = this._taskStates.get(taskId);
        if (taskState == null) {
            return null;
        }
        return this._toSnapshot(taskState);
    }

    /**
     * @description 删除已经超过控制面保留期的任务状态。
     * @param taskId 任务标识
     * @returns 存在并删除记录时返回 `true`
     */
    public delete(taskId: string): boolean {
        return this._taskStates.delete(taskId);
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _toSnapshot(taskState: ITaskControlStateMutable): ITaskControlState {
        return {
            taskId: taskState.taskId,
            cancelled: taskState.cancelled,
            inCommitWindow: taskState.inCommitWindow,
            finalized: taskState.finalized,
            deadlineAt: taskState.deadlineAt,
        };
    }
}
