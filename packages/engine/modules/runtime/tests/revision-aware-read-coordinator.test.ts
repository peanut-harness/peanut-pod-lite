import assert from 'assert/strict';
import test from 'node:test';

import { ThroughputHealthMetrics } from '../src/execution/metrics/throughput-health-metrics';
import { RevisionAwareReadCoordinator } from '../src/execution/read/revision-aware-read-coordinator';
import { ProjectRevisionClock } from '../src/execution/revision/project-revision-clock';

test('equivalent reads coalesce only for identical authority, input, version, and revision', async (): Promise<void> => {
    const clock = new ProjectRevisionClock('project:test');
    const metrics = new ThroughputHealthMetrics({ readRssBytes: () => 1 });
    const coordinator = new RevisionAwareReadCoordinator(clock, { metrics });
    let executions = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const read = async (): Promise<{ readonly execution: number }> => {
        executions += 1;
        await gate;
        return { execution: executions };
    };
    const base = {
        operation: 'asset.catalog.lookup',
        input: { query: 'hero', nested: { b: 2, a: 1 } },
        authorityKey: 'read:catalog',
        capabilityVersion: '1',
    };

    const first = coordinator.execute(base, read);
    const equivalent = coordinator.execute({ ...base, input: { nested: { a: 1, b: 2 }, query: 'hero' } }, read);
    const otherInput = coordinator.execute({ ...base, input: { query: 'villain' } }, read);
    const otherAuthority = coordinator.execute({ ...base, authorityKey: 'read:catalog:restricted' }, read);
    assert.equal(executions, 3);
    release?.();
    const [a, b] = await Promise.all([first, equivalent, otherInput, otherAuthority]);
    assert.equal(a.source, 'fresh');
    assert.equal(b.source, 'coalesced');
    assert.equal(metrics.snapshot().coalescedReads, 1);

    clock.externalChange();
    const afterRevision = await coordinator.execute(base, async () => ({ execution: ++executions }));
    assert.equal(afterRevision.revision, 1);
    assert.equal(afterRevision.source, 'fresh');
    assert.equal(executions, 4);
    coordinator.dispose();
});

test('revision-aware cache is TTL and LRU bounded and never returns a prior revision', async (): Promise<void> => {
    let now = 0;
    const clock = new ProjectRevisionClock('project:test', () => now);
    const metrics = new ThroughputHealthMetrics({ now: () => now, readRssBytes: () => 1 });
    const coordinator = new RevisionAwareReadCoordinator(clock, {
        now: () => now,
        maxCacheEntries: 2,
        coalescingWindowMs: 0,
        metrics,
    });
    let executions = 0;
    const execute = (id: number) => coordinator.execute({
        operation: 'catalog.read',
        input: { id },
        authorityKey: 'read',
        capabilityVersion: '1',
        allowCoalescing: false,
        cacheTtlMs: 20,
    }, async () => ++executions);

    assert.equal((await execute(1)).source, 'fresh');
    assert.equal((await execute(1)).source, 'cache');
    await execute(2);
    await execute(3);
    assert.equal(coordinator.inspect().cacheEntries, 2);
    assert.equal((await execute(1)).source, 'fresh');
    clock.beginWrite();
    assert.equal((await execute(1)).source, 'fresh');
    now = 25;
    assert.equal((await execute(1)).source, 'fresh');
    assert.equal(metrics.snapshot().cacheHits, 1);
    coordinator.dispose();
});

test('revision change during a retryable read retries once and otherwise reports stale', async (): Promise<void> => {
    const clock = new ProjectRevisionClock('project:test');
    const coordinator = new RevisionAwareReadCoordinator(clock);
    let calls = 0;
    const retried = await coordinator.execute({
        operation: 'scene.query',
        input: {},
        authorityKey: 'read',
        capabilityVersion: '1',
        retryOnRevisionChange: true,
    }, async () => {
        calls += 1;
        if (calls === 1) {
            clock.externalChange();
        }
        return calls;
    });
    assert.equal(calls, 2);
    assert.equal(retried.stale, false);
    assert.equal(retried.revision, 1);
    coordinator.dispose();
});
