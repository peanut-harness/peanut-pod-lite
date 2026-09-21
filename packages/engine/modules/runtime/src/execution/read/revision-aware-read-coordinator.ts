import { createHash } from 'crypto';

import type { ProjectRevisionClock } from '../revision/project-revision-clock.js';
import type { ThroughputHealthMetrics } from '../metrics/throughput-health-metrics.js';

/** @description 等价读取的安全键材料。 */
export interface IRevisionAwareReadRequest {
    readonly operation: string;
    readonly input: unknown;
    readonly authorityKey: string;
    readonly capabilityVersion: string;
    readonly allowCoalescing?: boolean;
    readonly cacheTtlMs?: number;
    readonly retryOnRevisionChange?: boolean;
}

/** @description 绑定工程 revision 的读取结果。 */
export interface IRevisionAwareReadResult<T> {
    readonly value: T;
    readonly revision: number;
    readonly stale: boolean;
    readonly source: 'fresh' | 'coalesced' | 'cache';
}

/** @description 读协调器的有界配置。 */
export interface IRevisionAwareReadCoordinatorOptions {
    readonly coalescingWindowMs?: number;
    readonly maxCoalescedKeys?: number;
    readonly maxCacheEntries?: number;
    readonly now?: () => number;
    readonly metrics?: ThroughputHealthMetrics;
}

interface IReadCacheEntry {
    readonly value: unknown;
    readonly revision: number;
    readonly expiresAt: number;
}

interface ICoalescedRead<T> {
    readonly promise: Promise<IRevisionAwareReadResult<T>>;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * @description 在同 revision 内合并等价读取，并维护只保存哈希键的有界 LRU 快照缓存。
 */
export class RevisionAwareReadCoordinator {
    public static readonly DEFAULT_COALESCING_WINDOW_MS = 10;
    public static readonly DEFAULT_MAX_COALESCED_KEYS = 256;
    public static readonly DEFAULT_MAX_CACHE_ENTRIES = 128;

    private readonly _clock: ProjectRevisionClock;
    private readonly _coalescingWindowMs: number;
    private readonly _maxCoalescedKeys: number;
    private readonly _maxCacheEntries: number;
    private readonly _now: () => number;
    private readonly _metrics: ThroughputHealthMetrics | null;
    private readonly _inFlight = new Map<string, ICoalescedRead<unknown>>();
    private readonly _cache = new Map<string, IReadCacheEntry>();

    public constructor(clock: ProjectRevisionClock, options: IRevisionAwareReadCoordinatorOptions = {}) {
        this._clock = clock;
        this._coalescingWindowMs = this._nonNegativeInteger(
            options.coalescingWindowMs ?? RevisionAwareReadCoordinator.DEFAULT_COALESCING_WINDOW_MS,
        );
        this._maxCoalescedKeys = this._positiveInteger(
            options.maxCoalescedKeys ?? RevisionAwareReadCoordinator.DEFAULT_MAX_COALESCED_KEYS,
        );
        this._maxCacheEntries = this._positiveInteger(
            options.maxCacheEntries ?? RevisionAwareReadCoordinator.DEFAULT_MAX_CACHE_ENTRIES,
        );
        this._now = options.now ?? Date.now;
        this._metrics = options.metrics ?? null;
    }

    /** @description 执行一次 revision 绑定读取；不同权限、参数、版本或 revision 永不共享。 */
    public async execute<T>(request: IRevisionAwareReadRequest, read: () => Promise<T>): Promise<IRevisionAwareReadResult<T>> {
        this._validateRequest(request);
        const revision = this._clock.snapshot().revision;
        const key = this._key(request, revision);
        const cacheTtlMs = this._nonNegativeInteger(request.cacheTtlMs ?? 0);
        if (cacheTtlMs > 0) {
            const cached = this._readCache<T>(key, revision);
            if (cached != null) {
                this._metrics?.recordCacheHit();
                return cached;
            }
        }
        if (request.allowCoalescing !== false) {
            const active = this._inFlight.get(key) as ICoalescedRead<T> | undefined;
            if (active != null) {
                this._metrics?.recordCoalescedRead();
                const result = await active.promise;
                return { ...result, source: 'coalesced' };
            }
        }

        const pending = this._executeFresh(request, revision, read, cacheTtlMs, key);
        if (request.allowCoalescing === false || this._inFlight.size >= this._maxCoalescedKeys) {
            return pending;
        }
        const record: ICoalescedRead<T> = { promise: pending, timer: null };
        this._inFlight.set(key, record as ICoalescedRead<unknown>);
        void pending.finally(() => {
            record.timer = setTimeout(() => {
                if (this._inFlight.get(key) === record) {
                    this._inFlight.delete(key);
                }
            }, this._coalescingWindowMs);
            record.timer.unref?.();
        }).catch(() => undefined);
        return pending;
    }

    /** @description 返回容量观测，仅含条目数量。 */
    public inspect(): { readonly coalescedKeys: number; readonly cacheEntries: number } {
        return { coalescedKeys: this._inFlight.size, cacheEntries: this._cache.size };
    }

    /** @description 释放短窗 timer 与缓存。 */
    public dispose(): void {
        for (const entry of this._inFlight.values()) {
            if (entry.timer != null) {
                clearTimeout(entry.timer);
            }
        }
        this._inFlight.clear();
        this._cache.clear();
    }

    private async _executeFresh<T>(
        request: IRevisionAwareReadRequest,
        startRevision: number,
        read: () => Promise<T>,
        cacheTtlMs: number,
        key: string,
    ): Promise<IRevisionAwareReadResult<T>> {
        let value = await read();
        let revision = startRevision;
        let currentRevision = this._clock.snapshot().revision;
        if (currentRevision !== revision && request.retryOnRevisionChange === true) {
            revision = currentRevision;
            value = await read();
            currentRevision = this._clock.snapshot().revision;
        }
        const stale = currentRevision !== revision;
        const result: IRevisionAwareReadResult<T> = { value, revision, stale, source: 'fresh' };
        if (!stale && cacheTtlMs > 0) {
            this._writeCache(key, { value, revision, expiresAt: this._now() + cacheTtlMs });
        }
        return result;
    }

    private _readCache<T>(key: string, revision: number): IRevisionAwareReadResult<T> | null {
        const cached = this._cache.get(key);
        if (cached == null) {
            return null;
        }
        if (cached.revision !== revision || cached.expiresAt < this._now()) {
            this._cache.delete(key);
            return null;
        }
        this._cache.delete(key);
        this._cache.set(key, cached);
        return { value: cached.value as T, revision, stale: false, source: 'cache' };
    }

    private _writeCache(key: string, entry: IReadCacheEntry): void {
        this._cache.delete(key);
        this._cache.set(key, entry);
        while (this._cache.size > this._maxCacheEntries) {
            const oldest = this._cache.keys().next().value as string | undefined;
            if (oldest == null) {
                break;
            }
            this._cache.delete(oldest);
        }
    }

    private _key(request: IRevisionAwareReadRequest, revision: number): string {
        const canonical = this._canonicalize({
            operation: request.operation,
            input: request.input,
            authorityKey: request.authorityKey,
            capabilityVersion: request.capabilityVersion,
            revision,
        });
        return createHash('sha256').update(canonical).digest('hex');
    }

    private _canonicalize(value: unknown): string {
        if (value == null || typeof value === 'boolean' || typeof value === 'string') {
            return JSON.stringify(value);
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                throw new Error('read_coalescing_input_invalid');
            }
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map((entry) => this._canonicalize(entry)).join(',')}]`;
        }
        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this._canonicalize(record[key])}`).join(',')}}`;
        }
        throw new Error('read_coalescing_input_invalid');
    }

    private _validateRequest(request: IRevisionAwareReadRequest): void {
        if (request.operation.length === 0 || request.authorityKey.length === 0 || request.capabilityVersion.length === 0) {
            throw new Error('read_coalescing_request_invalid');
        }
    }

    private _nonNegativeInteger(value: number): number {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error('read_coalescing_limit_invalid');
        }
        return value;
    }

    private _positiveInteger(value: number): number {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error('read_coalescing_limit_invalid');
        }
        return value;
    }
}
