import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

import { CocosMcpHub, PluginManagerApp } from '@peanut/pod-engine/kernel';
import { CreatorContextResolver } from '@peanut/pod-hosts';
import { ResourceLockManager, RuntimeFacade } from '@peanut/pod-engine/runtime';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { CoreMcpInputValidator } from '../../../../engine/modules/policy/dist/core-mcp-input-validator.js';
import { EditorMcpActionRouter } from '@peanut/pod-engine/mcp';

/**
 * @description 对 VM 及宿主结果进行实际对象边界检查。
 * @param value 未知返回值。
 * @returns 是否为对象记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value != null && !Array.isArray(value);
}

/**
 * @description 临时 CPM 包的完整摘要来源。
 * @param value 原样内容。
 * @returns SHA-256。
 */
function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

test('actual Creator main, Core dispatcher and factory share Hub revision, prior writers and the same resource locks', async () => {
    const hostRoot = resolve(import.meta.dirname, '..');
    const repoRoot = resolve(hostRoot, '../../../..');
    const tempRoot = join(hostRoot, '.test-temp');
    mkdirSync(tempRoot, { recursive: true });
    const project = mkdtempSync(join(tempRoot, 'text-read-bridge-'));
    const warnings: unknown[] = [];
    const errors: unknown[] = [];
    const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
    await runtime.project.configure(project, 'TextReadBridge');
    const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, project);
    const hub = new CocosMcpHub(() => manager, { projectPath: project });
    manager.setMcpHubControl(hub);
    const connection = { connectionId: 'a'.repeat(32) };
    const sourcePath = join(hostRoot, 'src/main.js');
    const sourceRequire = createRequire(sourcePath);
    const moduleBox: { exports: unknown } = { exports: {} };
    const editor = {
        Project: { path: project, name: 'TextReadBridge' },
        App: { version: '3.8.7', safeStorage: {
            isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'dpapi',
            encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
            decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
        } },
        Selection: { getSelected: () => [], select: () => {} },
        Message: { request: async () => ({}) },
        log: () => {}, warn: (...values: unknown[]) => warnings.push(values), error: (...values: unknown[]) => errors.push(values),
    };
    Reflect.set(globalThis, 'Editor', editor);
    runInNewContext(readFileSync(sourcePath, 'utf8'), {
        require: (name: string): unknown => name === '@peanut/pod-hosts' ? { CreatorContextResolver } : name === './plugin-manager-shell' ? {
            getPluginManagerKernel: () => manager, getPluginManagerMethods: () => ({}),
            loadPluginManagerShell: async () => {}, unloadPluginManagerShell: async () => {},
        } : sourceRequire(name),
        module: moduleBox, exports: moduleBox.exports, __dirname: join(hostRoot, 'src'), __filename: sourcePath,
        globalThis, process, Buffer, console, setTimeout, clearTimeout,
    }, { filename: sourcePath });
    const host = moduleBox.exports;
    assert.ok(isRecord(host));
    const load: unknown = host.load;
    const unload: unknown = host.unload;
    assert.equal(typeof load, 'function');
    assert.equal(typeof unload, 'function');
    const methods = host.methods;
    assert.ok(isRecord(methods));
    const invoke: unknown = methods.invokeTool;
    assert.equal(typeof invoke, 'function');
    if (typeof load !== 'function' || typeof unload !== 'function' || typeof invoke !== 'function') {
        throw new Error('actual_host_exports_invalid');
    }
    const originalLock = ResourceLockManager.prototype.acquireSet;
    const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
    const lockCalls: Array<{ manager: ResourceLockManager; projectKey: string; writer: boolean }> = [];
    let releaseWriter: () => void = () => {};
    let enteredWriter: () => void = () => {};
    const writerGate = new Promise<void>((resolveGate) => { releaseWriter = resolveGate; });
    const writerEntered = new Promise<void>((resolveGate) => { enteredWriter = resolveGate; });
    ResourceLockManager.prototype.acquireSet = function (request, options) {
        lockCalls.push({ manager: this, projectKey: request.projectKey, writer: request.requiresProjectWriter });
        return originalLock.call(this, request, options);
    };
    EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
        enteredWriter();
        await writerGate;
        return originalWorker.apply(this, args);
    };
    try {
        mkdirSync(join(project, 'assets'));
        mkdirSync(join(project, 'temp/logs'), { recursive: true });
        writeFileSync(join(project, 'temp/logs/project.log'), '');
        writeFileSync(join(project, 'package.json'), JSON.stringify({ creator: { version: '3.8.7' } }));
        writeFileSync(join(project, 'assets/a.ts'), '\uFEFF雪\r\n');
        const coreSource = pathToFileURL(join(repoRoot, 'packages/engine/modules/creator-plugin/dist/index.js')).href;
        const bundle = `exports.createPluginModule = () => {
            let core;
            return {
                manifest: { id: 'peanut.pod-lite', version: '0.2.0' },
                register: async (context) => { core = (await import(${JSON.stringify(coreSource)})).createPluginModule(); await core.register(context); },
                activate: async (context) => core.activate(context),
                issueApprovalLease: (request) => core.issueApprovalLease(request),
                deactivate: async () => core?.deactivate()
            };
        };`;
        const pluginId = 'peanut.pod-lite';
        const installPath = `peanut-plugins/plugins/${pluginId}/0.2.0`;
        const packagePath = join(project, installPath);
        mkdirSync(join(packagePath, 'libs'), { recursive: true });
        const packageJson = JSON.stringify({ type: 'commonjs' });
        writeFileSync(join(packagePath, `${pluginId}.bundle.js`), bundle);
        writeFileSync(join(packagePath, 'package.json'), packageJson);
        writeFileSync(join(packagePath, 'libs/.keep'), '');
        const files = [
            { path: `${pluginId}.bundle.js`, digest: digest(bundle) },
            { path: 'package.json', digest: digest(packageJson) }, { path: 'libs/.keep', digest: digest('') },
        ];
        writeFileSync(join(packagePath, `${pluginId}.manifest.json`), JSON.stringify({
            id: pluginId, version: '0.2.0', kind: 'tooling-plugin', main: `./${pluginId}.bundle.js`,
            package: { schemaVersion: 1, files,
                digest: digest([...files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => `${file.path}:${file.digest}`).join('\n')) },
        }));
        writeFileSync(join(project, 'peanut-plugins/installed.json'), JSON.stringify({ schemaVersion: 2,
            plugins: [{ pluginId, activeVersion: '0.2.0', versions: [{ version: '0.2.0', installPath }] }] }));
        await load();
        const first: unknown = await invoke('peanut.editor-mcp.asset-read-text', { paths: ['assets/a.ts', 'assets/missing.ts'] }, connection);
        assert.ok(new CoreMcpInputValidator().validate(CoreTextFileIoContract.readOutputSchema(), first));
        assert.ok(isRecord(first));
        assert.equal(first.revision, hub.getProjectRevisionSnapshot().revision);
        assert.equal(first.revision, 0);
        assert.equal(first.ok, false);
        assert.equal(first.consistent, true);
        await assert.rejects(() => invoke('peanut.editor-mcp.editor-set-selection', { clear: true }, connection), /approval_required/);
        const lease: unknown = await invoke('peanut.editor-mcp.issue-local-approval-lease', {
            resources: ['editor'], operations: ['editor.setSelection'],
        }, connection);
        assert.ok(isRecord(lease));
        const write: unknown = await invoke('peanut.editor-mcp.editor-set-selection', {
            clear: true, approvalId: lease.token, execution: { mode: 'async' },
        }, connection);
        assert.ok(isRecord(write));
        assert.equal(write.taskStatus, 'queued');
        await writerEntered;
        const duringWrite = hub.getProjectRevisionSnapshot().revision;
        let readFinished = false;
        const reading = Promise.resolve(invoke('peanut.editor-mcp.asset-read-text', { path: 'assets/a.ts' }, connection))
            .then((result: unknown) => { readFinished = true; return result; });
        await new Promise<void>((resolveTick) => setImmediate(resolveTick));
        assert.equal(readFinished, false, 'Creator read must wait for admitted asynchronous writer');
        releaseWriter();
        const after: unknown = await reading;
        assert.ok(isRecord(after));
        assert.equal(after.ok, true);
        assert.equal(after.revision, hub.getProjectRevisionSnapshot().revision);
        assert.ok(typeof after.revision === 'number' && after.revision > duringWrite);
        const writerLock = lockCalls.find((call) => call.writer);
        const readerLocks = lockCalls.filter((call) => !call.writer);
        assert.ok(writerLock);
        assert.ok(readerLocks.length >= 2);
        for (const readerLock of readerLocks) {
            assert.equal(readerLock.manager, writerLock.manager, 'factory must not create a second writer lock manager');
            assert.equal(readerLock.projectKey, realpathSync(project));
        }
        assert.deepEqual(warnings, []);
        assert.deepEqual(errors, []);
    } finally {
        releaseWriter();
        await unload();
        await hub.stop();
        ResourceLockManager.prototype.acquireSet = originalLock;
        EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
        Reflect.deleteProperty(globalThis, 'Editor');
        rmSync(project, { recursive: true, force: true });
    }
});
