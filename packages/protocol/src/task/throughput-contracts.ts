import type { ContractPayload, IsoDateTimeString, TaskId } from '../shared/common-contracts.js';

/**
 * @description 单工程吞吐控制使用的稳定成本类别。
 */
export type ThroughputCostClass = 'control' | 'read_light' | 'read_heavy' | 'prepare' | 'writer';

/**
 * @description 批次执行阶段。
 */
export type ThroughputBatchStage = 'admitted' | 'planning' | 'preparing' | 'waiting_commit' | 'committing' | 'postflight' | 'terminal';

/**
 * @description 批次整体状态。
 */
export type ThroughputBatchStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * @description 批次结束后项目状态的保守结论。
 */
export type ThroughputProjectState = 'not_started' | 'unchanged' | 'rolled_back' | 'may_have_changed';

/**
 * @description 吞吐协议首版容量边界。
 */
export const THROUGHPUT_CONTRACT_LIMITS = Object.freeze({
    maxBatchItems: 32,
    maxBatchInputBytes: 4 * 1024 * 1024,
    minRetryAfterMs: 25,
    maxRetryAfterMs: 5_000,
});

/**
 * @description 不泄露其它连接信息的调用方可见队列摘要。
 */
export interface IThroughputQueueSummary extends ContractPayload {
    /**
     * @description 当前调用方在途数量。
     */
    readonly connectionInFlight: number;
    /**
     * @description 当前调用方等待数量。
     */
    readonly connectionQueued: number;
    /**
     * @description 对应成本类别是否处于高水位。
     */
    readonly saturated: boolean;
}

/**
 * @description admission 拒绝时返回的稳定 overload 载荷。
 */
export interface IThroughputOverloadFailure extends ContractPayload {
    /**
     * @description 稳定错误码。
     */
    readonly code: 'throughput_overloaded';
    /**
     * @description 稳定失败分类。
     */
    readonly category: 'overloaded';
    /**
     * @description 拒绝发生的处理阶段。
     */
    readonly rejectedAt: 'admission' | 'queue_budget' | 'load_shed';
    /**
     * @description 可证明的项目状态。
     */
    readonly projectState: 'not_started' | 'unchanged';
    /**
     * @description 客户端退避时间，单位毫秒。
     */
    readonly retryAfterMs: number;
    /**
     * @description 当前调用方可见的安全队列摘要。
     */
    readonly queue: IThroughputQueueSummary;
}

/**
 * @description 工程 revision 快照。
 */
export interface IProjectRevisionSnapshot extends ContractPayload {
    /**
     * @description 工程稳定键。
     */
    readonly projectKey: string;
    /**
     * @description 单调递增 revision。
     */
    readonly revision: number;
    /**
     * @description 读取结果是否已跨越新 revision。
     */
    readonly stale: boolean;
    /**
     * @description revision 观测时间。
     */
    readonly observedAt: IsoDateTimeString;
}

/**
 * @description 显式批次中的单个操作请求。
 */
export interface IThroughputBatchItemRequest extends ContractPayload {
    /**
     * @description 批内稳定条目标识。
     */
    readonly itemId: string;
    /**
     * @description 公开 operation 名称。
     */
    readonly operation: string;
    /**
     * @description operation 原始输入。
     */
    readonly input: ContractPayload;
    /**
     * @description 可选逐项幂等键。
     */
    readonly idempotencyKey?: string;
    /**
     * @description 当前项依赖的批内条目标识。
     */
    readonly dependsOn?: readonly string[];
}

/**
 * @description 显式批次请求；owner 与审批仍由宿主调用上下文固定。
 */
export interface IThroughputBatchRequest extends ContractPayload {
    /**
     * @description 调用方稳定批次请求标识。
     */
    readonly requestId: string;
    /**
     * @description 可选批次幂等键。
     */
    readonly idempotencyKey?: string;
    /**
     * @description 按输入顺序排列的批内操作。
     */
    readonly items: readonly IThroughputBatchItemRequest[];
}

/**
 * @description 显式批次受理后的逐项回执。
 */
export interface IThroughputBatchItemReceipt extends ContractPayload {
    /**
     * @description 批内稳定条目标识。
     */
    readonly itemId: string;
    /**
     * @description 运行时分配的任务标识。
     */
    readonly taskId: TaskId;
    /**
     * @description 当前项是否已创建任务。
     */
    readonly admitted: boolean;
}

/**
 * @description 显式批次回执。
 */
export interface IThroughputBatchReceipt extends ContractPayload {
    /**
     * @description 运行时分配的批次标识。
     */
    readonly batchId: string;
    /**
     * @description 批次当前阶段。
     */
    readonly stage: ThroughputBatchStage;
    /**
     * @description 逐项任务回执。
     */
    readonly items: readonly IThroughputBatchItemReceipt[];
}

/**
 * @description 批次逐项终态。
 */
export interface IThroughputBatchItemOutcome extends ContractPayload {
    /**
     * @description 批内稳定条目标识。
     */
    readonly itemId: string;
    /**
     * @description 运行时任务标识。
     */
    readonly taskId: TaskId;
    /**
     * @description 当前项是否执行成功。
     */
    readonly ok: boolean;
    /**
     * @description 当前项是否进入过 writer。
     */
    readonly committed: boolean;
    /**
     * @description 受控结果摘要。
     */
    readonly summary: string;
    /**
     * @description 可选稳定错误码。
     */
    readonly errorCode?: string;
}

/**
 * @description owner 可见的批次状态摘要。
 */
export interface IThroughputBatchStatusSummary extends ContractPayload {
    /**
     * @description 批次标识。
     */
    readonly batchId: string;
    /**
     * @description 当前批次阶段。
     */
    readonly stage: ThroughputBatchStage;
    /**
     * @description 当前批次状态。
     */
    readonly status: ThroughputBatchStatus;
    /**
     * @description 批次总项数。
     */
    readonly total: number;
    /**
     * @description 已完成项数。
     */
    readonly completed: number;
    /**
     * @description 失败项数。
     */
    readonly failed: number;
    /**
     * @description 尚未终态项数。
     */
    readonly pending: number;
    /**
     * @description 项目状态的保守结论。
     */
    readonly projectState: ThroughputProjectState;
    /**
     * @description 有界逐项 outcome。
     */
    readonly outcomes: readonly IThroughputBatchItemOutcome[];
}

/**
 * @description 单个成本类别的固定窗口吞吐摘要。
 */
export interface IThroughputCostClassMetrics extends ContractPayload {
    /**
     * @description 成本类别。
     */
    readonly costClass: ThroughputCostClass;
    /**
     * @description 窗口内受理数量。
     */
    readonly accepted: number;
    /**
     * @description 窗口内拒绝数量。
     */
    readonly rejected: number;
    /**
     * @description 当前在途数量。
     */
    readonly inFlight: number;
    /**
     * @description 当前等待数量。
     */
    readonly queued: number;
    /**
     * @description 等待延迟 P95。
     */
    readonly queueWaitP95Ms: number;
    /**
     * @description 执行延迟 P95。
     */
    readonly executionP95Ms: number;
}

/**
 * @description 受信宿主可读取的脱敏吞吐健康快照。
 */
export interface IThroughputHealthSnapshot extends ContractPayload {
    /**
     * @description 指标聚合窗口长度。
     */
    readonly windowMs: number;
    /**
     * @description 快照生成时间。
     */
    readonly observedAt: IsoDateTimeString;
    /**
     * @description 各成本类别摘要。
     */
    readonly classes: readonly IThroughputCostClassMetrics[];
    /**
     * @description writer 占用时间 P95。
     */
    readonly writerHoldP95Ms: number;
    /**
     * @description AssetDB settle 延迟 P95。
     */
    readonly settleP95Ms: number;
    /**
     * @description event-loop lag P95。
     */
    readonly eventLoopLagP95Ms: number;
    /**
     * @description 当前窗口 RSS 高水位。
     */
    readonly rssHighWaterBytes: number;
    /**
     * @description 合并读取数量。
     */
    readonly coalescedReads: number;
    /**
     * @description 缓存命中数量。
     */
    readonly cacheHits: number;
    /**
     * @description 回收任务数量。
     */
    readonly gcRemoved: number;
    /**
     * @description 窗口内受理的批次数量。
     */
    readonly batchesAccepted: number;
    /**
     * @description 窗口内完成的批次数量。
     */
    readonly batchesCompleted: number;
    /**
     * @description 窗口内失败或取消的批次数量。
     */
    readonly batchesFailed: number;
}

/**
 * @description 纯协议层显式批次校验器。
 */
export class ThroughputContractValidator {
    /**
     * @description 校验并返回显式批次请求，拒绝未知控制字段与容量超限。
     */
    public static parseBatchRequest(value: unknown): IThroughputBatchRequest {
        const record = this._record(value, 'throughput_batch_request_invalid');
        this._rejectUnknownKeys(record, ['requestId', 'idempotencyKey', 'items'], 'throughput_batch_request_unknown_field');
        const requestId = this._nonEmptyString(record.requestId, 'throughput_batch_request_id_invalid');
        const idempotencyKey = record.idempotencyKey == null
            ? undefined
            : this._nonEmptyString(record.idempotencyKey, 'throughput_batch_idempotency_key_invalid');
        if (!Array.isArray(record.items) || record.items.length === 0) {
            throw new Error('throughput_batch_items_required');
        }
        if (record.items.length > THROUGHPUT_CONTRACT_LIMITS.maxBatchItems) {
            throw new Error('throughput_batch_items_limit_exceeded');
        }
        const itemIds = new Set<string>();
        const items = record.items.map((item, index) => this._parseBatchItem(item, index, itemIds));
        const inputBytes = new TextEncoder().encode(JSON.stringify(items.map((item) => item.input))).byteLength;
        if (inputBytes > THROUGHPUT_CONTRACT_LIMITS.maxBatchInputBytes) {
            throw new Error('throughput_batch_input_limit_exceeded');
        }
        for (const item of items) {
            for (const dependency of item.dependsOn ?? []) {
                if (!itemIds.has(dependency) || dependency === item.itemId) {
                    throw new Error('throughput_batch_dependency_invalid');
                }
            }
        }
        return { requestId, ...(idempotencyKey == null ? {} : { idempotencyKey }), items };
    }

    /**
     * @description 校验 overload DTO 的稳定值域和退避边界。
     */
    public static parseOverloadFailure(value: unknown): IThroughputOverloadFailure {
        const record = this._record(value, 'throughput_overload_invalid');
        this._rejectUnknownKeys(record, ['code', 'category', 'rejectedAt', 'projectState', 'retryAfterMs', 'queue'], 'throughput_overload_unknown_field');
        if (record.code !== 'throughput_overloaded' || record.category !== 'overloaded') {
            throw new Error('throughput_overload_code_invalid');
        }
        if (record.rejectedAt !== 'admission' && record.rejectedAt !== 'queue_budget' && record.rejectedAt !== 'load_shed') {
            throw new Error('throughput_overload_stage_invalid');
        }
        if (record.projectState !== 'not_started' && record.projectState !== 'unchanged') {
            throw new Error('throughput_overload_project_state_invalid');
        }
        if (!Number.isInteger(record.retryAfterMs)
            || (record.retryAfterMs as number) < THROUGHPUT_CONTRACT_LIMITS.minRetryAfterMs
            || (record.retryAfterMs as number) > THROUGHPUT_CONTRACT_LIMITS.maxRetryAfterMs) {
            throw new Error('throughput_overload_retry_after_invalid');
        }
        const queue = this._record(record.queue, 'throughput_overload_queue_invalid');
        this._rejectUnknownKeys(queue, ['connectionInFlight', 'connectionQueued', 'saturated'], 'throughput_overload_queue_unknown_field');
        if (!Number.isInteger(queue.connectionInFlight) || (queue.connectionInFlight as number) < 0
            || !Number.isInteger(queue.connectionQueued) || (queue.connectionQueued as number) < 0
            || typeof queue.saturated !== 'boolean') {
            throw new Error('throughput_overload_queue_invalid');
        }
        return value as IThroughputOverloadFailure;
    }

    /**
     * @description 校验并转换单个批次条目。
     */
    private static _parseBatchItem(value: unknown, index: number, itemIds: Set<string>): IThroughputBatchItemRequest {
        const record = this._record(value, `throughput_batch_item_invalid:${index}`);
        this._rejectUnknownKeys(record, ['itemId', 'operation', 'input', 'idempotencyKey', 'dependsOn'], 'throughput_batch_item_unknown_field');
        const itemId = this._nonEmptyString(record.itemId, 'throughput_batch_item_id_invalid');
        if (itemIds.has(itemId)) {
            throw new Error('throughput_batch_item_id_duplicate');
        }
        itemIds.add(itemId);
        const operation = this._nonEmptyString(record.operation, 'throughput_batch_operation_invalid');
        const input = this._record(record.input, 'throughput_batch_item_input_invalid') as ContractPayload;
        const idempotencyKey = record.idempotencyKey == null
            ? undefined
            : this._nonEmptyString(record.idempotencyKey, 'throughput_batch_item_idempotency_key_invalid');
        const dependsOn = record.dependsOn == null
            ? undefined
            : this._stringArray(record.dependsOn, 'throughput_batch_item_dependencies_invalid');
        return {
            itemId,
            operation,
            input,
            ...(idempotencyKey == null ? {} : { idempotencyKey }),
            ...(dependsOn == null ? {} : { dependsOn }),
        };
    }

    /**
     * @description 将未知值收窄为普通记录。
     */
    private static _record(value: unknown, code: string): Record<string, unknown> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(code);
        }
        return value as Record<string, unknown>;
    }

    /**
     * @description 拒绝控制对象中的未知键。
     */
    private static _rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], code: string): void {
        if (Object.keys(record).some((key) => !allowed.includes(key))) {
            throw new Error(code);
        }
    }

    /**
     * @description 校验非空字符串。
     */
    private static _nonEmptyString(value: unknown, code: string): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(code);
        }
        return value;
    }

    /**
     * @description 校验字符串数组。
     */
    private static _stringArray(value: unknown, code: string): readonly string[] {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
            throw new Error(code);
        }
        return [...value];
    }
}
