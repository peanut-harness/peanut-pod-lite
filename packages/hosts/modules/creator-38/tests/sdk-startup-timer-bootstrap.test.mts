import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { SdkStartupTimerBootstrap } from '../src/sdk-startup-timer-bootstrap.ts';

const require = createRequire(import.meta.url);
const { HostUpdateCoordinator } = require('../src/host-update-coordinator.ts');
const { CpmPackageStore } = require('../src/cpm-package-store.js');

/**
 * @description 最小真实目录包，不执行 SDK 或启动编辑器。
 */
function host(root: string, version: string, worker: boolean): void {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ package_version: 2, name: 'peanut-pod-lite-host', version,
        main: './dist/bootstrap.js', ...(worker ? { contributions: { 'asset-db': { script: './dist/sdk-startup-timer-bootstrap.js',
            'global-hook': ['beforePreStart'] } } } : {}) }));
    writeFileSync(join(root, 'dist/main.js'), 'module.exports = {};\n');
    writeFileSync(join(root, 'dist/bootstrap.js'), 'module.exports = {};\n');
    if (worker) {
        writeFileSync(join(root, 'dist/sdk-startup-timer-bootstrap.js'), 'module.exports = {};\n');
        writeFileSync(join(root, 'dist/sdk-startup-timer-worker.js'), `const events=[]; module.exports={events,
            load(){events.push('load:${version}')}, unload(){events.push('unload:${version}')},
            methods:{beforePreStart(){events.push('before:${version}')}}};\n`);
    }
}

test('old installation without worker upgrades to versioned bootstrap and selects active runtime, then rolls back safely', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-sdk-worker-upgrade-'));
    const extensionRoot = join(root, 'project/extensions/peanut-pod-lite-host'); const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'candidate'); host(extensionRoot, '0.2.0', false); host(candidateRoot, '0.2.1', true);
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
    const descriptor = { schemaVersion: 1, productId: 'peanut.pod-lite', version: '0.2.1',
        host: { kind: 'host', packageDigest: CpmPackageStore.hostPackageDigest(candidateRoot) } };
    try {
        assert.equal(existsSync(join(extensionRoot, 'dist/sdk-startup-timer-bootstrap.js')), false);
        coordinator.stage(candidateRoot, descriptor); coordinator.applyStagedAtExit();
        const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
        const entry = resolve(extensionRoot, manifest.contributions['asset-db'].script);
        assert.match(entry, /\.peanut-pod-lite-host-versions\/0\.2\.1\/dist\/sdk-startup-timer-bootstrap\.js$/u);
        assert.equal(existsSync(entry), true); assert.equal(SdkStartupTimerBootstrap.extensionRoot(dirname(entry)), extensionRoot);
        const bootstrap = SdkStartupTimerBootstrap.create(extensionRoot, projectPath);
        bootstrap.load(); bootstrap.load(); bootstrap.methods?.beforePreStart?.(); bootstrap.unload(); bootstrap.unload();
        const runtime = require(join(dirname(entry), 'sdk-startup-timer-worker.js'));
        assert.deepEqual(runtime.events, ['load:0.2.1', 'before:0.2.1', 'unload:0.2.1']);
        coordinator.rollback(new Error('health failed'));
        assert.equal(JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).contributions, undefined);
        assert.throws(() => SdkStartupTimerBootstrap.create(extensionRoot, projectPath).load(), /worker_runtime_missing/u);
        assert.deepEqual(runtime.events, ['load:0.2.1', 'before:0.2.1', 'unload:0.2.1']);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new worker bootstrap refuses a foreign contribution entry rather than hard-pinning an unaudited script', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-sdk-worker-foreign-'));
    const extensionRoot = join(root, 'project/extensions/peanut-pod-lite-host'); const projectPath = join(root, 'project');
    const candidateRoot = join(root, 'candidate'); host(extensionRoot, '0.2.0', false); host(candidateRoot, '0.2.1', true);
    const manifest = JSON.parse(readFileSync(join(candidateRoot, 'package.json'), 'utf8'));
    manifest.contributions['asset-db'].script = '../foreign.js'; writeFileSync(join(candidateRoot, 'package.json'), JSON.stringify(manifest));
    const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
    try {
        assert.throws(() => coordinator.stage(candidateRoot, { schemaVersion: 1, productId: 'peanut.pod-lite', version: '0.2.1',
            host: { kind: 'host', packageDigest: CpmPackageStore.hostPackageDigest(candidateRoot) } }), /worker_script_invalid/u);
        assert.equal(JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).version, '0.2.0');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
