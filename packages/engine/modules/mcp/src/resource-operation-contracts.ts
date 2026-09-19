import type { IMcpFailureDetails } from '@peanut/pod-protocol';

/**
 * @description 写任务生命周期状态。
 */
export type ResourceOperationTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * @description 写任务执行记录的最小公开摘要。
 */
export interface IResourceOperationTaskRecord<T> {
    /**
     * @description 稳定任务标识。
     */
    readonly taskId: string;
    /**
     * @description 稳定 MCP operation。
     */
    readonly operation: string;
    /**
     * @description 当前生命周期状态。
     */
    readonly status: ResourceOperationTaskStatus;
    /**
     * @description 入队时间戳。
     */
    readonly queuedAt: number;
    /**
     * @description 开始执行时间戳。
     */
    readonly startedAt: number | null;
    /**
     * @description 完成时间戳。
     */
    readonly completedAt: number | null;
    /**
     * @description 成功结果；失败时为空。
     */
    readonly result: T | null;
    /**
     * @description 受控失败消息；不包含凭据或文件内容。
     */
    readonly error: string | null;
    /**
     * @description 供 MCP 调用方机械处理的结构化失败详情；非失败状态为空。
     */
    readonly failure: IMcpFailureDetails | null;
}

/**
 * @description 单个写任务的项目级资源调度计划。
 */
export interface IResourceOperationTaskPlan {
    /**
     * @description 归一后的工程隔离键。
     */
    readonly projectKey: string;
    /**
     * @description 稳定 MCP operation。
     */
    readonly operation: string;
    /**
     * @description 本次任务需要原子独占的完整资源闭包。
     */
    readonly resourceKeys: readonly string[];
    /**
     * @description 是否进入该工程唯一的 AssetDB/editor writer 车道。
     */
    readonly requiresProjectWriter: boolean;
    /**
     * @description 用于任务诊断与后续审批绑定的资源闭包摘要。
     */
    readonly closure?: IResourceOperationClosureSummary;
}

/**
 * @description 规划阶段解析出的资源依赖闭包摘要。
 */
export interface IResourceOperationClosureSummary {
    /**
     * @description operation 输入直接声明或推导的根资源。
     */
    readonly roots: readonly string[];
    /**
     * @description 从序列化资产引用图递归解析出的依赖资源。
     */
    readonly dependencies: readonly string[];
    /**
     * @description 主资源、子资源及输入引用的 UUID 锁键。
     */
    readonly uuidKeys: readonly string[];
    /**
     * @description 需要纳入事务的 `.meta` sidecar。
     */
    readonly sidecars: readonly string[];
    /**
     * @description 无法映射到项目资源的序列化 UUID；仍会作为 UUID 锁键保守互斥。
     */
    readonly unresolvedUuids: readonly string[];
}
