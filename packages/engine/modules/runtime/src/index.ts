export type {
  IAdapterProfile,
  IAssetBridge,
  ICreatorAdapter,
  IMessageBridge,
  IPanelBrowserWindowLike,
  IPanelHostBridge,
  IPanelHostLaunchResult,
  IPanelHostSessionSnapshot,
  ISceneBridge,
} from "./cocos/adapters/core/creator-adapter.js";
export { EditorApi38Adapter } from "./cocos/adapters/adapter-38/editor-api-38-adapter.js";
export { EditorApi38Adapter as EditorApiStableAdapter } from "./cocos/adapters/adapter-38/editor-api-38-adapter.js";
export {
  ADAPTER_24_ID,
  ADAPTER_24_PHASE,
  EditorApi24Adapter,
  EditorApi24HostAssetBridgeProvider,
} from "./cocos/adapters/adapter-24/index.js";
export type { ICreator24MessageHostGlobal } from "./cocos/adapters/adapter-24/index.js";
export {
  ADAPTER_35_ID,
  ADAPTER_35_PHASE,
  EditorApi35Adapter,
} from "./cocos/adapters/adapter-35/index.js";
export { EditorApiHostSceneBridgeProvider } from "./cocos/adapters/adapter-38/editor-api-host-scene-bridge-provider.js";
export { EditorApiHostMessageBridgeProvider } from "./cocos/adapters/shared/editor-api-host-message-bridge-provider.js";
export { EditorApiHostSelectionBridgeProvider } from "./cocos/adapters/adapter-38/editor-api-host-selection-bridge-provider.js";
export type {
  IEditorApiSceneHostGlobal,
  IEditorApiSceneNodeSnapshot,
} from "./cocos/adapters/adapter-38/editor-api-host-scene-bridge-provider.js";
export {
  EditorApiHostPanelWindowProvider,
  MissingEditorApiPanelHostError,
} from "./cocos/adapters/adapter-38/editor-api-host-panel-window-provider.js";
export { EditorApiPanelHostBridgeRegistry } from "./cocos/adapters/adapter-38/editor-api-panel-host-bridge-registry.js";
export { EditorApiPanelHostInstaller } from "./cocos/adapters/adapter-38/editor-api-panel-host-installer.js";
export { EditorApiWindowBackedPanelHostBridge } from "./cocos/adapters/adapter-38/editor-api-window-backed-panel-host-bridge.js";
export {
  DefaultEditorApiPanelWindowProvider,
  EditorApiPanelWindowLauncher,
} from "./cocos/adapters/adapter-38/editor-api-panel-window-launcher.js";
export type {
  IEditorApiPanelBrowserWindow,
  IEditorApiPanelHostMetadata,
  IEditorApiPanelWindowLaunchRequest,
  IEditorApiPanelWindowProvider,
} from "./cocos/adapters/core/editor-api-panel-window.js";
export type {
  IEditorApiPanelHostBridge,
  IEditorApiPanelHostGlobal,
} from "./cocos/adapters/core/editor-api-panel-window.js";
export type { IEditorApiHostPanelWindowProviderOptions } from "./cocos/adapters/adapter-38/editor-api-host-panel-window-provider.js";
export type {
  IEditorApiPanelWindowFactory,
  IEditorApiPanelWindowHandle,
} from "./cocos/adapters/adapter-38/editor-api-window-backed-panel-host-bridge.js";
export { AdapterRegistry } from "./cocos/adapters/core/adapter-registry.js";
export { CreatorAdapterFactoryRegistry } from "./cocos/adapters/creator-adapter-factory-registry.js";
export { DefaultCreatorAdapterFactory } from "./cocos/adapters/default-creator-adapter-factory.js";
export type {
  ICreatorAdapterFactory,
  ICreatorPhaseAdapterFactory,
  IDefaultCreatorAdapterFactoryOptions,
} from "./cocos/adapters/default-creator-adapter-factory.js";
export { BaseCreatorAdapter } from "./cocos/adapters/core/base-creator-adapter.js";
export type { ICocosRuntime } from "./cocos/runtime.js";
export type {
  IRuntimeFacadeInitialAsset,
  IRuntimeFacadeInitialSceneNode,
  IRuntimeFacadeInitialState,
  IRuntimeFacadeOptions,
} from "./cocos/runtime-facade.js";
export { RuntimeFacade } from "./cocos/runtime-facade.js";
export type {
  ExecutionDiagnosticGroupStatus,
  ExecutionGroupStage,
  IExecutionDiagnosticGroupSnapshot,
  IExecutionDiagnosticsSnapshot,
  IExecutionDiagnosticTaskSnapshot,
  IExecutionGroupSnapshot,
  IExecutionQueueSnapshot,
  IExecutionRuntimeService,
} from "./execution/execution-runtime-service.js";
export { ExecutionRuntimeService } from "./execution/execution-runtime-service.js";
export {
  ThroughputAdmissionController,
  type IThroughputAdmissionLease,
  type IThroughputAdmissionLimits,
  type IThroughputAdmissionRequest,
  type IThroughputAdmissionSnapshot,
} from "./execution/admission/throughput-admission-controller.js";
export { ThroughputOverloadError } from "./execution/admission/throughput-overload-error.js";
export {
  ThroughputHealthMetrics,
  type IThroughputHealthMetricsOptions,
} from "./execution/metrics/throughput-health-metrics.js";
export {
  ProjectRevisionClock,
  type ProjectRevisionBoundary,
} from "./execution/revision/project-revision-clock.js";
export {
  RevisionAwareReadCoordinator,
  type IRevisionAwareReadCoordinatorOptions,
  type IRevisionAwareReadRequest,
  type IRevisionAwareReadResult,
} from "./execution/read/revision-aware-read-coordinator.js";
export {
  ProjectWriterBarrier,
  type IProjectWriterBarrierLease,
} from "./execution/read/project-writer-barrier.js";
export {
  BuiltInRuntimeTaskExecutors,
  RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID,
} from "./execution/commit/builtin-runtime-task-executors.js";
export type { ITaskExecutor } from "./execution/registry/task-executor-registry.js";
export { TaskExecutorRegistry } from "./execution/registry/task-executor-registry.js";
export type {
  ITaskControlPlaneOptions,
  ITaskIdempotencyClaim,
  ITaskReclaimedEvent,
  ITaskTerminalEvent,
  TaskEvidenceScope,
} from "./execution/control/task-control-plane.js";
export { TaskControlPlane } from "./execution/control/task-control-plane.js";
export { TaskIngress } from "./execution/ingress/task-ingress.js";
export { TaskLedger } from "./execution/ledger/task-ledger.js";
export type {
  IResourceLockAcquireOptions,
  IResourceLockLease,
  IResourceLockRequest,
} from "./execution/locks/resource-lock-manager.js";
export { ResourceLockManager } from "./execution/locks/resource-lock-manager.js";
export type { ITaskMergeGroup } from "./execution/merge/task-merger.js";
export { TaskMerger } from "./execution/merge/task-merger.js";
export { TaskScheduler } from "./execution/scheduler/task-scheduler.js";
export { TracePipeline } from "./execution/trace/trace-pipeline.js";
export type { IWorkerPlanSummary } from "./execution/workers/worker-pool.js";
export { WorkerPool } from "./execution/workers/worker-pool.js";
export type { IAssetRuntimeService } from "./cocos/foundation/asset/asset-runtime-service.js";
export { AssetRuntimeService } from "./cocos/foundation/asset/asset-runtime-service.js";
export type {
  EditorResourceKind,
  EditorResourceRestoreAction,
  IEditorResourceRef,
} from "./cocos/foundation/editor-resource/editor-resource-guard.js";
export { EditorResourceGuard } from "./cocos/foundation/editor-resource/editor-resource-guard.js";
export type {
  IProjectLogCheckpoint,
  IProjectLogPostflightResult,
} from "./cocos/foundation/editor-resource/project-log-postflight-monitor.js";
export { ProjectLogPostflightMonitor } from "./cocos/foundation/editor-resource/project-log-postflight-monitor.js";
export type {
  IProjectLogPostflightWithRepair,
  IProjectLogRepairAttempt,
  IProjectLogRepairMessagePort,
} from "./cocos/foundation/editor-resource/project-log-postflight-repairer.js";
export { ProjectLogPostflightRepairer } from "./cocos/foundation/editor-resource/project-log-postflight-repairer.js";
export type {
  IEditorResourceMessagePort,
  IEditorResourceRestoreResult,
} from "./cocos/foundation/editor-resource/editor-resource-restorer.js";
export { EditorResourceRestorer } from "./cocos/foundation/editor-resource/editor-resource-restorer.js";
export type {
  ICurrentEditorResourceMessagePort,
  ICurrentEditorResourceSnapshot,
} from "./cocos/foundation/editor-resource/current-editor-resource-query.js";
export { CurrentEditorResourceQuery } from "./cocos/foundation/editor-resource/current-editor-resource-query.js";
export type { IPrefabEditorHierarchyNode } from "./cocos/foundation/editor-resource/prefab-editor-root-resolver.js";
export { PrefabEditorRootResolver } from "./cocos/foundation/editor-resource/prefab-editor-root-resolver.js";
export type { IMessageRuntimeService } from "./cocos/foundation/message/message-runtime-service.js";
export { MessageRuntimeService } from "./cocos/foundation/message/message-runtime-service.js";
export type { IPanelHostRuntimeService } from "./cocos/foundation/panel-host/panel-host-runtime-service.js";
export { PanelHostRuntimeService } from "./cocos/foundation/panel-host/panel-host-runtime-service.js";
export type { IProjectRuntimeService } from "./cocos/foundation/project/project-runtime-service.js";
export { ProjectRuntimeService } from "./cocos/foundation/project/project-runtime-service.js";
export type { ISceneRuntimeService } from "./cocos/foundation/scene/scene-runtime-service.js";
export { SceneRuntimeService } from "./cocos/foundation/scene/scene-runtime-service.js";
export type { ISelectionRuntimeService } from "./cocos/foundation/selection/selection-runtime-service.js";
export { SelectionRuntimeService } from "./cocos/foundation/selection/selection-runtime-service.js";
export type { IPanelHostSessionRecord } from "./cocos/shared/host-state.js";
export { CreatorHostState } from "./cocos/shared/host-state.js";
export type { IVersionResolver } from "./cocos/version/version-resolver.js";
export { VersionResolver } from "./cocos/version/version-resolver.js";
export type { IEditorApiAssetBridgeProvider } from "./cocos/adapters/core/editor-api-asset-bridge-provider.js";
export type { IEditorApiSceneBridgeProvider } from "./cocos/adapters/core/editor-api-scene-bridge-provider.js";
export { EditorApiHostAssetBridgeProvider } from "./cocos/adapters/adapter-38/editor-api-host-asset-bridge-provider.js";
