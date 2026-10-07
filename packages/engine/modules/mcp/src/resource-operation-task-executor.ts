import { types as nodeTypes } from 'node:util';
import { EditorMcpTextWriteGateway } from './editor-mcp-text-write-gateway.js';
import type { ITaskRequest } from '@peanut/pod-protocol';
import { ResourceLockManager, ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import type { IPluginTaskExecutorContext } from '@peanut/pod-sdk';

import type { IResourceOperationBatchContext, IResourceOperationTaskPlan } from './resource-operation-contracts.js';

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
        plan: IResourceOperationTaskPlan,
        batch?: IResourceOperationBatchContext,
    ): Promise<unknown>;
    /**
     * @description 在联合锁内、任何 worker 变化前重验原始调用局部准备。
     * @param operation 既有操作标识。
     * @param input 原始业务输入。
     * @param plan 同一次规划的不可变计划。
     * @returns 重验结束的 Promise，不执行写入。
     */
    revalidate?(
        operation: string,
        input: Readonly<Record<string, unknown>>,
        plan: IResourceOperationTaskPlan,
    ): Promise<void>;

    /**
     * @description 原锁内创建调用局部最终收口，不新增writer。
     */
    beginBatch?(plans: readonly IResourceOperationTaskPlan[], requests: readonly Readonly<ITaskRequest>[]): Promise<IResourceOperationBatchContext>;

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
        const plan = await this._preparePlan(request, context, payload);
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
        let batch: IResourceOperationBatchContext | undefined;
        try {
            await this._options.revalidate?.(payload.operation, payload.input, plan);
            if (plan.workerManagedCommitWindow !== true && !context.enterCommitWindow()) {
                throw new Error('editor_mcp_task_cancelled_before_commit');
            }
            batch = plan.preparedTextWrite == null ? undefined : await this._options.beginBatch?.([plan], [request]);
            try {
                const staged = await this._options.execute(payload.operation, payload.input, context, plan, batch);
                const result = batch == null ? staged : (await batch.finish([staged]))[0];
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
                throw batch?.failure(error) ?? error;
            }
        } finally {
            lease.release();
        }
    }

    /**
     * @description 有界并行规划整个批次，随后以联合资源锁在唯一 writer 窗口顺序提交。
     */
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
            prepared = await this._prepareBatch(requests, contexts);
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
        let batch: IResourceOperationBatchContext | undefined;
        try {
            for (const entry of prepared) {
                await this._options.revalidate?.(entry.payload.operation, entry.payload.input, entry.plan);
            }
            for (const context of contexts) {
                if (!context.enterCommitWindow()) {
                    throw new Error('editor_mcp_batch_cancelled_before_commit');
                }
            }
            batch = prepared.some((entry) => entry.plan.preparedTextWrite != null)
                ? await this._options.beginBatch?.(prepared.map((entry) => entry.plan), requests) : undefined;
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
                results.push(await this._options.execute(entry.payload.operation, entry.payload.input, context, entry.plan, batch));
                if (
                    index + 1 < prepared.length
                    && Date.now() - sliceStartedAt >= ResourceOperationTaskExecutor.CONTROL_YIELD_TARGET_MS
                ) {
                    await new Promise<void>((resolveYield) => setTimeout(resolveYield, 0));
                    sliceStartedAt = Date.now();
                }
            }
            const finalResults = batch == null ? results : await batch.finish(results);
            contexts[0]?.recordEvidence({
                id: 'batch-postflight',
                kind: 'postflight',
                status: 'completed',
                summary: `Batch ${batchId} completed one authoritative commit window.`,
                recordedAt: new Date().toISOString(),
            });
            return finalResults;
        } catch (error) {
            contexts[0]?.recordEvidence({
                id: 'batch-postflight',
                kind: 'postflight',
                status: 'failed',
                summary: `Batch ${batchId} failed; project state must be treated conservatively.`,
                recordedAt: new Date().toISOString(),
            });
            throw this._batchFailure(batch?.failure(error) ?? error, operationStarted ? 'may_have_changed' : 'unchanged');
        } finally {
            lease.release();
        }
    }

    private async _prepareBatch(
        requests: readonly Readonly<ITaskRequest>[],
        contexts: readonly IPluginTaskExecutorContext[],
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
                    const context = contexts[index];
                    if (context == null) throw new Error('editor_mcp_resource_batch_context_missing');
                    const plan = await this._preparePlan(request, context, payload);
                    results[index] = { payload, plan };
                }
            },
        );
        // 等待全部无写入准备结束，避免另一真实失败在 origin 证明已消费后才出现。
        const settled = await Promise.allSettled(workers);
        const failures: unknown[] = settled.flatMap((row) => row.status === 'rejected' ? [row.reason] : []);
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
            // 多来源失败不可携带任一原 Error 的私有 proof；按原顺序保留全部原错误。
            const error = new Error('editor_mcp_batch_preparation_multiple_failures');
            Object.defineProperty(error, 'errors', {
                value: Object.freeze([...failures]),
                enumerable: false,
                writable: false,
                configurable: false,
            });
            throw Object.assign(error, { projectState: 'may_have_changed' });
        }
        return results;
    }

    /**
     * @description 选择实际 Host Guard 端口；缺失时仅保留原同包 executor 的兼容路径。
     * @param request 原 Runtime 受理请求。
     * @param context 原 Host 上下文，属性必须是非 Proxy 自有数据函数。
     * @param payload 原业务 payload。
     * @returns 实际原异步 plan。
     */
    private _preparePlan(request: Readonly<ITaskRequest>, context: IPluginTaskExecutorContext,
        payload: { readonly operation: string; readonly input: Readonly<Record<string, unknown>> }): Promise<IResourceOperationTaskPlan> {
        if (nodeTypes.isProxy(context)) throw new Error('editor_mcp_resource_context_untrusted');
        const descriptor = Object.getOwnPropertyDescriptor(context, 'prepareTextWrite');
        if (descriptor != null) {
            if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
                throw new Error('editor_mcp_resource_context_untrusted');
            }
            const prepare = context.prepareTextWrite;
            if (prepare == null) throw new Error('editor_mcp_resource_context_untrusted');
            return EditorMcpTextWriteGateway.withHostTextWritePreparation(prepare, request, context.signal,
                () => this._options.plan(payload.operation, payload.input));
        }
        return ExecutionRuntimeService.withTextWritePreparation(request, context.signal,
            () => this._options.plan(payload.operation, payload.input));
    }

    private _batchFailure(
        error: unknown,
        fallback: 'unchanged' | 'may_have_changed',
    ): object & { readonly projectState: 'unchanged' | 'rolled_back' | 'may_have_changed' } {
        const nativeError = error != null && typeof error === 'object' && !nodeTypes.isProxy(error)
            && nodeTypes.isNativeError(error);
        const originalMessage: unknown = nativeError ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined;
        const message = typeof originalMessage === 'string' ? originalMessage : 'editor_mcp_batch_failed';
        const declared: unknown = error != null && typeof error === 'object' && !nodeTypes.isProxy(error)
            ? Object.getOwnPropertyDescriptor(error, 'projectState')?.value : null;
        const projectState: 'unchanged' | 'rolled_back' | 'may_have_changed' =
            declared === 'rolled_back' || declared === 'unchanged' || declared === 'may_have_changed'
            ? declared
            : fallback;
        if (error != null && typeof error === 'object' && nativeError) return Object.assign(error, { projectState });
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
