import assert from 'node:assert/strict';
import test from 'node:test';
import type { ITaskRequest } from '@peanut/pod-protocol';
import { ResourceFieldPreparationProof } from '../src/execution/resource-field-preparation-proof.js';
import { ExecutionRuntimeService } from '../src/execution/execution-runtime-service.js';
import { RuntimeFacade } from '../src/cocos/runtime-facade.js';

/** @description 仅测试真实任务输入身份，不为业务JSON提供可调用的证明flag。 */
function fixture() {
    const input = { assetRelativePath: 'assets/one.pmtl', props: { friction: 'bad' } };
    const request: ITaskRequest = { requestId: 'field', pluginId: 'test.field', kind: 'editor-mcp.resource-operation',
        scope: 'project', priority: 'normal', payload: { operation: 'lumen.assetSet', input } };
    const controller = new AbortController(); const error = new Error('lumen_property_type:friction:number');
    return { input, request, controller, error };
}

for (const code of ['lumen_property_type:friction:number', 'lumen_audio_property_not_editable:audio:downloadMode:allowed=']) {
    for (const variant of ['valid', 'outside', 'copy', 'foreign-request', 'foreign-input', 'foreign-signal', 'cancelled',
        'duplicate', 'unknown', 'wrong-operation', 'expired', 'changed-error', 'declared-state', 'changed-input']) {
        test(`asset field preparation original identity: ${code}/${variant}`, async () => {
            const f = fixture(); f.error.message = code;
            const failure = variant === 'unknown' ? new Error('EIO: disk read') : f.error;
            const request = variant === 'wrong-operation' ? { ...f.request, payload: { operation: 'asset.copy', input: f.input } } : f.request;
            if (variant === 'outside') ResourceFieldPreparationProof.record(failure, f.input);
            else await ResourceFieldPreparationProof.run(request, f.controller.signal, async () => {
                if (variant !== 'expired') ResourceFieldPreparationProof.record(failure, variant === 'foreign-input' ? { ...f.input } : f.input);
                if (variant === 'duplicate') ResourceFieldPreparationProof.record(failure, f.input);
            });
            if (variant === 'expired') ResourceFieldPreparationProof.record(failure, f.input);
            if (variant === 'cancelled') f.controller.abort();
            if (variant === 'changed-error') failure.message = 'lumen_property_type:friction:changed';
            if (variant === 'changed-input') f.input.props.friction = 'changed';
            if (variant === 'declared-state') Object.defineProperty(failure, 'projectState', { value: 'unchanged' });
            const actual = ResourceFieldPreparationProof.take(variant === 'copy' ? new Error(failure.message) : failure,
                variant === 'foreign-request' ? { ...request } : request,
                variant === 'foreign-signal' ? new AbortController().signal : f.controller.signal);
            assert.equal(actual, variant === 'valid' ? f.error.message : null);
            assert.equal(ResourceFieldPreparationProof.take(failure, request, f.controller.signal), variant === 'copy' ? f.error.message : null);
        });
    }

}

for (const code of ['lumen_property_type:friction:number', 'lumen_audio_property_not_editable:audio:downloadMode:allowed=']) {
    for (const enterWriter of [false, true]) {
        test(`actual Runtime field preparation failure preserves failed state, code=${code}, writer=${enterWriter}`, async () => {
            const facade = new RuntimeFacade('3.8.3'); const service = facade.execution;
            const pluginId = 'test.field'; const kind = 'editor-mcp.resource-operation';
            const remove = service.registerExecutor(pluginId, kind, { concurrency: 'executor_managed', execute: async task => {
                const signal = service.getTaskAbortSignal(task.taskId);
                return ExecutionRuntimeService.withResourceFieldPreparation(task.request, signal, async () => {
                    const error = new Error(code);
                    ResourceFieldPreparationProof.record(error, Reflect.get(task.request.payload as object, 'input'));
                    if (enterWriter) assert.equal(service.enterTaskCommitWindow(task.taskId), true);
                    throw error;
                });
            } });
            try {
                const terminal = new Promise<void>(resolve => service.onTaskTerminal(() => resolve()));
                const f = fixture(); const receipt = await service.submit(f.request);
                await terminal; const result = await service.getResult(receipt.taskId);
                assert.equal(result?.ok, false); assert.equal(result?.status, 'failed');
                const data = result?.data as Record<string, unknown>;
                if (enterWriter) { assert.equal(data.assetFieldPreparationRefusal, undefined); assert.equal(data.projectState, 'unknown'); }
                else {
                    assert.equal(data.projectState, 'unchanged');
                    assert.deepEqual(data.assetFieldPreparationRefusal, { schemaVersion: 1, code,
                        phase: 'prepare_before_writer', projectState: 'unchanged', taskId: receipt.taskId });
                }
            } finally { remove(); service.dispose(); }
        });
    }

}

for (const code of [
    'lumen_audio_property_not_editable:audio.downloadMode',
    'lumen_audio_property_not_editable:audio:other:allowed=',
    'lumen_audio_property_not_editable:audio:downloadMode:allowed=name',
    'lumen_audio_property_not_editable:video:downloadMode:allowed=',
    'lumen_audio_property_not_editable:audio:downloadMode:allowed= ',
    'lumen_audio_property_not_editable:audio:downloadMode:allowed=\n',
]) {
    test('readonly near-code cannot acquire preparation proof: ' + JSON.stringify(code), async () => {
        const f = fixture(); const error = new Error(code);
        await ResourceFieldPreparationProof.run(f.request, f.controller.signal, async () => {
            ResourceFieldPreparationProof.record(error, f.input);
        });
        assert.equal(ResourceFieldPreparationProof.isSafeCode(code), false);
        assert.equal(ResourceFieldPreparationProof.take(error, f.request, f.controller.signal), null);
    });
}
