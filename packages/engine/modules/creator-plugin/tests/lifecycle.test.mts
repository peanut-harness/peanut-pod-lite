import assert from 'node:assert/strict';
import { test } from 'node:test';

import { McpApprovalLeaseStore } from '@peanut/pod-engine/policy';
import { createPluginModule } from '../dist/index.js';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { PluginTaskApi, McpFailurePresenter } from '@peanut/pod-engine/kernel';
import { HostResourceFieldPreparation } from '../../../../../packages/hosts/modules/creator-38/src/resource-field-preparation.ts';

test('independently bundled Core public field handler keeps Host-owned preparation DTO across the real task API', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'core-field-bundle-')); const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
    const bundle = join(temporary, 'core.cjs');
    buildSync({ bundle: true, entryPoints: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], format: 'cjs',
        platform: 'node', target: 'es2021', outfile: bundle, legalComments: 'none', external: ['canvas'] });
    cpSync(join(repo, 'packages/engine/modules/lumen/bundled'), join(temporary, 'bundled'), { recursive: true });
    const packed = createRequire(import.meta.url)(bundle) as typeof import('../dist/index.js');
    const variants = ['name', 'friction', 'rollingFriction', 'spinningFriction', 'restitution', 'missing-producer', 'copied-error', 'forged-error',
        'audio', 'audio-copied-error', 'audio-forged-error'];
    try {
        for (const variant of variants) {
            const root = join(temporary, variant); mkdirSync(join(root, 'assets'), { recursive: true });
            const audio = variant.startsWith('audio');
            const readonlyCode = 'lumen_audio_property_not_editable:audio:downloadMode:allowed=';
            const path = audio ? 'assets/one.wav' : 'assets/one.pmtl'; writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version: '3.8.3' } }));
            writeFileSync(join(root, path), audio ? Buffer.from('524946462600000057415645666d74201000000001000100401f0000803e00000200100064617461020000000000', 'hex') : '{"__type__":"cc.PhysicsMaterial","_name":"original","_friction":0.5,"_restitution":0.1}');
            writeFileSync(join(root, path + '.meta'), JSON.stringify({ uuid: '11111111-1111-4111-8111-111111111111', importer: audio ? 'audio-clip' : 'physics-material',
                ver: '1.0.0', imported: true, files: [audio ? '.wav' : '.json'], userData: audio ? { downloadMode: 0 } : {}, subMetas: {} }));
            const runtime = new RuntimeFacade('3.8.3', { allowMemoryPanelWindowProviderFallback: true });
            await runtime.project.configure(root, 'FieldBundle'); const connectionId = 'field-bundle'; let sdkCalls = 0;
            const fixed = new HostResourceFieldPreparation(root, '3.8.3');
            const producer = variant === 'missing-producer' ? null : ['forged-error', 'audio-forged-error'].includes(variant)
                ? { prepare: async () => { throw new Error(audio ? readonlyCode : 'lumen_property_type:friction:number>=0'); } }
                : ['copied-error', 'audio-copied-error'].includes(variant) ? { prepare: async (project: string, input: unknown) => {
                    try { await fixed.prepare(project, input); } catch (error) { throw new Error((error as Error).message); }
                } } : fixed;
            const api = new PluginTaskApi('peanut.editor-mcp', runtime, root,
                () => ({ connectionId, capability: 'peanut.editor-mcp.lumen-asset-set' }), producer);
            let terminal: Awaited<ReturnType<typeof api.managed.wait>> = null;
            const managed = { ...api.managed, wait: async (taskId: string) => { terminal = await api.managed.wait(taskId); return terminal; } };
            const plugin = packed.createPluginModule(); const handlers = new Map<string, (input: Record<string, unknown>, invocation: { connectionId: string }) => Promise<unknown>>();
            const grantedRuntime = { version: runtime.version,
                projectRead: { getProjectPath: async () => root, getProjectName: async () => 'FieldBundle' }, designSources: [], native: {},
                message: { request: async () => { sdkCalls++; throw new Error('field_bundle_unexpected_sdk'); }, send: async () => {}, broadcast: async () => {} } };
            const treeHash = (): string => {
                const hash = createHash('sha256'); const visit = (folder: string): void => { for (const name of readdirSync(folder).sort()) {
                    const file = join(folder, name); if (statSync(file).isDirectory()) visit(file); else hash.update(file.slice(root.length)).update(readFileSync(file));
                } }; visit(root); return hash.digest('hex');
            };
            const before = treeHash();
            try {
                await plugin.activate({ logger: { info: () => {} }, grantedRuntime: grantedRuntime as never, tasks: { managed } as never,
                    services: {} as never, connectionId, mcp: { register: (definition, handler) => {
                        handlers.set(definition.name, handler as never); return () => { handlers.delete(definition.name); };
                    } } });
                const field = audio ? 'downloadMode' : variants.slice(0, 5).includes(variant) ? variant : 'friction';
                const code = audio ? readonlyCode : `lumen_property_type:${field}:${field === 'name' ? 'string' : 'number>=0'}`;
                const lease = plugin.issueApprovalLease({ connectionId, resources: [path, path + '.meta'], operations: ['lumen.assetSet'], maxRisk: 'write' });
                const handler = [...handlers].find(([name]) => name.endsWith('lumen-asset-set'))![1]; let caught: unknown;
                try { await handler({ assetRelativePath: path, props: { [field]: audio ? 1 : field === 'name' ? false : 'invalid' },
                    resources: [path, path + '.meta'], approvalToken: lease.token }, { connectionId }); } catch (error) { caught = error; }
                assert.ok(caught instanceof Error); const dto = McpFailurePresenter.present(caught);
                const task = terminal as unknown as { taskId: string; ok: boolean; status: string; data: Record<string, unknown>; changes: unknown[] };
                assert.equal(task.ok, false); assert.equal(task.status, 'failed'); assert.deepEqual(task.changes, []);
                if (variants.slice(0, 5).includes(variant) || variant === 'audio') {
                    assert.equal(dto.code, code); assert.equal(dto.schemaVersion, 1);
                    assert.equal(dto.retryable, true); assert.equal(dto.recommendedAction, 'fix_input');
                    assert.equal(dto.category, 'invalid_input'); assert.equal(dto.state, 'unchanged');
                    assert.equal(dto.taskId, task.taskId); assert.equal(dto.taskStatus, 'failed'); assert.equal(dto.operation, 'lumen.assetSet');
                    assert.deepEqual(dto.assetFieldPreparationRefusal, { schemaVersion: 1, code, phase: 'prepare_before_writer', projectState: 'unchanged', taskId: task.taskId });
                } else { assert.equal(dto.state, 'unknown'); assert.equal(dto.assetFieldPreparationRefusal, undefined); }
                assert.equal(treeHash(), before); assert.equal(sdkCalls, 0);
            } finally { await plugin.deactivate(); await api.deactivate(); runtime.execution.dispose(); }
        }
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

function createReadRuntime() {
    return {
        version: { getCurrentVersion: () => '3.8.7' },
        project: { getProjectName: async () => 'test', getProjectPath: async () => 'D:/test' },
        selection: { getActiveIds: async () => [] },
        message: { request: async () => ({}) },
    };
}

test('directory module satisfies all host lifecycle phases and releases tool registrations', async () => {
    const plugin = createPluginModule();
    const logger = { info: (_message: string) => {} };
    const registered = new Set<string>();
    const handlers = new Map<string, (input: Readonly<Record<string, unknown>>) => Promise<unknown>>();
    await plugin.register({ logger });
    const context = {
        logger,
        runtime: createReadRuntime(),
        mcp: {
            register: (definition: { name: string }, handler: (input: Readonly<Record<string, unknown>>) => Promise<unknown>) => {
                assert.equal(registered.has(definition.name), false);
                registered.add(definition.name);
                handlers.set(definition.name, handler);
                return () => {
                    registered.delete(definition.name);
                    handlers.delete(definition.name);
                };
            },
        },
    };
    await plugin.activate(context);
    assert.equal(registered.size, 9);
    const versionTool = [...registered].find((name) => name.endsWith('editor-query-version'));
    assert.notEqual(versionTool, undefined);
    const versionHandler = handlers.get(versionTool as string);
    assert.notEqual(versionHandler, undefined);
    const versionResult = await versionHandler!({});
    assert.equal(versionResult, '3.8.7');
    await plugin.activate(context);
    assert.equal(registered.size, 9);
    await plugin.deactivate();
    assert.equal(registered.size, 0);
    plugin.dispose();
});

test('grantedRuntime + services auto-wires EditorMcp gateway and registers 88 tools', async () => {
    const plugin = createPluginModule();
    const logger = { info: (_message: string) => {} };
    const registered = new Set<string>();
    const grantedRuntime = {
        version: {
            getCurrentVersion: () =>
                Object.freeze({ raw: '3.8.7', major: 3, minor: 8, patch: 7, phase: 'editor_api_stable' as const }),
        },
        message: {
            send: async () => {},
            request: async () => ({}),
            broadcast: async () => {},
        },
        assetRead: {
            query: async () => null,
            queryAssets: async () => [],
        },
        assetWrite: {
            writePrefab: async () => ({}),
            writeBinary: async () => ({}),
            refresh: async () => null,
        },
        assetDelete: { deleteAsset: async () => {} },
        scene: {
            getManifestField: () => 'contributions.scene.script' as const,
            getCurrent: async () => null,
            getHierarchy: async () => [],
            execute: async () => null,
        },
        selection: {
            getActiveIds: async () => [],
            setActiveIds: async () => {},
        },
        projectRead: {
            getProjectPath: async () => '/tmp/project',
            getProjectName: async () => 'project',
        },
        designSources: Object.freeze([]),
        native: Object.freeze({}),
    };
    const services = {
        register: () => () => {},
        request: async () => {
            throw new Error('service_unused_in_test');
        },
    };
    await plugin.register({ logger });
    await plugin.activate({
        logger,
        runtime: createReadRuntime(),
        grantedRuntime: grantedRuntime as never,
        services,
        mcp: {
            register: (definition: { name: string }) => {
                registered.add(definition.name);
                return () => registered.delete(definition.name);
            },
        },
    });
    assert.equal(registered.size, 88);
    assert.equal([...registered].some((name) => name.includes('preview-capture') || name.includes('snowb')), false);
    await plugin.deactivate();
    plugin.dispose();
});

test('gateway mock registers all 88 Lite public tools and never preview.capture or snowb', async () => {
    const plugin = createPluginModule();
    const logger = { info: (_message: string) => {} };
    const registered = new Map<string, { operation: string; readOnly: boolean }>();
    const handlers = new Map<
        string,
        (input: Readonly<Record<string, unknown>>, invocation?: { connectionId?: string; resourceIds?: readonly string[] }) => Promise<unknown>
    >();
    const executed: Array<{
        operation: string;
        input: Readonly<Record<string, unknown>>;
        invocation: { connectionId?: string; resourceIds?: readonly string[] } | undefined;
    }> = [];
    await plugin.register({ logger });
    await plugin.activate({
        logger,
        runtime: createReadRuntime(),
        executeOperation: async (operation, input, invocation) => {
            executed.push({ operation, input, invocation });
            return { operation, input };
        },
        approvalLeases: new McpApprovalLeaseStore(),
        connectionId: 'local-a',
        mcp: {
            register: (
                definition: { name: string; operation: string; readOnly: boolean },
                handler: (
                    input: Readonly<Record<string, unknown>>,
                    invocation?: { connectionId?: string; resourceIds?: readonly string[] },
                ) => Promise<unknown>,
            ) => {
                registered.set(definition.name, { operation: definition.operation, readOnly: definition.readOnly });
                handlers.set(definition.name, handler);
                return () => {
                    registered.delete(definition.name);
                    handlers.delete(definition.name);
                };
            },
        },
    });
    assert.equal(registered.size, 88);
    assert.equal([...registered.values()].some((item) => item.operation === 'preview.capture' || item.operation.includes('snowb')), false);
    assert.equal([...registered.values()].filter((item) => item.readOnly).length, 41);
    assert.equal([...registered.values()].filter((item) => !item.readOnly).length, 47);
    const versionTool = [...registered.entries()].find(([, item]) => item.operation === 'editor.queryVersion');
    assert.notEqual(versionTool, undefined);
    const invocation = { connectionId: 'a'.repeat(32), resourceIds: [] };
    assert.deepEqual(await handlers.get(versionTool![0])!({}, invocation), { operation: 'editor.queryVersion', input: {} });
    assert.equal(executed[0]?.invocation, invocation);
    await plugin.deactivate();
    assert.equal(registered.size, 0);
    plugin.dispose();
});
