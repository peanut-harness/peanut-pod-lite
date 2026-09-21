import assert from 'assert/strict';
import test from 'node:test';

import { ThroughputAdmissionController } from '../src/execution/admission/throughput-admission-controller';
import { ThroughputHealthMetrics } from '../src/execution/metrics/throughput-health-metrics';

test('health metrics count admission events and expose only bounded aggregate values', async (): Promise<void> => {
    let now = 1_000;
    const metrics = new ThroughputHealthMetrics({
        now: () => now,
        readRssBytes: () => 123_456,
        maxLatencySamples: 8,
    });
    const controller = new ThroughputAdmissionController({
        maxConnectionInFlight: 1,
        maxConnectionQueued: 1,
        maxProjectQueued: 1,
        concurrency: { control: 1, read_light: 1, read_heavy: 1, prepare: 1, writer: 1 },
    }, () => now, metrics);

    const active = await controller.acquire({ connectionId: 'secret-connection', projectKey: '/secret/project', costClass: 'writer' });
    const waiting = controller.acquire({ connectionId: 'other-secret', projectKey: '/secret/project', costClass: 'writer' });
    await assert.rejects(
        controller.acquire({ connectionId: 'third-secret', projectKey: '/secret/project', costClass: 'writer' }),
        /throughput_overloaded/u,
    );
    now += 20;
    active.release();
    const second = await waiting;
    now += 40;
    second.release();

    metrics.recordWriterHold(30);
    metrics.recordSettle(12);
    metrics.recordEventLoopLag(4);
    metrics.recordCoalescedRead(3);
    metrics.recordCacheHit(2);
    metrics.recordGcRemoved(5);
    metrics.recordBatchAccepted();
    metrics.recordBatchCompleted();
    const snapshot = controller.getHealthSnapshot();
    const writer = snapshot.classes.find((entry) => entry.costClass === 'writer');

    assert.deepEqual(writer, {
        costClass: 'writer',
        accepted: 2,
        rejected: 1,
        inFlight: 0,
        queued: 0,
        queueWaitP95Ms: 20,
        executionP95Ms: 40,
    });
    assert.equal(snapshot.writerHoldP95Ms, 30);
    assert.equal(snapshot.settleP95Ms, 12);
    assert.equal(snapshot.eventLoopLagP95Ms, 4);
    assert.equal(snapshot.rssHighWaterBytes, 123_456);
    assert.equal(snapshot.coalescedReads, 3);
    assert.equal(snapshot.cacheHits, 2);
    assert.equal(snapshot.gcRemoved, 5);
    assert.equal(snapshot.batchesAccepted, 1);
    assert.equal(snapshot.batchesCompleted, 1);
    assert.equal(snapshot.batchesFailed, 0);

    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /secret|project|connection|token|input|resource/iu);
    controller.dispose();
});

test('health metrics use fixed windows while preserving live gauges', (): void => {
    let now = 0;
    const metrics = new ThroughputHealthMetrics({ windowMs: 100, now: () => now, readRssBytes: () => 10 });
    metrics.changeQueued('read_light', 1);
    const complete = metrics.beginExecution('writer', 5);
    metrics.recordRejected('read_heavy');
    metrics.recordBatchFailed();
    now = 101;

    const rolled = metrics.snapshot();
    assert.equal(rolled.classes.find((entry) => entry.costClass === 'read_light')?.queued, 1);
    assert.equal(rolled.classes.find((entry) => entry.costClass === 'writer')?.inFlight, 1);
    assert.equal(rolled.classes.find((entry) => entry.costClass === 'writer')?.accepted, 0);
    assert.equal(rolled.classes.find((entry) => entry.costClass === 'read_heavy')?.rejected, 0);
    assert.equal(rolled.batchesFailed, 0);

    complete();
    metrics.changeQueued('read_light', -1);
    const completed = metrics.snapshot();
    assert.equal(completed.classes.find((entry) => entry.costClass === 'writer')?.executionP95Ms, 101);
    assert.equal(completed.classes.find((entry) => entry.costClass === 'writer')?.inFlight, 0);
    assert.equal(completed.classes.find((entry) => entry.costClass === 'read_light')?.queued, 0);
});
