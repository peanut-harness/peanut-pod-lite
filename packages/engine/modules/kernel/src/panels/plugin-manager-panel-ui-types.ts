import type { ICleanupStepResult, IPluginDiagnosticExport, IPluginFailureExport, IPluginFailureIncident, IPluginRuntimeRecord } from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot, IExecutionGroupSnapshot } from '@peanut/pod-engine/runtime';

import type { IPluginDevelopmentSessionSnapshot } from '../development/plugin-development-controller.js';
import type { IPanelBridgeBrowserWindow } from './browser-panel-bridge-bootstrap.js';
import type {
    IPluginEmbeddedPanelPayload,
    IPluginFailureExportPayload,
    IPluginFailureListItemPayload,
    IPluginManualPackageSourceInputPayload,
    IPluginManagerInstalledPackageSnapshotPayload,
    IPluginManagerMcpHubPayload,
    IPluginManagerPanelPreferencesPayload,
    IPluginManagerSnapshotPayload,
    IPluginPackageCatalogItemPayload,
} from './plugin-manager-panel-contracts.js';

export type PluginManagerPanelUiStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * @description 插件管理面板 execution diagnostics 的优先级过滤器。
 */
export type PluginManagerExecutionPriorityFilter = IExecutionGroupSnapshot['priority'] | 'all';

/**
 * @description 插件管理面板所需的最小文档接口。
 */
export interface IPluginManagerPanelDocumentLike {
    /**
     * @description 当前页面根节点。
     */
    readonly body: IPluginManagerPanelElementLike;

    /**
     * @description 创建一个新的元素节点。
     * @param tagName 元素标签名
     * @returns 新创建的元素节点
     */
    createElement(tagName: string): IPluginManagerPanelElementLike;
}

/**
 * @description 插件管理面板所需的最小元素接口。
 */
export interface IPluginManagerPanelElementLike {
    /**
     * @description 元素稳定标识。
     */
    id: string;

    /**
     * @description 元素类名字符串。
     */
    className: string;

    /**
     * @description 元素文本内容。
     */
    textContent: string | null;

    /**
     * @description 元素 HTML 内容快照。
     */
    innerHTML: string;

    /**
     * @description 元素是否禁用。
     */
    disabled?: boolean;

    /**
     * @description 元素是否隐藏。
     */
    hidden?: boolean;

    /**
     * @description 元素数据集。
     */
    readonly dataset: Record<string, string>;

    /**
     * @description 追加一个子节点。
     * @param child 需要追加的子节点
     * @returns 追加后的子节点
     */
    appendChild(child: IPluginManagerPanelElementLike): IPluginManagerPanelElementLike;

    /**
     * @description 使用给定子节点替换当前全部子节点。
     * @param children 需要挂载的全部子节点
     * @returns 无返回值
     */
    replaceChildren(...children: IPluginManagerPanelElementLike[]): void;

    /**
     * @description 绑定一个事件监听器。
     * @param eventName 事件名称
     * @param listener 事件处理函数
     * @returns 无返回值
     */
    addEventListener(eventName: string, listener: () => void | Promise<void>): void;
}

/**
 * @description 插件管理面板窗口上挂载的 UI 控制器最小句柄，避免类型文件反向依赖实现类。
 */
export interface IPluginManagerPanelUiHandle {
    /**
     * @description 当前 UI 状态快照。
     */
    readonly state: IPluginManagerPanelUiState;

    /**
     * @description 初始化控制器并加载面板数据。
     * @returns Promise 返回初始化后的 UI 状态快照
     */
    initialize(): Promise<IPluginManagerPanelUiState>;

    /**
     * @description 释放控制器持有的订阅与定时器。
     * @returns Promise 在释放完成后结束
     */
    dispose(): Promise<void>;
}

/**
 * @description 插件管理面板浏览器侧窗口对象。
 */
export interface IPluginManagerPanelBrowserWindow extends IPanelBridgeBrowserWindow {
    /**
     * @description 当前已挂载的插件管理面板 UI 控制器。
     */
    pluginManagerPanelUi?: IPluginManagerPanelUiHandle;

    /**
     * @description 当前对外暴露的面板 UI 状态快照。
     */
    pluginManagerPanelUiState?: IPluginManagerPanelUiState;

    /**
     * @description 当前面板可选的最小文档对象；存在时优先挂载真实 DOM 结构。
     */
    document?: IPluginManagerPanelDocumentLike;

    /**
     * @description 当前面板标题文本。
     */
    documentTitle?: string;

    /**
     * @description 当前面板主体 HTML 文本快照。
     */
    documentBodyHtml?: string;

    /**
     * @description 面板侧可直接调用的交互动作集合。
     */
    pluginManagerPanelUiActions?: {
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        refresh: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        reloadKernel: () => Promise<IPluginManagerPanelUiState>;
        reconcileDevelopmentPlugins: () => Promise<IPluginManagerPanelUiState>;
        reloadSelectedDevelopmentPlugin: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectPlugin: (pluginId: string | null) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        refreshExecutionDiagnostics: () => Promise<IPluginManagerPanelUiState>;
        setMcpHubEnabled: (isEnabled: boolean) => Promise<IPluginManagerPanelUiState>;
        approveMcpPlan: (planId: string) => Promise<IPluginManagerPanelUiState>;
        rejectMcpPlan: (planId: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectExecutionGroup: (groupId: string | null) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        setExecutionPriorityFilter: (priority: PluginManagerExecutionPriorityFilter) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        toggleExceptionalExecutionGroups: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        exportSelectedFailure: () => Promise<IPluginFailureExport | null>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        retrySelectedCleanup: () => Promise<readonly ICleanupStepResult[]>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        activateSelectedPlugin: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        deactivateSelectedPlugin: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        disposeSelectedPlugin: () => Promise<IPluginManagerPanelUiState>;
        /** @description 打开当前选中插件的内嵌面板。 */
        openSelectedPluginPanel: () => Promise<IPluginManagerPanelUiState>;
        /** @description 关闭当前内嵌插件面板。 */
        closeEmbeddedPluginPanel: () => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        planPackage: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installPackage: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /**
         * @description 下载并通过 Creator Host 的 CPM 事务安装已验签目录版本。
         */
        downloadTrustedCatalogPackage: (productId: string, version: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        upgradePackage: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        installAndActivatePackage: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        upgradeAndActivatePackage: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        uninstallSelectedPackage: () => Promise<IPluginManagerPanelUiState>;
        /** @description 切换当前选中插件的活动安装版本。 */
        switchSelectedPackageVersion: (version: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 删除当前选中插件的非活动安装版本。 */
        removeSelectedPackageVersion: (version: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        selectPackageCatalogItem: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        updatePreferences: (preferences: Partial<IPluginManagerPanelPreferencesPayload>) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        registerPackageSource: (source: IPluginManualPackageSourceInputPayload) => Promise<IPluginManagerPanelUiState>;
        /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
        removePackageSource: (packagePath: string) => Promise<IPluginManagerPanelUiState>;
    };

    /**
     * @description 状态变更监听器集合，供静态 panel 页面复用同一份 controller 状态。
     */
    __PEANUT_PLUGIN_MANAGER_PANEL_STATE_LISTENERS__?: Array<(state: IPluginManagerPanelUiState) => void>;
}

/**
 * @description 插件管理面板浏览器侧状态快照。
 */
export interface IPluginManagerPanelUiState {
    /**
     * @description 当前面板所属插件标识。
     */
    readonly pluginId: string;

    /**
     * @description 当前面板稳定标识。
     */
    readonly panelId: string;

    /**
     * @description 当前 UI 状态。
     */
    readonly status: PluginManagerPanelUiStatus;

    /**
     * @description 当前运行时插件列表。
     */
    readonly runtimeRecords: readonly IPluginRuntimeRecord[];

    /**
     * @description 当前失败插件摘要列表。
     */
    readonly failureItems: readonly IPluginFailureListItemPayload[];

    /**
     * @description 当前可选 package source 列表。
     */
    readonly packageCatalog: readonly IPluginPackageCatalogItemPayload[];

    readonly trustedCatalog?: IPluginManagerSnapshotPayload['trustedCatalog'];

    /**
     * @description 当前持久化保存的最近使用 package 路径列表。
     */
    readonly recentPackagePaths: readonly string[];

    /**
     * @description 当前面板持久化偏好。
     */
    readonly preferences: IPluginManagerPanelPreferencesPayload;

    /**
     * @description 当前是否允许从面板触发 kernel reload。
     */
    readonly kernelReloadSupported: boolean;

    /**
     * @description 当前选中的插件标识；未选中时返回 `null`。
     */
    readonly selectedPluginId: string | null;

    /**
     * @description 当前选中的 package 路径；未选中时返回 `null`。
     */
    readonly selectedPackagePath: string | null;

    /**
     * @description 当前选中的运行时记录；不存在时返回 `null`。
     */
    readonly selectedRuntimeRecord: IPluginRuntimeRecord | null;

    /** @description 当前已打开的内嵌插件面板；未打开时返回 `null`。 */
    readonly embeddedPanel: IPluginEmbeddedPanelPayload | null;

    /**
     * @description 当前选中插件的安装版本快照；未安装时返回 `null`。
     */
    readonly selectedInstalledPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;

    /**
     * @description 当前选中的失败事件；不存在时返回 `null`。
     */
    readonly selectedIncident: IPluginFailureIncident | null;

    /**
     * @description 最近一次导出的失败事件；不存在时返回 `null`。
     */
    readonly selectedFailureExport: IPluginFailureExport | null;
    /** @description 最近一次写入项目日志目录的诊断导出结果。 */
    readonly selectedDiagnosticExport: IPluginDiagnosticExport | null;

    /**
     * @description 最近一次清理重试步骤结果。
     */
    readonly lastCleanupSteps: readonly ICleanupStepResult[];

    /**
     * @description 最近一次包管理动作摘要；不存在时返回 `null`。
     */
    readonly lastPackageActionSummary: string | null;

    /**
     * @description 最近一次错误消息；不存在时返回 `null`。
     */
    readonly lastError: string | null;

    /**
     * @description 当前 runtime 执行诊断快照。
     */
    readonly executionDiagnosticsSnapshot: IExecutionDiagnosticsSnapshot | null;

    /**
     * @description 当前本机开发控制服务状态与最近操作记录。
     */
    readonly developmentSession: IPluginDevelopmentSessionSnapshot;

    /** @description 当前 MCP Hub 状态与待审批写操作。 */
    readonly mcpHub: IPluginManagerMcpHubPayload;

    /**
     * @description 当前 execution diagnostics 的 priority 过滤器。
     */
    readonly executionPriorityFilter: PluginManagerExecutionPriorityFilter;

    /**
     * @description 当前是否只显示异常执行组。
     */
    readonly showOnlyExceptionalExecutionGroups: boolean;

    /**
     * @description 当前选中的执行组标识；未选中时返回 `null`。
     */
    readonly selectedExecutionGroupId: string | null;
}
