import type {
    IThroughputBatchReceipt,
    IThroughputBatchItemOutcome,
    IThroughputBatchRequest,
    IThroughputBatchStatusSummary,
    ITaskBatchReceipt,
    TaskStatus,
} from '@peanut/pod-protocol';

import type { McpTaskControl } from './mcp-task-control.js';

interface IBatchRecord {
    readonly connectionId: string;
    readonly request: IThroughputBatchRequest;
    readonly runtimeReceipt: ITaskBatchReceipt;
}

/** @description Hub owner-safe 显式批次索引；业务结果仍由逐项 task 控制面持有。 */
export class McpThroughputBatchControl {
    private readonly _records = new Map<string, IBatchRecord>();
    private readonly _maxRecords: number;

    public constructor(maxRecords = 1_024) {
        if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
            throw new Error('mcp_batch_record_limit_invalid');
        }
        this._maxRecords = maxRecords;
    }

    /** @description 关联 Runtime batchId、逐项 taskId 与 Bridge owner。 */
    public register(
        connectionId: string,
        request: IThroughputBatchRequest,
        runtimeReceipt: ITaskBatchReceipt,
    ): IThroughputBatchReceipt {
        if (runtimeReceipt.receipts.length !== request.items.length) {
            throw new Error('mcp_batch_receipt_count_mismatch');
        }
        while (this._records.size >= this._maxRecords) {
            const oldest = this._records.keys().next().value as string | undefined;
            if (oldest == null) {
                break;
            }
            this._records.delete(oldest);
        }
        this._records.set(runtimeReceipt.batchId, { connectionId, request, runtimeReceipt });
        return {
            batchId: runtimeReceipt.batchId,
            stage: 'admitted',
            items: request.items.map((item, index) => ({
                itemId: item.itemId,
                taskId: runtimeReceipt.receipts[index]?.taskId ?? '',
                admitted: true,
            })),
        };
    }

    /** @description 汇总 owner-safe 逐项状态，不读取或泄露任务业务数据。 */
    public async getStatus(
        batchId: string,
        connectionId: string,
        tasks: McpTaskControl,
    ): Promise<IThroughputBatchStatusSummary | null> {
        const record = this._records.get(batchId);
        if (record == null || record.connectionId !== connectionId) {
            return null;
        }
        const statuses = await Promise.all(record.runtimeReceipt.receipts.map(async (receipt) => {
            return tasks.getStatus(receipt.taskId, connectionId);
        }));
        if (statuses.some((status) => status == null)) {
            return null;
        }
        const concreteStatuses = statuses.map((status) => status as NonNullable<typeof status>);
        const values = concreteStatuses.map((status) => status.status);
        const terminal = values.filter((status) => this._terminal(status));
        const failed = values.filter((status) => status === 'failed' || status === 'cancelled').length;
        const pending = values.length - terminal.length;
        const status = this._batchStatus(values);
        return {
            batchId,
            stage: pending > 0 ? (values.some((value) => value === 'running') ? 'committing' : 'waiting_commit') : 'terminal',
            status,
            total: values.length,
            completed: terminal.length,
            failed,
            pending,
            projectState: this._projectState(status, concreteStatuses),
            outcomes: record.request.items.reduce<IThroughputBatchItemOutcome[]>((outcomes, item, index) => {
                const taskStatus = values[index];
                const taskId = record.runtimeReceipt.receipts[index]?.taskId;
                if (taskStatus == null || taskId == null || !this._terminal(taskStatus)) {
                    return outcomes;
                }
                outcomes.push({
                    itemId: item.itemId,
                    taskId,
                    ok: taskStatus === 'succeeded',
                    committed: taskStatus === 'succeeded',
                    summary: `Task reached terminal status ${taskStatus}.`,
                    ...(taskStatus === 'succeeded' ? {} : { errorCode: `task_${taskStatus}` }),
                });
                return outcomes;
            }, []),
        };
    }

    /** @description 尝试取消批内所有未终态任务，再返回最新汇总。 */
    public async cancel(
        batchId: string,
        connectionId: string,
        tasks: McpTaskControl,
    ): Promise<IThroughputBatchStatusSummary | null> {
        const record = this._records.get(batchId);
        if (record == null || record.connectionId !== connectionId) {
            return null;
        }
        await Promise.all(record.runtimeReceipt.receipts.map(async (receipt) => tasks.cancel(receipt.taskId, connectionId)));
        return this.getStatus(batchId, connectionId, tasks);
    }

    private _batchStatus(values: readonly TaskStatus[]): IThroughputBatchStatusSummary['status'] {
        if (values.every((status) => status === 'succeeded')) {
            return 'succeeded';
        }
        if (values.every((status) => status === 'cancelled')) {
            return 'cancelled';
        }
        if (values.every((status) => this._terminal(status))) {
            return 'failed';
        }
        return values.some((status) => status === 'running') ? 'running' : 'queued';
    }

    private _terminal(status: TaskStatus): boolean {
        return status === 'succeeded' || status === 'failed' || status === 'cancelled';
    }

    private _projectState(
        status: IThroughputBatchStatusSummary['status'],
        tasks: readonly NonNullable<Awaited<ReturnType<McpTaskControl['getStatus']>>>[],
    ): IThroughputBatchStatusSummary['projectState'] {
        if (status === 'queued') {
            return 'not_started';
        }
        if (status === 'cancelled') {
            return 'unchanged';
        }
        const failedStates = tasks
            .filter((task) => task.status === 'failed')
            .map((task) => task.failure?.projectState ?? 'unknown');
        if (failedStates.length === 0) {
            return 'may_have_changed';
        }
        if (failedStates.every((state) => state === 'not_started' || state === 'unchanged')) {
            return 'unchanged';
        }
        if (failedStates.every((state) => state === 'rolled_back')) {
            return 'rolled_back';
        }
        return 'may_have_changed';
    }
}
