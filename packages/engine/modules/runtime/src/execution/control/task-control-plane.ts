import type {
    ITaskCancelResult, ITaskEvidenceEntry, ITaskEvidenceIndex, ITaskFailureSummary, ITaskOwner,
    ITaskResult, ITaskSnapshot, ITaskStatusSummary, ITaskTrace, TaskStatus, TaskTraceStatus,
} from '@peanut/pod-protocol';

import { TaskLedger } from '../ledger/task-ledger.js';
import { TimeoutAndCancelController } from '../timeout/timeout-and-cancel-controller.js';
import { TracePipeline } from '../trace/trace-pipeline.js';

/** @description 证据容量采用单任务或批次边界。 */
export type TaskEvidenceScope = 'task' | 'batch';

/** @description 任务进入终态时发布的生命周期事件。 */
export interface ITaskTerminalEvent {
    readonly taskId: string;
    readonly owner: ITaskOwner | null;
    readonly retainedUntil: string;
}

/** @description 任务及其关联索引完成回收时发布的生命周期事件。 */
export interface ITaskReclaimedEvent {
    readonly taskId: string;
    readonly owner: ITaskOwner | null;
    readonly reason: 'expired';
}

/** @description 控制面保留与时间来源配置。 */
export interface ITaskControlPlaneOptions {
    readonly retentionMs?: number;
    readonly gcIntervalMs?: number;
    readonly maxRetainedTasksPerProject?: number;
    readonly maxTaskEvidenceEntries?: number;
    readonly maxTaskEvidenceBytes?: number;
    readonly maxBatchEvidenceEntries?: number;
    readonly maxBatchEvidenceBytes?: number;
    readonly now?: () => number;
    readonly setInterval?: (callback: () => void, intervalMs: number) => unknown;
    readonly clearInterval?: (handle: unknown) => void;
}

/** @description 幂等受理结果。 */
export interface ITaskIdempotencyClaim {
    readonly reused: boolean;
    readonly taskId: string;
}

interface ITaskIdempotencyRecord {
    readonly digest: string;
    readonly taskId: string;
    retainedUntil: number | null;
}

interface ITaskEvidenceState {
    readonly entries: ITaskEvidenceEntry[];
    readonly scope: TaskEvidenceScope;
    bytes: number;
    droppedCount: number;
    truncationRecordedAt: string | null;
}

interface IEvidenceLimit {
    readonly maxEntries: number;
    readonly maxBytes: number;
}

/** @description 实例级共享任务控制面，统一任务状态、owner、取消、超时、幂等、trace、证据与保留策略。 */
export class TaskControlPlane {
    private static readonly DEFAULT_RETENTION_MS = 5 * 60 * 1000;
    private static readonly DEFAULT_GC_INTERVAL_MS = 30 * 1000;
    private static readonly DEFAULT_MAX_RETAINED_TASKS_PER_PROJECT = 4096;
    private static readonly DEFAULT_MAX_TASK_EVIDENCE_ENTRIES = 32;
    private static readonly DEFAULT_MAX_TASK_EVIDENCE_BYTES = 64 * 1024;
    private static readonly DEFAULT_MAX_BATCH_EVIDENCE_ENTRIES = 128;
    private static readonly DEFAULT_MAX_BATCH_EVIDENCE_BYTES = 256 * 1024;

    private readonly _ledger: TaskLedger;
    private readonly _timeoutAndCancelController: TimeoutAndCancelController;
    private readonly _tracePipeline: TracePipeline;
    private readonly _owners = new Map<string, ITaskOwner>();
    private readonly _evidence = new Map<string, ITaskEvidenceState>();
    private readonly _retainedUntil = new Map<string, number>();
    private readonly _idempotency = new Map<string, ITaskIdempotencyRecord>();
    private readonly _projectTaskCounts = new Map<string, number>();
    private readonly _terminalTaskIds = new Set<string>();
    private readonly _terminalListeners = new Set<(event: ITaskTerminalEvent) => void>();
    private readonly _reclaimedListeners = new Set<(event: ITaskReclaimedEvent) => void>();
    private readonly _retentionMs: number;
    private readonly _maxRetainedTasksPerProject: number;
    private readonly _taskEvidenceLimit: IEvidenceLimit;
    private readonly _batchEvidenceLimit: IEvidenceLimit;
    private readonly _now: () => number;
    private readonly _clearInterval: (handle: unknown) => void;
    private _gcHandle: unknown | null;
    private _disposed = false;

    public constructor(
        ledger: TaskLedger,
        timeoutAndCancelController: TimeoutAndCancelController,
        tracePipeline: TracePipeline,
        options: ITaskControlPlaneOptions = {},
    ) {
        this._ledger = ledger;
        this._timeoutAndCancelController = timeoutAndCancelController;
        this._tracePipeline = tracePipeline;
        this._retentionMs = this._nonNegativeInteger(options.retentionMs ?? TaskControlPlane.DEFAULT_RETENTION_MS, 'task_retention_invalid');
        const gcIntervalMs = this._positiveInteger(options.gcIntervalMs ?? TaskControlPlane.DEFAULT_GC_INTERVAL_MS, 'task_gc_interval_invalid');
        this._maxRetainedTasksPerProject = this._positiveInteger(
            options.maxRetainedTasksPerProject ?? TaskControlPlane.DEFAULT_MAX_RETAINED_TASKS_PER_PROJECT,
            'task_retention_capacity_invalid',
        );
        this._taskEvidenceLimit = {
            maxEntries: this._positiveInteger(options.maxTaskEvidenceEntries ?? TaskControlPlane.DEFAULT_MAX_TASK_EVIDENCE_ENTRIES, 'task_evidence_entry_limit_invalid'),
            maxBytes: this._evidenceByteLimit(options.maxTaskEvidenceBytes ?? TaskControlPlane.DEFAULT_MAX_TASK_EVIDENCE_BYTES),
        };
        this._batchEvidenceLimit = {
            maxEntries: this._positiveInteger(options.maxBatchEvidenceEntries ?? TaskControlPlane.DEFAULT_MAX_BATCH_EVIDENCE_ENTRIES, 'batch_evidence_entry_limit_invalid'),
            maxBytes: this._evidenceByteLimit(options.maxBatchEvidenceBytes ?? TaskControlPlane.DEFAULT_MAX_BATCH_EVIDENCE_BYTES),
        };
        this._now = options.now ?? Date.now;
        const registerInterval = options.setInterval ?? ((callback: () => void, intervalMs: number): unknown => setInterval(callback, intervalMs));
        this._clearInterval = options.clearInterval ?? ((handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>));
        this._gcHandle = registerInterval(() => this.purgeExpired(), gcIntervalMs);
        const intervalHandle = this._gcHandle as { unref?: () => void } | null;
        intervalHandle?.unref?.();
    }

    /** @description 注册任务控制状态并可选绑定宿主生成的 owner。 */
    public register(taskId: string, timeoutMs?: number, owner?: ITaskOwner): void {
        this._assertActive();
        if (owner != null && !this.hasRetentionCapacity(owner.projectKey) && !this._owners.has(taskId)) {
            throw new Error('task_retention_capacity_exceeded');
        }
        this._timeoutAndCancelController.register(taskId, timeoutMs);
        if (owner != null) {
            this.bindOwner(taskId, owner);
        }
        this._setIdempotencyRetention(taskId, null);
    }

    /** @description 首次绑定任务 owner；后续绑定必须完全一致。 */
    public bindOwner(taskId: string, owner: ITaskOwner): ITaskOwner {
        this._assertActive();
        const current = this._owners.get(taskId);
        if (current != null && this._ownerKey(current) !== this._ownerKey(owner)) {
            throw new Error('task_owner_immutable');
        }
        if (current == null) {
            if (!this.hasRetentionCapacity(owner.projectKey)) {
                throw new Error('task_retention_capacity_exceeded');
            }
            this._owners.set(taskId, { ...owner });
            this._projectTaskCounts.set(owner.projectKey, (this._projectTaskCounts.get(owner.projectKey) ?? 0) + 1);
        }
        return this._owners.get(taskId) as ITaskOwner;
    }

    /** @description 返回工程是否仍有任务生命周期槽位。 */
    public hasRetentionCapacity(projectKey: string): boolean {
        this.purgeExpired();
        return (this._projectTaskCounts.get(projectKey) ?? 0) < this._maxRetainedTasksPerProject;
    }

    public getOwner(taskId: string): ITaskOwner | null {
        return this._owners.get(taskId) ?? null;
    }

    /** @description 订阅任务首次进入终态的事件。 */
    public onTerminal(listener: (event: ITaskTerminalEvent) => void): () => void {
        this._assertActive();
        this._terminalListeners.add(listener);
        return () => this._terminalListeners.delete(listener);
    }

    /** @description 订阅任务及关联索引完成回收的事件。 */
    public onReclaimed(listener: (event: ITaskReclaimedEvent) => void): () => void {
        this._assertActive();
        this._reclaimedListeners.add(listener);
        return () => this._reclaimedListeners.delete(listener);
    }

    public updateStatus(taskId: string, status: TaskStatus): ITaskSnapshot | null {
        return this._ledger.updateStatus(taskId, status);
    }

    public query(taskId: string): ITaskSnapshot | null {
        return this._ledger.query(taskId);
    }

    /** @description 保存任务终态结果并建立保留期限。 */
    public setResult(result: ITaskResult): ITaskResult {
        const savedResult = this._ledger.setResult(result);
        this._markTerminal(result.taskId);
        return savedResult;
    }

    public getResult(taskId: string): ITaskResult | null {
        return this._ledger.getResult(taskId);
    }

    /** @description 请求取消任务并遵守终态与 commit 窗口边界。 */
    public cancel(taskId: string): ITaskCancelResult {
        const snapshot = this._ledger.query(taskId);
        if (snapshot == null) {
            return { taskId, cancelled: false, reason: 'task_not_found' };
        }
        if (snapshot.status === 'succeeded' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
            return { taskId, cancelled: false, reason: `task_already_${snapshot.status}` };
        }
        const cancelResult = this._timeoutAndCancelController.cancel(taskId);
        if (!cancelResult.cancelled) {
            return { taskId, cancelled: false, reason: cancelResult.reason };
        }
        this._ledger.updateStatus(taskId, 'cancelled');
        this._timeoutAndCancelController.finalize(taskId);
        this._markTerminal(taskId);
        return { taskId, cancelled: true };
    }

    public cancelOwned(taskId: string, owner: ITaskOwner): ITaskCancelResult {
        if (!this._isOwner(taskId, owner)) {
            return { taskId, cancelled: false, reason: 'task_unavailable' };
        }
        return this.cancel(taskId);
    }

    public enterCommitWindow(taskId: string): boolean {
        return this._timeoutAndCancelController.enterCommitWindow(taskId);
    }

    public finalize(taskId: string): boolean {
        return this._timeoutAndCancelController.finalize(taskId);
    }

    public isCancelled(taskId: string): boolean {
        return this._timeoutAndCancelController.isCancelled(taskId);
    }

    public isTimedOut(taskId: string): boolean {
        return this._timeoutAndCancelController.isTimedOut(taskId);
    }

    public createTrace(taskId: string, kind: string): ITaskTrace {
        return this._tracePipeline.create(taskId, kind);
    }

    public appendTrace(trace: ITaskTrace, id: string, title: string, status: TaskTraceStatus, detail?: string): ITaskTrace {
        return this._tracePipeline.append(trace, id, title, status, detail);
    }

    public finishTrace(trace: ITaskTrace): ITaskTrace {
        return this._tracePipeline.finish(trace);
    }

    /** @description 按 owner、工程、capability 和幂等键声明工作摘要。 */
    public claimIdempotency(owner: ITaskOwner, idempotencyKey: string, digest: string, taskId: string): ITaskIdempotencyClaim {
        this._assertActive();
        this.purgeExpired();
        const key = `${this._ownerKey(owner)}:${idempotencyKey}`;
        const current = this._idempotency.get(key);
        if (current != null) {
            if (current.digest !== digest) {
                throw new Error('task_idempotency_conflict');
            }
            return { reused: true, taskId: current.taskId };
        }
        this._idempotency.set(key, { digest, taskId, retainedUntil: this._now() + this._retentionMs });
        return { reused: false, taskId };
    }

    /** @description 追加经过 allow-list 筛选且受容量约束的结构化证据。 */
    public recordEvidence(taskId: string, evidence: ITaskEvidenceEntry, scope: TaskEvidenceScope = 'task'): void {
        this._assertActive();
        const existing = this._evidence.get(taskId);
        if (existing != null && existing.scope !== scope) {
            throw new Error('task_evidence_scope_immutable');
        }
        const state = existing ?? { entries: [], scope, bytes: 0, droppedCount: 0, truncationRecordedAt: null };
        const normalized = this._copyEvidence(evidence);
        const limit = scope === 'batch' ? this._batchEvidenceLimit : this._taskEvidenceLimit;
        if (
            state.droppedCount === 0
            && state.entries.length + 1 <= limit.maxEntries
            && this._evidenceEntriesBytes([...state.entries, normalized]) <= limit.maxBytes
        ) {
            state.entries.push(normalized);
            state.bytes = this._evidenceEntriesBytes(state.entries);
            this._evidence.set(taskId, state);
            return;
        }
        state.droppedCount += 1;
        state.truncationRecordedAt ??= new Date(this._now()).toISOString();
        this._replaceTruncationSummary(state, limit);
        this._evidence.set(taskId, state);
    }

    public getStatusSummary(taskId: string, owner: ITaskOwner): ITaskStatusSummary | null {
        if (!this._isOwner(taskId, owner)) {
            return null;
        }
        const snapshot = this._ledger.query(taskId);
        if (snapshot == null) {
            return null;
        }
        const result = this._ledger.getResult(taskId);
        return {
            taskId, pluginId: snapshot.pluginId, capability: owner.capability, status: snapshot.status,
            createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt,
            failure: result?.error == null ? undefined : this._toFailureSummary(result),
        };
    }

    public getEvidence(taskId: string, owner: ITaskOwner): ITaskEvidenceIndex | null {
        if (!this._isOwner(taskId, owner)) {
            return null;
        }
        const retainedUntil = this._retainedUntil.get(taskId) ?? this._now() + this._retentionMs;
        return { taskId, entries: [...(this._evidence.get(taskId)?.entries ?? [])], retainedUntil: new Date(retainedUntil).toISOString() };
    }

    /** @description 回收超过保留期的终态记录与全部关联索引。 */
    public purgeExpired(): readonly string[] {
        if (this._disposed) {
            return [];
        }
        const now = this._now();
        const removedTaskIds: string[] = [];
        for (const [taskId, retainedUntil] of this._retainedUntil) {
            if (retainedUntil > now) {
                continue;
            }
            const owner = this._owners.get(taskId) ?? null;
            this._retainedUntil.delete(taskId);
            this._terminalTaskIds.delete(taskId);
            this._removeOwner(taskId, owner);
            this._evidence.delete(taskId);
            this._ledger.delete(taskId);
            this._timeoutAndCancelController.delete(taskId);
            removedTaskIds.push(taskId);
            this._emitReclaimed({ taskId, owner, reason: 'expired' });
        }
        const removed = new Set(removedTaskIds);
        for (const [key, record] of this._idempotency) {
            if ((record.retainedUntil != null && record.retainedUntil <= now) || removed.has(record.taskId)) {
                this._idempotency.delete(key);
            }
        }
        return removedTaskIds;
    }

    /** @description 取消周期 GC；可重复调用。 */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._gcHandle != null) {
            this._clearInterval(this._gcHandle);
            this._gcHandle = null;
        }
        this._terminalListeners.clear();
        this._reclaimedListeners.clear();
    }

    private _markTerminal(taskId: string): void {
        if (this._terminalTaskIds.has(taskId)) {
            return;
        }
        const retainedUntil = this._now() + this._retentionMs;
        this._terminalTaskIds.add(taskId);
        this._retainedUntil.set(taskId, retainedUntil);
        this._setIdempotencyRetention(taskId, retainedUntil);
        this._emitTerminal({ taskId, owner: this._owners.get(taskId) ?? null, retainedUntil: new Date(retainedUntil).toISOString() });
    }

    private _setIdempotencyRetention(taskId: string, retainedUntil: number | null): void {
        for (const record of this._idempotency.values()) {
            if (record.taskId === taskId) {
                record.retainedUntil = retainedUntil;
            }
        }
    }

    private _replaceTruncationSummary(state: ITaskEvidenceState, limit: IEvidenceLimit): void {
        const previousSummary = state.entries[state.entries.length - 1]?.id === 'evidence-truncated' ? state.entries.pop() : null;
        void previousSummary;
        let summary = this._truncationSummary(state);
        while (
            state.entries.length + 1 > limit.maxEntries
            || this._evidenceEntriesBytes([...state.entries, summary]) > limit.maxBytes
        ) {
            const removed = state.entries.pop();
            if (removed == null) {
                break;
            }
            state.droppedCount += 1;
            summary = this._truncationSummary(state);
        }
        state.entries.push(summary);
        state.bytes = this._evidenceEntriesBytes(state.entries);
    }

    private _truncationSummary(state: ITaskEvidenceState): ITaskEvidenceEntry {
        return {
            id: 'evidence-truncated', kind: 'artifact', status: 'skipped',
            summary: `Evidence truncated; dropped ${state.droppedCount} entries.`,
            digest: `dropped:${state.droppedCount}`,
            recordedAt: state.truncationRecordedAt ?? new Date(this._now()).toISOString(),
        };
    }

    private _copyEvidence(evidence: ITaskEvidenceEntry): ITaskEvidenceEntry {
        return {
            id: evidence.id, kind: evidence.kind, status: evidence.status, summary: evidence.summary,
            recordedAt: evidence.recordedAt, ...(evidence.digest == null ? {} : { digest: evidence.digest }),
        };
    }

    private _evidenceEntriesBytes(entries: readonly ITaskEvidenceEntry[]): number {
        return Buffer.byteLength(JSON.stringify(entries), 'utf8');
    }

    private _removeOwner(taskId: string, owner: ITaskOwner | null): void {
        this._owners.delete(taskId);
        if (owner == null) {
            return;
        }
        const next = (this._projectTaskCounts.get(owner.projectKey) ?? 1) - 1;
        if (next <= 0) {
            this._projectTaskCounts.delete(owner.projectKey);
        } else {
            this._projectTaskCounts.set(owner.projectKey, next);
        }
    }

    private _emitTerminal(event: ITaskTerminalEvent): void {
        for (const listener of this._terminalListeners) {
            try {
                listener(event);
            } catch {
                // 生命周期观察者不得反向破坏已经完成的任务终态。
            }
        }
    }

    private _emitReclaimed(event: ITaskReclaimedEvent): void {
        for (const listener of this._reclaimedListeners) {
            try {
                listener(event);
            } catch {
                // 一个外层索引的清理失败不得阻止其它订阅者收到回收事件。
            }
        }
    }

    private _isOwner(taskId: string, owner: ITaskOwner): boolean {
        const current = this._owners.get(taskId);
        return current != null && this._ownerKey(current) === this._ownerKey(owner);
    }

    private _ownerKey(owner: ITaskOwner): string {
        return [owner.pluginId, owner.connectionId, owner.projectKey, owner.capability].join('\u0000');
    }

    private _positiveInteger(value: number, errorCode: string): number {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(errorCode);
        }
        return value;
    }

    private _nonNegativeInteger(value: number, errorCode: string): number {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(errorCode);
        }
        return value;
    }

    private _evidenceByteLimit(value: number): number {
        if (!Number.isSafeInteger(value) || value < 256) {
            throw new Error('task_evidence_byte_limit_invalid');
        }
        return value;
    }

    private _assertActive(): void {
        if (this._disposed) {
            throw new Error('task_control_plane_disposed');
        }
    }

    private _toFailureSummary(result: ITaskResult): ITaskFailureSummary {
        const error = result.error;
        const resultData = result.data != null && typeof result.data === 'object'
            ? result.data as Record<string, unknown>
            : null;
        const declaredProjectState = resultData?.projectState;
        const projectState = declaredProjectState === 'not_started'
            || declaredProjectState === 'unchanged'
            || declaredProjectState === 'rolled_back'
            || declaredProjectState === 'may_have_changed'
            || declaredProjectState === 'unknown'
            ? declaredProjectState
            : 'unknown';
        return {
            code: error?.code ?? 'task_failed', category: 'execution_failed', reason: error?.message ?? 'Task failed.',
            retryable: error?.recoverable ?? false, projectState,
            recommendedAction: error?.recoverable === true ? 'retry_same_request' : 'stop',
        };
    }
}
