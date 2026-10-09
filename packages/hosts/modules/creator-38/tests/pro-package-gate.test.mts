import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, '../src/plugin-manager-shell.js'), 'utf8');

test('Creator panel shell requires a fresh server entitlement before Pro package mutation', async () => {
    const calls = [];
    let entitled = false;
    const manager = {
        inspectPackage: async (packagePath) => ({ manifest: { id: packagePath.endsWith('/pro') ? 'peanut.cocos-mcp-pro' : 'acme.free' } }),
        getInstalledPackageSnapshot: () => null,
        createPanelBridgeClient: () => ({ request: async (request) => { calls.push(`package:${request.event}`); return { ok: true, payload: {} }; } }),
    };
    class PluginPanelActivator {
        constructor() { this.methods = {}; }
        async load() {}
        getEditorEntry() { return { getPluginManager: () => manager }; }
        async unload() {}
    }
    const editor = { Message: { request: async (_extension, message) => {
        calls.push(`account:${message}`);
        if (!entitled) throw new Error('peanut_pro_entitlement_required');
    } } };
    const module = { exports: {} };
    const context = vm.createContext({ module, exports: module.exports, Editor: editor, globalThis: { Editor: editor }, require: (name) => {
        if (name === '@peanut/pod-hosts') return { PluginPanelActivator };
        return require(name);
    } });
    vm.runInContext(source, context, { filename: 'plugin-manager-shell.js' });
    const shell = module.exports;
    await shell.loadPluginManagerShell({}, { installTrustedCatalogPackage: async (product) => {
        calls.push(`trusted:${product.productId}@${product.version}`);
        return { pluginId: product.productId, version: product.version };
    } });
    const methods = shell.getPluginManagerMethods();

    await assert.rejects(methods.requestPanelBridge({ id: 'pro-install-denied', event: 'pluginManager.package.install', expectsResponse: true, payload: { packagePath: '/packages/pro' } }), /peanut_pro_entitlement_required/u);
    assert.deepEqual(calls, ['account:assert-pro-entitlement']);

    for (const event of [
        'pluginManager.package.installAndActivate',
        'pluginManager.package.upgrade',
        'pluginManager.package.upgradeAndActivate',
        'pluginManager.package.switchVersion',
        'pluginManager.package.repair',
    ]) {
        calls.length = 0;
        await assert.rejects(methods.requestPanelBridge({
            id: `pro-denied-${event}`,
            event,
            expectsResponse: true,
            payload: { pluginId: 'peanut.cocos-mcp-pro' },
        }), /peanut_pro_entitlement_required/u);
        assert.deepEqual(calls, ['account:assert-pro-entitlement']);
    }

    calls.length = 0;
    await assert.rejects(methods.requestPanelBridge({
        id: 'pro-catalog-download-denied',
        event: 'pluginManager.package.download',
        expectsResponse: true,
        payload: { productId: 'peanut.cocos-mcp-pro', version: '1.0.0' },
    }), /peanut_pro_entitlement_required/u);
    assert.deepEqual(calls, ['account:assert-pro-entitlement']);

    entitled = true;
    for (const event of [
        'pluginManager.package.install',
        'pluginManager.package.installAndActivate',
        'pluginManager.package.upgrade',
        'pluginManager.package.upgradeAndActivate',
        'pluginManager.package.switchVersion',
        'pluginManager.package.repair',
    ]) {
        calls.length = 0;
        await methods.requestPanelBridge({
            id: `pro-allowed-${event}`,
            event,
            expectsResponse: true,
            payload: { pluginId: 'peanut.cocos-mcp-pro' },
        });
        assert.deepEqual(calls, ['account:assert-pro-entitlement', `package:${event}`]);
    }

    calls.length = 0;
    await methods.requestPanelBridge({ id: 'free-install', event: 'pluginManager.package.install', expectsResponse: true, payload: { packagePath: '/packages/free' } });
    assert.deepEqual(calls, ['package:pluginManager.package.install']);

    calls.length = 0;
    const catalogResponse = await methods.requestPanelBridge({
        id: 'lite-catalog-download',
        event: 'pluginManager.package.download',
        expectsResponse: true,
        payload: { productId: 'peanut.cocos-mcp-lite', version: '1.0.0' },
    });
    assert.deepEqual(calls, ['trusted:peanut.cocos-mcp-lite@1.0.0']);
    assert.equal(JSON.stringify(catalogResponse.payload), JSON.stringify({ accepted: true, installed: { pluginId: 'peanut.cocos-mcp-lite', version: '1.0.0' } }));
    await shell.unloadPluginManagerShell();
});
