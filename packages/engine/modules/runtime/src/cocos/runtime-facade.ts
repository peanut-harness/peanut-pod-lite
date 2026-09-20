import type {
  IAdapterProfile,
  ICreatorAdapter,
} from "./adapters/core/creator-adapter.js";
import type { ICocosRuntime } from "./runtime.js";

import { AdapterRegistry } from "./adapters/core/adapter-registry.js";
import {
  DefaultCreatorAdapterFactory,
  type ICreatorAdapterFactory,
  type IDefaultCreatorAdapterFactoryOptions,
} from "./adapters/default-creator-adapter-factory.js";
import { ExecutionRuntimeService } from "../execution/execution-runtime-service.js";
import { TaskIngress } from "../execution/ingress/task-ingress.js";
import { TaskLedger } from "../execution/ledger/task-ledger.js";
import { ResourceLockManager } from "../execution/locks/resource-lock-manager.js";
import { TaskMerger } from "../execution/merge/task-merger.js";
import { TaskScheduler } from "../execution/scheduler/task-scheduler.js";
import { TaskSnapshotInspector } from "../execution/snapshot/task-snapshot-inspector.js";
import { TracePipeline } from "../execution/trace/trace-pipeline.js";
import { TimeoutAndCancelController } from "../execution/timeout/timeout-and-cancel-controller.js";
import { WorkerPool } from "../execution/workers/worker-pool.js";
import { AssetRuntimeService } from "./foundation/asset/asset-runtime-service.js";
import { MessageRuntimeService } from "./foundation/message/message-runtime-service.js";
import { PanelHostRuntimeService } from "./foundation/panel-host/panel-host-runtime-service.js";
import { ProjectRuntimeService } from "./foundation/project/project-runtime-service.js";
import { SceneRuntimeService } from "./foundation/scene/scene-runtime-service.js";
import { SelectionRuntimeService } from "./foundation/selection/selection-runtime-service.js";
import { CreatorHostState } from "./shared/host-state.js";
import { VersionResolver } from "./version/version-resolver.js";
import { BatchCommitCoordinator } from "../execution/commit/batch-commit-coordinator.js";
import { RuntimeTaskCommitDispatcher } from "../execution/commit/runtime-task-commit-dispatcher.js";
import {
  BuiltInRuntimeTaskExecutors,
  RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID,
} from "../execution/commit/builtin-runtime-task-executors.js";
import { TaskExecutorRegistry } from "../execution/registry/task-executor-registry.js";

/**
 * @description Runtime 门面可选装配参数。
 */
export interface IRuntimeFacadeOptions extends IDefaultCreatorAdapterFactoryOptions {
  /**
   * @description 可替换的适配器工厂；默认使用内置版本组合根。
   */
  readonly adapterFactory?: ICreatorAdapterFactory;

  /**
   * @description 可选内存宿主初始状态；仅由显式的测试或离线模拟场景提供。
   */
  readonly initialState?: IRuntimeFacadeInitialState;
}

/**
 * @description Runtime 内存宿主的显式初始状态。
 */
export interface IRuntimeFacadeInitialState {
  /**
   * @description 初始资源条目。
   */
  readonly assets?: readonly IRuntimeFacadeInitialAsset[];

  /**
   * @description 初始场景节点条目。
   */
  readonly sceneNodes?: readonly IRuntimeFacadeInitialSceneNode[];
}

/**
 * @description Runtime 内存宿主的资源种子。
 */
export interface IRuntimeFacadeInitialAsset {
  /**
   * @description 资源路径或 uuid。
   */
  readonly pathOrUuid: string;

  /**
   * @description 资源快照。
   */
  readonly value: unknown;
}

/**
 * @description Runtime 内存宿主的场景节点种子。
 */
export interface IRuntimeFacadeInitialSceneNode {
  /**
   * @description 场景节点稳定标识。
   */
  readonly nodeId: string;

  /**
   * @description 场景节点快照。
   */
  readonly state: Readonly<Record<string, unknown>>;
}

/**
 * @description Runtime 主门面实现，负责装配版本解析器、适配器注册中心、基础子域服务和执行管线。
 */
export class RuntimeFacade implements ICocosRuntime {
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly version: VersionResolver;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly message: MessageRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly asset: AssetRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly scene: SceneRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly panelHost: PanelHostRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly selection: SelectionRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly project: ProjectRuntimeService;
  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  public readonly execution: ExecutionRuntimeService;

  /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
  private readonly _adapterRegistry: AdapterRegistry;

  /**
   * @description 创建一个新的 Runtime 门面实例。
   * @param creatorVersion 当前宿主绑定的 Creator 版本字符串
   * @param options Runtime 可选装配参数
   */
  public constructor(creatorVersion: string, options?: IRuntimeFacadeOptions) {
    this.version = new VersionResolver(creatorVersion);
    this._adapterRegistry = new AdapterRegistry();
    const creatorHostState = new CreatorHostState();
    for (const asset of options?.initialState?.assets ?? []) {
      creatorHostState.setAsset(asset.pathOrUuid, asset.value);
    }
    for (const sceneNode of options?.initialState?.sceneNodes ?? []) {
      creatorHostState.setSceneNode(sceneNode.nodeId, { ...sceneNode.state });
    }

    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const taskLedger = new TaskLedger();
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const taskScheduler = new TaskScheduler(taskLedger);
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const taskSnapshotInspector = new TaskSnapshotInspector(creatorHostState);

    this.message = new MessageRuntimeService(
      this._adapterRegistry,
      this.version,
    );
    this.asset = new AssetRuntimeService(this._adapterRegistry, this.version);
    this.scene = new SceneRuntimeService(this._adapterRegistry, this.version);
    this.panelHost = new PanelHostRuntimeService(
      this._adapterRegistry,
      this.version,
    );
    this.selection = new SelectionRuntimeService(
      this._adapterRegistry,
      this.version,
    );
    this.project = new ProjectRuntimeService(
      this._adapterRegistry,
      this.version,
    );
    const taskExecutorRegistry = new TaskExecutorRegistry();
    BuiltInRuntimeTaskExecutors.register(taskExecutorRegistry, this.asset, this.scene);
    this.execution = new ExecutionRuntimeService(
      new TaskIngress(),
      taskScheduler,
      taskLedger,
      new WorkerPool(taskSnapshotInspector),
      new TaskMerger(),
      new ResourceLockManager(),
      new BatchCommitCoordinator(
        new RuntimeTaskCommitDispatcher(taskExecutorRegistry, (task) => {
          return taskExecutorRegistry.has(task.request.pluginId, task.request.kind)
            ? task.request.pluginId
            : RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID;
        }),
        taskSnapshotInspector,
      ),
      new TracePipeline(),
      new TimeoutAndCancelController(),
      taskExecutorRegistry,
    );

    const phase = this.version.getCurrentVersion().phase;
    const adapterFactory = options?.adapterFactory ?? new DefaultCreatorAdapterFactory();
    this.registerAdapter(adapterFactory.create(creatorVersion, phase, creatorHostState, options));

    const activeAdapter = this._adapterRegistry.resolve(creatorVersion);
    if (activeAdapter == null) {
      throw new Error(`adapter_unavailable_for_phase:${phase}:${creatorVersion}`);
    }
  }

  /**
   * @description 注册一个 Creator 版本适配器。
   * @param adapter 要注册的适配器实例
   * @returns 当前 Runtime 门面实例，便于链式配置
   */
  public registerAdapter(adapter: ICreatorAdapter): RuntimeFacade {
    this._adapterRegistry.register(adapter);
    return this;
  }

  /**
   * @description 返回当前版本命中的适配器诊断快照。
   * @returns 命中时返回适配器诊断，否则返回 `null`
   */
  public getActiveAdapterProfile(): IAdapterProfile | null {
    return this._adapterRegistry.getActiveProfile(
      this.version.getCurrentVersion().raw,
    );
  }
}
