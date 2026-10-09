import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const source = readFileSync(resolve(import.meta.dirname, '../src/plugin-manager-shell.js'), 'utf8');

function createShell(installer: (product: { productId: string; version: string }) => Promise<unknown>) {
    const calls: string[] = [];
    const manager = {
        inspectPackage: async () => ({ manifest: { id: 'peanut.cocos-mcp-pro' } }),
        getInstalledPackageSnapshot: () => null,
        createPanelBridgeClient: () => ({ request: async (request: { event: string }) => { calls.push(`kernel:${request.event}`); return { ok: true, payload: {} }; } }),
    };
    class PluginPanelActivator {
        methods = {};
        async load() {}
        getEditorEntry() { return { getPluginManager: () => manager }; }
        async unload() {}
    }
    const editor = { Message: { request: async (_extension: string, message: string) => { calls.push(`entitlement:${message}`); } } };
    const module = { exports: {} as Record<string, unknown> };
    const context = vm.createContext({
        module,
        exports: module.exports,
        Editor: editor,
        globalThis: { Editor: editor },
        require: (name: string) => name === '@peanut/pod-hosts' ? { PluginPanelActivator } : require(name),
    });
    vm.runInContext(source, context, { filename: 'plugin-manager-shell.js' });
    return { shell: module.exports as { loadPluginManagerShell(context: object, options: object): Promise<void>; getPluginManagerMethods(): { requestPanelBridge(request: object): Promise<any>; }; unloadPluginManagerShell(): Promise<void> }, calls, installer };
}

test('signed catalog install delegates only product identity to the verified Host installer', async () => {
    let downloadCount = 0;
    const fixture = createShell(async (product) => {
        downloadCount += 1;
        assert.equal(JSON.stringify(product), JSON.stringify({ productId: 'peanut.example', version: '2.0.0' }));
        return { pluginId: product.productId, version: product.version };
    });
    await fixture.shell.loadPluginManagerShell({}, { installTrustedCatalogPackage: fixture.installer });
    const response = await fixture.shell.getPluginManagerMethods().requestPanelBridge({
        id: 'catalog-install', event: 'pluginManager.package.download', expectsResponse: true,
        payload: { productId: 'peanut.example', version: '2.0.0' },
    });
    assert.equal(downloadCount, 1);
    assert.equal(JSON.stringify(response.payload.installed), JSON.stringify({ pluginId: 'peanut.example', version: '2.0.0' }));
    assert.deepEqual(fixture.calls, []);
    await fixture.shell.unloadPluginManagerShell();
});

test('invalid catalog product identity is rejected before invoking the downloader', async () => {
    let downloadCount = 0;
    const fixture = createShell(async () => { downloadCount += 1; return {}; });
    await fixture.shell.loadPluginManagerShell({}, { installTrustedCatalogPackage: fixture.installer });
    await assert.rejects(fixture.shell.getPluginManagerMethods().requestPanelBridge({
        id: 'catalog-install-invalid', event: 'pluginManager.package.download', expectsResponse: true,
        payload: { productId: '../outside', version: '2.0.0' },
    }), /plugin_catalog_product_identity_invalid/u);
    assert.equal(downloadCount, 0);
    await fixture.shell.unloadPluginManagerShell();
});
