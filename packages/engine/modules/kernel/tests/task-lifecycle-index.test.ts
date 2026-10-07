import assert from 'assert/strict';
import test from 'node:test';

import type { ITaskReclaimedEvent, ICocosRuntime, IExecutionRuntimeService } from '@peanut/pod-engine/runtime';

import { McpTaskControl } from '../src/mcp/mcp-task-control.js';
import { PluginTaskApi } from '../src/shared/plugin-task-api.js';

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
