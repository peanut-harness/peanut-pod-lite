import type { IThroughputOverloadFailure, IThroughputQueueSummary, ThroughputCostClass } from '@peanut/pod-protocol';
import { THROUGHPUT_CONTRACT_LIMITS } from '@peanut/pod-protocol';

import { ThroughputHealthMetrics } from '../metrics/throughput-health-metrics.js';
import { ThroughputOverloadError } from './throughput-overload-error.js';

export { ThroughputOverloadError } from './throughput-overload-error.js';

/** @description 单工程吞吐准入默认边界。 */
export interface IThroughputAdmissionLimits {
    readonly maxConnectionInFlight: number;
    readonly maxConnectionQueued: number;
    readonly maxProjectQueued: number;
    readonly maxControlQueued: number;
    readonly concurrency: Readonly<Record<ThroughputCostClass, number>>;
}

/** @description 单次准入请求。 */
export interface IThroughputAdmissionRequest {
    readonly connectionId: string;
    readonly projectKey: string;
    readonly costClass: ThroughputCostClass;
    readonly signal?: AbortSignal;
    readonly waitTimeoutMs?: number;
}

/** @description 成功取得的准入租约。 */
export interface IThroughputAdmissionLease {
    readonly connectionId: string;
    readonly projectKey: string;
    readonly costClass: ThroughputCostClass;
    readonly waitedMs: number;
    release(): boolean;
}

/** @description 当前调用方可见的准入快照。 */
export interface IThroughputAdmissionSnapshot extends IThroughputQueueSummary {
    readonly projectQueued: number;
    readonly classInFlight: number;
    readonly classCapacity: number;
}

/** @description 内部等待者。 */
interface IAdmissionWaiter {
    readonly sequence: number;
    readonly request: IThroughputAdmissionRequest;
    readonly enqueuedAt: number;
    readonly resolve: (lease: IThroughputAdmissionLease) => void;
    readonly reject: (error: Error) => void;
    cleanup(): void;
}

interface IConnectionState {
    inFlight: number;
    queued: number;
}

interface IProjectState {
    readonly active: Record<ThroughputCostClass, number>;
    readonly queues: Record<ThroughputCostClass, IAdmissionWaiter[]>;
    readonly lastGrantedConnection: Partial<Record<ThroughputCostClass, string>>;
}

/**
 * @description 按连接、工程和成本类别限制单工程请求，使用连接轮转避免持续洪泛造成饥饿。
 */
export class ThroughputAdmissionController {
    public static readonly DEFAULT_LIMITS: IThroughputAdmissionLimits = Object.freeze({
        maxConnectionInFlight: 8,
        maxConnectionQueued: 32,
        maxProjectQueued: 64,
        maxControlQueued: 16,
        concurrency: Object.freeze({ control: 4, read_light: 8, read_heavy: 2, prepare: 4, writer: 1 }),
    });

    private readonly _limits: IThroughputAdmissionLimits;
    private readonly _now: () => number;
    private readonly _metrics: ThroughputHealthMetrics;
    private readonly _connections = new Map<string, IConnectionState>();
    private readonly _projects = new Map<string, IProjectState>();
    private _sequence = 0;
    private _disposed = false;

    public constructor(
        limits: Partial<IThroughputAdmissionLimits> = {},
        now: () => number = Date.now,
        metrics: ThroughputHealthMetrics = new ThroughputHealthMetrics({ now }),
    ) {
        const defaults = ThroughputAdmissionController.DEFAULT_LIMITS;
        this._limits = Object.freeze({
            maxConnectionInFlight: this._positiveInteger(limits.maxConnectionInFlight ?? defaults.maxConnectionInFlight),
            maxConnectionQueued: this._positiveInteger(limits.maxConnectionQueued ?? defaults.maxConnectionQueued),
            maxProjectQueued: this._positiveInteger(limits.maxProjectQueued ?? defaults.maxProjectQueued),
            maxControlQueued: this._positiveInteger(limits.maxControlQueued ?? defaults.maxControlQueued),
            concurrency: Object.freeze({ ...defaults.concurrency, ...(limits.concurrency ?? {}) }),
        });
        for (const value of Object.values(this._limits.concurrency)) {
            this._positiveInteger(value);
        }
        this._now = now;
        this._metrics = metrics;
    }

    /** @description 取得准入租约；容量满时有界等待或返回稳定 overload。 */
    public async acquire(request: IThroughputAdmissionRequest): Promise<IThroughputAdmissionLease> {
        this._assertActive();
        this._validateRequest(request);
        const connection = this._connection(request.connectionId);
        const project = this._project(request.projectKey);
        if (this._canGrant(request, connection, project)) {
            return this._grant(request, connection, project, this._now());
        }
        if (connection.queued >= this._limits.maxConnectionQueued || this._projectQueueFull(project, request.costClass)) {
            throw this._overload(request, connection, 'admission');
        }
        connection.queued += 1;
        this._metrics.changeQueued(request.costClass, 1);
        return new Promise<IThroughputAdmissionLease>((resolve, reject) => {
            const waiter = this._createWaiter(request, resolve, reject);
            project.queues[request.costClass].push(waiter);
        });
    }

    /** @description 返回不包含其它连接身份与工作内容的准入快照。 */
    public inspect(connectionId: string, projectKey: string, costClass: ThroughputCostClass): IThroughputAdmissionSnapshot {
        const connection = this._connections.get(connectionId) ?? { inFlight: 0, queued: 0 };
        const project = this._projects.get(projectKey);
        return {
            connectionInFlight: connection.inFlight,
            connectionQueued: connection.queued,
            saturated: connection.inFlight >= this._limits.maxConnectionInFlight
                || (project?.active[costClass] ?? 0) >= this._limits.concurrency[costClass],
            projectQueued: project == null ? 0 : this._projectQueued(project, costClass === 'control'),
            classInFlight: project?.active[costClass] ?? 0,
            classCapacity: this._limits.concurrency[costClass],
        };
    }

    /** @description 返回受信宿主使用的脱敏固定窗口健康快照。 */
    public getHealthSnapshot(): ReturnType<ThroughputHealthMetrics['snapshot']> {
        return this._metrics.snapshot();
    }

    /** @description 返回数值事件记录器，供 revision、batch 与 GC 子系统汇入同一快照。 */
    public getMetricsRecorder(): ThroughputHealthMetrics {
        return this._metrics;
    }

    /** @description 拒绝等待者并释放全部内部队列。 */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        for (const project of this._projects.values()) {
            for (const queue of Object.values(project.queues)) {
                for (const waiter of queue.splice(0)) {
                    waiter.cleanup();
                    this._decrementQueued(waiter.request.connectionId);
                    this._metrics.changeQueued(waiter.request.costClass, -1);
                    waiter.reject(new Error('throughput_admission_disposed'));
                }
            }
        }
        this._projects.clear();
        this._connections.clear();
    }

    private _createWaiter(
        request: IThroughputAdmissionRequest,
        resolve: (lease: IThroughputAdmissionLease) => void,
        reject: (error: Error) => void,
    ): IAdmissionWaiter {
        const sequence = ++this._sequence;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let active = true;
        const remove = (): void => {
            if (!active) {
                return;
            }
            active = false;
            request.signal?.removeEventListener('abort', abort);
            if (timeoutHandle != null) {
                clearTimeout(timeoutHandle);
            }
        };
        const fail = (errorFactory: () => Error): void => {
            const project = this._projects.get(request.projectKey);
            const queue = project?.queues[request.costClass];
            const index = queue?.findIndex((candidate) => candidate.sequence === sequence) ?? -1;
            if (index < 0 || queue == null) {
                return;
            }
            queue.splice(index, 1);
            remove();
            const connection = this._connections.get(request.connectionId) ?? { inFlight: 0, queued: 0 };
            this._decrementQueued(request.connectionId);
            this._metrics.changeQueued(request.costClass, -1);
            reject(errorFactory());
            this._drainAll();
        };
        const abort = (): void => fail(() => new Error('throughput_admission_cancelled'));
        request.signal?.addEventListener('abort', abort, { once: true });
        if (request.waitTimeoutMs != null) {
            timeoutHandle = setTimeout(() => fail(() => this._overload(request, this._connection(request.connectionId), 'queue_budget')), request.waitTimeoutMs);
            timeoutHandle.unref?.();
        }
        return { sequence, request, enqueuedAt: this._now(), resolve, reject, cleanup: remove };
    }

    private _grant(
        request: IThroughputAdmissionRequest,
        connection: IConnectionState,
        project: IProjectState,
        startedWaitingAt: number,
    ): IThroughputAdmissionLease {
        connection.inFlight += 1;
        project.active[request.costClass] += 1;
        project.lastGrantedConnection[request.costClass] = request.connectionId;
        const completeMetrics = this._metrics.beginExecution(request.costClass, Math.max(0, this._now() - startedWaitingAt));
        let released = false;
        return {
            connectionId: request.connectionId,
            projectKey: request.projectKey,
            costClass: request.costClass,
            waitedMs: Math.max(0, this._now() - startedWaitingAt),
            release: (): boolean => {
                if (released) {
                    return false;
                }
                released = true;
                completeMetrics();
                connection.inFlight = Math.max(0, connection.inFlight - 1);
                project.active[request.costClass] = Math.max(0, project.active[request.costClass] - 1);
                this._removeIdleConnection(request.connectionId, connection);
                this._drainAll();
                return true;
            },
        };
    }

    private _drainAll(): void {
        let progressed = true;
        while (progressed && !this._disposed) {
            progressed = false;
            for (const project of this._projects.values()) {
                for (const costClass of ['control', 'read_light', 'read_heavy', 'prepare', 'writer'] as const) {
                    if (project.active[costClass] >= this._limits.concurrency[costClass]) {
                        continue;
                    }
                    const waiter = this._selectWaiter(project, costClass);
                    if (waiter == null) {
                        continue;
                    }
                    const connection = this._connection(waiter.request.connectionId);
                    if (connection.inFlight >= this._limits.maxConnectionInFlight) {
                        continue;
                    }
                    const queue = project.queues[costClass];
                    queue.splice(queue.indexOf(waiter), 1);
                    waiter.cleanup();
                    connection.queued = Math.max(0, connection.queued - 1);
                    this._metrics.changeQueued(waiter.request.costClass, -1);
                    waiter.resolve(this._grant(waiter.request, connection, project, waiter.enqueuedAt));
                    progressed = true;
                }
            }
        }
    }

    private _selectWaiter(project: IProjectState, costClass: ThroughputCostClass): IAdmissionWaiter | null {
        const queue = project.queues[costClass];
        if (queue.length === 0) {
            return null;
        }
        const lastConnection = project.lastGrantedConnection[costClass];
        return queue.find((waiter) => waiter.request.connectionId !== lastConnection) ?? queue[0] ?? null;
    }

    private _canGrant(request: IThroughputAdmissionRequest, connection: IConnectionState, project: IProjectState): boolean {
        return connection.inFlight < this._limits.maxConnectionInFlight
            && project.active[request.costClass] < this._limits.concurrency[request.costClass]
            && project.queues[request.costClass].length === 0;
    }

    private _projectQueueFull(project: IProjectState, costClass: ThroughputCostClass): boolean {
        return this._projectQueued(project, costClass === 'control')
            >= (costClass === 'control' ? this._limits.maxControlQueued : this._limits.maxProjectQueued);
    }

    private _projectQueued(project: IProjectState, controlOnly: boolean): number {
        if (controlOnly) {
            return project.queues.control.length;
        }
        return project.queues.read_light.length + project.queues.read_heavy.length
            + project.queues.prepare.length + project.queues.writer.length;
    }

    private _overload(
        request: IThroughputAdmissionRequest,
        connection: IConnectionState,
        rejectedAt: IThroughputOverloadFailure['rejectedAt'],
    ): ThroughputOverloadError {
        this._metrics.recordRejected(request.costClass);
        const retryAfterMs = Math.min(
            THROUGHPUT_CONTRACT_LIMITS.maxRetryAfterMs,
            Math.max(THROUGHPUT_CONTRACT_LIMITS.minRetryAfterMs, (connection.queued + 1) * 25),
        );
        return new ThroughputOverloadError({
            code: 'throughput_overloaded',
            category: 'overloaded',
            rejectedAt,
            projectState: 'not_started',
            retryAfterMs,
            queue: {
                connectionInFlight: connection.inFlight,
                connectionQueued: connection.queued,
                saturated: true,
            },
        });
    }

    private _connection(connectionId: string): IConnectionState {
        const state = this._connections.get(connectionId) ?? { inFlight: 0, queued: 0 };
        this._connections.set(connectionId, state);
        return state;
    }

    private _project(projectKey: string): IProjectState {
        const current = this._projects.get(projectKey);
        if (current != null) {
            return current;
        }
        const state: IProjectState = {
            active: { control: 0, read_light: 0, read_heavy: 0, prepare: 0, writer: 0 },
            queues: { control: [], read_light: [], read_heavy: [], prepare: [], writer: [] },
            lastGrantedConnection: {},
        };
        this._projects.set(projectKey, state);
        return state;
    }

    private _decrementQueued(connectionId: string): void {
        const connection = this._connections.get(connectionId);
        if (connection == null) {
            return;
        }
        connection.queued = Math.max(0, connection.queued - 1);
        this._removeIdleConnection(connectionId, connection);
    }

    private _removeIdleConnection(connectionId: string, connection: IConnectionState): void {
        if (connection.inFlight === 0 && connection.queued === 0) {
            this._connections.delete(connectionId);
        }
    }

    private _validateRequest(request: IThroughputAdmissionRequest): void {
        if (request.connectionId.length === 0 || request.projectKey.length === 0 || !(request.costClass in this._limits.concurrency)) {
            throw new Error('throughput_admission_request_invalid');
        }
        if (request.waitTimeoutMs != null && (!Number.isSafeInteger(request.waitTimeoutMs) || request.waitTimeoutMs <= 0)) {
            throw new Error('throughput_admission_wait_timeout_invalid');
        }
        if (request.signal?.aborted === true) {
            throw new Error('throughput_admission_cancelled');
        }
    }

    private _positiveInteger(value: number): number {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error('throughput_admission_limit_invalid');
        }
        return value;
    }

    private _assertActive(): void {
        if (this._disposed) {
            throw new Error('throughput_admission_disposed');
        }
    }
}
