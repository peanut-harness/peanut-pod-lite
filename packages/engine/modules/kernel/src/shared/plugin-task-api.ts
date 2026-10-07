import { realpathSync } from 'node:fs';
import { types as nodeTypes } from 'node:util';
import { TextFileIoGuard } from '@peanut/pod-engine/assets';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import type {
    ContractPayload,
    ITaskBatchReceipt,
    ITaskCancelResult,
    ITaskOwner,
    ITaskReceipt,
    ITaskRequest,
    ITaskResult,
    ITaskSnapshot,
    ITextFileIoLimits,
} from '@peanut/pod-protocol';
import type { ICocosRuntime, ITaskExecutor } from '@peanut/pod-engine/runtime';
import type { IMcpCapabilityInvocation } from '@peanut/pod-sdk';

import type {
    IPluginManagedTaskApi,
    IPluginTaskExecutorContext,
    IPluginTaskExecutorOptions,
    IPluginTaskApi,
    PluginManagedTaskRequest,
    PluginTaskExecutor,
} from './plugin-manager-contracts.js';

/**
 * @description 当前插件可用的任务辅助接口实现。
 */
export class PluginTaskApi implements IPluginTaskApi {
    /**
     * @description 新受管任务 API。
     */
    public readonly managed: IPluginManagedTaskApi;

    /**
     * @description 当前插件标识。
     */
    private readonly _pluginId: string;
    /**
     * @description 当前插件稳定工程键。
     */
    private readonly _projectKey: string;
    /**
     * @description Runtime 门面实例。
     */
    private readonly _runtime: ICocosRuntime;
    /**
     * @description 校验宿主签发 invocation 并解析其连接与 capability。
     */
    private readonly _resolveInvocationOwner: ((invocation: IMcpCapabilityInvocation) => { readonly connectionId: string; readonly capability: string } | null) | null;
    /**
     * @description 当前插件注册的 executor 撤销函数。
     */
    private readonly _executorDisposers = new Set<() => void>();
    /**
     * @description 当前插件创建的任务标识。
     */
    private readonly _taskIds = new Set<string>();
    /** @description 撤销 Runtime 任务回收订阅。 */
    private readonly _removeTaskReclaimedListener: () => void;
    /**
     * @description 当前任务 API 是否仍接受新任务。
     */
    private _active = true;

    /**
     * @description 创建一个新的插件任务接口。
     * @param pluginId 当前插件标识。
     * @param runtime Runtime 门面实例。
     * @param projectKey 当前插件绑定的稳定工程键。
     */
    public constructor(
        pluginId: string,
        runtime: ICocosRuntime,
        projectKey: string = `plugin:${pluginId}`,
        resolveInvocationOwner: ((invocation: IMcpCapabilityInvocation) => { readonly connectionId: string; readonly capability: string } | null) | null = null,
    ) {
        this._pluginId = pluginId;
        this._runtime = runtime;
        this._projectKey = projectKey;
        this._resolveInvocationOwner = resolveInvocationOwner;
        this._removeTaskReclaimedListener = runtime.execution.onTaskReclaimed((event) => {
            this._taskIds.delete(event.taskId);
        });
        this.managed = {
            registerExecutor: (kind, executor, options): (() => void) => this._registerExecutor(kind, executor, options),
            enqueue: async (request, invocation): Promise<ITaskReceipt> => this._enqueue(request, invocation),
            enqueueBatch: async (requests, invocations): Promise<ITaskBatchReceipt> => this._enqueueBatch(requests, invocations),
            wait: async <TData = ContractPayload>(taskId: string): Promise<ITaskResult<TData> | null> => {
                return this._wait<TData>(taskId);
            },
        };
    }

    /**
     * @description 提交一个插件任务请求。
     */
    public async submit(request: Omit<ITaskRequest, 'pluginId'>): Promise<ITaskReceipt> {
        this._assertActive();
        const receipt = await this._runtime.execution.submit({ ...request, pluginId: this._pluginId });
        this._taskIds.add(receipt.taskId);
        return receipt;
    }

    /**
     * @description 批量提交多个插件任务请求。
     */
    public async submitBatch(requests: readonly Omit<ITaskRequest, 'pluginId'>[]): Promise<ITaskBatchReceipt> {
        this._assertActive();
        const receipt = await this._runtime.execution.submitBatch(
            requests.map((request) => ({ ...request, pluginId: this._pluginId })),
        );
        for (const taskReceipt of receipt.receipts) {
            this._taskIds.add(taskReceipt.taskId);
        }
        return receipt;
    }

    /** @description 宿主预检后逐项固定 MCP capability owner 并受理同一批次。 */
    public async enqueueHostBatch(
        requests: readonly Omit<ITaskRequest, 'pluginId'>[],
        owners: readonly { readonly connectionId: string; readonly capability: string }[],
    ): Promise<ITaskBatchReceipt> {
        this._assertActive();
        if (requests.length === 0 || requests.length !== owners.length) {
            throw new Error('plugin_task_host_batch_invalid');
        }
        const receipt = await this._runtime.execution.submitOwnedBatch(requests.map((request, index) => {
            const owner = owners[index];
            if (owner == null) {
                throw new Error('plugin_task_host_batch_owner_missing');
            }
            return {
                request: { ...request, pluginId: this._pluginId },
                owner: {
                    pluginId: this._pluginId,
                    connectionId: owner.connectionId,
                    projectKey: this._projectKey,
                    capability: owner.capability,
                },
            };
        }));
        for (const item of receipt.receipts) {
            this._taskIds.add(item.taskId);
        }
        return receipt;
    }

    /**
     * @description 查询一个当前插件拥有的任务。
     */
    public async query(taskId: string): Promise<ITaskSnapshot | null> {
        const snapshot = await this._runtime.execution.query(taskId);
        if (snapshot == null || snapshot.pluginId !== this._pluginId) {
            return null;
        }
        return snapshot;
    }

    /**
     * @description 查询一个当前插件拥有任务的最终结果。
     */
    public async getResult(taskId: string): Promise<ITaskResult | null> {
        const snapshot = await this.query(taskId);
        return snapshot == null ? null : this._runtime.execution.getResult(taskId);
    }

    /**
     * @description 取消一个当前插件拥有的任务。
     */
    public async cancel(taskId: string): Promise<ITaskCancelResult> {
        const snapshot = await this.query(taskId);
        if (snapshot == null) {
            return { taskId, cancelled: false, reason: 'task_not_owned' };
        }
        return this._runtime.execution.cancel(taskId);
    }

    /**
     * @description 停止接受新任务，撤销 executor，并取消尚未进入安全终态的既有任务。
     */
    public async deactivate(): Promise<void> {
        if (!this._active) {
            return;
        }
        this._active = false;
        for (const disposer of [...this._executorDisposers]) {
            disposer();
            this._executorDisposers.delete(disposer);
        }
        for (const taskId of this._taskIds) {
            const snapshot = await this.query(taskId);
            if (snapshot != null && !this._isTerminal(snapshot.status)) {
                await this._runtime.execution.cancel(taskId);
            }
        }
        this._taskIds.clear();
        this._removeTaskReclaimedListener();
    }

    /**
     * @description 注册由当前插件提供的受管任务 executor。
     */
    private _registerExecutor(kind: string, executor: PluginTaskExecutor, options?: IPluginTaskExecutorOptions): () => void {
        this._assertActive();
        const batchExecutor = options?.executeBatch;
        const runtimeExecutor: ITaskExecutor = {
            concurrency: options?.concurrency ?? 'runtime_serial',
            execute: async (task) => {
                if (!this._active) {
                    throw new Error(`plugin_task_executor_inactive:${this._pluginId}:${kind}`);
                }
                const owner = this._runtime.execution.getOwner(task.taskId) ?? this._owner(kind);
                const signal = this._runtime.execution.getTaskAbortSignal(task.taskId);
                const prepareTextWrite = await this._createHostTextWritePreparation(task, signal);
                const data = await executor(task.request, {
                    owner,
                    signal,
                    ...(prepareTextWrite == null ? {} : { prepareTextWrite }),
                    enterCommitWindow: (): boolean => this._runtime.execution.enterTaskCommitWindow(task.taskId),
                    recordEvidence: (evidence): void => {
                        this._runtime.execution.recordEvidence(task.taskId, evidence);
                    },
                });
                return {
                    taskId: task.taskId,
                    kind: task.request.kind,
                    data: this._toData(data),
                    changes: [],
                };
            },
            ...(batchExecutor == null ? {} : {
                executeBatch: async (tasks, batchId, mergePolicy) => {
                    if (!this._active) {
                        throw new Error(`plugin_task_executor_inactive:${this._pluginId}:${kind}`);
                    }
                    const contexts = await Promise.all(tasks.map(async (task) => {
                        const owner = this._runtime.execution.getOwner(task.taskId) ?? this._owner(kind);
                        const signal = this._runtime.execution.getTaskAbortSignal(task.taskId);
                        const prepareTextWrite = await this._createHostTextWritePreparation(task, signal);
                        return {
                            owner,
                            signal,
                            ...(prepareTextWrite == null ? {} : { prepareTextWrite }),
                            enterCommitWindow: (): boolean => this._runtime.execution.enterTaskCommitWindow(task.taskId),
                            recordEvidence: (evidence: Parameters<IPluginTaskExecutorContext['recordEvidence']>[0]): void => {
                                this._runtime.execution.recordEvidence(task.taskId, evidence);
                            },
                        };
                    }));
                    const values = await batchExecutor(
                        tasks.map((task) => task.request),
                        contexts,
                        batchId,
                        mergePolicy,
                    );
                    if (values.length !== tasks.length) {
                        throw new Error('plugin_task_batch_result_count_mismatch');
                    }
                    return tasks.map((task, index) => ({
                        taskId: task.taskId,
                        kind: task.request.kind,
                        data: this._toData(values[index]),
                        changes: [],
                    }));
                },
            }),
        };
        const revoke = this._runtime.execution.registerExecutor(this._pluginId, kind, runtimeExecutor);
        let active = true;
        const dispose = (): void => {
            if (!active) {
                return;
            }
            active = false;
            this._executorDisposers.delete(dispose);
            revoke();
        };
        this._executorDisposers.add(dispose);
        return dispose;
    }

    /**
     * @description 为原受理文本任务绑定真实 Host 工程、信号及仅一次实际 Guard 检查。
     * @param task Runtime 交给本 Kernel 的原受理任务。
     * @param signal 本 Runtime 为该 taskId 创建的信号。
     * @returns 内部同步准备端口；其它任务保持原上下文，不增加能力。
     */
    private async _createHostTextWritePreparation(task: Parameters<ITaskExecutor['execute']>[0],
        signal: AbortSignal): Promise<IPluginTaskExecutorContext['prepareTextWrite']> {
        const request = task.request;
        if (nodeTypes.isProxy(request)) return undefined;
        const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
        if (Object.getOwnPropertyDescriptor(request, 'kind')?.value !== 'editor-mcp.resource-operation'
            || payload == null || typeof payload !== 'object' || nodeTypes.isProxy(payload)
            || Object.getOwnPropertyDescriptor(payload, 'operation')?.value !== 'asset.writeText') return undefined;
        const originalInput: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
        const provenance = ExecutionRuntimeService.bindHostTextWriteGuardPreparation(request, signal);
        const hostProject = await this._runtime.project.getProjectPath();
        if (hostProject == null) throw new Error('text_file_io_host_project_unavailable');
        const hostRoot = realpathSync(hostProject);
        let used = false;
        return (originRequest, projectRoot, input, limits, providedSignal) => {
            if (used || !this._active || signal.aborted || originRequest !== request || providedSignal !== signal
                || this._runtime.execution.getTaskAbortSignal(task.taskId) !== signal
                || input !== originalInput || realpathSync(projectRoot) !== hostRoot) {
                throw new Error('text_file_io_host_preparation_untrusted');
            }
            used = true;
            const bounded = this._boundedTextWriteLimits(limits);
            return provenance.run(() => {
                try { return new TextFileIoGuard(hostRoot, bounded).prepareWrite(input); }
                catch (error: unknown) {
                    // 此 producer 仅在 Host 内部真正 Guard.prepareWrite 的 catch；SDK 无 record 回调。
                    ExecutionRuntimeService.recordTextWritePreparationRefusal(error, input);
                    throw error;
                }
            });
        };
    }

    /**
     * @description 检查容量为有限自有数据属性且只能收紧当前产品上限。
     * @param limits Core 传递的原容量对象。
     * @returns Host 核实后的有限容量值。
     */
    private _boundedTextWriteLimits(limits: ITextFileIoLimits): ITextFileIoLimits {
        if (limits == null || typeof limits !== 'object' || nodeTypes.isProxy(limits)
            || Reflect.ownKeys(limits).length !== 4) throw new Error('text_file_io_host_limits_untrusted');
        const read = (key: keyof ITextFileIoLimits): number => {
            const value: unknown = Object.getOwnPropertyDescriptor(limits, key)?.value;
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
                || value > CoreTextFileIoContract.limits[key]) throw new Error('text_file_io_host_limits_untrusted');
            return value;
        };
        return { maxFiles: read('maxFiles'), maxFileBytes: read('maxFileBytes'),
            maxInputBytes: read('maxInputBytes'), maxOutputBytes: read('maxOutputBytes') };
    }

    /**
     * @description 显式入队一个 owner 由宿主注入的受管任务。
     */
    private async _enqueue(request: PluginManagedTaskRequest, invocation?: IMcpCapabilityInvocation): Promise<ITaskReceipt> {
        this._assertActive();
        const invocationOwner = invocation == null ? null : this._resolveInvocationOwner?.(invocation) ?? null;
        if (invocation != null && invocationOwner == null) {
            throw new Error('plugin_task_invocation_untrusted');
        }
        const receipt = await this._runtime.execution.submitOwned(
            { ...request, pluginId: this._pluginId },
            invocationOwner == null
                ? this._owner(request.kind)
                : {
                    pluginId: this._pluginId,
                    connectionId: invocationOwner.connectionId,
                    projectKey: this._projectKey,
                    capability: invocationOwner.capability,
                },
        );
        this._taskIds.add(receipt.taskId);
        return receipt;
    }

    /** @description 在创建任何任务前解析并固定批内全部 owner。 */
    private async _enqueueBatch(
        requests: readonly PluginManagedTaskRequest[],
        invocations: readonly IMcpCapabilityInvocation[] = [],
    ): Promise<ITaskBatchReceipt> {
        this._assertActive();
        if (requests.length === 0 || (invocations.length !== 0 && invocations.length !== requests.length)) {
            throw new Error('plugin_task_batch_invalid');
        }
        const entries = requests.map((request, index) => {
            const invocation = invocations[index];
            const invocationOwner = invocation == null ? null : this._resolveInvocationOwner?.(invocation) ?? null;
            if (invocation != null && invocationOwner == null) {
                throw new Error('plugin_task_invocation_untrusted');
            }
            return {
                request: { ...request, pluginId: this._pluginId },
                owner: invocationOwner == null
                    ? this._owner(request.kind)
                    : {
                        pluginId: this._pluginId,
                        connectionId: invocationOwner.connectionId,
                        projectKey: this._projectKey,
                        capability: invocationOwner.capability,
                    },
            };
        });
        const receipt = await this._runtime.execution.submitOwnedBatch(entries);
        for (const item of receipt.receipts) {
            this._taskIds.add(item.taskId);
        }
        return receipt;
    }

    /**
     * @description 等待当前插件拥有的任务进入终态。
     */
    private async _wait<TData>(taskId: string): Promise<ITaskResult<TData> | null> {
        while (true) {
            const snapshot = await this.query(taskId);
            if (snapshot == null) {
                return null;
            }
            const result = await this._runtime.execution.getResult(taskId);
            if (result != null || this._isTerminal(snapshot.status)) {
                return result as ITaskResult<TData> | null;
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }

    /**
     * @description 构造不可由外部请求覆盖的任务 owner。
     */
    private _owner(capability: string): ITaskOwner {
        return {
            pluginId: this._pluginId,
            connectionId: `plugin:${this._pluginId}`,
            projectKey: this._projectKey,
            capability,
        };
    }

    /**
     * @description 拒绝已停用插件创建新任务或 executor。
     */
    private _assertActive(): void {
        if (!this._active) {
            throw new Error(`plugin_task_api_inactive:${this._pluginId}`);
        }
    }

    /**
     * @description 判断任务是否已进入终态。
     */
    private _isTerminal(status: ITaskSnapshot['status']): boolean {
        return status === 'succeeded' || status === 'failed' || status === 'cancelled';
    }

    /**
     * @description 将 executor 返回值投影为 Runtime 结果数据。
     */
    private _toData(value: unknown): Record<string, unknown> | undefined {
        if (value == null) {
            return undefined;
        }
        return typeof value === 'object' && !Array.isArray(value)
            ? { ...(value as Record<string, unknown>) }
            : { value };
    }
}
