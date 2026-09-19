import type { IMcpFailureDetails } from '@peanut/pod-protocol';

import type { IResourceOperationTaskRecord } from './resource-operation-contracts.js';

/**
 * @description 写任务失败异常；保留原始原因与可诊断任务记录。
 */
export class ResourceOperationTaskError extends Error {
    /**
     * @description 失败任务最终记录。
     */
    public readonly record: IResourceOperationTaskRecord<unknown>;
    /**
     * @description worker 抛出的原始原因。
     */
    public readonly cause: unknown;
    /**
     * @description Hub 可安全序列化的结构化失败详情。
     */
    public readonly mcpFailure: IMcpFailureDetails;

    /**
     * @description 创建带 taskId 的写任务失败异常。
     * @param record 失败任务最终记录。
     * @param cause worker 抛出的原始原因。
     */
    public constructor(record: IResourceOperationTaskRecord<unknown>, cause: unknown) {
        super(cause instanceof Error ? cause.message : record.error ?? `resource_operation_task_failed:${record.taskId}`);
        this.name = 'ResourceOperationTaskError';
        this.record = record;
        this.cause = cause;
        this.mcpFailure = record.failure ?? {
            schemaVersion: 1,
            code: 'resource_operation_task_failed',
            category: 'execution_failed',
            reason: 'The resource operation failed without structured diagnostics.',
            retryable: false,
            state: 'unknown',
            recommendedAction: 'stop',
            taskId: record.taskId,
            taskStatus: 'failed',
            operation: record.operation,
        };
    }
}
