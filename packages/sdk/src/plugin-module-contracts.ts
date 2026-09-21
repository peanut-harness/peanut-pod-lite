import type {
  ContractPayload,
  ICreatorVersionInfo,
  ICommandContribution,
  IDiagnosticsContribution,
  IGrantedPermissionSet,
  IMenuContribution,
  IMcpCapabilityDefinition,
  IPanelBridgeClient,
  IPanelBridgeEnvelope,
  IPanelBridgeMessageHandler,
  IPanelContribution,
  IPanelBridgeRequestHandler,
  IPluginManifest,
  IPluginRuntimeMeta,
  ITaskBatchReceipt,
  ITaskCancelResult,
  ITaskEvidenceEntry,
  ITaskOwner,
  ITaskReceipt,
  ITaskRequest,
  ITaskResult,
  ITaskSnapshot,
  PanelId,
  PluginDeactivateReason,
  PluginId,
  TaskId,
  TaskMergePolicy,
} from "@peanut/pod-protocol";

/**
 * @description 由宿主补充插件身份的受管任务入队请求。
 */
export type PluginManagedTaskRequest = Omit<ITaskRequest, "pluginId">;

/**
 * @description 受管任务 executor 的宿主注入上下文。
 */
export interface IPluginTaskExecutorContext {
  /**
   * @description 任务受理时固定的 owner，不能由业务输入覆盖。
   */
  readonly owner: ITaskOwner;
  /**
   * @description 可中止步骤使用的受控信号，不强制中断不可逆 commit。
   */
  readonly signal: AbortSignal;
  /**
   * @description 资源等待完成后进入不可逆 commit；任务已取消或超时时返回 false。
   */
  enterCommitWindow(): boolean;
  /**
   * @description 记录经过 allow-list 筛选的任务证据。
   */
  recordEvidence(evidence: ITaskEvidenceEntry): void;
}

/**
 * @description 插件注册的受管任务 executor。
 */
export type PluginTaskExecutor = (
  request: Readonly<ITaskRequest>,
  context: IPluginTaskExecutorContext,
) => Promise<unknown>;

/**
 * @description 同一 Runtime 提交窗口内的插件批次 executor。
 */
export type PluginTaskBatchExecutor = (
  requests: readonly Readonly<ITaskRequest>[],
  contexts: readonly IPluginTaskExecutorContext[],
  batchId: string,
  mergePolicy: TaskMergePolicy,
) => Promise<readonly unknown[]>;

/**
 * @description 插件 executor 的宿主调度声明。
 */
export interface IPluginTaskExecutorOptions {
  /**
   * @description executor 是否自行使用资源锁管理并发。
   */
  readonly concurrency?: "runtime_serial" | "executor_managed";
  /**
   * @description 可选批次执行入口；缺失时 Runtime 保守地逐项顺序执行。
   */
  readonly executeBatch?: PluginTaskBatchExecutor;
}

/**
 * @description 新受管任务控制面 API；旧任务 API 继续保持原有方法。
 */
export interface IPluginManagedTaskApi {
  /**
   * @description 为当前插件注册 task kind executor；停用时宿主自动撤销。
   * @param kind 当前插件命名空间内的稳定任务种类。
   * @param executor 由宿主注入 owner 后调用的任务执行器。
   * @returns 可供插件提前撤销 executor 的清理函数。
   */
  registerExecutor(kind: string, executor: PluginTaskExecutor, options?: IPluginTaskExecutorOptions): () => void;

  /**
   * @description 显式将任务送入受管控制面；插件身份由宿主注入。
   * @param request 不允许携带 pluginId 或 owner 的任务请求。
   * @returns 任务受理回执。
   */
  enqueue(request: PluginManagedTaskRequest, invocation?: IMcpCapabilityInvocation): Promise<ITaskReceipt>;

  /**
   * @description 在所有宿主预检完成后原子受理一个 owner-safe 批次。
   */
  enqueueBatch(
    requests: readonly PluginManagedTaskRequest[],
    invocations?: readonly IMcpCapabilityInvocation[],
  ): Promise<ITaskBatchReceipt>;

  /**
   * @description 等待任务进入终态并读取结果。
   * @param taskId 当前插件拥有的任务标识。
   * @returns 终态任务结果；任务不存在或不属于当前插件时返回 null。
   */
  wait<TData = ContractPayload>(taskId: TaskId): Promise<ITaskResult<TData> | null>;
}

/**
 * @description MCP capability 处理器；由业务插件在激活期注册。
 * @param input 已校验的 capability 输入。
 * @param invocation 调用上下文。
 * @returns capability 结构化结果。
 */
export type McpCapabilityHandler = (
  input: Record<string, unknown>,
  invocation: IMcpCapabilityInvocation,
) => Promise<unknown>;

/**
 * @description capability 向 MCP Client 报告的单次执行进度。
 */
export interface IMcpCapabilityProgress {
  /**
   * @description 已完成的工作量，必须为非负有限数。
   */
  readonly progress: number;
  /**
   * @description 总工作量；省略时 Client 仅展示当前进度。
   */
  readonly total?: number;
  /**
   * @description 可安全展示给 Client 的阶段说明。
   */
  readonly message?: string;
}

/**
 * @description 子插件能力执行上下文，由统一 Hub 注入调用关联信息。
 */
export interface IMcpCapabilityInvocation {
  /**
   * @description 当前 MCP bridge 连接的瞬时标识；插件互调为 `plugin:` + 调用方插件 id。
   */
  readonly connectionId: string;
  /**
   * @description 插件互调时由宿主注入的调用方插件 id；Hub 调用不填。
   */
  readonly callerPluginId?: string;
  /**
   * @description bridge 或 Hub 已取消当前调用时触发的信号。
   */
  readonly signal?: AbortSignal;
  /**
   * @description 向已声明 progressToken 的 MCP Client 发送执行进度。
   */
  readonly reportProgress?: (progress: IMcpCapabilityProgress) => void;
  /**
   * @description Hub 根据已注册 capability 与已校验输入计算的真实风险；插件互调时不提供。
   */
  readonly risk?: "read" | "write" | "destructive";
  /**
   * @description Hub 从已校验输入提取的本机资源标识；仅在 Hub 调用时提供。
   */
  readonly resourceIds?: readonly string[];
  /**
   * @description 写/破坏性调用是否已由 Hub 的本地审批租约覆盖；仅在 Hub 调用时提供。
   */
  readonly hasLocalApproval?: boolean;
}

/**
 * @description 插件消息能力客户端。
 */
export interface IMessageClient {
  send(target: string, message: string, ...args: unknown[]): Promise<void>;
  request<TData = unknown>(
    target: string,
    message: string,
    ...args: unknown[]
  ): Promise<TData>;
  broadcast(message: string, ...args: unknown[]): Promise<void>;
}

/**
 * @description 插件资源只读能力客户端。
 */
export interface IAssetReadClient {
  /**
   * @description 查询资源数据库中的对象。
   * @param pathOrUuid 资源路径或 uuid
   * @returns Promise 返回查询结果；未命中时返回 `null`
   */
  query(pathOrUuid: string): Promise<unknown | null>;

  /**
   * @description 按 pattern 批量查询资源快照（含子资源），用一次 query-assets 往返替代多次 query-asset-info。
   * @param options 可选 pattern（限定在输出目录的 db 路径）与 importer 过滤。
   * @returns 资源快照列表；宿主不支持时返回空数组。
   */
  queryAssets(options?: {
    readonly pattern?: string;
    readonly importer?: string | readonly string[];
  }): Promise<readonly IAssetReadAssetSnapshot[]>;
}

/**
 * @description 批量资源查询返回的单个资源快照（归一化后，含子资源 UUID）。
 */
export interface IAssetReadAssetSnapshot {
  /**
   * @description 资源 UUID（子资源形如 imageUuid 加 @f9941 后缀）。
   */
  readonly uuid: string;
  /**
   * @description 项目相对路径（assets 开头）。
   */
  readonly path: string;
  /**
   * @description importer 名。
   */
  readonly importer: string;
  /**
   * @description 显示或文件名。
   */
  readonly name: string;
  /**
   * @description 子资源；键为 class id（如 f9941），值为子资源快照。
   */
  readonly subAssets?: Readonly<Record<string, IAssetReadAssetSubSnapshot>>;
}

/**
 * @description 批量资源查询返回的子资源快照。
 */
export interface IAssetReadAssetSubSnapshot {
  /**
   * @description 子资源 UUID（如 imageUuid 加 @f9941 后缀）。
   */
  readonly uuid: string;
  /**
   * @description 子资源 importer 名。
   */
  readonly importer: string;
  /**
   * @description 子资源显示名（如 spriteFrame）。
   */
  readonly name: string;
}

/**
 * @description 插件可用的本地资产目录快查客户端（扫 meta / 可选 AssetDB 重建后的产品索引）。
 */
export interface IAssetCatalogAssetDbSnapshot {
  readonly uuid: string;
  readonly importer: string;
  readonly name: string;
  readonly url: string;
  readonly isDirectory?: boolean;
  readonly isBundle?: boolean;
  readonly subAssets?: Readonly<Record<string, IAssetCatalogAssetDbSnapshot>>;
}

export type AssetCatalogBucket =
  | 'script'
  | 'image'
  | 'spriteFrame'
  | 'texture'
  | 'prefab'
  | 'scene'
  | 'config'
  | 'audio'
  | 'video'
  | 'spine'
  | 'dragonBones'
  | 'cubeMap'
  | 'tiledMap'
  | 'particle'
  | 'spriteAtlas'
  | 'autoAtlas'
  | 'font'
  | 'directory'
  | 'material'
  | 'animationClip'
  | 'animationGraph'
  | 'physicsMaterial'
  | 'terrain'
  | 'effect'
  | 'model'
  | 'mesh'
  | 'renderTexture'
  | 'renderPipeline'
  | 'renderFlow'
  | 'renderStage'
  | 'buffer'
  | 'other';

export interface IAssetCatalogClient {
  summary(projectRoot: string, cwd?: string): {
    readonly generatedAt: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly conflictCount: number;
  };
  lookup(
    projectRoot: string,
    input: {
      readonly uuid?: string;
      readonly type?: AssetCatalogBucket | string;
      readonly name?: string;
      readonly path?: string;
      readonly limit?: number;
    },
    cwd?: string,
  ): {
    readonly count: number;
    readonly hits: readonly {
      readonly type: AssetCatalogBucket;
      readonly path: string;
      readonly uuid: string;
      readonly compressedUuid: string;
      readonly name: string;
    }[];
  };
  refresh(projectRoot: string, cwd?: string): {
    readonly summaryPath: string;
    readonly generatedAt: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly conflictCount: number;
  };
  refreshPreferringAssetDb(
    projectRoot: string,
    cwd?: string,
    assetDb?: {
      queryAssets(options?: {
        readonly pattern?: string;
        readonly importer?: string | readonly string[];
      }): Promise<readonly IAssetCatalogAssetDbSnapshot[]>;
    },
  ): Promise<{
    readonly summaryPath: string;
    readonly generatedAt: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly conflictCount: number;
    readonly source: 'asset-db' | 'meta';
  }>;
}

export interface IPluginCacheEntry {
  readonly relativePath: string;
  readonly kind: "file" | "directory";
  readonly size: number;
}

/**
 * @description 插件可用的受限资源写入客户端。
 */
export interface IAssetWriteClient {
  /**
   * @description 将 Cocos Prefab 序列化内容写入已验证的项目相对路径。
   * @param relativePath 项目相对 `.prefab` 路径
   * @param prefab Cocos Prefab 序列化数组
   * @returns 写入后的资源快照
   */
  writePrefab(
    relativePath: string,
    prefab: readonly Record<string, unknown>[],
  ): Promise<unknown>;
  /**
   * @description 写入受支持的图片、JSON 或字体资源；路径必须由宿主校验为项目相对 assets 路径。
   */
  writeBinary(
    relativePath: string,
    content: Uint8Array,
    mediaType:
      | "image/png"
      | "image/svg+xml"
      | "application/json"
      | "font/ttf"
      | "font/otf",
  ): Promise<unknown>;
  /**
   * @description 通知 AssetDB 重新导入磁盘上已存在的资源（例如 SnowB 直写的 `.fnt` / `.png`）。
   * @param relativePath 项目相对 `assets/` 路径
   * @returns 刷新后的资源快照；宿主不可用或尚未索引时返回 `null`
   */
  refresh(relativePath: string): Promise<unknown | null>;
}

/**
 * @description 插件可用的受限资源删除客户端。
 */
export interface IAssetDeleteClient {
  /**
   * @description 删除已验证的项目相对资源路径。
   */
  deleteAsset(relativePath: string): Promise<void>;
}

/**
 * @description Creator 版本只读客户端。
 */
export interface ICreatorVersionClient {
  /**
   * @description 返回当前宿主绑定的 Creator 版本信息。
   * @returns 标准化的 Creator 版本信息
   */
  getCurrentVersion(): ICreatorVersionInfo;
}

/**
 * @description 插件场景能力客户端。
 */
export interface ISceneClient {
  /**
   * @description 返回当前版本场景脚本字段名。
   * @returns 当前版本使用的场景脚本字段名
   */
  getManifestField(): "scene-script" | "contributions.scene.script";

  /**
   * @description 返回当前场景根节点快照。
   * @returns 当前场景根节点快照；尚未加载场景时返回 `null`
   */
  getCurrent(): Promise<Record<string, unknown> | null>;

  /**
   * @description 返回当前场景节点快照列表。
   * @param options 可选层次选项。
   * @returns 场景树节点快照列表
   */
  getHierarchy(options?: {
    includeEditorNodes?: boolean;
  }): Promise<readonly Record<string, unknown>[]>;

  /**
   * @description 执行指定插件暴露的场景脚本方法。
   * @param packageName 插件包名
   * @param method 场景脚本方法名
   * @param args 传给场景脚本方法的参数列表
   * @returns Promise 返回脚本执行结果
   */
  execute<TData = unknown>(
    packageName: string,
    method: string,
    args?: readonly unknown[],
  ): Promise<TData>;
}

/**
 * @description 插件选择集能力客户端。
 */
export interface ISelectionClient {
  /**
   * @description 返回当前激活的选择标识列表。
   * @returns Promise 返回当前选择标识列表
   */
  getActiveIds(): Promise<readonly string[]>;

  /**
   * @description 设置当前激活的选择标识列表（路径或 uuid，由宿主解析）。
   * @param selectionIds 选择标识列表；空数组表示清空。
   * @returns Promise
   */
  setActiveIds(selectionIds: readonly string[]): Promise<void>;
}

/**
 * @description 插件项目只读能力客户端。
 */
export interface IProjectReadClient {
  /**
   * @description 返回当前项目根目录。
   * @returns Promise 返回项目根目录；未知时返回 `null`
   */
  getProjectPath(): Promise<string | null>;

  /**
   * @description 返回当前项目显示名称。
   * @returns Promise 返回项目显示名称；未知时返回 `null`
   */
  getProjectName(): Promise<string | null>;
}

/**
 * @description 宿主 Canvas 能力返回的只读图像句柄。
 */
export interface ICanvasImage {
  /**
   * @description 图像像素宽度。
   */
  readonly width: number;
  /**
   * @description 图像像素高度。
   */
  readonly height: number;
}

/**
 * @description Canvas 像素缓冲区的受控视图。
 */
export interface ICanvasImageData {
  /**
   * @description 像素缓冲区宽度。
   */
  readonly width: number;
  /**
   * @description 像素缓冲区高度。
   */
  readonly height: number;
  /**
   * @description RGBA 像素数据。
   */
  readonly data: Uint8ClampedArray;
}

/**
 * @description 宿主 Canvas 能力返回的 2D 绘制上下文。
 */
export interface ICanvasContext2D {
  /**
   * @description 将图像绘制到目标画布。
   * @param image 由同一 Canvas capability 创建或加载的图像
   * @param dx 目标 x 坐标，单位为像素
   * @param dy 目标 y 坐标，单位为像素
   * @returns 无返回值
   */
  drawImage(image: ICanvasImage, dx: number, dy: number): void;
  /**
   * @description 创建指定尺寸的 RGBA 像素缓冲区。
   * @param width 像素缓冲区宽度
   * @param height 像素缓冲区高度
   * @returns 可写入的像素缓冲区
   */
  createImageData(width: number, height: number): ICanvasImageData;
  /**
   * @description 将 RGBA 像素缓冲区写入画布。
   * @param imageData 待写入的像素缓冲区
   * @param dx 目标 x 坐标，单位为像素
   * @param dy 目标 y 坐标，单位为像素
   * @returns 无返回值
   */
  putImageData(imageData: ICanvasImageData, dx: number, dy: number): void;
}

/**
 * @description 宿主 Canvas 能力返回的可编码画布句柄。
 */
export interface ICanvasSurface {
  /**
   * @description 画布像素宽度。
   */
  readonly width: number;
  /**
   * @description 画布像素高度。
   */
  readonly height: number;
  /**
   * @description 获取唯一支持的 2D 绘制上下文。
   * @returns 受控 2D 绘制上下文
   */
  getContext2D(): ICanvasContext2D;
  /**
   * @description 重设画布像素尺寸并清空当前内容。
   * @param width 新画布宽度，单位为像素
   * @param height 新画布高度，单位为像素
   * @returns 无返回值
   */
  resize(width: number, height: number): void;
  /**
   * @description 将当前画布编码为 PNG 二进制。
   * @returns PNG 文件字节
   */
  toPng(): Uint8Array;
}

/**
 * @description Canvas 原生 capability 对插件开放的受控服务。
 */
export interface ICanvasService {
  /**
   * @description 创建指定像素尺寸的离屏 2D 画布。
   * @param width 画布宽度，单位为像素
   * @param height 画布高度，单位为像素
   * @returns 可绘制并导出的画布句柄
   */
  createSurface(width: number, height: number): ICanvasSurface;
  /**
   * @description 从二进制内容加载图像。
   * @param source 图像文件字节
   * @returns Promise 返回可绘制图像句柄
   */
  loadImage(source: Uint8Array): Promise<ICanvasImage>;
}

/**
 * @description 插件激活期可用的受控原生 capability 集合。
 */
export interface INativeCapabilityClientSet {
  /**
   * @description Canvas 1.x 原生绘制能力；未授权或不可用时为 `undefined`。
   */
  readonly canvas?: ICanvasService;
}

/**
 * @description 设计来源 capability 的稳定标识。
 */
export type DesignSourceCapabilityId = string;

/**
 * @description 由宿主注册并注入插件的设计来源只读状态；不包含令牌、路径或客户端对象。
 */
export interface IDesignSourceCapabilityDescriptor {
  /**
   * @description 设计来源稳定标识。
   */
  readonly id: DesignSourceCapabilityId;
  /**
   * @description 实现该 design-supporter 契约的安装包插件标识。
   */
  readonly providerPluginId?: string;
  /**
   * @description 工作台显示用名称；缺失时回退为 id。
   */
  readonly displayName?: string;
  /**
   * @description 当前宿主是否允许插件使用此来源。
   */
  readonly available: boolean;
  /**
   * @description 已解析 provider 的可选版本。
   */
  readonly version?: string;
  /**
   * @description 不可用时的稳定原因码。
   */
  readonly reason?: string;
}

/**
 * @description 受控网络请求输入；仅支持当前 Provider 所需的只读 GET 请求。
 */
export interface IPluginNetworkRequest {
  /**
   * @description 目标绝对 URL，宿主按 manifest `network.domains` 校验。
   */
  readonly url: string;
  /**
   * @description 当前请求的临时 header；调用结束后宿主不保留。
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * @description 受控网络响应最小视图。
 */
export interface IPluginNetworkResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * @description 宿主授权的只读网络 capability。
 */
export interface IPluginNetworkClient {
  fetch(request: IPluginNetworkRequest): Promise<IPluginNetworkResponse>;
}

/**
 * @description 插件激活后可用的 runtime client 集合。
 */
export interface IGrantedRuntimeClientSet {
  /**
   * @description Creator 版本只读客户端。
   */
  readonly version: ICreatorVersionClient;

  /**
   * @description Message 子域客户端。
   */
  readonly message?: IMessageClient;

  /**
   * @description Asset 子域只读客户端。
   */
  readonly assetRead?: IAssetReadClient;
  /**
   * @description 本地资产目录快查客户端；随 assetDb.read 默认注入。
   */
  readonly assetCatalog?: IAssetCatalogClient;
  /**
   * @description 资源写入客户端；未授权时为 `undefined`。
   */
  readonly assetWrite?: IAssetWriteClient;
  /**
   * @description 资源删除客户端；仅在 AssetDB delete 被单独授权时可用。
   */
  readonly assetDelete?: IAssetDeleteClient;

  /**
   * @description Scene 子域客户端。
   */
  readonly scene?: ISceneClient;

  /**
   * @description Selection 子域只读客户端。
   */
  readonly selection?: ISelectionClient;

  /**
   * @description Project 子域只读客户端。
   */
  readonly projectRead?: IProjectReadClient;

  /**
   * @description 由宿主 capability registry 过滤后注入的设计来源状态。
   */
  readonly designSources: readonly IDesignSourceCapabilityDescriptor[];

  /**
   * @description 只读网络 client；未声明或未授予 `network` 权限时为 `undefined`。
   */
  readonly network?: IPluginNetworkClient;

  /**
   * @description 原生 capability 服务；服务会在插件 lease 失效后拒绝调用。
   */
  readonly native: INativeCapabilityClientSet;
}

/**
 * @description 插件日志接口。
 */
export interface IPluginLogger {
  /**
   * @description 记录普通日志。
   * @param message 日志消息
   * @param extra 附加上下文
   * @returns 无返回值
   */
  info(message: string, extra?: ContractPayload): void;

  /**
   * @description 记录告警日志。
   * @param message 告警消息
   * @param extra 附加上下文
   * @returns 无返回值
   */
  warn(message: string, extra?: ContractPayload): void;

  /**
   * @description 记录错误日志。
   * @param message 错误消息
   * @param extra 附加上下文
   * @returns 无返回值
   */
  error(message: string, extra?: ContractPayload): void;
}

/**
 * @description 插件事件总线接口。
 */
export interface IPluginEventBus {
  /**
   * @description 发布一个插件域事件。
   * @param event 事件名称
   * @param payload 事件载荷
   * @returns Promise 在事件分发完成后结束
   */
  publish(event: string, payload?: ContractPayload): Promise<void>;

  /**
   * @description 订阅一个插件域事件。
   * @param event 事件名称
   * @param listener 事件监听器
   * @returns 取消订阅函数
   */
  subscribe(
    event: string,
    listener: (payload?: ContractPayload) => void | Promise<void>,
  ): () => void;
}

/**
 * @description 插件私有存储接口。
 */
export interface IPluginStorageApi {
  /**
   * @description 读取一个插件私有存储值。
   * @param key 存储键
   * @returns Promise 返回已存储值；未命中时返回 `null`
   */
  get<TValue = unknown>(key: string): Promise<TValue | null>;

  /**
   * @description 写入一个插件私有存储值。
   * @param key 存储键
   * @param value 要存储的值
   * @returns Promise 在写入结束后完成
   */
  set<TValue = unknown>(key: string, value: TValue): Promise<void>;

  /**
   * @description 删除一个插件私有存储值。
   * @param key 存储键
   * @returns Promise 在删除结束后完成
   */
  delete(key: string): Promise<void>;
}

/**
 * @description 由宿主安全存储支持的插件级 HMAC 密钥访问接口。
 * 普通插件存储、日志、目录包清单均不得保存或返回该密钥材料。
 */
export interface IPluginProtectedKeyApi {
  /**
   * @description 返回当前插件和逻辑用途专属的不可导出 HMAC-SHA-256 密钥；不存在时由宿主安全生成并持久化。
   * @param purpose 受限逻辑用途标识，例如 `mcp-plan-digest-v1`。
   * @returns 仅可用于 WebCrypto 签名的不可导出密钥。
   */
  getOrCreateHmacSha256Key(purpose: string): Promise<CryptoKey>;
}

/**
 * @description 插件面板辅助接口。
 */
export interface IPluginPanelApi {
  /**
   * @description 打开插件声明的一个面板。
   * @param panelId 面板稳定标识
   * @returns Promise 在打开动作完成后结束
   */
  open(panelId: PanelId): Promise<void>;

  /**
   * @description 关闭插件声明的一个面板。
   * @param panelId 面板稳定标识
   * @returns Promise 在关闭动作完成后结束
   */
  close(panelId: PanelId): Promise<void>;

  /**
   * @description 聚焦插件声明的一个面板。
   * @param panelId 面板稳定标识
   * @returns Promise 在聚焦动作完成后结束
   */
  focus(panelId: PanelId): Promise<void>;

  /**
   * @description 向指定面板前端推送一条宿主托管消息。
   * @param panelId 面板稳定标识
   * @param envelope 面板桥消息信封
   * @returns Promise 在消息广播完成后结束
   */
  notify<TPayload extends ContractPayload = ContractPayload>(
    panelId: PanelId,
    envelope: IPanelBridgeEnvelope<TPayload>,
  ): Promise<void>;

  /**
   * @description 为指定面板注册一个单向消息处理器。
   * @param panelId 面板稳定标识
   * @param event 事件名称
   * @param handler 单向消息处理器
   * @returns 稳定 lease 标识
   */
  onMessage<TPayload extends ContractPayload = ContractPayload>(
    panelId: PanelId,
    event: string,
    handler: IPanelBridgeMessageHandler<TPayload>,
  ): string;

  /**
   * @description 为指定面板注册一个请求处理器。
   * @param panelId 面板稳定标识
   * @param event 事件名称
   * @param handler 请求处理器
   * @returns 稳定 lease 标识
   */
  onRequest<
    TPayload extends ContractPayload = ContractPayload,
    TResponse extends ContractPayload = ContractPayload,
  >(
    panelId: PanelId,
    event: string,
    handler: IPanelBridgeRequestHandler<TPayload, TResponse>,
  ): string;
}

/**
 * @description 已激活插件之间的受管请求/响应服务 API。
 */
export interface IPluginServiceApi {
  /**
   * @description 注册当前插件提供的服务；停用时宿主会自动撤销。
   */
  register(
    serviceId: string,
    handler: (callerPluginId: string, request: unknown) => Promise<unknown>,
  ): () => void;

  /**
   * @description 请求其他已激活插件公开的服务。
   */
  request<TResponse = unknown>(
    providerPluginId: string,
    serviceId: string,
    request: unknown,
  ): Promise<TResponse>;
}

/**
 * @description 插件激活期可用的统一 MCP capability 注册 API。
 */
export interface IPluginMcpApi {
  /**
   * @description 注册当前插件对外共享的 MCP capability；停用时宿主自动撤销。
   * @param definition 带 schema 与风险等级的公开定义。
   * @param handler 已验证输入的异步处理函数。
   * @returns 可供插件提前撤销 capability 的清理函数。
   */
  register(
    definition: IMcpCapabilityDefinition,
    handler: McpCapabilityHandler,
  ): () => void;

  /**
   * @description 按全局工具名调用任意已激活插件已注册的 MCP capability。
   * @param name 如 `peanut.editor-mcp.lumen-compile-recipe`
   * @param input 未受信输入；由 registry 按该工具 inputSchema 校验
   * @returns capability 结构化结果；不受 Hub 公开级别与写操作 plan 约束
   */
  invoke(name: string, input: unknown): Promise<unknown>;
}

/**
 * @description 插件受限文件存储 API；宿主会将调用方绑定到其自身缓存和配置范围。
 */
export interface IPluginFileStorageApi {
  /**
   * @description 返回 cache scope 内逻辑路径的宿主描述路径。
   */
  describe(scope: "cache", relativePath?: string): Promise<string>;
  /**
   * @description 在 cache scope 内创建目录。
   */
  mkdir(scope: "cache", relativePath: string): Promise<void>;
  /**
   * @description 从 cache scope 内读取二进制文件。
   */
  read(scope: "cache", relativePath: string): Promise<Uint8Array | null>;
  /**
   * @description 向 cache scope 内原子写入二进制文件。
   */
  write(
    scope: "cache",
    relativePath: string,
    content: Uint8Array,
  ): Promise<void>;
  /**
   * @description 列出 cache scope 内条目。
   */
  list(
    scope: "cache",
    relativePath?: string,
  ): Promise<readonly IPluginCacheEntry[]>;
  /**
   * @description 删除 cache scope 内文件或目录。
   */
  remove(scope: "cache", relativePath: string): Promise<boolean>;
  /**
   * @description 读取当前插件 local settings。
   */
  getLocalSettings(): Promise<Readonly<Record<string, unknown>>>;
  /**
   * @description 原子替换当前插件 local settings。
   */
  setLocalSettings(settings: Readonly<Record<string, unknown>>): Promise<void>;
  /**
   * @description 深层合并当前插件 local settings，`null` 删除字段。
   */
  mergeLocalSettings(
    patch: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

/**
 * @description 插件任务辅助接口。
 */
export interface IPluginTaskApi {
  /**
   * @description 新受管任务 API；旧宿主可省略，调用方必须先检测可用性。
   */
  readonly managed?: IPluginManagedTaskApi;

  /**
   * @description 提交一个插件任务请求。
   * @param request 任务请求；其中 `pluginId` 将被忽略并替换为当前插件标识
   * @returns Promise 返回任务受理回执
   */
  submit(request: Omit<ITaskRequest, "pluginId">): Promise<ITaskReceipt>;

  /**
   * @description 批量提交多个插件任务请求。
   * @param requests 任务请求列表；每个请求的 `pluginId` 都会被替换为当前插件标识
   * @returns Promise 返回批量受理回执
   */
  submitBatch(
    requests: readonly Omit<ITaskRequest, "pluginId">[],
  ): Promise<ITaskBatchReceipt>;

  /**
   * @description 查询一个当前插件拥有的任务。
   * @param taskId 任务标识
   * @returns Promise 命中时返回任务快照，否则返回 `null`
   */
  query(taskId: TaskId): Promise<ITaskSnapshot | null>;

  /**
   * @description 查询一个当前插件拥有任务的最终结果。
   * @param taskId 任务标识
   * @returns Promise 命中时返回任务结果，否则返回 `null`
   */
  getResult(taskId: TaskId): Promise<ITaskResult | null>;

  /**
   * @description 取消一个当前插件拥有的任务。
   * @param taskId 任务标识
   * @returns Promise 返回取消结果
   */
  cancel(taskId: TaskId): Promise<ITaskCancelResult>;
}

/**
 * @description 插件注册期可用的 API。
 */
export interface IPluginRegistrationApi {
  /**
   * @description 注册一个命令贡献。
   * @param command 命令贡献定义
   * @returns 稳定 lease 标识
   */
  registerCommand(command: ICommandContribution): string;

  /**
   * @description 注册一个菜单贡献。
   * @param menu 菜单贡献定义
   * @returns 稳定 lease 标识
   */
  registerMenu(menu: IMenuContribution): string;

  /**
   * @description 注册一个面板贡献。
   * @param panel 面板贡献定义
   * @returns 稳定 lease 标识
   */
  registerPanel(panel: IPanelContribution): string;

  /**
   * @description 注册一个诊断贡献。
   * @param diagnostics 诊断贡献定义
   * @returns 稳定 lease 标识
   */
  registerDiagnostics(diagnostics: IDiagnosticsContribution): string;

  /**
   * @description 为插件注册一个停用或卸载时执行的清理动作。
   * @param disposer 清理函数
   * @returns 稳定 lease 标识
   */
  onDispose(disposer: () => void | Promise<void>): string;
}

/**
 * @description 插件注册阶段上下文。
 */
export interface IPluginRegisterContext {
  /**
   * @description 当前插件运行时元信息。
   */
  readonly plugin: IPluginRuntimeMeta;

  /**
   * @description 当前插件被授予的权限结果。
   */
  readonly permissions: IGrantedPermissionSet;

  /**
   * @description 插件日志接口。
   */
  readonly logger: IPluginLogger;

  /**
   * @description 插件注册期 API。
   */
  readonly registry: IPluginRegistrationApi;
}

/**
 * @description 插件激活阶段上下文。
 */
export interface IPluginActivateContext {
  /**
   * @description 当前插件运行时元信息。
   */
  readonly plugin: IPluginRuntimeMeta;

  /**
   * @description 当前插件被授予的权限结果。
   */
  readonly permissions: IGrantedPermissionSet;

  /**
   * @description 插件日志接口。
   */
  readonly logger: IPluginLogger;

  /**
   * @description 经宿主裁剪后的 runtime client 集合。
   */
  readonly runtime: IGrantedRuntimeClientSet;

  /**
   * @description 插件面板辅助接口。
   */
  readonly panels: IPluginPanelApi;

  /**
   * @description 插件间服务调用能力。
   */
  readonly services: IPluginServiceApi;

  /**
   * @description 统一 MCP capability 注册入口；不暴露监听端口或协议处理权。
   */
  readonly mcp: IPluginMcpApi;

  /**
   * @description 插件任务辅助接口。
   */
  readonly tasks: IPluginTaskApi;

  /**
   * @description 插件事件总线。
   */
  readonly events: IPluginEventBus;

  /**
   * @description 插件私有存储。
   */
  readonly storage: IPluginStorageApi;

  /**
   * @description 宿主注入的受保护密钥接口；未提供时相关高级能力必须拒绝激活。
   */
  readonly protectedKeys?: IPluginProtectedKeyApi;

  /**
   * @description 宿主管理的当前插件缓存与持久化 JSON 配置。
   */
  readonly files: IPluginFileStorageApi;
}

/**
 * @description 插件模块入口协议。
 */
export interface IPluginModule {
  /**
   * @description 插件运行时清单。
   */
  readonly manifest: IPluginManifest;

  /**
   * @description 在注册阶段声明插件贡献和清理动作。
   * @param context 插件注册阶段上下文
   * @returns Promise 在注册阶段结束后完成
   */
  register(context: IPluginRegisterContext): void | Promise<void>;

  /**
   * @description 在激活阶段建立连接、监听器和运行时状态。
   * @param context 插件激活阶段上下文
   * @returns Promise 在激活结束后完成
   */
  activate(context: IPluginActivateContext): void | Promise<void>;

  /**
   * @description 在停用阶段释放运行态资源。
   * @param reason 插件停用原因
   * @returns Promise 在停用结束后完成
   */
  deactivate(reason: PluginDeactivateReason): void | Promise<void>;

  /**
   * @description 在彻底释放阶段执行最终清理。
   * @returns Promise 在释放结束后完成
   */
  dispose(): void | Promise<void>;
}

/**
 * @description 插件注册输入参数。
 */
export interface IPluginRegistrationInput {
  /**
   * @description 插件运行时清单。
   */
  readonly manifest: IPluginManifest;

  /**
   * @description 插件安装目录。
   */
  readonly installPath: string;

  /**
   * @description 插件信任级别。
   */
  readonly trustLevel?: IPluginRuntimeMeta["trustLevel"];
}

/**
 * @description 面向宿主或测试场景暴露的面板桥创建接口。
 */
export interface IPanelBridgeClientFactory {
  /**
   * @description 为指定插件面板创建一个桥接客户端。
   * @param pluginId 插件标识
   * @param panelId 面板稳定标识
   * @returns 用于面板前端的桥接客户端
   */
  createPanelBridgeClient(
    pluginId: PluginId,
    panelId: PanelId,
  ): IPanelBridgeClient;
}
