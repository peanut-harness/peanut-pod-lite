import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { TextFileIoGuard } from '@peanut/pod-engine/assets';
import { CocosMcpHub, PluginManagerApp } from '@peanut/pod-engine/kernel';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { ResourceLockManager, RuntimeFacade } from '@peanut/pod-engine/runtime';
import type { ITextFileIoLimits, ITextFileReadResult } from '@peanut/pod-protocol';
import { EditorMcpTextReadGateway } from '../src/editor-mcp-text-read-gateway.js';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import { EditorMcpToolCatalog } from '../src/editor-mcp-tool-catalog.js';
import { CoreMcpInputValidator } from '../../policy/src/core-mcp-input-validator.js';

/**
 * @description 创建临时工程及真实 Hub，不伪造版本或目录版本。
 * @param limits 可选缩小容量。
 * @returns 隔离的真实读入口。
 */
function fixture(limits: ITextFileIoLimits = CoreTextFileIoContract.limits) {
    const project = mkdtempSync(join(tmpdir(), 'peanut-text-read-'));
    mkdirSync(join(project, 'assets'));
    const locks = new ResourceLockManager();
    const gateway = new EditorMcpTextReadGateway(locks, limits);
    const manager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => manager, { projectPath: project });
    const definition = new EditorMcpToolCatalog().buildDefinitions([
        { operation: 'asset.readText', readOnly: true, risk: 'read', requiresInput: true, description: '读取文本', lane: 'lumen-offline' },
    ])[0];
    assert.ok(definition);
    manager.getMcpCapabilityRegistry().register('peanut.editor-mcp', definition,
        (input, invocation) => gateway.read(project, input, invocation));
    return {
        project, locks, gateway, hub, manager,
        read: async (input: unknown, signal?: AbortSignal): Promise<ITextFileReadResult> => {
            const result = await hub.invokeFromHost(definition.name, input, { connectionId: 'a'.repeat(32), signal });
            assert.ok(isResult(result));
            return result;
        },
        dispose: (): void => rmSync(project, { recursive: true, force: true }),
    };
}

/**
 * @description 通过公开 Core 契约收窄实际执行结果。
 * @param value 未知执行结果。
 * @returns 是否满足文本 DTO。
 */
function isResult(value: unknown): value is ITextFileReadResult {
    return typeof value === 'object' && value != null && Reflect.get(value, 'schemaVersion') === 1
        && new CoreMcpInputValidator().validate(CoreTextFileIoContract.readOutputSchema(), value);
}

test('real Hub reads ordered BOM, CRLF, Unicode, empty and missing files with actual byte digests', async () => {
    const f = fixture();
    try {
        const content = '\uFEFF雪🙂\r\n';
        writeFileSync(join(f.project, 'assets/a.ts'), content);
        writeFileSync(join(f.project, 'assets/empty.txt'), '');
        const result = await f.read({ paths: ['db://assets/a.ts', 'assets/empty.txt', 'assets/missing.ts'] });
        assert.equal(result.ok, false);
        assert.equal(result.consistent, true);
        assert.equal(result.revision, f.hub.getProjectRevisionSnapshot().revision);
        assert.equal(result.revision, 0, 'catalog registration must not be used as project revision');
        assert.deepEqual(result.files, [
            { path: 'assets/a.ts', status: 'read', content, byteCount: Buffer.byteLength(content),
                sha256: createHash('sha256').update(content).digest('hex'), revision: 0 },
            { path: 'assets/empty.txt', status: 'read', content: '', byteCount: 0,
                sha256: createHash('sha256').update('').digest('hex'), revision: 0 },
            { path: 'assets/missing.ts', status: 'failed', code: 'text_file_io_not_found' },
        ]);
        f.hub.notifyExternalProjectChange();
        assert.equal((await f.read({ path: 'assets/a.ts' })).revision, 1);
    } finally { f.dispose(); }
});

test('illegal UTF-8 and binary text retain failed outcomes without leaking content', async () => {
    const f = fixture();
    try {
        writeFileSync(join(f.project, 'assets/valid.txt'), 'valid');
        writeFileSync(join(f.project, 'assets/invalid.txt'), Buffer.from([0xc3, 0x28]));
        writeFileSync(join(f.project, 'assets/binary.txt'), Buffer.from([65, 0, 66]));
        const result = await f.read({ paths: ['assets/valid.txt', 'assets/invalid.txt', 'assets/binary.txt'] });
        assert.equal(result.ok, false);
        assert.equal(result.consistent, true);
        assert.equal(result.files[0]?.status, 'read');
        for (const file of result.files.slice(1)) {
            assert.equal(file.status, 'failed');
            assert.equal(Object.prototype.hasOwnProperty.call(file, 'content'), false);
        }
    } finally { f.dispose(); }
});

test('external editing without revision notification discards first attempt and reads a stable new batch', async () => {
    const f = fixture();
    const original = TextFileIoGuard.prototype.readObservation;
    let observations = 0;
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'old');
        writeFileSync(join(f.project, 'assets/b.txt'), 'old');
        TextFileIoGuard.prototype.readObservation = function (target) {
            const snapshot = original.call(this, target);
            observations += 1;
            if (observations === 1) {
                writeFileSync(join(f.project, 'assets/a.txt'), 'new');
                writeFileSync(join(f.project, 'assets/b.txt'), 'new');
            }
            return snapshot;
        };
        const result = await f.read({ paths: ['assets/a.txt', 'assets/b.txt'] });
        assert.equal(result.ok, true);
        assert.equal(result.revision, 0);
        assert.deepEqual(result.files.map((file) => file.status === 'read' ? file.content : file.code), ['new', 'new']);
        assert.ok(observations > 4);
    } finally {
        TextFileIoGuard.prototype.readObservation = original;
        f.dispose();
    }
});

test('continuous external mutation is bounded and returns no stale or truncated contents', async () => {
    const f = fixture();
    const original = TextFileIoGuard.prototype.readObservation;
    let observations = 0;
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'start');
        TextFileIoGuard.prototype.readObservation = function (target) {
            const snapshot = original.call(this, target);
            observations += 1;
            writeFileSync(join(f.project, 'assets/a.txt'), `changed-${observations}`);
            return snapshot;
        };
        const result = await f.read({ path: 'assets/a.txt' });
        assert.equal(observations, 4);
        assert.deepEqual(result, { schemaVersion: 1, ok: false, consistent: false, revision: null,
            files: [{ path: 'assets/a.txt', status: 'failed', code: 'text_file_io_snapshot_conflict' }] });
    } finally {
        TextFileIoGuard.prototype.readObservation = original;
        f.dispose();
    }
});

test('revision change alone retries and reports the actual new Hub revision', async () => {
    const f = fixture();
    const original = TextFileIoGuard.prototype.readObservation;
    let observations = 0;
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'unchanged');
        TextFileIoGuard.prototype.readObservation = function (target) {
            const snapshot = original.call(this, target);
            if (++observations === 1) { f.hub.notifyExternalProjectChange(); }
            return snapshot;
        };
        const result = await f.read({ path: 'assets/a.txt' });
        assert.equal(result.ok, true);
        assert.equal(result.revision, 1);
        assert.equal(observations, 4);
    } finally {
        TextFileIoGuard.prototype.readObservation = original;
        f.dispose();
    }
});

test('reader waits on the actual project writer lock and uses canonical physical alias keys', async () => {
    const f = fixture();
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'old');
        symlinkSync(join(f.project, 'assets/a.txt'), join(f.project, 'assets/alias.txt'));
        const writer = await f.locks.acquireSet({ projectKey: realpathSync(f.project), resourceKeys: ['writer'], requiresProjectWriter: true });
        let finished = false;
        const reading = f.read({ path: 'assets/alias.txt' }).then((result) => { finished = true; return result; });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(finished, false);
        writeFileSync(join(f.project, 'assets/a.txt'), 'new');
        writer.release();
        const result = await reading;
        assert.equal(result.files[0]?.path, 'assets/a.txt');
        assert.equal(result.files[0]?.status === 'read' && result.files[0].content, 'new');
    } finally { f.dispose(); }
});

test('physical writer keys also block alias readers when logical project keys differ', async () => {
    const f = fixture();
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'old');
        symlinkSync(join(f.project, 'assets/a.txt'), join(f.project, 'assets/alias.txt'));
        const router = new EditorMcpActionRouter({
            version: new RuntimeFacade('3.8.7').version,
            projectRead: { getProjectPath: async () => f.project, getProjectName: async () => 'OwnedFixture' },
            designSources: [],
            native: {},
        }, undefined, undefined, f.locks);
        const plan = await router.planManagedResourceOperation('asset.writeText', { path: 'assets/alias.txt', content: 'new' });
        const keys = plan.resourceKeys;
        assert.ok(keys.includes(`physical:${realpathSync(join(f.project, 'assets/a.txt'))}`));
        assert.ok(keys.some((key) => key.startsWith('inode:')));
        const writer = await f.locks.acquireSet({ projectKey: `${f.project}/other-project`, resourceKeys: keys, requiresProjectWriter: false });
        try {
            let finished = false;
            const reading = f.read({ path: 'assets/a.txt' }).then((result) => { finished = true; return result; });
            await new Promise<void>((resolveTick) => setImmediate(resolveTick));
            assert.equal(finished, false);
            writeFileSync(join(f.project, 'assets/a.txt'), 'new');
            writer.release();
            const result = await reading;
            assert.equal(result.files[0]?.status === 'read' && result.files[0].content, 'new');
        } finally { writer.release(); }
    } finally { f.dispose(); }
});

test('missing trusted context fails closed even when business input tries to supply a revision', async () => {
    const f = fixture();
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'secret');
        const result = await f.gateway.read(f.project, { path: 'assets/a.txt' });
        assert.equal(result.consistent, false);
        assert.equal(result.revision, null);
        assert.equal(result.files[0]?.status, 'failed');
        await assert.rejects(() => f.read({ path: 'assets/a.txt', revision: 99 }), /input_invalid/);
    } finally { f.dispose(); }
});

test('a disappeared project is a quiet control-flow refusal rather than an unhandled filesystem error', async () => {
    const f = fixture();
    f.dispose();
    await assert.rejects(() => f.gateway.read(f.project, { path: 'assets/a.txt' }), (error: unknown) =>
        typeof error === 'object' && error != null && Reflect.get(error, 'isMcpControlFlowRefusal') === true);
});

test('cancellation while waiting for writer locks returns an explicit failure and releases the reader waiter', async () => {
    const f = fixture();
    const controller = new AbortController();
    writeFileSync(join(f.project, 'assets/a.txt'), 'valid');
    const writer = await f.locks.acquireSet({ projectKey: realpathSync(f.project), resourceKeys: ['writer'], requiresProjectWriter: true });
    try {
        const waiting = f.read({ path: 'assets/a.txt' }, controller.signal);
        await new Promise<void>((resolveTick) => setImmediate(resolveTick));
        controller.abort();
        const result = await waiting;
        assert.deepEqual(result.files, [{ path: 'assets/a.txt', status: 'failed', code: 'text_file_io_cancelled' }]);
        writer.release();
        assert.equal((await f.read({ path: 'assets/a.txt' })).ok, true);
    } finally { writer.release(); f.dispose(); }
});

test('complete encoded response budget counts content escaping and returns a small explicit failure', async () => {
    const f = fixture({ ...CoreTextFileIoContract.limits, maxOutputBytes: 700 });
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), '"\\'.repeat(90));
        const result = await f.read({ path: 'assets/a.txt' });
        assert.equal(result.ok, false);
        assert.equal(result.files[0]?.status, 'failed');
        assert.equal(Object.prototype.hasOwnProperty.call(result.files[0] ?? {}, 'content'), false);
        assert.ok(Buffer.byteLength(JSON.stringify({ type: 'result', ok: true, result })) <= 700);
    } finally { f.dispose(); }
});

test('writer admitted after the barrier but before snapshot cannot lend its unsettled revision to old content', async () => {
    const f = fixture();
    const original = TextFileIoGuard.prototype.prepareRead;
    let preparations = 0;
    let writing: Promise<unknown> | undefined;
    try {
        writeFileSync(join(f.project, 'assets/a.txt'), 'old');
        const writerName = 'peanut.editor-mcp.owned-test-write';
        f.manager.getMcpCapabilityRegistry().register('peanut.editor-mcp', {
            name: writerName, description: '测试实际 writer 接纳间隙', category: 'cocos', risk: 'write', readOnly: false,
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }, async () => {
            await new Promise<void>((resolveTick) => setImmediate(resolveTick));
            const lease = await f.locks.acquireSet({ projectKey: realpathSync(f.project), resourceKeys: ['writer'], requiresProjectWriter: true });
            try { writeFileSync(join(f.project, 'assets/a.txt'), 'new'); }
            finally { lease.release(); }
            return { written: true };
        });
        TextFileIoGuard.prototype.prepareRead = function (...args) {
            const targets = original.apply(this, args);
            if (++preparations === 2) {
                writing = f.hub.invokeFromHost(writerName, {}, { connectionId: 'a'.repeat(32) });
            }
            return targets;
        };
        const result = await f.read({ path: 'assets/a.txt' });
        await writing;
        assert.equal(result.ok, true);
        assert.equal(result.revision, 2);
        assert.equal(result.files[0]?.status === 'read' && result.files[0].content, 'new');
    } finally {
        TextFileIoGuard.prototype.prepareRead = original;
        await writing;
        f.dispose();
    }
});
