import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { CpmPackageStore } = require('../src/cpm-package-store.js');
const { createLiteGrantedRuntime } = require('../src/lite-granted-runtime.js');
const { PluginServiceRegistry } = require('../src/plugin-service-registry.js');
const { SystemProtectedKeyStore } = require('../src/system-protected-key-store.js');

test('lite runtime moves unregistered disk orphans aside before creating an asset', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'pod-lite-asset-recovery-'));
    const relativePath = 'assets/generated/BorrowedContent.json';
    const absolutePath = join(projectRoot, relativePath);
    const previousEditor = (globalThis as Record<string, unknown>).Editor;
    let registered = false;
    let failCreate = true;
    mkdirSync(join(projectRoot, 'assets/generated'), { recursive: true });
    writeFileSync(absolutePath, 'stale\n', 'utf8');
    writeFileSync(`${absolutePath}.meta`, '{"uuid":"stale"}\n', 'utf8');
    try {
        (globalThis as Record<string, unknown>).Editor = {
            App: { version: '3.8.7' },
            Project: { path: projectRoot },
            Message: {
                request: async (_target: string, message: string, _dbUrl: string, content?: Uint8Array): Promise<unknown> => {
                    if (message === 'query-asset-info') {
                        return registered ? { uuid: 'registered' } : null;
                    }
                    if (message === 'create-asset') {
                        assert.equal(existsSync(absolutePath), false);
                        assert.equal(existsSync(`${absolutePath}.meta`), false);
                        if (failCreate) {
                            throw new Error('simulated_create_failure');
                        }
                        writeFileSync(absolutePath, content ?? new Uint8Array(), 'utf8');
                        writeFileSync(`${absolutePath}.meta`, '{"uuid":"registered"}\n', 'utf8');
                        registered = true;
                    }
                    return null;
                },
            },
        };
        const runtime = createLiteGrantedRuntime();
        assert.equal(await runtime.assetWrite.refresh(relativePath), null);
        await assert.rejects(
            runtime.assetWrite.writeBinary(relativePath, new TextEncoder().encode('{"ready":true}\n')),
            /simulated_create_failure/,
        );
        assert.equal(readFileSync(absolutePath, 'utf8'), 'stale\n');
        assert.equal(readFileSync(`${absolutePath}.meta`, 'utf8'), '{"uuid":"stale"}\n');
        failCreate = false;
        await runtime.assetWrite.writeBinary(relativePath, new TextEncoder().encode('{"ready":true}\n'));
        assert.equal(readFileSync(absolutePath, 'utf8'), '{"ready":true}\n');
    } finally {
        (globalThis as Record<string, unknown>).Editor = previousEditor;
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('CPM store resolves the indexed package and rejects tampering, extra payloads, and invalid paths', () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'pod-lite-integrity-'));
    try {
        const pluginId = 'peanut.pod-lite';
        const version = '0.1.0';
        const relativeInstallPath = join('peanut-plugins', 'plugins', pluginId, version);
        const packageRoot = resolve(projectRoot, relativeInstallPath);
        mkdirSync(join(packageRoot, 'libs'), { recursive: true });
        const bundle = 'module.exports = {};';
        const packageJson = JSON.stringify({ type: 'commonjs' });
        writeFileSync(join(packageRoot, `${pluginId}.bundle.js`), bundle);
        writeFileSync(join(packageRoot, 'package.json'), packageJson);
        writeFileSync(join(packageRoot, 'libs', '.keep'), '');
        const files = [
            { path: `${pluginId}.bundle.js`, digest: createHash('sha256').update(bundle).digest('hex') },
            { path: 'package.json', digest: createHash('sha256').update(packageJson).digest('hex') },
            { path: 'libs/.keep', digest: createHash('sha256').update('').digest('hex') },
        ];
        const manifest = {
            id: pluginId,
            version,
            kind: 'tooling-plugin',
            main: `./${pluginId}.bundle.js`,
            package: {
                schemaVersion: 1,
                files,
                digest: createHash('sha256')
                    .update([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}:${file.digest}`).join('\n'))
                    .digest('hex'),
            },
        };
        const manifestPath = join(packageRoot, `${pluginId}.manifest.json`);
        writeFileSync(manifestPath, JSON.stringify(manifest));
        mkdirSync(join(projectRoot, 'peanut-plugins'), { recursive: true });
        writeFileSync(
            join(projectRoot, 'peanut-plugins', 'installed.json'),
            JSON.stringify({
                schemaVersion: 2,
                plugins: [{ pluginId, activeVersion: version, versions: [{ version, installPath: relativeInstallPath }] }],
            }),
        );
        const store = new CpmPackageStore(projectRoot);
        assert.equal(store.resolveActivePackage(pluginId, true).manifest.version, version);
        writeFileSync(join(packageRoot, `${pluginId}.bundle.js`), 'tampered');
        assert.throws(() => store.resolveActivePackage(pluginId, true), /integrity_file_mismatch/u);
        writeFileSync(join(packageRoot, `${pluginId}.bundle.js`), bundle);
        writeFileSync(join(packageRoot, 'unchecked.js'), bundle);
        assert.throws(() => store.resolveActivePackage(pluginId, true), /payload_set_mismatch/u);
        rmSync(join(packageRoot, 'unchecked.js'));
        writeFileSync(manifestPath, JSON.stringify({ ...manifest, main: `./nested/../${pluginId}.bundle.js` }));
        assert.throws(() => store.resolveActivePackage(pluginId, true), /manifest_invalid/u);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('plugin services inject caller identity and revoke only the owning provider', async () => {
    const registry = new PluginServiceRegistry();
    const provider = registry.createApi('provider.plugin');
    const consumer = registry.createApi('consumer.plugin');
    const dispose = provider.register('echo', async (callerPluginId: string, request: unknown) => ({ callerPluginId, request }));
    assert.deepEqual(await consumer.request('provider.plugin', 'echo', { value: 1 }), {
        callerPluginId: 'consumer.plugin',
        request: { value: 1 },
    });
    assert.deepEqual(registry.list('provider.plugin'), ['echo']);
    dispose();
    await assert.rejects(consumer.request('provider.plugin', 'echo', {}), /service_unavailable/u);
});

test('system key store persists encrypted material and exposes only a non-extractable HMAC key', async () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'protected-key-'));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'dpapi',
        encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
        decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length),
    };
    try {
        const firstStore = new SystemProtectedKeyStore(projectRoot, 'peanut.cocos-mcp-pro', () => safeStorage);
        const first = await firstStore.getOrCreateHmacSha256Key('mcp-plan-digest-v1');
        assert.equal(first, await firstStore.getOrCreateHmacSha256Key('mcp-plan-digest-v1'));
        assert.equal(first.extractable, false);
        assert.equal(first.algorithm.name, 'HMAC');
        assert.deepEqual(first.usages, ['sign']);
        firstStore.clear();
        const secondStore = new SystemProtectedKeyStore(projectRoot, 'peanut.cocos-mcp-pro', () => safeStorage);
        const second = await secondStore.getOrCreateHmacSha256Key('mcp-plan-digest-v1');
        const payload = new TextEncoder().encode('stable');
        assert.deepEqual(
            Buffer.from(await webcrypto.subtle.sign('HMAC', first, payload)),
            Buffer.from(await webcrypto.subtle.sign('HMAC', second, payload)),
        );
        await assert.rejects(secondStore.getOrCreateHmacSha256Key('../escape'), /purpose_invalid/u);
        const insecureStore = new SystemProtectedKeyStore(projectRoot, 'other.plugin', () => ({
            ...safeStorage,
            getSelectedStorageBackend: () => 'basic_text',
        }));
        await assert.rejects(insecureStore.getOrCreateHmacSha256Key('mcp-plan-digest-v1'), /storage_insecure/u);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});

test('CPM store accepts code-unit ordered package digests and legacy localeCompare digests', () => {
    const temporaryRoot = resolve(import.meta.dirname, '..', '.test-temp');
    mkdirSync(temporaryRoot, { recursive: true });
    const projectRoot = mkdtempSync(join(temporaryRoot, 'pod-lite-digest-order-'));
    try {
        const pluginId = 'peanut.pod-lite';
        const version = '0.2.0';
        const relativeInstallPath = join('peanut-plugins', 'plugins', pluginId, version);
        const packageRoot = resolve(projectRoot, relativeInstallPath);
        const payload: Record<string, string> = {
            [`${pluginId}.bundle.js`]: 'module.exports = {};',
            'package.json': JSON.stringify({ type: 'commonjs' }),
            'libs/.keep': '',
            'bundled/default_prefab/2d.meta': 'meta',
            'bundled/default_prefab_24/2d-camera.prefab': 'camera',
        };
        for (const [path, content] of Object.entries(payload)) {
            mkdirSync(join(packageRoot, ...path.split('/').slice(0, -1)), { recursive: true });
            writeFileSync(join(packageRoot, ...path.split('/')), content);
        }
        const files = Object.entries(payload).map(([path, content]) => ({ path, digest: createHash('sha256').update(content).digest('hex') }));
        const digestFor = (compare: (left: string, right: string) => number): string => createHash('sha256')
            .update([...files].sort((left, right) => compare(left.path, right.path)).map((file) => `${file.path}:${file.digest}`).join('\n'))
            .digest('hex');
        const codeUnit = digestFor((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        const legacy = digestFor((left, right) => left.localeCompare(right));
        assert.notEqual(codeUnit, legacy);
        mkdirSync(join(projectRoot, 'peanut-plugins'), { recursive: true });
        writeFileSync(
            join(projectRoot, 'peanut-plugins', 'installed.json'),
            JSON.stringify({ schemaVersion: 2, plugins: [{ pluginId, activeVersion: version, versions: [{ version, installPath: relativeInstallPath }] }] }),
        );
        const manifestPath = join(packageRoot, `${pluginId}.manifest.json`);
        const store = new CpmPackageStore(projectRoot);
        for (const digest of [codeUnit, legacy]) {
            writeFileSync(manifestPath, JSON.stringify({ id: pluginId, version, kind: 'tooling-plugin', main: `./${pluginId}.bundle.js`, package: { schemaVersion: 1, files, digest } }));
            assert.equal(store.resolveActivePackage(pluginId, true).manifest.version, version);
        }
        writeFileSync(manifestPath, JSON.stringify({ id: pluginId, version, kind: 'tooling-plugin', main: `./${pluginId}.bundle.js`, package: { schemaVersion: 1, files, digest: 'f'.repeat(64) } }));
        assert.throws(() => store.resolveActivePackage(pluginId, true), /integrity_digest_mismatch/u);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});
