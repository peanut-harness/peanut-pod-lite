import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { HostUpdateCoordinator } = require('../src/host-update-coordinator.ts');
const { CpmPackageStore } = require('../src/cpm-package-store.js');

/**
 * @description 最小真实目录包，只在测试 VM 中运行自己的 worker，不执行 SDK 模块。
 */
function host(root: string, version: string, worker: boolean): void {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ package_version: 2, name: 'peanut-pod-lite-host', version,
        main: './dist/bootstrap.js', ...(worker ? { contributions: { 'asset-db': { script: './dist/sdk-startup-timer-worker.js',
            'global-hook': ['beforePreStart'] } } } : {}) }));
    writeFileSync(join(root, 'dist/main.js'), 'module.exports = {};\n');
    writeFileSync(join(root, 'dist/bootstrap.js'), 'module.exports = {};\n');
    if (worker) writeFileSync(join(root, 'dist/sdk-startup-timer-worker.js'), `const events=[]; module.exports={events,
        load(){events.push('load:${version}:'+Editor.marker)}, unload(){events.push('unload:${version}')},
        methods:{beforePreStart(){events.push('before:${version}')}}};\n`);
}

test('old root without a worker upgrades to SDK direct versioned entry and rollback restores the old contribution', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-sdk-worker-upgrade-'));
    const extensionRoot = join(root, 'project/extensions/peanut-pod-lite-host'); const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'candidate'); host(extensionRoot, '0.2.0', false); host(candidateRoot, '0.2.1', true);
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
    const descriptor = { schemaVersion: 1, productId: 'peanut.pod-lite', version: '0.2.1',
        host: { kind: 'host', packageDigest: CpmPackageStore.hostPackageDigest(candidateRoot) } };
    try {
        assert.equal(existsSync(join(extensionRoot, 'dist/sdk-startup-timer-worker.js')), false);
        coordinator.stage(candidateRoot, descriptor); coordinator.applyStagedAtExit();
        const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
        const entry = resolve(extensionRoot, manifest.contributions['asset-db'].script);
        assert.match(entry, /\.peanut-pod-lite-host-versions\/0\.2\.1\/dist\/sdk-startup-timer-worker\.js$/u);
        assert.equal(existsSync(entry), true);
        const module = { exports: {} as { load(): void; unload(): void; events: string[]; methods: { beforePreStart(): void } } };
        runInNewContext(readFileSync(entry, 'utf8'), { module, exports: module.exports, Editor: { marker: 'sdk-sandbox' } });
        module.exports.load(); module.exports.methods.beforePreStart(); module.exports.unload();
        assert.deepEqual([...module.exports.events], ['load:0.2.1:sdk-sandbox', 'before:0.2.1', 'unload:0.2.1']);
        coordinator.rollback(new Error('health failed'));
        assert.equal(JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).contributions, undefined);
        assert.equal(existsSync(join(extensionRoot, 'dist/sdk-startup-timer-worker.js')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new coordinator refuses an indirect or foreign worker contribution before switching the active Host', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-sdk-worker-foreign-'));
    const extensionRoot = join(root, 'project/extensions/peanut-pod-lite-host'); const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'candidate'); host(extensionRoot, '0.2.0', false); host(candidateRoot, '0.2.1', true);
    const manifest = JSON.parse(readFileSync(join(candidateRoot, 'package.json'), 'utf8'));
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
    try {
        for (const script of ['../foreign.js', './dist/sdk-startup-timer-bootstrap.js']) {
            manifest.contributions['asset-db'].script = script; writeFileSync(join(candidateRoot, 'package.json'), JSON.stringify(manifest));
            assert.throws(() => coordinator.stage(candidateRoot, { schemaVersion: 1, productId: 'peanut.pod-lite', version: '0.2.1',
                host: { kind: 'host', packageDigest: CpmPackageStore.hostPackageDigest(candidateRoot) } }), /worker_script_invalid/u);
            assert.equal(JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).version, '0.2.0');
        }
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('same bundled worker loses SDK globals through nested require but installs when SDK evaluates its direct entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-sdk-worker-vm-'));
    const entry = join(root, 'worker.js');
    try {
        buildSync({ entryPoints: [new URL('../src/sdk-startup-timer-worker.ts', import.meta.url).pathname], outfile: entry,
            bundle: true, platform: 'node', format: 'cjs', target: 'node14', legalComments: 'none' });
        const proof = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/editor-stability/components/3.8.7/sdk-startup-timer-source.json', import.meta.url), 'utf8'));
        const manager: Record<string, unknown> = {};
        for (const name of ['_preStartDB', '_startupDB', '_startDB']) manager[name] = runInNewContext(`({${proof.methods[name].source}}).${name}`);
        const metrics: unknown = runInNewContext(`({${proof.methods.trackTimeStart.source}})`);
        const module = { exports: {} as { load(): void; unload(): void; methods: { beforePreStart(): void } } };
        const context = { module, exports: module.exports, require: createRequire(entry), __dirname: dirname(entry), __filename: entry,
            Editor: { App: { version: '3.8.7' }, Metrics: metrics }, Manager: { assetDBManager: manager } };
        assert.equal(Object.hasOwn(globalThis, 'Editor'), false);
        runInNewContext(`module.exports.load=()=>require(${JSON.stringify(entry)}).load();`, context);
        assert.throws(() => module.exports.load(), /worker_version_missing/u);
        const original = manager._preStartDB;
        module.exports = {} as typeof module.exports;
        runInNewContext(readFileSync(entry, 'utf8'), { ...context, exports: module.exports });
        module.exports.load(); const installed = manager._preStartDB;
        assert.notEqual(installed, original); module.exports.methods.beforePreStart(); assert.equal(manager._preStartDB, installed);
        module.exports.unload(); assert.equal(manager._preStartDB, original);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
