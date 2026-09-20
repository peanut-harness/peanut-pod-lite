import assert from 'node:assert/strict';
import { test } from 'node:test';

import { McpApprovalLeaseStore } from '@peanut/pod-engine/policy';
import { createPluginModule } from '../dist/index.js';

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

test('grantedRuntime + services auto-wires EditorMcp gateway and registers 83 tools', async () => {
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
    assert.equal(registered.size, 83);
    assert.equal([...registered].some((name) => name.includes('preview-capture') || name.includes('snowb')), false);
    await plugin.deactivate();
    plugin.dispose();
});

test('gateway mock registers all 83 Lite public tools and never preview.capture or snowb', async () => {
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
    assert.equal(registered.size, 83);
    assert.equal([...registered.values()].some((item) => item.operation === 'preview.capture' || item.operation.includes('snowb')), false);
    assert.equal([...registered.values()].filter((item) => item.readOnly).length, 38);
    assert.equal([...registered.values()].filter((item) => !item.readOnly).length, 45);
    const versionTool = [...registered.entries()].find(([, item]) => item.operation === 'editor.queryVersion');
    assert.notEqual(versionTool, undefined);
    const invocation = { connectionId: 'a'.repeat(32), resourceIds: [] };
    assert.deepEqual(await handlers.get(versionTool![0])!({}, invocation), { operation: 'editor.queryVersion', input: {} });
    assert.equal(executed[0]?.invocation, invocation);
    await plugin.deactivate();
    assert.equal(registered.size, 0);
    plugin.dispose();
});
