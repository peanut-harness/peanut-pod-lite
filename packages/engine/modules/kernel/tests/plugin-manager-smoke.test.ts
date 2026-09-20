import assert from 'assert/strict';
import test from 'node:test';

import { RuntimeFacade } from '@peanut/pod-engine/runtime';

import { PluginManagerApp } from '../src/app/plugin-manager-app';
import { PluginManagerSmokeHarness } from '../src/integration/plugin-manager-smoke-harness';
import type { IPluginActivateContext, IPluginModule, IPluginRegisterContext, IPluginTaskApi } from '../src/shared/plugin-manager-contracts';

class ManagedTaskPluginModule implements IPluginModule {
    public readonly manifest = {
        id: 'managed-task.plugin',
        version: '0.1.0',
        kind: 'tooling-plugin',
        displayName: 'Managed Task Plugin',
        main: './managed-task-plugin.js',
        engines: { host: '^0.1.0' },
        activation: { autoActivate: false, events: [] },
        permissions: {},
        contributions: {},
    } as const;

    public taskApi: IPluginTaskApi | null = null;
    public seenConnectionId: string | null = null;
    public resultValue: unknown = null;

    public async register(_context: IPluginRegisterContext): Promise<void> {}

    public async activate(context: IPluginActivateContext): Promise<void> {
        const managed = context.tasks.managed;
        if (managed == null) {
            throw new Error('managed_task_api_unavailable');
        }
        this.taskApi = context.tasks;
        managed.registerExecutor('managed.echo', async (request, executorContext): Promise<unknown> => {
            this.seenConnectionId = executorContext.owner.connectionId;
            return { value: request.payload?.value };
        });
        context.mcp?.register({
            name: 'managed-task.plugin.echo',
            description: 'Execute a managed echo task.',
            category: 'workflow',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: false,
            risk: 'write',
            executionModel: 'managed_task',
        }, async (_input, invocation): Promise<unknown> => {
            const invocationReceipt = await managed.enqueue({
                requestId: 'managed-task-invocation',
                scope: 'project',
                priority: 'normal',
                kind: 'managed.echo',
                mergePolicy: 'none',
            }, invocation);
            await managed.wait(invocationReceipt.taskId);
            return { taskId: invocationReceipt.taskId, taskStatus: 'succeeded' };
        });
        const receipt = await managed.enqueue({
            requestId: 'managed-task-request',
            scope: 'project',
            priority: 'normal',
            kind: 'managed.echo',
            payload: { value: 'managed-result', owner: { connectionId: 'forged' } },
            mergePolicy: 'none',
        });
        this.resultValue = (await managed.wait<{ value: string }>(receipt.taskId))?.data?.value ?? null;
    }

    public async deactivate(): Promise<void> {}

    public async dispose(): Promise<void> {}
}

test('plugin manager smoke harness should activate the sample plugin', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginManagerSmokeHarness = new PluginManagerSmokeHarness('3.8.7');
    // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
    const /* 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。 */ pluginManagerSmokeResult = await pluginManagerSmokeHarness.run();

    assert.equal(pluginManagerSmokeResult.runtimeRecords.length, 1);
    assert.equal(pluginManagerSmokeResult.runtimeRecords[0]?.pluginId, 'sample.plugin');
    assert.equal(pluginManagerSmokeResult.runtimeRecords[0]?.state, 'active');
    assert.equal(pluginManagerSmokeResult.runtimeRecords[0]?.trustLevel, 'builtin');
    assert.equal(pluginManagerSmokeResult.panelResponse.ok, true);
    assert.equal(pluginManagerSmokeResult.panelResponse.payload?.pluginId, 'sample.plugin');
    assert.deepEqual(pluginManagerSmokeResult.panelResponse.payload?.activeIds, ['smoke-selection-node']);
    assert.equal(pluginManagerSmokeResult.taskResultResponse.ok, true);
    assert.notEqual(pluginManagerSmokeResult.taskResultResponse.payload?.taskId, null);
    assert.equal(pluginManagerSmokeResult.taskResultResponse.payload?.status, 'succeeded');
    assert.equal(pluginManagerSmokeResult.taskResultResponse.payload?.kind, 'asset.query');
    assert.equal(pluginManagerSmokeResult.taskResultResponse.payload?.mergePolicy, 'dedupe');
    assert.equal(pluginManagerSmokeResult.taskTraceResponse.ok, true);
    assert.equal(pluginManagerSmokeResult.taskTraceResponse.payload?.taskId, pluginManagerSmokeResult.taskResultResponse.payload?.taskId);
    assert.notEqual(pluginManagerSmokeResult.taskTraceResponse.payload?.traceId, null);
    assert.equal(pluginManagerSmokeResult.taskTraceResponse.payload?.firstStepStatus, 'planned');
    assert.equal((pluginManagerSmokeResult.taskTraceResponse.payload?.stepCount ?? 0) >= 2, true);
});

test('plugin manager smoke harness should release panel bridge access after deactivate and preserve lifecycle states', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginManagerSmokeHarness = new PluginManagerSmokeHarness('3.8.7');
    // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
    const /* 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。 */ lifecycleCleanupResult = await pluginManagerSmokeHarness.runLifecycleCleanup();

    assert.equal(lifecycleCleanupResult.inactiveState, 'inactive');
    assert.equal(lifecycleCleanupResult.disposedState, 'disposed');
    assert.equal(lifecycleCleanupResult.panelBridgeReleased, true);
});

test('plugin manager should bind managed task owner and revoke executors across plugin lifecycle', async (): Promise<void> => {
    const runtimeFacade = new RuntimeFacade('3.8.7');
    const pluginManager = new PluginManagerApp(runtimeFacade);
    const pluginModule = new ManagedTaskPluginModule();
    pluginManager.registerManifest({
        manifest: pluginModule.manifest,
        installPath: 'plugins/managed-task.plugin',
        trustLevel: 'builtin',
    });
    pluginManager.attachModule(pluginModule.manifest.id, pluginModule);

    await pluginManager.activatePlugin(pluginModule.manifest.id);
    assert.equal(pluginModule.seenConnectionId, 'plugin:managed-task.plugin');
    assert.equal(pluginModule.resultValue, 'managed-result');
    pluginManager.getMcpCapabilityRegistry().setPluginExposure(pluginModule.manifest.id, 'all');
    const bridgeConnectionId = 'c'.repeat(32);
    await pluginManager.getMcpCapabilityRegistry().invoke('managed-task.plugin.echo', {}, { connectionId: bridgeConnectionId });
    assert.equal(pluginModule.seenConnectionId, bridgeConnectionId);
    await assert.rejects(
        pluginModule.taskApi?.managed?.enqueue({
            requestId: 'managed-task-forged-invocation',
            scope: 'project',
            priority: 'normal',
            kind: 'managed.echo',
        }, { connectionId: 'd'.repeat(32) }) ?? Promise.reject(new Error('managed_task_api_missing')),
        /plugin_task_invocation_untrusted/u,
    );
    const firstTaskApi = pluginModule.taskApi;
    await pluginManager.deactivatePlugin(pluginModule.manifest.id, 'manual_disable');
    await assert.rejects(
        firstTaskApi?.managed?.enqueue({
            requestId: 'managed-task-after-deactivate',
            scope: 'project',
            priority: 'normal',
            kind: 'managed.echo',
        }) ?? Promise.reject(new Error('managed_task_api_missing')),
        /plugin_task_api_inactive/u,
    );

    await pluginManager.activatePlugin(pluginModule.manifest.id);
    assert.equal(pluginModule.resultValue, 'managed-result');
    await pluginManager.deactivatePlugin(pluginModule.manifest.id, 'manual_disable');
});
