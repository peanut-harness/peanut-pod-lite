import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HostUpdateCoordinator } = require('../src/host-update-coordinator.ts');
const { createHostBootstrap } = require('../src/host-bootstrap.ts');
const { CpmPackageStore } = require('../src/cpm-package-store.js');

test('Lite Host update stays staged until exit and switches the manifest atomically for restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-update-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'release', 'peanut-pod-lite-host-0.2.1');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeHostPackage(extensionRoot, '0.2.0', 'previous-runtime');
    writeHostPackage(candidateRoot, '0.2.1', 'candidate-runtime');
    const descriptor = createDescriptor(candidateRoot, '0.2.1');
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });

    try {
        assert.equal(coordinator.stage(candidateRoot, descriptor).state, 'staged');
        assert.equal(readManifest(extensionRoot).version, '0.2.0');
        assert.equal(readFileSync(join(extensionRoot, 'dist', 'main.js'), 'utf8'), 'previous-runtime');

        const switched = coordinator.applyStagedAtExit();
        assert.equal(switched.state, 'pending-health-check');
        assert.equal(readManifest(extensionRoot).version, '0.2.1');
        assert.equal(readManifest(extensionRoot).main, './dist/bootstrap.js');
        assert.equal(coordinator.runtimeEntry(), realpathSync(join(root, 'extensions', '.peanut-pod-lite-host-versions', '0.2.1', 'dist', 'main.js')));
        assert.match(readManifest(extensionRoot).panels['plugin-manager'].main, /\.peanut-pod-lite-host-versions\/0\.2\.1/u);

        const active = coordinator.confirmHealthy({
            ready: true,
            artifacts: { host: { version: '0.2.1', packageDigest: descriptor.host.packageDigest } },
        });
        assert.equal(active.state, 'active');
        assert.equal(coordinator.runtimeEntry(), realpathSync(join(root, 'extensions', '.peanut-pod-lite-host-versions', '0.2.1', 'dist', 'main.js')));
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('Lite Host health-check failure restores the prior manifest and runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-rollback-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'release', 'peanut-pod-lite-host-0.2.1');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeHostPackage(extensionRoot, '0.2.0', 'previous-runtime');
    writeHostPackage(candidateRoot, '0.2.1', 'candidate-runtime');
    const descriptor = createDescriptor(candidateRoot, '0.2.1');
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });

    try {
        coordinator.stage(candidateRoot, descriptor);
        coordinator.applyStagedAtExit();
        const status = coordinator.rollback(new Error('creator_host_health_failed'));
        assert.equal(status.state, 'rolled_back');
        assert.equal(status.error, 'creator_host_health_failed');
        assert.equal(readManifest(extensionRoot).version, '0.2.0');
        assert.equal(coordinator.runtimeEntry(), realpathSync(join(extensionRoot, 'dist', 'main.js')));
        assert.equal(readFileSync(join(extensionRoot, 'dist', 'main.js'), 'utf8'), 'previous-runtime');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('invalid Lite Host package digest is rejected without changing the active Host', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-reject-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'release', 'peanut-pod-lite-host-0.2.1');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeHostPackage(extensionRoot, '0.2.0', 'previous-runtime');
    writeHostPackage(candidateRoot, '0.2.1', 'candidate-runtime');
    const descriptor = createDescriptor(candidateRoot, '0.2.1');
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });

    try {
        assert.throws(() => coordinator.stage(candidateRoot, {
            ...descriptor,
            host: { ...descriptor.host, packageDigest: '0'.repeat(64) },
        }), /peanut_host_update_digest_mismatch/u);
        assert.equal(readManifest(extensionRoot).version, '0.2.0');
        assert.equal(coordinator.status().state, 'idle');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('stable Creator bootstrap confirms a healthy Host and restores the previous runtime on failed startup', async () => {
    for (const failCandidate of [false, true]) {
        const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-bootstrap-'));
        const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
        const projectPath = join(root, 'project');
        const candidateRoot = join(root, 'release', 'peanut-pod-lite-host-0.2.1');
        mkdirSync(extensionRoot, { recursive: true });
        mkdirSync(projectPath, { recursive: true });
        writeRuntimePackage(extensionRoot, '0.2.0', false);
        writeRuntimePackage(candidateRoot, '0.2.1', failCandidate);
        const descriptor = createDescriptor(candidateRoot, '0.2.1');
        const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
        coordinator.stage(candidateRoot, descriptor);
        coordinator.applyStagedAtExit();
        const editor = { App: { on() {} } };
        const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => editor, waitForAssetDbReady: async () => {} });

        try {
            await bootstrap.load();
            const health = await bootstrap.methods.queryStatus();
            assert.equal(health.ready, true);
            assert.equal(health.bootstrapExtensionRoot, extensionRoot);
            if (failCandidate) {
                assert.equal(health.artifacts.host.version, '0.2.0');
                assert.equal(coordinator.status().state, 'rolled_back');
                assert.equal(readManifest(extensionRoot).version, '0.2.0');
            } else {
                assert.equal(health.artifacts.host.version, '0.2.1');
                assert.equal(coordinator.status().state, 'active');
                assert.equal(readManifest(extensionRoot).version, '0.2.1');
            }
        } finally {
            await bootstrap.unload();
            rmSync(root, { recursive: true, force: true });
        }
    }
});

test('stable Creator bootstrap delegates the initial package entry to the bundled runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-initial-bootstrap-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeRuntimePackage(extensionRoot, '0.2.0', false);
    const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => ({ App: { on() {} } }), waitForAssetDbReady: async () => {} });

    try {
        await bootstrap.load();
        const health = await bootstrap.methods.queryStatus();
        assert.equal(health.ready, true);
        assert.equal(health.artifacts.host.version, '0.2.0');
        assert.equal(new HostUpdateCoordinator({ extensionRoot, projectPath }).status().state, 'idle');
    } finally {
        await bootstrap.unload();
        rmSync(root, { recursive: true, force: true });
    }
});

test('normal Creator enable yields before runtime initialization and gates Host methods until ready', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-deferred-startup-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeRuntimePackage(extensionRoot, '0.2.0', false, 'await new Promise(resolve => setTimeout(resolve, 40));');
    let releaseAssetDbReady;
    const assetDbReady = new Promise(resolve => { releaseAssetDbReady = resolve; });
    const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => ({ App: { on() {} } }), waitForAssetDbReady: () => assetDbReady });
    let runtimeReady = false;

    try {
        await bootstrap.load();
        const health = bootstrap.methods.queryStatus().then(result => { runtimeReady = true; return result; });
        assert.equal(runtimeReady, false);
        releaseAssetDbReady();
        assert.equal((await health).ready, true);
        assert.equal(runtimeReady, true);
    } finally {
        await bootstrap.unload();
        rmSync(root, { recursive: true, force: true });
    }
});

test('Creator bootstrap waits for the asset-db ready broadcast when query-ready is false', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-asset-db-ready-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeRuntimePackage(extensionRoot, '0.2.0', false);
    const listeners = new Map();
    const editor = {
        App: { on() {} },
        Message: {
            addBroadcastListener(name, callback) { listeners.set(name, callback); },
            removeBroadcastListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
            async request(target, method) {
                assert.equal(target, 'asset-db');
                assert.equal(method, 'query-ready');
                return false;
            },
        },
    };
    const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => editor });

    try {
        await bootstrap.load();
        let settled = false;
        const health = bootstrap.methods.queryStatus().then(result => { settled = true; return result; });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, false);
        assert.equal(typeof listeners.get('asset-db:ready'), 'function');
        listeners.get('asset-db:ready')();
        assert.equal((await health).ready, true);
        assert.equal(listeners.has('asset-db:ready'), false);
    } finally {
        await bootstrap.unload();
        rmSync(root, { recursive: true, force: true });
    }
});

test('Creator bootstrap cancels pending startup when unloaded before asset-db readiness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-asset-db-cancel-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeRuntimePackage(extensionRoot, '0.2.0', false);
    let listenerCount = 0;
    const editor = {
        App: { on() {} },
        Message: {
            addBroadcastListener() { listenerCount += 1; },
            removeBroadcastListener() { listenerCount -= 1; },
            async request() { return false; },
        },
    };
    const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => editor });

    try {
        await bootstrap.load();
        await bootstrap.unload();
        assert.equal(listenerCount, 0);
    } finally {
        await bootstrap.unload();
        rmSync(root, { recursive: true, force: true });
    }
});

test('explicit Host restart switches the staged package immediately before Creator quits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-lite-host-requested-restart-'));
    const extensionRoot = join(root, 'extensions', 'peanut-pod-lite-host');
    const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'release', 'peanut-pod-lite-host-0.2.1');
    mkdirSync(extensionRoot, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeRuntimePackage(extensionRoot, '0.2.0', false);
    writeRuntimePackage(candidateRoot, '0.2.1', false);
    const descriptor = createDescriptor(candidateRoot, '0.2.1');
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
    let quitRequested = false;
    const editor = { App: { on() {}, quit() { quitRequested = true; } } };
    const bootstrap = createHostBootstrap({ extensionRoot, projectPath, getEditor: () => editor, waitForAssetDbReady: async () => {} });

    try {
        await bootstrap.load();
        const staged = await bootstrap.methods.stageLiteHostUpdate(candidateRoot, descriptor);
        assert.equal(staged.state, 'staged');
        assert.equal(readManifest(extensionRoot).version, '0.2.0');

        const restart = await bootstrap.methods.requestLiteHostRestart();
        assert.equal(quitRequested, true);
        assert.equal(restart.state, 'pending-health-check');
        assert.equal(coordinator.status().state, 'pending-health-check');
        assert.equal(readManifest(extensionRoot).version, '0.2.1');
        assert.match(coordinator.runtimeEntry(), /\.peanut-pod-lite-host-versions\/0\.2\.1\/dist\/main\.js/u);
    } finally {
        await bootstrap.unload();
        rmSync(root, { recursive: true, force: true });
    }
});

function writeHostPackage(root, version, mainSource) {
    mkdirSync(join(root, 'dist'), { recursive: true });
    mkdirSync(join(root, 'panel', 'plugin-manager'), { recursive: true });
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({
        package_version: 2,
        name: 'peanut-pod-lite-host',
        version,
        main: './dist/bootstrap.js',
        panels: { 'plugin-manager': { main: 'panel/plugin-manager/index.js' } },
    }, null, 2)}\n`);
    writeFileSync(join(root, 'dist', 'bootstrap.js'), 'module.exports = {};\n');
    writeFileSync(join(root, 'dist', 'main.js'), mainSource);
    writeFileSync(join(root, 'panel', 'plugin-manager', 'index.js'), `// ${version}\n`);
}

function writeRuntimePackage(root, version, failLoad, loadBody = '') {
    writeHostPackage(root, version, '');
    writeFileSync(join(root, 'dist', 'cpm-package-store.js'), readFileSync(new URL('../src/cpm-package-store.js', import.meta.url)));
    writeFileSync(join(root, 'dist', 'main.js'), `
        const path = require('path');
        const { CpmPackageStore } = require('./cpm-package-store');
        let bootstrapExtensionRoot;
        module.exports = {
            async load(options) { bootstrapExtensionRoot = options.extensionRoot; ${loadBody} ${failLoad ? "throw new Error('candidate_load_failed');" : ''} },
            async unload() {},
            methods: {
                queryStatus() {
                    return { ready: true, bootstrapExtensionRoot, artifacts: { host: {
                        version: '${version}',
                        packageDigest: CpmPackageStore.hostPackageDigest(path.join(__dirname, '..')),
                    } } };
                },
            },
        };
    `);
}

function createDescriptor(root, version) {
    return {
        schemaVersion: 1,
        productId: 'peanut.pod-lite',
        version,
        host: { kind: 'host', packageDigest: CpmPackageStore.hostPackageDigest(root) },
    };
}

function readManifest(root) {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
}
