import type { IPluginRuntimeRecord } from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import type { IPluginDevelopmentSessionSnapshot } from '../development/plugin-development-controller.js';
import type {
    IPluginFailureListItemPayload,
    IPluginPackageCatalogItemPayload,
} from './plugin-manager-panel-contracts.js';
import type {
    IPluginManagerPanelUiState,
    PluginManagerExecutionPriorityFilter,
} from './plugin-manager-panel-ui-types.js';
import { PluginManagerPanelExecutionView } from './plugin-manager-panel-ui-execution-view.js';

/**
 * @description 构造插件管理面板状态并投影可继续保留的选中项。
 */
export class PluginManagerPanelStateProjector {
    /**
     * @description 未启用开发控制服务时的稳定空快照。
     */
    public static readonly EMPTY_DEVELOPMENT_SESSION: IPluginDevelopmentSessionSnapshot = {
        enabled: false,
        port: null,
        recentOperations: [],
    };

    /**
     * @description 创建面板初始状态。
     * @param pluginId 面板所属插件标识
     * @param panelId 面板稳定标识
     * @returns 完整初始状态
     */
    public createInitialState(pluginId: string, panelId: string): IPluginManagerPanelUiState {
        return {
            pluginId,
            panelId,
            status: 'idle',
            runtimeRecords: [],
            failureItems: [],
            packageCatalog: [],
            recentPackagePaths: [],
            preferences: {
                locale: 'zh-CN',
                packageFilter: 'all',
                packageCatalogSort: 'plugin-id-asc',
                selectedPluginId: null,
                selectedPackagePath: null,
            },
            kernelReloadSupported: false,
            selectedPluginId: null,
            selectedPackagePath: null,
            selectedRuntimeRecord: null,
            embeddedPanel: null,
            selectedInstalledPackageSnapshot: null,
            selectedIncident: null,
            selectedFailureExport: null,
            selectedDiagnosticExport: null,
            lastCleanupSteps: [],
            lastPackageActionSummary: null,
            lastError: null,
            executionDiagnosticsSnapshot: null,
            developmentSession: PluginManagerPanelStateProjector.EMPTY_DEVELOPMENT_SESSION,
            mcpHub: {
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
            },
            executionPriorityFilter: 'all',
            showOnlyExceptionalExecutionGroups: false,
            selectedExecutionGroupId: null,
        };
    }

    /**
     * @description 从最新插件快照选择仍存在的插件。
     * @param pluginManagerSnapshot 插件运行态与失败项快照
     * @param preferredPluginId 优先保留的插件标识
     * @returns 可选中的插件标识
     */
    public resolveSelectedPluginId(
        pluginManagerSnapshot: {
            readonly runtimeRecords: readonly IPluginRuntimeRecord[];
            readonly failureItems: readonly IPluginFailureListItemPayload[];
        },
        preferredPluginId: string | null,
    ): string | null {
        if (preferredPluginId != null) {
            const existingRuntimeRecord = pluginManagerSnapshot.runtimeRecords.find((runtimeRecord) => {
                return runtimeRecord.pluginId === preferredPluginId;
            });
            if (existingRuntimeRecord != null) {
                return existingRuntimeRecord.pluginId;
            }
        }

        const firstFailureItem = pluginManagerSnapshot.failureItems[0];
        if (firstFailureItem != null) {
            return firstFailureItem.pluginId;
        }
        return pluginManagerSnapshot.runtimeRecords[0]?.pluginId ?? null;
    }

    /**
     * @description 从最新目录选择仍存在且匹配当前插件的软件包路径。
     * @param packageCatalog 软件包目录
     * @param preferredPackagePath 优先保留的软件包路径
     * @param selectedPluginId 当前插件标识
     * @returns 可选中的软件包路径
     */
    public resolveSelectedPackagePath(
        packageCatalog: readonly IPluginPackageCatalogItemPayload[],
        preferredPackagePath: string | null,
        selectedPluginId: string | null,
    ): string | null {
        if (preferredPackagePath != null) {
            const existingPackageCatalogItem = packageCatalog.find((packageCatalogItem) => {
                return packageCatalogItem.packagePath === preferredPackagePath;
            });
            if (existingPackageCatalogItem != null) {
                return existingPackageCatalogItem.packagePath;
            }
        }

        if (selectedPluginId != null) {
            const selectedPluginPackageCatalogItem = packageCatalog.find((packageCatalogItem) => {
                return packageCatalogItem.pluginId === selectedPluginId;
            });
            if (selectedPluginPackageCatalogItem != null) {
                return selectedPluginPackageCatalogItem.packagePath;
            }
        }
        return packageCatalog[0]?.packagePath ?? null;
    }

    /**
     * @description 从当前过滤结果选择仍可见的执行诊断组。
     * @param executionDiagnosticsSnapshot 执行诊断快照
     * @param preferredGroupId 优先保留的组标识
     * @param priorityFilter 优先级过滤器
     * @param showOnlyExceptionalExecutionGroups 是否只显示异常组
     * @returns 可选中的执行组标识
     */
    public resolveSelectedExecutionGroupId(
        executionDiagnosticsSnapshot: IExecutionDiagnosticsSnapshot | null,
        preferredGroupId: string | null,
        priorityFilter: PluginManagerExecutionPriorityFilter,
        showOnlyExceptionalExecutionGroups: boolean,
    ): string | null {
        const availableGroups = PluginManagerPanelExecutionView.getDisplayedExecutionGroups(
            executionDiagnosticsSnapshot,
            priorityFilter,
            showOnlyExceptionalExecutionGroups,
        );
        if (preferredGroupId != null) {
            const existingGroup = availableGroups.find((groupSnapshot) => {
                return groupSnapshot.groupId === preferredGroupId;
            });
            if (existingGroup != null) {
                return existingGroup.groupId;
            }
        }
        return availableGroups[0]?.groupId ?? null;
    }
}
