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
    private static readonly MAX_PREPARE_CONCURRENCY = 4;
    private static readonly CONTROL_YIELD_TARGET_MS = 200;
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

    /** @description 有界并行规划整个批次，随后以联合资源锁在唯一 writer 窗口顺序提交。 */
    public async executeBatch(
        requests: readonly Readonly<ITaskRequest>[],
        contexts: readonly IPluginTaskExecutorContext[],
        batchId: string,
    ): Promise<readonly unknown[]> {
        if (requests.length === 0 || requests.length !== contexts.length) {
            throw new Error('editor_mcp_resource_batch_invalid');
        }
        let prepared: Awaited<ReturnType<ResourceOperationTaskExecutor['_prepareBatch']>>;
        try {
            prepared = await this._prepareBatch(requests);
        } catch (error) {
            throw this._batchFailure(error, 'unchanged');
        }
        const projectKey = prepared[0]?.plan.projectKey;
        if (projectKey == null || prepared.some((entry) => entry.plan.projectKey !== projectKey)) {
            throw new Error('editor_mcp_resource_batch_project_mismatch');
        }
        const resourceKeys = [...new Set(prepared.flatMap((entry) => entry.plan.resourceKeys))].sort();
        let lease: Awaited<ReturnType<ResourceLockManager['acquireSet']>>;
        try {
            lease = await this._lockManager.acquireSet({
                projectKey,
                resourceKeys,
                requiresProjectWriter: prepared.some((entry) => entry.plan.requiresProjectWriter),
            }, {
                signal: contexts[0]?.signal,
            });
        } catch (error) {
            throw this._batchFailure(error, 'unchanged');
        }
        let operationStarted = false;
        try {
            for (const context of contexts) {
                if (!context.enterCommitWindow()) {
                    throw new Error('editor_mcp_batch_cancelled_before_commit');
                }
            }
            const results: unknown[] = [];
            let sliceStartedAt = Date.now();
            for (let index = 0; index < prepared.length; index += 1) {
                const entry = prepared[index];
                const context = contexts[index];
                if (entry == null || context == null) {
                    throw new Error('editor_mcp_resource_batch_mapping_invalid');
                }
                context.recordEvidence({
                    id: 'batch-resource-closure',
                    kind: 'resource_closure',
                    status: 'completed',
                    summary: `Batch ${batchId} reserved ${resourceKeys.length} union resource key(s).`,
                    recordedAt: new Date().toISOString(),
                });
                operationStarted = true;
                results.push(await this._options.execute(entry.payload.operation, entry.payload.input, context));
                if (
                    index + 1 < prepared.length
                    && Date.now() - sliceStartedAt >= ResourceOperationTaskExecutor.CONTROL_YIELD_TARGET_MS
                ) {
                    await new Promise<void>((resolveYield) => setTimeout(resolveYield, 0));
                    sliceStartedAt = Date.now();
                }
            }
            contexts[0]?.recordEvidence({
                id: 'batch-postflight',
                kind: 'postflight',
                status: 'completed',
                summary: `Batch ${batchId} completed one authoritative commit window.`,
                recordedAt: new Date().toISOString(),
            });
            return results;
        } catch (error) {
            contexts[0]?.recordEvidence({
                id: 'batch-postflight',
                kind: 'postflight',
                status: 'failed',
                summary: `Batch ${batchId} failed; project state must be treated conservatively.`,
                recordedAt: new Date().toISOString(),
            });
            throw this._batchFailure(error, operationStarted ? 'may_have_changed' : 'unchanged');
        } finally {
            lease.release();
        }
    }

    private async _prepareBatch(
        requests: readonly Readonly<ITaskRequest>[],
    ): Promise<readonly {
        readonly payload: { readonly operation: string; readonly input: Readonly<Record<string, unknown>> };
        readonly plan: IResourceOperationTaskPlan;
    }[]> {
        const results = new Array<{
            readonly payload: { readonly operation: string; readonly input: Readonly<Record<string, unknown>> };
            readonly plan: IResourceOperationTaskPlan;
        }>(requests.length);
        let nextIndex = 0;
        const workers = Array.from(
            { length: Math.min(ResourceOperationTaskExecutor.MAX_PREPARE_CONCURRENCY, requests.length) },
            async () => {
                while (nextIndex < requests.length) {
                    const index = nextIndex;
                    nextIndex += 1;
                    const request = requests[index];
                    if (request == null) {
                        throw new Error('editor_mcp_resource_batch_request_missing');
                    }
                    const payload = this._readPayload(request.payload);
                    results[index] = { payload, plan: await this._options.plan(payload.operation, payload.input) };
                }
            },
        );
        await Promise.all(workers);
        return results;
    }

    private _batchFailure(
        error: unknown,
        fallback: 'unchanged' | 'may_have_changed',
    ): Error & { readonly projectState: 'unchanged' | 'rolled_back' | 'may_have_changed' } {
        const message = error instanceof Error ? error.message : 'editor_mcp_batch_failed';
        const declared = error != null && typeof error === 'object'
            ? (error as { readonly projectState?: unknown }).projectState
            : null;
        const projectState: 'unchanged' | 'rolled_back' | 'may_have_changed' =
            declared === 'rolled_back' || declared === 'unchanged' || declared === 'may_have_changed'
            ? declared
            : fallback;
        return Object.assign(new Error(message), { projectState });
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
