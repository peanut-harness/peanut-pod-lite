import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IPluginFailureIncident, IPluginManifest, IPluginRuntimeRecord } from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import { PluginManagerApp } from '../app/plugin-manager-app.js';
import { PluginDevelopmentController } from '../development/plugin-development-controller.js';
import { PluginTemplateGenerator, type PluginTemplateKind } from '../development/plugin-template-generator.js';
import type {
    IPluginEmbeddedPanelPayload,
    IPluginFailureDetailPayload,
    IPluginFailureExportPayload,
    IPluginFailureListItemPayload,
    IPluginManagerEditablePanelPreferencesPayload,
    IPluginManagerKernelReloadPayload,
    IPluginManagerMcpEnabledUpdatePayload,
    IPluginManagerMcpHubPayload,
    IPluginManagerMcpPluginExposureUpdatePayload,
    IPluginManagerMcpPluginEnabledUpdatePayload,
    IPluginManagerMcpPlanActionPayload,
    IPluginPackageVersionActionPayload,
    IPluginPackageVersionsPayload,
    PluginManagerPanelLocale,
    IPluginManagerPanelPreferencesPayload,
    IPluginManagerSettingsSnapshotPayload,
    IPluginManagerSettingsUpdatePayload,
    IPluginPackageCatalogItemPayload,
    IPluginManagerInstalledPackageSnapshotPayload,
    IPluginManagerSnapshotPayload,
    IPluginManagerTrustedCatalogPayload,
    IPluginManualPackageSourceInputPayload,
    IPluginPackageActionPayload,
    IPluginPackageSourceActionPayload,
    IPluginPackagePlanPayload,
    IPluginRuntimeActionPayload,
    IPluginStorageClearPayload,
    IPluginStorageReconcilePayload,
    IPluginStorageSummaryPayload,
    IRetryCleanupPayload,
} from '../panels/plugin-manager-panel-contracts.js';
import type { IPluginActivateContext, IPluginModule, IPluginRegisterContext } from '../shared/plugin-manager-contracts.js';

/**
 * @description 内置插件管理面板插件，用于展示失败插件、导出失败详情并触发清理重试。
 */
export class BuiltinPluginManagerPanelModule implements IPluginModule {
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly PANEL_ID: string = 'builtin.plugin-manager.panel';
    /** @description 内置管理器设置面板稳定标识。 */
    private static readonly SETTINGS_PANEL_ID: string = 'builtin.plugin-manager.settings';
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly RECENT_PACKAGE_PATHS_STORAGE_KEY: string = 'pluginManager.recentPackagePaths';
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly PANEL_PREFERENCES_STORAGE_KEY: string = 'pluginManager.panelPreferences';
    /** @description 管理器设置版本存储键。 */
    private static readonly SETTINGS_REVISION_STORAGE_KEY: string = 'pluginManager.settingsRevision';
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly MANUAL_PACKAGE_SOURCES_STORAGE_KEY: string = 'pluginManager.manualPackageSources';
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly MAX_RECENT_PACKAGE_PATHS: number = 8;

    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginManager: PluginManagerApp;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _requestKernelReload?: () => Promise<void> | void;
    /**
     * @description 只读取宿主已经验签的目录视图；面板模块不发起网络请求。
     */
    private readonly _readTrustedCatalog?: () => Promise<IPluginManagerTrustedCatalogPayload> | IPluginManagerTrustedCatalogPayload;

    /**
     * @description 内置插件管理面板插件运行时清单。
     */
    public readonly manifest = {
        id: 'builtin.plugin-manager.panel',
        version: '0.1.0',
        kind: 'panel-plugin',
        displayName: 'Builtin Plugin Manager Panel',
        description: {
            'en-US': 'Exposes failure incident inspection and recovery actions through a builtin management panel.',
            'zh-CN': '通过内置管理面板提供故障事件查看和恢复操作。',
        },
        main: './builtin/builtin-plugin-manager-panel-module.ts',
        engines: {
            host: '^0.1.0',
        },
        activation: {
            autoActivate: false,
            events: [],
        },
        permissions: {
            panel: {
                open: true,
                embed: true,
            },
        },
        contributions: {
            panels: [
                {
                    id: BuiltinPluginManagerPanelModule.PANEL_ID,
                    title: 'Plugin Manager',
                    entry: 'panels/plugin-manager/embedded/index.html',
                    placement: 'utility',
                    singleton: true,
                    activationPolicy: 'manual',
                    sessionPolicy: 'restore_layout',
                },
                {
                    id: BuiltinPluginManagerPanelModule.SETTINGS_PANEL_ID,
                    title: 'Plugin Manager Settings',
                    entry: 'panels/plugin-manager-settings/embedded/index.html',
                    placement: 'utility',
                    singleton: true,
                    activationPolicy: 'manual',
                    sessionPolicy: 'restore_layout',
                },
            ],
        },
    } as const;

    /**
     * @description 创建一个新的内置插件管理面板插件。
     * @param pluginManager 插件管理器主入口
     */
    public constructor(
        pluginManager: PluginManagerApp,
        requestKernelReload?: () => Promise<void> | void,
        readTrustedCatalog?: () => Promise<IPluginManagerTrustedCatalogPayload> | IPluginManagerTrustedCatalogPayload,
    ) {
        this._pluginManager = pluginManager;
        this._requestKernelReload = requestKernelReload;
        this._readTrustedCatalog = readTrustedCatalog;
    }

    /**
     * @description 返回插件管理面板稳定标识。
     * @returns 插件管理面板稳定标识
     */
    public get panelId(): string {
        return BuiltinPluginManagerPanelModule.PANEL_ID;
    }

    /**
     * @description 在注册阶段声明插件管理面板贡献。
     * @param context 插件注册阶段上下文
     * @returns Promise 在注册完成后结束
     */
    public async register(context: IPluginRegisterContext): Promise<void> {
        context.registry.registerPanel({
            id: BuiltinPluginManagerPanelModule.PANEL_ID,
            title: 'Plugin Manager',
            entry: 'panels/plugin-manager/embedded/index.html',
            placement: 'utility',
            singleton: true,
            activationPolicy: 'manual',
            sessionPolicy: 'restore_layout',
        });
        context.registry.registerPanel({
            id: BuiltinPluginManagerPanelModule.SETTINGS_PANEL_ID,
            title: 'Plugin Manager Settings',
            entry: 'panels/plugin-manager-settings/embedded/index.html',
            placement: 'utility',
            singleton: true,
            activationPolicy: 'manual',
            sessionPolicy: 'restore_layout',
        });
    }

    /**
     * @description 在激活阶段注册运行时快照、失败详情、导出与清理重试桥接请求。
     * @param context 插件激活阶段上下文
     * @returns Promise 在激活完成后结束
     */
    public async activate(context: IPluginActivateContext): Promise<void> {
        const developmentController = new PluginDevelopmentController(this._pluginManager);
        const pluginTemplateGenerator = new PluginTemplateGenerator();
        context.panels.onRequest<{ pluginId: string; displayName: string; targetDirectory: string; kind: PluginTemplateKind }, { pluginId: string; targetDirectory: string; files: readonly string[] }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.authoring.create',
            async (request) => {
                const payload = request.payload;
                if (payload == null) throw new Error('plugin_template_request_invalid');
                const result = pluginTemplateGenerator.generate(payload);
                return { pluginId: result.pluginId, targetDirectory: result.targetDirectory, files: result.files };
            },
        );
        context.panels.onRequest<{ sourcePath: string }, { packagePath: string; pluginId: string; version: string; validation: unknown }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.pack',
            async (request) => {
                const sourcePath = this._requirePackagePath(request.payload?.sourcePath);
                const manifest = this._readPackManifest(sourcePath);
                const packResult = await this._pluginManager.packageAuthoring.pack(sourcePath, manifest);
                const validation = await this._pluginManager.packageAuthoring.validate(packResult.packagePath);
                if (validation.ok !== true) throw new Error(`plugin_package_invalid:${validation.issues.join(',')}`);
                return { packagePath: packResult.packagePath, pluginId: manifest.id, version: manifest.version, validation };
            },
        );
        context.panels.onRequest<{}, IPluginManagerSnapshotPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.snapshot',
            async (): Promise<IPluginManagerSnapshotPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const manualPackageSources = await this._readManualPackageSources(context);
                let trustedCatalog: IPluginManagerTrustedCatalogPayload = {
                    status: 'unavailable',
                    channel: null,
                    generatedAt: null,
                    products: [],
                };
                try {
                    if (this._readTrustedCatalog != null) trustedCatalog = await this._readTrustedCatalog();
                } catch {
                    // 目录读取失败不影响本地包和已安装版本的显示。
                }
                return {
                    runtimeRecords: this._pluginManager.listRuntimeRecords(),
                    failureItems: this._pluginManager.listFailureIncidents().map((incident) => {
                        return this._buildFailureListItemPayload(incident);
                    }),
                    packageCatalog: this._buildPackageCatalog(manualPackageSources),
                    trustedCatalog,
                    recentPackagePaths: await this._readRecentPackagePaths(context),
                    preferences: await this._readPanelPreferences(context),
                    kernelReloadSupported: this._requestKernelReload != null,
                    executionDiagnosticsSnapshot: await this._pluginManager.inspectExecutionDiagnostics(),
                    developmentSession: developmentController.getSessionSnapshot(),
                    mcpHub: this._buildMcpHubPayload(),
                };
            },
        );
        context.panels.onRequest<IPluginManagerMcpEnabledUpdatePayload, IPluginManagerMcpHubPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.mcp.setEnabled',
            async (request): Promise<IPluginManagerMcpHubPayload> => {
                if (request.payload?.isEnabled !== true && request.payload?.isEnabled !== false) {
                    throw new Error('plugin_manager_mcp_enabled_invalid');
                }
                const control = this._pluginManager.getMcpHubControl();
                if (control == null) {
                    throw new Error('plugin_manager_mcp_hub_unavailable');
                }
                await control.setEnabled(request.payload.isEnabled);
                return this._buildMcpHubPayload();
            },
        );
        context.panels.onRequest<IPluginManagerMcpPluginEnabledUpdatePayload, IPluginManagerMcpHubPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.mcp.setPluginEnabled',
            async (request): Promise<IPluginManagerMcpHubPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                if (request.payload?.isEnabled !== true && request.payload?.isEnabled !== false) {
                    throw new Error('plugin_manager_mcp_plugin_enabled_invalid');
                }
                const control = this._pluginManager.getMcpHubControl();
                if (control == null) {
                    throw new Error('plugin_manager_mcp_hub_unavailable');
                }
                await control.setPluginEnabled(pluginId, request.payload.isEnabled);
                return this._buildMcpHubPayload();
            },
        );
        context.panels.onRequest<IPluginManagerMcpPluginExposureUpdatePayload, IPluginManagerMcpHubPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.mcp.setPluginExposure',
            async (request): Promise<IPluginManagerMcpHubPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                const mode = request.payload?.mode;
                if (mode !== 'disabled' && mode !== 'read_only' && mode !== 'all') {
                    throw new Error('plugin_manager_mcp_plugin_exposure_invalid');
                }
                const control = this._pluginManager.getMcpHubControl();
                if (control == null) {
                    throw new Error('plugin_manager_mcp_hub_unavailable');
                }
                await control.setPluginExposure(pluginId, mode);
                return this._buildMcpHubPayload();
            },
        );
        context.panels.onRequest<IPluginManagerMcpPlanActionPayload, IPluginManagerMcpHubPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.mcp.plan.approve',
            async (request): Promise<IPluginManagerMcpHubPayload> => {
                this._approveMcpPlan(request.payload?.planId);
                return this._buildMcpHubPayload();
            },
        );
        context.panels.onRequest<IPluginManagerMcpPlanActionPayload, IPluginManagerMcpHubPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.mcp.plan.reject',
            async (request): Promise<IPluginManagerMcpHubPayload> => {
                this._rejectMcpPlan(request.payload?.planId);
                return this._buildMcpHubPayload();
            },
        );
        context.panels.onRequest<{}, IPluginManagerKernelReloadPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.kernel.reload',
            async (): Promise<IPluginManagerKernelReloadPayload> => {
                if (this._requestKernelReload == null) {
                    return {
                        accepted: false,
                    };
                }
                await this._requestKernelReload();
                return {
                    accepted: true,
                };
            },
        );
        context.panels.onRequest<{}, IExecutionDiagnosticsSnapshot>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.executionDiagnostics',
            async (): Promise<IExecutionDiagnosticsSnapshot> => {
                return this._pluginManager.inspectExecutionDiagnostics();
            },
        );
        context.panels.onRequest<
            {},
            {
                readonly runtimeRecords: readonly IPluginRuntimeRecord[];
                readonly developmentSession: ReturnType<PluginDevelopmentController['getSessionSnapshot']>;
            }
        >(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.development.status',
            async (): Promise<{
                readonly runtimeRecords: readonly IPluginRuntimeRecord[];
                readonly developmentSession: ReturnType<PluginDevelopmentController['getSessionSnapshot']>;
            }> => ({
                runtimeRecords: developmentController.status(),
                developmentSession: developmentController.getSessionSnapshot(),
            }),
        );
        context.panels.onRequest<{}, { readonly accepted: boolean }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.development.reconcile',
            async (): Promise<{ readonly accepted: boolean }> => {
                const startedAt = Date.now();
                try {
                    await developmentController.reconcile();
                    developmentController.recordOperation('panel.reconcile', null, Date.now() - startedAt, true);
                } catch (error) {
                    developmentController.recordOperation(
                        'panel.reconcile',
                        null,
                        Date.now() - startedAt,
                        false,
                        error instanceof Error ? error.message : 'plugin_manager_development_reconcile_failed',
                    );
                    throw error;
                }
                return { accepted: true };
            },
        );
        context.panels.onRequest<{ readonly pluginId: string }, { readonly accepted: boolean }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.development.reload',
            async (request): Promise<{ readonly accepted: boolean }> => {
                const pluginId = request.payload?.pluginId?.trim();
                if (pluginId == null || pluginId.length === 0) {
                    throw new Error('plugin_manager_development_reload_plugin_id_invalid');
                }
                const startedAt = Date.now();
                try {
                    await developmentController.reload(pluginId);
                    developmentController.recordOperation('panel.reload', pluginId, Date.now() - startedAt, true);
                } catch (error) {
                    developmentController.recordOperation(
                        'panel.reload',
                        pluginId,
                        Date.now() - startedAt,
                        false,
                        error instanceof Error ? error.message : 'plugin_manager_development_reload_failed',
                    );
                    throw error;
                }
                return { accepted: true };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{}, { items: readonly IPluginFailureListItemPayload[] }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.failure.list',
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            async (): Promise<{ items: readonly IPluginFailureListItemPayload[] }> => {
                return {
                    items: this._pluginManager.listFailureIncidents().map((incident) => {
                        return this._buildFailureListItemPayload(incident);
                    }),
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginFailureDetailPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.failure.detail',
            async (request): Promise<IPluginFailureDetailPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                return {
                    runtimeRecord: this._getRuntimeRecord(pluginId),
                    incident: this._pluginManager.getFailureIncident(pluginId),
                    installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(pluginId),
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginFailureExportPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.failure.export',
            async (request): Promise<IPluginFailureExportPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const diagnosticExport = this._pluginManager.exportDiagnosticLog(pluginId);
                const pluginFailureExport = this._pluginManager.exportFailureIncident(pluginId);
                if (pluginFailureExport == null && diagnosticExport == null) {
                    throw new Error(`plugin_failure_incident_not_found:${pluginId}`);
                }
                return {
                    exportResult: pluginFailureExport,
                    diagnosticExport,
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IRetryCleanupPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.failure.retryCleanup',
            async (request): Promise<IRetryCleanupPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const cleanupSteps = await this._pluginManager.retryCleanup(pluginId);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const payload: IRetryCleanupPayload = {
                    cleanupSteps,
                    incident: this._pluginManager.getFailureIncident(pluginId),
                };
                await context.panels.notify(BuiltinPluginManagerPanelModule.PANEL_ID, {
                    id: `plugin-manager-retry-cleanup:${pluginId}`,
                    event: 'pluginManager.failure.updated',
                    payload,
                });
                return payload;
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginRuntimeActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.runtime.activate',
            async (request): Promise<IPluginRuntimeActionPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                await this._pluginManager.activatePlugin(pluginId);
                return this._buildRuntimeActionPayload(pluginId, 'activate');
            },
        );
        context.panels.onRequest<{ pluginId: string }, IPluginEmbeddedPanelPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.panel.resolve',
            async (request): Promise<IPluginEmbeddedPanelPayload> => {
                // 保存经过管理器校验的插件标识，避免非字符串载荷进入 contribution 查询。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                // 保存唯一且真实存在的面板 contribution，解析过程不会创建不可见宿主窗口。
                const panel = this._pluginManager.resolveEmbeddedPluginPanel(pluginId);
                return {
                    pluginId,
                    panelId: panel.id,
                    title: panel.title,
                    entry: panel.entry,
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginRuntimeActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.runtime.deactivate',
            async (request): Promise<IPluginRuntimeActionPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                await this._pluginManager.deactivatePlugin(pluginId, 'manual_disable');
                return this._buildRuntimeActionPayload(pluginId, 'deactivate');
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginRuntimeActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.runtime.dispose',
            async (request): Promise<IPluginRuntimeActionPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                await this._pluginManager.disposePlugin(pluginId);
                return this._buildRuntimeActionPayload(pluginId, 'dispose');
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackagePlanPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.plan',
            async (request): Promise<IPluginPackagePlanPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const installPlan = await this._pluginManager.planInstallPackage(packagePath);
                return {
                    installPlan,
                    installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(installPlan.pluginId),
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackageActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.install',
            async (request): Promise<IPluginPackageActionPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                await this._rememberRecentPackagePath(context, packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const installResult = await this._pluginManager.installPackage(packagePath);
                return this._buildPackageActionPayload('install', installResult.pluginId, installResult, null);
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackageActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.upgrade',
            async (request): Promise<IPluginPackageActionPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                await this._rememberRecentPackagePath(context, packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const installResult = await this._pluginManager.upgradePackage(packagePath);
                return this._buildPackageActionPayload('upgrade', installResult.pluginId, installResult, null);
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackageActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.installAndActivate',
            async (request): Promise<IPluginPackageActionPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                await this._rememberRecentPackagePath(context, packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const installResult = await this._pluginManager.installAndActivatePackage(packagePath);
                return this._buildPackageActionPayload('install', installResult.pluginId, installResult, null);
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackageActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.upgradeAndActivate',
            async (request): Promise<IPluginPackageActionPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                await this._rememberRecentPackagePath(context, packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const installResult = await this._pluginManager.upgradeAndActivatePackage(packagePath);
                return this._buildPackageActionPayload('upgrade', installResult.pluginId, installResult, null);
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, { recentPackagePaths: readonly string[] }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.rememberRecent',
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            async (request): Promise<{ recentPackagePaths: readonly string[] }> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const recentPackagePaths = await this._rememberRecentPackagePath(context, packagePath);
                return {
                    recentPackagePaths,
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ source: IPluginManualPackageSourceInputPayload }, IPluginPackageSourceActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.packageSource.register',
            async (request): Promise<IPluginPackageSourceActionPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const source = this._requireManualPackageSource(request.payload?.source);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const manualPackageSources = await this._registerManualPackageSource(context, source);
                return {
                    action: 'register',
                    packageCatalog: this._buildPackageCatalog(manualPackageSources),
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ packagePath: string }, IPluginPackageSourceActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.packageSource.remove',
            async (request): Promise<IPluginPackageSourceActionPayload> => {
                // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
                const packagePath = this._requirePackagePath(request.payload?.packagePath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const manualPackageSources = await this._removeManualPackageSource(context, packagePath);
                return {
                    action: 'remove',
                    packageCatalog: this._buildPackageCatalog(manualPackageSources),
                };
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<
            { preferences: Partial<IPluginManagerPanelPreferencesPayload> },
            { preferences: IPluginManagerPanelPreferencesPayload }
        >(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.preferences.update',
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            async (request): Promise<{ preferences: IPluginManagerPanelPreferencesPayload }> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const preferences = await this._writePanelPreferences(context, request.payload?.preferences ?? {});
                return {
                    preferences,
                };
            },
        );
        context.panels.onRequest<{}, IPluginManagerSettingsSnapshotPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.settings.snapshot',
            async (): Promise<IPluginManagerSettingsSnapshotPayload> => {
                return this._readSettingsSnapshot(context);
            },
        );
        context.panels.onRequest<IPluginManagerSettingsUpdatePayload, IPluginManagerSettingsSnapshotPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.settings.update',
            async (request): Promise<IPluginManagerSettingsSnapshotPayload> => {
                const snapshot = await this._updateSettings(context, request.payload);
                await context.panels.notify(BuiltinPluginManagerPanelModule.PANEL_ID, {
                    id: `plugin-manager-settings-updated:${snapshot.revision}`,
                    event: 'pluginManager.settings.updated',
                    payload: snapshot,
                });
                return snapshot;
            },
        );
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        context.panels.onRequest<{ pluginId: string }, IPluginPackageActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.uninstall',
            async (request): Promise<IPluginPackageActionPayload> => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const uninstallResult = await this._pluginManager.uninstallPackage(pluginId);
                return this._buildPackageActionPayload('uninstall', pluginId, null, uninstallResult);
            },
        );
        context.panels.onRequest<{}, { items: readonly IPluginStorageSummaryPayload[] }>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.storage.list',
            async (): Promise<{ items: readonly IPluginStorageSummaryPayload[] }> => ({
                items: this._pluginManager.listPluginStorage().map((summary) => ({
                    pluginId: summary.pluginId,
                    cacheSize: summary.cacheSize,
                    hasConfig: summary.hasConfig,
                })),
            }),
        );
        context.panels.onRequest<{ pluginId: string }, IPluginStorageClearPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.storage.clearPluginCache',
            async (request): Promise<IPluginStorageClearPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                return { scope: 'plugin', pluginId, clearedBytes: this._pluginManager.clearPluginCache(pluginId) };
            },
        );
        context.panels.onRequest<{}, IPluginStorageClearPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.storage.clearAllCaches',
            async (): Promise<IPluginStorageClearPayload> => ({
                scope: 'all',
                pluginId: null,
                clearedBytes: this._pluginManager.clearAllPluginCaches(),
            }),
        );
        context.panels.onRequest<{}, IPluginStorageReconcilePayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.storage.reconcile',
            async (): Promise<IPluginStorageReconcilePayload> => {
                const repairResult = await this._pluginManager.repairPackages();
                return { repaired: repairResult.repaired, actions: repairResult.actions };
            },
        );
        context.panels.onRequest<{ pluginId: string }, IPluginPackageVersionsPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.versions',
            async (request): Promise<IPluginPackageVersionsPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                return {
                    pluginId,
                    installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(pluginId),
                };
            },
        );
        context.panels.onRequest<{ pluginId: string; version: string }, IPluginPackageVersionActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.switchVersion',
            async (request): Promise<IPluginPackageVersionActionPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                const version = this._requirePackageVersion(request.payload?.version);
                const installedPackageSnapshot = this._pluginManager.switchInstalledPackageVersion(pluginId, version);
                if (installedPackageSnapshot == null) {
                    throw new Error(`plugin_installed_version_not_found:${pluginId}:${version}`);
                }
                return {
                    action: 'switch',
                    pluginId,
                    version,
                    installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(pluginId),
                };
            },
        );
        context.panels.onRequest<{ pluginId: string; version: string }, IPluginPackageVersionActionPayload>(
            BuiltinPluginManagerPanelModule.PANEL_ID,
            'pluginManager.package.removeVersion',
            async (request): Promise<IPluginPackageVersionActionPayload> => {
                const pluginId = this._requirePluginId(request.payload?.pluginId);
                const version = this._requirePackageVersion(request.payload?.version);
                const removedRecord = this._pluginManager.removeInstalledPackageVersion(pluginId, version);
                if (removedRecord == null) {
                    throw new Error(`plugin_inactive_installed_version_not_found:${pluginId}:${version}`);
                }
                return {
                    action: 'remove',
                    pluginId,
                    version,
                    installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(pluginId),
                };
            },
        );

        await context.panels.open(BuiltinPluginManagerPanelModule.PANEL_ID);
        await context.panels.focus(BuiltinPluginManagerPanelModule.PANEL_ID);
    }

    /**
     * @description 在停用阶段不保留额外运行态缓存。
     * @param reason 插件停用原因
     * @returns Promise 在停用完成后结束
     */
    public async deactivate(
        reason: 'host_reload' | 'host_shutdown' | 'plugin_update' | 'dependency_lost' | 'manual_disable',
    ): Promise<void> {
        void reason;
    }

    /**
     * @description 在释放阶段不保留额外资源。
     * @returns Promise 在释放完成后结束
     */
    public async dispose(): Promise<void> {}

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildFailureListItemPayload(incident: IPluginFailureIncident): IPluginFailureListItemPayload {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const runtimeRecord = this._getRuntimeRecord(incident.pluginId);
        return {
            pluginId: incident.pluginId,
            state: runtimeRecord?.state ?? null,
            phase: incident.phase,
            failedAt: incident.failedAt,
            installPreserved: incident.installPreserved,
            summary: runtimeRecord?.health?.summary ?? null,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildRuntimeActionPayload(pluginId: string, action: IPluginRuntimeActionPayload['action']): IPluginRuntimeActionPayload {
        return {
            action,
            runtimeRecord: this._getRuntimeRecord(pluginId),
            incident: this._pluginManager.getFailureIncident(pluginId),
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildInstalledPackageSnapshotPayload(pluginId: string): IPluginManagerInstalledPackageSnapshotPayload | null {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const installedPackageSnapshot = this._pluginManager.getInstalledPackageSnapshot(pluginId);
        if (installedPackageSnapshot == null) {
            return null;
        }

        return {
            pluginId: installedPackageSnapshot.pluginId,
            activeVersion: installedPackageSnapshot.activeVersion,
            versions: installedPackageSnapshot.versions.map((installedPackageRecord) => {
                return installedPackageRecord.version;
            }),
        };
    }

    /** @description 生成当前编辑器 MCP Hub 的面板安全快照。 */
    private _buildMcpHubPayload(): IPluginManagerMcpHubPayload {
        const control = this._pluginManager.getMcpHubControl();
        if (control == null) {
            return {
                isAvailable: false,
                isEnabled: false,
                port: null,
                preferredPort: null,
                catalogRevision: 0,
                capabilities: [],
                disabledPluginIds: [],
                writeEnabledPluginIds: [],
                directWriteEnabled: false,
                pendingPlans: [],
                recentCalls: [],
            };
        }
        const status = control.getStatus();
        return {
            isAvailable: status.isAvailable,
            isEnabled: status.isEnabled,
            port: status.port,
            preferredPort: status.preferredPort,
            catalogRevision: status.catalogRevision,
            capabilities: status.capabilities,
            disabledPluginIds: status.disabledPluginIds,
            writeEnabledPluginIds: status.writeEnabledPluginIds,
            directWriteEnabled: status.directWriteEnabled,
            pendingPlans: control.listPendingPlans(),
            recentCalls: control.listRecentCalls(),
        };
    }

    /** @description 校验并批准面板提交的 MCP 写操作计划。 */
    private _approveMcpPlan(planId: string | undefined): void {
        if (typeof planId !== 'string' || !/^[a-f0-9]{32}$/.test(planId)) {
            throw new Error('plugin_manager_mcp_plan_id_invalid');
        }
        const control = this._pluginManager.getMcpHubControl();
        if (control == null || !control.approvePlan(planId)) {
            throw new Error('plugin_manager_mcp_plan_unavailable');
        }
    }

    /** @description 校验并拒绝面板提交的 MCP 写操作计划。 */
    private _rejectMcpPlan(planId: string | undefined): void {
        if (typeof planId !== 'string' || !/^[a-f0-9]{32}$/.test(planId)) {
            throw new Error('plugin_manager_mcp_plan_id_invalid');
        }
        const control = this._pluginManager.getMcpHubControl();
        if (control == null || !control.rejectPlan(planId)) {
            throw new Error('plugin_manager_mcp_plan_unavailable');
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildPackageCatalogItemPayload(
        sourceKind: IPluginPackageCatalogItemPayload['sourceKind'],
        packagePath: string,
        sourcePath: string,
        pluginId: string,
        version: string,
        displayName: string,
        iconUrl: string | undefined,
    ): IPluginPackageCatalogItemPayload {
        return {
            sourceKind,
            packagePath,
            sourcePath,
            pluginId,
            version,
            displayName,
            iconUrl,
            installedActiveVersion: this._pluginManager.getInstalledPackageSnapshot(pluginId)?.activeVersion ?? null,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildPackageCatalog(
        manualPackageSources: readonly IPluginManualPackageSourceInputPayload[],
    ): readonly IPluginPackageCatalogItemPayload[] {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packageCatalog = new Map<string, IPluginPackageCatalogItemPayload>();
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const packageSnapshot of this._pluginManager.listPackageSnapshots()) {
            packageCatalog.set(
                packageSnapshot.packagePath,
                this._buildPackageCatalogItemPayload(
                    'local',
                    packageSnapshot.packagePath,
                    packageSnapshot.sourcePath,
                    packageSnapshot.manifest.id,
                    packageSnapshot.manifest.version,
                    packageSnapshot.manifest.displayName,
                    this._getRuntimeRecord(packageSnapshot.manifest.id)?.iconUrl,
                ),
            );
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        for (const manualPackageSource of manualPackageSources) {
            packageCatalog.set(
                manualPackageSource.packagePath,
                this._buildPackageCatalogItemPayload(
                    manualPackageSource.sourceKind,
                    manualPackageSource.packagePath,
                    manualPackageSource.sourcePath,
                    manualPackageSource.pluginId,
                    manualPackageSource.version,
                    manualPackageSource.pluginId,
                    this._getRuntimeRecord(manualPackageSource.pluginId)?.iconUrl,
                ),
            );
        }
        // Installed CPM versions remain visible even when their registry source is offline.
        for (const installedSnapshot of this._pluginManager.listInstalledPackageSnapshots()) {
            for (const installedVersion of installedSnapshot.versions) {
                if (packageCatalog.has(installedVersion.installPath)) continue;
                packageCatalog.set(
                    installedVersion.installPath,
                    {
                        ...this._buildPackageCatalogItemPayload(
                            'installed',
                            installedVersion.installPath,
                            installedVersion.installPath,
                            installedSnapshot.pluginId,
                            installedVersion.version,
                            installedSnapshot.pluginId,
                            this._getRuntimeRecord(installedSnapshot.pluginId)?.iconUrl,
                        ),
                        installedActiveVersion: installedSnapshot.activeVersion,
                    },
                );
            }
        }
        return [...packageCatalog.values()];
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _readRecentPackagePaths(context: IPluginActivateContext): Promise<readonly string[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const storedRecentPackagePaths = await context.storage.get<readonly string[]>(
            BuiltinPluginManagerPanelModule.RECENT_PACKAGE_PATHS_STORAGE_KEY,
        );
        return Array.isArray(storedRecentPackagePaths)
            ? storedRecentPackagePaths.filter((packagePath): packagePath is string => {
                  return typeof packagePath === 'string' && packagePath.length > 0;
              })
            : [];
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _rememberRecentPackagePath(context: IPluginActivateContext, packagePath: string): Promise<readonly string[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const recentPackagePaths = await this._readRecentPackagePaths(context);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextRecentPackagePaths = [
            packagePath,
            ...recentPackagePaths.filter((recentPackagePath) => {
                return recentPackagePath !== packagePath;
            }),
        ].slice(0, BuiltinPluginManagerPanelModule.MAX_RECENT_PACKAGE_PATHS);
        await context.storage.set(BuiltinPluginManagerPanelModule.RECENT_PACKAGE_PATHS_STORAGE_KEY, nextRecentPackagePaths);
        return nextRecentPackagePaths;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _readPanelPreferences(context: IPluginActivateContext): Promise<IPluginManagerPanelPreferencesPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const storedPreferences = await context.storage.get<Partial<IPluginManagerPanelPreferencesPayload>>(
            BuiltinPluginManagerPanelModule.PANEL_PREFERENCES_STORAGE_KEY,
        );
        return {
            locale: this._normalizeLocale(storedPreferences?.locale),
            packageFilter: this._normalizePackageFilter(storedPreferences?.packageFilter),
            packageCatalogSort: this._normalizePackageCatalogSort(storedPreferences?.packageCatalogSort),
            selectedPluginId:
                typeof storedPreferences?.selectedPluginId === 'string' && storedPreferences.selectedPluginId.length > 0
                    ? storedPreferences.selectedPluginId
                    : null,
            selectedPackagePath:
                typeof storedPreferences?.selectedPackagePath === 'string' && storedPreferences.selectedPackagePath.length > 0
                    ? storedPreferences.selectedPackagePath
                    : null,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _readManualPackageSources(context: IPluginActivateContext): Promise<readonly IPluginManualPackageSourceInputPayload[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const storedManualPackageSources = await context.storage.get<readonly IPluginManualPackageSourceInputPayload[]>(
            BuiltinPluginManagerPanelModule.MANUAL_PACKAGE_SOURCES_STORAGE_KEY,
        );
        return Array.isArray(storedManualPackageSources)
            ? storedManualPackageSources
                  .map((manualPackageSource) => {
                      try {
                          return this._requireManualPackageSource(manualPackageSource);
                      } catch {
                          return null;
                      }
                  })
                  .filter((manualPackageSource): manualPackageSource is IPluginManualPackageSourceInputPayload => {
                      return manualPackageSource != null;
                  })
            : [];
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _registerManualPackageSource(
        context: IPluginActivateContext,
        source: IPluginManualPackageSourceInputPayload,
    ): Promise<readonly IPluginManualPackageSourceInputPayload[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const manualPackageSources = await this._readManualPackageSources(context);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextManualPackageSources = [
            source,
            ...manualPackageSources.filter((manualPackageSource) => {
                return manualPackageSource.packagePath !== source.packagePath;
            }),
        ];
        await context.storage.set(BuiltinPluginManagerPanelModule.MANUAL_PACKAGE_SOURCES_STORAGE_KEY, nextManualPackageSources);
        return nextManualPackageSources;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _removeManualPackageSource(
        context: IPluginActivateContext,
        packagePath: string,
    ): Promise<readonly IPluginManualPackageSourceInputPayload[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const manualPackageSources = await this._readManualPackageSources(context);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextManualPackageSources = manualPackageSources.filter((manualPackageSource) => {
            return manualPackageSource.packagePath !== packagePath;
        });
        await context.storage.set(BuiltinPluginManagerPanelModule.MANUAL_PACKAGE_SOURCES_STORAGE_KEY, nextManualPackageSources);
        return nextManualPackageSources;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _writePanelPreferences(
        context: IPluginActivateContext,
        nextPreferences: Partial<IPluginManagerPanelPreferencesPayload>,
    ): Promise<IPluginManagerPanelPreferencesPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const currentPreferences = await this._readPanelPreferences(context);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const mergedPreferences: IPluginManagerPanelPreferencesPayload = {
            locale: this._normalizeLocale(nextPreferences.locale ?? currentPreferences.locale),
            packageFilter: this._normalizePackageFilter(nextPreferences.packageFilter ?? currentPreferences.packageFilter),
            packageCatalogSort: this._normalizePackageCatalogSort(
                nextPreferences.packageCatalogSort ?? currentPreferences.packageCatalogSort,
            ),
            selectedPluginId:
                typeof nextPreferences.selectedPluginId === 'string'
                    ? nextPreferences.selectedPluginId.length > 0
                        ? nextPreferences.selectedPluginId
                        : null
                    : currentPreferences.selectedPluginId,
            selectedPackagePath:
                typeof nextPreferences.selectedPackagePath === 'string'
                    ? nextPreferences.selectedPackagePath.length > 0
                        ? nextPreferences.selectedPackagePath
                        : null
                    : currentPreferences.selectedPackagePath,
        };
        await context.storage.set(BuiltinPluginManagerPanelModule.PANEL_PREFERENCES_STORAGE_KEY, mergedPreferences);
        return mergedPreferences;
    }

    /** @description 读取供独立设置面板编辑的受限偏好快照。 */
    private async _readSettingsSnapshot(context: IPluginActivateContext): Promise<IPluginManagerSettingsSnapshotPayload> {
        const preferences = await this._readPanelPreferences(context);
        return {
            preferences: this._toEditablePreferences(preferences),
            revision: await this._readSettingsRevision(context),
        };
    }

    /** @description 校验、持久化并递增独立设置面板的版本号。 */
    private async _updateSettings(
        context: IPluginActivateContext,
        request: IPluginManagerSettingsUpdatePayload | undefined,
    ): Promise<IPluginManagerSettingsSnapshotPayload> {
        if (request == null || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
            throw new Error('plugin_manager_settings_revision_invalid');
        }
        const currentRevision = await this._readSettingsRevision(context);
        if (request.expectedRevision !== currentRevision) {
            throw new Error('plugin_manager_settings_revision_conflict');
        }
        const preferences = this._requireEditablePreferences(request.preferences);
        const persistedPreferences = await this._writePanelPreferences(context, preferences);
        const revision = currentRevision + 1;
        await context.storage.set(BuiltinPluginManagerPanelModule.SETTINGS_REVISION_STORAGE_KEY, revision);
        return {
            preferences: this._toEditablePreferences(persistedPreferences),
            revision,
        };
    }

    /** @description 将完整偏好裁剪为设置页允许编辑的字段。 */
    private _toEditablePreferences(preferences: IPluginManagerPanelPreferencesPayload): IPluginManagerEditablePanelPreferencesPayload {
        return {
            locale: preferences.locale,
            packageFilter: preferences.packageFilter,
            packageCatalogSort: preferences.packageCatalogSort,
        };
    }

    /** @description 严格校验独立设置面板提交的完整偏好。 */
    private _requireEditablePreferences(
        preferences: IPluginManagerEditablePanelPreferencesPayload | undefined,
    ): IPluginManagerEditablePanelPreferencesPayload {
        if (preferences == null || typeof preferences !== 'object' || Array.isArray(preferences)) {
            throw new Error('plugin_manager_settings_preferences_invalid');
        }
        if (preferences.locale !== 'en-US' && preferences.locale !== 'zh-CN') {
            throw new Error('plugin_manager_settings_locale_invalid');
        }
        if (!['all', 'installed', 'not-installed', 'upgrade'].includes(preferences.packageFilter)) {
            throw new Error('plugin_manager_settings_package_filter_invalid');
        }
        if (!['plugin-id-asc', 'plugin-id-desc', 'source-asc', 'recent-first'].includes(preferences.packageCatalogSort)) {
            throw new Error('plugin_manager_settings_package_sort_invalid');
        }
        return preferences;
    }

    /** @description 读取设置并发控制版本；损坏或缺失值回退为零。 */
    private async _readSettingsRevision(context: IPluginActivateContext): Promise<number> {
        const storedRevision = await context.storage.get<unknown>(BuiltinPluginManagerPanelModule.SETTINGS_REVISION_STORAGE_KEY);
        return typeof storedRevision === 'number' && Number.isSafeInteger(storedRevision) && storedRevision >= 0 ? storedRevision : 0;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _normalizeLocale(locale: string | undefined): PluginManagerPanelLocale {
        if (locale === 'en-US' || locale === 'zh-CN') {
            return locale;
        }
        return 'zh-CN';
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _normalizePackageFilter(packageFilter: string | undefined): IPluginManagerPanelPreferencesPayload['packageFilter'] {
        if (packageFilter === 'installed' || packageFilter === 'not-installed' || packageFilter === 'upgrade') {
            return packageFilter;
        }
        return 'all';
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _normalizePackageCatalogSort(
        packageCatalogSort: string | undefined,
    ): IPluginManagerPanelPreferencesPayload['packageCatalogSort'] {
        if (packageCatalogSort === 'plugin-id-desc' || packageCatalogSort === 'source-asc' || packageCatalogSort === 'recent-first') {
            return packageCatalogSort;
        }
        return 'plugin-id-asc';
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requireManualPackageSource(
        source: Partial<IPluginManualPackageSourceInputPayload> | undefined,
    ): IPluginManualPackageSourceInputPayload {
        if (source == null) {
            throw new Error('plugin_manual_package_source_required');
        }
        // 保存当前操作使用的资源定位信息，供后续读写或校验步骤使用。
        const packagePath = this._requirePackagePath(source.packagePath);
        if (source.sourceKind !== 'manual' && source.sourceKind !== 'registry') {
            throw new Error('plugin_manual_package_source_kind_invalid');
        }
        if (typeof source.sourcePath !== 'string' || source.sourcePath.length === 0) {
            throw new Error('plugin_manual_package_source_path_required');
        }
        if (typeof source.pluginId !== 'string' || source.pluginId.length === 0) {
            throw new Error('plugin_manual_package_source_plugin_id_required');
        }
        if (typeof source.version !== 'string' || source.version.length === 0) {
            throw new Error('plugin_manual_package_source_version_required');
        }
        return {
            sourceKind: source.sourceKind,
            packagePath,
            sourcePath: source.sourcePath,
            pluginId: source.pluginId,
            version: source.version,
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _buildPackageActionPayload(
        action: IPluginPackageActionPayload['action'],
        pluginId: string,
        installResult: IPluginPackageActionPayload['installResult'],
        uninstallResult: IPluginPackageActionPayload['uninstallResult'],
    ): IPluginPackageActionPayload {
        return {
            action,
            installResult,
            uninstallResult,
            installedPackageSnapshot: this._buildInstalledPackageSnapshotPayload(pluginId),
            runtimeRecord: this._getRuntimeRecord(pluginId),
            incident: this._pluginManager.getFailureIncident(pluginId),
        };
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _getRuntimeRecord(pluginId: string): IPluginRuntimeRecord | null {
        return (
            this._pluginManager.listRuntimeRecords().find((pluginRuntimeRecord) => {
                return pluginRuntimeRecord.pluginId === pluginId;
            }) ?? null
        );
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requirePluginId(pluginId: string | undefined): string {
        if (pluginId == null || pluginId.length === 0) {
            throw new Error('plugin_failure_plugin_id_required');
        }
        return pluginId;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requirePackagePath(packagePath: string | undefined): string {
        if (packagePath == null || packagePath.length === 0) {
            throw new Error('plugin_package_path_required');
        }
        return packagePath;
    }

    private _readPackManifest(sourcePath: string): IPluginManifest {
        const source = resolve(sourcePath);
        const sourceStats = lstatSync(source);
        if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) throw new Error('plugin_package_source_invalid');
        const sourceRoot = realpathSync(source);
        const manifestFiles = readdirSync(sourceRoot).filter((fileName) => fileName.endsWith('.manifest.json'));
        if (manifestFiles.length !== 1) throw new Error('plugin_package_manifest_invalid');
        const manifestPath = join(sourceRoot, manifestFiles[0]!);
        const manifestStats = lstatSync(manifestPath);
        if (!manifestStats.isFile() || manifestStats.isSymbolicLink() || manifestStats.size > 256 * 1024) {
            throw new Error('plugin_package_manifest_invalid');
        }
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IPluginManifest;
        if (typeof manifest.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(manifest.id)
            || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(manifest.version)
            || typeof manifest.main !== 'string' || !manifest.main.startsWith('./')
            || typeof manifest.engines?.host !== 'string' || manifest.engines.host.trim().length === 0) {
            throw new Error('plugin_package_manifest_invalid');
        }
        if (manifestFiles[0] !== `${manifest.id}.manifest.json`) throw new Error('plugin_package_manifest_invalid');
        const mainPath = resolve(sourceRoot, manifest.main);
        const relativeMainPath = relative(sourceRoot, mainPath);
        if (isAbsolute(relativeMainPath) || relativeMainPath === '..' || relativeMainPath.startsWith(`..${sep}`)) {
            throw new Error('plugin_package_entry_escape');
        }
        const mainStats = lstatSync(mainPath);
        if (!mainStats.isFile() || mainStats.isSymbolicLink() || realpathSync(mainPath) !== mainPath) {
            throw new Error('plugin_package_entry_invalid');
        }
        return manifest;
    }

    /** @description 校验面板提交的插件版本号。 */
    private _requirePackageVersion(version: string | undefined): string {
        if (version == null || version.length === 0) {
            throw new Error('plugin_package_version_required');
        }
        return version;
    }
}
