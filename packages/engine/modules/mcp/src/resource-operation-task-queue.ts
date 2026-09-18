import { randomUUID } from 'node:crypto';

/** @description 写任务生命周期状态。 */
export type ResourceOperationTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** @description 写任务执行记录的最小公开摘要。 */
export interface IResourceOperationTaskRecord<T> {
    /** @description 稳定任务标识。 */
    readonly taskId: string;
    /** @description 稳定 MCP operation。 */
    readonly operation: string;
    /** @description 当前生命周期状态。 */
    readonly status: ResourceOperationTaskStatus;
    /** @description 入队时间戳。 */
    readonly queuedAt: number;
    /** @description 开始执行时间戳。 */
    readonly startedAt: number | null;
    /** @description 完成时间戳。 */
    readonly completedAt: number | null;
    /** @description 成功结果；失败时为空。 */
    readonly result: T | null;
    /** @description 受控失败消息；不包含凭据或文件内容。 */
    readonly error: string | null;
}

/** @description 每个 Editor MCP Router 的工程写任务 FIFO 队列。 */
export class ResourceOperationTaskQueue {
    /** @description 前一个任务的完成屏障；保证同一 Router 的写操作严格串行。 */
    private _tail: Promise<void> = Promise.resolve();
    /** @description 最近任务记录；仅用于同步调用返回和诊断。 */
    private readonly _records = new Map<string, IResourceOperationTaskRecord<unknown>>();

    /**
     * @description 将写 operation 放入 FIFO 队列并等待完成。
     * @param operation 稳定 MCP operation。
     * @param worker 实际执行器；队列不绕过其输入、审批或路径校验。
     * @returns 带 taskId 和最终状态的执行记录。
     */
    public async run<T>(operation: string, worker: () => Promise<T>): Promise<IResourceOperationTaskRecord<T>> {
        const taskId = randomUUID();
        const queuedAt = Date.now();
        this._records.set(taskId, this._record(taskId, operation, 'queued', queuedAt, null, null, null, null));
        const previous = this._tail;
        let release!: () => void;
        this._tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        const startedAt = Date.now();
        this._records.set(taskId, this._record(taskId, operation, 'running', queuedAt, startedAt, null, null, null));
        try {
            const result = await worker();
            const record = this._record(taskId, operation, 'succeeded', queuedAt, startedAt, Date.now(), result, null);
            this._records.set(taskId, record);
            return record;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const record = this._record(taskId, operation, 'failed', queuedAt, startedAt, Date.now(), null, message);
            this._records.set(taskId, record);
            throw error;
        } finally {
            release();
        }
    }

    /**
     * @description 查询本 Router 最近创建的任务。
     * @param taskId 任务标识。
     * @returns 任务不存在时返回 null。
     */
    public get<T>(taskId: string): IResourceOperationTaskRecord<T> | null {
        return (this._records.get(taskId) as IResourceOperationTaskRecord<T> | undefined) ?? null;
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
    ): IResourceOperationTaskRecord<T> {
        return Object.freeze({ taskId, operation, status, queuedAt, startedAt, completedAt, result, error });
    }
}
