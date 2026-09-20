import assert from 'node:assert/strict';
import test from 'node:test';

import { CoreCocosMcpToolDefinitionCatalog } from '../dist/index.js';

test('Core tool catalog publishes deterministic AI handling rules', () => {
    const catalog = new CoreCocosMcpToolDefinitionCatalog();
    const read = catalog.findByOperation('asset.queryInfo');
    const write = catalog.findByOperation('asset.copy');

    assert.ok(read);
    assert.deepEqual(read.aiHandling.successSignals, ['response.ok=true']);
    assert.equal(read.aiHandling.failureField, 'failure');
    assert.equal(read.aiHandling.unknownStateAction, 'query_before_retry');
    assert.equal(read.aiHandling.blindRetryAllowed, false);
    assert.equal(read.outputSchema, undefined);
    assert.match(read.description, /failure\.recommendedAction/u);

    assert.ok(write);
    assert.deepEqual(write.aiHandling.successSignals, [
        'response.ok=true',
        'result.taskStatus=succeeded',
        'result.postflight.verified=true',
    ]);
    assert.equal(write.aiHandling.failureField, 'failure');
    assert.equal(write.aiHandling.unknownStateAction, 'query_before_retry');
    assert.equal(write.aiHandling.blindRetryAllowed, false);
    assert.equal(read.executionModel, 'inline');
    assert.equal(write.executionModel, 'managed_task');
    assert.deepEqual(write.outputSchema?.required, ['taskId', 'taskStatus']);
    assert.deepEqual(write.outputSchema?.properties?.taskStatus.enum, ['queued', 'succeeded']);
    assert.deepEqual(write.outputSchema?.properties?.postflight.required, ['verified']);
    assert.match(write.description, /Never retry a write blindly/u);
});
