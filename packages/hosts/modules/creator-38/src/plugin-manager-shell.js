'use strict';

/**
 * Minimal Cocos Plugin Manager shell for Lite host.
 * Uses @peanut/pod-panel and the plugin core without paid host slots or
 * contribution code generation.
 */

const { PluginPanelActivator } = require('@peanut/pod-hosts');

const EXTENSION_NAME = 'peanut-pod-lite-host';
const BUILTIN_PLUGIN_MANAGER_PANEL_ID = 'builtin.plugin-manager.panel';
const POD_PRO_PACKAGE_ID = 'peanut.cocos-mcp-pro';
const PRO_MUTATION_EVENTS = new Set([
    'pluginManager.package.install',
    'pluginManager.package.installAndActivate',
    'pluginManager.package.download',
    'pluginManager.package.upgrade',
    'pluginManager.package.upgradeAndActivate',
    'pluginManager.package.switchVersion',
    'pluginManager.package.repair',
    'pluginManager.storage.reconcile',
]);

let pluginPanelActivator = null;
let creatorContext = null;
let loaded = false;
let installTrustedCatalogPackage = null;

async function ensureLoaded(context, options = {}) {
    if (typeof options.installTrustedCatalogPackage === 'function') {
        installTrustedCatalogPackage = options.installTrustedCatalogPackage;
    }
    if (context != null) {
        creatorContext = context;
    }
    if (!loaded) {
        if (creatorContext == null) {
            throw new Error('creator_context_unavailable');
        }
        pluginPanelActivator = new PluginPanelActivator({
            creatorContext,
            sceneScriptPackageName: EXTENSION_NAME,
            activateInstalledPackages: false,
            repairInstalledPackagesOnStartup: false,
            readTrustedCatalog: options.readTrustedCatalog,
        });
        await pluginPanelActivator.load();
        loaded = true;
    }
}

function requirePluginPanelActivator() {
    if (pluginPanelActivator == null) {
        throw new Error('plugin_panel_activator_unavailable');
    }
    return pluginPanelActivator;
}

function getEditor() {
    return globalThis.Editor;
}

function getPluginManagerPanelBridge(pluginId = BUILTIN_PLUGIN_MANAGER_PANEL_ID, panelId = BUILTIN_PLUGIN_MANAGER_PANEL_ID) {
    const pluginManager = requirePluginPanelActivator().getEditorEntry().getPluginManager();
    if (pluginManager == null) {
        throw new Error('plugin_manager_kernel_unavailable');
    }
    return pluginManager.createPanelBridgeClient(pluginId, panelId);
}

function isRecord(value) {
    return typeof value === 'object' && value != null && !Array.isArray(value);
}

function isPanelBridgeRequest(value) {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.event === 'string' &&
        value.event.length > 0 &&
        typeof value.expectsResponse === 'boolean' &&
        (value.payload == null || isRecord(value.payload))
    );
}

async function pickDirectory() {
    try {
        const electron = require('electron');
        const result = await electron.dialog.showOpenDialog({
            title: 'Select plugin package directory',
            properties: ['openDirectory', 'treatPackageAsDirectory'],
        });
        if (result?.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    } catch {
        return null;
    }
}

async function pickAuthoringDirectory() {
    try {
        const electron = require('electron');
        const result = await electron.dialog.showOpenDialog({
            title: 'Select an empty plugin project directory',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result?.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    } catch {
        return null;
    }
}

async function requireProEntitlement() {
    if (typeof getEditor()?.Message?.request !== 'function') throw new Error('peanut_account_bridge_unavailable');
    await getEditor().Message.request(EXTENSION_NAME, 'assert-pro-entitlement');
}

async function authorizeProMutation(request) {
    if (!PRO_MUTATION_EVENTS.has(request.event)) return;
    if (request.event === 'pluginManager.package.download') {
        if (request.payload?.productId === POD_PRO_PACKAGE_ID || request.payload?.pluginId === POD_PRO_PACKAGE_ID) await requireProEntitlement();
        return;
    }
    if (request.event === 'pluginManager.storage.reconcile') {
        const installedPro = requirePluginPanelActivator().getEditorEntry().getPluginManager().getInstalledPackageSnapshot(POD_PRO_PACKAGE_ID);
        if (installedPro != null) await requireProEntitlement();
        return;
    }
    const pluginId = request.payload?.pluginId ?? request.payload?.productId;
    if (pluginId === POD_PRO_PACKAGE_ID) {
        await requireProEntitlement();
        return;
    }
    const packagePath = request.payload?.packagePath;
    if (typeof packagePath !== 'string' || packagePath.length === 0) return;
    const inspection = await requirePluginPanelActivator().getEditorEntry().getPluginManager().inspectPackage(packagePath);
    if (inspection.manifest?.id === POD_PRO_PACKAGE_ID) await requireProEntitlement();
}

const shellMethods = {
    async openPanel() {
        await ensureLoaded();
        await getEditor()?.Panel?.open?.(`${EXTENSION_NAME}.plugin-manager`);
    },
    async openPluginManagerPanel() {
        await shellMethods.openPanel();
    },
    async openPluginManagerSettingsPanel() {
        await ensureLoaded();
        await getEditor()?.Panel?.open?.(`${EXTENSION_NAME}.plugin-manager-settings`);
    },
    getCurrentLocale() {
        const locale = getEditor()?.I18n?.getLanguage?.();
        return typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    },
    async postPanelBridge(envelope) {
        await ensureLoaded();
        await getPluginManagerPanelBridge().postMessage(envelope);
    },
    async requestPanelBridge(request) {
        await ensureLoaded();
        if (!isPanelBridgeRequest(request)) {
            throw new Error('cocos_panel_bridge_request_invalid');
        }
        if (request.event === 'pluginManager.package.pickDirectory') {
            return {
                requestId: request.id,
                ok: true,
                payload: { packagePath: await pickDirectory() },
            };
        }
        if (request.event === 'pluginManager.authoring.pickDirectory') {
            return {
                requestId: request.id,
                ok: true,
                payload: { targetDirectory: await pickAuthoringDirectory() },
            };
        }
        await authorizeProMutation(request);
        if (request.event === 'pluginManager.package.download') {
            const productId = request.payload?.productId;
            const version = request.payload?.version;
            if (typeof productId !== 'string' || typeof version !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(productId) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
                throw new Error('plugin_catalog_product_identity_invalid');
            }
            if (installTrustedCatalogPackage == null) throw new Error('plugin_catalog_install_unavailable');
            const installed = await installTrustedCatalogPackage({ productId, version });
            return { requestId: request.id, ok: true, payload: { accepted: true, installed } };
        }
        if (request.event === 'pluginManager.kernel.reload') {
            await requirePluginPanelActivator().methods.reloadKernelNow?.();
            return {
                requestId: request.id,
                ok: true,
                payload: { accepted: true },
            };
        }
        return getPluginManagerPanelBridge().request(request);
    },
};

function getPluginManagerKernel() {
    if (!loaded) {
        return null;
    }
    return requirePluginPanelActivator().getEditorEntry().getPluginManager();
}

const editorExtensionMethods = {
    async bindBuiltinPluginManagerPanel(browserWindow) {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.bindBuiltinPluginManagerPanel(browserWindow);
    },
    async openBuiltinPluginManagerPanel() {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.openBuiltinPluginManagerPanel();
    },
    async executePluginCommand(commandId) {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.executePluginCommand(commandId);
    },
    async reloadKernel() {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.reloadKernel();
    },
    async reloadKernelNow() {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.reloadKernelNow();
    },
    async handleChangedPaths(changedPaths) {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.handleChangedPaths(changedPaths);
    },
    watch() {
        return requirePluginPanelActivator().methods.watch();
    },
    unwatch() {
        return requirePluginPanelActivator().methods.unwatch();
    },
    developmentStatus(pluginId) {
        return requirePluginPanelActivator().methods.developmentStatus(pluginId);
    },
    async reconcileDevelopmentPlugins() {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.reconcileDevelopmentPlugins();
    },
    async reloadDevelopmentPlugin(pluginId) {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.reloadDevelopmentPlugin(pluginId);
    },
    developmentTrace() {
        return requirePluginPanelActivator().methods.developmentTrace();
    },
    approveMcpPlan(planId) {
        return requirePluginPanelActivator().methods.approveMcpPlan(planId);
    },
    getMcpHubStatus() {
        return requirePluginPanelActivator().methods.getMcpHubStatus();
    },
    listPendingMcpPlans() {
        return requirePluginPanelActivator().methods.listPendingMcpPlans();
    },
    async setMcpHubEnabled(isEnabled) {
        await ensureLoaded();
        return requirePluginPanelActivator().methods.setMcpHubEnabled(isEnabled);
    },
    rejectMcpPlan(planId) {
        return requirePluginPanelActivator().methods.rejectMcpPlan(planId);
    },
};

module.exports = {
    getPluginManagerKernel,
    EXTENSION_NAME,
    async loadPluginManagerShell(context, options = {}) {
        // Do not activateInstalledPackages here: peanut.pod-lite is loaded by the
        // CPM host path (activateCore). Plugin Manager package activation expects
        // legacy scoped MCP capability names and conflicts with the Lite catalog.
        await ensureLoaded(context, options);
    },
    async unloadPluginManagerShell() {
        if (!loaded) {
            return;
        }
        await requirePluginPanelActivator().unload();
        loaded = false;
        pluginPanelActivator = null;
        creatorContext = null;
        installTrustedCatalogPackage = null;
    },
    getPluginManagerMethods() {
        return {
            ...editorExtensionMethods,
            ...shellMethods,
        };
    },
};
