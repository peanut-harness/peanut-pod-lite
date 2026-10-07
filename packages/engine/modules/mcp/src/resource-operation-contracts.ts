import type { IEditorMcpPreparedTextWrite } from './editor-mcp-text-write-gateway.js';

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
    /**
     * @description 内部签发且只供当前调用的不可变文本写准备，不进入业务 payload 或任务证据。
     */
    readonly preparedTextWrite?: IEditorMcpPreparedTextWrite;
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

/**
 * @description 联合 writer 调用的内部上下文；业务 JSON 不允许提供或覆盖。
 */
export interface IResourceOperationBatchContext {
    /**
     * @description 当前批次已经证实的文本自变更。
     */
    readonly textWrites: import('./editor-mcp-text-write-session.js').EditorMcpTextWriteSession;
    /**
     * @description 通过原计划对象查找原始账本。
     */
    outcome(plan: IResourceOperationTaskPlan): import('./editor-mcp-text-write-outcome.js').EditorMcpTextWriteOutcome | undefined;
    /**
     * @description 全部 worker 后执行唯一最终内容、身份和日志收口。
     */
    finish(results: readonly unknown[]): Promise<readonly unknown[]>;
    /**
     * @description 保留当前调用各任务自己的失败结果。
     */
    failure(error: unknown): Error;
}
