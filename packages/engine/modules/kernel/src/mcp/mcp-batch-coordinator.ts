import { resolve } from 'path';

import type {
    IThroughputBatchItemRequest,
    IThroughputBatchRequest,
    ITaskRequest,
    McpCapabilityRisk,
} from '@peanut/pod-protocol';
import type {
    IProjectWriterBarrierLease,
    ProjectRevisionClock,
    ProjectWriterBarrier,
    ThroughputAdmissionController,
} from '@peanut/pod-engine/runtime';

import type { PluginManagerApp } from '../app/plugin-manager-app.js';
import type { CocosMcpInputReader } from './cocos-mcp-input-reader.js';
import { McpBatchApprovalStore } from './mcp-batch-approval-store.js';
import { McpThroughputBatchControl } from './mcp-throughput-batch-control.js';

export interface IMcpApprovalLeaseMirror {
    (request: {
        readonly connectionId: string;
        readonly resources: readonly string[];
        readonly operations?: readonly string[];
        readonly maxRisk?: 'write' | 'destructive';
        readonly idleLeaseMs?: number;
        readonly maxHoldMs?: number;
        readonly sessionBound?: boolean;
        readonly preferredToken?: string;
    }): { readonly token: string; readonly expiresAt: number; readonly idleLeaseMs?: number; readonly maxHoldMs?: number } | null;
}

interface IMcpBatchCoordinatorOptions {
    readonly projectPath: string;
    readonly pluginManagerProvider: () => PluginManagerApp | null;
    readonly inputReader: CocosMcpInputReader;
    readonly admission: ThroughputAdmissionController;
    readonly revision: ProjectRevisionClock;
    readonly writerBarrier: ProjectWriterBarrier;
    readonly ensureTaskSubscription: () => void;
    readonly mirrorApprovalLease?: IMcpApprovalLeaseMirror;
}

interface IIssuedApproval {
    readonly approvalToken: string;
    readonly approvalId: string;
    readonly expiresAt: number;
    readonly idleLeaseMs: number;
    readonly liteMirrored: boolean;
}

export class McpBatchCoordinator {
    private readonly _approvals = new McpBatchApprovalStore();
    private readonly _batches = new McpThroughputBatchControl();
    private readonly _pendingWriters = new Map<string, {
        readonly remainingTaskIds: Set<string>;
        readonly barrierLease: IProjectWriterBarrierLease;
    }>();
    private readonly _batchByTaskId = new Map<string, string>();
    private _approvalMirror: IMcpApprovalLeaseMirror | null;

    public constructor(private readonly _options: IMcpBatchCoordinatorOptions) {
        this._approvalMirror = _options.mirrorApprovalLease ?? null;
    }

    public setApprovalMirror(mirror: IMcpApprovalLeaseMirror | null): void {
        this._approvalMirror = mirror;
    }

    public revokeApproval(token: string): boolean {
        return this._approvals.revoke(token);
    }

    public tryConsumeApproval(token: string, request: {
        readonly connectionId: string;
        readonly operation: string;
        readonly resources: readonly string[];
        readonly risk: McpCapabilityRisk;
    }): boolean {
        return this._approvals.tryConsume(token, request);
    }

    public issueApproval(
        connectionId: string,
        resources: readonly string[],
        operations: readonly string[] | undefined,
        maxRisk: 'write' | 'destructive',
        options?: { readonly sessionBound?: boolean; readonly idleLeaseMs?: number; readonly maxHoldMs?: number },
    ): IIssuedApproval {
        const issued = this._approvals.issue({
            connectionId,
            resources,
            operations,
            maxRisk,
            sessionBound: options?.sessionBound === true,
            ...(options?.idleLeaseMs == null ? {} : { idleLeaseMs: options.idleLeaseMs }),
            ...(options?.maxHoldMs == null ? {} : { maxHoldMs: options.maxHoldMs }),
        });
        const approvalId = this._mirrorApproval(
            connectionId, resources, operations, maxRisk, issued.token,
            issued.idleLeaseMs, issued.maxHoldMs, options?.sessionBound === true,
        );
        return {
            approvalToken: issued.token,
            approvalId: approvalId ?? issued.token,
            expiresAt: issued.expiresAt,
            idleLeaseMs: issued.idleLeaseMs,
            liteMirrored: approvalId != null,
        };
    }

    public issueApprovalFromPayload(connectionId: string, payload: Record<string, unknown>): IIssuedApproval {
        if (!Array.isArray(payload.resources)) {
            throw new Error('cocos_mcp_approval_resources_required');
        }
        const resources = payload.resources.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
        );
        const operations = Array.isArray(payload.operations)
            ? payload.operations.filter(
                (item): item is string => typeof item === 'string' && item.trim().length > 0,
            )
            : undefined;
        return this.issueApproval(
            connectionId,
            resources,
            operations,
            payload.maxRisk === 'destructive' ? 'destructive' : 'write',
            {
                sessionBound: payload.sessionBound === true,
                ...(typeof payload.idleLeaseMs === 'number' && Number.isFinite(payload.idleLeaseMs)
                    ? { idleLeaseMs: payload.idleLeaseMs }
                    : {}),
                ...(typeof payload.maxHoldMs === 'number' && Number.isFinite(payload.maxHoldMs)
                    ? { maxHoldMs: payload.maxHoldMs }
                    : {}),
            },
        );
    }

    public async submit(
        request: IThroughputBatchRequest,
        connectionId: string,
        signal: AbortSignal | undefined,
        directWriteEnabled: boolean,
    ): Promise<unknown> {
        const admission = await this._options.admission.acquire({
            connectionId,
            projectKey: resolve(this._options.projectPath),
            costClass: 'prepare',
            ...(signal == null ? {} : { signal }),
        });
        try {
            const items = this._orderAndValidate(request);
            const registry = this._pluginManager().getMcpCapabilityRegistry();
            const prepared = items.map((item) => {
                const definition = registry.getDefinition(item.operation);
                if (
                    definition == null || definition.readOnly || definition.executionModel !== 'managed_task'
                    || definition.throughput?.explicitBatchEligible !== true
                    || typeof definition.throughput.operationId !== 'string'
                ) {
                    throw new Error(`cocos_mcp_batch_operation_ineligible:${item.itemId}`);
                }
                registry.validateInput(item.operation, item.input);
                if (definition.risk === 'destructive' && this._options.inputReader.readConfirmDestructive(item.input) !== true) {
                    throw new Error(`cocos_mcp_batch_destructive_confirmation_required:${item.itemId}`);
                }
                const resources = this._options.inputReader.readOptionalResources(item.input);
                if (resources.length === 0) {
                    throw new Error(`cocos_mcp_batch_resources_required:${item.itemId}`);
                }
                const pluginId = registry.getProviderPluginId(item.operation);
                if (pluginId == null) {
                    throw new Error(`cocos_mcp_batch_provider_unavailable:${item.itemId}`);
                }
                return {
                    item, definition, resources, pluginId,
                    approvalToken: this._options.inputReader.readOptionalApprovalToken(item.input),
                };
            });
            if (new Set(prepared.map((entry) => entry.pluginId)).size !== 1) {
                throw new Error('cocos_mcp_batch_mixed_provider');
            }
            this._assertResourceOrder(prepared.map(({ item, resources }) => ({ item, resources })));
            if (!directWriteEnabled) {
                const approved = prepared.every((entry) => entry.approvalToken != null)
                    && this._approvals.tryConsumeAll(prepared.map((entry) => ({
                        token: entry.approvalToken as string,
                        request: {
                            connectionId,
                            operation: entry.item.operation,
                            resources: entry.resources,
                            risk: entry.definition.risk,
                        },
                    })));
                if (!approved) {
                    throw new Error('cocos_mcp_batch_approval_required');
                }
            }
            const pluginId = prepared[0]?.pluginId;
            if (pluginId == null) {
                throw new Error('cocos_mcp_batch_empty');
            }
            const taskRequests: Omit<ITaskRequest, 'pluginId'>[] = prepared.map(({ item, definition }) => ({
                requestId: `${request.requestId}:${item.itemId}`,
                scope: 'project',
                priority: 'normal',
                kind: 'editor-mcp.resource-operation',
                payload: {
                    operation: definition.throughput?.operationId,
                    input: this._stripControlInput(item.input),
                },
                mergePolicy: 'batch_commit',
                ...(item.idempotencyKey == null ? {} : { idempotencyKey: item.idempotencyKey }),
            }));
            return await this._enqueue(request, items, prepared, pluginId, taskRequests, connectionId);
        } finally {
            admission.release();
        }
    }

    public async getStatus(batchIdValue: unknown, connectionId: string): Promise<unknown | null> {
        return this._batches.getStatus(this._readBatchId(batchIdValue), connectionId, this._pluginManager().getMcpTaskControl());
    }

    public async cancel(batchIdValue: unknown, connectionId: string): Promise<unknown | null> {
        return this._batches.cancel(this._readBatchId(batchIdValue), connectionId, this._pluginManager().getMcpTaskControl());
    }

    public handleTaskTerminal(taskId: string): void {
        const batchId = this._batchByTaskId.get(taskId);
        if (batchId == null) {
            return;
        }
        this._batchByTaskId.delete(taskId);
        const batch = this._pendingWriters.get(batchId);
        batch?.remainingTaskIds.delete(taskId);
        if (batch != null && batch.remainingTaskIds.size === 0) {
            this._pendingWriters.delete(batchId);
            this._options.revision.finishWrite();
            batch.barrierLease.release();
            this._options.admission.getMetricsRecorder().recordBatchCompleted();
        }
    }

    public dispose(): void {
        for (const pending of this._pendingWriters.values()) {
            pending.barrierLease.release();
        }
        this._pendingWriters.clear();
        this._batchByTaskId.clear();
    }

    private async _enqueue(
        request: IThroughputBatchRequest,
        items: readonly IThroughputBatchItemRequest[],
        prepared: readonly { readonly item: IThroughputBatchItemRequest; readonly pluginId: string }[],
        pluginId: string,
        taskRequests: readonly Omit<ITaskRequest, 'pluginId'>[],
        connectionId: string,
    ): Promise<unknown> {
        const barrierLease = this._options.writerBarrier.admitWriter();
        this._options.revision.beginWrite();
        this._options.ensureTaskSubscription();
        try {
            const runtimeReceipt = await this._pluginManager().enqueueMcpHostBatch(
                pluginId,
                taskRequests,
                prepared.map(({ item }) => ({ connectionId, capability: item.operation })),
            );
            const taskControl = this._pluginManager().getMcpTaskControl();
            runtimeReceipt.receipts.forEach((receipt, index) => {
                const capability = prepared[index]?.item.operation;
                if (capability == null) {
                    throw new Error('cocos_mcp_batch_receipt_mapping_invalid');
                }
                taskControl.attachCapability(receipt.taskId, capability, connectionId);
                this._batchByTaskId.set(receipt.taskId, runtimeReceipt.batchId);
            });
            this._pendingWriters.set(runtimeReceipt.batchId, {
                remainingTaskIds: new Set(runtimeReceipt.receipts.map((receipt) => receipt.taskId)),
                barrierLease,
            });
            this._options.admission.getMetricsRecorder().recordBatchAccepted();
            return this._batches.register(connectionId, { ...request, items }, runtimeReceipt);
        } catch (error) {
            this._options.revision.finishWrite();
            barrierLease.release();
            this._options.admission.getMetricsRecorder().recordBatchFailed();
            throw error;
        }
    }

    private _orderAndValidate(request: IThroughputBatchRequest): readonly IThroughputBatchItemRequest[] {
        const byId = new Map(request.items.map((item) => [item.itemId, item]));
        const idempotencyKeys = new Set<string>();
        for (const item of request.items) {
            if (item.idempotencyKey != null && !idempotencyKeys.add(item.idempotencyKey)) {
                throw new Error('cocos_mcp_batch_idempotency_duplicate');
            }
        }
        const ordered: IThroughputBatchItemRequest[] = [];
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (item: IThroughputBatchItemRequest): void => {
            if (visiting.has(item.itemId)) {
                throw new Error('cocos_mcp_batch_dependency_cycle');
            }
            if (visited.has(item.itemId)) {
                return;
            }
            visiting.add(item.itemId);
            for (const dependencyId of item.dependsOn ?? []) {
                const dependency = byId.get(dependencyId);
                if (dependency == null) {
                    throw new Error('cocos_mcp_batch_dependency_invalid');
                }
                visit(dependency);
            }
            visiting.delete(item.itemId);
            visited.add(item.itemId);
            ordered.push(item);
        };
        request.items.forEach(visit);
        return ordered;
    }

    private _assertResourceOrder(
        entries: readonly { readonly item: IThroughputBatchItemRequest; readonly resources: readonly string[] }[],
    ): void {
        const byId = new Map(entries.map((entry) => [entry.item.itemId, entry.item]));
        const dependsOn = (item: IThroughputBatchItemRequest, dependencyId: string): boolean => {
            const pending = [...(item.dependsOn ?? [])];
            const visited = new Set<string>();
            while (pending.length > 0) {
                const current = pending.pop();
                if (current == null || visited.has(current)) {
                    continue;
                }
                if (current === dependencyId) {
                    return true;
                }
                visited.add(current);
                pending.push(...(byId.get(current)?.dependsOn ?? []));
            }
            return false;
        };
        const ownerByResource = new Map<string, IThroughputBatchItemRequest>();
        for (const entry of entries) {
            for (const resource of entry.resources) {
                const previous = ownerByResource.get(resource);
                if (previous != null && !dependsOn(entry.item, previous.itemId)) {
                    throw new Error(`cocos_mcp_batch_resource_conflict:${entry.item.itemId}`);
                }
                ownerByResource.set(resource, entry.item);
            }
        }
    }

    private _stripControlInput(input: Record<string, unknown>): Record<string, unknown> {
        const result = { ...input };
        delete result.approvalId;
        delete result.approvalToken;
        delete result.resources;
        delete result.confirmDestructive;
        return result;
    }

    private _readBatchId(value: unknown): string {
        if (typeof value !== 'string' || !value.startsWith('batch:') || value.length > 160) {
            throw new Error('cocos_mcp_batch_id_invalid');
        }
        return value;
    }

    private _mirrorApproval(
        connectionId: string,
        resources: readonly string[],
        operations: readonly string[] | undefined,
        maxRisk: 'write' | 'destructive',
        token: string,
        idleLeaseMs: number,
        maxHoldMs: number,
        sessionBound: boolean,
    ): string | null {
        if (this._approvalMirror == null) {
            return null;
        }
        try {
            const issued = this._approvalMirror({
                connectionId, resources, operations, maxRisk, preferredToken: token,
                idleLeaseMs, maxHoldMs,
                ...(sessionBound && idleLeaseMs == null && maxHoldMs == null ? { sessionBound: true } : {}),
            });
            return issued != null && typeof issued.token === 'string' && issued.token.length > 0 ? issued.token : null;
        } catch {
            return null;
        }
    }

    private _pluginManager(): PluginManagerApp {
        const pluginManager = this._options.pluginManagerProvider();
        if (pluginManager == null) {
            throw new Error('cocos_mcp_plugin_manager_unavailable');
        }
        return pluginManager;
    }
}
