import type {
    ICleanupStepResult,
    IPanelBridgeClient,
    IPluginDiagnosticExport,
    IPluginFailureExport,
    IPluginFailureIncident,
} from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import type {
    IPluginEmbeddedPanelPayload,
    IPluginFailureDetailPayload,
    IPluginFailureExportPayload,
    IPluginManagerKernelReloadPayload,
    IPluginManagerMcpHubPayload,
    IPluginManualPackageSourceInputPayload,
    IPluginManagerInstalledPackageSnapshotPayload,
    IPluginManagerPanelPreferencesPayload,
    IPluginManagerSnapshotPayload,
    IPluginPackageActionPayload,
    IPluginPackagePlanPayload,
    IPluginPackageSourceActionPayload,
    IPluginPackageVersionActionPayload,
    IPluginRuntimeActionPayload,
    IRetryCleanupPayload,
    PluginManagerPanelLocale,
} from './plugin-manager-panel-contracts.js';
import {
    normalizePluginManagerPanelLocale,
    summarizePluginManagerPackageAction,
    summarizePluginManagerPackagePlan,
    translatePluginManagerPanelError,
    translatePluginManagerPanelText,
} from './plugin-manager-panel-i18n.js';
import { PluginManagerPanelDomRenderer } from './plugin-manager-panel-ui-dom.js';
import { PluginManagerPanelMarkupRenderer } from './plugin-manager-panel-ui-markup.js';
import { PluginManagerPanelStateProjector } from './plugin-manager-panel-state-projector.js';
import type {
    IPluginManagerPanelBrowserWindow,
    IPluginManagerPanelUiState,
    PluginManagerExecutionPriorityFilter,
} from './plugin-manager-panel-ui-types.js';

export type {
    IPluginManagerPanelBrowserWindow,
    IPluginManagerPanelDocumentLike,
    IPluginManagerPanelElementLike,
    IPluginManagerPanelUiHandle,
    IPluginManagerPanelUiState,
    PluginManagerExecutionPriorityFilter,
    PluginManagerPanelUiStatus,
} from './plugin-manager-panel-ui-types.js';

/**
 * @description 插件管理面板浏览器侧 UI 控制器，负责通过 panel bridge 同步插件列表、失败详情与恢复动作。
 */
export class PluginManagerPanelUiController {
    /**
     * @description 初始状态与选中项投影规则。
     */
    private readonly _stateProjector = new PluginManagerPanelStateProjector();

    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _pluginId: string;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _panelId: string;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private static readonly EXECUTION_DIAGNOSTICS_POLL_INTERVAL_MS: number = 1000;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _panelBridgeClient: IPanelBridgeClient;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private readonly _onStateChange?: (state: IPluginManagerPanelUiState) => void;

    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _state: IPluginManagerPanelUiState;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _executionDiagnosticsPollHandle: ReturnType<typeof setInterval> | null = null;
    /** @description 保存实例生命周期内需要复用的状态或协作依赖。 */
    private _unsubscribeFailureUpdated: (() => void) | null = null;

    /**
     * @description 创建一个新的插件管理面板浏览器侧 UI 控制器。
     * @param pluginId 当前面板所属插件标识
     * @param panelId 当前面板稳定标识
     * @param panelBridgeClient 当前面板可用的桥接客户端
     * @param onStateChange 状态更新时的同步回调
     */
    public constructor(
        pluginId: string,
        panelId: string,
        panelBridgeClient: IPanelBridgeClient,
        onStateChange?: (state: IPluginManagerPanelUiState) => void,
    ) {
        this._pluginId = pluginId;
        this._panelId = panelId;
        this._panelBridgeClient = panelBridgeClient;
        this._onStateChange = onStateChange;
        this._state = this._stateProjector.createInitialState(pluginId, panelId);
    }

    /**
     * @description 返回当前 UI 状态快照。
     * @returns 当前 UI 状态快照
     */
    public get state(): IPluginManagerPanelUiState {
        return this._state;
    }

    /**
     * @description 初始化控制器并加载当前插件管理面板数据。
     * @returns Promise 返回初始化后的 UI 状态快照
     */
    public async initialize(): Promise<IPluginManagerPanelUiState> {
        if (this._unsubscribeFailureUpdated == null) {
            this._unsubscribeFailureUpdated = this._panelBridgeClient.subscribe<IRetryCleanupPayload>(
                'pluginManager.failure.updated',
                async (envelope): Promise<void> => {
                    await this._handleFailureUpdated(envelope.payload);
                },
            );
        }
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const initialState = await this.refresh();
        this._startExecutionDiagnosticsPolling();
        if (initialState.selectedPluginId === 'snowb.bmfont' && initialState.selectedRuntimeRecord?.state === 'active') {
            return this.openSelectedPluginPanel();
        }
        return initialState;
    }

    /**
     * @description 重新拉取插件列表和当前选中插件详情。
     * @returns Promise 返回刷新后的 UI 状态快照
     */
    public async refresh(): Promise<IPluginManagerPanelUiState> {
        this._patchState({
            status: 'loading',
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginManagerSnapshot = await this._requestSnapshot();
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const nextSelectedPluginId = this._stateProjector.resolveSelectedPluginId(
                pluginManagerSnapshot,
                pluginManagerSnapshot.preferences.selectedPluginId ?? this._state.selectedPluginId,
            );
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginFailureDetail = await this._requestDetail(nextSelectedPluginId);
            this._patchState({
                status: 'ready',
                runtimeRecords: pluginManagerSnapshot.runtimeRecords,
                failureItems: pluginManagerSnapshot.failureItems,
                packageCatalog: pluginManagerSnapshot.packageCatalog,
                recentPackagePaths: pluginManagerSnapshot.recentPackagePaths,
                preferences: pluginManagerSnapshot.preferences,
                kernelReloadSupported: pluginManagerSnapshot.kernelReloadSupported,
                executionDiagnosticsSnapshot: pluginManagerSnapshot.executionDiagnosticsSnapshot,
                developmentSession:
                    pluginManagerSnapshot.developmentSession ?? PluginManagerPanelStateProjector.EMPTY_DEVELOPMENT_SESSION,
                mcpHub: pluginManagerSnapshot.mcpHub,
                selectedExecutionGroupId: this._stateProjector.resolveSelectedExecutionGroupId(
                    pluginManagerSnapshot.executionDiagnosticsSnapshot,
                    this._state.selectedExecutionGroupId,
                    this._state.executionPriorityFilter,
                    this._state.showOnlyExceptionalExecutionGroups,
                ),
                selectedPluginId: nextSelectedPluginId,
                selectedPackagePath: this._stateProjector.resolveSelectedPackagePath(
                    pluginManagerSnapshot.packageCatalog,
                    pluginManagerSnapshot.preferences.selectedPackagePath ?? this._state.selectedPackagePath,
                    nextSelectedPluginId,
                ),
                selectedRuntimeRecord: pluginFailureDetail?.runtimeRecord ?? null,
                embeddedPanel:
                    this._state.embeddedPanel?.pluginId === nextSelectedPluginId && pluginFailureDetail?.runtimeRecord?.state === 'active'
                        ? this._state.embeddedPanel
                        : null,
                selectedInstalledPackageSnapshot: pluginFailureDetail?.installedPackageSnapshot ?? null,
                selectedIncident: pluginFailureDetail?.incident ?? null,
                selectedFailureExport: null,
                lastCleanupSteps: pluginFailureDetail?.incident?.cleanupSteps ?? [],
                lastError: null,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                status: 'error',
                lastError: this._normalizeErrorMessage(error),
            });
        }

        return this._state;
    }

    /**
     * @description 单独刷新 execution diagnostics，不重新拉取全量插件与包状态。
     * @returns Promise 返回刷新后的 UI 状态快照
     */
    public async refreshExecutionDiagnostics(): Promise<IPluginManagerPanelUiState> {
        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const executionDiagnosticsSnapshot = await this._requestExecutionDiagnosticsSnapshot();
            this._patchState({
                executionDiagnosticsSnapshot,
                selectedExecutionGroupId: this._stateProjector.resolveSelectedExecutionGroupId(
                    executionDiagnosticsSnapshot,
                    this._state.selectedExecutionGroupId,
                    this._state.executionPriorityFilter,
                    this._state.showOnlyExceptionalExecutionGroups,
                ),
                lastError: this._state.status === 'error' ? null : this._state.lastError,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                lastError: this._normalizeErrorMessage(error),
            });
        }

        return this._state;
    }

    /**
     * @description 修改当前项目 MCP Hub 启用状态。
     * @param isEnabled 是否启用 Hub。
     * @returns Promise 返回更新后的面板状态。
     */
    public async setMcpHubEnabled(isEnabled: boolean): Promise<IPluginManagerPanelUiState> {
        return this._runMcpHubAction('pluginManager.mcp.setEnabled', { isEnabled });
    }

    /**
     * @description 批准一个 MCP 写操作计划。
     * @param planId 一次性计划标识。
     * @returns Promise 返回更新后的面板状态。
     */
    public async approveMcpPlan(planId: string): Promise<IPluginManagerPanelUiState> {
        return this._runMcpHubAction('pluginManager.mcp.plan.approve', { planId });
    }

    /**
     * @description 拒绝一个 MCP 写操作计划。
     * @param planId 一次性计划标识。
     * @returns Promise 返回更新后的面板状态。
     */
    public async rejectMcpPlan(planId: string): Promise<IPluginManagerPanelUiState> {
        return this._runMcpHubAction('pluginManager.mcp.plan.reject', { planId });
    }

    /**
     * @description 切换当前选中的插件，并同步该插件的详情状态。
     * @param pluginId 目标插件标识；传入 `null` 时自动回退到首个可用插件
     * @returns Promise 返回切换后的 UI 状态快照
     */
    public async selectPlugin(pluginId: string | null): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextSelectedPluginId = this._stateProjector.resolveSelectedPluginId(
            {
                runtimeRecords: this._state.runtimeRecords,
                failureItems: this._state.failureItems,
            },
            pluginId,
        );
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const preferences = await this._updatePreferences({
            selectedPluginId: nextSelectedPluginId,
        });

        this._patchState({
            status: 'loading',
            preferences,
            selectedPluginId: nextSelectedPluginId,
            embeddedPanel: null,
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginFailureDetail = await this._requestDetail(nextSelectedPluginId);
            this._patchState({
                status: 'ready',
                selectedRuntimeRecord: pluginFailureDetail?.runtimeRecord ?? null,
                selectedInstalledPackageSnapshot: pluginFailureDetail?.installedPackageSnapshot ?? null,
                selectedIncident: pluginFailureDetail?.incident ?? null,
                selectedFailureExport: null,
                lastCleanupSteps: pluginFailureDetail?.incident?.cleanupSteps ?? [],
                lastError: null,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                status: 'error',
                lastError: this._normalizeErrorMessage(error),
            });
        }

        if (
            this._state.status === 'ready' &&
            nextSelectedPluginId === 'snowb.bmfont' &&
            this._state.selectedRuntimeRecord?.state === 'active'
        ) {
            return this.openSelectedPluginPanel();
        }

        return this._state;
    }

    /**
     * @description 选择一个 execution diagnostics 组并同步当前本地 UI 状态。
     * @param groupId 目标执行组标识；传入 `null` 时取消选中
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async selectExecutionGroup(groupId: string | null): Promise<IPluginManagerPanelUiState> {
        this._patchState({
            selectedExecutionGroupId: groupId,
        });
        return this._state;
    }

    /**
     * @description 设置当前 execution diagnostics 的 priority 过滤器。
     * @param priority 目标优先级过滤器
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async setExecutionPriorityFilter(priority: PluginManagerExecutionPriorityFilter): Promise<IPluginManagerPanelUiState> {
        this._patchState({
            executionPriorityFilter: priority,
            selectedExecutionGroupId: this._stateProjector.resolveSelectedExecutionGroupId(
                this._state.executionDiagnosticsSnapshot,
                this._state.selectedExecutionGroupId,
                priority,
                this._state.showOnlyExceptionalExecutionGroups,
            ),
        });
        return this._state;
    }

    /**
     * @description 切换当前是否只显示异常执行组。
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async toggleExceptionalExecutionGroups(): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextShowOnlyExceptionalExecutionGroups = !this._state.showOnlyExceptionalExecutionGroups;
        this._patchState({
            showOnlyExceptionalExecutionGroups: nextShowOnlyExceptionalExecutionGroups,
            selectedExecutionGroupId: this._stateProjector.resolveSelectedExecutionGroupId(
                this._state.executionDiagnosticsSnapshot,
                this._state.selectedExecutionGroupId,
                this._state.executionPriorityFilter,
                nextShowOnlyExceptionalExecutionGroups,
            ),
        });
        return this._state;
    }

    /**
     * @description 请求宿主调度一次 plugin-manager kernel reload。
     * @returns Promise 返回请求后的 UI 状态快照
     */
    public async reloadKernel(): Promise<IPluginManagerPanelUiState> {
        if (!this._state.kernelReloadSupported) {
            return this._state;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const kernelReloadResponse = await this._panelBridgeClient.request<{}, IPluginManagerKernelReloadPayload>({
            id: `plugin-manager-ui-kernel-reload:${Date.now()}`,
            event: 'pluginManager.kernel.reload',
            expectsResponse: true,
            payload: {},
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const kernelReloadPayload = this._requireOkResponse(kernelReloadResponse, 'plugin_manager_kernel_reload_failed');
        if (!kernelReloadPayload.accepted) {
            return this._state;
        }
        return this._state;
    }

    public async reconcileDevelopmentPlugins(): Promise<IPluginManagerPanelUiState> {
        const response = await this._panelBridgeClient.request<{}, { accepted: boolean }>({
            id: `plugin-manager-development-reconcile:${Date.now()}`,
            event: 'pluginManager.development.reconcile',
            expectsResponse: true,
            payload: {},
        });
        this._requireOkResponse(response, 'plugin_manager_development_reconcile_failed');
        return this.refresh();
    }

    public async reloadSelectedDevelopmentPlugin(): Promise<IPluginManagerPanelUiState> {
        const pluginId = this._state.selectedPluginId;
        if (pluginId == null) {
            return this._state;
        }
        const response = await this._panelBridgeClient.request<{ pluginId: string }, { accepted: boolean }>({
            id: `plugin-manager-development-reload:${pluginId}:${Date.now()}`,
            event: 'pluginManager.development.reload',
            expectsResponse: true,
            payload: { pluginId },
        });
        this._requireOkResponse(response, 'plugin_manager_development_reload_failed');
        return this.refresh();
    }

    /**
     * @description 导出当前选中插件的失败事件。
     * @returns Promise 返回导出结果；当前插件没有失败事件时返回 `null`
     */
    public async exportSelectedFailure(): Promise<IPluginFailureExport | null> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const selectedPluginId = this._state.selectedPluginId;
        if (selectedPluginId == null) {
            return null;
        }

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginFailureExport = await this._requestExport(selectedPluginId);
            this._patchState({
                selectedFailureExport: pluginFailureExport.exportResult,
                selectedDiagnosticExport: pluginFailureExport.diagnosticExport,
                lastError: null,
            });
            return pluginFailureExport.exportResult;
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                selectedFailureExport: null,
                selectedDiagnosticExport: null,
                lastError: this._normalizeErrorMessage(error),
            });
            return null;
        }
    }

    /**
     * @description 对当前选中插件触发一次清理重试，并刷新详情状态。
     * @returns Promise 返回本次清理步骤结果列表；当前未选中插件时返回空数组
     */
    public async retrySelectedCleanup(): Promise<readonly ICleanupStepResult[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const selectedPluginId = this._state.selectedPluginId;
        if (selectedPluginId == null) {
            return [];
        }

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const retryCleanupPayload = await this._requestRetryCleanup(selectedPluginId);
            this._patchState({
                selectedIncident: retryCleanupPayload.incident,
                selectedFailureExport: null,
                lastCleanupSteps: retryCleanupPayload.cleanupSteps,
                lastError: null,
            });
            await this.refresh();
            return retryCleanupPayload.cleanupSteps;
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                lastError: this._normalizeErrorMessage(error),
            });
            return [];
        }
    }

    /**
     * @description 激活当前选中的插件，并刷新面板状态。
     * @returns Promise 返回动作完成后的 UI 状态快照
     */
    public async activateSelectedPlugin(): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const succeeded = await this._runSelectedRuntimeAction('activate', 'pluginManager.runtime.activate');
        if (!succeeded) {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 停用当前选中的插件，并刷新面板状态。
     * @returns Promise 返回动作完成后的 UI 状态快照
     */
    public async deactivateSelectedPlugin(): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const succeeded = await this._runSelectedRuntimeAction('deactivate', 'pluginManager.runtime.deactivate');
        if (!succeeded) {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 释放当前选中的插件，并刷新面板状态。
     * @returns Promise 返回动作完成后的 UI 状态快照
     */
    public async disposeSelectedPlugin(): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const succeeded = await this._runSelectedRuntimeAction('dispose', 'pluginManager.runtime.dispose');
        if (!succeeded) {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 解析并打开当前选中插件的内嵌面板，不创建独立宿主窗口。
     * @returns Promise 返回包含内嵌面板描述的 UI 状态
     */
    public async openSelectedPluginPanel(): Promise<IPluginManagerPanelUiState> {
        // 保存当前选中插件标识，空选择不发起桥请求。
        const selectedPluginId = this._state.selectedPluginId;
        if (selectedPluginId == null) {
            return this._state;
        }
        this._patchState({
            status: 'loading',
            embeddedPanel: null,
            lastError: null,
        });
        try {
            // 保存宿主返回的受校验面板描述，浏览器仅使用该入口挂载 iframe。
            const response = await this._panelBridgeClient.request<{ pluginId: string }, IPluginEmbeddedPanelPayload>({
                id: `plugin-manager-ui-panel-resolve:${selectedPluginId}`,
                event: 'pluginManager.panel.resolve',
                expectsResponse: true,
                payload: {
                    pluginId: selectedPluginId,
                },
            });
            // 保存通过统一响应校验的内嵌面板载荷。
            const embeddedPanel = this._requireOkResponse(response, `plugin_manager_panel_resolve_failed:${selectedPluginId}`);
            this._patchState({
                status: 'ready',
                embeddedPanel,
                lastError: null,
            });
        } catch (/* 保存面板解析异常并呈现给用户，避免按钮静默失败。 */ error) {
            this._patchState({
                status: 'error',
                embeddedPanel: null,
                lastError: this._normalizeErrorMessage(error),
            });
        }
        return this._state;
    }

    /**
     * @description 关闭当前内嵌插件面板并保留插件管理器选择状态。
     * @returns Promise 返回关闭后的 UI 状态
     */
    public async closeEmbeddedPluginPanel(): Promise<IPluginManagerPanelUiState> {
        this._patchState({
            status: 'ready',
            embeddedPanel: null,
            lastError: null,
        });
        return this._state;
    }

    /**
     * @description 为给定包路径生成安装计划，并把结果写入当前 UI 状态。
     * @param packagePath 插件包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async planPackage(packagePath: string): Promise<IPluginManagerPanelUiState> {
        this._patchState({
            status: 'loading',
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            const pluginPackagePlanResponse = await this._panelBridgeClient.request<{ packagePath: string }, IPluginPackagePlanPayload>({
                id: `plugin-manager-ui-package-plan:${packagePath}`,
                event: 'pluginManager.package.plan',
                expectsResponse: true,
                payload: {
                    packagePath,
                },
            });
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginPackagePlanPayload = this._requireOkResponse(
                pluginPackagePlanResponse,
                `plugin_manager_package_plan_failed:${packagePath}`,
            );
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const locale = this._getLocale();
            this._patchState({
                status: 'ready',
                selectedPluginId: pluginPackagePlanPayload.installPlan.pluginId,
                selectedInstalledPackageSnapshot: pluginPackagePlanPayload.installedPackageSnapshot,
                lastPackageActionSummary: summarizePluginManagerPackagePlan(
                    locale,
                    pluginPackagePlanPayload.installPlan.operation,
                    pluginPackagePlanPayload.installPlan.pluginId,
                    pluginPackagePlanPayload.installPlan.version,
                ),
                lastError: null,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                status: 'error',
                lastError: this._normalizeErrorMessage(error),
            });
        }

        return this._state;
    }

    /**
     * @description 执行指定包路径上的安装动作，并刷新面板状态。
     * @param packagePath 插件包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async installPackage(packagePath: string): Promise<IPluginManagerPanelUiState> {
        await this._runPackageAction('install', 'pluginManager.package.install', packagePath);
        if (this._state.status === 'error') {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 执行指定包路径上的升级动作，并刷新面板状态。
     * @param packagePath 插件包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async upgradePackage(packagePath: string): Promise<IPluginManagerPanelUiState> {
        await this._runPackageAction('upgrade', 'pluginManager.package.upgrade', packagePath);
        if (this._state.status === 'error') {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 执行指定包路径上的安装动作，并在存在 runtime 模块工厂时直接接管到 runtime。
     * @param packagePath 插件包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async installAndActivatePackage(packagePath: string): Promise<IPluginManagerPanelUiState> {
        await this._runPackageAction('install', 'pluginManager.package.installAndActivate', packagePath);
        if (this._state.status === 'error') {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 执行指定包路径上的升级动作，并在存在 runtime 模块工厂时切换 runtime 实例。
     * @param packagePath 插件包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async upgradeAndActivatePackage(packagePath: string): Promise<IPluginManagerPanelUiState> {
        await this._runPackageAction('upgrade', 'pluginManager.package.upgradeAndActivate', packagePath);
        if (this._state.status === 'error') {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 卸载当前选中插件的安装包，并刷新面板状态。
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async uninstallSelectedPackage(): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const selectedPluginId = this._state.selectedPluginId;
        if (selectedPluginId == null) {
            return this._state;
        }

        await this._runPackageUninstall(selectedPluginId);
        if (this._state.status === 'error') {
            return this._state;
        }
        return this.refresh();
    }

    /**
     * @description 切换当前选中插件的活动安装版本，并刷新面板状态。
     * @param version 已安装的目标版本
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async switchSelectedPackageVersion(version: string): Promise<IPluginManagerPanelUiState> {
        return this._runPackageVersionAction('switch', version);
    }

    /**
     * @description 删除当前选中插件的非活动安装版本，并刷新面板状态。
     * @param version 要删除的版本
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async removeSelectedPackageVersion(version: string): Promise<IPluginManagerPanelUiState> {
        return this._runPackageVersionAction('remove', version);
    }

    /**
     * @description 选中一个 package catalog 项，并同步当前 UI 状态。
     * @param packagePath 目标包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async selectPackageCatalogItem(packagePath: string): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const selectedPackageCatalogItem = this._state.packageCatalog.find((packageCatalogItem) => {
            return packageCatalogItem.packagePath === packagePath;
        });
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const recentPackagePaths = await this._rememberRecentPackagePath(packagePath);
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const preferences = await this._updatePreferences({
            selectedPackagePath: packagePath,
            selectedPluginId: selectedPackageCatalogItem?.pluginId ?? this._state.selectedPluginId,
        });
        this._patchState({
            recentPackagePaths,
            preferences,
            selectedPackagePath: packagePath,
            selectedPluginId: selectedPackageCatalogItem?.pluginId ?? this._state.selectedPluginId,
            lastError: null,
        });

        if (selectedPackageCatalogItem?.pluginId != null) {
            return this.selectPlugin(selectedPackageCatalogItem.pluginId);
        }

        return this._state;
    }

    /**
     * @description 更新当前面板持久化偏好，并同步本地 UI 状态。
     * @param preferences 要写入的偏好补丁
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async updatePreferences(preferences: Partial<IPluginManagerPanelPreferencesPayload>): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const nextPreferences = await this._updatePreferences(preferences);
        this._patchState({
            preferences: nextPreferences,
        });
        return this._state;
    }

    /**
     * @description 注册一个手工 package source，并刷新当前面板状态。
     * @param source 手工来源输入
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async registerPackageSource(source: IPluginManualPackageSourceInputPayload): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packageSourceActionPayload = await this._requestPackageSourceAction('register', {
            source,
        });
        this._patchState({
            packageCatalog: packageSourceActionPayload.packageCatalog,
            selectedPackagePath: source.packagePath,
        });
        return this.refresh();
    }

    /**
     * @description 删除一个手工 package source，并刷新当前面板状态。
     * @param packagePath 目标包路径
     * @returns Promise 返回更新后的 UI 状态快照
     */
    public async removePackageSource(packagePath: string): Promise<IPluginManagerPanelUiState> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packageSourceActionPayload = await this._requestPackageSourceAction('remove', {
            packagePath,
        });
        this._patchState({
            packageCatalog: packageSourceActionPayload.packageCatalog,
            selectedPackagePath: this._state.selectedPackagePath === packagePath ? null : this._state.selectedPackagePath,
        });
        return this.refresh();
    }

    /**
     * @description 把当前状态渲染为一段可直接显示的 HTML 字符串。
     * @returns 当前 UI 的 HTML 字符串快照
     */
    public renderMarkup(): string {
        return PluginManagerPanelMarkupRenderer.render(this._state);
    }

    /**
     * @description 释放当前控制器持有的桥接订阅。
     * @returns Promise 在资源释放完成后结束
     */
    public async dispose(): Promise<void> {
        this._stopExecutionDiagnosticsPolling();
        this._unsubscribeFailureUpdated?.();
        this._unsubscribeFailureUpdated = null;
        await this._panelBridgeClient.dispose();
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _handleFailureUpdated(payload: IRetryCleanupPayload | undefined): Promise<void> {
        if (payload?.incident?.pluginId === this._state.selectedPluginId) {
            this._patchState({
                selectedIncident: payload.incident,
                lastCleanupSteps: payload.cleanupSteps,
                lastError: null,
            });
        }
        await this.refresh();
    }

    /** @description 执行 MCP Hub 面板操作，并用响应安全替换当前状态。 */
    private async _runMcpHubAction(event: string, payload: Record<string, unknown>): Promise<IPluginManagerPanelUiState> {
        try {
            const response = await this._panelBridgeClient.request<Record<string, unknown>, IPluginManagerMcpHubPayload>({
                id: `plugin-manager-ui-mcp-${Date.now()}`,
                event,
                expectsResponse: true,
                payload,
            });
            this._patchState({
                mcpHub: this._requireOkResponse(response, 'plugin_manager_mcp_action_failed'),
                lastError: null,
            });
        } catch (error) {
            this._patchState({ lastError: this._normalizeErrorMessage(error) });
        }
        return this._state;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestSnapshot(): Promise<IPluginManagerSnapshotPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerSnapshotResponse = await this._panelBridgeClient.request<{}, IPluginManagerSnapshotPayload>({
            id: 'plugin-manager-ui-snapshot',
            event: 'pluginManager.snapshot',
            expectsResponse: true,
            payload: {},
        });
        return this._requireOkResponse(pluginManagerSnapshotResponse, 'plugin_manager_snapshot_request_failed');
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestExecutionDiagnosticsSnapshot(): Promise<IExecutionDiagnosticsSnapshot> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const executionDiagnosticsResponse = await this._panelBridgeClient.request<{}, IExecutionDiagnosticsSnapshot>({
            id: 'plugin-manager-ui-execution-diagnostics',
            event: 'pluginManager.executionDiagnostics',
            expectsResponse: true,
            payload: {},
        });
        return this._requireOkResponse(executionDiagnosticsResponse, 'plugin_manager_execution_diagnostics_request_failed');
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestDetail(pluginId: string | null): Promise<IPluginFailureDetailPayload | null> {
        if (pluginId == null) {
            return null;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const pluginFailureDetailResponse = await this._panelBridgeClient.request<{ pluginId: string }, IPluginFailureDetailPayload>({
            id: `plugin-manager-ui-detail:${pluginId}`,
            event: 'pluginManager.failure.detail',
            expectsResponse: true,
            payload: {
                pluginId,
            },
        });
        return this._requireOkResponse(pluginFailureDetailResponse, `plugin_manager_detail_request_failed:${pluginId}`);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestExport(pluginId: string): Promise<IPluginFailureExportPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const pluginFailureExportResponse = await this._panelBridgeClient.request<{ pluginId: string }, IPluginFailureExportPayload>({
            id: `plugin-manager-ui-export:${pluginId}`,
            event: 'pluginManager.failure.export',
            expectsResponse: true,
            payload: {
                pluginId,
            },
        });
        return this._requireOkResponse(pluginFailureExportResponse, `plugin_manager_export_request_failed:${pluginId}`);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestRetryCleanup(pluginId: string): Promise<IRetryCleanupPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const retryCleanupResponse = await this._panelBridgeClient.request<{ pluginId: string }, IRetryCleanupPayload>({
            id: `plugin-manager-ui-retry-cleanup:${pluginId}`,
            event: 'pluginManager.failure.retryCleanup',
            expectsResponse: true,
            payload: {
                pluginId,
            },
        });
        return this._requireOkResponse(retryCleanupResponse, `plugin_manager_retry_cleanup_request_failed:${pluginId}`);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _requestPackageSourceAction(
        action: IPluginPackageSourceActionPayload['action'],
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        payload: { source: IPluginManualPackageSourceInputPayload } | { packagePath: string },
    ): Promise<IPluginPackageSourceActionPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const packageSourceActionResponse = await this._panelBridgeClient.request<
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            { source?: IPluginManualPackageSourceInputPayload; packagePath?: string },
            IPluginPackageSourceActionPayload
        >({
            id: `plugin-manager-ui-package-source:${action}:${Date.now()}`,
            event: action === 'register' ? 'pluginManager.packageSource.register' : 'pluginManager.packageSource.remove',
            expectsResponse: true,
            payload,
        });
        return this._requireOkResponse(packageSourceActionResponse, `plugin_manager_package_source_${action}_failed`);
    }

    /** @description 执行当前选中插件的版本切换或删除动作。 */
    private async _runPackageVersionAction(
        action: IPluginPackageVersionActionPayload['action'],
        version: string,
    ): Promise<IPluginManagerPanelUiState> {
        const pluginId = this._state.selectedPluginId;
        if (pluginId == null || version.length === 0) {
            return this._state;
        }

        this._patchState({ status: 'loading', lastError: null });
        try {
            const response = await this._panelBridgeClient.request<
                { pluginId: string; version: string },
                IPluginPackageVersionActionPayload
            >({
                id: `plugin-manager-ui-package-version:${action}:${pluginId}:${version}`,
                event: action === 'switch' ? 'pluginManager.package.switchVersion' : 'pluginManager.package.removeVersion',
                expectsResponse: true,
                payload: { pluginId, version },
            });
            const payload = this._requireOkResponse(response, `plugin_manager_package_version_${action}_failed:${pluginId}:${version}`);
            this._patchState({
                status: 'ready',
                selectedInstalledPackageSnapshot: payload.installedPackageSnapshot,
                lastPackageActionSummary: `${action}:${pluginId}@${version}`,
                lastError: null,
            });
            return this.refresh();
        } catch (error) {
            this._patchState({ status: 'error', lastError: error instanceof Error ? error.message : String(error) });
            return this._state;
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _updatePreferences(
        preferences: Partial<IPluginManagerPanelPreferencesPayload>,
    ): Promise<IPluginManagerPanelPreferencesPayload> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const preferencesResponse = await this._panelBridgeClient.request<
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            { preferences: Partial<IPluginManagerPanelPreferencesPayload> },
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            { preferences: IPluginManagerPanelPreferencesPayload }
        >({
            id: `plugin-manager-ui-preferences:${Date.now()}`,
            event: 'pluginManager.preferences.update',
            expectsResponse: true,
            payload: {
                preferences,
            },
        });
        return this._requireOkResponse(preferencesResponse, 'plugin_manager_preferences_update_failed').preferences;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _runPackageAction(
        action: IPluginPackageActionPayload['action'],
        event:
            | 'pluginManager.package.install'
            | 'pluginManager.package.upgrade'
            | 'pluginManager.package.installAndActivate'
            | 'pluginManager.package.upgradeAndActivate',
        packagePath: string,
    ): Promise<void> {
        this._patchState({
            status: 'loading',
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const recentPackagePaths = await this._rememberRecentPackagePath(packagePath);
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            const pluginPackageActionResponse = await this._panelBridgeClient.request<{ packagePath: string }, IPluginPackageActionPayload>(
                {
                    id: `plugin-manager-ui-package-action:${action}:${packagePath}`,
                    event,
                    expectsResponse: true,
                    payload: {
                        packagePath,
                    },
                },
            );
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginPackageActionPayload = this._requireOkResponse(
                pluginPackageActionResponse,
                `plugin_manager_package_action_failed:${action}:${packagePath}`,
            );
            this._patchState({
                status: 'ready',
                recentPackagePaths,
                selectedPluginId: pluginPackageActionPayload.installResult?.pluginId ?? this._state.selectedPluginId,
                selectedPackagePath: packagePath,
                selectedRuntimeRecord: pluginPackageActionPayload.runtimeRecord,
                selectedInstalledPackageSnapshot: pluginPackageActionPayload.installedPackageSnapshot,
                selectedIncident: pluginPackageActionPayload.incident,
                lastCleanupSteps: pluginPackageActionPayload.incident?.cleanupSteps ?? [],
                lastPackageActionSummary: this._summarizePackageAction(pluginPackageActionPayload),
                lastError: null,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            this._patchState({
                status: 'error',
                lastError: this._normalizeErrorMessage(error),
            });
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _rememberRecentPackagePath(packagePath: string): Promise<readonly string[]> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        const recentPackagePathResponse = await this._panelBridgeClient.request<
            { packagePath: string },
            { recentPackagePaths: readonly string[] }
        >({
            id: `plugin-manager-ui-remember-recent:${packagePath}`,
            event: 'pluginManager.package.rememberRecent',
            expectsResponse: true,
            payload: {
                packagePath,
            },
        });
        return this._requireOkResponse(recentPackagePathResponse, `plugin_manager_recent_package_failed:${packagePath}`).recentPackagePaths;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _runPackageUninstall(pluginId: string): Promise<void> {
        this._patchState({
            status: 'loading',
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            const pluginPackageActionResponse = await this._panelBridgeClient.request<{ pluginId: string }, IPluginPackageActionPayload>({
                id: `plugin-manager-ui-package-action:uninstall:${pluginId}`,
                event: 'pluginManager.package.uninstall',
                expectsResponse: true,
                payload: {
                    pluginId,
                },
            });
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginPackageActionPayload = this._requireOkResponse(
                pluginPackageActionResponse,
                `plugin_manager_package_action_failed:uninstall:${pluginId}`,
            );
            this._patchState({
                status: 'ready',
                selectedRuntimeRecord: pluginPackageActionPayload.runtimeRecord,
                selectedInstalledPackageSnapshot: pluginPackageActionPayload.installedPackageSnapshot,
                selectedIncident: pluginPackageActionPayload.incident,
                lastCleanupSteps: pluginPackageActionPayload.incident?.cleanupSteps ?? [],
                lastPackageActionSummary: this._summarizePackageAction(pluginPackageActionPayload),
                lastError: null,
            });
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            await this._refreshErrorState(this._normalizeErrorMessage(error));
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _runSelectedRuntimeAction(
        action: IPluginRuntimeActionPayload['action'],
        event: 'pluginManager.runtime.activate' | 'pluginManager.runtime.deactivate' | 'pluginManager.runtime.dispose',
    ): Promise<boolean> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const selectedPluginId = this._state.selectedPluginId;
        if (selectedPluginId == null) {
            return false;
        }

        this._patchState({
            status: 'loading',
            lastError: null,
        });

        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            const pluginRuntimeActionResponse = await this._panelBridgeClient.request<{ pluginId: string }, IPluginRuntimeActionPayload>({
                id: `plugin-manager-ui-runtime-action:${action}:${selectedPluginId}`,
                event,
                expectsResponse: true,
                payload: {
                    pluginId: selectedPluginId,
                },
            });
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginRuntimeActionPayload = this._requireOkResponse(
                pluginRuntimeActionResponse,
                `plugin_manager_runtime_action_failed:${action}:${selectedPluginId}`,
            );
            this._patchState({
                status: 'ready',
                selectedRuntimeRecord: pluginRuntimeActionPayload.runtimeRecord,
                selectedIncident: pluginRuntimeActionPayload.incident,
                selectedFailureExport: null,
                lastCleanupSteps: pluginRuntimeActionPayload.incident?.cleanupSteps ?? [],
                lastError: null,
            });
            return true;
        } catch (/* 保存当前流程捕获的异常或诊断信息，供后续处理或返回。 */ error) {
            await this._refreshErrorState(this._normalizeErrorMessage(error));
            return false;
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private async _refreshErrorState(errorMessage: string): Promise<void> {
        try {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginManagerSnapshot = await this._requestSnapshot();
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const nextSelectedPluginId = this._stateProjector.resolveSelectedPluginId(
                pluginManagerSnapshot,
                this._state.selectedPluginId,
            );
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const pluginFailureDetail = await this._requestDetail(nextSelectedPluginId);
            this._patchState({
                status: 'error',
                runtimeRecords: pluginManagerSnapshot.runtimeRecords,
                failureItems: pluginManagerSnapshot.failureItems,
                packageCatalog: pluginManagerSnapshot.packageCatalog,
                recentPackagePaths: pluginManagerSnapshot.recentPackagePaths,
                preferences: pluginManagerSnapshot.preferences,
                executionDiagnosticsSnapshot: pluginManagerSnapshot.executionDiagnosticsSnapshot,
                selectedExecutionGroupId: this._stateProjector.resolveSelectedExecutionGroupId(
                    pluginManagerSnapshot.executionDiagnosticsSnapshot,
                    this._state.selectedExecutionGroupId,
                    this._state.executionPriorityFilter,
                    this._state.showOnlyExceptionalExecutionGroups,
                ),
                selectedPluginId: nextSelectedPluginId,
                selectedPackagePath: this._stateProjector.resolveSelectedPackagePath(
                    pluginManagerSnapshot.packageCatalog,
                    this._state.selectedPackagePath,
                    nextSelectedPluginId,
                ),
                selectedRuntimeRecord: pluginFailureDetail?.runtimeRecord ?? null,
                selectedInstalledPackageSnapshot: pluginFailureDetail?.installedPackageSnapshot ?? null,
                selectedIncident: pluginFailureDetail?.incident ?? null,
                selectedFailureExport: null,
                lastCleanupSteps: pluginFailureDetail?.incident?.cleanupSteps ?? [],
                lastError: errorMessage,
            });
        } catch {
            this._patchState({
                status: 'error',
                lastError: errorMessage,
            });
        }
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _requireOkResponse<TPayload extends Record<string, unknown>>(
        response: {
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            readonly ok: boolean;
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            readonly payload?: TPayload;
            /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
            readonly error?: string;
        },
        fallbackErrorMessage: string,
    ): TPayload {
        if (!response.ok || response.payload == null) {
            throw new Error(response.error ?? fallbackErrorMessage);
        }
        return response.payload;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _startExecutionDiagnosticsPolling(): void {
        if (this._executionDiagnosticsPollHandle != null) {
            return;
        }

        this._executionDiagnosticsPollHandle = setInterval(() => {
            void this.refreshExecutionDiagnostics();
        }, PluginManagerPanelUiController.EXECUTION_DIAGNOSTICS_POLL_INTERVAL_MS);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _stopExecutionDiagnosticsPolling(): void {
        if (this._executionDiagnosticsPollHandle == null) {
            return;
        }

        clearInterval(this._executionDiagnosticsPollHandle);
        this._executionDiagnosticsPollHandle = null;
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _normalizeErrorMessage(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return translatePluginManagerPanelError(this._getLocale(), message);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _summarizePackageAction(pluginPackageActionPayload: IPluginPackageActionPayload): string {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const locale = this._getLocale();
        if (pluginPackageActionPayload.installResult != null) {
            return summarizePluginManagerPackageAction(
                locale,
                pluginPackageActionPayload.action,
                pluginPackageActionPayload.installResult.pluginId,
                pluginPackageActionPayload.installResult.version,
            );
        }
        if (pluginPackageActionPayload.uninstallResult != null) {
            return summarizePluginManagerPackageAction(locale, 'uninstall', pluginPackageActionPayload.uninstallResult.pluginId, null);
        }
        return summarizePluginManagerPackageAction(locale, pluginPackageActionPayload.action, '', null);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _getLocale(): PluginManagerPanelLocale {
        return normalizePluginManagerPanelLocale(this._state.preferences.locale);
    }

    /** @description 封装当前内部处理步骤，供本类流程复用并维持状态一致性。 */
    private _patchState(partialState: Partial<IPluginManagerPanelUiState>): void {
        this._state = {
            ...this._state,
            ...partialState,
        };
        this._onStateChange?.(this._state);
    }
}

/**
 * @description 在浏览器侧窗口对象上挂载插件管理面板 UI 控制器。
 * @param targetWindow 当前面板的浏览器侧窗口对象
 * @returns Promise 返回已初始化的 UI 控制器
 */
export async function mountPluginManagerPanelUi(targetWindow: IPluginManagerPanelBrowserWindow): Promise<PluginManagerPanelUiController> {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const pluginManagerPanelBridgeContext = targetWindow.__PEANUT_PANEL_BRIDGE_CONTEXT__;
    if (pluginManagerPanelBridgeContext == null) {
        throw new Error('plugin_manager_panel_context_missing');
    }

    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const panelBridgeClient = targetWindow.panelBridge ?? (await targetWindow.acquirePanelBridge?.());
    if (panelBridgeClient == null) {
        throw new Error('plugin_manager_panel_bridge_missing');
    }

    await targetWindow.pluginManagerPanelUi?.dispose();
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const pluginManagerPanelUiController = new PluginManagerPanelUiController(
        pluginManagerPanelBridgeContext.pluginId,
        pluginManagerPanelBridgeContext.panelId,
        panelBridgeClient,
        (state): void => {
            syncPluginManagerPanelWindow(targetWindow, pluginManagerPanelUiController, state);
        },
    );
    await pluginManagerPanelUiController.initialize();
    targetWindow.pluginManagerPanelUi = pluginManagerPanelUiController;
    syncPluginManagerPanelWindow(targetWindow, pluginManagerPanelUiController, pluginManagerPanelUiController.state);
    return pluginManagerPanelUiController;
}

/**
 * @description 卸载当前浏览器侧窗口对象上已挂载的插件管理面板 UI 控制器。
 * @param targetWindow 当前面板的浏览器侧窗口对象
 * @returns Promise 在卸载完成后结束
 */
export async function unmountPluginManagerPanelUi(targetWindow: IPluginManagerPanelBrowserWindow): Promise<void> {
    await targetWindow.pluginManagerPanelUi?.dispose();
    delete targetWindow.pluginManagerPanelUi;
    delete targetWindow.pluginManagerPanelUiState;
    delete targetWindow.pluginManagerPanelUiActions;
    delete targetWindow.documentBodyHtml;
    delete targetWindow.documentTitle;
    delete targetWindow.__PEANUT_PLUGIN_MANAGER_PANEL_STATE_LISTENERS__;
}

function syncPluginManagerPanelWindow(
    targetWindow: IPluginManagerPanelBrowserWindow,
    pluginManagerPanelUiController: PluginManagerPanelUiController,
    state: IPluginManagerPanelUiState,
): void {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const locale = normalizePluginManagerPanelLocale(state.preferences.locale);
    targetWindow.documentTitle = `${translatePluginManagerPanelText(locale, 'hero.title')} - ${state.selectedPluginId ?? translatePluginManagerPanelText(locale, 'hero.overview')}`;
    targetWindow.documentBodyHtml = pluginManagerPanelUiController.renderMarkup();
    targetWindow.pluginManagerPanelUiState = state;
    if (targetWindow.document != null) {
        PluginManagerPanelDomRenderer.render(targetWindow.document, targetWindow, state);
    }
    targetWindow.pluginManagerPanelUiActions = {
        refresh: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.refresh();
        },
        reloadKernel: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.reloadKernel();
        },
        reconcileDevelopmentPlugins: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.reconcileDevelopmentPlugins();
        },
        reloadSelectedDevelopmentPlugin: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.reloadSelectedDevelopmentPlugin();
        },
        selectPlugin: async (pluginId: string | null): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.selectPlugin(pluginId);
        },
        refreshExecutionDiagnostics: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.refreshExecutionDiagnostics();
        },
        setMcpHubEnabled: async (isEnabled: boolean): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.setMcpHubEnabled(isEnabled);
        },
        approveMcpPlan: async (planId: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.approveMcpPlan(planId);
        },
        rejectMcpPlan: async (planId: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.rejectMcpPlan(planId);
        },
        selectExecutionGroup: async (groupId: string | null): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.selectExecutionGroup(groupId);
        },
        setExecutionPriorityFilter: async (priority: PluginManagerExecutionPriorityFilter): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.setExecutionPriorityFilter(priority);
        },
        toggleExceptionalExecutionGroups: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.toggleExceptionalExecutionGroups();
        },
        exportSelectedFailure: async (): Promise<IPluginFailureExport | null> => {
            return pluginManagerPanelUiController.exportSelectedFailure();
        },
        retrySelectedCleanup: async (): Promise<readonly ICleanupStepResult[]> => {
            return pluginManagerPanelUiController.retrySelectedCleanup();
        },
        activateSelectedPlugin: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.activateSelectedPlugin();
        },
        deactivateSelectedPlugin: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.deactivateSelectedPlugin();
        },
        disposeSelectedPlugin: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.disposeSelectedPlugin();
        },
        openSelectedPluginPanel: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.openSelectedPluginPanel();
        },
        closeEmbeddedPluginPanel: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.closeEmbeddedPluginPanel();
        },
        planPackage: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.planPackage(packagePath);
        },
        installPackage: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.installPackage(packagePath);
        },
        upgradePackage: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.upgradePackage(packagePath);
        },
        installAndActivatePackage: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.installAndActivatePackage(packagePath);
        },
        upgradeAndActivatePackage: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.upgradeAndActivatePackage(packagePath);
        },
        uninstallSelectedPackage: async (): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.uninstallSelectedPackage();
        },
        switchSelectedPackageVersion: async (version: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.switchSelectedPackageVersion(version);
        },
        removeSelectedPackageVersion: async (version: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.removeSelectedPackageVersion(version);
        },
        selectPackageCatalogItem: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.selectPackageCatalogItem(packagePath);
        },
        updatePreferences: async (preferences: Partial<IPluginManagerPanelPreferencesPayload>): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.updatePreferences(preferences);
        },
        registerPackageSource: async (source: IPluginManualPackageSourceInputPayload): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.registerPackageSource(source);
        },
        removePackageSource: async (packagePath: string): Promise<IPluginManagerPanelUiState> => {
            return pluginManagerPanelUiController.removePackageSource(packagePath);
        },
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const stateListeners = targetWindow.__PEANUT_PLUGIN_MANAGER_PANEL_STATE_LISTENERS__ ?? [];
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    for (const stateListener of stateListeners) {
        stateListener(state);
    }
}
