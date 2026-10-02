import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CocosMcpHub, PluginManagerApp } from '@peanut/pod-engine/kernel';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { McpTaskControl } from '../../kernel/dist/mcp/mcp-task-control.js';

import { createPluginModule, EditorMcpActionRouter } from '../dist/index.js';

test('Editor MCP plugin should expose 84 Lite operations without a Pro plugin', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-editor-mcp-managed-host-'));
    mkdirSync(join(projectPath, 'temp', 'logs'), { recursive: true });
    writeFileSync(join(projectPath, 'temp', 'logs', 'project.log'), '', 'utf8');
    const runtimeFacade = new RuntimeFacade('3.8.7', {
        allowMemoryPanelWindowProviderFallback: true,
    });
    await runtimeFacade.project.configure(projectPath, 'Editor MCP Project');
    await runtimeFacade.selection.setActiveIds(['editor-mcp-selected-node']);

    const pluginManagerApp = new PluginManagerApp(runtimeFacade, undefined, undefined, undefined, projectPath);
    const pluginModule = createPluginModule();
    pluginManagerApp.registerManifest({
        manifest: pluginModule.manifest,
        installPath: 'plugins/peanut.editor-mcp',
        trustLevel: 'builtin',
    });
    pluginManagerApp.attachModule(pluginModule.manifest.id, pluginModule);
    await pluginManagerApp.activatePlugin(pluginModule.manifest.id);

    const mcpCapabilityRegistry = pluginManagerApp.getMcpCapabilityRegistry();
    const readOnlyCatalog = mcpCapabilityRegistry.getCatalog().capabilities;
    const readOnlyNames = readOnlyCatalog.map((capability) => capability.name);
    assert.equal(readOnlyCatalog.every((capability) => capability.readOnly === true), true);
    assert.equal(readOnlyNames.includes('peanut.editor-mcp.editor-query-version'), true);
    assert.equal(readOnlyNames.includes('peanut.editor-mcp.lumen-inspect'), true);
    assert.equal(readOnlyNames.includes('peanut.editor-mcp.asset-import-plan'), true);
    assert.equal(readOnlyNames.includes('peanut.editor-mcp.asset-import'), false);

    mcpCapabilityRegistry.setPluginExposure(pluginModule.manifest.id, 'all');
    const fullNames = mcpCapabilityRegistry.getCatalog().capabilities.map((capability) => capability.name);
    assert.equal(fullNames.length, 84);
    assert.equal(fullNames.includes('peanut.editor-mcp.asset-import'), true);
    assert.equal(fullNames.includes('peanut.editor-mcp.lumen-comp-set'), true);
    assert.equal(fullNames.includes('peanut.editor-mcp.lumen-node-rm'), true);
    assert.equal(fullNames.includes('peanut.editor-mcp.preview-capture'), false);
    assert.equal(fullNames.some((name) => name.includes('snowb')), false);
    assert.equal(new Set(fullNames).size, fullNames.length);

    const projectResult = await pluginModule.dispatchMcpAction('cocos.call', {
        operation: 'editor.queryProject',
    });
    const selectionResult = await pluginModule.dispatchMcpAction('editor-mcp.execute', {
        operation: 'editor.querySelection',
    });

    assert.equal(projectResult.data.name, 'Editor MCP Project');
    assert.equal(projectResult.data.path, projectPath);
    assert.deepEqual(selectionResult.data, {
        ids: ['editor-mcp-selected-node'],
        items: [{ id: 'editor-mcp-selected-node' }],
        count: 1,
    });

    const connectionId = 'a'.repeat(32);
    const managedDefinitions = mcpCapabilityRegistry.getCatalog().capabilities.filter((definition) => definition.executionModel === 'managed_task');
    assert.equal(managedDefinitions.length, 45);
    const selectionTool = 'peanut.editor-mcp.editor-set-selection';
    const synchronous = await mcpCapabilityRegistry.invoke(selectionTool, { clear: true }, { connectionId });
    assert.equal(synchronous.taskStatus, 'succeeded');
    assert.equal(synchronous.postflight.verified, true);
    const asynchronous = await mcpCapabilityRegistry.invoke(selectionTool, {
        clear: true,
        execution: { mode: 'async', idempotencyKey: 'selection-clear' },
    }, { connectionId });
    assert.equal(asynchronous.taskStatus, 'queued');
    const reused = await mcpCapabilityRegistry.invoke(selectionTool, {
        clear: true,
        execution: { mode: 'async', idempotencyKey: 'selection-clear' },
    }, { connectionId });
    assert.equal(reused.taskId, asynchronous.taskId);
    await assert.rejects(
        mcpCapabilityRegistry.invoke(selectionTool, {
            ids: ['different-node'],
            execution: { mode: 'async', idempotencyKey: 'selection-clear' },
        }, { connectionId }),
        /task_idempotency_conflict/u,
    );

    await pluginManagerApp.deactivatePlugin(pluginModule.manifest.id, 'manual_disable');
    assert.equal(pluginManagerApp.getMcpCapabilityRegistry().getCatalog().capabilities.length, 0);
    await assert.rejects(async () => pluginModule.dispatchMcpAction('cocos.capabilities'), /editor_mcp_not_active/);
    rmSync(projectPath, { recursive: true, force: true });
});

for (const method of ['attachCapability', 'getStatus']) {
    for (const outcome of ['succeeded', 'failed', 'cancelled']) {
        for (const confirmation of ['confirmed', 'unavailable', 'throws']) {
            test(`actual Hub already-terminal reuse: ${method}, ${outcome}, ${confirmation}`, { timeout: 10000 }, async () => {
                const projectPath = mkdtempSync(join(tmpdir(), 'peanut-terminal-reuse-'));
                mkdirSync(join(projectPath, 'assets'));
                mkdirSync(join(projectPath, 'temp/logs'), { recursive: true });
                writeFileSync(join(projectPath, 'assets/a.txt'), 'current');
                writeFileSync(join(projectPath, 'temp/logs/project.log'), '');
                const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
                await runtime.project.configure(projectPath, 'TerminalReuseFixture');
                const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
                const hub = new CocosMcpHub(() => manager, { projectPath });
                const plugin = createPluginModule();
                const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
                const originalPlan = EditorMcpActionRouter.prototype.planManagedResourceOperation;
                const originalAuthoritativeStatus = runtime.execution.getOwnedStatus;
                let restoreControl = () => {};
                let executions = 0;
                let release;
                let enter;
                const gate = new Promise((resolve) => { release = resolve; });
                const entered = new Promise((resolve) => { enter = resolve; });
                let reading;
                let managed;
                let taskId;
                EditorMcpActionRouter.prototype.planManagedResourceOperation = async function (...args) {
                    if (outcome === 'cancelled') { enter(); await gate; }
                    return originalPlan.apply(this, args);
                };
                EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
                    executions += 1;
                    if (outcome === 'failed') { throw new Error('owned_reused_worker_failure'); }
                    return originalWorker.apply(this, args);
                };
                try {
                    manager.registerManifest({ manifest: plugin.manifest, installPath: 'plugins/peanut.editor-mcp', trustLevel: 'builtin' });
                    manager.attachModule(plugin.manifest.id, plugin);
                    await manager.activatePlugin(plugin.manifest.id);
                    const invocation = { connectionId: 'a'.repeat(32) };
                    const name = 'peanut.editor-mcp.editor-set-selection';
                    const input = { clear: true, execution: { mode: 'async', idempotencyKey: 'owned-terminal-reuse' } };
                    const control = manager.getMcpTaskControl();
                    managed = manager.getManagedTaskApi(plugin.manifest.id);
                    assert.ok(managed);
                    const first = await hub.invokeFromHost(name, input, invocation);
                    taskId = first.taskId;
                    if (outcome === 'cancelled') {
                        await entered;
                        assert.equal((await control.cancel(taskId, invocation.connectionId)).cancelled, true);
                        release();
                    }
                    await managed.wait(taskId);
                    assert.equal((await control.getStatus(taskId, invocation.connectionId)).status, outcome);
                    const owner = { pluginId: plugin.manifest.id, projectKey: projectPath,
                        connectionId: invocation.connectionId, capability: name };
                    const confirming = new McpTaskControl(runtime.execution, () => owner);
                    try {
                        assert.equal(await confirming.getStatus(taskId, invocation.connectionId), null);
                        assert.equal(await confirming.confirmTerminalForInvocation(taskId, name, invocation.connectionId), true);
                        assert.equal(await confirming.getStatus(taskId, invocation.connectionId), null,
                            'terminal confirmation must not create a public task binding');
                    } finally { confirming.dispose(); }
                    for (const key of ['pluginId', 'projectKey', 'connectionId', 'capability']) {
                        const wrongOwner = new McpTaskControl(runtime.execution, () => ({ ...owner, [key]: 'different-owner' }));
                        try {
                            assert.equal(await wrongOwner.confirmTerminalForInvocation(taskId, name, invocation.connectionId), false,
                                `the real Runtime rejects mismatched ${key}`);
                            assert.equal(await wrongOwner.getStatus(taskId, invocation.connectionId), null);
                        } finally { wrongOwner.dispose(); }
                    }
                    assert.equal(await control.confirmTerminalForInvocation(taskId, name, 'b'.repeat(32)), false);
                    assert.equal(await control.confirmTerminalForInvocation(taskId, 'unregistered-capability', invocation.connectionId), false);
                    const before = hub.getProjectRevisionSnapshot().revision;
                    let confirmations = 0;
                    runtime.execution.getOwnedStatus = async (...args) => {
                        confirmations += 1;
                        if (confirmation === 'unavailable') { return null; }
                        if (confirmation === 'throws') { throw new Error('owned_authoritative_readback_failure'); }
                        return originalAuthoritativeStatus.apply(runtime.execution, args);
                    };
                    const original = control[method];
                    restoreControl = () => { control[method] = original; };
                    control[method] = () => { throw new Error('owned_reused_observation_failure'); };
                    await Promise.all(Array.from({ length: 32 }, () => assert.rejects(
                        hub.invokeFromHost(name, input, invocation), /owned_reused_observation_failure/)));
                    assert.equal(confirmations, 32, 'one bounded authoritative read per failed observation, with no polling');
                    runtime.execution.getOwnedStatus = originalAuthoritativeStatus;
                    restoreControl();
                    assert.equal((await control.getStatus(taskId, invocation.connectionId)).status, outcome);
                    assert.equal(executions, outcome === 'cancelled' ? 0 : 1, 'task reuse never executes another worker');
                    let readFinished = false;
                    reading = hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation)
                        .then((value) => { readFinished = true; return value; });
                    if (confirmation === 'confirmed') {
                        const result = await reading;
                        assert.equal(result.ok, true);
                        assert.equal(result.consistent, true);
                        assert.equal(result.files[0].content, 'current');
                        assert.equal(result.revision, before + 64);
                        assert.equal(hub.getProjectRevisionSnapshot().revision, before + 64);
                    } else {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        assert.equal(readFinished, false, 'unavailable authoritative proof cannot release an unknown writer');
                        assert.equal(hub.getProjectRevisionSnapshot().revision, before + 32);
                        await hub.stop();
                        assert.equal((await reading).ok, true);
                        assert.equal(hub.getProjectRevisionSnapshot().revision, before + 64);
                    }
                    await hub.stop();
                    assert.equal(hub.getProjectRevisionSnapshot().revision, before + 64, 'stop cannot double settle a confirmed lease');
                } finally {
                    restoreControl();
                    runtime.execution.getOwnedStatus = originalAuthoritativeStatus;
                    release();
                    if (managed && taskId) { await managed.wait(taskId); }
                    await hub.stop();
                    if (reading) { await reading; }
                    await manager.deactivatePlugin(plugin.manifest.id, 'manual_disable');
                    EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
                    EditorMcpActionRouter.prototype.planManagedResourceOperation = originalPlan;
                    rmSync(projectPath, { recursive: true, force: true });
                }
            });
        }
    }
}

for (const method of ['attachCapability', 'getStatus']) {
    for (const calls of [1, 32]) {
        for (const outcome of ['succeeded', 'failed', 'cancelled', 'stop', 'late-receipt']) {
            test(`actual Hub first/all observation failure: ${method}, ${calls} calls, ${outcome}`, async () => {
                const projectPath = mkdtempSync(join(tmpdir(), 'peanut-writer-observation-'));
                mkdirSync(join(projectPath, 'assets'));
                mkdirSync(join(projectPath, 'temp/logs'), { recursive: true });
                writeFileSync(join(projectPath, 'temp/logs/project.log'), '');
                writeFileSync(join(projectPath, 'assets/a.txt'), 'current');
                const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
                await runtime.project.configure(projectPath, 'WriterObservationFixture');
                const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
                const hub = new CocosMcpHub(() => manager, { projectPath });
                const plugin = createPluginModule();
                const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
                const originalPlan = EditorMcpActionRouter.prototype.planManagedResourceOperation;
                let release;
                let enter;
                const gate = new Promise((resolve) => { release = resolve; });
                const entered = new Promise((resolve) => { enter = resolve; });
                let executions = 0;
                let preparations = 0;
                let restoreControl = () => {};
                let restoreEnqueue = () => {};
                let taskId;
                let managed;
                let reading;
                EditorMcpActionRouter.prototype.planManagedResourceOperation = async function (...args) {
                    preparations += 1;
                    if (outcome === 'cancelled') { enter(); await gate; }
                    return originalPlan.apply(this, args);
                };
                EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
                    executions += 1;
                    enter();
                    await gate;
                    if (outcome === 'failed') { throw new Error('owned_observation_worker_failure'); }
                    return originalWorker.apply(this, args);
                };
                try {
                    manager.registerManifest({ manifest: plugin.manifest, installPath: 'plugins/peanut.editor-mcp', trustLevel: 'builtin' });
                    manager.attachModule(plugin.manifest.id, plugin);
                    await manager.activatePlugin(plugin.manifest.id);
                    const invocation = { connectionId: 'a'.repeat(32) };
                    const control = manager.getMcpTaskControl();
                    managed = manager.getManagedTaskApi(plugin.manifest.id);
                    assert.ok(managed);
                    const enqueue = managed.enqueue;
                    restoreEnqueue = () => { managed.enqueue = enqueue; };
                    managed.enqueue = async (...args) => {
                        const receipt = await enqueue(...args);
                        if (taskId != null) { assert.equal(receipt.taskId, taskId); }
                        taskId = receipt.taskId;
                        if (outcome === 'late-receipt') { await managed.wait(taskId); }
                        return receipt;
                    };
                    const original = control[method];
                    restoreControl = () => { control[method] = original; };
                    control[method] = () => { throw new Error('owned_observation_failure'); };
                    const before = hub.getProjectRevisionSnapshot().revision;
                    const rejecting = Promise.all(Array.from({ length: calls }, () => assert.rejects(
                        hub.invokeFromHost('peanut.editor-mcp.editor-set-selection', {
                            clear: true, execution: { mode: 'async', idempotencyKey: 'owned-all-observation-failure' },
                        }, invocation), /owned_observation_failure/)));
                    await entered;
                    if (outcome === 'late-receipt') { release(); }
                    await rejecting;
                    restoreControl();
                    assert.ok(taskId);
                    if (method === 'attachCapability') {
                        assert.equal(await control.getStatus(taskId, invocation.connectionId), null,
                            'failed attachment must not invent a public task owner');
                        control.attachCapability(taskId, 'peanut.editor-mcp.editor-set-selection', invocation.connectionId);
                    }
                    assert.equal(await control.getStatus(taskId, 'b'.repeat(32)), null,
                        'observation failures preserve the existing connection owner boundary');
                    const status = await control.getStatus(taskId, invocation.connectionId);
                    if (outcome === 'late-receipt') {
                        assert.equal(status.status, 'succeeded');
                        assert.equal(hub.getProjectRevisionSnapshot().revision, before + calls * 2,
                            'trusted terminal preceding delayed queued receipts settles every admitted lease');
                    } else {
                        assert.equal(['succeeded', 'failed', 'cancelled'].includes(status.status), false);
                        let readFinished = false;
                        reading = hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation)
                            .then((value) => { readFinished = true; return value; });
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        assert.equal(readFinished, false, 'a real reader cannot report consistency while the actual worker is held');
                        assert.equal(hub.getProjectRevisionSnapshot().revision, before + calls,
                            'observation errors cannot finish a live task admission');
                        if (outcome === 'cancelled') {
                            assert.equal((await control.cancel(taskId, invocation.connectionId)).cancelled, true);
                        } else if (outcome === 'stop') {
                            await hub.stop();
                        }
                        release();
                        await managed.wait(taskId);
                        const terminal = await control.getStatus(taskId, invocation.connectionId);
                        assert.equal(terminal.status, outcome === 'stop' ? 'succeeded' : outcome);
                        assert.equal((await reading).ok, true);
                    }
                    assert.equal(executions, outcome === 'cancelled' ? 0 : 1);
                    assert.equal(preparations, 1, 'reused calls preserve the real task owner and planner');
                    assert.equal(hub.getProjectRevisionSnapshot().revision, before + calls * 2);
                    const result = await hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation);
                    assert.equal(result.ok, true);
                    assert.equal(result.consistent, true);
                    assert.equal(result.files[0].content, 'current');
                    assert.equal(result.revision, hub.getProjectRevisionSnapshot().revision);
                } finally {
                    restoreControl();
                    restoreEnqueue();
                    release();
                    if (managed && taskId) { await managed.wait(taskId); }
                    if (reading) { await reading; }
                    await manager.deactivatePlugin(plugin.manifest.id, 'manual_disable');
                    await hub.stop();
                    EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
                    EditorMcpActionRouter.prototype.planManagedResourceOperation = originalPlan;
                    rmSync(projectPath, { recursive: true, force: true });
                }
            });
        }
    }
}

test('actual Hub subscription failure before task creation retracts only its admission', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-writer-subscription-'));
    mkdirSync(join(projectPath, 'assets'));
    writeFileSync(join(projectPath, 'assets/a.txt'), 'current');
    const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
    await runtime.project.configure(projectPath, 'WriterSubscriptionFixture');
    const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
    const hub = new CocosMcpHub(() => manager, { projectPath });
    const plugin = createPluginModule();
    const originalSubscription = manager.onTaskTerminal;
    const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
    let executions = 0;
    EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
        executions += 1;
        return originalWorker.apply(this, args);
    };
    try {
        manager.registerManifest({ manifest: plugin.manifest, installPath: 'plugins/peanut.editor-mcp', trustLevel: 'builtin' });
        manager.attachModule(plugin.manifest.id, plugin);
        await manager.activatePlugin(plugin.manifest.id);
        manager.onTaskTerminal = () => { throw new Error('owned_subscription_failure'); };
        const invocation = { connectionId: 'a'.repeat(32) };
        const before = hub.getProjectRevisionSnapshot().revision;
        await assert.rejects(hub.invokeFromHost('peanut.editor-mcp.editor-set-selection', {
            clear: true, execution: { mode: 'async' },
        }, invocation), /owned_subscription_failure/);
        assert.equal(executions, 0);
        assert.equal(hub.getProjectRevisionSnapshot().revision, before + 2);
        const result = await hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation);
        assert.equal(result.ok, true);
        assert.equal(result.consistent, true);
    } finally {
        manager.onTaskTerminal = originalSubscription;
        await manager.deactivatePlugin(plugin.manifest.id, 'manual_disable');
        await hub.stop();
        EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
        rmSync(projectPath, { recursive: true, force: true });
    }
});

for (const scenario of ['repeated', 'concurrent', 'failed', 'cancelled', 'attach-failure', 'status-failure', 'late-status-failure', 'invoke-failure', 'late-receipts', 'stop']) {
    test(`actual Hub queued writer lifecycle: ${scenario}`, async () => {
        const projectPath = mkdtempSync(join(tmpdir(), 'peanut-writer-lease-'));
        mkdirSync(join(projectPath, 'assets'));
        mkdirSync(join(projectPath, 'temp/logs'), { recursive: true });
        writeFileSync(join(projectPath, 'temp/logs/project.log'), '');
        writeFileSync(join(projectPath, 'assets/a.txt'), 'current');
        const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
        await runtime.project.configure(projectPath, 'WriterLeaseFixture');
        const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
        const hub = new CocosMcpHub(() => manager, { projectPath });
        const plugin = createPluginModule();
        const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
        const originalPlan = EditorMcpActionRouter.prototype.planManagedResourceOperation;
        let release;
        let enter;
        const gate = new Promise((resolve) => { release = resolve; });
        const entered = new Promise((resolve) => { enter = resolve; });
        let executions = 0;
        let preparations = 0;
        let restoreControl = () => {};
        let restoreEnqueue = () => {};
        if (scenario === 'cancelled') {
            EditorMcpActionRouter.prototype.planManagedResourceOperation = async function (...args) {
                preparations += 1;
                enter();
                await gate;
                return originalPlan.apply(this, args);
            };
        }
        EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
            executions += 1;
            enter();
            await gate;
            if (scenario === 'failed') { throw new Error('owned_worker_failure'); }
            return originalWorker.apply(this, args);
        };
        try {
            manager.registerManifest({ manifest: plugin.manifest, installPath: 'plugins/peanut.editor-mcp', trustLevel: 'builtin' });
            manager.attachModule(plugin.manifest.id, plugin);
            await manager.activatePlugin(plugin.manifest.id);
            const invocation = { connectionId: 'a'.repeat(32) };
            const name = 'peanut.editor-mcp.editor-set-selection';
            const input = { clear: true, execution: { mode: 'async', idempotencyKey: 'owned-shared-writer' } };
            const control = manager.getMcpTaskControl();
            const managed = manager.getManagedTaskApi(plugin.manifest.id);
            assert.ok(managed);
            const before = hub.getProjectRevisionSnapshot().revision;
            let admissions = 0;
            const invokeWriter = (payload = input) => { admissions += 1; return hub.invokeFromHost(name, payload, invocation); };
            if (scenario === 'late-receipts') {
                const enqueue = managed.enqueue;
                restoreEnqueue = () => { managed.enqueue = enqueue; };
                managed.enqueue = async (...args) => { const result = await enqueue(...args); await managed.wait(result.taskId); return result; };
                const first = invokeWriter();
                await entered;
                const second = invokeWriter();
                await new Promise((resolve) => setImmediate(resolve));
                release();
                const receipts = await Promise.all([first, second]);
                assert.equal(receipts[0].taskId, receipts[1].taskId);
            } else {
                const first = await invokeWriter();
                assert.equal(first.taskStatus, 'queued');
                await entered;
                if (scenario === 'attach-failure' || scenario === 'status-failure' || scenario === 'late-status-failure') {
                    const method = scenario === 'attach-failure' ? 'attachCapability' : 'getStatus';
                    const original = control[method];
                    restoreControl = () => { control[method] = original; };
                    control[method] = scenario === 'attach-failure'
                        ? () => { throw new Error('owned_control_failure'); }
                        : async () => { if (scenario === 'late-status-failure') { await managed.wait(first.taskId); } throw new Error('owned_control_failure'); };
                    const rejecting = assert.rejects(invokeWriter(), /owned_control_failure/);
                    if (scenario === 'late-status-failure') { release(); }
                    await rejecting;
                    restoreControl();
                } else if (scenario === 'invoke-failure') {
                    await assert.rejects(invokeWriter({ ...input, clear: false, ids: ['different'] }), /task_idempotency_conflict/);
                } else {
                    const repeat = async () => {
                        const receipt = await invokeWriter();
                        assert.equal(receipt.taskId, first.taskId);
                        assert.equal(receipt.taskStatus, 'queued');
                    };
                    if (scenario === 'concurrent') { await Promise.all(Array.from({ length: 31 }, repeat)); }
                    else { for (let index = 0; index < 7; index += 1) { await repeat(); } }
                }
                if (scenario === 'cancelled') { assert.equal((await control.cancel(first.taskId, invocation.connectionId)).cancelled, true); }
                if (scenario === 'stop') {
                    await hub.stop();
                    assert.equal(hub.getProjectRevisionSnapshot().revision, before + admissions * 2);
                } else if (scenario !== 'late-status-failure' && scenario !== 'cancelled') {
                    let completed = false;
                    const reading = hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation)
                        .then((result) => { completed = true; return result; });
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(completed, false, 'remaining actual writer must still block the reader');
                    release();
                    assert.equal((await reading).ok, true);
                }
                release();
                await managed.wait(first.taskId);
                const terminal = await control.getStatus(first.taskId, invocation.connectionId);
                assert.equal(terminal.status, scenario === 'failed' ? 'failed' : scenario === 'cancelled' ? 'cancelled' : 'succeeded');
            }
            assert.equal(executions, scenario === 'cancelled' ? 0 : 1, 'queued reuse executes at most once and cancellation before commit executes no worker');
            if (scenario === 'cancelled') { assert.equal(preparations, 1); }
            assert.equal(hub.getProjectRevisionSnapshot().revision, before + admissions * 2, 'each admitted writer finishes exactly once');
            if (scenario !== 'stop') {
                const result = await hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, invocation);
                assert.equal(result.ok, true);
                assert.equal(result.consistent, true);
                assert.equal(result.files[0].content, 'current');
                assert.equal(result.revision, hub.getProjectRevisionSnapshot().revision);
            }
        } finally {
            restoreControl();
            restoreEnqueue();
            release();
            await manager.deactivatePlugin(plugin.manifest.id, 'manual_disable');
            await hub.stop();
            EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
            EditorMcpActionRouter.prototype.planManagedResourceOperation = originalPlan;
            rmSync(projectPath, { recursive: true, force: true });
        }
    });
}

test('actual plugin path reads text through the Hub and waits for its admitted managed writer', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-text-plugin-host-'));
    mkdirSync(join(projectPath, 'assets'));
    mkdirSync(join(projectPath, 'temp/logs'), { recursive: true });
    writeFileSync(join(projectPath, 'temp/logs/project.log'), '');
    writeFileSync(join(projectPath, 'assets/a.txt'), '\uFEFF插件🙂\r\n');
    const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
    await runtime.project.configure(projectPath, 'TextPluginHost');
    const manager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
    const hub = new CocosMcpHub(() => manager, { projectPath });
    const plugin = createPluginModule();
    const originalWorker = EditorMcpActionRouter.prototype.executeManagedResourceOperation;
    let restoreEnqueue = () => {};
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { entered = resolve; });
    EditorMcpActionRouter.prototype.executeManagedResourceOperation = async function (...args) {
        entered();
        await gate;
        return originalWorker.apply(this, args);
    };
    try {
        manager.registerManifest({ manifest: plugin.manifest, installPath: 'plugins/peanut.editor-mcp', trustLevel: 'builtin' });
        manager.attachModule(plugin.manifest.id, plugin);
        await manager.activatePlugin(plugin.manifest.id);
        const connection = { connectionId: 'a'.repeat(32) };
        const first = await hub.invokeFromHost('peanut.editor-mcp.asset-read-text', {
            paths: ['assets/a.txt', 'assets/missing.txt'],
        }, connection);
        assert.equal(first.revision, hub.getProjectRevisionSnapshot().revision);
        assert.equal(first.consistent, true);
        assert.equal(first.ok, false);
        assert.equal(first.files[0].content, '\uFEFF插件🙂\r\n');
        assert.deepEqual(first.files[1], { path: 'assets/missing.txt', status: 'failed', code: 'text_file_io_not_found' });
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai/cocos-mcp.json'), 'utf8'));
        for (const stream of [false, true]) {
            const response = await fetch(`http://127.0.0.1:${descriptor.port}/mcp`, {
                method: 'POST', headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token },
                body: JSON.stringify({ action: 'call', name: 'peanut.editor-mcp.asset-read-text',
                    input: { paths: ['assets/a.txt', 'assets/missing.txt'] }, connectionId: connection.connectionId, stream }),
            });
            assert.equal(response.status, 200);
            const encoded = await response.text();
            const wire = JSON.parse(encoded.trim());
            assert.equal(wire.ok, true);
            assert.deepEqual(wire.result, first);
        }
        const writer = await hub.invokeFromHost('peanut.editor-mcp.editor-set-selection', {
            clear: true, execution: { mode: 'async' },
        }, connection);
        assert.equal(writer.taskStatus, 'queued');
        await started;
        const duringWrite = hub.getProjectRevisionSnapshot().revision;
        let finished = false;
        const reading = hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, connection)
            .then((result) => { finished = true; return result; });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(finished, false);
        release();
        const after = await reading;
        assert.equal(after.ok, true);
        assert.equal(after.revision, hub.getProjectRevisionSnapshot().revision);
        assert.ok(after.revision > duringWrite);
        const managed = manager.getManagedTaskApi(plugin.manifest.id);
        assert.ok(managed);
        const originalEnqueue = managed.enqueue;
        restoreEnqueue = () => { managed.enqueue = originalEnqueue; };
        managed.enqueue = async (...args) => {
            const receipt = await originalEnqueue(...args);
            await managed.wait(receipt.taskId);
            return receipt;
        };
        const fast = await hub.invokeFromHost('peanut.editor-mcp.editor-set-selection', {
            clear: true, execution: { mode: 'async' },
        }, connection);
        assert.equal(fast.taskStatus, 'queued');
        const afterLateReceipt = await hub.invokeFromHost('peanut.editor-mcp.asset-read-text', { path: 'assets/a.txt' }, connection);
        assert.equal(afterLateReceipt.ok, true, 'already completed writer must not leave an unreleased barrier after delayed receipt');
        await assert.rejects(() => hub.invokeFromHost('peanut.editor-mcp.asset-read-text', {
            path: 'assets/a.txt', textReadConsistency: { revision: 999 },
        }, connection), /input_invalid/);
    } finally {
        restoreEnqueue();
        release();
        await manager.deactivatePlugin(plugin.manifest.id, 'manual_disable');
        await hub.stop();
        EditorMcpActionRouter.prototype.executeManagedResourceOperation = originalWorker;
        rmSync(projectPath, { recursive: true, force: true });
    }
});
