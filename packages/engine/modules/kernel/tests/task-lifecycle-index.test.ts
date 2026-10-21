import assert from 'assert/strict';
import test from 'node:test';

import type { ITaskReclaimedEvent, ICocosRuntime, IExecutionRuntimeService } from '@peanut/pod-engine/runtime';

import { McpTaskControl } from '../src/mcp/mcp-task-control.js';
import { PluginTaskApi } from '../src/shared/plugin-task-api.js';
import { RuntimeFacade, ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Host field preparation binds original task, context, input, signal, one use and writer phase', async () => {
    for (const variant of ['valid', 'request-copy', 'input-copy', 'signal-copy', 'context-copy', 'wrong-root', 'replay',
        'concurrent', 'after-writer', 'cancelled', 'batch', 'copy-error']) {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'host-field-task-'))); const runtime = new RuntimeFacade('3.8.3');
        await runtime.project.configure(root, 'HostFieldTask'); let producerCalls = 0; const code = 'lumen_property_type:friction:number>=0';
        const producer = { prepare: async (_root: string, input: unknown): Promise<void> => {
            producerCalls++; if (variant === 'replay') return;
            const error = new Error(code); ExecutionRuntimeService.recordResourceFieldPreparationRefusal(error, input); throw error;
        } };
        assert.throws(() => new PluginTaskApi('other-plugin', runtime, root, null, producer), /producer_plugin_invalid/u);
        const api = new PluginTaskApi('peanut.editor-mcp', runtime, root, null, producer);
        let releaseCancel: () => void = () => {};
        const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
        const remove = api.managed.registerExecutor('editor-mcp.resource-operation', async (request, context) => {
            const input = (request.payload as { input: object }).input;
            if (variant === 'batch') { assert.equal(context.prepareResourceField, undefined); throw new Error('batch_field_preparation_unavailable'); }
            assert.ok(context.prepareResourceField);
            if (variant === 'after-writer') assert.equal(context.enterCommitWindow(), true);
            if (variant === 'cancelled') {
                await cancelGate; assert.equal(context.signal.aborted, true);
            }
            const invoke = () => context.prepareResourceField!.call(variant === 'context-copy' ? { ...context } : context,
                variant === 'request-copy' ? { ...request } : request, variant === 'wrong-root' ? tmpdir() : root,
                variant === 'input-copy' ? { ...input } : input, variant === 'signal-copy' ? new AbortController().signal : context.signal);
            if (variant === 'concurrent') {
                const attempts = await Promise.allSettled([invoke(), invoke()]);
                assert.equal(attempts[1]?.status, 'rejected');
                if (attempts[0]?.status === 'rejected') throw attempts[0].reason;
                throw new Error('concurrent_preparation_unexpected_success');
            }
            try { await invoke(); if (variant === 'replay') await invoke(); }
            catch (error) { if (variant === 'copy-error') throw new Error((error as Error).message); throw error; }
            throw new Error('preparation_unexpected_success');
        }, { concurrency: 'executor_managed' });
        try {
            const receipt = await api.managed.enqueue({ requestId: variant, scope: 'project', priority: 'normal', kind: 'editor-mcp.resource-operation',
                mergePolicy: variant === 'batch' ? 'batch_commit' : 'none', payload: { operation: 'lumen.assetSet', input: {
                    assetRelativePath: 'assets/one.pmtl', props: { friction: 'invalid' } } } });
            if (variant === 'cancelled') { await api.cancel(receipt.taskId); releaseCancel(); }
            const result = await api.managed.wait(receipt.taskId);
            assert.equal(producerCalls, ['valid', 'replay', 'concurrent', 'copy-error'].includes(variant) ? 1 : 0);
            if (['valid', 'concurrent'].includes(variant)) assert.ok(result?.data?.assetFieldPreparationRefusal);
            else assert.equal(result?.data?.assetFieldPreparationRefusal, undefined);
        } finally { releaseCancel(); remove(); await api.deactivate(); runtime.execution.dispose(); rmSync(root, { recursive: true, force: true }); }
    }
});

interface IFakeExecution extends IExecutionRuntimeService {
    emitReclaimed(event: ITaskReclaimedEvent): void;
    readonly cancelledTaskIds: string[];
    readonly statusQueries: string[];
}

function createExecution(): IFakeExecution {
    const listeners = new Set<(event: ITaskReclaimedEvent) => void>();
    const cancelledTaskIds: string[] = [];
    const statusQueries: string[] = [];
    return {
        cancelledTaskIds,
        statusQueries,
        /**
         * @description 清理此夹具自己的监听；无调度器或定时器。
         */
        dispose: () => { listeners.clear(); },
        /**
         * @description 非本回收索引用例的调用必须显式失败，不能返回伪成功。
         */
        submitOwned: async () => { throw new Error('lifecycle_fixture_unexpected_submitOwned'); },
        submitOwnedBatch: async () => { throw new Error('lifecycle_fixture_unexpected_submitOwnedBatch'); },
        getOwner: () => { throw new Error('lifecycle_fixture_unexpected_getOwner'); },
        getTaskAbortSignal: () => { throw new Error('lifecycle_fixture_unexpected_getTaskAbortSignal'); },
        enterTaskCommitWindow: () => { throw new Error('lifecycle_fixture_unexpected_enterTaskCommitWindow'); },
        submitBatch: async () => { throw new Error('lifecycle_fixture_unexpected_submitBatch'); },
        getResult: async () => { throw new Error('lifecycle_fixture_unexpected_getResult'); },
        cancelOwned: async () => { throw new Error('lifecycle_fixture_unexpected_cancelOwned'); },
        getOwnedEvidence: async () => { throw new Error('lifecycle_fixture_unexpected_getOwnedEvidence'); },
        registerExecutor: () => { throw new Error('lifecycle_fixture_unexpected_registerExecutor'); },
        recordEvidence: () => { throw new Error('lifecycle_fixture_unexpected_recordEvidence'); },
        inspectQueue: async () => { throw new Error('lifecycle_fixture_unexpected_inspectQueue'); },
        inspectDiagnostics: async () => { throw new Error('lifecycle_fixture_unexpected_inspectDiagnostics'); },
        onTaskReclaimed: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emitReclaimed: (event) => {
            for (const listener of listeners) {
                listener(event);
            }
        },
        submit: async () => ({ taskId: 'task:lifecycle-index', status: 'queued' }),
        query: async (taskId) => ({
            taskId,
            pluginId: 'plugin.lifecycle-index',
            status: 'queued',
            scope: 'asset',
            kind: 'asset.query',
            createdAt: '2026-09-21T00:00:00.000Z',
            updatedAt: '2026-09-21T00:00:00.000Z',
        }),
        cancel: async (taskId) => {
            cancelledTaskIds.push(taskId);
            return { taskId, cancelled: true };
        },
        getOwnedStatus: async (taskId, owner) => {
            statusQueries.push(taskId);
            return {
                taskId,
                pluginId: owner.pluginId,
                capability: owner.capability,
                status: 'succeeded',
                createdAt: '2026-09-21T00:00:00.000Z',
                updatedAt: '2026-09-21T00:00:01.000Z',
            };
        },
    };
}

test('Runtime reclaim events remove Hub owner and plugin task-id outer indexes', async (): Promise<void> => {
    const execution = createExecution();
    const owner = {
        pluginId: 'plugin.lifecycle-index',
        connectionId: 'bridge:lifecycle-index',
        projectKey: 'project:lifecycle-index',
        capability: 'peanut.editor-mcp.asset-query',
    } as const;
    const taskControl = new McpTaskControl(execution);
    taskControl.attach('task:lifecycle-index', owner);
    assert.notEqual(await taskControl.getStatus('task:lifecycle-index', owner.connectionId), null);

    /**
     * @description 仅 execution 是本用例入口；其他 Runtime 子域的意外访问必须失败。
     */
    const runtime: ICocosRuntime = {
        execution,
        get version(): never { throw new Error('lifecycle_fixture_unexpected_version'); },
        get message(): never { throw new Error('lifecycle_fixture_unexpected_message'); },
        get asset(): never { throw new Error('lifecycle_fixture_unexpected_asset'); },
        get scene(): never { throw new Error('lifecycle_fixture_unexpected_scene'); },
        get panelHost(): never { throw new Error('lifecycle_fixture_unexpected_panelHost'); },
        get selection(): never { throw new Error('lifecycle_fixture_unexpected_selection'); },
        get project(): never { throw new Error('lifecycle_fixture_unexpected_project'); },
    };
    const taskApi = new PluginTaskApi(
        owner.pluginId,
        runtime,
        owner.projectKey,
    );
    await taskApi.submit({
        requestId: 'lifecycle-index',
        scope: 'asset',
        priority: 'normal',
        kind: 'asset.query',
    });

    execution.emitReclaimed({ taskId: 'task:lifecycle-index', owner, reason: 'expired' });
    assert.equal(await taskControl.getStatus('task:lifecycle-index', owner.connectionId), null);
    assert.deepEqual(execution.statusQueries, ['task:lifecycle-index']);
    await taskApi.deactivate();
    assert.deepEqual(execution.cancelledTaskIds, []);
    taskControl.dispose();
});
