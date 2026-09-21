import assert from 'assert/strict';
import test from 'node:test';

import type { ITaskReclaimedEvent, ICocosRuntime, IExecutionRuntimeService } from '@peanut/pod-engine/runtime';

import { McpTaskControl } from '../src/mcp/mcp-task-control';
import { PluginTaskApi } from '../src/shared/plugin-task-api';

interface IFakeExecution extends Pick<IExecutionRuntimeService, 'onTaskReclaimed' | 'submit' | 'query' | 'cancel' | 'getOwnedStatus'> {
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
    const taskControl = new McpTaskControl(execution as IExecutionRuntimeService);
    taskControl.attach('task:lifecycle-index', owner);
    assert.notEqual(await taskControl.getStatus('task:lifecycle-index', owner.connectionId), null);

    const taskApi = new PluginTaskApi(
        owner.pluginId,
        { execution } as unknown as ICocosRuntime,
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
