export { PluginModuleBase } from '@peanut/pod-sdk';
export { PluginManagerApp } from './app/plugin-manager-app.js';
export { McpCapabilityRegistry } from './mcp/mcp-capability-registry.js';
export { CocosMcpHub } from './mcp/cocos-mcp-hub.js';
export { McpBatchApprovalStore } from './mcp/mcp-batch-approval-store.js';
export { ProjectMcpAgentConfig } from './mcp/project-mcp-agent-config.js';
export { PluginDevelopmentController } from './development/plugin-development-controller.js';
export { PluginDevelopmentControlServer } from './development/plugin-development-control-server.js';
export type { IPluginDevelopmentControlServerOptions } from './development/plugin-development-control-server.js';
export { BuiltinAssetPluginModule } from './builtin/builtin-asset-plugin-module.js';
export { BuiltinMessagePluginModule } from './builtin/builtin-message-plugin-module.js';
export { BuiltinPanelPluginModule } from './builtin/builtin-panel-plugin-module.js';
export { BuiltinPluginManagerPanelModule } from './builtin/builtin-plugin-manager-panel-module.js';
export { createBuiltinPluginManagerPanelRegistration } from './builtin/builtin-plugin-manager-panel-registration.js';
export { BuiltinScenePluginModule } from './builtin/builtin-scene-plugin-module.js';
export { ContributionRegistry } from './contributions/contribution-registry.js';
export { PluginManagerEditorEntry } from './host/plugin-manager-editor-entry.js';
export { PluginManagerEditorExtensionModule } from './host/plugin-manager-editor-extension-module.js';
export { resolvePluginManagerHostWatchPaths, resolvePluginManagerSplitHostWatchPaths } from './host/plugin-manager-host-paths.js';
export { RuntimeGrantFactory } from './grants/runtime-grant-factory.js';
export { CompatiblePluginNetworkTransport } from './grants/plugin-network-transport.js';
export type { IPluginNetworkTransport } from './grants/plugin-network-transport.js';
export { DesignSourceCapabilityRegistry } from './grants/design-source-capability-registry.js';
export { NativeCapabilityRegistry } from './grants/native-capability-registry.js';
export { PluginManagerHostShell } from './host/plugin-manager-host-shell.js';
export { PluginManagerKernelContainer } from './kernel/plugin-manager-kernel-container.js';
export { HotplugController } from './hotplug/hotplug-controller.js';
export { PluginLeaseStore } from './hotplug/plugin-lease-store.js';
export { PluginLoader } from './loader/plugin-loader.js';
export { NodePluginPackageModuleResolver } from './loader/node-plugin-package-module-resolver.js';
export type { IPluginPackageModuleResolver } from './loader/node-plugin-package-module-resolver.js';
export { PanelBridgeClient } from './panels/panel-bridge-client.js';
export { BrowserPanelBridgeBootstrap } from './panels/browser-panel-bridge-bootstrap.js';
export { HostPanelContainerLauncher } from './panels/host-panel-container-launcher.js';
export { PanelBridgeGateway } from './panels/panel-bridge-gateway.js';
export { PanelManager } from './panels/panel-manager.js';
export { PanelSessionStore } from './panels/panel-session-store.js';
export { PanelUiMountRegistry } from './panels/panel-ui-mount-registry.js';
export { PluginManagerPanelUiController, mountPluginManagerPanelUi, unmountPluginManagerPanelUi } from './panels/plugin-manager-panel-ui.js';
export {
    normalizePluginManagerPanelLocale,
    summarizePluginManagerPackageAction,
    summarizePluginManagerPackagePlan,
    translatePluginManagerPanelPhase,
    translatePluginManagerPanelPriority,
    translatePluginManagerPanelSourceKind,
    translatePluginManagerPanelStage,
    translatePluginManagerPanelState,
    translatePluginManagerPanelText,
    translatePluginManagerPanelTrustLevel,
} from './panels/plugin-manager-panel-i18n.js';
export { PermissionManager } from './permissions/permission-manager.js';
export { PluginRegistry } from './registry/plugin-registry.js';
export { DefaultPluginLogger } from './shared/default-plugin-logger.js';
export { PluginDiagnosticReporter } from './diagnostics/plugin-diagnostic-reporter.js';
export { McpControlFlowRefusal, isMcpControlFlowRefusal, isMcpControlFlowRefusalCode, mcpControlFlowRefusalCode } from './mcp/mcp-control-flow-refusal.js';
export { McpFailurePresenter } from './mcp/mcp-failure-presenter.js';
export { PluginEventBus } from './shared/plugin-event-bus.js';
export { PluginFileStorage, UnavailablePluginFileStorage } from './shared/plugin-file-storage.js';
export { PluginStorage } from './shared/plugin-storage.js';
export { PluginServiceRegistry } from './shared/plugin-service-registry.js';
export { PluginTaskApi } from './shared/plugin-task-api.js';
export {
    MacOsKeychainPluginProtectedKeyProvider,
    UnavailablePluginProtectedKeyApi,
    type IMacOsKeychainCommandRunner,
    type IPluginProtectedKeyProvider,
} from './shared/plugin-protected-key-api.js';
export type {
    IAssetCatalogClient,
    IAssetReadClient,
    IGrantedRuntimeClientSet,
    ICanvasContext2D,
    ICreatorVersionClient,
    IPluginNetworkClient,
    IPluginNetworkRequest,
    IPluginNetworkResponse,
    DesignSourceCapabilityId,
    IDesignSourceCapabilityDescriptor,
    ICanvasImage,
    ICanvasService,
    ICanvasSurface,
    INativeCapabilityClientSet,
    IMessageClient,
    IPanelBridgeClientFactory,
    IPluginActivateContext,
    IPluginEventBus,
    IPluginFileStorageApi,
    IPluginLogger,
    IPluginMcpApi,
    IPluginModule,
    IPluginPanelApi,
    IPluginProtectedKeyApi,
    IPluginServiceApi,
    IPluginRegisterContext,
    IPluginRegistrationApi,
    IPluginRegistrationInput,
    IPluginStorageApi,
    IPluginTaskApi,
    IProjectReadClient,
    ISceneClient,
    ISelectionClient,
} from './shared/plugin-manager-contracts.js';
export type { IMcpCapabilityInvocation, IMcpCapabilityProgress, McpCapabilityHandler } from './mcp/mcp-capability-registry.js';
export type { ICocosMcpHubOptions } from './mcp/cocos-mcp-hub.js';
export type {
    IMcpApprovalConsumeRequest,
    IMcpApprovalTokenRecord,
} from './mcp/mcp-batch-approval-store.js';
export type { IMcpHubCapabilitySummary, IMcpHubControl, IMcpHubPendingPlan, IMcpHubRecentCall, IMcpHubStatus, McpHubCallStatus } from './mcp/mcp-hub-control.js';
export type { IPanelBridgeBootstrapContext, IPanelBridgeBrowserWindow } from './panels/browser-panel-bridge-bootstrap.js';
export type { IHostPanelContainerLaunchResult } from './panels/host-panel-container-launcher.js';
export type { IPluginManagerBuiltinPanelRegistration } from './host/plugin-manager-builtin-panel-registration.js';
export type { IPluginManagerEditorEntryOptions } from './host/plugin-manager-editor-entry.js';
export type { IPluginManagerEditorExtensionMethods } from './host/plugin-manager-editor-extension-module.js';
export type { IPluginManagerHostShellOptions } from './host/plugin-manager-host-shell.js';
export type { IPluginManagerKernelContainerOptions, IPluginManagerKernelPanelBinding, PluginManagerKernelBootstrap } from './kernel/plugin-manager-kernel-container.js';
export type { IPanelUiMountBinding } from './panels/panel-ui-mount-registry.js';
export type {
    IPluginUpgradeDiagnostics,
    IPluginUpgradeStepSnapshot,
    PluginUpgradeOutcome,
    PluginUpgradeStepStatus,
} from './shared/plugin-upgrade-diagnostics.js';
export type {
    IPluginFailureDetailPayload,
    IPluginFailureExportPayload,
    IPluginFailureListItemPayload,
    IPluginManagerEditablePanelPreferencesPayload,
    IPluginManagerInstalledPackageSnapshotPayload,
    IPluginManagerKernelReloadPayload,
    IPluginManagerPanelPreferencesPayload,
    IPluginManagerSettingsSnapshotPayload,
    IPluginManagerSettingsUpdatePayload,
    IPluginManagerSnapshotPayload,
    IPluginManualPackageSourceInputPayload,
    IPluginPackageActionPayload,
    IPluginPackageCatalogItemPayload,
    IPluginPackagePlanPayload,
    IPluginPackageSourceActionPayload,
    IPluginRuntimeActionPayload,
    IRetryCleanupPayload,
    PluginManagerPanelLocale,
} from './panels/plugin-manager-panel-contracts.js';
export type {
    IPluginManagerPanelBrowserWindow,
    IPluginManagerPanelDocumentLike,
    IPluginManagerPanelElementLike,
    IPluginManagerPanelUiState,
    PluginManagerExecutionPriorityFilter,
} from './panels/plugin-manager-panel-ui.js';
