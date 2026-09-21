import assert from 'assert/strict';
import test from 'node:test';

import type { ITaskOwner, ITaskRequest } from '@peanut/pod-protocol';

import { TaskControlPlane } from '../src/execution/control/task-control-plane';
import { TaskIngress } from '../src/execution/ingress/task-ingress';
import { TaskLedger } from '../src/execution/ledger/task-ledger';
import { TimeoutAndCancelController } from '../src/execution/timeout/timeout-and-cancel-controller';
import { TracePipeline } from '../src/execution/trace/trace-pipeline';

interface IFakeInterval {
    callback: (() => void) | null;
    cleared: boolean;
}

function createRequest(requestId: string): ITaskRequest {
    return {
        requestId,
        pluginId: 'bounded-lifecycle-plugin',
        scope: 'asset',
        priority: 'normal',
        kind: 'asset.query',
        payload: { pathOrUuid: `assets/${requestId}.prefab` },
    };
}

function createOwner(projectKey: string = 'project:bounded'): ITaskOwner {
    return {
        pluginId: 'bounded-lifecycle-plugin',
        connectionId: 'bridge:bounded',
        projectKey,
        capability: 'peanut.editor-mcp.asset-query',
    };
}

function createTask(ledger: TaskLedger, requestId: string): string {
    const task = new TaskIngress().accept(createRequest(requestId));
    ledger.create(task, 'queued');
    return task.taskId;
}

function succeed(controlPlane: TaskControlPlane, taskId: string): void {
    controlPlane.setResult({
        taskId,
        ok: true,
        status: 'succeeded',
        changes: [],
        trace: controlPlane.finishTrace(controlPlane.createTrace(taskId, 'asset.query')),
    });
}

test('periodic lifecycle GC reclaims every task association and publishes stable events', (): void => {
    let now = Date.parse('2026-09-21T00:00:00.000Z');
    const interval: IFakeInterval = { callback: null, cleared: false };
    const ledger = new TaskLedger();
    const timeoutController = new TimeoutAndCancelController();
    const controlPlane = new TaskControlPlane(ledger, timeoutController, new TracePipeline(), {
        retentionMs: 50,
        gcIntervalMs: 30_000,
        now: () => now,
        setInterval: (callback, intervalMs) => {
            assert.equal(intervalMs, 30_000);
            interval.callback = callback;
            return interval;
        },
        clearInterval: (handle) => {
            assert.equal(handle, interval);
            interval.cleared = true;
        },
    });
    const owner = createOwner();
    const taskId = createTask(ledger, 'periodic-gc');
    const terminalEvents: string[] = [];
    const reclaimedEvents: string[] = [];
    controlPlane.onTerminal((event) => terminalEvents.push(`${event.taskId}:${event.owner?.projectKey ?? 'none'}`));
    controlPlane.onReclaimed((event) => reclaimedEvents.push(`${event.taskId}:${event.reason}`));

    assert.deepEqual(controlPlane.claimIdempotency(owner, 'stable-key', 'digest-a', taskId), { reused: false, taskId });
    controlPlane.register(taskId, 1_000, owner);
    controlPlane.recordEvidence(taskId, {
        id: 'planned',
        kind: 'planning',
        status: 'completed',
        summary: 'Planning complete.',
        recordedAt: new Date(now).toISOString(),
    });

    now += 500;
    interval.callback?.();
    assert.deepEqual(controlPlane.claimIdempotency(owner, 'stable-key', 'digest-a', 'ignored'), { reused: true, taskId });
    assert.notEqual(timeoutController.get(taskId), null);

    succeed(controlPlane, taskId);
    succeed(controlPlane, taskId);
    assert.deepEqual(terminalEvents, [`${taskId}:project:bounded`]);
    now += 51;
    interval.callback?.();

    assert.deepEqual(reclaimedEvents, [`${taskId}:expired`]);
    assert.equal(controlPlane.query(taskId), null);
    assert.equal(controlPlane.getOwner(taskId), null);
    assert.equal(controlPlane.getEvidence(taskId, owner), null);
    assert.equal(timeoutController.get(taskId), null);
    assert.deepEqual(controlPlane.claimIdempotency(owner, 'stable-key', 'digest-b', 'replacement'), {
        reused: false,
        taskId: 'replacement',
    });

    controlPlane.dispose();
    controlPlane.dispose();
    assert.equal(interval.cleared, true);
});

test('project task slots remain hard bounded until terminal records expire', (): void => {
    let now = Date.parse('2026-09-21T01:00:00.000Z');
    const ledger = new TaskLedger();
    const controlPlane = new TaskControlPlane(ledger, new TimeoutAndCancelController(), new TracePipeline(), {
        retentionMs: 25,
        maxRetainedTasksPerProject: 2,
        now: () => now,
        setInterval: () => ({ unref: (): void => undefined }),
        clearInterval: () => undefined,
    });
    const owner = createOwner();
    const first = createTask(ledger, 'capacity-first');
    const second = createTask(ledger, 'capacity-second');
    const rejected = createTask(ledger, 'capacity-rejected');
    controlPlane.register(first, undefined, owner);
    controlPlane.register(second, undefined, owner);

    assert.equal(controlPlane.hasRetentionCapacity(owner.projectKey), false);
    assert.throws(() => controlPlane.register(rejected, undefined, owner), /task_retention_capacity_exceeded/u);
    assert.equal(controlPlane.getOwner(rejected), null);

    const otherProjectTask = createTask(ledger, 'capacity-other-project');
    controlPlane.register(otherProjectTask, undefined, createOwner('project:other'));
    succeed(controlPlane, first);
    now += 26;
    assert.deepEqual(controlPlane.purgeExpired(), [first]);
    assert.equal(controlPlane.hasRetentionCapacity(owner.projectKey), true);
    controlPlane.register(rejected, undefined, owner);
    assert.equal(controlPlane.getOwner(rejected)?.projectKey, owner.projectKey);
    controlPlane.dispose();
});

test('task and batch evidence retain a stable prefix plus bounded dropped summary', (): void => {
    const now = Date.parse('2026-09-21T02:00:00.000Z');
    const ledger = new TaskLedger();
    const controlPlane = new TaskControlPlane(ledger, new TimeoutAndCancelController(), new TracePipeline(), {
        maxTaskEvidenceEntries: 4,
        maxTaskEvidenceBytes: 512,
        maxBatchEvidenceEntries: 6,
        maxBatchEvidenceBytes: 768,
        now: () => now,
        setInterval: () => ({ unref: (): void => undefined }),
        clearInterval: () => undefined,
    });
    const owner = createOwner();
    const taskId = createTask(ledger, 'task-evidence');
    const batchId = createTask(ledger, 'batch-evidence');
    controlPlane.register(taskId, undefined, owner);
    controlPlane.register(batchId, undefined, owner);

    for (let index = 0; index < 20; index += 1) {
        const evidence = {
            id: `step-${index}`,
            kind: 'artifact' as const,
            status: 'completed' as const,
            summary: `Safe summary ${index} ${'x'.repeat(40)}`,
            recordedAt: new Date(now).toISOString(),
        };
        controlPlane.recordEvidence(taskId, evidence);
        controlPlane.recordEvidence(batchId, evidence, 'batch');
    }

    const taskEntries = controlPlane.getEvidence(taskId, owner)?.entries ?? [];
    const batchEntries = controlPlane.getEvidence(batchId, owner)?.entries ?? [];
    assert.ok(taskEntries.length <= 4);
    assert.ok(batchEntries.length <= 6);
    assert.equal(taskEntries[0]?.id, 'step-0');
    assert.equal(batchEntries[0]?.id, 'step-0');
    assert.match(taskEntries[taskEntries.length - 1]?.summary ?? '', /^Evidence truncated; dropped \d+ entries\.$/u);
    assert.match(batchEntries[batchEntries.length - 1]?.digest ?? '', /^dropped:\d+$/u);
    assert.ok(Buffer.byteLength(JSON.stringify(taskEntries), 'utf8') <= 512);
    assert.ok(Buffer.byteLength(JSON.stringify(batchEntries), 'utf8') <= 768);
    assert.equal(taskEntries[taskEntries.length - 1]?.status, 'skipped');
    controlPlane.dispose();
});
