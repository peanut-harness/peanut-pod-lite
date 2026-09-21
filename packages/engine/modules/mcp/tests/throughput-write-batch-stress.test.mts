import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';

function request(index) {
    return {
        requestId: `write-${index}`,
        pluginId: 'peanut.editor-mcp',
        scope: 'project',
        priority: 'normal',
        kind: ResourceOperationTaskExecutor.KIND,
        payload: {
            operation: 'lumen.nodeSet',
            input: { index, project: '/stress', resource: `asset:${index}` },
        },
        mergePolicy: 'batch_commit',
    };
}

function context() {
    return {
        owner: {
            pluginId: 'peanut.editor-mcp',
            connectionId: 'stress-owner',
            projectKey: '/stress',
            capability: 'peanut.editor-mcp.lumen-node-set',
        },
        signal: new AbortController().signal,
        enterCommitWindow: () => true,
        recordEvidence: () => undefined,
    };
}

function createStressExecutor(counters) {
    return new ResourceOperationTaskExecutor({
        plan: async (_operation, input) => {
            counters.activePrepare += 1;
            counters.maxPrepare = Math.max(counters.maxPrepare, counters.activePrepare);
            await new Promise((resolve) => setTimeout(resolve, 1));
            counters.activePrepare -= 1;
            return {
                projectKey: input.project,
                operation: 'lumen.nodeSet',
                resourceKeys: [input.resource],
                requiresProjectWriter: true,
            };
        },
        execute: async (_operation, input) => {
            counters.activeWriter += 1;
            counters.maxWriter = Math.max(counters.maxWriter, counters.activeWriter);
            counters.committed += 1;
            counters.activeWriter -= 1;
            return { index: input.index };
        },
    });
}

async function runBatches(executor, total, batchSize) {
    const startedAt = performance.now();
    for (let start = 0; start < total; start += batchSize) {
        const requests = Array.from(
            { length: Math.min(batchSize, total - start) },
            (_, offset) => request(start + offset),
        );
        await executor.executeBatch(
            requests,
            requests.map(() => context()),
            `batch:stress:${start / batchSize}`,
        );
    }
    return performance.now() - startedAt;
}

test('500 writes remain bounded and 100-resource eligible batches exceed 2x sequential throughput', async () => {
    const sequentialCounters = { activePrepare: 0, maxPrepare: 0, activeWriter: 0, maxWriter: 0, committed: 0 };
    const sequential = createStressExecutor(sequentialCounters);
    const sequentialStartedAt = performance.now();
    for (let index = 0; index < 100; index += 1) {
        await sequential.execute(request(index), context());
    }
    const sequentialMs = performance.now() - sequentialStartedAt;

    const comparisonCounters = { activePrepare: 0, maxPrepare: 0, activeWriter: 0, maxWriter: 0, committed: 0 };
    const comparison = createStressExecutor(comparisonCounters);
    const batchedMs = await runBatches(comparison, 100, 25);
    const throughputRatio = sequentialMs / batchedMs;

    const stressCounters = { activePrepare: 0, maxPrepare: 0, activeWriter: 0, maxWriter: 0, committed: 0 };
    const stress = createStressExecutor(stressCounters);
    const stressMs = await runBatches(stress, 500, 25);
    const summary = {
        sequentialMs: Number(sequentialMs.toFixed(3)),
        batchedMs: Number(batchedMs.toFixed(3)),
        throughputRatio: Number(throughputRatio.toFixed(3)),
        stressWrites: stressCounters.committed,
        stressMs: Number(stressMs.toFixed(3)),
        maxPrepare: stressCounters.maxPrepare,
        maxWriter: stressCounters.maxWriter,
    };
    console.log(`throughput-write-stress:${JSON.stringify(summary)}`);

    assert.equal(sequentialCounters.committed, 100);
    assert.equal(comparisonCounters.committed, 100);
    assert.equal(stressCounters.committed, 500);
    assert.equal(comparisonCounters.maxPrepare, 4);
    assert.equal(stressCounters.maxPrepare, 4);
    assert.equal(stressCounters.maxWriter, 1);
    assert.equal(throughputRatio >= 2, true, JSON.stringify(summary));
});
