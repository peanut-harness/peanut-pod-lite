const SNAPSHOT_EVENT = 'pluginManager.snapshot';
const DETAIL_EVENT = 'pluginManager.failure.detail';
const EXPORT_EVENT = 'pluginManager.failure.export';
const RETRY_EVENT = 'pluginManager.failure.retryCleanup';
const ACTIVATE_EVENT = 'pluginManager.runtime.activate';
const DEACTIVATE_EVENT = 'pluginManager.runtime.deactivate';
const DISPOSE_EVENT = 'pluginManager.runtime.dispose';
const PANEL_RESOLVE_EVENT = 'pluginManager.panel.resolve';
const PACKAGE_PLAN_EVENT = 'pluginManager.package.plan';
const PACKAGE_INSTALL_EVENT = 'pluginManager.package.install';
const PACKAGE_UPGRADE_EVENT = 'pluginManager.package.upgrade';
const PACKAGE_UNINSTALL_EVENT = 'pluginManager.package.uninstall';
const PACKAGE_PICK_DIRECTORY_EVENT = 'pluginManager.package.pickDirectory';
const PACKAGE_SWITCH_VERSION_EVENT = 'pluginManager.package.switchVersion';
const PACKAGE_REMOVE_VERSION_EVENT = 'pluginManager.package.removeVersion';
const AUTHORING_CREATE_EVENT = 'pluginManager.authoring.create';
const PACKAGE_PACK_EVENT = 'pluginManager.package.pack';
const PREFERENCES_UPDATE_EVENT = 'pluginManager.preferences.update';
const EXECUTION_DIAGNOSTICS_EVENT = 'pluginManager.executionDiagnostics';
const KERNEL_RELOAD_EVENT = 'pluginManager.kernel.reload';
const MCP_SET_ENABLED_EVENT = 'pluginManager.mcp.setEnabled';
const MCP_SET_PLUGIN_ENABLED_EVENT = 'pluginManager.mcp.setPluginEnabled';
const MCP_SET_PLUGIN_EXPOSURE_EVENT = 'pluginManager.mcp.setPluginExposure';
const MCP_APPROVE_PLAN_EVENT = 'pluginManager.mcp.plan.approve';
const MCP_REJECT_PLAN_EVENT = 'pluginManager.mcp.plan.reject';
const BUILTIN_PLUGIN_MANAGER_PANEL_ID = 'builtin.plugin-manager.panel';

const PANEL_TRANSLATIONS = {
    'en-US': {
        'authoring.sourceDirectory': 'Plugin source directory',
        'package.runtimeSource': 'Current project',
        'package.runtimeVersion': 'Runtime version',
        'package.loaded': 'Loaded',
        'package.selectVersion': 'Switch version',
        'package.offline': 'Open this panel in Creator to view project plugins.',
        'package.emptyChannel': 'No plugins in this channel.',
        'package.noMatches': 'No plugins match this filter.',
        'package.runtimeHeading': 'Runtime controls',

        'locale.label': 'Language',
        'locale.en-US': 'English',
        'locale.zh-CN': 'Simplified Chinese',
        'tab.runtime': 'Runtime',
        'tab.packages': 'Packages',
        'tab.diagnostics': 'Diagnostics',
        'tab.installed': 'Installed',
        'tab.remote': 'Plugins',
        'tab.authoring': 'Developer',
        'tab.extensions': 'Extension Tools',
        'tab.about': 'About',
        'hero.controlSurface': 'Builtin Control Surface',
        'hero.title': 'Plugin Manager',
        'hero.subtitle': 'Runtime state and hotplug recovery overview.',
        'hero.overview': 'overview',
        'hero.waitingBridge': 'Waiting for panel bridge to provide runtime data.',
        'status.live': 'Live',
        'status.preview': 'Preview',
        'status.liveBridge': 'Live host bridge connected.',
        'status.previewBridge': 'Preview bridge active.',
        'toast.pending': 'Processing…',
        'summary.runtime': 'Runtime',
        'summary.runtimeHint': 'registered plugins',
        'summary.installed': 'Installed',
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
        'detail.descriptionEyebrow': 'Plugin Overview',
        'detail.descriptionTitle': 'Description',
        'detail.descriptionFallback': 'No feature description is available for this plugin.',
        'mcp.selectCapability': 'Select an MCP capability on the left to inspect its details.',
        'mcp.pluginExposure': 'AI access',
        'mcp.exposure.disabled': 'Off',
        'mcp.exposure.readOnly': 'Read-only',
        'mcp.exposure.all': 'Full access',
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
        'actions.openPanel': 'Open Panel',
        'actions.closePanel': 'Back to Manager',
        'actions.settings': 'Settings',
        'settings.title': 'Settings',
        'settings.eyebrow': 'PLUGIN MANAGER',
        'settings.language': 'Display language',
        'settings.packageFilter': 'Default package filter',
        'settings.packageSort': 'Default package sort',
        'settings.restoreDefaults': 'Restore Defaults',
        'settings.cancel': 'Cancel',
        'settings.save': 'Save',
        'actions.createUnavailable': 'New',
        'actions.registerSource': 'Register Source',
        'actions.removeSource': 'Remove Source',
        'actions.plan': 'Plan',
        'actions.pack': 'Package Source',
        'actions.repairPackages': 'Repair Installed Packages',
        'actions.install': 'Install',
        'actions.installActivate': 'Install + Activate',
        'actions.upgrade': 'Upgrade',
        'actions.upgradeActivate': 'Upgrade + Activate',
        'actions.uninstallSelected': 'Remove',
        'actions.choosePackageDirectory': 'Choose Plugin Directory',
        'actions.addLocalPackage': '+ Add from folder',
        'actions.switchVersion': 'Switch Version',
        'actions.removeVersion': 'Remove Version',
        'package.title': 'Plugins',
        'package.scopeTitle': 'Packages',
        'package.channel.release': 'Release',
        'package.channel.development': 'Development',
        'package.runtimeOptions': 'Runtime options and versions',
        'package.runtimeDetails': 'Runtime details and recovery',
        'package.selectionTitle': 'Select a plugin',
        'package.selectionCopy': 'Select a plugin from the list to see its version and source.',
        'package.details': 'Package details',
        'package.version': 'Version',
        'package.listName': 'Name',
        'package.versionHistory': 'Versions',
        'package.source': 'Source',
        'package.installedVersion': 'Installed version',
        'package.installed': 'Installed',
        'package.updateAvailable': 'Update available',
        'package.localPackage': 'Local package',
        'package.moreOptions': 'More options',
        'package.advancedActions': 'More',
        'package.manageSources': 'Developer tools',
        'package.sourceHelp': 'Add a local folder or registry source. Most users can leave this untouched.',
        'authoring.eyebrow': 'Plugin Authoring',
        'authoring.title': 'Create a Peanut plugin',
        'authoring.copy': 'Generate a Creator 3.8 host extension or a Peanut Core plugin in an empty folder.',
        'authoring.core': 'Peanut Core plugin',
        'authoring.host': 'Creator 3.8 host extension',
        'authoring.pluginId': 'acme.example-plugin',
        'authoring.displayName': 'Display name',
        'authoring.targetDirectory': 'New empty directory',
        'authoring.chooseDirectory': 'Choose Directory',
        'authoring.create': 'Create Plugin',
        'authoring.resultHint': 'Generated file paths will appear here.',
        'package.sourceRegistry': 'Manual And Registry Sources',
        'package.recentSources': 'Recently Used',
        'package.packagePath': 'Package Path',
        'package.pending': 'Choose a plugin to see available actions.',
        'package.noSources': 'No plugins are available yet. Add a source to get started.',
        'package.noRecentSources': 'No recent package sources.',
        'package.searchPlaceholder': 'Search plugins',
        'package.pluginIdPlaceholder': 'plugin id',
        'package.versionPlaceholder': 'version',
        'package.sourcePathPlaceholder': 'source path / registry label',
        'package.packagePathPlaceholder': 'Plugin folder',
        'package.installPathPlaceholder': 'Package directory (contains plugin.manifest.json)',
        'package.filter.all': 'All plugins',
        'package.filter.installed': 'Installed',
        'package.filter.not-installed': 'Not installed',
        'package.filter.upgrade': 'Updates available',
        'package.sort.plugin-id-asc': 'Plugin Id A-Z',
        'package.sort.plugin-id-desc': 'Plugin Id Z-A',
        'package.sort.source-asc': 'Source A-Z',
        'package.sort.recent-first': 'Recent First',
        'package.action.install': 'install',
        'package.action.upgrade': 'upgrade',
        'package.action.uninstall': 'uninstall',
        'package.source.manual': 'Local',
        'package.source.registry': 'Registries',
        'package.summary.install': 'install completed for {pluginId}@{version}.',
        'package.summary.upgrade': 'upgrade completed for {pluginId}@{version}.',
        'package.summary.uninstall': 'uninstall completed for {pluginId}.',
        'package.summary.default': '{action} completed.',
        'package.planSummary': '{action} plan ready for {pluginId}@{version}.',
        'versions.title': 'Installed Versions',
        'versions.empty': 'No installed versions are available for the selected plugin.',
        'versions.active': 'Active version: {version}',
        'versions.builtin': 'Built-in version',
        'versions.requiresInactive': 'Deactivate the plugin before switching versions.',
        'versions.removeActive': 'The active version cannot be removed.',
        'versions.removeConfirm': 'Remove installed plugin version {version}?',
        'error.plugin_package_path_required': 'Choose a plugin package directory before continuing.',
        'error.cocos_dialog_api_unavailable': 'The Creator directory picker is unavailable. Please restart Creator and try again.',
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
        'panel.embedded': 'Embedded Panel',
        'panel.loading': 'Loading plugin panel…',
        'panel.ready': 'Plugin panel is ready.',
        'panel.requiresActive': 'Activate the plugin before opening its panel.',
        'about.eyebrow': 'Peanut Cocos',
        'about.title': 'Cocos Plugin Manager',
        'about.copy': 'The new Cocos plugin system provides a unified foundation for installation, runtime lifecycle, and independent plugin panels.',
        'extensions.title': 'Extension tools',
        'extensions.copy': 'Open an active plugin from the Installed page. This manager does not embed plugin panels or expose execution diagnostics.',
    },
    'zh-CN': {
        'authoring.sourceDirectory': '插件源码目录',
        'package.runtimeSource': '当前工程',
        'package.runtimeVersion': '运行版本',
        'package.loaded': '已加载',
        'package.selectVersion': '切换版本',
        'package.offline': '请在 Creator 中打开此面板，查看当前工程的插件。',
        'package.emptyChannel': '当前渠道暂无插件。',
        'package.noMatches': '没有符合筛选条件的插件。',
        'package.runtimeHeading': '运行控制',

        'locale.label': '语言',
        'locale.en-US': 'English',
        'locale.zh-CN': '简体中文',
        'tab.runtime': '运行时',
        'tab.packages': '包管理',
        'tab.diagnostics': '诊断',
        'tab.installed': '已安装扩展',
        'tab.remote': '插件',
        'tab.authoring': '开发者',
        'tab.extensions': '扩展工具',
        'tab.about': '关于',
        'hero.controlSurface': '内置控制台',
        'hero.title': '插件管理器',
        'hero.subtitle': '运行时状态与热插拔恢复总览。',
        'hero.overview': '概览',
        'hero.waitingBridge': '等待 panel bridge 提供运行时数据。',
        'status.live': '实时',
        'status.preview': '预览',
        'status.liveBridge': '已连接实时宿主桥。',
        'status.previewBridge': '当前使用预览桥。',
        'toast.pending': '正在处理…',
        'summary.runtime': '运行时',
        'summary.runtimeHint': '已注册插件',
        'summary.installed': '已安装',
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
        'detail.descriptionEyebrow': '插件概览',
        'detail.descriptionTitle': '简介',
        'detail.descriptionFallback': '该插件暂未提供功能说明。',
        'mcp.selectCapability': '从左侧选择一项 MCP capability 查看详情。',
        'mcp.pluginExposure': 'AI 权限',
        'mcp.exposure.disabled': '关闭',
        'mcp.exposure.readOnly': '只读',
        'mcp.exposure.all': '全部',
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
        'actions.openPanel': '打开面板',
        'actions.closePanel': '返回管理器',
        'actions.settings': '设置',
        'settings.title': '设置',
        'settings.eyebrow': '插件管理',
        'settings.language': '界面语言',
        'settings.packageFilter': '默认包筛选',
        'settings.packageSort': '默认包排序',
        'settings.restoreDefaults': '恢复默认值',
        'settings.cancel': '取消',
        'settings.save': '保存',
        'actions.createUnavailable': '新建',
        'actions.registerSource': '添加来源',
        'actions.removeSource': '移除来源',
        'actions.plan': '预览变更',
        'actions.pack': '打包当前目录',
        'actions.repairPackages': '修复已安装插件',
        'actions.install': '仅安装',
        'actions.installActivate': '安装并激活',
        'actions.upgrade': '更新',
        'actions.upgradeActivate': '更新并激活',
        'actions.uninstallSelected': '卸载',
        'actions.choosePackageDirectory': '选择文件夹',
        'actions.addLocalPackage': '+ 从文件夹添加',
        'actions.switchVersion': '切换版本',
        'actions.removeVersion': '删除版本',
        'package.title': '插件管理',
        'package.scopeTitle': '包',
        'package.channel.release': '正式版',
        'package.channel.development': '开发版',
        'package.runtimeOptions': '运行选项与版本',
        'package.runtimeDetails': '运行信息与故障恢复',
        'package.selectionTitle': '选择插件',
        'package.selectionCopy': '从列表选择插件，查看它的版本和来源。',
        'package.details': '插件详情',
        'package.version': '版本',
        'package.listName': '名称',
        'package.versionHistory': '版本',
        'package.source': '来源',
        'package.installedVersion': '已安装版本',
        'package.installed': '已安装',
        'package.updateAvailable': '有可用更新',
        'package.localPackage': '本地插件',
        'package.moreOptions': '更多选项',
        'package.advancedActions': '更多',
        'package.manageSources': '开发者工具',
        'package.sourceHelp': '添加本地目录或注册表来源。大多数用户不需要调整这些设置。',
        'authoring.eyebrow': '插件开发',
        'authoring.title': '创建 Peanut 插件',
        'authoring.copy': '在空目录中生成 Creator 3.8 Host 扩展或 Peanut Core 插件模板。',
        'authoring.core': 'Peanut Core 插件',
        'authoring.host': 'Creator 3.8 Host 扩展',
        'authoring.pluginId': 'acme.example-plugin',
        'authoring.displayName': '显示名称',
        'authoring.targetDirectory': '新的空目录',
        'authoring.chooseDirectory': '选择目录',
        'authoring.create': '创建插件',
        'authoring.resultHint': '生成的文件路径会显示在这里。',
        'package.sourceRegistry': '手工与注册表来源',
        'package.recentSources': '最近使用',
        'package.packagePath': '包路径',
        'package.pending': '选择一个插件以查看可用操作。',
        'package.noSources': '还没有可用插件。添加来源后即可开始。',
        'package.noRecentSources': '当前没有最近使用的包来源。',
        'package.searchPlaceholder': '搜索插件',
        'package.pluginIdPlaceholder': '插件 id',
        'package.versionPlaceholder': '版本',
        'package.sourcePathPlaceholder': '来源路径 / 注册表标签',
        'package.packagePathPlaceholder': '插件目录',
        'package.installPathPlaceholder': '目录包路径（含 plugin.manifest.json）',
        'package.filter.all': '全部插件',
        'package.filter.installed': '已安装',
        'package.filter.not-installed': '未安装',
        'package.filter.upgrade': '有可用更新',
        'package.sort.plugin-id-asc': '插件 Id A-Z',
        'package.sort.plugin-id-desc': '插件 Id Z-A',
        'package.sort.source-asc': '来源 A-Z',
        'package.sort.recent-first': '最近优先',
        'package.action.install': '安装',
        'package.action.upgrade': '升级',
        'package.action.uninstall': '卸载',
        'package.source.manual': '本地',
        'package.source.registry': '注册表',
        'package.summary.install': '已完成 {pluginId}@{version} 的安装。',
        'package.summary.upgrade': '已完成 {pluginId}@{version} 的升级。',
        'package.summary.uninstall': '已完成 {pluginId} 的卸载。',
        'package.summary.default': '已完成{action}动作。',
        'package.planSummary': '已生成 {pluginId}@{version} 的{action}计划。',
        'versions.title': '已安装版本',
        'versions.empty': '当前选择的插件没有可管理的已安装版本。',
        'versions.active': '当前活动版本：{version}',
        'versions.builtin': '内置版本',
        'versions.requiresInactive': '请先停用插件，再切换版本。',
        'versions.removeActive': '不能删除当前活动版本。',
        'versions.removeConfirm': '确定删除已安装的插件版本 {version} 吗？',
        'error.plugin_package_path_required': '请先选择插件包目录，再继续操作。',
        'error.cocos_dialog_api_unavailable': 'Creator 目录选择窗口不可用，请重启 Creator 后重试。',
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
        'panel.embedded': '内嵌面板',
        'panel.loading': '正在加载插件面板…',
        'panel.ready': '插件面板已就绪。',
        'panel.requiresActive': '请先激活插件，再打开面板。',
        'about.eyebrow': 'Peanut Cocos',
        'about.title': 'Cocos 插件管理器',
        'about.copy': '全新的 Cocos 插件系统为插件安装、运行生命周期和独立插件面板提供统一基础能力。',
        'extensions.title': '扩展工具',
        'extensions.copy': '请在“已安装扩展”中选择并打开已激活的插件。此管理器不再内嵌插件面板，也不展示执行诊断。',
    },
};

const PANEL_STATE_LABELS = {
    'en-US': {
        none: 'none',
        active: 'active',
        inactive: 'inactive',
        disposed: 'disposed',
        failed: 'failed',
        discovered: 'discovered',
        validated: 'validated',
        staged: 'staged',
        loaded: 'loaded',
        registered: 'registered',
        succeeded: 'succeeded',
        cancelled: 'cancelled',
        planning: 'planning',
        pending_commit: 'pending commit',
        committing: 'active commit',
        critical: 'critical',
        high: 'high',
        normal: 'normal',
        low: 'low',
        all: 'all',
        install: 'install',
        upgrade: 'upgrade',
        uninstall: 'uninstall',
        activate: 'activate',
        deactivate: 'deactivate',
        register: 'register',
        dispose: 'dispose',
        activation_prepare: 'activation_prepare',
        cleanup: 'cleanup',
        cleanup_retry: 'cleanup_retry',
        planned: 'planned',
        completed: 'completed',
        skipped: 'skipped',
        builtin: 'builtin',
        trusted: 'trusted',
        partner: 'partner',
        community: 'community',
        manual: 'manual',
        registry: 'registry',
        local: 'local',
    },
    'zh-CN': {
        none: '无',
        active: '运行中',
        inactive: '未激活',
        disposed: '已释放',
        failed: '失败',
        discovered: '已发现',
        validated: '已校验',
        staged: '已暂存',
        loaded: '已加载',
        registered: '已注册',
        succeeded: '成功',
        cancelled: '已取消',
        planning: '规划中',
        pending_commit: '等待提交',
        committing: '提交中',
        critical: '关键',
        high: '高',
        normal: '普通',
        low: '低',
        all: '全部',
        install: '安装',
        upgrade: '升级',
        uninstall: '卸载',
        activate: '激活',
        deactivate: '停用',
        register: '注册',
        dispose: '释放',
        activation_prepare: '激活准备',
        cleanup: '清理',
        cleanup_retry: '清理重试',
        planned: '已规划',
        completed: '已完成',
        skipped: '已跳过',
        builtin: '内置',
        trusted: '受信任',
        partner: '合作方',
        community: '社区',
        manual: '手工',
        registry: '注册表',
        local: '本地',
    },
};

function normalizeLocale(locale) {
    return locale === 'en-US' || locale === 'zh-CN' ? locale : 'zh-CN';
}

function getLocale(state = latestRenderedState ?? window.pluginManagerPanelUiState) {
    return normalizeLocale(state?.preferences?.locale);
}

function t(state, key, params) {
    const locale = getLocale(state);
    const text = PANEL_TRANSLATIONS[locale][key] ?? key;
    if (params == null) {
        return text;
    }
    return Object.entries(params).reduce((renderedText, [paramKey, paramValue]) => {
        return renderedText.replaceAll(`{${paramKey}}`, String(paramValue));
    }, text);
}

function translateValue(state, value) {
    const locale = getLocale(state);
    return PANEL_STATE_LABELS[locale][value] ?? value;
}

function localizeDescription(state, value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value != null && typeof value === 'object') {
        const locale = getLocale(state);
        return value[locale] ?? value['en-US'] ?? value['zh-CN'] ?? '';
    }
    return '';
}

function getPanelDomRoot() {
    return window.__PEANUT_PLUGIN_MANAGER_PANEL_ROOT__ ?? document;
}

function getPanelElementById(elementId) {
    return getPanelDomRoot().querySelector(`#${elementId}`);
}

function applyStaticTranslations(state) {
    const locale = getLocale(state);
    const panelDomRoot = getPanelDomRoot();
    (panelDomRoot.documentElement ?? panelDomRoot).lang = locale;
    panelDomRoot.querySelectorAll('[data-i18n]').forEach((element) => {
        const key = element.getAttribute('data-i18n');
        if (key != null) {
            element.textContent = PANEL_TRANSLATIONS[locale][key] ?? key;
        }
    });
    panelDomRoot.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        const key = element.getAttribute('data-i18n-placeholder');
        if (key != null) {
            element.setAttribute('placeholder', PANEL_TRANSLATIONS[locale][key] ?? key);
        }
    });
}

const elements = {
    packageAuthoringPathInput: getPanelElementById('packageAuthoringPathInput'),
    packageAuthoringStatus: getPanelElementById('packageAuthoringStatus'),
    packagesTabButton: getPanelElementById('packagesTabButton'),
    authoringTabButton: getPanelElementById('authoringTabButton'),
    authoringKindSelect: getPanelElementById('authoringKindSelect'),
    authoringPluginIdInput: getPanelElementById('authoringPluginIdInput'),
    authoringDisplayNameInput: getPanelElementById('authoringDisplayNameInput'),
    authoringTargetDirectoryInput: getPanelElementById('authoringTargetDirectoryInput'),
    chooseAuthoringDirectoryButton: getPanelElementById('chooseAuthoringDirectoryButton'),
    createPluginButton: getPanelElementById('createPluginButton'),
    authoringResult: getPanelElementById('authoringResult'),
    mcpTabButton: getPanelElementById('mcpTabButton'),
    aboutTabButton: getPanelElementById('aboutTabButton'),
    mcpStatusMessage: getPanelElementById('mcpStatusMessage'),
    mcpSummary: getPanelElementById('mcpSummary'),
    mcpSearchInput: getPanelElementById('mcpSearchInput'),
    mcpCategoryFilters: getPanelElementById('mcpCategoryFilters'),
    mcpCapabilityList: getPanelElementById('mcpCapabilityList'),
    mcpDetailTitle: getPanelElementById('mcpDetailTitle'),
    mcpDetailDescription: getPanelElementById('mcpDetailDescription'),
    mcpSchemaFields: getPanelElementById('mcpSchemaFields'),
    mcpSchemaJson: getPanelElementById('mcpSchemaJson'),
    mcpPlanList: getPanelElementById('mcpPlanList'),
    mcpRecentCallList: getPanelElementById('mcpRecentCallList'),
    refreshButton: getPanelElementById('refreshButton'),
    settingsButton: getPanelElementById('settingsButton'),
    settingsForm: getPanelElementById('settingsForm'),
    settingsCancelButton: getPanelElementById('settingsCancelButton'),
    settingsResetButton: getPanelElementById('settingsResetButton'),
    settingsLocaleSelect: getPanelElementById('settingsLocaleSelect'),
    settingsPackageFilterSelect: getPanelElementById('settingsPackageFilterSelect'),
    settingsPackageSortSelect: getPanelElementById('settingsPackageSortSelect'),
    settingsError: getPanelElementById('settingsError'),
    reloadKernelButton: getPanelElementById('reloadKernelButton'),
    exportButton: getPanelElementById('exportButton'),
    retryButton: getPanelElementById('retryButton'),
    activateButton: getPanelElementById('activateButton'),
    deactivateButton: getPanelElementById('deactivateButton'),
    disposeButton: getPanelElementById('disposeButton'),
    openPanelButton: getPanelElementById('openPanelButton'),
    pluginMcpExposureControl: getPanelElementById('pluginMcpExposureControl'),
    pluginMcpExposureSelect: getPanelElementById('pluginMcpExposureSelect'),
    packageCatalog: getPanelElementById('packageCatalog'),
    packageSelectionPanel: getPanelElementById('packageSelectionPanel'),
    packageDetailTabs: getPanelElementById('packageDetailTabs'),
    packageRuntimeTab: getPanelElementById('packageRuntimeTab'),
    packageDescriptionUnavailable: getPanelElementById('packageDescriptionUnavailable'),
    packageVersionsUnavailable: getPanelElementById('packageVersionsUnavailable'),
    packageSelectionIcon: getPanelElementById('packageSelectionIcon'),
    packageSelectionTitle: getPanelElementById('packageSelectionTitle'),
    packageSelectionId: getPanelElementById('packageSelectionId'),
    packageSelectionStatus: getPanelElementById('packageSelectionStatus'),
    packageSelectionDescriptionSection: getPanelElementById('packageSelectionDescriptionSection'),
    packageSelectionDescription: getPanelElementById('packageSelectionDescription'),
    packageRuntimeControls: getPanelElementById('packageRuntimeControls'),
    packageSelectionEmpty: getPanelElementById('packageSelectionEmpty'),
    packageSelectionMeta: getPanelElementById('packageSelectionMeta'),
    packageCatalogVersionSelect: getPanelElementById('packageCatalogVersionSelect'),
    packagePathInput: getPanelElementById('packagePathInput'),
    packPackageButton: getPanelElementById('packPackageButton'),
    repairPackagesButton: getPanelElementById('repairPackagesButton'),
    choosePackageDirectoryButton: getPanelElementById('choosePackageDirectoryButton'),
    packageSourceKindSelect: getPanelElementById('packageSourceKindSelect'),
    packageSourcePluginIdInput: getPanelElementById('packageSourcePluginIdInput'),
    packageSourceVersionInput: getPanelElementById('packageSourceVersionInput'),
    packageSourcePathInput: getPanelElementById('packageSourcePathInput'),
    packageSourcePackagePathInput: getPanelElementById('packageSourcePackagePathInput'),
    packageSearchInput: getPanelElementById('packageSearchInput'),
    packageFilterSelect: getPanelElementById('packageFilterSelect'),
    packageSortSelect: getPanelElementById('packageSortSelect'),
    planPackageButton: getPanelElementById('planPackageButton'),
    installPackageButton: getPanelElementById('installPackageButton'),
    installAndActivatePackageButton: getPanelElementById('installAndActivatePackageButton'),
    upgradeAndActivatePackageButton: getPanelElementById('upgradeAndActivatePackageButton'),
    uninstallPackageButton: getPanelElementById('uninstallPackageButton'),
    registerPackageSourceButton: getPanelElementById('registerPackageSourceButton'),
    removePackageSourceButton: getPanelElementById('removePackageSourceButton'),
    packageActionSummary: getPanelElementById('packageActionSummary'),
    packageScopeAllCount: getPanelElementById('packageScopeAllCount'),
    packageScopeInstalledCount: getPanelElementById('packageScopeInstalledCount'),
    packageScopeUpgradeCount: getPanelElementById('packageScopeUpgradeCount'),
    detailGrid: getPanelElementById('detailGrid'),
    detailIncidentMessage: getPanelElementById('detailIncidentMessage'),
    packageVersionCard: getPanelElementById('packageVersionCard'),
    packageVersionHint: getPanelElementById('packageVersionHint'),
    packageVersionSelect: getPanelElementById('packageVersionSelect'),
    switchPackageVersionButton: getPanelElementById('switchPackageVersionButton'),
    removePackageVersionButton: getPanelElementById('removePackageVersionButton'),
    cleanupBadge: getPanelElementById('cleanupBadge'),
    cleanupTimeline: getPanelElementById('cleanupTimeline'),
};

let activePanelDriver = null;
let latestRenderedState = null;
let lastToastFeedbackMessage = null;
const visibleToastKeys = new Set();
const uiState = {
    activeWorkbenchTab: 'packages',
    authoringResult: null,
    packageSearch: '',
    packageFilter: 'all',
    packageChannel: 'release',
    packageDetailTab: 'description',
    runtimeSelectionId: null,
    localPackagePath: '',
    packageCatalogSort: 'plugin-id-asc',
    executionPriorityFilter: 'all',
    showOnlyExceptionalExecutionGroups: false,
    mcpSearch: '',
    mcpCategory: 'all',
    selectedMcpCapabilityName: null,
    settingsReturnTab: 'packages',
};

/**
 * @description 切换 Cocos 原生工作台的可见分区，同时保持所有数据面板实例存活。
 * @param {string} tabId 目标工作台分区标识
 * @returns {void}
 */
function setActiveWorkbenchTab(tabId) {
    const supportedTabIds = ['packages', 'authoring', 'mcp', 'settings', 'about'];
    if (!supportedTabIds.includes(tabId)) {
        return;
    }

    uiState.activeWorkbenchTab = tabId;
    const panelDomRoot = getPanelDomRoot();
    panelDomRoot.querySelectorAll('[data-workbench-tab]').forEach((tabButton) => {
        const isActive = tabButton.getAttribute('data-workbench-tab') === tabId;
        tabButton.classList.toggle('is-active', isActive);
        tabButton.setAttribute('aria-selected', String(isActive));
    });
    panelDomRoot.querySelectorAll('[data-workbench-view]').forEach((tabView) => {
        const isActive = tabView.getAttribute('data-workbench-view') === tabId;
        tabView.classList.toggle('is-active', isActive);
        tabView.hidden = !isActive;
    });
}

/**
 * @description 同步详情标签、面板可见性和键盘焦点；运行页只对当前选中插件开放。
 * @param {string} tabId 请求选择的详情标签
 * @param {boolean} focus 是否将键盘焦点移动到选中标签
 * @returns {void}
 */
function setActivePackageDetailTab(tabId, focus = false) {
    const root = getPanelDomRoot();
    const tabs = [...root.querySelectorAll('[data-package-detail-tab]')].filter((tab) => !tab.hidden);
    const target = tabs.find((tab) => tab.getAttribute('data-package-detail-tab') === tabId) ?? tabs[0];
    const activeId = target?.getAttribute('data-package-detail-tab') ?? 'description';
    uiState.packageDetailTab = activeId;
    root.querySelectorAll('[data-package-detail-tab]').forEach((tab) => {
        const active = tab === target && !elements.packageDetailTabs.hidden;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    root.querySelectorAll('[data-package-detail-view]').forEach((view) => {
        view.hidden = elements.packageDetailTabs.hidden || view.getAttribute('data-package-detail-view') !== activeId;
    });
    if (focus) target?.focus();
}

/**
 * @description 绑定详情页标签的点击和左右方向键、Home、End 键导航。
 * @returns {void}
 */
function bindPackageDetailTabs() {
    const tabs = [...getPanelDomRoot().querySelectorAll('[data-package-detail-tab]')];
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => setActivePackageDetailTab(tab.getAttribute('data-package-detail-tab')));
        tab.addEventListener('keydown', (event) => {
            const visibleTabs = tabs.filter((candidate) => !candidate.hidden);
            const index = visibleTabs.indexOf(tab);
            let nextIndex;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % visibleTabs.length;
            else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = visibleTabs.length - 1;
            else return;
            event.preventDefault();
            setActivePackageDetailTab(visibleTabs[nextIndex].getAttribute('data-package-detail-tab'), true);
        });
    });
}

bootstrap().catch((error) => {
    applyError(error);
});

async function bootstrap() {
    activePanelDriver = await resolvePanelDriver();
    bindActions(activePanelDriver);
    bindCocosKernelReloadRefresh(activePanelDriver);
    activePanelDriver.subscribe((state) => {
        render(state);
    });
    const initialState = await activePanelDriver.initialize();
    render(initialState);
}

/**
 * @description 订阅 Cocos 主进程的内核重载广播，使菜单操作也能刷新已打开的面板。
 * @param {ReturnType<typeof createBridgeBackedDriver>} panelDriver 当前面板数据驱动器
 * @returns {void}
 */
function bindCocosKernelReloadRefresh(panelDriver) {
    const editorApi = window.Editor ?? window.top?.Editor ?? globalThis.Editor;
    if (typeof editorApi?.Message?.addBroadcastListener !== 'function') {
        return;
    }

    const extensionName = window.__PEANUT_COCOS_EXTENSION_NAME__ ?? 'peanut-pod';
    editorApi.Message.addBroadcastListener(`${extensionName}:kernel-reloaded`, () => {
        void panelDriver.refresh();
    });
    editorApi.Message.addBroadcastListener(`${extensionName}:settings-updated`, () => {
        void panelDriver.refresh();
    });
}

function openSettingsPage(state) {
    if (elements.settingsForm == null) {
        return;
    }
    uiState.settingsReturnTab = uiState.activeWorkbenchTab;
    const preferences = state?.preferences ?? {};
    elements.settingsLocaleSelect.value = normalizeLocale(preferences.locale);
    elements.settingsPackageFilterSelect.value = preferences.packageFilter ?? 'all';
    elements.settingsPackageSortSelect.value = preferences.packageCatalogSort ?? 'plugin-id-asc';
    elements.settingsError.hidden = true;
    elements.settingsError.textContent = '';
    setActiveWorkbenchTab('settings');
}

function closeSettingsPage() {
    setActiveWorkbenchTab(uiState.settingsReturnTab);
}

function resetSettingsPage() {
    elements.settingsLocaleSelect.value = 'zh-CN';
    elements.settingsPackageFilterSelect.value = 'all';
    elements.settingsPackageSortSelect.value = 'plugin-id-asc';
    elements.settingsError.hidden = true;
    elements.settingsError.textContent = '';
}

async function saveSettingsPage(panelDriver) {
    const state = await panelDriver.updatePreferences({
        locale: elements.settingsLocaleSelect.value,
        packageFilter: elements.settingsPackageFilterSelect.value,
        packageCatalogSort: elements.settingsPackageSortSelect.value,
    });
    if (state.lastError != null) {
        elements.settingsError.hidden = false;
        elements.settingsError.textContent = state.lastError;
        return;
    }
}

function resolveCocosEditorApi() {
    return window.Editor ?? window.parent?.Editor ?? window.top?.Editor ?? globalThis.Editor;
}

async function openSelectedPluginInIndependentPanel(panelDriver) {
    const state = latestRenderedState ?? window.pluginManagerPanelUiState;
    const pluginId = state?.selectedPluginId;
    const editorApi = resolveCocosEditorApi();
    if (typeof pluginId !== 'string' || pluginId.length === 0) {
        throw new Error('plugin_panel_selection_missing');
    }
    if (typeof editorApi?.Message?.request !== 'function') {
        throw new Error('cocos_editor_message_api_unavailable');
    }

    const extensionName = window.__PEANUT_COCOS_EXTENSION_NAME__ ?? 'peanut-pod';
    await editorApi.Message.request(extensionName, 'open-generated-plugin-panel', pluginId);
    showPanelToast(t(state, 'panel.ready'), 'success');
}

function bindActions(panelDriver) {
    bindPackageDetailTabs();
    const panelDomRoot = getPanelDomRoot();
    panelDomRoot.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const actionButton = event.target.closest('button.button');
        if (actionButton == null || actionButton.disabled) {
            return;
        }
        if (actionButton.id === 'settingsButton') {
            return;
        }
        showPanelToast(t(latestRenderedState, 'toast.pending'), 'pending');
    });
    elements.packagesTabButton?.addEventListener('click', () => {
        setActiveWorkbenchTab('packages');
    });
    elements.authoringTabButton?.addEventListener('click', () => {
        setActiveWorkbenchTab('authoring');
    });
    elements.createPluginButton?.addEventListener('click', async () => {
        elements.createPluginButton.disabled = true;
        try {
            const result = await panelDriver.createPluginTemplate({
                kind: elements.authoringKindSelect.value,
                pluginId: elements.authoringPluginIdInput.value,
                displayName: elements.authoringDisplayNameInput.value,
                targetDirectory: elements.authoringTargetDirectoryInput.value,
            });
            uiState.authoringResult = `${result.targetDirectory}\n${result.files.join('\n')}`;
            elements.authoringResult.textContent = uiState.authoringResult;
            elements.packageAuthoringPathInput.value = result.targetDirectory;
        } catch (error) {
            uiState.authoringResult = normalizeErrorMessage(error);
            elements.authoringResult.textContent = uiState.authoringResult;
        } finally {
            elements.createPluginButton.disabled = false;
        }
    });
    elements.chooseAuthoringDirectoryButton?.addEventListener('click', async () => {
        try {
            const result = await panelDriver.pickAuthoringDirectory();
            if (typeof result?.targetDirectory === 'string') elements.authoringTargetDirectoryInput.value = result.targetDirectory;
        } catch (error) {
            uiState.authoringResult = normalizeErrorMessage(error);
            elements.authoringResult.textContent = uiState.authoringResult;
        }
    });
    elements.mcpTabButton?.addEventListener('click', () => {
        setActiveWorkbenchTab('mcp');
    });
    elements.aboutTabButton?.addEventListener('click', () => {
        setActiveWorkbenchTab('about');
    });
    elements.settingsButton?.addEventListener('click', () => {
        openSettingsPage(latestRenderedState);
    });
    setActiveWorkbenchTab(uiState.activeWorkbenchTab);
    elements.refreshButton?.addEventListener('click', () => {
        void panelDriver.refresh();
    });
    elements.mcpSearchInput?.addEventListener('input', () => {
        uiState.mcpSearch = elements.mcpSearchInput.value.trim().toLowerCase();
        renderMcpHub(latestRenderedState);
    });
    elements.mcpCategoryFilters?.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const categoryButton = event.target.closest('[data-mcp-category]');
        const category = categoryButton?.getAttribute('data-mcp-category');
        if (category == null) {
            return;
        }
        uiState.mcpCategory = category;
        renderMcpHub(latestRenderedState);
    });
    elements.mcpCapabilityList?.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const capabilityCard = event.target.closest('[data-mcp-capability-name]');
        const capabilityName = capabilityCard?.getAttribute('data-mcp-capability-name');
        if (capabilityName == null) {
            return;
        }
        uiState.selectedMcpCapabilityName = capabilityName;
        renderMcpHub(latestRenderedState);
    });
    elements.mcpPlanList?.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }
        const button = event.target.closest('[data-mcp-plan-action]');
        const planId = button?.getAttribute('data-mcp-plan-id');
        if (planId == null) {
            return;
        }
        void (button.getAttribute('data-mcp-plan-action') === 'approve'
            ? panelDriver.approveMcpPlan(planId)
            : panelDriver.rejectMcpPlan(planId));
    });
    elements.settingsCancelButton?.addEventListener('click', () => {
        closeSettingsPage();
    });
    elements.settingsResetButton?.addEventListener('click', () => {
        resetSettingsPage();
    });
    elements.settingsForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void saveSettingsPage(panelDriver);
    });
    elements.reloadKernelButton?.addEventListener('click', () => {
        void panelDriver.reloadKernel();
    });
    elements.exportButton?.addEventListener('click', () => {
        void panelDriver.exportSelectedFailure();
    });
    elements.retryButton?.addEventListener('click', () => {
        void panelDriver.retrySelectedCleanup();
    });
    elements.activateButton?.addEventListener('click', () => {
        void panelDriver.activateSelectedPlugin();
    });
    elements.deactivateButton?.addEventListener('click', () => {
        void panelDriver.deactivateSelectedPlugin();
    });
    elements.disposeButton?.addEventListener('click', () => {
        void panelDriver.disposeSelectedPlugin();
    });
    elements.openPanelButton?.addEventListener('click', () => {
        void openSelectedPluginInIndependentPanel(panelDriver).catch((error) => {
            showPanelToast(normalizeErrorMessage(error), 'error');
        });
    });
    elements.pluginMcpExposureSelect?.addEventListener('change', () => {
        void panelDriver.setPluginMcpExposure(elements.pluginMcpExposureSelect.value);
    });
    elements.planPackageButton?.addEventListener('click', () => {
        void panelDriver.planPackage(elements.packageSourcePackagePathInput.value.trim() || elements.packagePathInput.value);
    });
    elements.choosePackageDirectoryButton?.addEventListener('click', () => {
        void choosePackageDirectory(panelDriver);
    });
    elements.packPackageButton?.addEventListener('click', async () => {
        elements.packPackageButton.disabled = true;
        try {
            const packed = await panelDriver.packPackage(elements.packageAuthoringPathInput.value.trim());
            elements.packageSourcePackagePathInput.value = packed.packagePath;
            elements.packageSourcePluginIdInput.value = packed.pluginId;
            elements.packageSourceVersionInput.value = packed.version;
            elements.packageAuthoringStatus.textContent = `${packed.pluginId}@${packed.version} · ${packed.packagePath}`;
        } catch (error) {
            elements.packageAuthoringStatus.textContent = normalizeErrorMessage(error);
        } finally {
            elements.packPackageButton.disabled = false;
        }
    });
    elements.repairPackagesButton?.addEventListener('click', async () => {
        elements.repairPackagesButton.disabled = true;
        try {
            const result = await panelDriver.repairPackages();
            elements.packageActionSummary.textContent = result.actions?.join('\n') || t(latestRenderedState, 'actions.repairPackages');
        } catch (error) {
            elements.packageActionSummary.textContent = normalizeErrorMessage(error);
        } finally {
            elements.repairPackagesButton.disabled = false;
        }
    });
    elements.installPackageButton?.addEventListener('click', () => {
        const selected = getSelectedPackageEntry(latestRenderedState);
        const packagePath = selected?.runtimeOnly ? '' : selected?.packagePath ?? uiState.localPackagePath;
        if (!packagePath || latestRenderedState?.status === 'loading') return;
        if (selected?.installedActiveVersion != null) {
            void panelDriver.upgradePackage(packagePath);
            return;
        }
        void panelDriver.installPackage(packagePath);
    });
    elements.installAndActivatePackageButton?.addEventListener('click', () => {
        void panelDriver.installAndActivatePackage(elements.packageSourcePackagePathInput.value.trim() || elements.packagePathInput.value);
    });
    elements.upgradeAndActivatePackageButton?.addEventListener('click', () => {
        void panelDriver.upgradeAndActivatePackage(elements.packageSourcePackagePathInput.value.trim() || elements.packagePathInput.value);
    });
    elements.uninstallPackageButton?.addEventListener('click', () => {
        void panelDriver.uninstallSelectedPackage();
    });
    elements.packageVersionSelect?.addEventListener('change', () => {
        if (latestRenderedState != null) {
            renderPackageVersions(latestRenderedState);
        }
    });
    elements.packageCatalogVersionSelect?.addEventListener('change', () => {
        uiState.runtimeSelectionId = null;
        uiState.localPackagePath = '';
        void panelDriver.selectPackageCatalogItem(elements.packageCatalogVersionSelect.value);
    });
    elements.switchPackageVersionButton?.addEventListener('click', () => {
        void panelDriver.switchSelectedPackageVersion(elements.packageVersionSelect?.value ?? '');
    });
    elements.removePackageVersionButton?.addEventListener('click', () => {
        const version = elements.packageVersionSelect?.value ?? '';
        if (version.length === 0 || !window.confirm(t(latestRenderedState, 'versions.removeConfirm', { version }))) {
            return;
        }
        void panelDriver.removeSelectedPackageVersion(version);
    });
    elements.registerPackageSourceButton?.addEventListener('click', () => {
        void panelDriver.registerPackageSource({
            sourceKind: elements.packageSourceKindSelect?.value ?? 'manual',
            pluginId: elements.packageSourcePluginIdInput?.value ?? '',
            version: elements.packageSourceVersionInput?.value ?? '',
            sourcePath: elements.packageSourcePathInput?.value ?? '',
            packagePath: elements.packageSourcePackagePathInput?.value ?? '',
        });
    });
    elements.removePackageSourceButton?.addEventListener('click', () => {
        void panelDriver.removePackageSource(elements.packageSourcePackagePathInput?.value ?? elements.packagePathInput?.value ?? '');
    });
    elements.packageSearchInput?.addEventListener('input', () => {
        uiState.packageSearch = elements.packageSearchInput.value.trim().toLowerCase();
        if (latestRenderedState != null) {
            render(latestRenderedState);
        }
    });
    getPanelDomRoot().querySelectorAll('[data-package-channel]').forEach((channelButton) => {
        channelButton.addEventListener('click', () => {
            const channel = channelButton.getAttribute('data-package-channel');
            if (channel !== 'release' && channel !== 'development') return;
            uiState.packageChannel = channel;
            uiState.runtimeSelectionId = null;
            uiState.localPackagePath = '';
            elements.packagePathInput.value = '';
            void activePanelDriver?.selectPackageCatalogItem(null);
            if (latestRenderedState != null) render(latestRenderedState);
        });
    });
    getPanelDomRoot().querySelectorAll('[data-package-scope]').forEach((scopeButton) => {
        scopeButton.addEventListener('click', () => {
            const scope = scopeButton.getAttribute('data-package-scope') ?? 'all';
            if (['all', 'installed', 'upgrade'].includes(scope)) {
                uiState.packageFilter = scope;
                elements.packageFilterSelect.value = scope;
                void panelDriver.updatePreferences({ packageFilter: scope });
            }
            if (latestRenderedState != null) {
                const currentState = latestRenderedState;
                render({ ...currentState, preferences: { ...currentState.preferences, packageFilter: uiState.packageFilter } });
            }
        });
    });
    elements.packageFilterSelect?.addEventListener('change', () => {
        uiState.packageFilter = elements.packageFilterSelect.value;
        void panelDriver.updatePreferences({
            packageFilter: uiState.packageFilter,
        });
        if (latestRenderedState != null) {
            const currentState = latestRenderedState;
            render({ ...currentState, preferences: { ...currentState.preferences, packageFilter: uiState.packageFilter } });
        }
    });
    elements.packageSortSelect?.addEventListener('change', () => {
        uiState.packageCatalogSort = elements.packageSortSelect.value;
        void panelDriver.updatePreferences({
            packageCatalogSort: uiState.packageCatalogSort,
        });
        if (latestRenderedState != null) {
            render(latestRenderedState);
        }
    });
}

async function choosePackageDirectory(panelDriver) {
    try {
        const packagePath = await panelDriver.pickPackageDirectory();
        if (typeof packagePath === 'string' && packagePath.length > 0 && elements.packagePathInput != null) {
            await panelDriver.selectPackageCatalogItem(null);
            uiState.packageChannel = 'development';
            uiState.runtimeSelectionId = null;
            uiState.localPackagePath = packagePath;
            elements.packagePathInput.value = packagePath;
            if (latestRenderedState != null) {
                render(latestRenderedState);
            }
        }
    } catch (error) {
        applyError(error);
    }
}

async function resolvePanelDriver() {
    if (window.pluginManagerPanelUiActions != null) {
        return createWindowBackedDriver();
    }

    const panelBridge = await resolvePanelBridge();
    return createBridgeBackedDriver(panelBridge);
}

function createWindowBackedDriver() {
    const listeners = window.__PEANUT_PLUGIN_MANAGER_PANEL_STATE_LISTENERS__ ?? [];
    window.__PEANUT_PLUGIN_MANAGER_PANEL_STATE_LISTENERS__ = listeners;

    return {
        async initialize() {
            if (window.pluginManagerPanelUiState == null) {
                await window.pluginManagerPanelUiActions.refresh();
            }
            return window.pluginManagerPanelUiState;
        },
        subscribe(listener) {
            listeners.push(listener);
        },
        async refresh() {
            return window.pluginManagerPanelUiActions.refresh();
        },
        async reloadKernel() {
            return window.pluginManagerPanelUiActions.reloadKernel();
        },
        async refreshExecutionDiagnostics() {
            return window.pluginManagerPanelUiActions.refreshExecutionDiagnostics();
        },
        async setMcpHubEnabled(isEnabled) {
            return window.pluginManagerPanelUiActions.setMcpHubEnabled(isEnabled);
        },
        async approveMcpPlan(planId) {
            return window.pluginManagerPanelUiActions.approveMcpPlan(planId);
        },
        async rejectMcpPlan(planId) {
            return window.pluginManagerPanelUiActions.rejectMcpPlan(planId);
        },
        async exportSelectedFailure() {
            await window.pluginManagerPanelUiActions.exportSelectedFailure();
            return window.pluginManagerPanelUiState;
        },
        async retrySelectedCleanup() {
            await window.pluginManagerPanelUiActions.retrySelectedCleanup();
            return window.pluginManagerPanelUiState;
        },
        async activateSelectedPlugin() {
            return window.pluginManagerPanelUiActions.activateSelectedPlugin();
        },
        async deactivateSelectedPlugin() {
            return window.pluginManagerPanelUiActions.deactivateSelectedPlugin();
        },
        async disposeSelectedPlugin() {
            return window.pluginManagerPanelUiActions.disposeSelectedPlugin();
        },
        async openSelectedPluginPanel() {
            return window.pluginManagerPanelUiActions.openSelectedPluginPanel();
        },
        async closeEmbeddedPluginPanel() {
            return window.pluginManagerPanelUiActions.closeEmbeddedPluginPanel();
        },
        async planPackage(packagePath) {
            return window.pluginManagerPanelUiActions.planPackage(packagePath);
        },
        async pickPackageDirectory() {
            return null;
        },
        async installPackage(packagePath) {
            return window.pluginManagerPanelUiActions.installPackage(packagePath);
        },
        async upgradePackage(packagePath) {
            return window.pluginManagerPanelUiActions.upgradePackage(packagePath);
        },
        async installAndActivatePackage(packagePath) {
            return window.pluginManagerPanelUiActions.installAndActivatePackage(packagePath);
        },
        async upgradeAndActivatePackage(packagePath) {
            return window.pluginManagerPanelUiActions.upgradeAndActivatePackage(packagePath);
        },
        async uninstallSelectedPackage() {
            return window.pluginManagerPanelUiActions.uninstallSelectedPackage();
        },
        async selectPackageCatalogItem(packagePath) {
            return window.pluginManagerPanelUiActions.selectPackageCatalogItem(packagePath);
        },
        async selectPlugin(pluginId) {
            return window.pluginManagerPanelUiActions.selectPlugin(pluginId);
        },
        async selectExecutionGroup(groupId) {
            return window.pluginManagerPanelUiActions.selectExecutionGroup(groupId);
        },
        async setExecutionPriorityFilter(priority) {
            return window.pluginManagerPanelUiActions.setExecutionPriorityFilter(priority);
        },
        async toggleExceptionalExecutionGroups() {
            return window.pluginManagerPanelUiActions.toggleExceptionalExecutionGroups();
        },
        async updatePreferences(preferences) {
            return window.pluginManagerPanelUiActions.updatePreferences(preferences);
        },
        async registerPackageSource(source) {
            return window.pluginManagerPanelUiActions.registerPackageSource(source);
        },
        async removePackageSource(packagePath) {
            return window.pluginManagerPanelUiActions.removePackageSource(packagePath);
        },
    };
}

function createBridgeBackedDriver(panelBridge) {
    const state = {
        bridgeMode: panelBridge.__bridgeMode === 'host' ? 'host' : 'preview',
        runtimeRecords: [],
        failureItems: [],
        packageCatalog: [],
        recentPackagePaths: [],
        kernelReloadSupported: false,
        preferences: {
            locale: 'zh-CN',
            packageFilter: 'all',
            packageCatalogSort: 'plugin-id-asc',
            selectedPluginId: null,
            selectedPackagePath: null,
        },
        selectedPluginId: null,
        selectedPackagePath: null,
        selectedRuntimeRecord: null,
        embeddedPanel: null,
        selectedInstalledPackageSnapshot: null,
        selectedIncident: null,
        selectedFailureExport: null,
        lastCleanupSteps: [],
        lastPackageActionSummary: null,
        lastActionSummary: null,
        lastError: null,
        status: 'idle',
        executionDiagnosticsSnapshot: null,
        selectedExecutionGroupId: null,
        executionPriorityFilter: 'all',
        showOnlyExceptionalExecutionGroups: false,
        mcpHub: { isAvailable: false, isEnabled: false, port: null, catalogRevision: 0, capabilities: [], disabledPluginIds: [], writeEnabledPluginIds: [], pendingPlans: [] },
    };
    const listeners = [];

    const notify = () => {
        for (const listener of listeners) {
            listener({ ...state });
        }
    };

    const requestBridge = async (event, payload) => {
        const response = await panelBridge.request({
            id: buildRequestId(event),
            event,
            expectsResponse: true,
            payload,
        });
        if (!response.ok || response.payload == null) {
            throw new Error(response.error ?? `plugin_manager_panel_request_failed:${event}`);
        }
        return response.payload;
    };

    const refreshSelectedDetail = async () => {
        if (state.selectedPluginId == null) {
            state.selectedRuntimeRecord = null;
            state.selectedInstalledPackageSnapshot = null;
            state.selectedIncident = null;
            state.selectedFailureExport = null;
            state.lastCleanupSteps = [];
            return;
        }

        state.selectedRuntimeRecord = state.runtimeRecords.find((runtimeRecord) => {
            return runtimeRecord.pluginId === state.selectedPluginId;
        }) ?? null;

        try {
            const detail = await requestBridge(DETAIL_EVENT, {
                pluginId: state.selectedPluginId,
            });
            state.selectedInstalledPackageSnapshot = detail.installedPackageSnapshot ?? null;
            state.selectedIncident = detail.incident ?? null;
            state.lastCleanupSteps = detail.incident?.cleanupSteps ?? [];
        } catch (error) {
            state.selectedInstalledPackageSnapshot = null;
            state.selectedIncident = null;
            state.lastCleanupSteps = [];
            state.lastError = normalizeErrorMessage(error);
        }
    };

    if (typeof panelBridge.subscribe === 'function') {
        panelBridge.subscribe('pluginManager.failure.updated', async (envelope) => {
            if (envelope?.payload?.incident?.pluginId === state.selectedPluginId) {
                state.selectedIncident = envelope.payload.incident;
                state.lastCleanupSteps = envelope.payload.cleanupSteps ?? [];
            }
            await driver.refresh();
        });
    }

    const driver = {
        async createPluginTemplate(payload) {
            return requestBridge(AUTHORING_CREATE_EVENT, payload);
        },
        async pickAuthoringDirectory() {
            return requestBridge('pluginManager.authoring.pickDirectory', {});
        },
        async packPackage(sourcePath) {
            return requestBridge(PACKAGE_PACK_EVENT, { sourcePath });
        },
        async repairPackages() {
            return requestBridge('pluginManager.storage.reconcile', {});
        },
        async initialize() {
            await this.refresh();
            if (state.selectedPluginId === 'snowb.bmfont' && state.selectedRuntimeRecord?.state === 'active') {
                return this.openSelectedPluginPanel();
            }
            return { ...state };
        },
        subscribe(listener) {
            listeners.push(listener);
        },
        async refresh() {
            state.status = 'loading';
            notify();
            try {
                const snapshot = await requestBridge(SNAPSHOT_EVENT, {});
                state.runtimeRecords = snapshot.runtimeRecords ?? [];
                state.failureItems = snapshot.failureItems ?? [];
                state.packageCatalog = snapshot.packageCatalog ?? [];
                state.recentPackagePaths = snapshot.recentPackagePaths ?? [];
                state.kernelReloadSupported = snapshot.kernelReloadSupported === true;
                state.preferences = snapshot.preferences ?? state.preferences;
                state.executionDiagnosticsSnapshot = snapshot.executionDiagnosticsSnapshot ?? state.executionDiagnosticsSnapshot;
                state.mcpHub = snapshot.mcpHub ?? state.mcpHub;
                state.executionPriorityFilter = state.executionPriorityFilter ?? 'all';
                state.selectedPluginId = resolveSelectedPluginId(
                    state.preferences.selectedPluginId ?? state.selectedPluginId,
                    state.runtimeRecords,
                    state.failureItems,
                );
                state.selectedPackagePath = resolveSelectedPackagePath(
                    state.preferences.selectedPackagePath ?? state.selectedPackagePath,
                    state.packageCatalog,
                    state.selectedPluginId,
                );
                state.selectedExecutionGroupId = resolveSelectedExecutionGroupId(
                    state.executionDiagnosticsSnapshot,
                    state.selectedExecutionGroupId,
                    state.executionPriorityFilter,
                    state.showOnlyExceptionalExecutionGroups,
                );
                await refreshSelectedDetail();
                if (
                    state.embeddedPanel?.pluginId !== state.selectedPluginId
                    || state.selectedRuntimeRecord?.state !== 'active'
                ) {
                    state.embeddedPanel = null;
                }
                state.lastError = null;
                state.status = 'ready';
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
                state.status = 'error';
            }
            notify();
            return { ...state };
        },
        async exportSelectedFailure() {
            if (state.selectedPluginId == null) {
                return { ...state };
            }
            try {
                const payload = await requestBridge(EXPORT_EVENT, {
                    pluginId: state.selectedPluginId,
                });
                state.selectedFailureExport = payload.exportResult ?? null;
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'actions.export');
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
            }
            notify();
            return { ...state };
        },
        async retrySelectedCleanup() {
            if (state.selectedPluginId == null) {
                return { ...state };
            }
            try {
                const payload = await requestBridge(RETRY_EVENT, {
                    pluginId: state.selectedPluginId,
                });
                state.selectedIncident = payload.incident ?? null;
                state.lastCleanupSteps = payload.cleanupSteps ?? [];
                state.selectedFailureExport = null;
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'actions.retryCleanup');
                await this.refresh();
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
                notify();
            }
            return { ...state };
        },
        async activateSelectedPlugin() {
            return runRuntimeAction(ACTIVATE_EVENT);
        },
        async deactivateSelectedPlugin() {
            return runRuntimeAction(DEACTIVATE_EVENT);
        },
        async disposeSelectedPlugin() {
            return runRuntimeAction(DISPOSE_EVENT);
        },
        async openSelectedPluginPanel() {
            if (state.selectedPluginId == null) {
                return { ...state };
            }
            state.status = 'loading';
            state.embeddedPanel = null;
            state.lastError = null;
            notify();
            try {
                state.embeddedPanel = await requestBridge(PANEL_RESOLVE_EVENT, {
                    pluginId: state.selectedPluginId,
                });
                state.status = 'ready';
            } catch (error) {
                state.status = 'error';
                state.lastError = normalizeErrorMessage(error);
            }
            notify();
            return { ...state };
        },
        async closeEmbeddedPluginPanel() {
            state.embeddedPanel = null;
            state.status = 'ready';
            state.lastError = null;
            notify();
            return { ...state };
        },
        async refreshExecutionDiagnostics() {
            try {
                const snapshot = await requestBridge(EXECUTION_DIAGNOSTICS_EVENT, {});
                state.executionDiagnosticsSnapshot = snapshot;
                state.selectedExecutionGroupId = resolveSelectedExecutionGroupId(
                    state.executionDiagnosticsSnapshot,
                    state.selectedExecutionGroupId,
                    state.executionPriorityFilter,
                    state.showOnlyExceptionalExecutionGroups,
                );
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'execution.refresh');
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
            }
            notify();
            return { ...state };
        },
        async setMcpHubEnabled(isEnabled) {
            return runMcpAction(MCP_SET_ENABLED_EVENT, { isEnabled });
        },
        async setPluginMcpEnabled(isEnabled) {
            if (state.selectedPluginId == null) {
                return { ...state };
            }
            return runMcpAction(MCP_SET_PLUGIN_ENABLED_EVENT, { pluginId: state.selectedPluginId, isEnabled });
        },
        async setPluginMcpExposure(mode) {
            if (state.selectedPluginId == null || !['disabled', 'read_only', 'all'].includes(mode)) {
                return { ...state };
            }
            return runMcpAction(MCP_SET_PLUGIN_EXPOSURE_EVENT, { pluginId: state.selectedPluginId, mode });
        },
        async approveMcpPlan(planId) {
            return runMcpAction(MCP_APPROVE_PLAN_EVENT, { planId });
        },
        async rejectMcpPlan(planId) {
            return runMcpAction(MCP_REJECT_PLAN_EVENT, { planId });
        },
        async reloadKernel() {
            try {
                if (typeof panelBridge.reloadKernel === 'function') {
                    await panelBridge.reloadKernel();
                } else {
                    if (!state.kernelReloadSupported) {
                        return { ...state };
                    }
                    await requestBridge(KERNEL_RELOAD_EVENT, {});
                }
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'actions.reloadKernel');
                await this.refresh();
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
                notify();
            }
            return { ...state };
        },
        async planPackage(packagePath) {
            state.status = 'loading';
            notify();
            try {
                const payload = await requestBridge(PACKAGE_PLAN_EVENT, {
                    packagePath,
                });
                state.selectedPluginId = payload.installPlan?.pluginId ?? state.selectedPluginId;
                state.selectedInstalledPackageSnapshot = payload.installedPackageSnapshot ?? null;
                state.lastPackageActionSummary = t(state, 'package.planSummary', {
                    action: translateValue(state, payload.installPlan.operation),
                    pluginId: payload.installPlan.pluginId,
                    version: payload.installPlan.version,
                });
                state.lastActionSummary = state.lastPackageActionSummary;
                state.status = 'ready';
                state.lastError = null;
                await refreshSelectedDetail();
            } catch (error) {
                state.status = 'error';
                state.lastError = normalizeErrorMessage(error);
            }
            notify();
            return { ...state };
        },
        async pickPackageDirectory() {
            const payload = await requestBridge(PACKAGE_PICK_DIRECTORY_EVENT, {});
            return typeof payload.packagePath === 'string' ? payload.packagePath : null;
        },
        async installPackage(packagePath) {
            return runPackageAction(PACKAGE_INSTALL_EVENT, packagePath);
        },
        async upgradePackage(packagePath) {
            return runPackageAction(PACKAGE_UPGRADE_EVENT, packagePath);
        },
        async installAndActivatePackage(packagePath) {
            return runPackageAction('pluginManager.package.installAndActivate', packagePath);
        },
        async upgradeAndActivatePackage(packagePath) {
            return runPackageAction('pluginManager.package.upgradeAndActivate', packagePath);
        },
        async uninstallSelectedPackage() {
            if (state.selectedPluginId == null) {
                return { ...state };
            }
            return runPackageUninstall(state.selectedPluginId);
        },
        async selectPlugin(pluginId) {
            state.embeddedPanel = null;
            state.selectedPluginId = pluginId;
            state.selectedFailureExport = null;
            state.status = 'loading';
            notify();
            await refreshSelectedDetail();
            state.status = 'ready';
            notify();
            if (pluginId === 'snowb.bmfont' && state.selectedRuntimeRecord?.state === 'active') {
                return this.openSelectedPluginPanel();
            }
            return { ...state };
        },
        async selectExecutionGroup(groupId) {
            state.selectedExecutionGroupId = groupId;
            notify();
            return { ...state };
        },
        async setExecutionPriorityFilter(priority) {
            state.executionPriorityFilter = priority;
            state.selectedExecutionGroupId = resolveSelectedExecutionGroupId(
                state.executionDiagnosticsSnapshot,
                state.selectedExecutionGroupId,
                state.executionPriorityFilter,
                state.showOnlyExceptionalExecutionGroups,
            );
            notify();
            return { ...state };
        },
        async toggleExceptionalExecutionGroups() {
            state.showOnlyExceptionalExecutionGroups = !state.showOnlyExceptionalExecutionGroups;
            state.selectedExecutionGroupId = resolveSelectedExecutionGroupId(
                state.executionDiagnosticsSnapshot,
                state.selectedExecutionGroupId,
                state.executionPriorityFilter,
                state.showOnlyExceptionalExecutionGroups,
            );
            notify();
            return { ...state };
        },
        async selectPackageCatalogItem(packagePath) {
            state.selectedPackagePath = packagePath;
            const selectedPackageCatalogItem = state.packageCatalog.find((packageCatalogItem) => {
                return packageCatalogItem.packagePath === packagePath;
            });
            if (selectedPackageCatalogItem?.pluginId != null) {
                return this.selectPlugin(selectedPackageCatalogItem.pluginId);
            }
            notify();
            return { ...state };
        },
        async updatePreferences(preferences) {
            try {
                const payload = await requestBridge(PREFERENCES_UPDATE_EVENT, {
                    preferences,
                });
                state.preferences = payload.preferences;
                state.lastError = null;
                notify();
                return { ...state };
            } catch (error) {
                state.lastError = normalizeErrorMessage(error);
                notify();
                return { ...state };
            }
        },
        async registerPackageSource(source) {
            state.status = 'loading';
            notify();
            try {
                const payload = await requestBridge('pluginManager.packageSource.register', {
                    source,
                });
                state.packageCatalog = payload.packageCatalog ?? [];
                state.selectedPackagePath = source.packagePath;
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'actions.registerSource');
                await this.refresh();
            } catch (error) {
                state.status = 'error';
                state.lastError = normalizeErrorMessage(error);
                notify();
            }
            return { ...state };
        },
        async removePackageSource(packagePath) {
            state.status = 'loading';
            notify();
            try {
                const payload = await requestBridge('pluginManager.packageSource.remove', {
                    packagePath,
                });
                state.packageCatalog = payload.packageCatalog ?? [];
                if (state.selectedPackagePath === packagePath) {
                    state.selectedPackagePath = null;
                }
                state.lastError = null;
                state.lastActionSummary = buildSuccessMessage(state, 'actions.removeSource');
                await this.refresh();
            } catch (error) {
                state.status = 'error';
                state.lastError = normalizeErrorMessage(error);
                notify();
            }
            return { ...state };
        },
        async switchSelectedPackageVersion(version) {
            return runPackageVersionAction(PACKAGE_SWITCH_VERSION_EVENT, version);
        },
        async removeSelectedPackageVersion(version) {
            return runPackageVersionAction(PACKAGE_REMOVE_VERSION_EVENT, version);
        },
    };

    async function runRuntimeAction(event) {
        if (state.selectedPluginId == null) {
            return { ...state };
        }
        try {
            await requestBridge(event, {
                pluginId: state.selectedPluginId,
            });
            state.selectedFailureExport = null;
            state.lastActionSummary = buildSuccessMessage(state, getRuntimeActionTranslationKey(event));
            await driver.refresh();
        } catch (error) {
            state.lastError = normalizeErrorMessage(error);
            notify();
        }
        return { ...state };
    }

    async function runPackageAction(event, packagePath) {
        state.status = 'loading';
        notify();
        try {
            const payload = await requestBridge(event, {
                packagePath,
            });
            state.selectedPluginId = payload.installResult?.pluginId ?? state.selectedPluginId;
            state.selectedInstalledPackageSnapshot = payload.installedPackageSnapshot ?? null;
            state.lastPackageActionSummary = summarizePackageAction(payload);
            state.lastError = null;
            state.lastActionSummary = state.lastPackageActionSummary;
            await driver.refresh();
        } catch (error) {
            state.status = 'error';
            state.lastError = normalizeErrorMessage(error);
            notify();
        }
        return { ...state };
    }

    async function runPackageUninstall(pluginId) {
        state.status = 'loading';
        notify();
        try {
            const payload = await requestBridge(PACKAGE_UNINSTALL_EVENT, {
                pluginId,
            });
            state.selectedInstalledPackageSnapshot = payload.installedPackageSnapshot ?? null;
            state.lastPackageActionSummary = summarizePackageAction(payload);
            state.lastError = null;
            state.lastActionSummary = state.lastPackageActionSummary;
            await driver.refresh();
        } catch (error) {
            state.status = 'error';
            state.lastError = normalizeErrorMessage(error);
            notify();
        }
        return { ...state };
    }

    async function runPackageVersionAction(event, version) {
        if (state.selectedPluginId == null || version.length === 0) {
            return { ...state };
        }
        state.status = 'loading';
        notify();
        try {
            const payload = await requestBridge(event, {
                pluginId: state.selectedPluginId,
                version,
            });
            state.selectedInstalledPackageSnapshot = payload.installedPackageSnapshot ?? null;
            state.lastError = null;
            state.lastPackageActionSummary = event === PACKAGE_SWITCH_VERSION_EVENT
                ? `${t(state, 'actions.switchVersion')} ${version}`
                : `${t(state, 'actions.removeVersion')} ${version}`;
            state.lastActionSummary = state.lastPackageActionSummary;
            await driver.refresh();
        } catch (error) {
            state.status = 'error';
            state.lastError = normalizeErrorMessage(error);
            notify();
        }
        return { ...state };
    }

    async function runMcpAction(event, payload) {
        try {
            state.mcpHub = await requestBridge(event, payload);
            state.lastError = null;
        } catch (error) {
            state.lastError = normalizeErrorMessage(error);
        }
        notify();
        return { ...state };
    }

    return driver;
}

function render(state) {
    latestRenderedState = state;
    syncPanelToast(state);
    renderHeader(state);
    renderPackageCatalog(state);
    renderPackageScopes(state);
    renderPackageSelection(state);
    renderPackageDetails(state);
    renderPackageVersions(state);
    renderActions(state);
    renderCleanup(state);
    renderMcpHub(state);
}

function renderHeader(state) {
    applyStaticTranslations(state);
    if (uiState.authoringResult != null) elements.authoringResult.textContent = uiState.authoringResult;
    uiState.packageFilter = state.preferences?.packageFilter ?? uiState.packageFilter;
    uiState.packageCatalogSort = state.preferences?.packageCatalogSort ?? uiState.packageCatalogSort;
    elements.packageFilterSelect.value = uiState.packageFilter;
    if (elements.packageSortSelect != null) elements.packageSortSelect.value = uiState.packageCatalogSort;
}

/**
 * @description 构造面板顶部可见的成功反馈，复用现有操作本地化文案。
 * @param translationKey 当前操作对应的翻译键
 * @returns 供状态区显示的成功结果
 */
function buildSuccessMessage(state, translationKey) {
    const action = t(state, translationKey);
    return normalizeLocale(state.preferences?.locale) === 'zh-CN' ? `${action}成功。` : `${action} succeeded.`;
}

/**
 * @description 把运行时 bridge 事件映射为面板可读的操作翻译键。
 * @param event 插件运行时 bridge 事件名
 * @returns 对应的操作翻译键
 */
function getRuntimeActionTranslationKey(event) {
    switch (event) {
        case ACTIVATE_EVENT:
            return 'actions.activate';
        case DEACTIVATE_EVENT:
            return 'actions.deactivate';
        case DISPOSE_EVENT:
            return 'actions.dispose';
        default:
            return 'actions.refresh';
    }
}

function renderPackageCatalog(state) {
    const filteredPackageCatalog = filterPackageCatalog(getPackageCatalogEntries(state));
    if (filteredPackageCatalog.length === 0) {
        const emptyKey = state.bridgeMode === 'preview' ? 'package.offline' : getPackageCatalogEntries(state).length === 0 ? 'package.emptyChannel' : 'package.noMatches';
        elements.packageCatalog.innerHTML = `<div class="empty-state">${escapeHtml(t(state, emptyKey))}</div>`;
        return;
    }

    elements.packageCatalog.innerHTML = sortPackageCatalog(filteredPackageCatalog)
        .map((packageCatalogItem) => buildPackageCatalogCard(packageCatalogItem, state.selectedPackagePath))
        .join('');

    wirePackageCatalogSelection(elements.packageCatalog);
}

function renderPackageScopes(state) {
    const catalog = getPackageCatalogEntries(state);
    const countUniquePlugins = (items) => new Set(items.map((item) => item.pluginId)).size;
    elements.packageScopeAllCount.textContent = String(countUniquePlugins(catalog));
    elements.packageScopeInstalledCount.textContent = String(countUniquePlugins(catalog.filter((item) => item.installedActiveVersion != null)));
    elements.packageScopeUpgradeCount.textContent = String(countUniquePlugins(catalog.filter(hasPackageUpdate)));
    getPanelDomRoot().querySelectorAll('[data-package-scope]').forEach((button) => {
        const active = button.getAttribute('data-package-scope') === uiState.packageFilter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    getPanelDomRoot().querySelectorAll('[data-package-channel]').forEach((button) => {
        const active = button.getAttribute('data-package-channel') === uiState.packageChannel;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
    });
    elements.choosePackageDirectoryButton.hidden = uiState.packageChannel !== 'development';
}

function isPackageInChannel(packageCatalogItem, channel) {
    if (packageCatalogItem.runtimeOnly) return true;
    return channel === 'development'
        ? packageCatalogItem.sourceKind === 'manual' || packageCatalogItem.sourceKind === 'local'
        : packageCatalogItem.sourceKind === 'registry';
}

/**
 * @description 将来源目录与实际运行记录合成只读显示条目；运行条目不生成安装路径或发行信息。
 */
function getPackageCatalogEntries(state) {
    if (state == null) return [];
    const records = state.runtimeRecords ?? [];
    const catalog = state.packageCatalog ?? [];
    const entries = catalog.filter((item) => isPackageInChannel(item, uiState.packageChannel)).map((item) => {
        const runtime = records.find((record) => record.pluginId === item.pluginId);
        return { ...item, displayName: item.displayName ?? runtime?.displayName, iconUrl: item.iconUrl ?? runtime?.iconUrl };
    });
    for (const record of records) {
        if (catalog.some((item) => item.pluginId === record.pluginId)) continue;
        entries.push({
            pluginId: record.pluginId, displayName: record.displayName, iconUrl: record.iconUrl,
            version: record.version, installedActiveVersion: record.version,
            sourceKind: 'runtime', sourcePath: record.installPath ?? '', packagePath: null, runtimeOnly: true,
        });
    }
    return entries;
}

function getSelectedPackageEntry(state) {
    if (state == null || uiState.localPackagePath) return null;
    const entries = getPackageCatalogEntries(state);
    if (uiState.runtimeSelectionId != null) {
        return entries.find((item) => item.runtimeOnly && item.pluginId === uiState.runtimeSelectionId) ?? null;
    }
    return entries.find((item) => item.packagePath != null && item.packagePath === state.selectedPackagePath)
        ?? (state.selectedPackagePath == null ? entries.find((item) => item.runtimeOnly && item.pluginId === state.selectedPluginId) : null)
        ?? null;
}

/**
 * @description 按 SemVer 比较版本；未知版本格式不冒充可更新，预发行低于对应正式版本。
 */
function comparePackageVersions(left, right) {
    const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
    const a = pattern.exec(left ?? '');
    const b = pattern.exec(right ?? '');
    if (a == null || b == null) return null;
    for (let index = 1; index <= 3; index += 1) {
        const delta = Number(a[index]) - Number(b[index]);
        if (delta !== 0) return Math.sign(delta);
    }
    if (a[4] === b[4]) return 0;
    if (a[4] == null) return 1;
    if (b[4] == null) return -1;
    const preA = a[4].split('.');
    const preB = b[4].split('.');
    for (let index = 0; index < Math.max(preA.length, preB.length); index += 1) {
        if (preA[index] === preB[index]) continue;
        if (preA[index] == null) return -1;
        if (preB[index] == null) return 1;
        const numericA = /^\d+$/.test(preA[index]);
        const numericB = /^\d+$/.test(preB[index]);
        if (numericA && numericB) return Math.sign(Number(preA[index]) - Number(preB[index]));
        if (numericA !== numericB) return numericA ? -1 : 1;
        return preA[index] < preB[index] ? -1 : 1;
    }
    return 0;
}

function hasPackageUpdate(item) {
    return !item.runtimeOnly && item.installedActiveVersion != null && comparePackageVersions(item.version, item.installedActiveVersion) === 1;
}

function getPackageStatus(state, item) {
    if (item.runtimeOnly) return t(state, item.pluginId === BUILTIN_PLUGIN_MANAGER_PANEL_ID ? 'versions.builtin' : 'package.loaded');
    if (hasPackageUpdate(item)) return t(state, 'package.updateAvailable');
    return t(state, item.installedActiveVersion != null ? 'package.installed' : 'detail.notInstalled');
}

function renderPackageSelection(state) {
    const selected = getSelectedPackageEntry(state);
    const busy = state.status === 'loading';
    if (selected == null) {
        elements.packageRuntimeControls.hidden = true;
        const hasLocalPath = uiState.packageChannel === 'development' && uiState.localPackagePath.length > 0;
        elements.packageSelectionPanel.classList.toggle('is-empty', !hasLocalPath);
        elements.packageDetailTabs.hidden = true;
        elements.packageRuntimeTab.hidden = true;
        elements.packageDescriptionUnavailable.hidden = true;
        setActivePackageDetailTab('description');
        elements.packagePathInput.value = hasLocalPath ? uiState.localPackagePath : '';
        elements.packagePathInput.hidden = !hasLocalPath;
        elements.packageSelectionTitle.textContent = t(state, hasLocalPath ? 'package.localPackage' : 'package.selectionTitle');
        elements.packageSelectionId.textContent = '';
        elements.packageSelectionStatus.hidden = true;
        elements.packageSelectionDescriptionSection.hidden = true;
        elements.packageSelectionDescription.textContent = '';
        elements.packageSelectionEmpty.hidden = hasLocalPath;
        elements.packageSelectionMeta.hidden = true;
        elements.packageSelectionMeta.innerHTML = '';
        elements.packageSelectionIcon.textContent = 'P';
        elements.packageCatalogVersionSelect.replaceChildren();
        elements.packageCatalogVersionSelect.disabled = true;
        elements.packageCatalogVersionSelect.closest('.package-version-field').hidden = true;
        elements.installPackageButton.hidden = !hasLocalPath;
        elements.installPackageButton.disabled = busy || !hasLocalPath;
        elements.installPackageButton.textContent = t(state, 'actions.install');
        elements.uninstallPackageButton.disabled = true;
        elements.uninstallPackageButton.closest('.package-more-options').hidden = true;
        return;
    }

    elements.packageSelectionPanel.classList.toggle('is-empty', false);
    elements.packageDetailTabs.hidden = false;
    elements.packagePathInput.value = selected.packagePath ?? '';
    elements.packagePathInput.hidden = true;
    elements.packageSelectionEmpty.hidden = true;
    elements.packageSelectionTitle.textContent = selected.displayName ?? selected.pluginId;
    elements.packageSelectionId.textContent = selected.pluginId;
    elements.packageSelectionIcon.innerHTML = buildPluginIcon(selected.iconUrl, selected.displayName ?? selected.pluginId, 'plugin-logo-image', selected.pluginId);
    elements.packageSelectionStatus.textContent = getPackageStatus(state, selected);
    elements.packageSelectionStatus.className = `pill ${selected.installedActiveVersion != null ? 'pill-success' : 'pill-neutral'}`;
    elements.packageSelectionStatus.hidden = false;
    const runtime = state.runtimeRecords.find((record) => record.pluginId === selected.pluginId) ?? null;
    const runtimeMatches = state.selectedPluginId === selected.pluginId && state.selectedRuntimeRecord?.pluginId === selected.pluginId;
    elements.packageRuntimeControls.hidden = !runtimeMatches;
    elements.packageRuntimeTab.hidden = !runtimeMatches;
    setActivePackageDetailTab(uiState.packageDetailTab);
    const description = localizeDescription(state, runtime?.description ?? runtime?.metadata?.description);
    elements.packageSelectionDescription.textContent = description;
    elements.packageSelectionDescriptionSection.hidden = description.length === 0;
    elements.packageDescriptionUnavailable.hidden = description.length > 0;
    const source = selected.runtimeOnly ? t(state, 'package.runtimeSource') : translateValue(state, selected.sourceKind);
    const fields = [
        [t(state, selected.runtimeOnly ? 'package.runtimeVersion' : 'package.version'), selected.version],
        ...(selected.runtimeOnly ? [] : [[t(state, 'package.installedVersion'), selected.installedActiveVersion ?? t(state, 'detail.notInstalled')]]),
        [t(state, 'package.source'), source],
    ];
    elements.packageSelectionMeta.innerHTML = fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    elements.packageSelectionMeta.hidden = false;
    elements.packageSelectionMeta.title = selected.sourcePath ?? '';

    const versions = getPackageCatalogEntries(state).filter((item) => item.pluginId === selected.pluginId && !item.runtimeOnly)
        .sort((left, right) => comparePackageVersions(right.version, left.version) ?? 0);
    const uniqueVersions = new Map();
    for (const item of versions) {
        if (!uniqueVersions.has(item.version) || item.packagePath === selected.packagePath) uniqueVersions.set(item.version, item);
    }
    const versionOptions = [...uniqueVersions.values()];
    elements.packageCatalogVersionSelect.innerHTML = versionOptions.map((item) => `<option value="${escapeHtml(item.packagePath)}">${escapeHtml(item.version)}</option>`).join('');
    elements.packageCatalogVersionSelect.value = selected.packagePath ?? '';
    elements.packageCatalogVersionSelect.disabled = busy || versionOptions.length < 2;
    elements.packageCatalogVersionSelect.closest('.package-version-field').hidden = versionOptions.length === 0;
    const canUninstall = state.selectedPluginId === selected.pluginId && state.selectedInstalledPackageSnapshot?.pluginId === selected.pluginId
        && selected.pluginId !== BUILTIN_PLUGIN_MANAGER_PANEL_ID;
    elements.uninstallPackageButton.disabled = busy || !canUninstall;
    elements.uninstallPackageButton.closest('.package-more-options').hidden = !canUninstall;

    const alreadyInstalled = selected.installedActiveVersion === selected.version;
    elements.installPackageButton.hidden = selected.runtimeOnly || alreadyInstalled;
    elements.installPackageButton.disabled = busy || selected.runtimeOnly || alreadyInstalled;
    const action = hasPackageUpdate(selected) ? 'actions.upgrade' : selected.installedActiveVersion != null ? 'package.selectVersion' : 'actions.install';
    elements.installPackageButton.textContent = selected.runtimeOnly || alreadyInstalled
        ? getPackageStatus(state, selected) : t(state, action);
}

function renderPackageDetails(state) {
    elements.detailIncidentMessage.textContent = state.selectedIncident?.errorMessage ?? t(state, 'detail.noFailureSelected');
    elements.packageActionSummary.textContent = state.lastPackageActionSummary ?? t(state, 'package.pending');
    if (state.selectedRuntimeRecord == null) {
        elements.detailGrid.innerHTML = `<div class="empty-state">${escapeHtml(t(state, 'empty.noPluginSelected'))}</div>`;
        return;
    }

    const runtimeRecord = state.selectedRuntimeRecord;
    const incident = state.selectedIncident;
    const detailEntries = [
        [t(state, 'detail.version'), runtimeRecord.version],
        [t(state, 'detail.trust'), translateValue(state, runtimeRecord.trustLevel)],
        [t(state, 'detail.failurePhase'), translateValue(state, incident?.phase ?? 'none')],
        [t(state, 'detail.export'), state.selectedFailureExport == null ? t(state, 'detail.exportPending') : t(state, 'detail.exportReady')],
        [t(state, 'detail.installedActive'), state.selectedInstalledPackageSnapshot?.activeVersion ?? t(state, 'detail.notInstalled')],
        [t(state, 'detail.installedVersions'), state.selectedInstalledPackageSnapshot?.versions?.join(', ') ?? t(state, 'detail.none')],
    ];
    elements.detailGrid.innerHTML = detailEntries.map(([label, value]) => {
        return `<div class="detail-grid-item"><span class="detail-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }).join('');
}

function buildPackageCatalogCard(item, selectedPackagePath) {
    const state = latestRenderedState ?? window.pluginManagerPanelUiState;
    const selected = getSelectedPackageEntry(state);
    const isSelected = selected?.pluginId === item.pluginId;
    const selectionAttribute = item.runtimeOnly
        ? `data-runtime-plugin-id="${escapeHtml(item.pluginId)}"`
        : `data-package-path="${escapeHtml(item.packagePath)}"`;
    const status = getPackageStatus(state, item);
    const statusIcon = hasPackageUpdate(item) ? '↑' : item.installedActiveVersion != null ? '✓' : '';
    return `<button type="button" class="plugin-card${isSelected ? ' is-selected' : ''}" ${selectionAttribute} aria-pressed="${isSelected}" title="${escapeHtml(`${item.pluginId} · ${status}`)}">
    ${buildPluginIcon(item.iconUrl, item.displayName ?? item.pluginId, 'plugin-card-logo', item.pluginId)}
    <span class="plugin-card-title">${escapeHtml(item.displayName ?? item.pluginId)}</span>
    <span class="plugin-card-meta">${escapeHtml(item.pluginId)}</span>
    <span class="plugin-card-version">${escapeHtml(item.version)}</span>
    <span class="plugin-card-status" aria-label="${escapeHtml(status)}"><span aria-hidden="true">${statusIcon}</span></span>
</button>`;
}

function buildPluginIcon(iconUrl, label, className, pluginId) {
    if (pluginId === BUILTIN_PLUGIN_MANAGER_PANEL_ID) {
        return buildBuiltinPluginManagerIcon(className);
    }
    if (typeof iconUrl === 'string' && iconUrl.startsWith('data:image/png;base64,')) {
        return `<img class="${className}" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true" />`;
    }
    return `<span class="${className} plugin-logo-fallback" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`;
}

function buildBuiltinPluginManagerIcon(className) {
    return `<svg class="${className}" viewBox="0 0 64 64" role="img" aria-label="Plugin Manager">
    <rect x="4" y="4" width="56" height="56" rx="16" fill="#123b45" />
    <path d="M18 20h28v7H18zM18 31h18v7H18zM18 42h28v7H18z" fill="#74d7de" />
    <path d="M40 31h6v7h-6z" fill="#21b7d9" />
</svg>`;
}

function wirePackageCatalogSelection(rootElement) {
    rootElement.querySelectorAll('[data-runtime-plugin-id]').forEach((button) => {
        button.addEventListener('click', async () => {
            uiState.runtimeSelectionId = button.getAttribute('data-runtime-plugin-id');
            uiState.localPackagePath = '';
            await activePanelDriver?.selectPackageCatalogItem(null);
            await activePanelDriver?.selectPlugin(uiState.runtimeSelectionId);
        });
    });
    rootElement.querySelectorAll('[data-package-path]').forEach((buttonElement) => {
        buttonElement.addEventListener('click', async () => {
            uiState.runtimeSelectionId = null;
            uiState.localPackagePath = '';
            const packagePath = buttonElement.getAttribute('data-package-path');
            elements.packagePathInput.value = packagePath ?? '';
            const selectedPackageCatalogItem = (latestRenderedState?.packageCatalog ?? []).find((packageCatalogItem) => {
                return packageCatalogItem.packagePath === packagePath;
            });
            if (selectedPackageCatalogItem != null) {
                elements.packageSourceKindSelect.value = selectedPackageCatalogItem.sourceKind;
                elements.packageSourcePluginIdInput.value = selectedPackageCatalogItem.pluginId;
                elements.packageSourceVersionInput.value = selectedPackageCatalogItem.version;
                elements.packageSourcePathInput.value = selectedPackageCatalogItem.sourcePath;
                elements.packageSourcePackagePathInput.value = selectedPackageCatalogItem.packagePath;
            }
            await activePanelDriver?.selectPackageCatalogItem(packagePath);
        });
    });
}

function renderPackageVersions(state) {
    const selected = getSelectedPackageEntry(state);
    const selectionMatches = selected != null && selected.pluginId === state.selectedPluginId;
    const installedPackageSnapshot = selectionMatches && state.selectedInstalledPackageSnapshot?.pluginId === selected.pluginId
        ? state.selectedInstalledPackageSnapshot : null;
    const isBuiltinManagerSelection = selectionMatches && selected.pluginId === BUILTIN_PLUGIN_MANAGER_PANEL_ID;
    const builtinRuntimeVersion = isBuiltinManagerSelection && state.selectedRuntimeRecord?.pluginId === selected.pluginId
        ? state.selectedRuntimeRecord.version ?? '' : '';
    const versions = installedPackageSnapshot?.versions ?? (builtinRuntimeVersion.length > 0 ? [builtinRuntimeVersion] : []);
    const activeVersion = installedPackageSnapshot?.activeVersion ?? builtinRuntimeVersion;
    const isPluginActive = state.selectedRuntimeRecord?.state === 'active';
    const currentSelectedVersion = elements.packageVersionSelect.value;
    const selectedVersion = versions.includes(currentSelectedVersion) ? currentSelectedVersion : activeVersion;

    elements.packageVersionCard.hidden = versions.length === 0;
    elements.packageVersionsUnavailable.hidden = selected == null || versions.length > 0;
    elements.packageVersionHint.textContent = activeVersion.length > 0
        ? t(state, 'versions.active', { version: activeVersion })
        : t(state, 'versions.empty');
    elements.packageVersionSelect.innerHTML = versions.map((version) => {
        const activeLabel = isBuiltinManagerSelection ? t(state, 'versions.builtin') : t(state, 'detail.installedActive');
        const activeSuffix = version === activeVersion ? ` · ${activeLabel}` : '';
        return `<option value="${escapeHtml(version)}">${escapeHtml(`${version}${activeSuffix}`)}</option>`;
    }).join('');
    elements.packageVersionSelect.value = selectedVersion;
    const canManageVersions = state.status !== 'loading' && getSelectedPackageEntry(state)?.pluginId === state.selectedPluginId;
    elements.packageVersionSelect.disabled = !canManageVersions || versions.length === 0;
    elements.switchPackageVersionButton.disabled = !canManageVersions || versions.length === 0 || isPluginActive || selectedVersion === activeVersion;
    elements.removePackageVersionButton.disabled = !canManageVersions || versions.length === 0 || selectedVersion === activeVersion;
    elements.switchPackageVersionButton.title = isPluginActive ? t(state, 'versions.requiresInactive') : '';
    elements.removePackageVersionButton.title = selectedVersion === activeVersion ? t(state, 'versions.removeActive') : '';
}

function renderCleanup(state) {
    const cleanupSteps = state.lastCleanupSteps ?? [];
    const cleanupStable = cleanupSteps.length > 0 && cleanupSteps.every((step) => step.ok);
    elements.cleanupBadge.textContent = cleanupSteps.length === 0 ? t(state, 'cleanup.none') : (cleanupStable ? t(state, 'cleanup.stable') : t(state, 'cleanup.pending'));
    elements.cleanupBadge.className = `pill ${cleanupSteps.length === 0 ? 'pill-neutral' : cleanupStable ? 'pill-success' : 'pill-danger'}`;

    if (cleanupSteps.length === 0) {
        elements.cleanupTimeline.innerHTML = `<div class="empty-state">${escapeHtml(t(state, 'cleanup.noSteps'))}</div>`;
        return;
    }

    elements.cleanupTimeline.innerHTML = cleanupSteps.map((cleanupStep) => {
        return `<div class="timeline-row">
    <span class="timeline-target">${escapeHtml(cleanupStep.targetType)}</span>
    <span class="timeline-id">${escapeHtml(cleanupStep.targetId)}</span>
    <span class="pill ${cleanupStep.ok ? 'pill-success' : 'pill-danger'}">${cleanupStep.ok ? escapeHtml(t(state, 'cleanup.ok')) : escapeHtml(cleanupStep.errorMessage ?? t(state, 'cleanup.pending'))}</span>
</div>`;
    }).join('');
}

function renderActions(state) {
    const selectedEntry = getSelectedPackageEntry(state);
    const hasSelection = state.status !== 'loading' && selectedEntry?.pluginId === state.selectedPluginId
        && state.selectedRuntimeRecord?.pluginId === state.selectedPluginId;
    const isBuiltinManagerSelection = state.selectedPluginId === BUILTIN_PLUGIN_MANAGER_PANEL_ID;
    const canReloadKernel = hasSelection && isBuiltinManagerSelection && state.kernelReloadSupported;
    const runtimeState = state.selectedRuntimeRecord?.state ?? null;
    const canManageSelectedPlugin = hasSelection && !isBuiltinManagerSelection;
    const canActivate = canManageSelectedPlugin && runtimeState === 'inactive';
    const canDeactivate = canManageSelectedPlugin && runtimeState === 'active';
    const canDispose = canManageSelectedPlugin && runtimeState === 'inactive';
    const canConfigurePluginMcp = canManageSelectedPlugin && state.mcpHub?.isAvailable === true;
    elements.exportButton.disabled = !hasSelection || state.selectedIncident == null;
    elements.retryButton.disabled = !hasSelection || state.selectedIncident == null;
    elements.activateButton.disabled = !canActivate;
    elements.deactivateButton.disabled = !canDeactivate;
    elements.disposeButton.disabled = !canDispose;
    elements.openPanelButton.disabled = !canManageSelectedPlugin || runtimeState !== 'active';
    elements.activateButton.title = getLifecycleActionUnavailableReason(state, 'activate');
    elements.deactivateButton.title = getLifecycleActionUnavailableReason(state, 'deactivate');
    elements.disposeButton.title = getLifecycleActionUnavailableReason(state, 'dispose');
    elements.openPanelButton.title = getLifecycleActionUnavailableReason(state, 'openPanel');
    elements.pluginMcpExposureControl.hidden = !canManageSelectedPlugin;
    elements.pluginMcpExposureSelect.disabled = !canConfigurePluginMcp;
    elements.pluginMcpExposureSelect.value = getPluginMcpExposure(state, state.selectedPluginId);
    elements.pluginMcpExposureSelect.title = canConfigurePluginMcp ? '' : '当前编辑器宿主尚未配置 MCP Hub。';
    elements.reloadKernelButton.hidden = !isBuiltinManagerSelection;
    elements.reloadKernelButton.disabled = !canReloadKernel;
    elements.installAndActivatePackageButton.disabled = false;
    elements.upgradeAndActivatePackageButton.disabled = false;
    // Package uninstall availability is tied to the package selection, not runtime plugin selection.
}

function getPluginMcpExposure(state, pluginId) {
    if (pluginId == null || state.mcpHub?.disabledPluginIds?.includes(pluginId) === true) {
        return 'disabled';
    }
    return state.mcpHub?.writeEnabledPluginIds?.includes(pluginId) === true ? 'all' : 'read_only';
}

function getLifecycleActionUnavailableReason(state, action) {
    if (state.selectedPluginId == null) {
        return t(state, 'empty.noPlugins');
    }
    if (state.selectedPluginId === BUILTIN_PLUGIN_MANAGER_PANEL_ID) {
        return 'Builtin Plugin Manager is protected.';
    }

    const runtimeState = state.selectedRuntimeRecord?.state ?? null;
    switch (action) {
        case 'activate':
            return runtimeState === 'inactive' ? '' : 'Deactivate the plugin before activating it again.';
        case 'deactivate':
            return runtimeState === 'active' ? '' : 'Only active plugins can be deactivated.';
        case 'dispose':
            return runtimeState === 'inactive' ? '' : 'Deactivate the plugin before disposing it.';
        case 'openPanel':
            return runtimeState === 'active' ? '' : t(state, 'panel.requiresActive');
        default:
            return '';
    }
}

function renderMcpHub(state) {
    if (state == null) {
        return;
    }
    const mcpHub = state.mcpHub ?? { isAvailable: false, isEnabled: false, port: null, catalogRevision: 0, capabilities: [], pendingPlans: [], recentCalls: [] };
    elements.mcpStatusMessage.textContent = !mcpHub.isAvailable
        ? '当前编辑器宿主尚未配置 MCP Hub。'
        : (mcpHub.isEnabled ? `MCP Hub 已在动态端口 ${mcpHub.port ?? '—'} 上启用。` : '当前项目已禁用 MCP Hub。');
    const allCapabilities = mcpHub.capabilities ?? [];
    const categories = [
        ['all', '全部'],
        ['cocos', 'Cocos 能力'],
        ['atom', 'Atom'],
        ['workflow', '工作流'],
    ];
    elements.mcpCategoryFilters.innerHTML = categories.map(([category, title]) => `<button type="button" class="mcp-category-filter${uiState.mcpCategory === category ? ' is-active' : ''}" data-mcp-category="${category}">${title}</button>`).join('');
    const capabilities = allCapabilities.filter((capability) => {
        const categoryMatches = uiState.mcpCategory === 'all' || capability.category === uiState.mcpCategory;
        const searchMatches = uiState.mcpSearch.length === 0 || `${capability.name} ${localizeDescription(state, capability.description)}`.toLowerCase().includes(uiState.mcpSearch);
        return categoryMatches && searchMatches;
    });
    const selectedCapability = allCapabilities.find((capability) => capability.name === uiState.selectedMcpCapabilityName)
        ?? capabilities[0]
        ?? null;
    uiState.selectedMcpCapabilityName = selectedCapability?.name ?? null;
    const workflowCount = allCapabilities.filter((capability) => capability.category === 'workflow').length;
    elements.mcpSummary.innerHTML = `<div><dt>端口</dt><dd>${escapeHtml(String(mcpHub.port ?? '—'))}</dd></div><div><dt>能力目录版本</dt><dd>${escapeHtml(String(mcpHub.catalogRevision ?? 0))}</dd></div><div><dt>工作流</dt><dd>${escapeHtml(String(workflowCount))}</dd></div><div><dt>最近调用</dt><dd>${escapeHtml(String((mcpHub.recentCalls ?? []).length))}</dd></div>`;
    elements.mcpCapabilityList.innerHTML = capabilities.length === 0
        ? buildEmptyState('当前分类没有匹配的 MCP capability。')
        : capabilities.map((capability) => `<article class="mcp-capability-card${capability.name === selectedCapability?.name ? ' is-selected' : ''}" data-mcp-capability-name="${escapeHtml(capability.name)}"><div class="mcp-card-head"><code class="mcp-capability-name">${escapeHtml(capability.name)}</code><span class="pill ${capability.readOnly ? 'pill-success' : 'pill-danger'}">${escapeHtml(capability.readOnly ? '只读' : '写入')}</span></div><p class="mcp-card-copy">${escapeHtml(localizeDescription(state, capability.description))}</p></article>`).join('');
    elements.mcpDetailTitle.textContent = selectedCapability?.name ?? '选择一项能力';
    elements.mcpDetailDescription.textContent = localizeDescription(state, selectedCapability?.description) || t(state, 'mcp.selectCapability');
    const schemaProperties = selectedCapability?.inputSchema?.properties ?? {};
    const requiredProperties = new Set(selectedCapability?.inputSchema?.required ?? []);
    elements.mcpSchemaFields.innerHTML = Object.keys(schemaProperties).length === 0
        ? buildEmptyState('该 capability 不需要输入参数。')
        : Object.entries(schemaProperties).map(([name, schema]) => `<div class="mcp-schema-field"><strong>${escapeHtml(name)}${requiredProperties.has(name) ? ' *' : ''}</strong><span>${escapeHtml(schema.type ?? 'unknown')}${schema.description ? ` · ${escapeHtml(localizeDescription(state, schema.description))}` : ''}</span></div>`).join('');
    elements.mcpSchemaJson.textContent = JSON.stringify(selectedCapability?.inputSchema ?? {}, null, 2);
    elements.mcpPlanList.innerHTML = (mcpHub.pendingPlans ?? []).length === 0
        ? buildEmptyState('当前没有等待审批的写操作请求。')
        : mcpHub.pendingPlans.map((plan) => `<article class="mcp-plan-card"><div class="mcp-card-head"><code class="mcp-capability-name">${escapeHtml(plan.name)}</code><span class="pill pill-danger">${escapeHtml(plan.risk)}</span></div><div class="mcp-plan-actions"><button type="button" class="button button-primary" data-mcp-plan-action="approve" data-mcp-plan-id="${escapeHtml(plan.id)}">批准</button><button type="button" class="button button-danger" data-mcp-plan-action="reject" data-mcp-plan-id="${escapeHtml(plan.id)}">拒绝</button></div></article>`).join('');
    const recentCallStatusLabels = {
        pending_approval: '等待审批',
        approved: '已批准',
        succeeded: '成功',
        failed: '失败',
        rejected: '已拒绝',
        expired: '已过期',
    };
    elements.mcpRecentCallList.innerHTML = (mcpHub.recentCalls ?? []).length === 0
        ? buildEmptyState('当前编辑器会话内还没有 MCP 调用。')
        : mcpHub.recentCalls.map((call) => `<article class="mcp-call-card"><div class="mcp-card-head"><code class="mcp-capability-name">${escapeHtml(call.name)}</code><span class="pill ${call.status === 'succeeded' ? 'pill-success' : (call.status === 'failed' ? 'pill-danger' : 'pill-neutral')}">${escapeHtml(recentCallStatusLabels[call.status] ?? call.status)}</span></div><p class="mcp-call-meta">${escapeHtml(call.category)} · ${escapeHtml(call.risk)} · ${escapeHtml(new Date(call.requestedAt).toLocaleTimeString())}${call.durationMs == null ? '' : ` · ${escapeHtml(String(call.durationMs))} ms`}</p>${call.errorCode == null ? '' : `<p class="mcp-call-error">${escapeHtml(call.errorCode)}</p>`}</article>`).join('');
}

function filterPackageCatalog(packageCatalog) {
    const filteredPackageCatalog = packageCatalog.filter((packageCatalogItem) => {
        const matchesSearch = uiState.packageSearch.length === 0
            || (packageCatalogItem.displayName ?? '').toLowerCase().includes(uiState.packageSearch)
            || packageCatalogItem.pluginId.toLowerCase().includes(uiState.packageSearch)
            || (packageCatalogItem.sourcePath ?? '').toLowerCase().includes(uiState.packageSearch)
            || (packageCatalogItem.packagePath ?? '').toLowerCase().includes(uiState.packageSearch);
        if (!matchesSearch) {
            return false;
        }

        if (!isPackageInChannel(packageCatalogItem, uiState.packageChannel)) {
            return false;
        }

        if (uiState.packageFilter === 'installed') {
            return packageCatalogItem.installedActiveVersion != null;
        }
        if (uiState.packageFilter === 'not-installed') {
            return packageCatalogItem.installedActiveVersion == null;
        }
        if (uiState.packageFilter === 'upgrade') {
            return hasPackageUpdate(packageCatalogItem);
        }
        return true;
    });
    const rows = new Map();
    for (const item of filteredPackageCatalog) {
        const previous = rows.get(item.pluginId);
        if (previous == null || comparePackageVersions(item.version, previous.version) === 1) rows.set(item.pluginId, item);
    }
    return sortPackageCatalog([...rows.values()]);
}

function sortPackageCatalog(packageCatalog) {
    const sortedPackageCatalog = [...packageCatalog];
    if (uiState.packageCatalogSort === 'plugin-id-desc') {
        sortedPackageCatalog.sort((leftItem, rightItem) => {
            return (rightItem.displayName ?? rightItem.pluginId).localeCompare(leftItem.displayName ?? leftItem.pluginId);
        });
        return sortedPackageCatalog;
    }
    if (uiState.packageCatalogSort === 'source-asc') {
        sortedPackageCatalog.sort((leftItem, rightItem) => {
            return leftItem.sourcePath.localeCompare(rightItem.sourcePath) || leftItem.pluginId.localeCompare(rightItem.pluginId);
        });
        return sortedPackageCatalog;
    }
    if (uiState.packageCatalogSort === 'recent-first') {
        sortedPackageCatalog.sort((leftItem, rightItem) => {
            const recentPackagePaths = latestRenderedState?.recentPackagePaths ?? window.pluginManagerPanelUiState?.recentPackagePaths ?? [];
            const leftIndex = recentPackagePaths.indexOf(leftItem.packagePath);
            const rightIndex = recentPackagePaths.indexOf(rightItem.packagePath);
            const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
            const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
            return normalizedLeftIndex - normalizedRightIndex || leftItem.pluginId.localeCompare(rightItem.pluginId);
        });
        return sortedPackageCatalog;
    }
    sortedPackageCatalog.sort((leftItem, rightItem) => {
        return (leftItem.displayName ?? leftItem.pluginId).localeCompare(rightItem.displayName ?? rightItem.pluginId);
    });
    return sortedPackageCatalog;
}

async function resolvePanelBridge() {
    const cocosPanelBridge = createCocosPanelBridge();
    if (cocosPanelBridge != null) {
        return cocosPanelBridge;
    }

    const bridgeFactory = typeof window.acquirePanelBridge === 'function' ? window.acquirePanelBridge : null;
    if (bridgeFactory != null) {
        const bridge = await Promise.resolve(bridgeFactory());
        if (bridge != null) {
            bridge.__bridgeMode = 'host';
            return bridge;
        }
    }

    if (window.panelBridge != null) {
        window.panelBridge.__bridgeMode = 'host';
        return window.panelBridge;
    }

    return createPreviewBridge();
}

function createCocosPanelBridge() {
    const editorApi = window.Editor ?? window.top?.Editor ?? globalThis.Editor;
    if (editorApi?.Message?.request == null) {
        return null;
    }

    const extensionName = window.__PEANUT_COCOS_EXTENSION_NAME__ ?? 'peanut-pod';
    return {
        __bridgeMode: 'host',
        async reloadKernel() {
            return editorApi.Message.request(extensionName, 'reload-kernel-demo');
        },
        async postMessage(envelope) {
            await editorApi.Message.request(extensionName, 'post-panel-bridge', envelope);
        },
        async request(request) {
            return editorApi.Message.request(extensionName, 'request-panel-bridge', request);
        },
    };
}

function createPreviewBridge() {
    let preferences = { locale: 'zh-CN', packageFilter: 'all', packageCatalogSort: 'plugin-id-asc' };
    return {
        __bridgeMode: 'preview',
        async request(request) {
            if (request.event === SNAPSHOT_EVENT) {
                return { requestId: request.id, ok: true, payload: {
                    runtimeRecords: [], failureItems: [], packageCatalog: [], recentPackagePaths: [],
                    kernelReloadSupported: false, preferences,
                } };
            }
            if (request.event === PREFERENCES_UPDATE_EVENT) {
                preferences = { ...preferences, ...request.payload?.preferences };
                return { requestId: request.id, ok: true, payload: { preferences } };
            }
            return { requestId: request.id, ok: false, error: '请在 Creator 中打开面板后执行此操作。' };
        },
    };
}

function summarizePackageAction(payload) {
    const state = latestRenderedState ?? window.pluginManagerPanelUiState;
    if (payload.installResult != null) {
        return t(state, `package.summary.${payload.action}`, {
            pluginId: payload.installResult.pluginId,
            version: payload.installResult.version,
        });
    }
    if (payload.uninstallResult != null) {
        return t(state, 'package.summary.uninstall', {
            pluginId: payload.uninstallResult.pluginId,
        });
    }
    return t(state, 'package.summary.default', {
        action: translateValue(state, payload.action),
    });
}

function resolveSelectedPluginId(preferredPluginId, runtimeRecords, failureItems) {
    if (preferredPluginId != null) {
        const existingRuntimeRecord = runtimeRecords.find((runtimeRecord) => {
            return runtimeRecord.pluginId === preferredPluginId;
        });
        if (existingRuntimeRecord != null) {
            return existingRuntimeRecord.pluginId;
        }
    }
    if (failureItems[0] != null) {
        return failureItems[0].pluginId;
    }
    return runtimeRecords[0]?.pluginId ?? null;
}

function resolveSelectedPackagePath(preferredPackagePath, packageCatalog, selectedPluginId) {
    if (preferredPackagePath != null) {
        const selectedPackageCatalogItem = packageCatalog.find((packageCatalogItem) => {
            return packageCatalogItem.packagePath === preferredPackagePath;
        });
        if (selectedPackageCatalogItem != null) {
            return selectedPackageCatalogItem.packagePath;
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

function resolveSelectedExecutionGroupId(executionDiagnosticsSnapshot, preferredGroupId, priorityFilter, showOnlyExceptionalExecutionGroups) {
    const displayedGroups = getDisplayedExecutionGroups(executionDiagnosticsSnapshot, priorityFilter, showOnlyExceptionalExecutionGroups);
    if (preferredGroupId != null) {
        const selectedGroup = displayedGroups.find((groupSnapshot) => {
            return groupSnapshot.groupId === preferredGroupId;
        });
        if (selectedGroup != null) {
            return selectedGroup.groupId;
        }
    }

    return displayedGroups[0]?.groupId ?? null;
}

function getDisplayedExecutionGroups(executionDiagnosticsSnapshot, priorityFilter, showOnlyExceptionalExecutionGroups) {
    if (executionDiagnosticsSnapshot == null) {
        return [];
    }

    return [...(executionDiagnosticsSnapshot.currentGroups ?? []), ...(executionDiagnosticsSnapshot.recentGroups ?? [])].filter((groupSnapshot) => {
        if (priorityFilter !== 'all' && groupSnapshot.priority !== priorityFilter) {
            return false;
        }
        if (showOnlyExceptionalExecutionGroups === true && !isExceptionalExecutionGroup(groupSnapshot)) {
            return false;
        }
        return true;
    });
}

function isExceptionalExecutionGroup(groupSnapshot) {
    return groupSnapshot.hasTimeout === true
        || groupSnapshot.hasCancellation === true
        || groupSnapshot.hasReplan === true
        || groupSnapshot.status === 'failed';
}

function buildEmptyState(text) {
    return `<div class="empty-state">${escapeHtml(text)}</div>`;
}


function applyError(error) {
    const errorMessage = normalizeErrorMessage(error);
    showPanelToast(errorMessage, 'error');
}

function syncPanelToast(state) {
    const feedbackMessage = state.lastError ?? state.lastActionSummary;
    if (feedbackMessage == null || feedbackMessage === lastToastFeedbackMessage) {
        return;
    }
    lastToastFeedbackMessage = feedbackMessage;
    showPanelToast(normalizeErrorMessage(new Error(feedbackMessage)), state.lastError != null ? 'error' : 'success');
}

function showPanelToast(message, tone) {
    const toastKey = `${tone}:${message}`;
    if (visibleToastKeys.has(toastKey)) {
        return;
    }
    visibleToastKeys.add(toastKey);
    const panelDomRoot = getPanelDomRoot();
    const ownerDocument = panelDomRoot.ownerDocument ?? panelDomRoot;
    let toastRegion = panelDomRoot.querySelector('#pluginManagerToastRegion');
    if (toastRegion == null) {
        toastRegion = ownerDocument.createElement('div');
        toastRegion.id = 'pluginManagerToastRegion';
        toastRegion.className = 'plugin-manager-toast-region';
        (panelDomRoot.body ?? panelDomRoot).appendChild(toastRegion);
    }
    const toast = ownerDocument.createElement('div');
    toast.className = `plugin-manager-toast plugin-manager-toast--${tone}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => {
        toast.remove();
        visibleToastKeys.delete(toastKey);
        if (toastRegion?.childElementCount === 0) {
            toastRegion.remove();
        }
    }, tone === 'pending' ? 1800 : 5000);
}

function normalizeErrorMessage(error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const locale = latestRenderedState?.preferences?.locale ?? 'zh-CN';
    return PANEL_TRANSLATIONS[locale]?.[`error.${errorMessage}`] ?? errorMessage;
}

function buildRequestId(label) {
    return `plugin-manager-panel:${label}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
