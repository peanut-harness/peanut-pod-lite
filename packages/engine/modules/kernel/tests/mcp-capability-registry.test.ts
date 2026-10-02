import assert from 'assert/strict';
import test from 'node:test';
import type { IMcpJsonSchema } from '@peanut/pod-protocol';

import { McpCapabilityRegistry } from '../src/mcp/mcp-capability-registry.js';
import { McpControlFlowRefusal } from '../src/mcp/mcp-control-flow-refusal.js';
import { CoreTextFileIoContract } from '../../policy/src/core-text-file-io-contract.ts';
import type { ICoreMcpJsonSchema } from '../../policy/src/core-cocos-mcp-read-tool-schema-catalog.ts';

/**
 * @description 无损转入带协议索引签名的 schema，不使用类型断言绕过递归 DTO 边界。
 * @param schema Core 公共输入契约。
 * @returns 含相同约束的注册表契约。
 */
function schemaForRegistry(schema: ICoreMcpJsonSchema): IMcpJsonSchema {
    const { properties, items, oneOf, ...scalarConstraints } = schema;
    const result: IMcpJsonSchema = {
        ...scalarConstraints,
        ...(properties == null ? {} : { properties: Object.fromEntries(Object.entries(properties).map(([key, child]) => [key, schemaForRegistry(child)])) }),
        ...(items == null ? {} : { items: schemaForRegistry(items) }),
        ...(oneOf == null ? {} : { oneOf: oneOf.map(schemaForRegistry) }),
    };
    assert.deepEqual(result, schema);
    return result;
}

test('Kernel validates the public nullable text result including failed-content exclusion', async (): Promise<void> => {
    const registry = new McpCapabilityRegistry();
    let output: unknown = { schemaVersion: 1, ok: false, consistent: false, revision: null,
        files: [{ path: 'assets/missing.txt', status: 'failed', code: 'text_file_io_not_found' }] };
    registry.register('peanut.example', {
        name: 'peanut.example.text-result', description: '文本逐项结果', category: 'cocos',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        outputSchema: schemaForRegistry(CoreTextFileIoContract.readOutputSchema()), readOnly: true, risk: 'read',
    }, async () => output);
    assert.deepEqual(await registry.invoke('peanut.example.text-result', {}, { connectionId: 'test' }), output);
    output = { schemaVersion: 1, ok: false, consistent: false, revision: null,
        files: [{ path: 'assets/missing.txt', status: 'failed', code: 'text_file_io_not_found', content: 'leak' }] };
    await assert.rejects(() => registry.invoke('peanut.example.text-result', {}, { connectionId: 'test' }), /output_invalid/);
});

test('MCP capability registry should validate, expose, invoke, and revoke plugin-scoped capabilities', async (): Promise<void> => {
    const registry = new McpCapabilityRegistry();
    const dispose = registry.register('peanut.example', {
        name: 'peanut.example.echo',
        description: { 'en-US': 'Returns schema-validated text.', 'zh-CN': '返回受 schema 校验的文本。' },
        category: 'atom',
        inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
        },
        outputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
        },
        readOnly: true,
        risk: 'read',
    }, async (input): Promise<unknown> => ({ text: input.text }));

    assert.equal(registry.getCatalog().revision, 1);
    assert.deepEqual(registry.getCatalog().capabilities.map((capability) => capability.name), ['peanut.example.echo']);
    assert.deepEqual(registry.getCatalog().capabilities[0]?.description, { 'en-US': 'Returns schema-validated text.', 'zh-CN': '返回受 schema 校验的文本。' });
    assert.deepEqual(await registry.invoke('peanut.example.echo', { text: 'hello' }, { connectionId: 'a'.repeat(32) }), { text: 'hello' });
    await assert.rejects(registry.invoke('peanut.example.echo', { extra: true }, { connectionId: 'a'.repeat(32) }), /mcp_capability_input_invalid/);

    const disposeInvalidOutput = registry.register('peanut.example', {
        name: 'peanut.example.invalid-output',
        description: 'Returns output that violates its declared schema.',
        category: 'atom',
        inputSchema: { type: 'object', additionalProperties: false },
        outputSchema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false },
        readOnly: true,
        risk: 'read',
    }, async (): Promise<unknown> => ({ count: 'not-an-integer' }));
    await assert.rejects(registry.invoke('peanut.example.invalid-output', {}, { connectionId: 'a'.repeat(32) }), /mcp_capability_output_invalid/);

    dispose();
    disposeInvalidOutput();
    assert.equal(registry.getCatalog().capabilities.length, 0);
    await assert.rejects(registry.invoke('peanut.example.echo', { text: 'hello' }, { connectionId: 'a'.repeat(32) }), /mcp_capability_unavailable/);
});

test('invokeForPlugin runs registered write tools when Hub exposure is read_only or disabled', async (): Promise<void> => {
    const registry = new McpCapabilityRegistry();
    let seenCaller: string | undefined;
    registry.register('peanut.example', {
        name: 'peanut.example.write',
        description: { 'en-US': 'Write tool.', 'zh-CN': '写工具。' },
        category: 'workflow',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: false,
        risk: 'write',
    }, async (_input, invocation): Promise<unknown> => {
        seenCaller = invocation.callerPluginId;
        return { ok: true };
    });
    await assert.rejects(registry.invoke('peanut.example.write', {}, { connectionId: 'a'.repeat(32) }), /mcp_capability_unavailable/);
    assert.deepEqual(await registry.invokeForPlugin('peanut.ui-prefab', 'peanut.example.write', {}), { ok: true });
    assert.equal(seenCaller, 'peanut.ui-prefab');
    registry.setPluginExposure('peanut.example', 'disabled');
    assert.deepEqual(await registry.invokeForPlugin('peanut.ui-prefab', 'peanut.example.write', {}), { ok: true });
    await assert.rejects(registry.invokeForPlugin('peanut.ui-prefab', 'peanut.example.missing', {}), /mcp_capability_unregistered/);
    await assert.rejects(registry.invokeForPlugin('bad', 'peanut.example.write', {}), /mcp_capability_plugin_id_invalid/);
});

test('MCP capability registry should reject unscoped names and inconsistent risk definitions', (): void => {
    const registry = new McpCapabilityRegistry();
    assert.throws(() => registry.register('peanut.example', {
        name: 'other.echo',
        description: '无效名称。',
        category: 'atom',
        inputSchema: { type: 'object' },
        readOnly: true,
        risk: 'read',
    }, async (): Promise<unknown> => null), /mcp_capability_name_not_plugin_scoped/);
    assert.throws(() => registry.register('peanut.example', {
        name: 'peanut.example.write',
        description: '风险声明错误。',
        category: 'workflow',
        inputSchema: { type: 'object' },
        readOnly: true,
        risk: 'write',
    }, async (): Promise<unknown> => null), /mcp_capability_definition_invalid/);
    assert.throws(() => registry.register('peanut.example', {
        name: 'peanut.example.bad-guidance',
        description: 'Invalid AI handling guidance.',
        category: 'workflow',
        inputSchema: { type: 'object' },
        readOnly: true,
        risk: 'read',
        aiHandling: {
            schemaVersion: 1,
            successSignals: [],
            failureField: 'failure',
            unknownStateAction: 'query_before_retry',
            blindRetryAllowed: false,
        },
    }, async (): Promise<unknown> => null), /mcp_capability_ai_handling_invalid/);
    assert.throws(() => registry.register('peanut.example', {
        name: 'peanut.example.invalid-execution-model',
        description: '执行模型无效。',
        category: 'workflow',
        inputSchema: { type: 'object' },
        readOnly: false,
        risk: 'write',
        executionModel: 'background' as never,
    }, async (): Promise<unknown> => null), /mcp_capability_execution_model_invalid/);
    assert.throws(() => registry.register('peanut.example', {
        name: 'peanut.example.managed-read',
        description: '只读能力不得声明受管写任务。',
        category: 'workflow',
        inputSchema: { type: 'object' },
        readOnly: true,
        risk: 'read',
        executionModel: 'managed_task',
    }, async (): Promise<unknown> => null), /mcp_capability_execution_model_invalid/);
});

test('control-flow refusal must not report diagnostic / still rejects invoke', async (): Promise<void> => {
    const reports: unknown[] = [];
    const registry = new McpCapabilityRegistry((pluginId, error, context) => {
        reports.push({ pluginId, error, context });
    });
    registry.register('peanut.example', {
        name: 'peanut.example.gated',
        description: { 'en-US': 'Gated write.', 'zh-CN': 'gate write' },
        category: 'workflow',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: false,
        risk: 'write',
    }, async (): Promise<unknown> => {
        return McpControlFlowRefusal.reject('core_cocos_mcp_execution_approval_required:asset.catalog.refresh');
    });
    registry.setPluginExposure('peanut.example', 'all');
    await assert.rejects(
        registry.invoke('peanut.example.gated', {}, { connectionId: 'a'.repeat(32) }),
        /core_cocos_mcp_execution_approval_required:asset\.catalog\.refresh/,
    );
    assert.equal(reports.length, 0, 'expected gate refusal must not hit diagnostic reporter');
});

test('silent_replace_target_not_found Error is control-flow (no diagnostic)', async (): Promise<void> => {
    const reports: unknown[] = [];
    const registry = new McpCapabilityRegistry((pluginId, error, context) => {
        reports.push({ pluginId, error, context });
    });
    registry.register('peanut.example', {
        name: 'peanut.example.replace',
        description: { 'en-US': 'Replace.', 'zh-CN': 'replace' },
        category: 'workflow',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: false,
        risk: 'destructive',
    }, async (): Promise<unknown> => {
        throw new Error('silent_replace_target_not_found:ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee');
    });
    registry.setPluginExposure('peanut.example', 'all');
    await assert.rejects(
        registry.invoke('peanut.example.replace', {}, { connectionId: 'a'.repeat(32) }),
        /silent_replace_target_not_found:ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee/,
    );
    assert.equal(reports.length, 0, 'expected missing-target replace must not hit diagnostic reporter');
});

test('unexpected handler Error still reports diagnostic', async (): Promise<void> => {
    const reports: unknown[] = [];
    const registry = new McpCapabilityRegistry((pluginId, error) => {
        reports.push({ pluginId, error });
    });
    registry.register('peanut.example', {
        name: 'peanut.example.boom',
        description: { 'en-US': 'Boom.', 'zh-CN': 'boom' },
        category: 'atom',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: true,
        risk: 'read',
    }, async (): Promise<unknown> => {
        throw new Error('module_load_failed:boom');
    });
    await assert.rejects(registry.invoke('peanut.example.boom', {}, { connectionId: 'a'.repeat(32) }), /module_load_failed/);
    assert.equal(reports.length, 1);
});

test('structured task failure reaches the caller without duplicate diagnostic logging', async (): Promise<void> => {
    const reports: unknown[] = [];
    const registry = new McpCapabilityRegistry((pluginId, error) => {
        reports.push({ pluginId, error });
    });
    const failure = Object.assign(new Error('silent_copy_seed_missing:assets/missing.json'), {
        mcpFailure: {
            schemaVersion: 1,
            code: 'silent_copy_seed_missing',
            category: 'execution_failed',
            reason: 'The operation failed without a safely confirmed final project state.',
            retryable: false,
            state: 'unknown',
            recommendedAction: 'stop',
            taskId: 'task-1',
            taskStatus: 'failed',
            operation: 'asset.copy',
        },
    });
    registry.register('peanut.example', {
        name: 'peanut.example.copy',
        description: 'Copy an asset.',
        category: 'cocos',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: true,
        risk: 'read',
    }, async (): Promise<unknown> => {
        throw failure;
    });

    await assert.rejects(registry.invoke('peanut.example.copy', {}, { connectionId: 'a'.repeat(32) }), (error) => error === failure);
    assert.equal(reports.length, 0);
});

test('public text read schema enforces exclusive path forms and 32-file bounds before handler', async (): Promise<void> => {
    const reports: unknown[] = [];
    let calls = 0;
    const registry = new McpCapabilityRegistry((_plugin, error) => reports.push(error));
    registry.register('peanut.example', {
        name: 'peanut.example.read-text', description: 'Read bounded text.', category: 'cocos',
        inputSchema: schemaForRegistry(CoreTextFileIoContract.readInputSchema()), readOnly: true, risk: 'read',
    }, async (): Promise<unknown> => { calls += 1; return { ok: true }; });
    const invocation = { connectionId: 'a'.repeat(32) };
    const paths = Array.from({ length: 32 }, (_, index) => `assets/${index}.txt`);
    for (const input of [{}, { path: 'assets/a.txt', paths: ['assets/b.txt'] }, { paths: [] },
        { paths: [...paths, 'assets/extra.txt'] }, { path: 'assets/a.txt', extra: true }]) {
        await assert.rejects(registry.invoke('peanut.example.read-text', input, invocation), /mcp_capability_input_invalid/u);
    }
    assert.equal(calls, 0);
    assert.equal(reports.length, 0);
    await registry.invoke('peanut.example.read-text', { paths }, invocation);
    await registry.invoke('peanut.example.read-text', { path: 'assets/a.txt' }, invocation);
    assert.equal(calls, 2);
});

test('public text write patterns reject malformed preconditions in the final file before handler', async (): Promise<void> => {
    let calls = 0;
    const registry = new McpCapabilityRegistry();
    registry.register('peanut.example', {
        name: 'peanut.example.write-text', description: 'Write bounded text.', category: 'cocos',
        inputSchema: schemaForRegistry({ type: 'object', properties: CoreTextFileIoContract.writeProperties(), additionalProperties: false }),
        readOnly: false, risk: 'write',
    }, async (): Promise<unknown> => { calls += 1; return { ok: true }; });
    registry.setPluginExposure('peanut.example', 'all');
    const invocation = { connectionId: 'a'.repeat(32) };
    for (const expectedSha256 of ['bad', 'a'.repeat(63), `${'a'.repeat(64)}\n`, 'absent\r', null]) {
        const input = { files: [{ path: 'assets/first.txt', content: 'first' }, { path: 'assets/last.txt', content: 'last', expectedSha256 }] };
        await assert.rejects(registry.invoke('peanut.example.write-text', input, invocation), /mcp_capability_input_invalid/u);
    }
    assert.equal(calls, 0);
    for (const expectedSha256 of ['absent', 'a'.repeat(64), 'A'.repeat(64)]) {
        await registry.invoke('peanut.example.write-text', { path: 'assets/a.txt', content: 'new', expectedSha256 }, invocation);
    }
    await registry.invoke('peanut.example.write-text', { path: 'assets/ignored.txt', content: 'ignored',
        files: [{ path: 'assets/selected.txt', content: 'selected' }] }, invocation);
    assert.equal(calls, 4);
});

test('patterns also validate outputs and malformed published patterns fail closed', async (): Promise<void> => {
    const registry = new McpCapabilityRegistry();
    registry.register('peanut.example', {
        name: 'peanut.example.bad-pattern', description: 'Invalid pattern.', category: 'atom',
        inputSchema: { type: 'object', properties: { value: { type: 'string', pattern: '[' } }, required: ['value'] },
        readOnly: true, risk: 'read',
    }, async (): Promise<unknown> => { throw new Error('handler_must_not_run'); });
    await assert.rejects(registry.invoke('peanut.example.bad-pattern', { value: 'x' }, { connectionId: 'a'.repeat(32) }), /mcp_capability_input_invalid/u);
    registry.register('peanut.example', {
        name: 'peanut.example.pattern-output', description: 'Validate output.', category: 'atom',
        inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { hash: { type: 'string', pattern: '^[a-f]{64}(?![\\s\\S])' } }, required: ['hash'] },
        readOnly: true, risk: 'read',
    }, async (): Promise<unknown> => ({ hash: 'incorrect' }));
    await assert.rejects(registry.invoke('peanut.example.pattern-output', {}, { connectionId: 'a'.repeat(32) }), /mcp_capability_output_invalid/u);
});

test('legacy implicit closed objects, explicit open objects and existing integer semantics remain', async (): Promise<void> => {
    const registry = new McpCapabilityRegistry();
    registry.register('peanut.example', {
        name: 'peanut.example.closed', description: 'Legacy object.', category: 'atom',
        inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
        readOnly: true, risk: 'read',
    }, async (): Promise<unknown> => ({ ok: true }));
    await assert.rejects(registry.invoke('peanut.example.closed', { value: 1, extra: true }, { connectionId: 'a'.repeat(32) }), /mcp_capability_input_invalid/u);
    await registry.invoke('peanut.example.closed', { value: Number.MAX_SAFE_INTEGER + 1 }, { connectionId: 'a'.repeat(32) });
    registry.register('peanut.example', {
        name: 'peanut.example.open', description: 'Legacy open object.', category: 'atom',
        inputSchema: { type: 'object', additionalProperties: true }, readOnly: true, risk: 'read',
    }, async (input): Promise<unknown> => ({ extra: input.extra }));
    assert.deepEqual(await registry.invoke('peanut.example.open', { extra: 'allowed' }, { connectionId: 'a'.repeat(32) }), { extra: 'allowed' });
});
