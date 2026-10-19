import { EditorMcpPluginModule } from '../src/editor-mcp-plugin-module.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { EditorMcpLumenGateway } from '../src/editor-mcp-lumen-gateway.js';
import { EditorMcpResourceFieldRefusal } from '../src/editor-mcp-resource-field-refusal.js';
import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';
import { EditorMcpTextWriteFailure } from '../src/editor-mcp-text-write-failure.js';
import { McpFailurePresenter } from '../../kernel/src/mcp/mcp-failure-presenter.js';
import type { ITaskResult } from '@peanut/pod-protocol';

/** @description 整个隔离工程文件集合与bytes摘要，证明真实多字段codec准备未写源、meta或catalog。 */
function hashTree(root: string): string {
    const hash = createHash('sha256');
    const visit = (path: string): void => {
        for (const name of readdirSync(join(root, path)).sort()) {
            const child = path ? `${path}/${name}` : name; hash.update(child);
            if (statSync(join(root, child)).isDirectory()) visit(child); else hash.update(readFileSync(join(root, child)));
        }
    };
    visit(''); return hash.digest('hex');
}

for (const variant of ['invalid-scalar', 'mixed-patch', 'rolling-friction', 'spinning-friction', 'missing-source', 'post-prepare-failure']) {
    test(`real PhysicsMaterial preparation preserves unchanged proof only before writes: ${variant}`, async () => {
        const root = mkdtempSync('/private/tmp/resource-field-real-'); mkdirSync(join(root, 'assets'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version: '3.8.3' } }));
        const path = 'assets/one.pmtl';
        writeFileSync(join(root, path), JSON.stringify({ __type__: 'cc.PhysicsMaterial', _name: 'original', _friction: 0.5, _restitution: 0.1 }));
        writeFileSync(join(root, `${path}.meta`), JSON.stringify({ uuid: '11111111-1111-4111-8111-111111111111', importer: 'physics-material',
            imported: true, ver: '1.0.0', files: ['.json'], subMetas: {}, userData: {} }));
        const before = hashTree(root); const facade = new RuntimeFacade('3.8.3'); const service = facade.execution;
        const gateway = new EditorMcpLumenGateway(async () => root, null, '3.8.3');
        let writes = 0;
        const executor = new ResourceOperationTaskExecutor({ plan: async (_operation, input) => {
            await gateway.prepareAssetSet(input, input);
            return { operation: 'lumen.assetSet', projectKey: root, requiresProjectWriter: false, resourceKeys: [path] };
        }, execute: async () => { writes += 1; throw new Error('lumen_property_type:after_writer:unexpected'); } });
        const remove = service.registerExecutor('test.resource-field', ResourceOperationTaskExecutor.KIND, {
            concurrency: 'executor_managed', execute: async task => {
                const data = await executor.execute(task.request, { owner: { pluginId: 'test.resource-field', connectionId: 'test',
                    projectKey: root, capability: 'lumen.assetSet' }, signal: service.getTaskAbortSignal(task.taskId),
                    enterCommitWindow: () => service.enterTaskCommitWindow(task.taskId), recordEvidence: () => undefined });
                return { taskId: task.taskId, kind: task.request.kind, data: data as Record<string, unknown>, changes: [] };
            } });
        try {
            const terminal = new Promise<void>(resolve => service.onTaskTerminal(() => resolve()));
            const props = variant === 'rolling-friction' ? { rollingFriction: 'invalid' } : variant === 'spinning-friction' ? { spinningFriction: 'invalid' } : variant === 'post-prepare-failure' ? { name: 'valid' }
                : variant === 'mixed-patch' ? { name: 'changed in memory only', friction: 'invalid' } : { friction: 'invalid' };
            const receipt = await service.submit({ requestId: variant, pluginId: 'test.resource-field', scope: 'project', priority: 'normal',
                kind: ResourceOperationTaskExecutor.KIND, payload: { operation: 'lumen.assetSet', input: {
                    assetRelativePath: variant === 'missing-source' ? 'assets/missing.pmtl' : path, props } } });
            await terminal; const result = await service.getResult(receipt.taskId);
            assert.equal(result?.ok, false); assert.equal(result?.status, 'failed');
            const refusal = EditorMcpResourceFieldRefusal.fromTaskResult(result, receipt.taskId);
            if (['invalid-scalar', 'mixed-patch', 'rolling-friction', 'spinning-friction'].includes(variant)) {
                assert.ok(refusal); assert.equal(writes, 0);
                const dto = McpFailurePresenter.present(refusal);
                assert.equal(dto.category, 'invalid_input'); assert.equal(dto.state, 'unchanged'); assert.equal(dto.taskStatus, 'failed');
                assert.equal(dto.taskId, receipt.taskId); assert.equal(dto.operation, 'lumen.assetSet');
                assert.deepEqual(dto.assetFieldPreparationRefusal, { schemaVersion: 1, code: dto.code, phase: 'prepare_before_writer',
                    projectState: 'unchanged', taskId: receipt.taskId });
                assert.match(dto.code, /^lumen_property_type(?::|$)/u);
                if (variant === 'rolling-friction') assert.equal(dto.code, 'lumen_property_type:rollingFriction:number>=0');
                if (variant === 'spinning-friction') assert.equal(dto.code, 'lumen_property_type:spinningFriction:number>=0');
            } else {
                assert.equal(refusal, null);
                const old = EditorMcpTextWriteFailure.fromTaskResult(result, receipt.taskId, result?.error?.code ?? 'failed');
                assert.equal(McpFailurePresenter.present(old).state, 'unknown');
                assert.equal(writes, variant === 'post-prepare-failure' ? 1 : 0);
            }
            assert.equal(hashTree(root), before);
        } finally { remove(); service.dispose(); rmSync(root, { recursive: true, force: true }); }
    });
}

for (const variant of ['unknown', 'foreign-task', 'wrong-phase', 'changed-code', 'has-changes', 'failed-state']) {
    test(`public field refusal projection rejects unrelated task facts: ${variant}`, () => {
        const code = 'lumen_property_type:friction:number'; const taskId = 'one';
        const proof = { schemaVersion: 1, code, phase: 'prepare_before_writer', projectState: 'unchanged', taskId };
        const result: ITaskResult = { taskId, ok: false, status: 'failed', changes: [], error: { code, message: code },
            data: { projectState: 'unchanged', assetFieldPreparationRefusal: proof }, trace: {} as ITaskResult['trace'] };
        if (variant === 'unknown') Reflect.deleteProperty(result.data as object, 'assetFieldPreparationRefusal');
        if (variant === 'foreign-task') proof.taskId = 'another';
        if (variant === 'wrong-phase') proof.phase = 'after_save';
        if (variant === 'changed-code') proof.code = 'lumen_property_type:other:number';
        if (variant === 'has-changes') Reflect.set(result, 'changes', [{}]);
        if (variant === 'failed-state') Reflect.set(result.data as object, 'projectState', 'unknown');
        assert.equal(EditorMcpResourceFieldRefusal.fromTaskResult(result, taskId), null);
    });
}

test('compatibility wrapper preserves actual preparation DTO and unknown task state', () => {
    const module = new EditorMcpPluginModule();
    const adapt = (error: Error): Error => Reflect.apply(Reflect.get(module, '_asHostCompatibleClientRejection'), module, [error]);
    const code = 'lumen_property_type:friction:number'; const taskId = 'one';
    const result: ITaskResult = { taskId, ok: false, status: 'failed', changes: [], error: { code, message: code }, trace: {} as ITaskResult['trace'],
        data: { projectState: 'unchanged', assetFieldPreparationRefusal: { schemaVersion: 1, code, taskId,
            phase: 'prepare_before_writer', projectState: 'unchanged' } } };
    const proven = EditorMcpResourceFieldRefusal.fromTaskResult(result, taskId); assert.ok(proven);
    assert.equal(adapt(proven), proven); assert.equal(McpFailurePresenter.present(adapt(proven)).state, 'unchanged');
    const unknown = Object.assign(new Error(code), { projectState: 'unknown' });
    assert.equal(adapt(unknown), unknown); assert.equal(McpFailurePresenter.present(adapt(unknown)).state, 'unknown');
});

for (const code of ['lumen_property_type:rollingFriction:number>=0', 'lumen_property_type:spinningFriction:number>=0',
    'lumen_property_type:/private/path:string', 'lumen_property_type:name:secret value', 'lumen_property_type:secret:string',
    'lumen_property_type:name:input-secret']) {
    test('bounded field code through formal Presenter: ' + code, () => {
        const taskId = 'exact-code';
        const result: ITaskResult = { taskId, ok: false, status: 'failed', changes: [], error: { code, message: code }, trace: {} as ITaskResult['trace'],
            data: { projectState: 'unchanged', assetFieldPreparationRefusal: { schemaVersion: 1, code, taskId,
                phase: 'prepare_before_writer', projectState: 'unchanged' } } };
        const error = EditorMcpResourceFieldRefusal.fromTaskResult(result, taskId);
        if (code.includes('Friction:')) { assert.ok(error); assert.equal(McpFailurePresenter.present(error).code, code); }
        else assert.equal(error, null);
        if (code.includes('Friction:')) assert.notEqual(McpFailurePresenter.present(new Error(code)).code, code);
    });
}
