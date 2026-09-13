import type { ICleanupStepResult, IPanelBridgeEnvelope, IPanelBridgeResponse, IPluginFailureExport, IPluginFailureIncident } from '@peanut/pod-protocol';
import { PackagingApp } from '@peanut/pod-engine/installation';
import { EditorApiPanelHostInstaller, RuntimeFacade } from '@peanut/pod-engine/runtime';

import { PluginManagerApp } from '../app/plugin-manager-app.js';
import { createBuiltinPluginManagerPanelRegistration } from '../builtin/builtin-plugin-manager-panel-registration.js';
import { HotplugFailurePluginModule } from './hotplug-failure-plugin-module.js';
import { UpgradeablePanelPluginModule } from './upgradeable-panel-plugin-module.js';
import type { IPluginManagerBuiltinPanelRegistration } from '../host/plugin-manager-builtin-panel-registration.js';
import type {
    IPluginFailureDetailPayload,
    IPluginFailureExportPayload,
    IPluginFailureListItemPayload,
    IPluginManagerKernelReloadPayload,
    IPluginManagerSettingsSnapshotPayload,
    IRetryCleanupPayload,
} from '../panels/plugin-manager-panel-contracts.js';
import type {
    IPluginManagerPanelBrowserWindow,
    IPluginManagerPanelUiState,
} from '../panels/plugin-manager-panel-ui.js';
import { MockPluginManagerPanelDocument } from './mock-plugin-manager-panel-document.js';

/**
 * @description 内置插件管理面板验证入口，用于端到端检查失败列表、详情、导出与重试清理动作。
 */
export class BuiltinPluginManagerPanelHarness {
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _runtime: RuntimeFacade;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _packaging: PackagingApp;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginManager: PluginManagerApp;

    /**
     * @description 创建一个新的内置插件管理面板验证入口。
     * @param creatorVersion 当前宿主绑定的 Creator 版本字符串
     */
    public constructor(creatorVersion: string) {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const hostGlobal: Record<string, unknown> = {};
        new EditorApiPanelHostInstaller(hostGlobal).installWindowFactory({
            /** @description 执行当前模块对外提供的处理流程。
 * @returns 当前操作完成后产生的处理结果。
 */
            async createWindow(): Promise<{
                /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
                loadURL: () => void;
                /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
                executeJavaScript: () => void;
                /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
                hostWindowId: string;
            }> {
                return {
                    loadURL: () => {},
                    executeJavaScript: () => {},
                    hostWindowId: 'builtin-plugin-manager-panel-window',
                };
            },
        });
        this._runtime = new RuntimeFacade(creatorVersion, {
            editorApiHostGlobal: hostGlobal,
        });
        this._packaging = new PackagingApp();
        this._pluginManager = new PluginManagerApp(this._runtime, this._packaging);
    }

    /**
     * @description 构造失败插件并通过插件管理面板执行失败列表、详情、导出和清理重试链路。
     * @returns Promise 返回面板桥交互结果摘要
     */
    public async runFailureRecoveryFlow(): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        listResponse: IPanelBridgeResponse<{ items: readonly IPluginFailureListItemPayload[] }>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        detailResponse: IPanelBridgeResponse<IPluginFailureDetailPayload>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        exportResponse: IPanelBridgeResponse<IPluginFailureExportPayload>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        retryCleanupResponse: IPanelBridgeResponse<IRetryCleanupPayload>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        notifications: readonly IPanelBridgeEnvelope<IRetryCleanupPayload>[];
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const hotplugFailurePluginModule = new HotplugFailurePluginModule({
            disposerFailureCount: 1,
            pluginId: 'builtin.plugin-manager.failure-target',
        });
        this._pluginManager.registerManifest({
            manifest: hotplugFailurePluginModule.manifest,
            installPath: 'plugins/builtin-plugin-manager-failure-target',
            trustLevel: 'community',
        });
        this._pluginManager.attachModule(hotplugFailurePluginModule.manifest.id, hotplugFailurePluginModule);
        await this._pluginManager.activatePlugin(hotplugFailurePluginModule.manifest.id);
        await this._captureDeactivateFailure(hotplugFailurePluginModule.manifest.id);

        hotplugFailurePluginModule.clearDisposerFailures();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const panelBridgeClient = this._pluginManager.createPanelBridgeClient(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const notifications: IPanelBridgeEnvelope<IRetryCleanupPayload>[] = [];
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const unsubscribe = panelBridgeClient.subscribe<IRetryCleanupPayload>('pluginManager.failure.updated', (envelope): void => {
            notifications.push(envelope);
        });

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const listResponse = await panelBridgeClient.request<{}, { items: readonly IPluginFailureListItemPayload[] }>({
            id: 'plugin-manager-failure-list',
            event: 'pluginManager.failure.list',
            expectsResponse: true,
            payload: {},
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const detailResponse = await panelBridgeClient.request<{ pluginId: string }, IPluginFailureDetailPayload>({
            id: 'plugin-manager-failure-detail',
            event: 'pluginManager.failure.detail',
            expectsResponse: true,
            payload: {
                pluginId: hotplugFailurePluginModule.manifest.id,
            },
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const exportResponse = await panelBridgeClient.request<{ pluginId: string }, IPluginFailureExportPayload>({
            id: 'plugin-manager-failure-export',
            event: 'pluginManager.failure.export',
            expectsResponse: true,
            payload: {
                pluginId: hotplugFailurePluginModule.manifest.id,
            },
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const retryCleanupResponse = await panelBridgeClient.request<{ pluginId: string }, IRetryCleanupPayload>({
            id: 'plugin-manager-failure-retry-cleanup',
            event: 'pluginManager.failure.retryCleanup',
            expectsResponse: true,
            payload: {
                pluginId: hotplugFailurePluginModule.manifest.id,
            },
        });

        unsubscribe();
        await panelBridgeClient.dispose();

        return {
            listResponse,
            detailResponse,
            exportResponse,
            retryCleanupResponse,
            notifications,
        };
    }

    /**
     * @description 启动带浏览器侧桥接的插件管理面板 UI，并验证选中、导出、重试与恢复刷新链路。
     * @returns Promise 返回 UI 状态、导出结果与重试后的快照
     */
    public async runBrowserUiFlow(): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        initialState: IPluginManagerPanelUiState;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        initialMarkup: string;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        exportResult: IPluginFailureExport | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        retryCleanupSteps: readonly ICleanupStepResult[];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterActivateState: IPluginManagerPanelUiState;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterDeactivateState: IPluginManagerPanelUiState;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterDisposeState: IPluginManagerPanelUiState;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        refreshedState: IPluginManagerPanelUiState;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        refreshedMarkup: string;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        browserTitle: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        browserBodyHtml: string | null;
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const hotplugFailurePluginModule = new HotplugFailurePluginModule({
            disposerFailureCount: 1,
            pluginId: 'builtin.plugin-manager.ui.failure-target',
        });
        this._pluginManager.registerManifest({
            manifest: hotplugFailurePluginModule.manifest,
            installPath: 'plugins/builtin-plugin-manager-ui-failure-target',
            trustLevel: 'community',
        });
        this._pluginManager.attachModule(hotplugFailurePluginModule.manifest.id, hotplugFailurePluginModule);
        await this._pluginManager.activatePlugin(hotplugFailurePluginModule.manifest.id);
        await this._captureDeactivateFailure(hotplugFailurePluginModule.manifest.id);

        hotplugFailurePluginModule.clearDisposerFailures();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelDocument = new MockPluginManagerPanelDocument();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserWindow: IPluginManagerPanelBrowserWindow = {
            document: pluginManagerPanelDocument,
        };
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            browserWindow,
        );

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiController = browserWindow.pluginManagerPanelUi;
        if (pluginManagerPanelUiController == null || browserWindow.pluginManagerPanelUiActions == null) {
            throw new Error('plugin_manager_panel_ui_not_mounted');
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const initialState = pluginManagerPanelUiController.state;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const initialMarkup = pluginManagerPanelUiController.renderMarkup();
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-export')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const exportResult = pluginManagerPanelUiController.state.selectedFailureExport;
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-retry-cleanup')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const retryCleanupSteps = pluginManagerPanelUiController.state.lastCleanupSteps;
        await this._pluginManager.activatePlugin(hotplugFailurePluginModule.manifest.id);
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-refresh')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const refreshedState = pluginManagerPanelUiController.state;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const refreshedMarkup = pluginManagerPanelUiController.renderMarkup();
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-deactivate')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterDeactivateState = pluginManagerPanelUiController.state;
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-activate')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterActivateState = pluginManagerPanelUiController.state;
        await pluginManagerPanelDocument.getElementById('plugin-manager-action-dispose')?.click();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterDisposeState = pluginManagerPanelUiController.state;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserTitle = browserWindow.documentTitle ?? null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserBodyHtml =
            pluginManagerPanelDocument.body.innerHTML.length > 0
                ? pluginManagerPanelDocument.body.innerHTML
                : (browserWindow.documentBodyHtml ?? null);

        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);

        return {
            initialState,
            initialMarkup,
            exportResult,
            retryCleanupSteps,
            afterActivateState,
            afterDeactivateState,
            afterDisposeState,
            refreshedState,
            refreshedMarkup,
            browserTitle,
            browserBodyHtml,
        };
    }

    /**
     * @description 通过内置插件管理面板执行一次 plan/install/upgrade/uninstall 包动作链路。
     * @returns Promise 返回每一步后的安装快照与摘要
     */
    public async runPackageActionFlow(): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        planSummary: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installSummary: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installActiveVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installRuntimeVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        upgradeSummary: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        upgradeActiveVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        upgradeRuntimeVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallSummary: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallInstalledSnapshot: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallSelectedPluginId: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallRuntimeVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallRuntimePluginIds: readonly string[];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallActionDisabled: boolean;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        recentPackagePathsAfterRemount: readonly string[];
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginModuleV1 = new UpgradeablePanelPluginModule({
            pluginId: 'builtin.plugin-manager.package-target',
            version: '0.1.0',
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginModuleV2 = new UpgradeablePanelPluginModule({
            pluginId: 'builtin.plugin-manager.package-target',
            version: '0.2.0',
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packagePathV1 = (await this._packaging.pack('plugins/package-target/v0.1.0', pluginModuleV1.manifest)).packagePath;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packagePathV2 = (await this._packaging.pack('plugins/package-target/v0.2.0', pluginModuleV2.manifest)).packagePath;
        this._pluginManager.registerPackageRuntimeModule(packagePathV1, () => {
            return new UpgradeablePanelPluginModule({
                pluginId: 'builtin.plugin-manager.package-target',
                version: '0.1.0',
            });
        });
        this._pluginManager.registerPackageRuntimeModule(packagePathV2, () => {
            return new UpgradeablePanelPluginModule({
                pluginId: 'builtin.plugin-manager.package-target',
                version: '0.2.0',
            });
        });

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelDocument = new MockPluginManagerPanelDocument();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserWindow: IPluginManagerPanelBrowserWindow = {
            document: pluginManagerPanelDocument,
        };
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            browserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiActions = browserWindow.pluginManagerPanelUiActions;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiController = browserWindow.pluginManagerPanelUi;
        if (pluginManagerPanelUiActions == null || pluginManagerPanelUiController == null) {
            throw new Error('plugin_manager_panel_ui_not_mounted');
        }

        await pluginManagerPanelUiActions.planPackage(packagePathV1);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const planSummary = pluginManagerPanelUiController.state.lastPackageActionSummary;
        await pluginManagerPanelUiActions.installAndActivatePackage(packagePathV1);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installSummary = pluginManagerPanelUiController.state.lastPackageActionSummary;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installActiveVersion = pluginManagerPanelUiController.state.selectedInstalledPackageSnapshot?.activeVersion ?? null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installRuntimeVersion = pluginManagerPanelUiController.state.selectedRuntimeRecord?.version ?? null;
        await pluginManagerPanelUiActions.upgradeAndActivatePackage(packagePathV2);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const upgradeSummary = pluginManagerPanelUiController.state.lastPackageActionSummary;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const upgradeActiveVersion = pluginManagerPanelUiController.state.selectedInstalledPackageSnapshot?.activeVersion ?? null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const upgradeRuntimeVersion = pluginManagerPanelUiController.state.selectedRuntimeRecord?.version ?? null;
        await pluginManagerPanelUiActions.uninstallSelectedPackage();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallSummary = pluginManagerPanelUiController.state.lastPackageActionSummary;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallInstalledSnapshot = pluginManagerPanelUiController.state.selectedInstalledPackageSnapshot?.activeVersion ?? null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallSelectedPluginId = pluginManagerPanelUiController.state.selectedPluginId;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallRuntimeVersion = pluginManagerPanelUiController.state.selectedRuntimeRecord?.version ?? null;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallRuntimePluginIds = pluginManagerPanelUiController.state.runtimeRecords.map((runtimeRecord) => {
            return runtimeRecord.pluginId;
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallActionDisabled = pluginManagerPanelDocument.getElementById('plugin-manager-action-uninstall-package')?.disabled ?? false;

        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const remountedBrowserWindow: IPluginManagerPanelBrowserWindow = {};
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            remountedBrowserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const recentPackagePathsAfterRemount = remountedBrowserWindow.pluginManagerPanelUi?.state.recentPackagePaths ?? [];
        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);

        return {
            planSummary,
            installSummary,
            installActiveVersion,
            installRuntimeVersion,
            upgradeSummary,
            upgradeActiveVersion,
            upgradeRuntimeVersion,
            uninstallSummary,
            uninstallInstalledSnapshot,
            uninstallSelectedPluginId,
            uninstallRuntimeVersion,
            uninstallRuntimePluginIds,
            uninstallActionDisabled,
            recentPackagePathsAfterRemount,
        };
    }

    /**
     * @description 通过内置插件管理面板触发一次卸载失败链路，并返回失败后的 UI 收口状态。
     * @param failureStage 卸载前 teardown 期望失败的生命周期阶段
     * @returns Promise 返回卸载失败后的 UI 状态摘要
     */
    public async runPackageUninstallFailureFlow(
        failureStage: 'deactivate' | 'dispose',
    ): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        status: IPluginManagerPanelUiState['status'];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        lastError: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectedPluginId: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectedRuntimeState: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectedIncidentPhase: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installedActiveVersion: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallActionDisabled: boolean;
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const failingPluginId = `builtin.plugin-manager.uninstall-failure-${failureStage}`;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packagedFailurePluginModule = new HotplugFailurePluginModule({
            failureStage,
            pluginId: failingPluginId,
        });
        // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
        const packagePath = (await this._packaging.pack(`plugins/uninstall-failure/${failureStage}`, packagedFailurePluginModule.manifest)).packagePath;
        this._pluginManager.registerPackageRuntimeModule(packagePath, () => {
            return new HotplugFailurePluginModule({
                failureStage,
                pluginId: failingPluginId,
            });
        });

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelDocument = new MockPluginManagerPanelDocument();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserWindow: IPluginManagerPanelBrowserWindow = {
            document: pluginManagerPanelDocument,
        };
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            browserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiActions = browserWindow.pluginManagerPanelUiActions;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiController = browserWindow.pluginManagerPanelUi;
        if (pluginManagerPanelUiActions == null || pluginManagerPanelUiController == null) {
            throw new Error('plugin_manager_panel_ui_not_mounted');
        }

        await pluginManagerPanelUiActions.installAndActivatePackage(packagePath);
        await pluginManagerPanelUiActions.uninstallSelectedPackage();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const uninstallActionDisabled = pluginManagerPanelDocument.getElementById('plugin-manager-action-uninstall-package')?.disabled ?? false;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const result = {
            status: pluginManagerPanelUiController.state.status,
            lastError: pluginManagerPanelUiController.state.lastError,
            selectedPluginId: pluginManagerPanelUiController.state.selectedPluginId,
            selectedRuntimeState: pluginManagerPanelUiController.state.selectedRuntimeRecord?.state ?? null,
            selectedIncidentPhase: pluginManagerPanelUiController.state.selectedIncident?.phase ?? null,
            installedActiveVersion: pluginManagerPanelUiController.state.selectedInstalledPackageSnapshot?.activeVersion ?? null,
            uninstallActionDisabled,
        };

        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);

        return result;
    }

    /**
     * @description 写入一组面板偏好并在重新挂载后验证其是否从 storage 恢复。
     * @returns Promise 返回重挂载后的偏好和当前选中项摘要
     */
    public async runPanelPreferencesPersistenceFlow(): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        locale: string;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        packageFilter: string;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        packageCatalogSort: string;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectedPluginId: string | null;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectedPackagePath: string | null;
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginModuleV1 = new UpgradeablePanelPluginModule({
            pluginId: 'builtin.plugin-manager.preferences-target',
            version: '0.1.0',
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packagePathV1 = (await this._packaging.pack('plugins/preferences-target/v0.1.0', pluginModuleV1.manifest)).packagePath;
        this._pluginManager.registerPackageRuntimeModule(packagePathV1, () => {
            return new UpgradeablePanelPluginModule({
                pluginId: 'builtin.plugin-manager.preferences-target',
                version: '0.1.0',
            });
        });

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserWindow: IPluginManagerPanelBrowserWindow = {};
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            browserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiActions = browserWindow.pluginManagerPanelUiActions;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiController = browserWindow.pluginManagerPanelUi;
        if (pluginManagerPanelUiActions == null || pluginManagerPanelUiController == null) {
            throw new Error('plugin_manager_panel_ui_not_mounted');
        }

        await pluginManagerPanelUiActions.installAndActivatePackage(packagePathV1);
        await pluginManagerPanelUiActions.selectPackageCatalogItem(packagePathV1);
        await pluginManagerPanelUiActions.updatePreferences({
            locale: 'zh-CN',
            packageFilter: 'installed',
            packageCatalogSort: 'recent-first',
        });

        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const remountedBrowserWindow: IPluginManagerPanelBrowserWindow = {};
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            remountedBrowserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const remountedState = remountedBrowserWindow.pluginManagerPanelUi?.state;
        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);
        if (remountedState == null) {
            throw new Error('plugin_manager_panel_ui_not_remounted');
        }

        return {
            locale: remountedState.preferences.locale,
            packageFilter: remountedState.preferences.packageFilter,
            packageCatalogSort: remountedState.preferences.packageCatalogSort,
            selectedPluginId: remountedState.selectedPluginId,
            selectedPackagePath: remountedState.selectedPackagePath,
        };
    }

    /**
     * @description 通过 Panel Bridge 验证独立设置快照、保存通知与版本冲突保护。
     * @returns Promise 返回保存结果与冲突保护摘要
     */
    public async runSettingsUpdateFlow(): Promise<{
        initialRevision: number;
        savedRevision: number;
        locale: string;
        packageFilter: string;
        packageCatalogSort: string;
        notificationCount: number;
        conflictRejected: boolean;
    }> {
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();
        const panelBridgeClient = this._pluginManager.createPanelBridgeClient(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
        );
        const notifications: IPanelBridgeEnvelope<IPluginManagerSettingsSnapshotPayload>[] = [];
        const unsubscribe = panelBridgeClient.subscribe<IPluginManagerSettingsSnapshotPayload>(
            'pluginManager.settings.updated',
            (envelope): void => {
                notifications.push(envelope);
            },
        );
        const initialResponse = await panelBridgeClient.request<{}, IPluginManagerSettingsSnapshotPayload>({
            id: 'plugin-manager-settings-snapshot',
            event: 'pluginManager.settings.snapshot',
            expectsResponse: true,
            payload: {},
        });
        if (!initialResponse.ok || initialResponse.payload == null) {
            throw new Error('plugin_manager_settings_snapshot_failed');
        }
        const savedResponse = await panelBridgeClient.request<
            { expectedRevision: number; preferences: { locale: 'en-US'; packageFilter: 'installed'; packageCatalogSort: 'recent-first' } },
            IPluginManagerSettingsSnapshotPayload
        >({
            id: 'plugin-manager-settings-update',
            event: 'pluginManager.settings.update',
            expectsResponse: true,
            payload: {
                expectedRevision: initialResponse.payload.revision,
                preferences: {
                    locale: 'en-US',
                    packageFilter: 'installed',
                    packageCatalogSort: 'recent-first',
                },
            },
        });
        if (!savedResponse.ok || savedResponse.payload == null) {
            throw new Error('plugin_manager_settings_update_failed');
        }
        const conflictResponse = await panelBridgeClient.request<
            { expectedRevision: number; preferences: { locale: 'zh-CN'; packageFilter: 'all'; packageCatalogSort: 'plugin-id-asc' } },
            IPluginManagerSettingsSnapshotPayload
        >({
            id: 'plugin-manager-settings-conflict',
            event: 'pluginManager.settings.update',
            expectsResponse: true,
            payload: {
                expectedRevision: initialResponse.payload.revision,
                preferences: {
                    locale: 'zh-CN',
                    packageFilter: 'all',
                    packageCatalogSort: 'plugin-id-asc',
                },
            },
        });
        unsubscribe();
        return {
            initialRevision: initialResponse.payload.revision,
            savedRevision: savedResponse.payload.revision,
            locale: savedResponse.payload.preferences.locale,
            packageFilter: savedResponse.payload.preferences.packageFilter,
            packageCatalogSort: savedResponse.payload.preferences.packageCatalogSort,
            notificationCount: notifications.length,
            conflictRejected: conflictResponse.ok === false,
        };
    }

    /**
     * @description 注册并删除一个 manual source，验证来源注册表在重挂载后保持一致。
     * @returns Promise 返回注册前后与重挂载后的来源状态摘要
     */
    public async runManualSourceRegistryFlow(): Promise<{
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterRegisterSourceKinds: readonly string[];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterRegisterPackagePaths: readonly string[];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterRemovePackagePaths: readonly string[];
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        afterRemountPackagePaths: readonly string[];
    }> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = await this._activateBuiltinPluginManagerPanel();

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const browserWindow: IPluginManagerPanelBrowserWindow = {};
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            browserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiActions = browserWindow.pluginManagerPanelUiActions;
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerPanelUiController = browserWindow.pluginManagerPanelUi;
        if (pluginManagerPanelUiActions == null || pluginManagerPanelUiController == null) {
            throw new Error('plugin_manager_panel_ui_not_mounted');
        }

        await pluginManagerPanelUiActions.registerPackageSource({
            sourceKind: 'manual',
            pluginId: 'manual.registry.plugin',
            version: '9.9.9',
            sourcePath: 'manual-sources/demo',
            packagePath: 'packages/manual.registry.plugin-9.9.9.pcp',
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterRegisterSourceKinds = pluginManagerPanelUiController.state.packageCatalog.map((packageCatalogItem) => {
            return packageCatalogItem.sourceKind;
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterRegisterPackagePaths = pluginManagerPanelUiController.state.packageCatalog.map((packageCatalogItem) => {
            return packageCatalogItem.packagePath;
        });

        await pluginManagerPanelUiActions.removePackageSource('packages/manual.registry.plugin-9.9.9.pcp');
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterRemovePackagePaths = pluginManagerPanelUiController.state.packageCatalog.map((packageCatalogItem) => {
            return packageCatalogItem.packagePath;
        });

        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const remountedBrowserWindow: IPluginManagerPanelBrowserWindow = {};
        await this._pluginManager.launchPanelContainer(
            builtinPluginManagerPanelRegistration.pluginId,
            builtinPluginManagerPanelRegistration.panelId,
            remountedBrowserWindow,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const afterRemountPackagePaths = remountedBrowserWindow.pluginManagerPanelUi?.state.packageCatalog.map((packageCatalogItem) => {
            return packageCatalogItem.packagePath;
        }) ?? [];
        await this._pluginManager.closePanelContainer(builtinPluginManagerPanelRegistration.panelId);

        return {
            afterRegisterSourceKinds,
            afterRegisterPackagePaths,
            afterRemovePackagePaths,
            afterRemountPackagePaths,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _captureDeactivateFailure(pluginId: string): Promise<void> {
        try {
            await this._pluginManager.deactivatePlugin(pluginId, 'manual_disable');
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            void error;
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _activateBuiltinPluginManagerPanel(): Promise<IPluginManagerBuiltinPanelRegistration> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPluginManagerPanelRegistration = createBuiltinPluginManagerPanelRegistration();
        await builtinPluginManagerPanelRegistration.register(this._pluginManager, async (): Promise<void> => {});
        return builtinPluginManagerPanelRegistration;
    }
}
