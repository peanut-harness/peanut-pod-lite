import assert from 'assert/strict';
import test from 'node:test';

import {
    ThroughputAdmissionController,
    ThroughputOverloadError,
} from '../src/execution/admission/throughput-admission-controller';

test('admission defaults expose the declared single-project capacities', async (): Promise<void> => {
    const controller = new ThroughputAdmissionController();
    const light = controller.inspect('connection:a', 'project:a', 'read_light');
    const heavy = controller.inspect('connection:a', 'project:a', 'read_heavy');
    const prepare = controller.inspect('connection:a', 'project:a', 'prepare');
    const writer = controller.inspect('connection:a', 'project:a', 'writer');

    assert.equal(light.classCapacity, 8);
    assert.equal(heavy.classCapacity, 2);
    assert.equal(prepare.classCapacity, 4);
    assert.equal(writer.classCapacity, 1);
    const lease = await controller.acquire({ connectionId: 'connection:a', projectKey: 'project:a', costClass: 'writer' });
    assert.equal(lease.release(), true);
    assert.equal(lease.release(), false);
    controller.dispose();
});

test('admission bounds per-connection and project queues with stable overload details', async (): Promise<void> => {
    const controller = new ThroughputAdmissionController({
        maxConnectionInFlight: 1,
        maxConnectionQueued: 2,
        maxProjectQueued: 3,
        concurrency: { control: 1, read_light: 1, read_heavy: 1, prepare: 1, writer: 1 },
    });
    const first = await controller.acquire({ connectionId: 'connection:flood', projectKey: 'project:a', costClass: 'writer' });
    const waiting = [
        controller.acquire({ connectionId: 'connection:flood', projectKey: 'project:a', costClass: 'writer' }),
        controller.acquire({ connectionId: 'connection:flood', projectKey: 'project:a', costClass: 'writer' }),
    ];
    await assert.rejects(
        controller.acquire({ connectionId: 'connection:flood', projectKey: 'project:a', costClass: 'writer' }),
        (error: unknown) => {
            assert.ok(error instanceof ThroughputOverloadError);
            assert.equal(error.mcpFailure.category, 'overloaded');
            assert.equal(error.mcpFailure.state, 'not_started');
            assert.equal(error.mcpFailure.queue?.connectionQueued, 2);
            assert.equal(typeof error.mcpFailure.retryAfterMs, 'number');
            return true;
        },
    );
    first.release();
    (await waiting[0])?.release();
    (await waiting[1])?.release();
    controller.dispose();
});

test('admission alternates queued connections and reserves control capacity', async (): Promise<void> => {
    const controller = new ThroughputAdmissionController({
        maxConnectionInFlight: 8,
        maxConnectionQueued: 4,
        maxProjectQueued: 4,
        maxControlQueued: 2,
        concurrency: { control: 1, read_light: 1, read_heavy: 1, prepare: 1, writer: 1 },
    });
    const active = await controller.acquire({ connectionId: 'connection:a', projectKey: 'project:a', costClass: 'writer' });
    const order: string[] = [];
    const a1 = controller.acquire({ connectionId: 'connection:a', projectKey: 'project:a', costClass: 'writer' }).then((lease) => {
        order.push(lease.connectionId);
        lease.release();
    });
    const a2 = controller.acquire({ connectionId: 'connection:a', projectKey: 'project:a', costClass: 'writer' }).then((lease) => {
        order.push(lease.connectionId);
        lease.release();
    });
    const b1 = controller.acquire({ connectionId: 'connection:b', projectKey: 'project:a', costClass: 'writer' }).then((lease) => {
        order.push(lease.connectionId);
        lease.release();
    });
    const control = await controller.acquire({ connectionId: 'connection:control', projectKey: 'project:a', costClass: 'control' });
    assert.equal(control.costClass, 'control');
    control.release();
    active.release();
    await Promise.all([a1, a2, b1]);

    assert.deepEqual(order, ['connection:b', 'connection:a', 'connection:a']);
    controller.dispose();
});

test('admission removes cancelled and timed-out waiters without leaking queue slots', async (): Promise<void> => {
    const controller = new ThroughputAdmissionController({
        maxConnectionInFlight: 1,
        maxConnectionQueued: 1,
        maxProjectQueued: 1,
        concurrency: { control: 1, read_light: 1, read_heavy: 1, prepare: 1, writer: 1 },
    });
    const active = await controller.acquire({ connectionId: 'connection:a', projectKey: 'project:a', costClass: 'writer' });
    const abortController = new AbortController();
    const cancelled = controller.acquire({
        connectionId: 'connection:b', projectKey: 'project:a', costClass: 'writer', signal: abortController.signal,
    });
    abortController.abort();
    await assert.rejects(cancelled, /throughput_admission_cancelled/u);
    await assert.rejects(
        controller.acquire({ connectionId: 'connection:b', projectKey: 'project:a', costClass: 'writer', waitTimeoutMs: 5 }),
        (error: unknown) => error instanceof ThroughputOverloadError && error.overload.rejectedAt === 'queue_budget',
    );
    assert.equal(controller.inspect('connection:b', 'project:a', 'writer').connectionQueued, 0);
    active.release();
    controller.dispose();
});
