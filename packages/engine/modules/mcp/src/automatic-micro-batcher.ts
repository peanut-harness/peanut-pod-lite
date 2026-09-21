import type { ITaskReceipt } from '@peanut/pod-protocol';
import type { IMcpCapabilityInvocation, IPluginManagedTaskApi, PluginManagedTaskRequest } from '@peanut/pod-sdk';

interface IPendingMicroBatchItem {
    readonly request: PluginManagedTaskRequest;
    readonly invocation: IMcpCapabilityInvocation;
    readonly resources: ReadonlySet<string>;
    readonly resolve: (receipt: ITaskReceipt) => void;
    readonly reject: (error: unknown) => void;
}

interface IPendingMicroBatch {
    readonly items: IPendingMicroBatchItem[];
    readonly resources: Set<string>;
    inputBytes: number;
    timer: ReturnType<typeof setTimeout>;
}

/** @description 默认关闭时不创建；启用后只合并严格同 owner/operation/审批边界且资源不冲突的相邻写请求。 */
export class AutomaticMicroBatcher {
    private static readonly MAX_ITEMS = 32;
    private static readonly MAX_INPUT_BYTES = 4 * 1024 * 1024;
    private readonly _managedTasks: IPluginManagedTaskApi;
    private readonly _windowMs: number;
    private readonly _pending = new Map<string, IPendingMicroBatch>();
    private _disposed = false;

    public constructor(managedTasks: IPluginManagedTaskApi, windowMs = 10) {
        if (!Number.isInteger(windowMs) || windowMs <= 0) {
            throw new Error('editor_mcp_micro_batch_window_invalid');
        }
        this._managedTasks = managedTasks;
        this._windowMs = windowMs;
    }

    public async enqueue(
        operation: string,
        request: PluginManagedTaskRequest,
        invocation: IMcpCapabilityInvocation,
    ): Promise<ITaskReceipt> {
        if (this._disposed) {
            throw new Error('editor_mcp_micro_batcher_disposed');
        }
        if (invocation.signal?.aborted) {
            throw new Error('editor_mcp_micro_batch_cancelled');
        }
        const resources = new Set(invocation.resourceIds ?? []);
        if (resources.size === 0) {
            return this._managedTasks.enqueue(request, invocation);
        }
        const inputBytes = new TextEncoder().encode(JSON.stringify(request.payload ?? {})).byteLength;
        if (inputBytes > AutomaticMicroBatcher.MAX_INPUT_BYTES) {
            return this._managedTasks.enqueue(request, invocation);
        }
        const key = [
            invocation.connectionId,
            operation,
            invocation.risk ?? 'write',
            invocation.hasLocalApproval === true ? 'approved' : 'unapproved',
        ].join('\u0000');
        let batch = this._pending.get(key);
        if (
            batch != null
            && (batch.items.length >= AutomaticMicroBatcher.MAX_ITEMS
                || batch.inputBytes + inputBytes > AutomaticMicroBatcher.MAX_INPUT_BYTES
                || [...resources].some((resource) => batch?.resources.has(resource) === true))
        ) {
            this._pending.delete(key);
            clearTimeout(batch.timer);
            void this._flush(batch);
            batch = undefined;
        }
        if (batch == null) {
            const timer = setTimeout(() => {
                const current = this._pending.get(key);
                if (current == null) {
                    return;
                }
                this._pending.delete(key);
                void this._flush(current);
            }, this._windowMs);
            timer.unref?.();
            batch = { items: [], resources: new Set(), inputBytes: 0, timer };
            this._pending.set(key, batch);
        }
        for (const resource of resources) {
            batch.resources.add(resource);
        }
        batch.inputBytes += inputBytes;
        return new Promise<ITaskReceipt>((resolve, reject) => {
            batch?.items.push({ request, invocation, resources, resolve, reject });
        });
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        for (const batch of this._pending.values()) {
            clearTimeout(batch.timer);
            for (const item of batch.items) {
                item.reject(new Error('editor_mcp_micro_batcher_disposed'));
            }
        }
        this._pending.clear();
    }

    private async _flush(batch: IPendingMicroBatch): Promise<void> {
        try {
            if (batch.items.length === 1) {
                const item = batch.items[0];
                if (item == null) {
                    return;
                }
                item.resolve(await this._managedTasks.enqueue(item.request, item.invocation));
                return;
            }
            const receipt = await this._managedTasks.enqueueBatch(
                batch.items.map((item) => item.request),
                batch.items.map((item) => item.invocation),
            );
            if (receipt.receipts.length !== batch.items.length) {
                throw new Error('editor_mcp_micro_batch_receipt_count_mismatch');
            }
            batch.items.forEach((item, index) => {
                const taskReceipt = receipt.receipts[index];
                if (taskReceipt == null) {
                    item.reject(new Error('editor_mcp_micro_batch_receipt_missing'));
                    return;
                }
                item.resolve(taskReceipt);
            });
        } catch (error) {
            for (const item of batch.items) {
                item.reject(error);
            }
        }
    }
}
