import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const host = require('../src/main.js');

test('Lite can sign in and open checkout without granting entitlements or blocking the editor', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'account-upgrade-'));
    const originalFetch = globalThis.fetch;
    let subscriptionStatus = 'none';
    let hasProEntitlements = true;
    let checkoutCalls = 0;
    globalThis.fetch = async (url, init) => {
        const href = String(url);
        if (href.endsWith('/v1/account/subscription') && (init?.method ?? 'GET') === 'GET') {
            return jsonResponse({
                tenantId: 'tenant-a',
                subjectId: 'user-a',
                deviceId: 'device-a',
                status: subscriptionStatus,
                entitlements: subscriptionStatus === 'active' && hasProEntitlements ? [
                    'premium.snowb',
                    'premium.preview-capture',
                    'premium.content-delivery',
                    'premium.sdf-font',
                    'premium.ui-prefab',
                    'premium.asset-version-mover',
                ] : [],
                activeUntil: null,
                productCode: 'peanut.cocos-mcp-pro',
                packageId: 'peanut.cocos-mcp-pro',
            });
        }
        if (href.endsWith('/v1/account/checkout') && init?.method === 'POST') {
            checkoutCalls += 1;
            return jsonResponse({
                checkoutUrl: 'https://pay.example/upgrade?product=peanut.cocos-mcp-pro',
                alreadyEntitled: false,
                productCode: 'peanut.cocos-mcp-pro',
                packageId: 'peanut.cocos-mcp-pro',
            });
        }
        throw new Error(`unexpected_fetch:${href}:${init?.method}`);
    };
    try {
        const core = writePackage(
            projectRoot,
            'peanut.pod-lite',
            '0.1.0',
            "module.exports.createPluginModule=()=>({manifest:{id:'peanut.pod-lite',version:'0.1.0'},activate:async(context)=>{context.mcp.register({name:'core.read'},async()=>({ok:true}))},deactivate:async()=>{}});",
        );
        writeInstalledIndex(projectRoot, [core]);
        globalThis.Editor = createEditor(projectRoot);
        await host.load();
        assert.equal(host.methods.queryStatus().ready, true);
        assert.equal(host.methods.queryStatus().account.recommendedAction, 'sign-in');
        assert.deepEqual(host.methods.queryPremiumOffer().packageId, 'peanut.cocos-mcp-pro');
        await host.methods.setPodEndpoint('https://pod.example/');
        await host.methods.setAccessToken('token-1');
        assert.equal(host.methods.queryStatus().account.state, 'signed_in');
        assert.equal(host.methods.queryStatus().account.recommendedAction, 'upgrade');
        const checkout = await host.methods.startCheckout();
        assert.equal(checkout.checkoutUrl, 'https://pay.example/upgrade?product=peanut.cocos-mcp-pro');
        assert.equal(checkoutCalls, 1);
        assert.equal(host.methods.queryStatus().account.subscription.status, 'none');
        subscriptionStatus = 'active';
        await host.methods.querySubscription();
        assert.equal(host.methods.queryStatus().account.recommendedAction, 'install-pro');
        assert.equal(host.methods.queryStatus().pro.state, 'absent');
        hasProEntitlements = false;
        await assert.rejects(host.methods.refreshPro(), /peanut_pro_entitlement_required/u);
        assert.equal(host.methods.queryStatus().pro.state, 'absent');
        hasProEntitlements = true;
        const pro = writePackage(
            projectRoot,
            'peanut.cocos-mcp-pro',
            '0.1.1',
            "module.exports.createPluginModule=()=>({manifest:{id:'peanut.cocos-mcp-pro',version:'0.1.1'},activate:async(context)=>{const key=await context.protectedKeys.getOrCreateHmacSha256Key('mcp-plan-digest-v1');if(key.extractable)throw new Error('invalid_key');context.services.register('mcp.admit',async()=>true)},deactivate:async()=>{}});",
        );
        writeInstalledIndex(projectRoot, [core, pro]);
        await host.methods.refreshPro();
        assert.equal(host.methods.queryStatus().ready, true);
        assert.equal(host.methods.queryStatus().pro.state, 'active');
        assert.equal(host.methods.queryStatus().account.recommendedAction, 'ready');
        assert.deepEqual(host.methods.queryStatus().tools, ['core.read', 'peanut.editor-mcp.issue-local-approval-lease']);
    } finally {
        globalThis.fetch = originalFetch;
        await host.unload();
        delete globalThis.Editor;
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function writePackage(projectRoot, pluginId, version, bundle) {
    const installPath = join('peanut-plugins', 'plugins', pluginId, version);
    const packagePath = resolve(projectRoot, installPath);
    mkdirSync(join(packagePath, 'libs'), { recursive: true });
    const packageJson = JSON.stringify({ type: 'commonjs' });
    writeFileSync(join(packagePath, `${pluginId}.bundle.js`), bundle);
    writeFileSync(join(packagePath, 'package.json'), packageJson);
    writeFileSync(join(packagePath, 'libs', '.keep'), '');
    const files = [
        { path: `${pluginId}.bundle.js`, digest: digest(bundle) },
        { path: 'libs/.keep', digest: digest('') },
        { path: 'package.json', digest: digest(packageJson) },
    ];
    const manifest = {
        id: pluginId,
        version,
        kind: 'tooling-plugin',
        main: `./${pluginId}.bundle.js`,
        package: {
            schemaVersion: 1,
            digest: digest(
                [...files]
                    .sort((left, right) => left.path.localeCompare(right.path))
                    .map((file) => `${file.path}:${file.digest}`)
                    .join('\n'),
            ),
            files,
        },
    };
    writeFileSync(join(packagePath, `${pluginId}.manifest.json`), JSON.stringify(manifest));
    return { pluginId, activeVersion: version, versions: [{ version, installPath }], packagePath };
}

function writeInstalledIndex(projectRoot, packages) {
    const plugins = packages.map(({ packagePath: _packagePath, ...record }) => record);
    mkdirSync(join(projectRoot, 'peanut-plugins'), { recursive: true });
    writeFileSync(join(projectRoot, 'peanut-plugins', 'installed.json'), JSON.stringify({ schemaVersion: 2, plugins }));
}

function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

function createEditor(projectRoot) {
    const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: (value) => value.toString('utf8').slice('encrypted:'.length),
    };
    return {
        Project: { path: projectRoot, name: 'host-test' },
        App: { version: '3.8.7', safeStorage },
        Selection: { getSelected: () => [] },
        Message: { request: async () => ({}) },
        log: () => {},
        warn: () => {},
        error: () => {},
    };
}
