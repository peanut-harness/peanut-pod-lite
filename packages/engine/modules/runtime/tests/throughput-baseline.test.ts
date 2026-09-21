import assert from 'assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import type { ITaskRequest } from '@peanut/pod-protocol';

import { BatchCommitCoordinator } from '../src/execution/commit/batch-commit-coordinator';
import { ExecutionRuntimeService } from '../src/execution/execution-runtime-service';
import { TaskIngress } from '../src/execution/ingress/task-ingress';
import { TaskLedger } from '../src/execution/ledger/task-ledger';
import { ResourceLockManager } from '../src/execution/locks/resource-lock-manager';
import { TaskMerger } from '../src/execution/merge/task-merger';
import { TaskScheduler } from '../src/execution/scheduler/task-scheduler';
import { TracePipeline } from '../src/execution/trace/trace-pipeline';
import { WorkerPool } from '../src/execution/workers/worker-pool';

interface IThroughputBaselineSummary {
    readonly seed: number;
    readonly total: number;
    readonly reads: number;
    readonly writes: number;
    readonly elapsedMs: number;
    readonly operationsPerSecond: number;
    readonly latencyMs: {
        readonly p50: number;
        readonly p95: number;
        readonly p99: number;
    };
    readonly rejected: number;
    readonly queuePeak: number;
    readonly retainedResults: number;
    readonly evidenceEntries: number;
    readonly rssPeakBytes: number;
}

class BaselineCommitCoordinator extends BatchCommitCoordinator {
    public override async commit(
        taskGroup: Parameters<BatchCommitCoordinator['commit']>[0],
        tasks: Parameters<BatchCommitCoordinator['commit']>[1],
        planSummary: Parameters<BatchCommitCoordinator['commit']>[2],
    ): ReturnType<BatchCommitCoordinator['commit']> {
        await new Promise((resolve) => {
            setTimeout(resolve, 1);
        });
        return super.commit(taskGroup, tasks, planSummary);
    }
}

function createRequest(index: number, randomValue: number): ITaskRequest {
    const isWrite = randomValue % 4 === 0;
    return {
        requestId: `throughput-baseline-${index}`,
        pluginId: 'peanut.throughput-baseline',
        scope: isWrite ? 'scene' : 'asset',
        priority: index % 11 === 0 ? 'high' : 'normal',
        kind: isWrite ? 'scene.patch' : 'asset.query',
        payload: isWrite
            ? { nodeId: `baseline-node-${index % 8}`, patch: { enabled: index % 2 === 0 } }
            : { pathOrUuid: `assets/baseline-${index % 24}.prefab` },
        mergePolicy: 'none',
    };
}

function nextRandom(state: number): number {
    return (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
}

function percentile(values: readonly number[], ratio: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
    return Number((sorted[index] ?? 0).toFixed(3));
}

test('single-project baseline reports deterministic workload throughput and bounded observations', async (): Promise<void> => {
    const seed = 0x5eed_2026;
    const total = 128;
    let randomState = seed;
    const requests: ITaskRequest[] = [];
    for (let index = 0; index < total; index += 1) {
        randomState = nextRandom(randomState);
        requests.push(createRequest(index, randomState));
    }

    const ledger = new TaskLedger();
    const runtime = new ExecutionRuntimeService(
        new TaskIngress(),
        new TaskScheduler(ledger),
        ledger,
        new WorkerPool(),
        new TaskMerger(),
        new ResourceLockManager(),
        new BaselineCommitCoordinator(),
        new TracePipeline(),
    );
    const latencies: number[] = [];
    const taskIds: string[] = [];
    let queuePeak = 0;
    let rssPeakBytes = process.memoryUsage().rss;
    let sampling = true;
    const sampler = (async (): Promise<void> => {
        while (sampling) {
            const snapshot = await runtime.inspectQueue();
            queuePeak = Math.max(
                queuePeak,
                snapshot.queuedTaskIds.length,
                snapshot.planningGroups.length + snapshot.pendingCommitGroups.length + (snapshot.activeCommitGroup == null ? 0 : 1),
            );
            rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
            await new Promise((resolve) => {
                setTimeout(resolve, 1);
            });
        }
    })();

    const startedAt = performance.now();
    await Promise.all(requests.map(async (request) => {
        const operationStartedAt = performance.now();
        const receipt = await runtime.submit(request);
        latencies.push(performance.now() - operationStartedAt);
        taskIds.push(receipt.taskId);
        runtime.recordEvidence(receipt.taskId, {
            id: 'baseline-postflight',
            kind: 'postflight',
            status: receipt.status === 'succeeded' ? 'completed' : 'failed',
            summary: 'Deterministic throughput baseline observation.',
            recordedAt: new Date().toISOString(),
        });
    }));
    const elapsedMs = performance.now() - startedAt;
    sampling = false;
    await sampler;

    const results = await Promise.all(taskIds.map(async (taskId) => runtime.getResult(taskId)));
    const rejected = results.filter((result) => result?.ok !== true).length;
    const writes = requests.filter((request) => request.kind === 'scene.patch').length;
    const summary: IThroughputBaselineSummary = {
        seed,
        total,
        reads: total - writes,
        writes,
        elapsedMs: Number(elapsedMs.toFixed(3)),
        operationsPerSecond: Number(((total * 1_000) / elapsedMs).toFixed(3)),
        latencyMs: {
            p50: percentile(latencies, 0.5),
            p95: percentile(latencies, 0.95),
            p99: percentile(latencies, 0.99),
        },
        rejected,
        queuePeak,
        retainedResults: results.filter((result) => result != null).length,
        evidenceEntries: taskIds.length,
        rssPeakBytes,
    };

    assert.equal(summary.reads + summary.writes, total);
    assert.equal(summary.rejected, 0);
    assert.equal(summary.retainedResults, total);
    assert.equal(summary.evidenceEntries, total);
    assert.equal(summary.queuePeak > 0, true);
    assert.equal(summary.operationsPerSecond > 0, true);
    process.stdout.write(`throughput-baseline:${JSON.stringify(summary)}\n`);
});
