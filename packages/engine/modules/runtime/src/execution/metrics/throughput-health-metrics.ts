import type {
    IThroughputCostClassMetrics,
    IThroughputHealthSnapshot,
    ThroughputCostClass,
} from '@peanut/pod-protocol';

const COST_CLASSES = ['control', 'read_light', 'read_heavy', 'prepare', 'writer'] as const;

interface IClassWindow {
    accepted: number;
    rejected: number;
    inFlight: number;
    queued: number;
    readonly queueWaitMs: number[];
    readonly executionMs: number[];
}

/** @description 固定窗口吞吐指标配置。 */
export interface IThroughputHealthMetricsOptions {
    readonly windowMs?: number;
    readonly maxLatencySamples?: number;
    readonly now?: () => number;
    readonly readRssBytes?: () => number;
}

/**
 * @description 聚合单工程吞吐健康数据；只接受数值事件，不保存工程键、连接、输入或资源内容。
 */
export class ThroughputHealthMetrics {
    public static readonly DEFAULT_WINDOW_MS = 60_000;
    public static readonly DEFAULT_MAX_LATENCY_SAMPLES = 1_024;

    private readonly _windowMs: number;
    private readonly _maxLatencySamples: number;
    private readonly _now: () => number;
    private readonly _readRssBytes: () => number;
    private _windowStartedAt: number;
    private _classes = this._createClasses();
    private readonly _writerHoldMs: number[] = [];
    private readonly _settleMs: number[] = [];
    private readonly _eventLoopLagMs: number[] = [];
    private _rssHighWaterBytes = 0;
    private _coalescedReads = 0;
    private _cacheHits = 0;
    private _gcRemoved = 0;
    private _batchesAccepted = 0;
    private _batchesCompleted = 0;
    private _batchesFailed = 0;

    public constructor(options: IThroughputHealthMetricsOptions = {}) {
        this._windowMs = this._positiveInteger(options.windowMs ?? ThroughputHealthMetrics.DEFAULT_WINDOW_MS);
        this._maxLatencySamples = this._positiveInteger(
            options.maxLatencySamples ?? ThroughputHealthMetrics.DEFAULT_MAX_LATENCY_SAMPLES,
        );
        this._now = options.now ?? Date.now;
        this._readRssBytes = options.readRssBytes ?? (() => process.memoryUsage().rss);
        this._windowStartedAt = this._now();
        this._sampleRss();
    }

    /** @description 记录等待队列 gauge 的增量。 */
    public changeQueued(costClass: ThroughputCostClass, delta: number): void {
        this._rollWindow();
        const metrics = this._classes[costClass];
        metrics.queued = Math.max(0, metrics.queued + delta);
        this._sampleRss();
    }

    /** @description 记录一次准入，并返回执行结束记录器。 */
    public beginExecution(costClass: ThroughputCostClass, queueWaitMs: number): () => void {
        this._rollWindow();
        const metrics = this._classes[costClass];
        metrics.accepted += 1;
        metrics.inFlight += 1;
        this._sample(metrics.queueWaitMs, queueWaitMs);
        const startedAt = this._now();
        let completed = false;
        return (): void => {
            if (completed) {
                return;
            }
            completed = true;
            this._rollWindow();
            const currentMetrics = this._classes[costClass];
            currentMetrics.inFlight = Math.max(0, currentMetrics.inFlight - 1);
            this._sample(currentMetrics.executionMs, Math.max(0, this._now() - startedAt));
            this._sampleRss();
        };
    }

    /** @description 记录一次准入拒绝。 */
    public recordRejected(costClass: ThroughputCostClass): void {
        this._rollWindow();
        this._classes[costClass].rejected += 1;
        this._sampleRss();
    }

    public recordWriterHold(durationMs: number): void { this._recordLatency(this._writerHoldMs, durationMs); }
    public recordSettle(durationMs: number): void { this._recordLatency(this._settleMs, durationMs); }
    public recordEventLoopLag(durationMs: number): void { this._recordLatency(this._eventLoopLagMs, durationMs); }

    public recordCoalescedRead(count = 1): void { this._increment('_coalescedReads', count); }
    public recordCacheHit(count = 1): void { this._increment('_cacheHits', count); }
    public recordGcRemoved(count = 1): void { this._increment('_gcRemoved', count); }
    public recordBatchAccepted(count = 1): void { this._increment('_batchesAccepted', count); }
    public recordBatchCompleted(count = 1): void { this._increment('_batchesCompleted', count); }
    public recordBatchFailed(count = 1): void { this._increment('_batchesFailed', count); }

    /** @description 返回不含标识、输入、路径与 token 的定长健康快照。 */
    public snapshot(): IThroughputHealthSnapshot {
        this._rollWindow();
        this._sampleRss();
        return {
            windowMs: this._windowMs,
            observedAt: new Date(this._now()).toISOString(),
            classes: COST_CLASSES.map((costClass): IThroughputCostClassMetrics => {
                const metrics = this._classes[costClass];
                return {
                    costClass,
                    accepted: metrics.accepted,
                    rejected: metrics.rejected,
                    inFlight: metrics.inFlight,
                    queued: metrics.queued,
                    queueWaitP95Ms: this._percentile95(metrics.queueWaitMs),
                    executionP95Ms: this._percentile95(metrics.executionMs),
                };
            }),
            writerHoldP95Ms: this._percentile95(this._writerHoldMs),
            settleP95Ms: this._percentile95(this._settleMs),
            eventLoopLagP95Ms: this._percentile95(this._eventLoopLagMs),
            rssHighWaterBytes: this._rssHighWaterBytes,
            coalescedReads: this._coalescedReads,
            cacheHits: this._cacheHits,
            gcRemoved: this._gcRemoved,
            batchesAccepted: this._batchesAccepted,
            batchesCompleted: this._batchesCompleted,
            batchesFailed: this._batchesFailed,
        };
    }

    private _recordLatency(samples: number[], durationMs: number): void {
        this._rollWindow();
        this._sample(samples, durationMs);
        this._sampleRss();
    }

    private _increment(
        field: '_coalescedReads' | '_cacheHits' | '_gcRemoved' | '_batchesAccepted' | '_batchesCompleted' | '_batchesFailed',
        count: number,
    ): void {
        this._rollWindow();
        if (!Number.isInteger(count) || count < 0) {
            throw new Error('throughput_metrics_count_invalid');
        }
        this[field] += count;
        this._sampleRss();
    }

    private _rollWindow(): void {
        const now = this._now();
        if (now - this._windowStartedAt < this._windowMs) {
            return;
        }
        const gauges = Object.fromEntries(COST_CLASSES.map((costClass) => [costClass, {
            inFlight: this._classes[costClass].inFlight,
            queued: this._classes[costClass].queued,
        }])) as Record<ThroughputCostClass, { inFlight: number; queued: number }>;
        this._classes = this._createClasses();
        for (const costClass of COST_CLASSES) {
            this._classes[costClass].inFlight = gauges[costClass].inFlight;
            this._classes[costClass].queued = gauges[costClass].queued;
        }
        this._writerHoldMs.length = 0;
        this._settleMs.length = 0;
        this._eventLoopLagMs.length = 0;
        this._rssHighWaterBytes = 0;
        this._coalescedReads = 0;
        this._cacheHits = 0;
        this._gcRemoved = 0;
        this._batchesAccepted = 0;
        this._batchesCompleted = 0;
        this._batchesFailed = 0;
        this._windowStartedAt = now;
    }

    private _createClasses(): Record<ThroughputCostClass, IClassWindow> {
        const create = (): IClassWindow => ({
            accepted: 0,
            rejected: 0,
            inFlight: 0,
            queued: 0,
            queueWaitMs: [],
            executionMs: [],
        });
        return {
            control: create(),
            read_light: create(),
            read_heavy: create(),
            prepare: create(),
            writer: create(),
        };
    }

    private _sample(samples: number[], value: number): void {
        const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
        if (samples.length >= this._maxLatencySamples) {
            samples.shift();
        }
        samples.push(safe);
    }

    private _sampleRss(): void {
        this._rssHighWaterBytes = Math.max(this._rssHighWaterBytes, Math.max(0, this._readRssBytes()));
    }

    private _percentile95(samples: readonly number[]): number {
        if (samples.length === 0) {
            return 0;
        }
        const ordered = [...samples].sort((left, right) => left - right);
        return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
    }

    private _positiveInteger(value: number): number {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error('throughput_metrics_limit_invalid');
        }
        return value;
    }
}
