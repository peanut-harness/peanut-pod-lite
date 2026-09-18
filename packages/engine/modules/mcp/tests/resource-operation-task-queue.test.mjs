import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceOperationTaskQueue } from '../dist/resource-operation-task-queue.js';

test('resource operation tasks execute in FIFO order and expose stable completion records', async () => {
    const queue = new ResourceOperationTaskQueue();
    const order = [];
    const first = queue.run('asset.writeText', async () => {
        order.push('first:start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('first:end');
        return { value: 1 };
    });
    const second = queue.run('lumen.compAdd', async () => {
        order.push('second');
        return { value: 2 };
    });

    const [firstRecord, secondRecord] = await Promise.all([first, second]);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    assert.equal(firstRecord.status, 'succeeded');
    assert.equal(secondRecord.status, 'succeeded');
    assert.deepEqual(firstRecord.result, { value: 1 });
    assert.deepEqual(secondRecord.result, { value: 2 });
    assert.equal(queue.get(firstRecord.taskId)?.status, 'succeeded');
});

test('failed tasks release the FIFO queue for subsequent operations', async () => {
    const queue = new ResourceOperationTaskQueue();
    await assert.rejects(queue.run('asset.writeText', async () => { throw new Error('expected_failure'); }), /expected_failure/u);
    const record = await queue.run('asset.writeText', async () => 'recovered');
    assert.equal(record.status, 'succeeded');
    assert.equal(record.result, 'recovered');
});
