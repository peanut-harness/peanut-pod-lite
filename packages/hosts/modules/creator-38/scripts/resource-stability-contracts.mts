/**
 * @description 资源 campaign 的可移植计划与原生观察；布尔通过标志不能替代实际读回。
 */
export interface IResourceSnapshot {
    /**
     * @description 规范项目相对路径。
     */
    readonly path: string;
    /**
     * @description 源文件或目录是否存在。
     */
    readonly exists: boolean;
    /**
     * @description 源 metadata 的真实根 UUID，缺失时为空。
     */
    readonly metaUuid: string | null;
    /**
     * @description 独立 AssetDB 查询所得根 UUID，未登记时为空。
     */
    readonly assetDbUuid: string | null;
    /**
     * @description 子资源的 metadata 与原生登记 UUID。
     */
    readonly subassets: readonly { readonly metaUuid: string; readonly assetDbUuid: string | null }[];
    /**
     * @description 原生引用查询中不能解析的引用。
     */
    readonly unresolvedReferences: readonly string[];
    /**
     * @description 原生 Inspector 读回的公开值。
     */
    readonly semantic: Readonly<Record<string, unknown>>;
    /**
     * @description 字段由 Creator 进程中的原生对象读回，serialized-only 不能用于原生验收。
     */
    readonly readbackOrigin: 'creator-native' | 'serialized-only';
}

/**
 * @description 一个有界资源命令；审批由实际 Bridge 端口签发，计划不能携带 token。
 */
export interface IResourceCommand {
    /**
     * @description 公开 operation 的 capability 名称。
     */
    readonly name: string;
    /**
     * @description 与当前隔离命名空间绑定的参数。
     */
    readonly input: Readonly<Record<string, unknown>>;
    /**
     * @description 是否走既有写审批，不能据此扩大资源范围。
     */
    readonly write: boolean;
    /**
     * @description 删除或覆盖等破坏性命令。
     */
    readonly destructive: boolean;
}

/**
 * @description 一个 manifest 用例的装配、执行和语义后验计划。
 */
export interface IResourceCasePlan {
    /**
     * @description 原 manifest 用例 ID。
     */
    readonly caseId: string;
    /**
     * @description manifest action。
     */
    readonly action: string;
    /**
     * @description 用例准备命令，准备失败不执行业务操作。
     */
    readonly setup: readonly IResourceCommand[];
    /**
     * @description 业务操作命令。
     */
    readonly command: IResourceCommand;
    /**
     * @description 成功业务操作后的明确公共命令，如有界 commit；拒绝操作不得附带写入。
     */
    readonly afterCommands?: readonly IResourceCommand[];
    /**
     * @description 操作前被测源路径。
     */
    readonly beforePath: string;
    /**
     * @description 操作后目的路径；删除仍查询原路径。
     */
    readonly afterPath: string;
    /**
     * @description JSON Pointer → 应读回的语义值。
     */
    readonly expectedSemantic: Readonly<Record<string, unknown>>;
    /**
     * @description 非法字段和只读写入必须以拒绝验收。
     */
    readonly expectedRejection: boolean;
    /**
     * @description 本字段的精确拒绝码；不能把授权失败或网络错误当非法值拒绝。
     */
    readonly rejectionCodes: readonly string[];
}

/**
 * @description 当前 tree 与指定 Creator 版本的一次资源计划。
 */
export interface IResourceCampaignPlan {
    /**
     * @description 精确版本，不合并两版结果。
     */
    readonly creatorVersion: '3.8.3' | '3.8.7';
    /**
     * @description 独立重算 inventory 摘要。
     */
    readonly inventorySha256: string;
    /**
     * @description 当前任务唯一的 assets 子目录。
     */
    readonly namespace: string;
    /**
     * @description 完整待执行用例；不能通过删除数组项缩小分母。
     */
    readonly cases: readonly IResourceCasePlan[];
}

/**
 * @description 端口回读的原生会话身份与已登记的项目绑定。
 */
export interface IResourceSessionIdentity {
    /**
     * @description 登记隔离工程的实际绝对路径。
     */
    readonly projectPath: string;
    /**
     * @description Creator 接受且已登记的工程名称。
     */
    readonly projectName: string;
    /**
     * @description 原始日志、观察与独占目录所属的唯一运行标识。
     */
    readonly runId: string;
    /**
     * @description 本任务拥有的实际 Creator 进程编号。
     */
    readonly creatorPid: number;
    /**
     * @description 进程归属记录的启动时间，防止 PID 复用。
     */
    readonly creatorStartedAt: string;
    /**
     * @description 实际 Creator 版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 已登记 owner；与任务包 owner 比较。
     */
    readonly owner: string;
    /**
     * @description 所属 change。
     */
    readonly change: string;
    /**
     * @description 当前 Host 包摘要。
     */
    readonly hostSha256: string;
    /**
     * @description 当前 Core 包摘要。
     */
    readonly coreSha256: string;
    /**
     * @description descriptor 的当前源码提交。
     */
    readonly sourceCommit: string;
}

/**
 * @description 独立可信的本次任务预期，不从 manifest 状态生成。
 */
export interface IResourceCampaignExpectation extends IResourceSessionIdentity {
    /**
     * @description 已独立审查的完整 fixture 闭包：绝对源路径与实际文件摘要。
     */
    readonly fixtureSources: Readonly<Record<string, string>>;
    /**
     * @description 当前重算的分母摘要。
     */
    readonly inventorySha256: string;
    /**
     * @description 全部 scope 用例 ID。
     */
    readonly requiredCaseIds: readonly string[];
    /**
     * @description 当前任务专用 assets 子目录。
     */
    readonly namespace: string;
}

/**
 * @description 保存成功和失败的原生用例观察，失败不删除或覆盖旧结果。
 */
export interface IResourceCaseObservation {
    /**
     * @description 被测用例 ID。
     */
    readonly caseId: string;
    /**
     * @description 业务 action。
     */
    readonly action: string;
    /**
     * @description 原生操作前读回。
     */
    readonly before: IResourceSnapshot;
    /**
     * @description 原生操作后读回。
     */
    readonly after: IResourceSnapshot;
    /**
     * @description 实际调用是否被拒绝。
     */
    readonly rejected: boolean;
    /**
     * @description 稳定失败码，禁止复制带 token 的响应或输入。
     */
    readonly failure: string | null;
    /**
     * @description 实际受管执行的 postflight 结果。
     */
    readonly postflightVerified: boolean;
    /**
     * @description 非法操作拒绝前后的源及 metadata 完整内容摘要。
     */
    readonly beforeSourceSha256: string;
    /**
     * @description 操作后的同一源及 metadata 闭包摘要。
     */
    readonly afterSourceSha256: string;
    /**
     * @description copy 后的原源独立读回，不能仅使用操作前缓存。
     */
    readonly preservedSource: IResourceSnapshot | null;
    /**
     * @description copy 后原源闭包摘要。
     */
    readonly preservedSourceSha256: string | null;
    /**
     * @description move/rename 后旧路径的文件及 AssetDB 查询。
     */
    readonly obsoletePath: IResourceSnapshot | null;
}

/**
 * @description 实际受管调用的结构化结论，不包含审批凭据。
 */
export interface IResourceCallOutcome {
    /**
     * @description 成功执行或在写入前拒绝。
     */
    readonly status: 'succeeded' | 'rejected';
    /**
     * @description 原生稳定拒绝码；正常成功为空。
     */
    readonly rejectionCode: string | null;
    /**
     * @description 写 operation 的实际 postflight 已完成。
     */
    readonly postflightVerified: boolean;
}

/**
 * @description runner 的原生读取端口；测试替身不构成 Creator 实机证据。
 */
export interface IResourceCampaignPort {
    /**
     * @description 操作前重新读取 approved fixture 的实际磁盘摘要，变化时停止导入。
     */
    fixtureSourceSha256(absolutePath: string): Promise<string>;
    /**
     * @description 从 registry、当前 descriptor、Host/Core 和版本重新核对身份，失败发生在写入前。
     */
    preflight(): Promise<IResourceSessionIdentity>;
    /**
     * @description 通过现有受管审批/执行入口执行命令，不重放不确定写入。
     * 每个 Bridge 请求重新读取 descriptor、token 和端口；不能缓存前一次凭据。
     */
    call(command: IResourceCommand, namespace: string): Promise<IResourceCallOutcome>;
    /**
     * @description 同时读源 metadata、AssetDB、引用和原生 Inspector。
     */
    snapshot(relativePath: string): Promise<IResourceSnapshot>;
    /**
     * @description 非法操作窗口的全文件摘要基线与读回。
     */
    sourceHashes(relativePath: string): Promise<string>;
    /**
     * @description 在下一步或失败退出前追加保存本次观察；不得覆盖旧运行证据。
     */
    recordObservation(observation: IResourceCaseObservation): Promise<void>;
    /**
     * @description 捕获读回不完整或传输失败；状态未知时保留独立失败记录。
     */
    recordFailure(caseId: string, code: string): Promise<void>;
}
