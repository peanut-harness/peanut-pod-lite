import type {
    ITaskCancelResult,
    ITaskEvidenceEntry,
    ITaskEvidenceIndex,
    ITaskFailureSummary,
    ITaskOwner,
    ITaskResult,
    ITaskSnapshot,
    ITaskStatusSummary,
    ITaskTrace,
    TaskStatus,
    TaskTraceStatus,
} from '@peanut/pod-protocol';

import { TaskLedger } from '../ledger/task-ledger.js';
import { TimeoutAndCancelController } from '../timeout/timeout-and-cancel-controller.js';
import { TracePipeline } from '../trace/trace-pipeline.js';

/**
 * @description 控制面保留与时间来源配置。
 */
export interface ITaskControlPlaneOptions {
    /**
     * @description 终态任务与幂等索引的保留时长。
     */
    readonly retentionMs?: number;
    /**
     * @description 测试可替换的时间来源。
     */
    readonly now?: () => number;
}

/**
 * @description 幂等受理结果。
 */
export interface ITaskIdempotencyClaim {
    /**
     * @description 是否命中既有任务。
     */
    readonly reused: boolean;
    /**
     * @description 新建或既有任务标识。
     */
    readonly taskId: string;
}

interface ITaskIdempotencyRecord {
    /**
     * @description 规范化工作摘要。
     */
    readonly digest: string;
    /**
     * @description 关联任务标识。
     */
    readonly taskId: string;
    /**
     * @description 索引失效时间。
     */
    retainedUntil: number;
}

/**
 * @description 实例级共享任务控制面，统一任务状态、owner、取消、超时、幂等、trace、证据与保留策略。
 */
export class TaskControlPlane {
    /**
     * @description 默认终态记录保留时长。
     */
    private static readonly DEFAULT_RETENTION_MS = 5 * 60 * 1000;

    /**
     * @description 任务账本。
     */
    private readonly _ledger: TaskLedger;
    /**
     * @description 超时与取消控制器。
     */
    private readonly _timeoutAndCancelController: TimeoutAndCancelController;
    /**
     * @description Trace 管线。
     */
    private readonly _tracePipeline: TracePipeline;
    /**
     * @description 任务 owner 索引。
     */
    private readonly _owners = new Map<string, ITaskOwner>();
    /**
     * @description 任务证据索引。
     */
    private readonly _evidence = new Map<string, ITaskEvidenceEntry[]>();
    /**
     * @description 终态任务保留截止时间。
     */
    private readonly _retainedUntil = new Map<string, number>();
    /**
     * @description 受 owner 限定的幂等索引。
     */
    private readonly _idempotency = new Map<string, ITaskIdempotencyRecord>();
    /**
     * @description 终态记录保留时长。
     */
    private readonly _retentionMs: number;
    /**
     * @description 当前时间来源。
     */
    private readonly _now: () => number;

    /**
     * @description 创建共享任务控制面。
     * @param ledger 任务账本。
     * @param timeoutAndCancelController 超时与取消控制器。
     * @param tracePipeline Trace 管线。
     * @param options 保留与时间配置。
     */
    public constructor(
        ledger: TaskLedger,
        timeoutAndCancelController: TimeoutAndCancelController,
        tracePipeline: TracePipeline,
        options: ITaskControlPlaneOptions = {},
    ) {
        this._ledger = ledger;
        this._timeoutAndCancelController = timeoutAndCancelController;
        this._tracePipeline = tracePipeline;
        this._retentionMs = options.retentionMs ?? TaskControlPlane.DEFAULT_RETENTION_MS;
        this._now = options.now ?? Date.now;
    }

    /**
     * @description 注册任务控制状态并可选绑定宿主生成的 owner。
     */
    public register(taskId: string, timeoutMs?: number, owner?: ITaskOwner): void {
        this._timeoutAndCancelController.register(taskId, timeoutMs);
        if (owner != null) {
            this.bindOwner(taskId, owner);
        }
    }

    /**
     * @description 首次绑定任务 owner；后续绑定必须完全一致。
     */
    public bindOwner(taskId: string, owner: ITaskOwner): ITaskOwner {
        const current = this._owners.get(taskId);
        if (current != null && this._ownerKey(current) !== this._ownerKey(owner)) {
            throw new Error('task_owner_immutable');
        }
        if (current == null) {
            this._owners.set(taskId, { ...owner });
        }
        return this._owners.get(taskId) as ITaskOwner;
    }

    /**
     * @description 返回任务 owner；未绑定时返回 null。
     */
    public getOwner(taskId: string): ITaskOwner | null {
        return this._owners.get(taskId) ?? null;
    }

    /**
     * @description 更新任务状态。
     */
    public updateStatus(taskId: string, status: TaskStatus): ITaskSnapshot | null {
        return this._ledger.updateStatus(taskId, status);
    }

    /**
     * @description 查询任务快照。
     */
    public query(taskId: string): ITaskSnapshot | null {
        return this._ledger.query(taskId);
    }

    /**
     * @description 保存任务终态结果并建立保留期限。
     */
    public setResult(result: ITaskResult): ITaskResult {
        const savedResult = this._ledger.setResult(result);
        this._retainedUntil.set(result.taskId, this._now() + this._retentionMs);
        return savedResult;
    }

    /**
     * @description 查询任务终态结果。
     */
    public getResult(taskId: string): ITaskResult | null {
        return this._ledger.getResult(taskId);
    }

    /**
     * @description 请求取消任务并遵守终态与 commit 窗口边界。
     */
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
        this._retainedUntil.set(taskId, this._now() + this._retentionMs);
        return { taskId, cancelled: true };
    }

    /**
     * @description 仅允许完全匹配的 owner 取消任务；不存在与非 owner 返回同一结果。
     */
    public cancelOwned(taskId: string, owner: ITaskOwner): ITaskCancelResult {
        if (!this._isOwner(taskId, owner)) {
            return { taskId, cancelled: false, reason: 'task_unavailable' };
        }
        return this.cancel(taskId);
    }

    /**
     * @description 标记任务进入不可逆 commit 窗口。
     */
    public enterCommitWindow(taskId: string): boolean {
        return this._timeoutAndCancelController.enterCommitWindow(taskId);
    }

    /**
     * @description 结束任务的超时与取消控制状态。
     */
    public finalize(taskId: string): boolean {
        return this._timeoutAndCancelController.finalize(taskId);
    }

    /**
     * @description 返回任务是否已取消。
     */
    public isCancelled(taskId: string): boolean {
        return this._timeoutAndCancelController.isCancelled(taskId);
    }

    /**
     * @description 返回任务是否已超时。
     */
    public isTimedOut(taskId: string): boolean {
        return this._timeoutAndCancelController.isTimedOut(taskId);
    }

    /**
     * @description 创建任务 trace。
     */
    public createTrace(taskId: string, kind: string): ITaskTrace {
        return this._tracePipeline.create(taskId, kind);
    }

    /**
     * @description 追加任务 trace 步骤。
     */
    public appendTrace(
        trace: ITaskTrace,
        id: string,
        title: string,
        status: TaskTraceStatus,
        detail?: string,
    ): ITaskTrace {
        return this._tracePipeline.append(trace, id, title, status, detail);
    }

    /**
     * @description 结束任务 trace。
     */
    public finishTrace(trace: ITaskTrace): ITaskTrace {
        return this._tracePipeline.finish(trace);
    }

    /**
     * @description 按 owner、工程、capability 和幂等键声明工作摘要。
     */
    public claimIdempotency(
        owner: ITaskOwner,
        idempotencyKey: string,
        digest: string,
        taskId: string,
    ): ITaskIdempotencyClaim {
        this.purgeExpired();
        const key = `${this._ownerKey(owner)}:${idempotencyKey}`;
        const current = this._idempotency.get(key);
        if (current != null) {
            if (current.digest !== digest) {
                throw new Error('task_idempotency_conflict');
            }
            return { reused: true, taskId: current.taskId };
        }
        this._idempotency.set(key, {
            digest,
            taskId,
            retainedUntil: this._now() + this._retentionMs,
        });
        return { reused: false, taskId };
    }

    /**
     * @description 追加经过 allow-list 筛选的结构化任务证据。
     */
    public recordEvidence(taskId: string, evidence: ITaskEvidenceEntry): void {
        const entries = this._evidence.get(taskId) ?? [];
        entries.push({
            id: evidence.id,
            kind: evidence.kind,
            status: evidence.status,
            summary: evidence.summary,
            recordedAt: evidence.recordedAt,
            ...(evidence.digest == null ? {} : { digest: evidence.digest }),
        });
        this._evidence.set(taskId, entries);
    }

    /**
     * @description 仅向匹配 owner 返回任务安全状态摘要。
     */
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
            taskId,
            pluginId: snapshot.pluginId,
            capability: owner.capability,
            status: snapshot.status,
            createdAt: snapshot.createdAt,
            updatedAt: snapshot.updatedAt,
            failure: result?.error == null ? undefined : this._toFailureSummary(result),
        };
    }

    /**
     * @description 仅向匹配 owner 返回安全证据索引。
     */
    public getEvidence(taskId: string, owner: ITaskOwner): ITaskEvidenceIndex | null {
        if (!this._isOwner(taskId, owner)) {
            return null;
        }
        const retainedUntil = this._retainedUntil.get(taskId) ?? this._now() + this._retentionMs;
        return {
            taskId,
            entries: [...(this._evidence.get(taskId) ?? [])],
            retainedUntil: new Date(retainedUntil).toISOString(),
        };
    }

    /**
     * @description 回收超过保留期的终态记录与关联索引。
     */
    public purgeExpired(): readonly string[] {
        const now = this._now();
        const removedTaskIds: string[] = [];
        for (const [taskId, retainedUntil] of this._retainedUntil) {
            if (retainedUntil > now) {
                continue;
            }
            this._retainedUntil.delete(taskId);
            this._owners.delete(taskId);
            this._evidence.delete(taskId);
            this._ledger.delete(taskId);
            removedTaskIds.push(taskId);
        }
        for (const [key, record] of this._idempotency) {
            if (record.retainedUntil <= now || removedTaskIds.includes(record.taskId)) {
                this._idempotency.delete(key);
            }
        }
        return removedTaskIds;
    }

    /**
     * @description 比较任务 owner 是否与查询 owner 完全一致。
     */
    private _isOwner(taskId: string, owner: ITaskOwner): boolean {
        const current = this._owners.get(taskId);
        return current != null && this._ownerKey(current) === this._ownerKey(owner);
    }

    /**
     * @description 生成不包含 token 的 owner 作用域键。
     */
    private _ownerKey(owner: ITaskOwner): string {
        return [owner.pluginId, owner.connectionId, owner.projectKey, owner.capability].join('\u0000');
    }

    /**
     * @description 将现有插件错误投影为安全失败摘要。
     */
    private _toFailureSummary(result: ITaskResult): ITaskFailureSummary {
        const error = result.error;
        return {
            code: error?.code ?? 'task_failed',
            category: 'execution_failed',
            reason: error?.message ?? 'Task failed.',
            retryable: error?.recoverable ?? false,
            projectState: 'unknown',
            recommendedAction: error?.recoverable === true ? 'retry_same_request' : 'stop',
        };
    }
}
