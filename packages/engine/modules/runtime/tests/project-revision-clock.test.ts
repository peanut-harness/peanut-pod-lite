import assert from 'assert/strict';
import test from 'node:test';

import { ProjectRevisionClock } from '../src/execution/revision/project-revision-clock';

test('project revision invalidates snapshots across write, refresh, and external boundaries', (): void => {
    let now = Date.parse('2026-09-21T00:00:00.000Z');
    const clock = new ProjectRevisionClock('project:fixture', () => now);
    const initial = clock.snapshot();
    assert.equal(initial.revision, 0);
    assert.equal(initial.stale, false);

    clock.beginWrite();
    assert.equal(clock.snapshot(initial.revision).stale, true);
    clock.finishWrite();
    assert.equal(clock.snapshot().revision, 2);
    clock.refreshSettled();
    assert.equal(clock.snapshot().revision, 3);
    now += 10;
    clock.externalChange();
    assert.deepEqual(clock.snapshot(3), {
        projectKey: 'project:fixture',
        revision: 4,
        stale: true,
        observedAt: '2026-09-21T00:00:00.010Z',
    });
    assert.equal(clock.getLastBoundary(), 'external_change');
});
