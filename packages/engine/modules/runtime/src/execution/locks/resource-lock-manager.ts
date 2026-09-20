/**
 * @description 原子资源锁集合请求。
 */
export interface IResourceLockRequest {
    /**
     * @description 工程稳定键。
     */
    readonly projectKey: string;
    /**
     * @description 一次性原子预留的完整资源键集合。
     */
    readonly resourceKeys: readonly string[];
    /**
     * @description 是否需要当前工程唯一 writer。
     */
    readonly requiresProjectWriter: boolean;
}

/**
 * @description 等待资源锁的取消与超时控制。
 */
export interface IResourceLockAcquireOptions {
    /**
     * @description 等待超时，单位毫秒。
     */
    readonly timeoutMs?: number;
    /**
     * @description 等待阶段取消信号。
     */
    readonly signal?: AbortSignal;
}

/**
 * @description 已取得的原子资源锁租约。
 */
export interface IResourceLockLease {
    /**
     * @description 归一化工程键。
     */
    readonly projectKey: string;
    /**
     * @description 已原子取得的有序资源键。
     */
    readonly resourceKeys: readonly string[];
    /**
     * @description 是否占用工程 writer。
     */
    readonly projectWriter: boolean;
    /**
     * @description 释放全部资源；重复释放返回 false。
     */
    release(): boolean;
}

interface IActiveResourceLock {
    /**
     * @description 内部租约标识。
     */
    readonly id: number;
    /**
     * @description 工程稳定键；旧单锁无工程作用域。
     */
    readonly projectKey: string | null;
    /**
     * @description 已持有资源键。
     */
    readonly resourceKeys: readonly string[];
    /**
     * @description 是否占用工程 writer。
     */
    readonly projectWriter: boolean;
}

interface IWaitingResourceLock {
    /**
     * @description 稳定等待顺序。
     */
    readonly sequence: number;
    /**
     * @description 归一化锁请求。
     */
    readonly request: IResourceLockRequest;
    /**
     * @description 成功取得锁时完成 Promise。
     */
    readonly resolve: (lease: IResourceLockLease) => void;
    /**
     * @description 取消或超时时拒绝 Promise。
     */
    readonly reject: (error: Error) => void;
    /**
     * @description 清理计时器与信号监听。
     */
    cleanup(): void;
}

/**
 * @description 支持原子有序锁集合、同资源 FIFO 和每工程 writer 屏障的资源锁管理器。
 */
export class ResourceLockManager {
    /**
     * @description 当前活跃租约。
     */
    private readonly _activeLocks = new Map<number, IActiveResourceLock>();
    /**
     * @description 等待队列。
     */
    private readonly _waiters: IWaitingResourceLock[] = [];
    /**
     * @description 内部租约序列。
     */
    private _leaseSequence = 0;
    /**
     * @description 稳定等待序列。
     */
    private _waitSequence = 0;

    /**
     * @description 兼容旧调用的单资源立即申请。
     * @param lockKey 资源锁键。
     * @returns 成功获取时返回 true。
     */
    public acquire(lockKey: string): boolean {
        const resourceKey = this._normalizeKey(lockKey, 'resource_lock_key_invalid');
        const request: IResourceLockRequest = { projectKey: '', resourceKeys: [resourceKey], requiresProjectWriter: false };
        if (this._hasActiveConflict(request)) {
            return false;
        }
        const id = this._nextLeaseId();
        this._activeLocks.set(id, { id, projectKey: null, resourceKeys: [resourceKey], projectWriter: false });
        return true;
    }

    /**
     * @description 兼容旧调用的单资源释放。
     * @param lockKey 资源锁键。
     * @returns 成功释放时返回 true。
     */
    public release(lockKey: string): boolean {
        const resourceKey = this._normalizeKey(lockKey, 'resource_lock_key_invalid');
        for (const [id, activeLock] of this._activeLocks) {
            if (activeLock.projectKey == null && activeLock.resourceKeys.length === 1 && activeLock.resourceKeys[0] === resourceKey) {
                this._activeLocks.delete(id);
                this._drain();
                return true;
            }
        }
        return false;
    }

    /**
     * @description 原子申请完整资源集合与可选工程 writer。
     */
    public acquireSet(request: IResourceLockRequest, options: IResourceLockAcquireOptions = {}): Promise<IResourceLockLease> {
        const normalizedRequest = this._normalizeRequest(request);
        if (options.signal?.aborted === true) {
            return Promise.reject(new Error('resource_lock_cancelled'));
        }
        return new Promise<IResourceLockLease>((resolve, reject) => {
            let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
            let waiter: IWaitingResourceLock;
            const cancel = (errorCode: string): void => {
                const index = this._waiters.indexOf(waiter);
                if (index < 0) {
                    return;
                }
                this._waiters.splice(index, 1);
                waiter.cleanup();
                reject(new Error(errorCode));
                this._drain();
            };
            const abort = (): void => cancel('resource_lock_cancelled');
            waiter = {
                sequence: this._nextWaitSequence(),
                request: normalizedRequest,
                resolve,
                reject,
                cleanup: (): void => {
                    if (timeoutHandle != null) {
                        clearTimeout(timeoutHandle);
                        timeoutHandle = null;
                    }
                    options.signal?.removeEventListener('abort', abort);
                },
            };
            this._waiters.push(waiter);
            options.signal?.addEventListener('abort', abort, { once: true });
            if (options.timeoutMs != null) {
                if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
                    cancel('resource_lock_timeout_invalid');
                    return;
                }
                timeoutHandle = setTimeout(() => cancel('resource_lock_timeout'), options.timeoutMs);
            }
            this._drain();
        });
    }

    /**
     * @description 尝试授予所有当前可运行且不越过冲突前序的等待请求。
     */
    private _drain(): void {
        let granted = true;
        while (granted) {
            granted = false;
            for (let index = 0; index < this._waiters.length; index += 1) {
                const waiter = this._waiters[index];
                if (waiter == null || this._hasActiveConflict(waiter.request) || this._hasEarlierWaiterConflict(index, waiter.request)) {
                    continue;
                }
                this._waiters.splice(index, 1);
                waiter.cleanup();
                waiter.resolve(this._activate(waiter.request));
                granted = true;
                break;
            }
        }
    }

    /**
     * @description 激活一个完整锁请求。
     */
    private _activate(request: IResourceLockRequest): IResourceLockLease {
        const id = this._nextLeaseId();
        this._activeLocks.set(id, {
            id,
            projectKey: request.projectKey,
            resourceKeys: request.resourceKeys,
            projectWriter: request.requiresProjectWriter,
        });
        let active = true;
        return {
            projectKey: request.projectKey,
            resourceKeys: request.resourceKeys,
            projectWriter: request.requiresProjectWriter,
            release: (): boolean => {
                if (!active || !this._activeLocks.delete(id)) {
                    return false;
                }
                active = false;
                this._drain();
                return true;
            },
        };
    }

    /**
     * @description 判断请求是否与任何活跃租约冲突。
     */
    private _hasActiveConflict(request: IResourceLockRequest): boolean {
        for (const activeLock of this._activeLocks.values()) {
            if (this._requestsConflict(request, {
                projectKey: activeLock.projectKey ?? request.projectKey,
                resourceKeys: activeLock.resourceKeys,
                requiresProjectWriter: activeLock.projectWriter,
            })) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description 同资源请求不得越过更早等待者。
     */
    private _hasEarlierWaiterConflict(index: number, request: IResourceLockRequest): boolean {
        return this._waiters.slice(0, index).some((waiter) => this._requestsConflict(request, waiter.request));
    }

    /**
     * @description 比较两个请求的资源与 project writer 冲突。
     */
    private _requestsConflict(left: IResourceLockRequest, right: IResourceLockRequest): boolean {
        if (left.resourceKeys.some((resourceKey) => right.resourceKeys.includes(resourceKey))) {
            return true;
        }
        if (left.projectKey !== right.projectKey) {
            return false;
        }
        return left.requiresProjectWriter || right.requiresProjectWriter;
    }

    /**
     * @description 归一化请求并固定资源排序。
     */
    private _normalizeRequest(request: IResourceLockRequest): IResourceLockRequest {
        const projectKey = this._normalizeKey(request.projectKey, 'resource_lock_project_key_invalid');
        const resourceKeys = [...new Set(request.resourceKeys.map((resourceKey) => {
            return this._normalizeKey(resourceKey, 'resource_lock_key_invalid');
        }))].sort((left, right) => left.localeCompare(right));
        if (resourceKeys.length === 0 && !request.requiresProjectWriter) {
            throw new Error('resource_lock_request_empty');
        }
        return { projectKey, resourceKeys, requiresProjectWriter: request.requiresProjectWriter };
    }

    /**
     * @description 归一化非空锁键。
     */
    private _normalizeKey(value: string, errorCode: string): string {
        const normalized = value.trim();
        if (normalized.length === 0) {
            throw new Error(errorCode);
        }
        return normalized;
    }

    /**
     * @description 生成租约序列。
     */
    private _nextLeaseId(): number {
        this._leaseSequence += 1;
        return this._leaseSequence;
    }

    /**
     * @description 生成等待序列。
     */
    private _nextWaitSequence(): number {
        this._waitSequence += 1;
        return this._waitSequence;
    }
}
