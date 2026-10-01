import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CoreCocosMcpExecutionDispatcher,
    CoreCocosMcpOperationThroughputProfileCatalog,
    CoreCocosMcpToolDefinitionCatalog,
    CoreTextFileIoContract,
} from '../dist/index.js';
import { CoreMcpInputValidator } from '../dist/core-mcp-input-validator.js';

const catalog = new CoreCocosMcpToolDefinitionCatalog();
const validator = new CoreMcpInputValidator();

test('text read is public, approval-free, uncached and ordered behind writers', () => {
    const definition = catalog.findByOperation('asset.readText');
    assert.ok(definition);
    assert.equal(definition.name, 'peanut.editor-mcp.asset-read-text');
    assert.equal(definition.readOnly, true);
    assert.equal(definition.requiresLocalApproval, false);
    assert.equal(definition.executionModel, 'inline');
    assert.deepEqual(definition.aiHandling.successSignals, [
        'response.ok=true', 'result.ok=true', 'result.consistent=true', 'result.files[*].status=read',
    ]);
    assert.deepEqual(new CoreCocosMcpOperationThroughputProfileCatalog().find('asset.readText')?.read, {
        coalescing: 'none', cache: 'none', consistency: 'writer_barrier',
    });
    assert.equal(definition.throughput.costClass, 'read_heavy');
});

test('read schema rejects missing, conflicting, empty, unknown and over-limit inputs', () => {
    const schema = CoreTextFileIoContract.readInputSchema();
    assert.equal(validator.validate(schema, { path: 'assets/a.ts' }), true);
    assert.equal(validator.validate(schema, { paths: ['assets/a.ts', 'assets/b.js'] }), true);
    assert.equal(validator.validate(schema, { paths: Array.from({ length: 32 }, (_, i) => `assets/${i}.ts`) }), true);
    for (const input of [
        {}, { path: 'assets/a.ts', paths: ['assets/b.ts'] }, { paths: [] },
        { paths: Array.from({ length: 33 }, (_, i) => `assets/${i}.ts`) },
        { path: 'assets/a.ts', token: 'extra' }, { paths: [null] },
    ]) {
        assert.equal(validator.validate(schema, input), false, JSON.stringify(input));
    }
});

test('write schema preserves legacy input and control fields while bounding files and hashes', () => {
    const definition = catalog.findByOperation('asset.writeText');
    assert.ok(definition);
    assert.equal(definition.readOnly, false);
    assert.equal(definition.requiresLocalApproval, true);
    assert.equal(definition.executionModel, 'managed_task');
    const schema = definition.inputSchema;
    const file = { path: 'assets/a.ts', content: '\uFEFF雪\r\n', expectedSha256: 'a'.repeat(64) };
    assert.equal(validator.validate(schema, { path: 'assets/a.ts', content: '' }), true);
    assert.equal(validator.validate(schema, { ...file, expectedSha256: 'absent', approvalToken: 'lease' }), true);
    assert.equal(validator.validate(schema, { path: 'ignored.ts', content: 'ignored', files: [file], execution: { mode: 'async' } }), true);
    assert.equal(validator.validate(schema, { files: [{ ...file, expectedSha256: 'A'.repeat(64) }] }), true);
    for (const input of [
        { files: [] }, { files: Array.from({ length: 33 }, () => file) },
        { ...file, expectedSha256: 'invalid' }, { files: [{ ...file, expectedSha256: 'a'.repeat(63) }] },
        { ...file, expectedSha256: 'a'.repeat(64) + '\n' },
        { files: [{ path: 'assets/a.ts' }] }, { files: [{ ...file, bytes: 1 }] },
    ]) {
        assert.equal(validator.validate(schema, input), false);
    }
    assert.deepEqual(CoreTextFileIoContract.limits, {
        maxFiles: 32, maxFileBytes: 1024 * 1024, maxInputBytes: 4 * 1024 * 1024, maxOutputBytes: 4 * 1024 * 1024,
    });
});

test('injected capacities determine public read and write file counts', () => {
    const limits = { ...CoreTextFileIoContract.limits, maxFiles: 2 };
    const read = CoreTextFileIoContract.readInputSchema(limits);
    const files = Array.from({ length: 3 }, (_, i) => ({ path: `assets/${i}.ts`, content: '' }));
    const write = { type: 'object' as const, properties: CoreTextFileIoContract.writeProperties(limits), additionalProperties: false };
    assert.equal(validator.validate(read, { paths: files.slice(0, 2).map((file) => file.path) }), true);
    assert.equal(validator.validate(read, { paths: files.map((file) => file.path) }), false);
    assert.equal(validator.validate(write, { files: files.slice(0, 2) }), true);
    assert.equal(validator.validate(write, { files }), false);
});

test('dispatcher refuses invalid text read before calling the adapter', async () => {
    let calls = 0;
    const dispatcher = new CoreCocosMcpExecutionDispatcher([
        { operations: ['asset.readText'], execute: async () => ++calls },
    ]);
    await assert.rejects(() => dispatcher.execute('asset.readText', { paths: [] }), /schema_invalid/u);
    assert.equal(calls, 0);
    assert.equal(await dispatcher.execute('asset.readText', { path: 'assets/a.ts' }), 1);
});

test('successful read output requires per-file digest, byte count and revision evidence', () => {
    const schema = CoreTextFileIoContract.readOutputSchema();
    const file = { path: 'assets/a.ts', status: 'read', content: '', byteCount: 0, sha256: 'a'.repeat(64), revision: 5 };
    const result = { schemaVersion: 1, ok: true, consistent: true, revision: 5, files: [file] };
    assert.equal(validator.validate(schema, result), true);
    assert.equal(validator.validate(schema, { ...result, files: [{ ...file, sha256: 'bad' }] }), false);
    assert.equal(validator.validate(schema, { ...result, files: [{ path: file.path, status: 'read' }] }), false);
    assert.equal(validator.validate(schema, { ...result, files: [] }), false);
    const { byteCount, ...withoutByteCount } = file;
    assert.equal(validator.validate(schema, { ...result, files: [{ ...withoutByteCount, bytes: byteCount }] }), false);
});
