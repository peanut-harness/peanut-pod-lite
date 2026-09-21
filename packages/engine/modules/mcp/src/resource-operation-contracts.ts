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
    /**
     * @description 首次创建任务由 worker 在真正发布前开启 commit 窗口。
     */
    readonly workerManagedCommitWindow?: boolean;
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
