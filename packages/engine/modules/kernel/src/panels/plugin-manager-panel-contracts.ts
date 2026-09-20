import type {
    ContractPayload,
    IMcpJsonSchema,
    ICleanupStepResult,
    IPluginFailureExport,
    IPluginFailureIncident,
    IPluginDiagnosticExport,
    IPluginInstallPlan,
    IPluginInstallResult,
    IPluginRuntimeRecord,
    LocalizedText,
    IPluginUninstallResult,
    IsoDateTimeString,
    PluginFailurePhase,
    PluginId,
    McpCapabilityRisk,
    McpCapabilityCategory,
    McpCapabilityExecutionModel,
    PluginState,
    PluginVersion,
    TaskStatus,
} from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import type { IPluginDevelopmentSessionSnapshot } from '../development/plugin-development-controller.js';

/**
 * @description 插件管理面板支持的显示语言。
 */
export type PluginManagerPanelLocale = 'en-US' | 'zh-CN';

/** @description 插件文件存储摘要载荷。 */
export interface IPluginStorageSummaryPayload extends ContractPayload {
    /** @description 插件标识。 */
    readonly pluginId: PluginId;
    /** @description 缓存总字节数。 */
    readonly cacheSize: number;
    /** @description 是否存在任一设置层。 */
    readonly hasConfig: boolean;
}

/** @description 缓存清理结果载荷。 */
export interface IPluginStorageClearPayload extends ContractPayload {
    /** @description 清理范围。 */
    readonly scope: 'plugin' | 'all';
    /** @description 目标插件；全量清理时为 `null`。 */
    readonly pluginId: PluginId | null;
    /** @description 已清理字节数。 */
    readonly clearedBytes: number;
}

/** @description 插件磁盘对账与文件仓修复结果载荷。 */
export interface IPluginStorageReconcilePayload extends ContractPayload {
    /** @description 是否执行了修复。 */
    readonly repaired: boolean;
    /** @description 修复动作摘要。 */
    readonly actions: readonly string[];
}

/**
 * @description 插件失败列表单项载荷。
 */
export interface IPluginFailureListItemPayload extends ContractPayload {
    /**
     * @description 失败插件标识。
     */
    readonly pluginId: PluginId;

    /**
     * @description 当前运行时状态；未知时返回 `null`。
     */
    readonly state: PluginState | null;

    /**
     * @description 失败阶段。
     */
    readonly phase: PluginFailurePhase;

    /**
     * @description 失败时间，使用 ISO 时间字符串。
     */
    readonly failedAt: IsoDateTimeString;

    /**
     * @description 失败后是否保留安装产物。
     */
    readonly installPreserved: boolean;

    /**
     * @description 当前运行时健康摘要；未知时返回 `null`。
     */
    readonly summary: string | null;
}

/**
 * @description 插件失败详情载荷。
 */
export interface IPluginFailureDetailPayload extends ContractPayload {
    /**
     * @description 目标插件当前运行时记录；插件不存在时返回 `null`。
     */
    readonly runtimeRecord: IPluginRuntimeRecord | null;

    /**
     * @description 目标插件当前失败事件；不存在时返回 `null`。
     */
    readonly incident: IPluginFailureIncident | null;

    /**
     * @description 目标插件当前已安装包版本快照；未安装时返回 `null`。
     */
    readonly installedPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;
}

/**
 * @description 插件失败导出载荷。
 */
export interface IPluginFailureExportPayload extends ContractPayload {
    /**
     * @description 失败事件导出结果。
     */
    readonly exportResult: IPluginFailureExport | null;
    /** @description 写入项目 peanut-plugins/logs/<pluginId> 的诊断日志结果。 */
    readonly diagnosticExport: IPluginDiagnosticExport | null;
}

/**
 * @description 插件清理重试载荷。
 */
export interface IRetryCleanupPayload extends ContractPayload {
    /**
     * @description 本次清理重试的步骤结果列表。
     */
    readonly cleanupSteps: readonly ICleanupStepResult[];

    /**
     * @description 重试后的当前失败事件；不存在时返回 `null`。
     */
    readonly incident: IPluginFailureIncident | null;
}

/**
 * @description 插件运行时动作执行结果载荷。
 */
export interface IPluginRuntimeActionPayload extends ContractPayload {
    /**
     * @description 执行的运行时动作名称。
     */
    readonly action: 'activate' | 'deactivate' | 'dispose';

    /**
     * @description 动作完成后的运行时记录；插件不存在时返回 `null`。
     */
    readonly runtimeRecord: IPluginRuntimeRecord | null;

    /**
     * @description 动作完成后的失败事件；不存在时返回 `null`。
     */
    readonly incident: IPluginFailureIncident | null;
}

/**
 * @description 插件管理器内嵌面板解析结果。
 */
export interface IPluginEmbeddedPanelPayload extends ContractPayload {
    /** @description 面板所属插件标识。 */
    readonly pluginId: PluginId;

    /** @description 面板稳定标识。 */
    readonly panelId: string;

    /** @description 面板显示标题。 */
    readonly title: string;

    /** @description 已通过安装目录边界校验且真实存在的面板入口。 */
    readonly entry: string;
}

/**
 * @description 面板侧已安装插件快照。
 */
export interface IPluginManagerInstalledPackageSnapshotPayload extends ContractPayload {
    /**
     * @description 插件标识。
     */
    readonly pluginId: PluginId;

    /**
     * @description 当前活动版本。
     */
    readonly activeVersion: PluginVersion;

    /**
     * @description 当前保留的全部已安装版本号。
     */
    readonly versions: readonly PluginVersion[];
}

/**
 * @description 插件包计划载荷。
 */
export interface IPluginPackagePlanPayload extends ContractPayload {
    /**
     * @description 计划结果。
     */
    readonly installPlan: IPluginInstallPlan;

    /**
     * @description 当前插件安装快照；无命中时返回 `null`。
     */
    readonly installedPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;
}

/**
 * @description 插件包动作结果载荷。
 */
export interface IPluginPackageActionPayload extends ContractPayload {
    /**
     * @description 当前包动作名称。
     */
    readonly action: 'install' | 'upgrade' | 'uninstall';

    /**
     * @description 普通安装或升级的结构化结果；卸载动作时返回 `null`。
     */
    readonly installResult: IPluginInstallResult | null;

    /**
     * @description 卸载的结构化结果；安装或升级动作时返回 `null`。
     */
    readonly uninstallResult: IPluginUninstallResult | null;

    /**
     * @description 动作完成后的当前插件安装快照；无命中时返回 `null`。
     */
    readonly installedPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;

    /**
     * @description 动作完成后的运行时记录；当前动作未接入 runtime 时返回 `null`。
     */
    readonly runtimeRecord: IPluginRuntimeRecord | null;

    /**
     * @description 动作完成后的失败事件；不存在时返回 `null`。
     */
    readonly incident: IPluginFailureIncident | null;
}

/**
 * @description 面板侧 package catalog 单项载荷。
 */
export interface IPluginPackageCatalogItemPayload extends ContractPayload {
    /**
     * @description 来源类型。
     */
    readonly sourceKind: 'local' | 'manual' | 'registry';

    /**
     * @description 插件包路径。
     */
    readonly packagePath: string;

    /**
     * @description 插件源目录路径。
     */
    readonly sourcePath: string;

    /**
     * @description 插件标识。
     */
    readonly pluginId: PluginId;

    /**
     * @description 插件版本。
     */
    readonly version: PluginVersion;

    /**
     * @description 插件在包目录卡片中展示的名称。
     */
    readonly displayName?: string;

    /**
     * @description 已验证的内联 PNG data URL；缺失时界面使用中性占位符。
     */
    readonly iconUrl?: string;

    /**
     * @description 当前已安装活动版本；未安装时返回 `null`。
     */
    readonly installedActiveVersion: PluginVersion | null;
}

/**
 * @description 手工来源登记输入。
 */
export interface IPluginManualPackageSourceInputPayload extends ContractPayload {
    /**
     * @description 来源类型。
     */
    readonly sourceKind: 'manual' | 'registry';

    /**
     * @description 插件包路径。
     */
    readonly packagePath: string;

    /**
     * @description 插件源目录或远端来源标签。
     */
    readonly sourcePath: string;

    /**
     * @description 插件标识。
     */
    readonly pluginId: PluginId;

    /**
     * @description 插件版本。
     */
    readonly version: PluginVersion;
}

/**
 * @description 手工来源注册表动作结果。
 */
export interface IPluginPackageSourceActionPayload extends ContractPayload {
    /**
     * @description 动作名称。
     */
    readonly action: 'register' | 'remove';

    /**
     * @description 更新后的 package catalog 列表。
     */
    readonly packageCatalog: readonly IPluginPackageCatalogItemPayload[];
}

/**
 * @description 插件管理面板持久化偏好。
 */
export interface IPluginManagerPanelPreferencesPayload extends ContractPayload {
    /**
     * @description 当前界面显示语言。
     */
    readonly locale: PluginManagerPanelLocale;

    /**
     * @description 当前 package catalog 筛选模式。
     */
    readonly packageFilter: 'all' | 'installed' | 'not-installed' | 'upgrade';

    /**
     * @description 当前 package catalog 排序模式。
     */
    readonly packageCatalogSort: 'plugin-id-asc' | 'plugin-id-desc' | 'source-asc' | 'recent-first';

    /**
     * @description 最近一次选中的插件标识；未命中时返回 `null`。
     */
    readonly selectedPluginId: PluginId | null;

    /**
     * @description 最近一次选中的 package 路径；未命中时返回 `null`。
     */
    readonly selectedPackagePath: string | null;
}

/**
 * @description 可由管理器设置面板编辑的界面偏好。
 */
export interface IPluginManagerEditablePanelPreferencesPayload extends ContractPayload {
    /** @description 当前界面显示语言。 */
    readonly locale: PluginManagerPanelLocale;

    /** @description 当前 package catalog 筛选模式。 */
    readonly packageFilter: IPluginManagerPanelPreferencesPayload['packageFilter'];

    /** @description 当前 package catalog 排序模式。 */
    readonly packageCatalogSort: IPluginManagerPanelPreferencesPayload['packageCatalogSort'];
}

/**
 * @description 管理器设置面板初始化快照。
 */
export interface IPluginManagerSettingsSnapshotPayload extends ContractPayload {
    /** @description 当前可编辑界面偏好。 */
    readonly preferences: IPluginManagerEditablePanelPreferencesPayload;

    /** @description 当前持久化设置版本，用于避免并发保存覆盖。 */
    readonly revision: number;
}

/**
 * @description 管理器设置面板的完整保存请求。
 */
export interface IPluginManagerSettingsUpdatePayload extends ContractPayload {
    /** @description 保存时观察到的设置版本。 */
    readonly expectedRevision: number;

    /** @description 已完成表单校验的完整界面偏好。 */
    readonly preferences: IPluginManagerEditablePanelPreferencesPayload;
}

/**
 * @description 内核重载请求结果载荷。
 */
export interface IPluginManagerKernelReloadPayload extends ContractPayload {
    /**
     * @description 当前请求是否已被接受并进入重载调度。
     */
    readonly accepted: boolean;
}

/**
 * @description 插件已安装版本列表载荷。
 */
export interface IPluginPackageVersionsPayload extends ContractPayload {
    /** @description 目标插件标识。 */
    readonly pluginId: PluginId;

    /** @description 当前多版本安装快照；未安装时返回 `null`。 */
    readonly installedPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;
}

/**
 * @description 插件版本切换或删除动作结果载荷。
 */
export interface IPluginPackageVersionActionPayload extends ContractPayload {
    /** @description 已执行的版本管理动作。 */
    readonly action: 'switch' | 'remove';

    /** @description 目标插件标识。 */
    readonly pluginId: PluginId;

    /** @description 本次操作指定的版本。 */
    readonly version: PluginVersion;

    /** @description 操作后的多版本安装快照；插件无版本时返回 `null`。 */
    readonly installedPackageSnapshot: IPluginManagerInstalledPackageSnapshotPayload | null;
}

/**
 * @description 插件管理面板初始化快照载荷。
 */
export interface IPluginManagerSnapshotPayload extends ContractPayload {
    /**
     * @description 当前已注册插件的运行时记录列表。
     */
    readonly runtimeRecords: readonly IPluginRuntimeRecord[];

    /**
     * @description 当前失败插件列表摘要。
     */
    readonly failureItems: readonly IPluginFailureListItemPayload[];

    /**
     * @description 当前可选的已打包 package source 列表。
     */
    readonly packageCatalog: readonly IPluginPackageCatalogItemPayload[];

    /**
     * @description 当前面板持久化保存的最近使用 package 路径列表。
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
     * @description 当前 runtime 执行诊断快照。
     */
    readonly executionDiagnosticsSnapshot: IExecutionDiagnosticsSnapshot;

    /**
     * @description 当前本机开发控制服务状态与最近受控操作记录。
     */
    readonly developmentSession: IPluginDevelopmentSessionSnapshot;

    /** @description 当前项目的 MCP Hub 状态与已公开 capability。 */
    readonly mcpHub: IPluginManagerMcpHubPayload;
}

/**
 * @description 插件管理面板展示的 MCP capability 摘要。
 */
export interface IPluginManagerMcpCapabilityPayload extends ContractPayload {
    /** @description 全局 capability 名称。 */
    readonly name: string;
    /** @description capability 的用途说明。 */
    readonly description: LocalizedText;
    /** @description capability 在工作台中的声明分类。 */
    readonly category: McpCapabilityCategory;
    /** @description capability 的受限输入 schema。 */
    readonly inputSchema: IMcpJsonSchema;
    /** @description 是否不会修改项目。 */
    readonly readOnly: boolean;
    /** @description capability 风险等级。 */
    readonly risk: McpCapabilityRisk;
    /** @description capability 的执行模型；未声明时为 inline。 */
    readonly executionModel: McpCapabilityExecutionModel;
}

/**
 * @description 等待编辑器用户确认的 MCP 写操作计划。
 */
export interface IPluginManagerMcpPendingPlanPayload extends ContractPayload {
    /** @description 一次性计划标识。 */
    readonly id: string;
    /** @description 请求执行的 capability 名称。 */
    readonly name: string;
    /** @description capability 风险等级。 */
    readonly risk: McpCapabilityRisk;
    /** @description 计划到期 Unix 时间戳，单位毫秒。 */
    readonly expiresAt: number;
}

/**
 * @description 插件管理面板展示的 MCP 调用审计摘要；不包含输入、输出或连接信息。
 */
export interface IPluginManagerMcpRecentCallPayload extends ContractPayload {
    /** @description 仅作面板渲染使用的审计记录标识。 */
    readonly id: string;
    /** @description 被请求的 capability 名称。 */
    readonly name: string;
    /** @description capability 的声明分类。 */
    readonly category: McpCapabilityCategory;
    /** @description capability 的风险等级。 */
    readonly risk: McpCapabilityRisk;
    /** @description 当前调用阶段。 */
    readonly status: 'pending_approval' | 'approved' | 'succeeded' | 'failed' | 'rejected' | 'expired';
    /** @description Hub 接收该请求的 Unix 时间戳，单位毫秒。 */
    readonly requestedAt: number;
    /** @description 终态产生的 Unix 时间戳；未完成时为 `null`。 */
    readonly completedAt: number | null;
    /** @description 已完成调用的耗时，单位毫秒；未完成时为 `null`。 */
    readonly durationMs: number | null;
    /** @description 安全错误码；不透传 capability 原始错误。 */
    readonly errorCode: string | null;
    /** @description 关联受管任务标识；inline 调用为 `null`。 */
    readonly taskId: string | null;
    /** @description 关联受管任务安全状态；inline 调用为 `null`。 */
    readonly taskStatus: TaskStatus | null;
}

/**
 * @description 插件管理面板展示的 MCP Hub 状态。
 */
export interface IPluginManagerMcpHubPayload extends ContractPayload {
    /** @description 当前宿主是否配置了 MCP Hub。 */
    readonly isAvailable: boolean;
    /** @description 当前项目是否允许 MCP bridge 连接。 */
    readonly isEnabled: boolean;
    /** @description 动态 loopback 端口；未启动时为 `null`。 */
    readonly port: number | null;
    /**
     * @description 本项目偏好端口；仅项目内粘滞，并行工程互不影响。
     */
    readonly preferredPort: number | null;
    /** @description 当前 capability 目录版本。 */
    readonly catalogRevision: number;
    /** @description 已公开给单一外部 MCP 的 capability。 */
    readonly capabilities: readonly IPluginManagerMcpCapabilityPayload[];
    /**
     * @description 保持插件运行但不向 MCP Hub 公开 capability 的插件标识。
     */
    readonly disabledPluginIds: readonly PluginId[];
    /** @description 已显式允许公开写 capability 的插件标识；其余未关闭插件仅公开只读 capability。 */
    readonly writeEnabledPluginIds: readonly PluginId[];
    /**
     * @description 测试用直写开关；为 true 时写 capability 可跳过 plan 审批直接执行。
     */
    readonly directWriteEnabled: boolean;
    /** @description 等待用户确认的写操作计划。 */
    readonly pendingPlans: readonly IPluginManagerMcpPendingPlanPayload[];
    /** @description 当前编辑器会话内最近的 MCP 调用审计记录。 */
    readonly recentCalls: readonly IPluginManagerMcpRecentCallPayload[];
}

/**
 * @description MCP Hub 启用状态更新请求。
 */
export interface IPluginManagerMcpEnabledUpdatePayload extends ContractPayload {
    /** @description 是否启用当前项目的 MCP Hub。 */
    readonly isEnabled: boolean;
}

/**
 * @description 指定插件 MCP capability 公开状态更新请求。
 */
export interface IPluginManagerMcpPluginEnabledUpdatePayload extends ContractPayload {
    /**
     * @description 目标插件标识。
     */
    readonly pluginId: PluginId;
    /**
     * @description 是否向 MCP Hub 公开该插件 capability。
     */
    readonly isEnabled: boolean;
}

/** @description 插件 MCP capability 面向外部 Hub 的公开级别。 */
export type PluginMcpExposureMode = 'disabled' | 'read_only' | 'all';

/**
 * @description 指定插件 MCP capability 公开级别更新请求。
 */
export interface IPluginManagerMcpPluginExposureUpdatePayload extends ContractPayload {
    /** @description 目标插件标识。 */
    readonly pluginId: PluginId;
    /** @description 关闭、仅只读或全部公开。 */
    readonly mode: PluginMcpExposureMode;
}

/**
 * @description MCP 写操作计划审批请求。
 */
export interface IPluginManagerMcpPlanActionPayload extends ContractPayload {
    /** @description 待审批或拒绝的一次性计划标识。 */
    readonly planId: string;
}
