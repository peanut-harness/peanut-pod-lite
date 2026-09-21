import assert from 'assert/strict';
import test from 'node:test';

import { ThroughputAdmissionController } from '../src/execution/admission/throughput-admission-controller';
import { ThroughputHealthMetrics } from '../src/execution/metrics/throughput-health-metrics';
import { RevisionAwareReadCoordinator } from '../src/execution/read/revision-aware-read-coordinator';
import { ProjectRevisionClock } from '../src/execution/revision/project-revision-clock';

test('10,000 mixed hot/cold reads remain bounded across revision jitter and connections', async (): Promise<void> => {
    const metrics = new ThroughputHealthMetrics({ readRssBytes: () => process.memoryUsage().rss });
    const admission = new ThroughputAdmissionController({}, Date.now, metrics);
    const clock = new ProjectRevisionClock('project:stress');
    const reads = new RevisionAwareReadCoordinator(clock, {
        maxCoalescedKeys: 64,
        maxCacheEntries: 128,
        metrics,
    });
    let underlyingReads = 0;
    const connections = ['connection:a', 'connection:b', 'connection:c', 'connection:d'] as const;

    for (let wave = 0; wave < 200; wave += 1) {
        if (wave > 0 && wave % 10 === 0) {
            clock.externalChange();
        }
        const expectedRevision = clock.snapshot().revision;
        const results = await Promise.all(Array.from({ length: 50 }, async (_, offset) => {
            const index = wave * 50 + offset;
            const connectionId = connections[index % connections.length] ?? connections[0];
            const key = offset < 35 ? `hot:${offset % 5}` : `cold:${index}`;
            const lease = await admission.acquire({
                connectionId,
                projectKey: 'project:stress',
                costClass: index % 11 === 0 ? 'read_heavy' : 'read_light',
            });
            try {
                return await reads.execute({
                    operation: 'stress.read',
                    input: { key },
                    authorityKey: index % 17 === 0 ? 'read:restricted' : 'read:standard',
                    capabilityVersion: '1',
                    allowCoalescing: true,
                    cacheTtlMs: 1_000,
                    retryOnRevisionChange: true,
                }, async () => {
                    underlyingReads += 1;
                    return { key, revision: clock.snapshot().revision };
                });
            } finally {
                lease.release();
            }
        }));
        for (const [offset, result] of results.entries()) {
            const index = wave * 50 + offset;
            const expectedKey = offset < 35 ? `hot:${offset % 5}` : `cold:${index}`;
            assert.equal(result.stale, false);
            assert.equal(result.revision, expectedRevision);
            assert.equal(result.value.revision, expectedRevision);
            assert.equal(result.value.key, expectedKey);
        }
        assert.ok(reads.inspect().coalescedKeys <= 64);
        assert.ok(reads.inspect().cacheEntries <= 128);
    }

    const snapshot = metrics.snapshot();
    const accepted = snapshot.classes.reduce((total, entry) => total + entry.accepted, 0);
    const rejected = snapshot.classes.reduce((total, entry) => total + entry.rejected, 0);
    assert.equal(accepted, 10_000);
    assert.equal(rejected, 0);
    assert.ok(underlyingReads < 10_000);
    assert.ok(snapshot.coalescedReads + snapshot.cacheHits > 0);
    for (const costClass of ['read_light', 'read_heavy'] as const) {
        const state = admission.inspect('connection:a', 'project:stress', costClass);
        assert.equal(state.connectionInFlight, 0);
        assert.equal(state.connectionQueued, 0);
        assert.equal(state.classInFlight, 0);
        assert.equal(state.projectQueued, 0);
    }
    assert.ok(snapshot.rssHighWaterBytes > 0);
    reads.dispose();
    assert.deepEqual(reads.inspect(), { coalescedKeys: 0, cacheEntries: 0 });
    admission.dispose();
});
