import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceStabilityPreparationRefusal as Refusal } from '../scripts/resource-stability-preparation-refusal.mts';

/**
 * @description 合成DTO只检验传输边界，不能构成实机失败任务或无写证明。
 */
export function refusalPayload(code = 'lumen_property_type:speed:number>0') {
    return { ok: false, error: code, failure: { schemaVersion: 1, code, category: 'invalid_input', state: 'unchanged',
        retryable: true, recommendedAction: 'fix_input', operation: 'lumen.assetSet', taskId: 'synthetic-task', taskStatus: 'failed',
        assetFieldPreparationRefusal: { schemaVersion: 1, code, phase: 'prepare_before_writer', projectState: 'unchanged', taskId: 'synthetic-task' } } };
}

test('preparation refusal retains the real failed task and excludes unknown response fields', () => {
    const payload = { ...refusalPayload(), input: { approvalToken: 'must-not-retain' } };
    const refusal = Refusal.fromResponse(payload, 'peanut.editor-mcp.lumen-asset-set'); assert.ok(refusal);
    assert.equal(refusal.failure.taskStatus, 'failed');
    assert.equal(JSON.stringify(refusal.failure).includes('must-not-retain'), false);
    assert.equal(Object.isFrozen(refusal.failure), true);
    assert.equal(Refusal.fromResponse(payload, 'peanut.editor-mcp.asset-import'), null);
});

test('a code string, missing marker, unknown state, wrong operation or mismatched task is never a trusted refusal', () => {
    const variants: unknown[] = [null, { ok: false, error: 'lumen_property_type:speed:number>0' }];
    for (const patch of [{ state: 'unknown' }, { taskStatus: 'rejected' }, { operation: 'lumen.compSet' },
        { assetFieldPreparationRefusal: null }, { code: 'other' }, { taskId: 'different-task' }, { category: 'execution_failed' }]) {
        const payload = refusalPayload(); variants.push({ ...payload, failure: { ...payload.failure, ...patch } });
    }
    for (const payload of variants) assert.equal(Refusal.fromResponse(payload, 'peanut.editor-mcp.lumen-asset-set'), null);
});
