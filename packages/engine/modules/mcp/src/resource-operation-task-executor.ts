import type { ITaskRequest } from '@peanut/pod-protocol';
import { ResourceLockManager } from '@peanut/pod-engine/runtime';
import type { IPluginTaskExecutorContext } from '@peanut/pod-sdk';

import type { IResourceOperationTaskPlan } from './resource-operation-contracts.js';

/**
 * @description 资源 operation executor 的领域依赖。
 */
export interface IResourceOperationTaskExecutorOptions {
    /**
     * @description 规划完整资源闭包。
     */
    plan(operation: string, input: Readonly<Record<string, unknown>>): Promise<IResourceOperationTaskPlan>;
    /**
     * @description 在锁内执行原业务 worker 与唯一 postflight。
     */
    execute(
        operation: string,
        input: Readonly<Record<string, unknown>>,
        context: IPluginTaskExecutorContext,
    ): Promise<unknown>;
    /**
     * @description 可注入共享原子锁管理器。
     */
    readonly lockManager?: ResourceLockManager;
}

/**
 * @description Editor MCP 资源任务 executor；用原子资源集合和 project writer 取代独立队列状态。
 */
export class ResourceOperationTaskExecutor {
    /**
     * @description 稳定 Runtime task kind。
     */
    public static readonly KIND = 'editor-mcp.resource-operation';

    private readonly _options: IResourceOperationTaskExecutorOptions;
    private readonly _lockManager: ResourceLockManager;

    public constructor(options: IResourceOperationTaskExecutorOptions) {
        this._options = options;
        this._lockManager = options.lockManager ?? new ResourceLockManager();
    }

    /**
     * @description 规划、原子取锁并执行一个资源 operation。
     */
    public async execute(request: Readonly<ITaskRequest>, context: IPluginTaskExecutorContext): Promise<unknown> {
        const payload = this._readPayload(request.payload);
        const plan = await this._options.plan(payload.operation, payload.input);
        context.recordEvidence({
            id: 'resource-closure',
            kind: 'resource_closure',
            status: 'completed',
            summary: `Planned ${plan.resourceKeys.length} resource key(s); projectWriter=${plan.requiresProjectWriter}.`,
            recordedAt: new Date().toISOString(),
        });
        const lease = await this._lockManager.acquireSet({
            projectKey: plan.projectKey,
            resourceKeys: plan.resourceKeys,
            requiresProjectWriter: plan.requiresProjectWriter,
        }, {
            ...(request.timeoutMs == null ? {} : { timeoutMs: request.timeoutMs }),
            signal: context.signal,
        });
        try {
            if (plan.workerManagedCommitWindow !== true && !context.enterCommitWindow()) {
                throw new Error('editor_mcp_task_cancelled_before_commit');
            }
            try {
                const result = await this._options.execute(payload.operation, payload.input, context);
                context.recordEvidence({
                    id: 'postflight',
                    kind: 'postflight',
                    status: 'completed',
                    summary: 'Resource operation worker and postflight completed.',
                    recordedAt: new Date().toISOString(),
                });
                return result;
            } catch (error: unknown) {
                context.recordEvidence({
                    id: 'postflight',
                    kind: 'postflight',
                    status: 'failed',
                    summary: 'Resource operation worker or authoritative postflight failed.',
                    recordedAt: new Date().toISOString(),
                });
                throw error;
            }
        } finally {
            lease.release();
        }
    }

    /**
     * @description 校验 Runtime task payload。
     */
    private _readPayload(payload: unknown): { readonly operation: string; readonly input: Readonly<Record<string, unknown>> } {
        if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new Error('editor_mcp_resource_task_payload_invalid');
        }
        const record = payload as Record<string, unknown>;
        const input = record.input;
        if (
            typeof record.operation !== 'string' || record.operation.length === 0 ||
            input == null || typeof input !== 'object' || Array.isArray(input)
        ) {
            throw new Error('editor_mcp_resource_task_payload_invalid');
        }
        return { operation: record.operation, input: input as Readonly<Record<string, unknown>> };
    }
}
