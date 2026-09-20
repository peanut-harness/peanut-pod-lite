import { existsSync } from 'fs';

import type {
    ICleanupStepResult,
    IGrantedPermissionSet,
    IPluginFailureExport,
    IPluginFailureIncident,
    IPluginInstallPlan,
    IPluginInstallResult,
    IPluginHealthSnapshot,
    IPluginManifest,
    IPanelBridgeClient,
    IPanelContribution,
    IPluginPackageInspection,
    IPluginRepairResult,
    IPluginRuntimeRecord,
    IPluginUninstallResult,
    PluginDeactivateReason,
    PluginFailurePhase,
} from '@peanut/pod-protocol';
import { PackagingApp, type IInstalledPackageRecord, type IInstalledPackageSnapshot, type IPluginFileStorageSummary, type IPackageSnapshot, type PluginConfig, type PluginSettingsScope, type ProjectPluginFileStore } from '@peanut/pod-engine/installation';
import type { ICocosRuntime, IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import { ContributionRegistry } from '../contributions/contribution-registry.js';
import { RuntimeGrantFactory } from '../grants/runtime-grant-factory.js';
import { NativeCapabilityRegistry } from '../grants/native-capability-registry.js';
import { HotplugController } from '../hotplug/hotplug-controller.js';
import { PluginFailureIncidentStore } from '../hotplug/plugin-failure-incident-store.js';
import { PluginLeaseStore } from '../hotplug/plugin-lease-store.js';
import { PluginLoader } from '../loader/plugin-loader.js';
import { McpCapabilityRegistry } from '../mcp/mcp-capability-registry.js';
import { McpTaskControl } from '../mcp/mcp-task-control.js';
import type { IMcpHubControl } from '../mcp/mcp-hub-control.js';
import type { IPluginPackageModuleResolver } from '../loader/node-plugin-package-module-resolver.js';
import { BrowserPanelBridgeBootstrap, type IPanelBridgeBrowserWindow } from '../panels/browser-panel-bridge-bootstrap.js';
import { HostPanelContainerLauncher, type IHostPanelContainerLaunchResult } from '../panels/host-panel-container-launcher.js';
import { PanelBridgeGateway } from '../panels/panel-bridge-gateway.js';
import { PanelManager } from '../panels/panel-manager.js';
import { PanelUiMountRegistry, type IPanelUiMountBinding } from '../panels/panel-ui-mount-registry.js';
import { PanelSessionStore } from '../panels/panel-session-store.js';
import { PermissionManager } from '../permissions/permission-manager.js';
import { PluginRegistry } from '../registry/plugin-registry.js';
import { DefaultPluginLogger } from '../shared/default-plugin-logger.js';
import { PluginEventBus } from '../shared/plugin-event-bus.js';
import { PluginFileStorage, UnavailablePluginFileStorage } from '../shared/plugin-file-storage.js';
import type { IDesignSourceCapabilityDescriptor, IPluginActivateContext, IPluginModule, IPluginRegistrationInput, IPluginRegisterContext, IPluginTaskApi } from '../shared/plugin-manager-contracts.js';
import type { IPluginUpgradeDiagnostics } from '../shared/plugin-upgrade-diagnostics.js';
import { PluginUpgradeDiagnosticsTracker, type IMutablePluginUpgradeDiagnostics } from '../shared/plugin-upgrade-diagnostics-tracker.js';
import { PluginStorage } from '../shared/plugin-storage.js';
import { UnavailablePluginProtectedKeyApi, type IPluginProtectedKeyProvider } from '../shared/plugin-protected-key-api.js';
import { PluginServiceRegistry } from '../shared/plugin-service-registry.js';
import { PluginTaskApi } from '../shared/plugin-task-api.js';
import { PluginDiagnosticReporter } from '../diagnostics/plugin-diagnostic-reporter.js';

/**
 * @description 插件管理器主入口，负责组装插件治理子系统并对外提供最小管理 API。
 */
export class PluginManagerApp {
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _runtime: ICocosRuntime;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginRegistry: PluginRegistry;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginLoader: PluginLoader;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _permissionManager: PermissionManager;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginLeaseStore: PluginLeaseStore;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginFailureIncidentStore: PluginFailureIncidentStore;
    /** @description 统一插件边界诊断记录器。 */
    private readonly _diagnosticReporter: PluginDiagnosticReporter;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _contributionRegistry: ContributionRegistry;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _runtimeGrantFactory: RuntimeGrantFactory;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _browserPanelBridgeBootstrap: BrowserPanelBridgeBootstrap;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _hostPanelContainerLauncher: HostPanelContainerLauncher;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _panelManager: PanelManager;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _hotplugController: HotplugController;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _packaging: PackagingApp;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _panelBridgeGateway: PanelBridgeGateway;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _panelUiMountRegistry: PanelUiMountRegistry;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginStorageStore = new Map<string, PluginStorage>();
    /** @description 保存当前已激活插件公开的服务。 */
    private readonly _pluginServiceRegistry = new PluginServiceRegistry();
    /** @description 保存当前活动插件公开的 MCP capability。 */
    private readonly _mcpCapabilityRegistry: McpCapabilityRegistry;
    /** @description 连接隔离的 MCP 受管任务控制器。 */
    private readonly _mcpTaskControl: McpTaskControl;
    /** @description 保存当前活动插件的受管任务 API。 */
    private readonly _pluginTaskApis = new Map<string, PluginTaskApi>();
    /** @description 由编辑器宿主注入的 MCP Hub 面板控制器。 */
    private _mcpHubControl: IMcpHubControl | null = null;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _packageRuntimeModuleFactories = new Map<string, () => IPluginModule>();
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _upgradeDiagnosticsTracker = new PluginUpgradeDiagnosticsTracker();
    /** @description 可选真实目录包模块解析器；缺失时仍兼容测试中的手工模块工厂。 */
    private readonly _pluginPackageModuleResolver: IPluginPackageModuleResolver | null;
    /** @description 从已注册安装包 manifest 自动发现的 design-supporter capability。 */
    private readonly _manifestDesignSources = new Map<string, IDesignSourceCapabilityDescriptor>();
    /** @description 可选宿主受保护密钥提供器；缺失时向插件提供 fail-closed 端口。 */
    private readonly _protectedKeyProvider: IPluginProtectedKeyProvider | null;
    /** @description 当前宿主工程的稳定任务键。 */
    private readonly _taskProjectKey: string | null;

    /**
     * @description 创建一个新的插件管理器主入口。
     * @param runtime Runtime 门面实例
     * @param packaging Packaging 模块主入口；省略时使用默认内置实例
     * @param pluginPackageModuleResolver 可选目录包主入口解析器
     * @param nativeCapabilityRegistry 可选宿主原生 capability 注册表
     */
    public constructor(
        runtime: ICocosRuntime,
        packaging?: PackagingApp,
        pluginPackageModuleResolver?: IPluginPackageModuleResolver,
        nativeCapabilityRegistry?: NativeCapabilityRegistry,
        diagnosticProjectPath?: string,
        protectedKeyProvider?: IPluginProtectedKeyProvider,
    ) {
        this._runtime = runtime;
        this._pluginRegistry = new PluginRegistry();
        this._pluginLoader = new PluginLoader(this._pluginRegistry);
        this._permissionManager = new PermissionManager();
        this._pluginLeaseStore = new PluginLeaseStore();
        this._pluginFailureIncidentStore = new PluginFailureIncidentStore();
        this._contributionRegistry = new ContributionRegistry(this._pluginLeaseStore);
        this._runtimeGrantFactory = new RuntimeGrantFactory(this._runtime, this._pluginLeaseStore, nativeCapabilityRegistry);
        this._browserPanelBridgeBootstrap = new BrowserPanelBridgeBootstrap(this);
        this._hostPanelContainerLauncher = new HostPanelContainerLauncher(this._runtime, this, (pluginId: string, panelId: string) => {
            return this._contributionRegistry.getPanel(pluginId, panelId);
        });
        this._packaging = packaging ?? new PackagingApp();
        const projectPath = diagnosticProjectPath ?? this._packaging.getProjectPluginFileStore()?.getLayout().projectPath;
        this._taskProjectKey = projectPath ?? null;
        this._diagnosticReporter = new PluginDiagnosticReporter(projectPath);
        this._mcpCapabilityRegistry = new McpCapabilityRegistry((pluginId, error, context) => {
            this._diagnosticReporter.record({ pluginId, source: 'mcp_capability', error, context });
        });
        this._mcpTaskControl = new McpTaskControl(this._runtime.execution, (capability, connectionId) => {
            const pluginId = this._mcpCapabilityRegistry.getRegisteredProviderPluginId(capability);
            if (pluginId == null) {
                return null;
            }
            const runtimeMeta = this._pluginRegistry.getRuntimeMeta(pluginId);
            return { pluginId, connectionId, projectKey: this._taskProjectKey ?? runtimeMeta?.installPath ?? `plugin:${pluginId}`, capability };
        });
        this._panelBridgeGateway = new PanelBridgeGateway((input) => {
            this._diagnosticReporter.record(input);
        });
        this._panelManager = new PanelManager(
            this._runtime,
            this._contributionRegistry,
            new PanelSessionStore(),
            this._pluginLeaseStore,
            this._panelBridgeGateway,
        );
        this._hotplugController = new HotplugController(this._panelManager, this._pluginLeaseStore);
        this._pluginPackageModuleResolver = pluginPackageModuleResolver ?? null;
        this._panelUiMountRegistry = new PanelUiMountRegistry();
        this._protectedKeyProvider = protectedKeyProvider ?? null;
    }

    /**
     * @description 注册一个新的插件 manifest。
     * @param input 插件注册输入参数
     * @returns 当前插件的运行时记录
     */
    public registerManifest(input: IPluginRegistrationInput): IPluginRuntimeRecord {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeMeta = this._pluginRegistry.registerManifest(input);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(runtimeMeta.id);
        if (runtimeRecord == null) {
            throw new Error(`Failed to create runtime record for plugin "${runtimeMeta.id}".`);
        }
        this._registerManifestDesignSupporters(input.manifest);
        return runtimeRecord;
    }

    /**
     * @description 绑定指定插件的模块实例。
     * @param pluginId 插件标识
     * @param pluginModule 插件模块实例
     * @returns 成功绑定时返回 `true`
     */
    public attachModule(pluginId: string, pluginModule: IPluginModule): boolean {
        return this._pluginLoader.load(pluginId, pluginModule);
    }

    /**
     * @description 注册一个面板浏览器侧 UI 挂载绑定。
     * @param binding 面板 UI 挂载绑定
     * @returns 当前插件管理器实例，便于链式调用
     */
    public registerPanelUiMountBinding(binding: IPanelUiMountBinding): PluginManagerApp {
        this._panelUiMountRegistry.register(binding);
        return this;
    }

    /**
     * @description 删除一个面板浏览器侧 UI 挂载绑定。
     * @param pluginId 面板所属插件标识
     * @param panelId 面板稳定标识
     * @returns 成功移除时返回 `true`
     */
    public unregisterPanelUiMountBinding(pluginId: string, panelId: string): boolean {
        return this._panelUiMountRegistry.unregister(pluginId, panelId);
    }

    /**
     * @description 为指定包路径注册一个可复用的运行时模块工厂，用于包安装后的自动接管。
     * @param packagePath 插件包路径
     * @param moduleFactory 对应的运行时模块工厂
     * @returns 无返回值
     */
    public registerPackageRuntimeModule(packagePath: string, moduleFactory: () => IPluginModule): void {
        this._packageRuntimeModuleFactories.set(packagePath, moduleFactory);
    }

    /** @description 更新宿主当前已验证的设计来源 capability；目标插件重新激活后获得新快照。 */
    public configureDesignSourceCapabilities(sources: readonly IDesignSourceCapabilityDescriptor[]): void {
        this._runtimeGrantFactory.replaceDesignSourceCapabilities(sources);
    }

    /**
     * @description 从目录包 manifest 自动发现 design-supporter contribution，并更新后续激活可见的 capability 快照。
     * @param manifest 已通过宿主包校验的插件清单。
     * @returns 无返回值。
     */
    private _registerManifestDesignSupporters(manifest: IPluginManifest): void {
        const supporters = manifest.contributions?.designSupporters ?? [];
        for (const supporter of supporters) {
            if (!/^[a-z][a-z0-9-]{0,63}$/u.test(supporter.id)) {
                throw new Error(`design_supporter_id_invalid:${supporter.id}`);
            }
            if (supporter.apiVersion !== 'design-supporter.v1' || supporter.displayName.trim().length === 0 || supporter.locatorPatterns.length === 0) {
                throw new Error(`design_supporter_manifest_invalid:${supporter.id}`);
            }
            this._manifestDesignSources.set(supporter.id, {
                id: supporter.id,
                providerPluginId: manifest.id,
                displayName: supporter.displayName,
                version: manifest.version,
                available: true,
            });
        }
        this._runtimeGrantFactory.replaceDesignSourceCapabilities([...this._manifestDesignSources.values()]);
    }

    /**
     * @description 返回由宿主统一暴露的 MCP capability 注册中心。
     * @returns 当前插件管理器拥有的注册中心。
     */
    public getMcpCapabilityRegistry(): McpCapabilityRegistry {
        return this._mcpCapabilityRegistry;
    }

    /** @description 为宿主直接加载但仍由 Kernel 控制的 MCP 插件创建任务 API。 */
    public createHostTaskApi(pluginId: string, projectKey: string = this._taskProjectKey ?? `plugin:${pluginId}`): IPluginTaskApi {
        if (this._pluginTaskApis.has(pluginId)) {
            throw new Error(`plugin_task_api_already_active:${pluginId}`);
        }
        const taskApi = new PluginTaskApi(pluginId, this._runtime, projectKey,
            (invocation) => this._mcpCapabilityRegistry.resolveInvocationOwner(pluginId, invocation),
        );
        this._pluginTaskApis.set(pluginId, taskApi);
        return taskApi;
    }

    /** @description 停用并移除宿主直接加载 MCP 插件的任务 API。 */
    public async deactivateHostTaskApi(pluginId: string): Promise<void> {
        const taskApi = this._pluginTaskApis.get(pluginId);
        if (taskApi == null) {
            return;
        }
        this._pluginTaskApis.delete(pluginId);
        await taskApi.deactivate();
    }

    /** @description 返回连接隔离的 MCP 任务控制器。 */
    public getMcpTaskControl(): McpTaskControl {
        return this._mcpTaskControl;
    }

    /**
     * @description 设置当前 kernel 可供内置面板调用的 MCP Hub 控制器。
     * @param control 编辑器宿主的 MCP Hub 控制边界；未配置时传入 `null`。
     * @returns 无返回值。
     */
    public setMcpHubControl(control: IMcpHubControl | null): void {
        this._mcpHubControl = control;
    }

    /**
     * @description 返回当前 kernel 可用的 MCP Hub 控制器。
     * @returns 未接入编辑器 MCP Hub 时返回 `null`。
     */
    public getMcpHubControl(): IMcpHubControl | null {
        return this._mcpHubControl;
    }

    /**
     * @description 执行指定插件的 register + activate 流程。
     * @param pluginId 插件标识
     * @returns Promise 在激活流程结束后完成
     */
    public async activatePlugin(pluginId: string): Promise<void> {
        await this._prepareForActivation(pluginId);

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeMeta = this._requireRuntimeMeta(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const manifest = this._requireManifest(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程需要复用的索引或缓存状态，归当前作用域或实例管理。
        const grantedPermissionSet = this._permissionManager.grant(pluginId, manifest);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginRegisterContext = this._createRegisterContext(runtimeMeta, grantedPermissionSet);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        let phase: Extract<PluginFailurePhase, 'register' | 'activate'> = 'register';

        try {
            await this._pluginLoader.register(pluginId, pluginRegisterContext);
            phase = 'activate';
            // 运行记录处于 loaded 时可能保留上一次未完成激活的服务；激活前统一撤销该 provider，确保服务注册幂等。
            this._pluginServiceRegistry.revokeProvider(pluginId);
            this._mcpCapabilityRegistry.revokePlugin(pluginId);
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginActivateContext = this._createActivateContext(runtimeMeta, grantedPermissionSet);
            await this._pluginLoader.activate(pluginId, pluginActivateContext);
            this._clearFailureState(pluginId);
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            await this._deactivateTaskApi(pluginId);
            this._pluginServiceRegistry.revokeProvider(pluginId);
            this._mcpCapabilityRegistry.revokePlugin(pluginId);
            // 保存当前流程收集的有序结果，供后续步骤统一处理。
            const cleanupStepResults = await this._hotplugController.cleanupRuntime(pluginId, 'cleanup');
            this._recordFailure(pluginId, phase, previousState, error, cleanupStepResults, true);
            throw error;
        }
    }

    /**
     * @description 执行指定插件的停用流程。
     * @param pluginId 插件标识
     * @param reason 插件停用原因
     * @returns Promise 在停用流程结束后完成
     */
    public async deactivatePlugin(pluginId: string, reason: PluginDeactivateReason): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDeactivate(pluginId, reason, async (): Promise<void> => {
            await this._deactivateTaskApi(pluginId);
            await this._pluginLoader.deactivate(pluginId, reason);
            this._pluginServiceRegistry.revokeProvider(pluginId);
            this._mcpCapabilityRegistry.revokePlugin(pluginId);
        });
        this._finalizeLifecycleResult(pluginId, 'deactivate', previousState, cleanupStepResults, true);
    }

    /**
     * @description 执行指定插件的最终释放流程。
     * @param pluginId 插件标识
     * @returns Promise 在释放流程结束后完成
     */
    public async disposePlugin(pluginId: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDispose(pluginId, async (): Promise<void> => {
            await this._deactivateTaskApi(pluginId);
            await this._pluginLoader.dispose(pluginId);
            this._pluginServiceRegistry.revokeProvider(pluginId);
            this._mcpCapabilityRegistry.revokePlugin(pluginId);
        });
        this._finalizeLifecycleResult(pluginId, 'dispose', previousState, cleanupStepResults, true);
    }

    /**
     * @description 返回当前所有插件的运行时记录。
     * @returns 已注册插件运行时记录的只读列表
     */
    public listRuntimeRecords(): readonly IPluginRuntimeRecord[] {
        return this._pluginRegistry.listRuntimeRecords();
    }

    /**
     * @description 返回当前所有插件的失败事件。
     * @returns 插件失败事件只读列表
     */
    public listFailureIncidents(): readonly IPluginFailureIncident[] {
        return this._pluginFailureIncidentStore.list();
    }

    /** @description 返回当前插件边界诊断事件。 */
    public listDiagnosticEvents(pluginId?: string) {
        return this._diagnosticReporter.list(pluginId);
    }

    /** @description 将指定插件诊断事件导出到 peanut-plugins/logs/<pluginId>。 */
    public exportDiagnosticLog(pluginId: string) {
        return this._diagnosticReporter.export(pluginId);
    }

    /**
     * @description 查询指定插件的失败事件。
     * @param pluginId 插件标识
     * @returns 命中时返回失败事件，否则返回 `null`
     */
    public getFailureIncident(pluginId: string): IPluginFailureIncident | null {
        return this._pluginFailureIncidentStore.get(pluginId);
    }

    /**
     * @description 导出指定插件的失败事件。
     * @param pluginId 插件标识
     * @returns 命中时返回导出报告，否则返回 `null`
     */
    public exportFailureIncident(pluginId: string): IPluginFailureExport | null {
        return this._pluginFailureIncidentStore.export(pluginId);
    }

    /**
     * @description 重试指定插件的运行时清理。
     * @param pluginId 插件标识
     * @returns Promise 返回本次清理步骤结果列表
     */
    public async retryCleanup(pluginId: string): Promise<readonly ICleanupStepResult[]> {
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.cleanupRuntime(pluginId, 'cleanup_retry');
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginFailureIncident = this._pluginFailureIncidentStore.updateCleanupSteps(pluginId, cleanupStepResults);
        if (pluginFailureIncident != null) {
            this._pluginRegistry.updateFailureIncident(pluginId, pluginFailureIncident);
            this._pluginRegistry.updateHealth(pluginId, this._buildCleanupRetryHealthSnapshot(pluginId, cleanupStepResults));
        }
        return cleanupStepResults;
    }

    /**
     * @description 检查指定路径上的插件包结构。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化检查结果
     */
    public async inspectPackage(packagePath: string): Promise<IPluginPackageInspection> {
        return this._packaging.inspect(packagePath);
    }

    /**
     * @description 为指定路径上的插件包生成安装计划。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化安装计划
     */
    public async planInstallPackage(packagePath: string): Promise<IPluginInstallPlan> {
        return this._packaging.planInstall(packagePath);
    }

    /**
     * @description 执行指定路径上的插件安装流程。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化安装结果
     */
    public async installPackage(packagePath: string): Promise<IPluginInstallResult> {
        return this._packaging.install(packagePath);
    }

    /**
     * @description 执行指定路径上的插件安装流程，并在存在模块工厂时接管到 runtime。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化安装结果
     */
    public async installAndActivatePackage(packagePath: string): Promise<IPluginInstallResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installResult = await this._packaging.install(packagePath);
        // 安装完成后优先从最终安装目录读取 manifest；该文件已通过 packaging 校验，是权限授权的唯一来源。
        const installedPackageInspection = await this._packaging.inspect(installResult.installPath);
        // 内存模式不保留实体安装目录，回退到已由 packaging 处理过的输入包快照。
        const packageInspection = installedPackageInspection.manifest == null
            ? await this._packaging.inspect(packagePath)
            : installedPackageInspection;
        if (packageInspection.manifest == null) {
            throw new Error(`Installed plugin manifest is unavailable: ${installResult.pluginId}`);
        }
        this.registerManifest({
            manifest: packageInspection.manifest,
            installPath: installResult.installPath,
            trustLevel: 'community',
        });
        let phase: Extract<PluginFailurePhase, 'host_compatibility' | 'module_load'> = 'host_compatibility';
        try {
            this._assertHostCompatibility(packageInspection.manifest);
            phase = 'module_load';
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginModule = await this._resolveRuntimeModuleForPackage(packagePath, installResult.installPath);
            if (pluginModule == null) {
                return installResult;
            }
            if (pluginModule.manifest.id !== packageInspection.manifest.id || pluginModule.manifest.version !== packageInspection.manifest.version) {
                throw new Error(`plugin_module_manifest_mismatch:${packageInspection.manifest.id}`);
            }
            this.attachModule(packageInspection.manifest.id, pluginModule);
            await this.activatePlugin(packageInspection.manifest.id);
        } catch (error) {
            const runtimeRecord = this._pluginRegistry.getRuntimeRecord(packageInspection.manifest.id);
            if (runtimeRecord != null && runtimeRecord.state !== 'failed') {
                this._recordFailure(packageInspection.manifest.id, phase, runtimeRecord.state, error, [], true);
            }
            throw error;
        }
        return installResult;
    }

    /**
     * @description 升级指定路径上的插件包，并切换活动版本。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化升级结果
     */
    public async upgradePackage(packagePath: string): Promise<IPluginInstallResult> {
        return this._packaging.upgrade(packagePath);
    }

    /**
     * @description 升级指定路径上的插件包，并在存在模块工厂时切换 runtime 实例。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化升级结果
     */
    public async upgradeAndActivatePackage(packagePath: string): Promise<IPluginInstallResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginModule = await this._resolveRuntimeModuleForPackage(packagePath, packagePath);
        if (pluginModule == null) {
            return this._packaging.upgrade(packagePath);
        }
        return this.upgradePlugin(packagePath, pluginModule);
    }

    /**
     * @description 升级一个已激活插件的运行时实例，并在失败时回退到旧版本。
     * @param packagePath 新版本插件包路径
     * @param pluginModule 新版本插件模块实例
     * @returns Promise 返回结构化升级结果
     */
    public async upgradePlugin(packagePath: string, pluginModule: IPluginModule): Promise<IPluginInstallResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packageInspection = await this._packaging.inspect(packagePath);
        if (packageInspection.manifest == null) {
            throw new Error(`Cannot upgrade plugin from package "${packagePath}" because manifest is missing.`);
        }
        if (packageInspection.manifest.id !== pluginModule.manifest.id) {
            throw new Error(
                `Cannot upgrade plugin because package manifest "${packageInspection.manifest.id}" does not match module "${pluginModule.manifest.id}".`,
            );
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginId = packageInspection.manifest.id;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousRuntimeMeta = this._requireRuntimeMeta(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousManifest = this._requireManifest(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousModule = this._pluginRegistry.getModule(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousRuntimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousInstalledPackage = this._packaging.getActiveInstalledPackage(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousPanelSessions = this._panelManager.snapshotPluginSessions(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousStorageSnapshot = this._getOrCreateStorage(pluginId).snapshot();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const upgradeDiagnostics = this._upgradeDiagnosticsTracker.create(
            pluginId,
            packagePath,
            previousManifest.version,
            packageInspection.manifest.version,
            previousPanelSessions.length,
        );
        this._upgradeDiagnosticsTracker.completeStep(
            upgradeDiagnostics,
            'inspect_package',
            `Prepared upgrade from version "${previousManifest.version}" to "${packageInspection.manifest.version}".`,
        );
        if (previousModule == null || previousRuntimeRecord == null || previousInstalledPackage == null) {
            // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
            const incompleteRuntimeError = `Cannot upgrade plugin "${pluginId}" because the current runtime instance is incomplete.`;
            this._upgradeDiagnosticsTracker.finalizeFailure(upgradeDiagnostics, incompleteRuntimeError);
            throw new Error(incompleteRuntimeError);
        }
        if (previousRuntimeRecord.state !== 'active') {
            // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
            const invalidRuntimeStateError = `Cannot upgrade plugin "${pluginId}" because the current runtime state is "${previousRuntimeRecord.state}".`;
            this._upgradeDiagnosticsTracker.finalizeFailure(upgradeDiagnostics, invalidRuntimeStateError);
            throw new Error(invalidRuntimeStateError);
        }

        let upgradeResult: IPluginInstallResult | null = null;
        try {
            await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'deactivate_previous_runtime', async (): Promise<void> => {
                await this._deactivatePluginForUpgrade(pluginId, 'plugin_update');
            }, `Deactivated version "${previousManifest.version}" before switching package.`);
            await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'dispose_previous_runtime', async (): Promise<void> => {
                await this._disposePluginForUpgrade(pluginId);
            }, `Disposed version "${previousManifest.version}" before switching package.`);
            upgradeResult = await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'switch_installed_package', async (): Promise<IPluginInstallResult> => {
                return this._packaging.upgrade(packagePath);
            }, `Switched installed package to version "${packageInspection.manifest.version}".`);
            this.registerManifest({
                manifest: pluginModule.manifest,
                installPath: upgradeResult.installPath,
                trustLevel: previousRuntimeMeta.trustLevel,
            });
            this.attachModule(pluginId, pluginModule);
            await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'activate_target_runtime', async (): Promise<void> => {
                await this.activatePlugin(pluginId);
            }, `Activated target version "${pluginModule.manifest.version}".`);
            await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'restore_target_panel_sessions', async (): Promise<void> => {
                await this._panelManager.restorePluginSessions(pluginId);
            }, `Restored panel sessions for version "${pluginModule.manifest.version}".`);
            await this._captureUpgradePostState(upgradeDiagnostics, pluginId, previousPanelSessions);
            this._upgradeDiagnosticsTracker.finalizeSuccess(upgradeDiagnostics);
            return upgradeResult;
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._panelManager.restorePluginSessionSnapshot(
                pluginId,
                previousPanelSessions.map((panelSession) => {
                    return {
                        ...panelSession,
                        isOpen: false,
                        restoreOnActivate: panelSession.isOpen || panelSession.restoreOnActivate,
                    };
                }),
            );
            // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
            const normalizedUpgradeError = this._normalizeError(error);
            upgradeDiagnostics.failureMessage = normalizedUpgradeError.message;
            try {
                await this._upgradeDiagnosticsTracker.runStep(upgradeDiagnostics, 'rollback_previous_runtime', async (): Promise<void> => {
                    await this._restorePreviousPluginVersion(
                        previousManifest,
                        previousModule,
                        previousInstalledPackage,
                        previousStorageSnapshot,
                        previousRuntimeMeta.trustLevel,
                        upgradeResult != null,
                    );
                }, `Rolled back to version "${previousManifest.version}" after upgrade failure.`);
                await this._captureUpgradePostState(upgradeDiagnostics, pluginId, previousPanelSessions);
                this._upgradeDiagnosticsTracker.finalizeRollback(upgradeDiagnostics, normalizedUpgradeError.message);
            } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ rollbackError) {
                // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
                const normalizedRollbackError = this._normalizeError(rollbackError);
                await this._captureUpgradePostState(upgradeDiagnostics, pluginId, previousPanelSessions);
                this._upgradeDiagnosticsTracker.finalizeFailure(
                    upgradeDiagnostics,
                    normalizedUpgradeError.message,
                    normalizedRollbackError.message,
                );
                throw rollbackError;
            }
            throw error;
        }
    }

    /**
     * @description 卸载指定插件的包文件记录。
     * @param pluginId 插件标识
     * @returns Promise 返回结构化卸载结果
     */
    public async uninstallPackage(pluginId: string): Promise<IPluginUninstallResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const activeInstalledPackage = this._packaging.getActiveInstalledPackage(pluginId);
        if (activeInstalledPackage != null) {
            await this._teardownPluginRuntimeForUninstall(pluginId);
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginUninstallResult = await this._packaging.uninstall(pluginId);
        if (pluginUninstallResult.removed) {
            this._clearFailureState(pluginId);
            this._pluginRegistry.unregister(pluginId);
            this._pluginStorageStore.delete(pluginId);
            this._upgradeDiagnosticsTracker.delete(pluginId);
        }
        return pluginUninstallResult;
    }

    /**
     * @description 执行一次幂等的包修复流程。
     * @returns Promise 返回修复结果
     */
    public async repairPackages(): Promise<IPluginRepairResult> {
        return this._packaging.repair();
    }

    /** @description 返回插件管理器可见的全部插件文件存储摘要。 */
    public listPluginStorage(): readonly IPluginFileStorageSummary[] {
        return this._requireProjectPluginFileStore().listPluginStorageSummaries();
    }

    /** @description 清空指定插件缓存；仅管理器控制面可调用。 */
    public clearPluginCache(pluginId: string): number {
        return this._requireProjectPluginFileStore().clearPluginCache(pluginId);
    }

    /** @description 清空全部插件缓存；仅管理器控制面可调用。 */
    public clearAllPluginCaches(): number {
        return this._requireProjectPluginFileStore().clearAllCaches();
    }

    /** @description 读取指定插件的设置层。 */
    public readPluginSettings(pluginId: string, scope: PluginSettingsScope): PluginConfig {
        return this._requireProjectPluginFileStore().readPluginSettings(pluginId, scope);
    }

    /** @description 原子替换指定插件的可写设置层。 */
    public writePluginSettings(pluginId: string, scope: Exclude<PluginSettingsScope, 'effective'>, settings: PluginConfig): void {
        this._requireProjectPluginFileStore().writePluginSettings(pluginId, scope, settings);
    }

    /**
     * @description 启动时恢复全部声明自动激活的真实目录包；单个插件失败不会阻断其他插件恢复。
     * @returns Promise 在全部可恢复插件处理完成后结束。
     */
    public async activateInstalledPackages(): Promise<void> {
        await this._activateInstalledPackages(null);
    }

    /**
     * @description 在 kernel reload 后仅恢复重载前仍处于 active 状态的已安装插件。
     * @param pluginIds 重载前处于 active 状态的插件标识。
     * @returns Promise 在指定插件恢复完成后结束。
     */
    public async restoreInstalledPackages(pluginIds: readonly string[]): Promise<void> {
        await this._activateInstalledPackages(new Set(pluginIds));
    }

    /**
     * @description 按首次启动或指定插件集合恢复已安装目录包。
     * @param pluginIds 指定集合时只恢复其中的插件；`null` 时按 manifest 的 `autoActivate` 恢复。
     * @returns Promise 在全部候选插件处理完成后结束。
     */
    private async _activateInstalledPackages(pluginIds: ReadonlySet<string> | null): Promise<void> {
        if (this._pluginPackageModuleResolver == null) {
            return;
        }
        // 保存跨重启恢复所需的全部安装快照，逐个隔离失败。
        const installedSnapshots = this._packaging.listInstalledPackageSnapshots();
        for (const installedSnapshot of installedSnapshots) {
            // 保存当前活动版本记录，损坏索引由 packaging repair 而非启动链路处理。
            const activeRecord = installedSnapshot.versions.find((versionRecord) => {
                return versionRecord.version === installedSnapshot.activeVersion;
            });
            if (activeRecord == null) {
                continue;
            }
            let phase: Extract<PluginFailurePhase, 'host_compatibility' | 'module_load'> = 'host_compatibility';
            try {
                // 保存真实安装目录的检查结果，确保启动恢复继续复用包装层校验入口。
                const inspection = await this._packaging.inspect(activeRecord.installPath);
                if (inspection.manifest == null) {
                    continue;
                }
                if (pluginIds == null && inspection.manifest.activation?.autoActivate === false) {
                    continue;
                }
                if (pluginIds != null && !pluginIds.has(inspection.manifest.id)) {
                    continue;
                }
                const existingRuntimeRecord = this._pluginRegistry.getRuntimeRecord(inspection.manifest.id);
                if (existingRuntimeRecord?.version === inspection.manifest.version && existingRuntimeRecord.state !== 'inactive' && existingRuntimeRecord.state !== 'failed') {
                    continue;
                }
                this.registerManifest({
                    manifest: inspection.manifest,
                    installPath: activeRecord.installPath,
                    trustLevel: 'community',
                });
                this._assertHostCompatibility(inspection.manifest);
                phase = 'module_load';
                // 保存从已安装目录加载的生命周期模块；禁止从原始外部包路径恢复。
                const pluginModule = await this._pluginPackageModuleResolver.resolve(activeRecord.installPath, inspection.manifest);
                this.attachModule(inspection.manifest.id, pluginModule);
                await this.activatePlugin(inspection.manifest.id);
            } catch (error) {
                const runtimeRecord = this._pluginRegistry.getRuntimeRecord(installedSnapshot.pluginId);
                if (runtimeRecord != null && runtimeRecord.state !== 'failed') {
                    this._recordFailure(installedSnapshot.pluginId, phase, runtimeRecord.state, error, [], true);
                }
                // 单个插件失败不能阻断其余独立插件；失败状态会在管理面板和开发控制状态中保留。
            }
        }
    }

    /**
     * @description 导出当前所有插件私有存储快照，用于 kernel reload 或升级恢复。
     * @returns 以插件标识为键的存储快照映射
     */
    public exportStorageSnapshots(): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const storageSnapshots = new Map<string, ReadonlyMap<string, unknown>>();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const [pluginId, pluginStorage] of this._pluginStorageStore.entries()) {
            storageSnapshots.set(pluginId, pluginStorage.snapshot());
        }
        return storageSnapshots;
    }

    /**
     * @description 导入一批插件私有存储快照，用于新 kernel 实例恢复旧状态。
     * @param storageSnapshots 以插件标识为键的存储快照映射
     * @returns 无返回值
     */
    public importStorageSnapshots(storageSnapshots: ReadonlyMap<string, ReadonlyMap<string, unknown>>): void {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const [pluginId, storageSnapshot] of storageSnapshots.entries()) {
            this._getOrCreateStorage(pluginId).restore(storageSnapshot);
        }
    }

    /**
     * @description 按统一顺序停用并释放当前 manager 持有的全部插件运行时实例。
     * @param reason 插件停用原因
     * @returns Promise 在全部运行时实例收尾完成后结束
     */
    public async shutdown(reason: Extract<PluginDeactivateReason, 'host_reload' | 'host_shutdown'> = 'host_reload'): Promise<void> {
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const runtimeRecords = [...this._pluginRegistry.listRuntimeRecords()];

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。

        for (const runtimeRecord of runtimeRecords) {
            if (runtimeRecord.state !== 'active') {
                continue;
            }
            await this.deactivatePlugin(runtimeRecord.pluginId, reason);
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。

        for (const runtimeRecord of runtimeRecords) {
            if (runtimeRecord.state === 'disposed') {
                continue;
            }
            await this.disposePlugin(runtimeRecord.pluginId);
        }
    }

    /**
     * @description 返回指定插件当前活动的安装记录。
     * @param pluginId 插件标识
     * @returns 命中时返回活动安装记录，否则返回 `null`
     */
    public getActiveInstalledPackage(pluginId: string): IInstalledPackageRecord | null {
        return this._packaging.getActiveInstalledPackage(pluginId);
    }

    /**
     * @description 返回指定插件的多版本安装快照。
     * @param pluginId 插件标识
     * @returns 命中时返回安装快照，否则返回 `null`
     */
    public getInstalledPackageSnapshot(pluginId: string): IInstalledPackageSnapshot | null {
        return this._packaging.getInstalledPackageSnapshot(pluginId);
    }

    /**
     * @description 切换指定插件的活动安装版本；已激活的运行时实例必须先停用。
     * @param pluginId 插件标识
     * @param version 已安装的目标版本
     * @returns 切换后的安装快照；目标不存在时返回 `null`
     */
    public switchInstalledPackageVersion(pluginId: string, version: string): IInstalledPackageSnapshot | null {
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        if (runtimeRecord?.state === 'active') {
            throw new Error(`plugin_version_switch_requires_deactivation:${pluginId}`);
        }
        return this._packaging.switchActiveInstalledPackageVersion(pluginId, version);
    }

    /**
     * @description 删除指定插件的非活动安装版本。
     * @param pluginId 插件标识
     * @param version 要删除的非活动版本
     * @returns 删除的安装记录；不存在或为活动版本时返回 `null`
     */
    public removeInstalledPackageVersion(pluginId: string, version: string): IInstalledPackageRecord | null {
        return this._packaging.removeInactiveInstalledPackageVersion(pluginId, version);
    }

    /**
     * @description 返回指定插件最近一次升级尝试的结构化诊断快照。
     * @param pluginId 插件标识
     * @returns 命中时返回升级诊断快照，否则返回 `null`
     */
    public getUpgradeDiagnostics(pluginId: string): IPluginUpgradeDiagnostics | null {
        return this._upgradeDiagnosticsTracker.get(pluginId);
    }

    /**
     * @description 返回当前所有插件最近一次升级尝试的结构化诊断快照。
     * @returns 所有升级诊断快照的只读列表
     */
    public listUpgradeDiagnostics(): readonly IPluginUpgradeDiagnostics[] {
        return this._upgradeDiagnosticsTracker.list();
    }

    /**
     * @description 返回当前所有已打包插件的快照列表。
     * @returns 已打包插件快照只读列表
     */
    public listPackageSnapshots(): readonly IPackageSnapshot[] {
        return this._packaging.listPackageSnapshots();
    }

    /**
     * @description 返回当前 runtime 执行队列与提交窗口观测快照。
     * @returns Promise 返回当前执行队列快照
     */
    public async inspectExecutionDiagnostics(): Promise<IExecutionDiagnosticsSnapshot> {
        return this._runtime.execution.inspectDiagnostics();
    }

    /**
     * @description 为指定插件面板创建一个桥接客户端。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @returns 用于面板前端的桥接客户端
     */
    public createPanelBridgeClient(pluginId: string, panelId: string): IPanelBridgeClient {
        return this._panelManager.createPanelBridgeClient(pluginId, panelId);
    }

    /**
     * @description 把指定面板的桥接客户端注入到浏览器侧对象。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @param targetWindow 浏览器侧注入目标
     * @returns 注入后的面板桥客户端
     */
    public attachPanelBridgeToWindow(pluginId: string, panelId: string, targetWindow: IPanelBridgeBrowserWindow): IPanelBridgeClient {
        return this._browserPanelBridgeBootstrap.attach(pluginId, panelId, targetWindow);
    }

    /**
     * @description 如目标面板具备内置 UI 挂载器，则把对应浏览器侧 UI 自动挂载到窗口对象。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @param targetWindow 浏览器侧注入目标
     * @returns Promise 在自动挂载结束后完成
     */
    public async mountPanelUiToWindow(pluginId: string, panelId: string, targetWindow: IPanelBridgeBrowserWindow): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const panelUiMountBinding = this._panelUiMountRegistry.get(pluginId, panelId);
        if (panelUiMountBinding != null) {
            await panelUiMountBinding.mountPanelUi(targetWindow);
        }
    }

    /**
     * @description 把指定面板的浏览器侧 UI 从宿主窗口对象上卸载。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @param targetWindow 浏览器侧卸载目标
     * @returns Promise 在卸载结束后完成
     */
    public async unmountPanelUiFromWindow(pluginId: string, panelId: string, targetWindow: IPanelBridgeBrowserWindow): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const panelUiMountBinding = this._panelUiMountRegistry.get(pluginId, panelId);
        await panelUiMountBinding?.unmountPanelUi?.(targetWindow);
    }

    /**
     * @description 生成一段供宿主注入到面板页面的标准化 panel bridge bootstrap 脚本。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @returns 标准化的浏览器注入脚本文本
     */
    public createPanelBridgeBootstrapScript(pluginId: string, panelId: string): string {
        return this._browserPanelBridgeBootstrap.createScript(pluginId, panelId);
    }

    /**
     * @description 按已注册的面板贡献启动宿主面板容器，并可选注入 live browser bridge。
     * @param pluginId 插件标识
     * @param panelId 面板稳定标识
     * @param browserWindow 可选浏览器侧对象；提供时会直接注入 live panel bridge
     * @returns Promise 返回宿主会话快照、bootstrap 脚本和可选 live panel bridge
     */
    public async launchPanelContainer(
        pluginId: string,
        panelId: string,
        browserWindow?: IPanelBridgeBrowserWindow,
    ): Promise<IHostPanelContainerLaunchResult> {
        return this._hostPanelContainerLauncher.launchRegisteredPanel(pluginId, panelId, browserWindow);
    }

    /**
     * @description 执行已激活插件声明的宿主命令；当前支持以 `.open-panel` 结尾的单面板打开命令。
     * @param commandId 命令稳定标识
     * @returns Promise 返回命令打开的宿主面板会话、浏览器上下文和桥接注入结果
     */
    public async executePluginCommand(commandId: string): Promise<IHostPanelContainerLaunchResult> {
        // 保存命令注册记录；仅允许执行当前活动插件在注册阶段声明的命令。
        const commandRecord = this._contributionRegistry.getCommand(commandId);
        if (commandRecord == null) {
            throw new Error(`plugin_command_not_found:${commandId}`);
        }
        if (!commandRecord.contribution.handler.endsWith('.open-panel')) {
            throw new Error(`plugin_command_handler_unsupported:${commandId}`);
        }

        // 保存插件当前注册的面板；统一目录包约定每个插件只声明一个面板。
        const panels = this._contributionRegistry.listPanels(commandRecord.pluginId);
        if (panels.length === 0) {
            throw new Error(`plugin_command_panel_missing:${commandId}`);
        }
        if (panels.length > 1) {
            throw new Error(`plugin_command_panel_ambiguous:${commandId}`);
        }

        try {
            return await this.launchPanelContainer(commandRecord.pluginId, panels[0].id);
        } catch (error) {
            this._diagnosticReporter.record({ pluginId: commandRecord.pluginId, source: 'plugin_command', error, context: { commandId } });
            throw error;
        }
    }

    /**
     * @description 解析可在插件管理器内容区内嵌的唯一活动插件面板，不创建宿主窗口。
     * @param pluginId 目标插件稳定标识
     * @returns 已校验的唯一面板 contribution
     */
    public resolveEmbeddedPluginPanel(pluginId: string): IPanelContribution {
        // 保存目标插件当前运行时记录，只有活动插件允许挂载其浏览器面板。
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        if (runtimeRecord == null) {
            throw new Error(`plugin_panel_plugin_not_found:${pluginId}`);
        }
        if (runtimeRecord.state !== 'active') {
            throw new Error(`plugin_panel_plugin_not_active:${pluginId}:${runtimeRecord.state}`);
        }

        // 保存插件当前注册的面板列表，内嵌入口要求能够无歧义地解析到单个面板。
        const panels = this._contributionRegistry.listPanels(pluginId);
        if (panels.length === 0) {
            throw new Error(`plugin_panel_missing:${pluginId}`);
        }
        if (panels.length > 1) {
            throw new Error(`plugin_panel_ambiguous:${pluginId}`);
        }

        // 保存已由 ContributionRegistry 约束到安装根目录内的绝对入口。
        const panel = panels[0];
        if (!existsSync(panel.entry)) {
            throw new Error(`plugin_panel_entry_missing:${pluginId}:${panel.id}`);
        }
        return panel;
    }

    /**
     * @description 关闭指定宿主面板容器。
     * @param panelId 面板稳定标识
     * @returns Promise 在宿主面板容器关闭后结束
     */
    public async closePanelContainer(panelId: string): Promise<void> {
        await this._hostPanelContainerLauncher.close(panelId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _createRegisterContext(pluginRuntimeMeta: ReturnType<PluginRegistry['getRuntimeMeta']> extends infer T ? NonNullable<T> : never, grantedPermissionSet: IGrantedPermissionSet): IPluginRegisterContext {
        return {
            plugin: pluginRuntimeMeta,
            permissions: grantedPermissionSet,
            logger: new DefaultPluginLogger(pluginRuntimeMeta.id),
            registry: this._contributionRegistry.createRegistrationApi(pluginRuntimeMeta.id, pluginRuntimeMeta.installPath),
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _createActivateContext(pluginRuntimeMeta: ReturnType<PluginRegistry['getRuntimeMeta']> extends infer T ? NonNullable<T> : never, grantedPermissionSet: IGrantedPermissionSet): IPluginActivateContext {
        const taskApi = new PluginTaskApi(
            pluginRuntimeMeta.id,
            this._runtime,
            this._taskProjectKey ?? pluginRuntimeMeta.installPath,
            (invocation) => this._mcpCapabilityRegistry.resolveInvocationOwner(pluginRuntimeMeta.id, invocation),
        );
        this._pluginTaskApis.set(pluginRuntimeMeta.id, taskApi);
        return {
            plugin: pluginRuntimeMeta,
            permissions: grantedPermissionSet,
            logger: new DefaultPluginLogger(pluginRuntimeMeta.id),
            runtime: this._runtimeGrantFactory.create(pluginRuntimeMeta, grantedPermissionSet),
            panels: this._panelManager.createPluginPanelApi(pluginRuntimeMeta.id),
            services: {
                register: (serviceId, handler): (() => void) => {
                    return this._pluginServiceRegistry.register(pluginRuntimeMeta.id, serviceId, handler);
                },
                request: async <TResponse>(providerPluginId: string, serviceId: string, request: unknown): Promise<TResponse> => {
                    return this._pluginServiceRegistry.request(pluginRuntimeMeta.id, providerPluginId, serviceId, request) as Promise<TResponse>;
                },
            },
            mcp: {
                register: (definition, handler): (() => void) => {
                    return this._mcpCapabilityRegistry.register(pluginRuntimeMeta.id, definition, handler);
                },
                invoke: async (name: string, input: unknown): Promise<unknown> => {
                    return this._mcpCapabilityRegistry.invokeForPlugin(pluginRuntimeMeta.id, name, input);
                },
            },
            tasks: taskApi,
            events: new PluginEventBus((error, context) => {
                this._diagnosticReporter.record({ pluginId: pluginRuntimeMeta.id, source: 'event_listener', error, context });
            }),
            storage: this._getOrCreateStorage(pluginRuntimeMeta.id),
            protectedKeys: this._protectedKeyProvider?.forPlugin(pluginRuntimeMeta.id) ?? new UnavailablePluginProtectedKeyApi(),
            files: this._createPluginFileStorage(pluginRuntimeMeta.id, grantedPermissionSet),
        };
    }

    /**
     * @description 返回插件管理器拥有的项目级文件系统；未配置项目仓时返回 `null`。
     * @returns 项目级文件系统实例或 `null`
     */
    public getProjectPluginFileStore(): ProjectPluginFileStore | null {
        return this._packaging.getProjectPluginFileStore();
    }

    /** @description 获取项目文件仓；未配置项目路径时明确拒绝管理操作。 */
    private _requireProjectPluginFileStore(): ProjectPluginFileStore {
        const fileStore = this._packaging.getProjectPluginFileStore();
        if (fileStore == null) {
            throw new Error('plugin_file_storage_unavailable');
        }
        return fileStore;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requireManifest(pluginId: string) {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const manifest = this._pluginRegistry.getManifest(pluginId);
        if (manifest == null) {
            throw new Error(`Plugin manifest "${pluginId}" is not registered.`);
        }
        return manifest;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requireRuntimeMeta(pluginId: string) {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeMeta = this._pluginRegistry.getRuntimeMeta(pluginId);
        if (runtimeMeta == null) {
            throw new Error(`Plugin runtime meta "${pluginId}" is not registered.`);
        }
        return runtimeMeta;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _prepareForActivation(pluginId: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const currentState = runtimeRecord?.state ?? null;
        if (currentState == null || !this._shouldCleanupBeforeActivate(currentState)) {
            return;
        }

        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.cleanupRuntime(pluginId, 'activation_prepare');
        if (this._hasStepFailures(cleanupStepResults)) {
            // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
            const activationPrepareError = new Error('plugin_activation_prepare_cleanup_failed');
            this._recordFailure(pluginId, 'activation_prepare', currentState, activationPrepareError, cleanupStepResults, true);
            throw activationPrepareError;
        }

        this._clearFailureState(pluginId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _finalizeLifecycleResult(
        pluginId: string,
        phase: Extract<PluginFailurePhase, 'deactivate' | 'dispose'>,
        previousState: string | null,
        cleanupStepResults: readonly ICleanupStepResult[],
        installPreserved: boolean,
    ): void {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const failedCleanupStepResult = cleanupStepResults.find((cleanupStepResult) => {
            return !cleanupStepResult.ok;
        });
        if (failedCleanupStepResult != null) {
            // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
            const lifecycleError = new Error(failedCleanupStepResult.errorMessage ?? `plugin_${phase}_failed`);
            this._recordFailure(pluginId, phase, previousState, lifecycleError, cleanupStepResults, installPreserved);
            throw lifecycleError;
        }

        this._clearFailureState(pluginId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _recordFailure(
        pluginId: string,
        phase: PluginFailurePhase,
        previousState: string | null,
        error: unknown,
        cleanupStepResults: readonly ICleanupStepResult[],
        installPreserved: boolean,
    ): void {
        // 保存当前流程捕获的异常或诊断信息，供后续处理或返回。
        const normalizedError = this._normalizeError(error);
        this._diagnosticReporter.record({
            pluginId,
            source: phase === 'module_load' ? 'module_load' : 'lifecycle',
            phase,
            error,
            context: { previousState, installPreserved },
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginFailureIncident: IPluginFailureIncident = {
            pluginId,
            phase,
            previousState,
            failedAt: new Date().toISOString(),
            installPreserved,
            errorMessage: normalizedError.message,
            errorStack: normalizedError.stack,
            cleanupSteps: [...cleanupStepResults],
        };
        this._pluginFailureIncidentStore.record(pluginFailureIncident);
        this._pluginRegistry.updateState(pluginId, 'failed');
        this._pluginRegistry.updateFailureIncident(pluginId, pluginFailureIncident);
        this._pluginRegistry.updateHealth(pluginId, this._buildFailureHealthSnapshot(pluginId, phase, cleanupStepResults, normalizedError.message));
        const installPath = this._pluginRegistry.getRuntimeMeta(pluginId)?.installPath ?? null;
        new DefaultPluginLogger(pluginId).error(`Plugin ${phase} failed.`, {
            previousState,
            installPreserved,
            installPath,
            phase,
            errorMessage: normalizedError.message,
            errorStack: normalizedError.stack,
            cleanupSteps: cleanupStepResults,
        });
    }

    /**
     * @description 校验插件声明的 Cocos Creator 版本范围，避免不兼容包在动态导入前执行任意顶层代码。
     * @param manifest 已通过 packaging 校验的插件清单。
     * @returns 无返回值。
     */
    private _assertHostCompatibility(manifest: IPluginManifest): void {
        const creatorRange = manifest.engines?.creator;
        if (creatorRange == null || this._runtime.version.satisfies(creatorRange)) {
            return;
        }
        const creatorVersion = this._runtime.version.getCurrentVersion().raw;
        throw new Error(`plugin_creator_incompatible:${manifest.id}:${creatorRange}:${creatorVersion}`);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _clearFailureState(pluginId: string): void {
        this._pluginFailureIncidentStore.clear(pluginId);
        this._pluginRegistry.updateFailureIncident(pluginId, undefined);
        this._pluginRegistry.updateHealth(pluginId, undefined);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildFailureHealthSnapshot(
        pluginId: string,
        phase: string,
        cleanupStepResults: readonly ICleanupStepResult[],
        errorMessage: string | null,
    ): IPluginHealthSnapshot {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const failedStepCount = cleanupStepResults.filter((cleanupStepResult) => {
            return !cleanupStepResult.ok;
        }).length;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const diagnostics = cleanupStepResults
            .filter((cleanupStepResult) => {
                return !cleanupStepResult.ok;
            })
            .map((cleanupStepResult) => {
                return `${cleanupStepResult.targetType}:${cleanupStepResult.targetId}:${cleanupStepResult.errorMessage ?? 'unknown_cleanup_error'}`;
            });
        if (errorMessage != null) {
            diagnostics.unshift(`failure:${pluginId}:${phase}:${errorMessage}`);
        }

        return {
            status: 'failed',
            updatedAt: new Date().toISOString(),
            summary: failedStepCount > 0 ? `Plugin ${phase} failed with ${failedStepCount} cleanup issue(s).` : `Plugin ${phase} failed.`,
            diagnostics,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildCleanupRetryHealthSnapshot(pluginId: string, cleanupStepResults: readonly ICleanupStepResult[]): IPluginHealthSnapshot {
        if (this._hasStepFailures(cleanupStepResults)) {
            return this._buildFailureHealthSnapshot(pluginId, 'cleanup_retry', cleanupStepResults, 'plugin_cleanup_retry_failed');
        }

        return {
            status: 'failed',
            updatedAt: new Date().toISOString(),
            summary: 'Plugin remains quarantined after cleanup retry.',
            diagnostics: ['cleanup_retry_succeeded'],
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _hasStepFailures(cleanupStepResults: readonly ICleanupStepResult[]): boolean {
        return cleanupStepResults.some((cleanupStepResult) => {
            return !cleanupStepResult.ok;
        });
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _shouldCleanupBeforeActivate(state: string): boolean {
        return state === 'registered' || state === 'active' || state === 'inactive' || state === 'failed';
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _normalizeError(error: unknown): Error {
        if (error instanceof Error) {
            return error;
        }
        return new Error(typeof error === 'string' ? error : 'unknown_plugin_lifecycle_error');
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _restorePreviousPluginVersion(
        previousManifest: ReturnType<PluginRegistry['getManifest']> extends infer T ? NonNullable<T> : never,
        previousModule: IPluginModule,
        previousInstalledPackage: IInstalledPackageRecord,
        previousStorageSnapshot: ReadonlyMap<string, unknown>,
        trustLevel: NonNullable<ReturnType<PluginRegistry['getRuntimeMeta']>>['trustLevel'],
        shouldRestorePackage: boolean,
    ): Promise<void> {
        // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
        const previousInstallPath = shouldRestorePackage
            ? (await this._packaging.upgrade(previousInstalledPackage.packagePath)).installPath
            : previousInstalledPackage.installPath;
        this._getOrCreateStorage(previousManifest.id).restore(previousStorageSnapshot);
        this.registerManifest({
            manifest: previousManifest,
            installPath: previousInstallPath,
            trustLevel,
        });
        this.attachModule(previousManifest.id, previousModule);
        await this.activatePlugin(previousManifest.id);
        await this._panelManager.restorePluginSessions(previousManifest.id);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _disposePluginForUpgrade(pluginId: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDispose(
            pluginId,
            async (): Promise<void> => {
                await this._deactivateTaskApi(pluginId);
                await this._pluginLoader.dispose(pluginId);
                this._pluginServiceRegistry.revokeProvider(pluginId);
            },
            true,
        );
        this._finalizeLifecycleResult(pluginId, 'dispose', previousState, cleanupStepResults, true);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _teardownPluginRuntimeForUninstall(pluginId: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        if (runtimeRecord == null || runtimeRecord.state === 'disposed') {
            return;
        }

        if (runtimeRecord.state === 'active') {
            await this._deactivatePluginForUninstall(pluginId, 'manual_disable');
        }

        await this._disposePluginForUninstall(pluginId);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _disposePluginForUninstall(pluginId: string): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDispose(pluginId, async (): Promise<void> => {
            await this._deactivateTaskApi(pluginId);
            await this._pluginLoader.dispose(pluginId);
            this._pluginServiceRegistry.revokeProvider(pluginId);
        });
        this._finalizeLifecycleResult(pluginId, 'dispose', previousState, cleanupStepResults, true);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _deactivatePluginForUpgrade(pluginId: string, reason: PluginDeactivateReason): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDeactivate(
            pluginId,
            reason,
            async (): Promise<void> => {
                await this._deactivateTaskApi(pluginId);
                await this._pluginLoader.deactivate(pluginId, reason);
                this._pluginServiceRegistry.revokeProvider(pluginId);
            },
            true,
        );
        this._finalizeLifecycleResult(pluginId, 'deactivate', previousState, cleanupStepResults, true);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _deactivatePluginForUninstall(pluginId: string, reason: PluginDeactivateReason): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const previousState = this._pluginRegistry.getRuntimeRecord(pluginId)?.state ?? null;
        // 保存当前流程收集的有序结果，供后续步骤统一处理。
        const cleanupStepResults = await this._hotplugController.runDeactivate(pluginId, reason, async (): Promise<void> => {
            await this._deactivateTaskApi(pluginId);
            await this._pluginLoader.deactivate(pluginId, reason);
            this._pluginServiceRegistry.revokeProvider(pluginId);
        });
        this._finalizeLifecycleResult(pluginId, 'deactivate', previousState, cleanupStepResults, true);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _getOrCreateStorage(pluginId: string): PluginStorage {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginStorage = this._pluginStorageStore.get(pluginId) ?? new PluginStorage();
        this._pluginStorageStore.set(pluginId, pluginStorage);
        return pluginStorage;
    }

    /** @description 停用插件受管任务 API 并撤销其 executor。 */
    private async _deactivateTaskApi(pluginId: string): Promise<void> {
        const taskApi = this._pluginTaskApis.get(pluginId);
        if (taskApi == null) {
            return;
        }
        await taskApi.deactivate();
        this._pluginTaskApis.delete(pluginId);
    }

    /** @description 为当前插件创建仅能访问自身范围的文件存储客户端。 */
    private _createPluginFileStorage(pluginId: string, grantedPermissionSet: IGrantedPermissionSet): PluginFileStorage | UnavailablePluginFileStorage {
        const fileStore = this._packaging.getProjectPluginFileStore();
        return fileStore == null
            ? new UnavailablePluginFileStorage()
            : new PluginFileStorage(pluginId, fileStore, grantedPermissionSet.permissions.fs?.spaces ?? []);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _createRuntimeModuleForPackage(packagePath: string): IPluginModule | null {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const moduleFactory = this._packageRuntimeModuleFactories.get(packagePath);
        if (moduleFactory == null) {
            return null;
        }
        return moduleFactory();
    }

    /** @description 优先使用测试模块工厂；未注册时从真实目录包的 manifest main 解析生命周期模块。 */
    private async _resolveRuntimeModuleForPackage(packagePath: string, installPath: string): Promise<IPluginModule | null> {
        // 保存手工注册的模块实例，兼容现有集成测试与 builtin harness。
        const factoryModule = this._createRuntimeModuleForPackage(packagePath);
        if (factoryModule != null) {
            return factoryModule;
        }
        if (this._pluginPackageModuleResolver == null) {
            return null;
        }
        // 保存经统一包装检查读取的 manifest，避免模块解析器自行处理不可信 JSON。
        const inspection = await this._packaging.inspect(packagePath);
        if (inspection.manifest == null) {
            throw new Error(`Cannot resolve plugin module because manifest is missing: ${packagePath}`);
        }
        return this._pluginPackageModuleResolver.resolve(installPath, inspection.manifest);
    }


    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _captureUpgradePostState(
        upgradeDiagnostics: IMutablePluginUpgradeDiagnostics,
        pluginId: string,
        previousPanelSessions: readonly ReturnType<PanelManager['snapshotPluginSessions']>[number][],
    ): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeRecord = this._pluginRegistry.getRuntimeRecord(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installedPackageSnapshot = this._packaging.getInstalledPackageSnapshot(pluginId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const restoredPanelSessionCount = await this._countRestoredPanelSessions(previousPanelSessions);

        upgradeDiagnostics.currentRuntimeVersion = runtimeRecord?.version ?? null;
        upgradeDiagnostics.currentRuntimeState = runtimeRecord?.state ?? null;
        upgradeDiagnostics.activeInstalledVersion = installedPackageSnapshot?.activeVersion ?? null;
        upgradeDiagnostics.restoredPanelSessionCount = restoredPanelSessionCount;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _countRestoredPanelSessions(
        previousPanelSessions: readonly ReturnType<PanelManager['snapshotPluginSessions']>[number][],
    ): Promise<number> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const restorablePanelIds = [...new Set(previousPanelSessions
            .filter((panelSession) => {
                return panelSession.isOpen || panelSession.restoreOnActivate;
            })
            .map((panelSession) => {
                return panelSession.panelId;
            }))];
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        let restoredPanelSessionCount = 0;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const panelId of restorablePanelIds) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const panelSession = await this._runtime.panelHost.getSession(panelId);
            if (panelSession?.isOpen === true) {
                restoredPanelSessionCount += 1;
            }
        }
        return restoredPanelSessionCount;
    }

}
