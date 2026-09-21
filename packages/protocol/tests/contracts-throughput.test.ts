import assert from 'assert/strict';
import test from 'node:test';

import {
    THROUGHPUT_CONTRACT_LIMITS,
    ThroughputContractValidator,
    type IThroughputBatchStatusSummary,
    type IThroughputHealthSnapshot,
    type IMcpFailureDetails,
} from '../src/index';

test('throughput batch DTO accepts compatible input and preserves conservative status', (): void => {
    const request = ThroughputContractValidator.parseBatchRequest({
        requestId: 'batch-contracts',
        idempotencyKey: 'batch-contracts-key',
        items: [
            { itemId: 'prepare', operation: 'lumen.compSet', input: { path: 'assets/a.prefab' } },
            { itemId: 'commit', operation: 'lumen.commit', input: { paths: ['assets/a.prefab'] }, dependsOn: ['prepare'] },
        ],
    });
    const status: IThroughputBatchStatusSummary = {
        batchId: 'batch:contracts',
        stage: 'terminal',
        status: 'failed',
        total: 2,
        completed: 1,
        failed: 1,
        pending: 0,
        projectState: 'may_have_changed',
        outcomes: [
            { itemId: 'prepare', taskId: 'task:prepare', ok: true, committed: true, summary: 'Prepared.' },
            { itemId: 'commit', taskId: 'task:commit', ok: false, committed: false, summary: 'Commit failed.', errorCode: 'commit_failed' },
        ],
    };

    assert.equal(request.items.length, 2);
    assert.equal(status.projectState, 'may_have_changed');
});

test('throughput batch DTO rejects item, byte, dependency, and unknown-field violations', (): void => {
    const tooManyItems = Array.from({ length: THROUGHPUT_CONTRACT_LIMITS.maxBatchItems + 1 }, (_, index) => ({
        itemId: `item-${index}`,
        operation: 'asset.copy',
        input: {},
    }));
    assert.throws(
        () => ThroughputContractValidator.parseBatchRequest({ requestId: 'too-many', items: tooManyItems }),
        /throughput_batch_items_limit_exceeded/u,
    );
    assert.throws(
        () => ThroughputContractValidator.parseBatchRequest({
            requestId: 'too-large',
            items: [{ itemId: 'large', operation: 'asset.writeText', input: { text: 'x'.repeat(THROUGHPUT_CONTRACT_LIMITS.maxBatchInputBytes + 1) } }],
        }),
        /throughput_batch_input_limit_exceeded/u,
    );
    assert.throws(
        () => ThroughputContractValidator.parseBatchRequest({
            requestId: 'dependency',
            items: [{ itemId: 'a', operation: 'asset.copy', input: {}, dependsOn: ['missing'] }],
        }),
        /throughput_batch_dependency_invalid/u,
    );
    assert.throws(
        () => ThroughputContractValidator.parseBatchRequest({ requestId: 'unknown', items: [], token: 'secret' }),
        /throughput_batch_request_unknown_field/u,
    );
});

test('overload and metrics DTOs remain bounded and content-free', (): void => {
    const overload = ThroughputContractValidator.parseOverloadFailure({
        code: 'throughput_overloaded',
        category: 'overloaded',
        rejectedAt: 'admission',
        projectState: 'not_started',
        retryAfterMs: 100,
        queue: { connectionInFlight: 8, connectionQueued: 32, saturated: true },
    });
    const health: IThroughputHealthSnapshot = {
        windowMs: 60_000,
        observedAt: '2026-09-21T00:00:00.000Z',
        classes: [{
            costClass: 'read_light',
            accepted: 10,
            rejected: 1,
            inFlight: 2,
            queued: 3,
            queueWaitP95Ms: 5,
            executionP95Ms: 8,
        }],
        writerHoldP95Ms: 12,
        settleP95Ms: 20,
        eventLoopLagP95Ms: 2,
        rssHighWaterBytes: 1024,
        coalescedReads: 4,
        cacheHits: 6,
        gcRemoved: 7,
    };
    const failure: IMcpFailureDetails = {
        schemaVersion: 1,
        code: overload.code,
        category: 'overloaded',
        reason: 'The request was not started because the bounded queue is full.',
        retryable: true,
        state: 'not_started',
        recommendedAction: 'retry_with_backoff',
        retryAfterMs: overload.retryAfterMs,
        queue: overload.queue,
    };

    assert.equal(overload.retryAfterMs, 100);
    assert.equal(failure.category, 'overloaded');
    assert.equal('connectionId' in overload.queue, false);
    assert.equal('input' in health, false);
    assert.throws(
        () => ThroughputContractValidator.parseOverloadFailure({ ...overload, retryAfterMs: 0 }),
        /throughput_overload_retry_after_invalid/u,
    );
    assert.throws(
        () => ThroughputContractValidator.parseOverloadFailure({ ...overload, resourcePath: 'assets/private.prefab' }),
        /throughput_overload_unknown_field/u,
    );
});
