import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PluginManagerApp } from '@peanut/pod-engine/kernel';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';

import { createPluginModule } from '../dist/index.js';

test('Editor MCP plugin should expose 83 Lite operations without a Pro plugin', async () => {
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
    assert.equal(fullNames.length, 83);
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
