import assert from 'node:assert/strict';
import test from 'node:test';

import { AutomaticMicroBatcher } from '../src/automatic-micro-batcher.js';

function request(id) {
    return {
        requestId: id,
        scope: 'project',
        priority: 'normal',
        kind: 'editor-mcp.resource-operation',
        payload: { operation: 'lumen.nodeSet', input: { id } },
        mergePolicy: 'batch_commit',
    };
}

function invocation(connectionId, resource) {
    return {
        connectionId,
        risk: 'write',
        resourceIds: [resource],
        hasLocalApproval: true,
    };
}

function managedHarness() {
    const single = [];
    const batches = [];
    return {
        single,
        batches,
        api: {
            registerExecutor: () => () => undefined,
            enqueue: async (item) => {
                single.push(item.requestId);
                return { taskId: `task:${item.requestId}`, status: 'queued', acceptedAt: new Date().toISOString() };
            },
            enqueueBatch: async (items) => {
                batches.push(items.map((item) => item.requestId));
                return {
                    batchId: `batch:${batches.length}`,
                    receipts: items.map((item) => ({
                        taskId: `task:${item.requestId}`,
                        status: 'queued',
                        acceptedAt: new Date().toISOString(),
                    })),
                };
            },
            wait: async () => null,
        },
    };
}

test('automatic micro-batcher groups only compatible disjoint requests inside the window', async () => {
    const harness = managedHarness();
    const batcher = new AutomaticMicroBatcher(harness.api, 5);
    try {
        const [first, second] = await Promise.all([
            batcher.enqueue('lumen.nodeSet', request('a'), invocation('owner', 'asset:a')),
            batcher.enqueue('lumen.nodeSet', request('b'), invocation('owner', 'asset:b')),
        ]);
        assert.deepEqual(harness.batches, [['a', 'b']]);
        assert.deepEqual(harness.single, []);
        assert.equal(first.taskId, 'task:a');
        assert.equal(second.taskId, 'task:b');
    } finally {
        batcher.dispose();
    }
});

test('automatic micro-batcher does not cross owner or resource-conflict boundaries', async () => {
    const harness = managedHarness();
    const batcher = new AutomaticMicroBatcher(harness.api, 5);
    try {
        await Promise.all([
            batcher.enqueue('lumen.nodeSet', request('owner-a'), invocation('owner-a', 'asset:a')),
            batcher.enqueue('lumen.nodeSet', request('owner-b'), invocation('owner-b', 'asset:b')),
            batcher.enqueue('lumen.nodeSet', request('conflict-a'), invocation('owner-c', 'asset:shared')),
            batcher.enqueue('lumen.nodeSet', request('conflict-b'), invocation('owner-c', 'asset:shared')),
        ]);
        assert.deepEqual(harness.batches, []);
        assert.deepEqual(harness.single.sort(), ['conflict-a', 'conflict-b', 'owner-a', 'owner-b']);
    } finally {
        batcher.dispose();
    }
});
