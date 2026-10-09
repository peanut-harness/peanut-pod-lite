import type { PluginFailurePhase, PluginState, PluginTrustLevel } from '@peanut/pod-protocol';

import type { PluginManagerExecutionPriorityFilter } from './plugin-manager-panel-ui.js';
import type { PluginManagerPanelLocale } from './plugin-manager-panel-contracts.js';

type TranslationValue = string | Readonly<Record<string, string>>;

// 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
const PANEL_TRANSLATIONS: Record<PluginManagerPanelLocale, Record<string, TranslationValue>> = {
    'en-US': {
        'locale.label': 'Language',
        'locale.en-US': 'English',
        'locale.zh-CN': 'Simplified Chinese',
        'hero.controlSurface': 'Builtin Control Surface',
        'hero.title': 'Plugin Manager',
        'hero.subtitle': 'Runtime state and hotplug recovery overview.',
        'error.cocos_plugin_host_slots_exhausted': 'All plugin host slots are occupied. Close an open plugin panel and try again.',
        'hero.overview': 'overview',
        'status.live': 'Live',
        'status.preview': 'Preview',
        'status.liveBridge': 'Live host bridge connected.',
        'status.previewBridge': 'Preview bridge active.',
        'summary.runtime': 'Runtime',
        'summary.runtimeHint': 'registered plugins',
        'summary.failures': 'Failures',
        'summary.failuresHint': 'open incidents',
        'summary.selected': 'Selected',
        'summary.queue': 'Queue',
        'summary.none': 'none',
        'summary.idle': 'idle',
        'summary.noPluginSelected': 'no plugin selected',
        'sidebar.runtimeCatalog': 'Runtime Catalog',
        'sidebar.pluginsTitle': 'Plugins',
        'sidebar.pluginsCopy': 'Select a plugin to inspect runtime state and recovery actions.',
        'sidebar.failuresTitle': 'Failures',
        'sidebar.failuresCopy': 'Quarantined incidents that still need cleanup or manual review.',
        'empty.noPlugins': 'No plugins registered.',
        'empty.noPluginFailures': 'No plugin failures.',
        'empty.noPluginSelected': 'No plugin selected.',
        'detail.overview': 'Overview',
        'detail.choosePlugin': 'Choose a plugin from the left to inspect details.',
        'detail.failureMessage': 'Failure Message',
        'detail.noFailureSelected': 'No failure selected.',
        'detail.noExport': 'No export has been generated yet.',
        'detail.version': 'Version',
        'detail.trust': 'Trust',
        'detail.failurePhase': 'Failure Phase',
        'detail.export': 'Export',
        'detail.exportReady': 'ready',
        'detail.exportPending': 'not exported',
        'detail.installedActive': 'Installed Active',
        'detail.installedVersions': 'Installed Versions',
        'detail.notInstalled': 'not installed',
        'detail.none': 'none',
        'actions.title': 'Lifecycle And Recovery',
        'actions.copy': 'Available: refresh, export, retry cleanup, activate, deactivate, and dispose. Actions execute through the live panel bridge.',
        'actions.refresh': 'Refresh',
        'actions.reloadKernel': 'Reload Kernel',
        'actions.export': 'Export Failure',
        'actions.retryCleanup': 'Retry Cleanup',
        'actions.activate': 'Activate',
        'actions.deactivate': 'Deactivate',
        'actions.dispose': 'Dispose',
        'actions.registerSource': 'Register Source',
        'actions.removeSource': 'Remove Source',
        'actions.plan': 'Plan',
        'actions.install': 'Install',
        'actions.installActivate': 'Install + Activate',
        'actions.upgrade': 'Upgrade',
        'actions.upgradeActivate': 'Upgrade + Activate',
        'actions.uninstallSelected': 'Uninstall Selected',
        'package.title': 'Install, Upgrade, Uninstall',
        'package.sourceRegistry': 'Manual And Registry Sources',
        'package.recentSources': 'Recently Used',
        'package.packagePath': 'Package Path',
        'package.pending': 'Package actions pending.',
        'package.noSources': 'No packaged sources available.',
        'package.noRecentSources': 'No recent package sources.',
        'package.searchPlaceholder': 'Search plugin id / source / package path',
        'package.pluginIdPlaceholder': 'plugin id',
        'package.versionPlaceholder': 'version',
        'package.sourcePathPlaceholder': 'source path / registry label',
        'package.packagePathPlaceholder': 'package path',
        'package.installPathPlaceholder': 'packages/sample.plugin-0.1.0.pcp',
        'package.filter.all': 'All Sources',
        'package.filter.installed': 'Installed',
        'package.filter.not-installed': 'Not Installed',
        'package.filter.upgrade': 'Upgrade Candidates',
        'package.sort.plugin-id-asc': 'Plugin Id A-Z',
        'package.sort.plugin-id-desc': 'Plugin Id Z-A',
        'package.sort.source-asc': 'Source A-Z',
        'package.sort.recent-first': 'Recent First',
        'package.action.install': 'install',
        'package.action.upgrade': 'upgrade',
        'package.action.uninstall': 'uninstall',
        'package.summary.install': 'install completed for {pluginId}@{version}.',
        'package.summary.upgrade': 'upgrade completed for {pluginId}@{version}.',
        'package.summary.uninstall': 'uninstall completed for {pluginId}.',
        'package.summary.default': '{action} completed.',
        'package.planSummary': '{action} plan ready for {pluginId}@{version}.',
        'cleanup.none': 'none',
        'cleanup.stable': 'stable',
        'cleanup.pending': 'pending',
        'cleanup.title': 'Cleanup Timeline',
        'cleanup.noSteps': 'No cleanup steps.',
        'cleanup.ok': 'ok',
        'execution.title': 'Execution Diagnostics',
        'execution.copy': 'Filter by priority, inspect recent exceptions, and expand task trace details.',
        'execution.unavailable': 'unavailable',
        'execution.noData': 'Execution diagnostics unavailable.',
        'execution.noSelection': 'No execution group selected.',
        'execution.showExceptional': 'Show Exceptional',
        'execution.exceptionalOnly': 'Exceptional Only',
        'execution.allGroups': 'All groups',
        'execution.exceptionalGroups': 'Exceptional only',
        'execution.refresh': 'Refresh Diagnostics',
        'execution.planning': 'Planning',
        'execution.pendingCommit': 'Pending Commit',
        'execution.activeCommit': 'Active Commit',
        'execution.recentGroups': 'Recent Groups',
        'execution.current': 'Current',
        'execution.history': 'History',
        'execution.group': 'Group',
        'execution.task': 'Task',
        'execution.tracePending': 'Trace pending.',
        'execution.noTargets': 'no targets',
        'execution.noError': 'no error',
        'execution.noDetail': 'no detail',
        'execution.empty': 'none',
        'execution.flag.timeout': 'timeout',
        'execution.flag.cancelled': 'cancelled',
        'execution.flag.replan': 'replan',
        'execution.flag.ok': 'ok',
        phase: {
            none: 'none',
            host_compatibility: 'host compatibility',
            module_load: 'module load',
            activation_prepare: 'activation_prepare',
            register: 'register',
            activate: 'activate',
            deactivate: 'deactivate',
            dispose: 'dispose',
            cleanup: 'cleanup',
            cleanup_retry: 'cleanup_retry',
        },
        state: {
            none: 'none',
            idle: 'idle',
            loading: 'loading',
            ready: 'ready',
            error: 'error',
            discovered: 'discovered',
            validated: 'validated',
            staged: 'staged',
            loaded: 'loaded',
            registered: 'registered',
            active: 'active',
            inactive: 'inactive',
            disposed: 'disposed',
            failed: 'failed',
            planned: 'planned',
            completed: 'completed',
            skipped: 'skipped',
            succeeded: 'succeeded',
            cancelled: 'cancelled',
        },
        trust: {
            builtin: 'builtin',
            trusted: 'trusted',
            partner: 'partner',
            community: 'community',
        },
        priority: {
            all: 'all',
            critical: 'critical',
            high: 'high',
            normal: 'normal',
            low: 'low',
        },
        stage: {
            planning: 'planning',
            pending_commit: 'pending commit',
            committing: 'active commit',
        },
        sourceKind: {
            manual: 'manual',
            registry: 'registry',
            local: 'local',
            installed: 'installed',
        },
    },
    'zh-CN': {
        'locale.label': '语言',
        'locale.en-US': 'English',
        'locale.zh-CN': '简体中文',
        'hero.controlSurface': '内置控制台',
        'hero.title': '插件管理器',
        'hero.subtitle': '运行时状态与热插拔恢复总览。',
        'error.cocos_plugin_host_slots_exhausted': '插件宿主槽位已全部占用，请先关闭一个已打开的插件面板。',
        'hero.overview': '概览',
        'status.live': '实时',
        'status.preview': '预览',
        'status.liveBridge': '已连接实时宿主桥。',
        'status.previewBridge': '当前使用预览桥。',
        'summary.runtime': '运行时',
        'summary.runtimeHint': '已注册插件',
        'summary.failures': '故障',
        'summary.failuresHint': '待处理事件',
        'summary.selected': '当前选择',
        'summary.queue': '队列',
        'summary.none': '无',
        'summary.idle': '空闲',
        'summary.noPluginSelected': '未选择插件',
        'sidebar.runtimeCatalog': '运行时目录',
        'sidebar.pluginsTitle': '插件',
        'sidebar.pluginsCopy': '选择一个插件以查看运行时状态和恢复动作。',
        'sidebar.failuresTitle': '故障',
        'sidebar.failuresCopy': '仍需清理或人工处理的隔离事件。',
        'empty.noPlugins': '当前没有已注册插件。',
        'empty.noPluginFailures': '当前没有插件故障。',
        'empty.noPluginSelected': '当前未选择插件。',
        'detail.overview': '概览',
        'detail.choosePlugin': '从左侧选择一个插件以查看详情。',
        'detail.failureMessage': '失败消息',
        'detail.noFailureSelected': '当前未选择失败事件。',
        'detail.noExport': '尚未生成导出内容。',
        'detail.version': '版本',
        'detail.trust': '信任级别',
        'detail.failurePhase': '失败阶段',
        'detail.export': '导出',
        'detail.exportReady': '已生成',
        'detail.exportPending': '未导出',
        'detail.installedActive': '当前安装版本',
        'detail.installedVersions': '已安装版本',
        'detail.notInstalled': '未安装',
        'detail.none': '无',
        'actions.title': '生命周期与恢复',
        'actions.copy': '可执行：刷新、导出、重试清理、激活、停用、释放。所有动作都通过实时 panel bridge 执行。',
        'actions.refresh': '刷新',
        'actions.reloadKernel': '重载内核',
        'actions.export': '导出故障',
        'actions.retryCleanup': '重试清理',
        'actions.activate': '激活',
        'actions.deactivate': '停用',
        'actions.dispose': '释放',
        'actions.registerSource': '登记来源',
        'actions.removeSource': '移除来源',
        'actions.plan': '规划',
        'actions.install': '安装',
        'actions.installActivate': '安装并激活',
        'actions.upgrade': '升级',
        'actions.upgradeActivate': '升级并激活',
        'actions.uninstallSelected': '卸载当前选择',
        'package.title': '安装、升级、卸载',
        'package.sourceRegistry': '手工与注册表来源',
        'package.recentSources': '最近使用',
        'package.packagePath': '包路径',
        'package.pending': '等待执行包管理动作。',
        'package.noSources': '当前没有可用的打包来源。',
        'package.noRecentSources': '当前没有最近使用的包来源。',
        'package.searchPlaceholder': '搜索插件 id / 来源 / 包路径',
        'package.pluginIdPlaceholder': '插件 id',
        'package.versionPlaceholder': '版本',
        'package.sourcePathPlaceholder': '来源路径 / 注册表标签',
        'package.packagePathPlaceholder': '包路径',
        'package.installPathPlaceholder': 'packages/sample.plugin-0.1.0.pcp',
        'package.filter.all': '全部来源',
        'package.filter.installed': '已安装',
        'package.filter.not-installed': '未安装',
        'package.filter.upgrade': '可升级候选',
        'package.sort.plugin-id-asc': '插件 Id A-Z',
        'package.sort.plugin-id-desc': '插件 Id Z-A',
        'package.sort.source-asc': '来源 A-Z',
        'package.sort.recent-first': '最近优先',
        'package.action.install': '安装',
        'package.action.upgrade': '升级',
        'package.action.uninstall': '卸载',
        'package.summary.install': '已完成 {pluginId}@{version} 的安装。',
        'package.summary.upgrade': '已完成 {pluginId}@{version} 的升级。',
        'package.summary.uninstall': '已完成 {pluginId} 的卸载。',
        'package.summary.default': '已完成{action}动作。',
        'package.planSummary': '已生成 {pluginId}@{version} 的{action}计划。',
        'cleanup.none': '无',
        'cleanup.stable': '稳定',
        'cleanup.pending': '待处理',
        'cleanup.title': '清理时间线',
        'cleanup.noSteps': '当前没有清理步骤。',
        'cleanup.ok': '成功',
        'execution.title': '执行诊断',
        'execution.copy': '按优先级筛选，查看最近异常，并展开任务 trace 详情。',
        'execution.unavailable': '不可用',
        'execution.noData': '当前没有执行诊断数据。',
        'execution.noSelection': '当前未选择执行组。',
        'execution.showExceptional': '只看异常',
        'execution.exceptionalOnly': '仅异常',
        'execution.allGroups': '全部执行组',
        'execution.exceptionalGroups': '仅异常执行组',
        'execution.refresh': '刷新诊断',
        'execution.planning': '规划中',
        'execution.pendingCommit': '等待提交',
        'execution.activeCommit': '提交中',
        'execution.recentGroups': '最近执行组',
        'execution.current': '当前',
        'execution.history': '历史',
        'execution.group': '执行组',
        'execution.task': '任务',
        'execution.tracePending': 'Trace 尚未生成。',
        'execution.noTargets': '无目标',
        'execution.noError': '无错误',
        'execution.noDetail': '无详情',
        'execution.empty': '无',
        'execution.flag.timeout': '超时',
        'execution.flag.cancelled': '已取消',
        'execution.flag.replan': '已重规划',
        'execution.flag.ok': '正常',
        phase: {
            none: '无',
            host_compatibility: '宿主兼容性',
            module_load: '模块加载',
            activation_prepare: '激活准备',
            register: '注册',
            activate: '激活',
            deactivate: '停用',
            dispose: '释放',
            cleanup: '清理',
            cleanup_retry: '清理重试',
        },
        state: {
            none: '无',
            idle: '空闲',
            loading: '加载中',
            ready: '就绪',
            error: '错误',
            discovered: '已发现',
            validated: '已校验',
            staged: '已暂存',
            loaded: '已加载',
            registered: '已注册',
            active: '运行中',
            inactive: '未激活',
            disposed: '已释放',
            failed: '失败',
            planned: '已规划',
            completed: '已完成',
            skipped: '已跳过',
            succeeded: '成功',
            cancelled: '已取消',
        },
        trust: {
            builtin: '内置',
            trusted: '受信任',
            partner: '合作方',
            community: '社区',
        },
        priority: {
            all: '全部',
            critical: '关键',
            high: '高',
            normal: '普通',
            low: '低',
        },
        stage: {
            planning: '规划中',
            pending_commit: '等待提交',
            committing: '提交中',
        },
        sourceKind: {
            manual: '手工',
            registry: '注册表',
            local: '本地',
            installed: '已安装',
        },
    },
};

function resolveTranslationValue(locale: PluginManagerPanelLocale, key: string): TranslationValue | undefined {
    return PANEL_TRANSLATIONS[locale][key];
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function normalizePluginManagerPanelLocale(locale: string | undefined): PluginManagerPanelLocale {
    if (locale === 'en-US' || locale === 'zh-CN') {
        return locale;
    }
    return 'zh-CN';
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param key 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param params 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelText(
    locale: PluginManagerPanelLocale,
    key: string,
    params?: Readonly<Record<string, string>>,
): string {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const translationValue = resolveTranslationValue(locale, key);
    if (typeof translationValue !== 'string') {
        return key;
    }
    if (params == null) {
        return translationValue;
    }
    return Object.entries(params).reduce((renderedText, [paramKey, paramValue]) => {
        return renderedText.split(`{${paramKey}}`).join(paramValue);
    }, translationValue);
}

/**
 * @description 将宿主错误码转换为当前面板语言的可读错误文案。
 * @param locale 当前面板语言。
 * @param errorMessage 宿主返回的错误码或错误文本。
 * @returns 已知错误码的本地化文案；未知文本保持原样。
 */
export function translatePluginManagerPanelError(locale: PluginManagerPanelLocale, errorMessage: string): string {
    const translationValue = resolveTranslationValue(locale, `error.${errorMessage}`);
    return typeof translationValue === 'string' ? translationValue : errorMessage;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param state 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelState(locale: PluginManagerPanelLocale, state: string): string {
    return (resolveTranslationValue(locale, 'state') as Record<string, string> | undefined)?.[state] ?? state;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param phase 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelPhase(locale: PluginManagerPanelLocale, phase: PluginFailurePhase | string): string {
    return (resolveTranslationValue(locale, 'phase') as Record<string, string> | undefined)?.[phase] ?? phase;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param trustLevel 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelTrustLevel(locale: PluginManagerPanelLocale, trustLevel: PluginTrustLevel | string): string {
    return (resolveTranslationValue(locale, 'trust') as Record<string, string> | undefined)?.[trustLevel] ?? trustLevel;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param priority 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelPriority(
    locale: PluginManagerPanelLocale,
    priority: PluginManagerExecutionPriorityFilter | string,
): string {
    return (resolveTranslationValue(locale, 'priority') as Record<string, string> | undefined)?.[priority] ?? priority;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param stage 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelStage(locale: PluginManagerPanelLocale, stage: string): string {
    return (resolveTranslationValue(locale, 'stage') as Record<string, string> | undefined)?.[stage] ?? stage;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param sourceKind 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function translatePluginManagerPanelSourceKind(locale: PluginManagerPanelLocale, sourceKind: string): string {
    return (resolveTranslationValue(locale, 'sourceKind') as Record<string, string> | undefined)?.[sourceKind] ?? sourceKind;
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param action 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param pluginId 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param version 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function summarizePluginManagerPackageAction(
    locale: PluginManagerPanelLocale,
    action: 'install' | 'upgrade' | 'uninstall',
    pluginId: string,
    version: string | null,
): string {
    if (action === 'uninstall') {
        return translatePluginManagerPanelText(locale, 'package.summary.uninstall', {
            pluginId,
        });
    }
    if (version != null) {
        return translatePluginManagerPanelText(locale, `package.summary.${action}`, {
            pluginId,
            version,
        });
    }
    return translatePluginManagerPanelText(locale, 'package.summary.default', {
        action: translatePluginManagerPanelText(locale, `package.action.${action}`),
    });
}

/** @description 执行当前模块对外提供的处理流程。
 * @param locale 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param action 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param pluginId 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param version 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
export function summarizePluginManagerPackagePlan(
    locale: PluginManagerPanelLocale,
    action: 'install' | 'upgrade',
    pluginId: string,
    version: string,
): string {
    return translatePluginManagerPanelText(locale, 'package.planSummary', {
        action: translatePluginManagerPanelText(locale, `package.action.${action}`),
        pluginId,
        version,
    });
}
