import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { EditorMcpTextWriteGateway } from '../src/editor-mcp-text-write-gateway.js';

/**
 * @description 隔离全批准备与原有 writer 的第一处变化，清理仅限当前测试目录。
 * @param context 测试生命周期。
 * @returns 临时工程、writer 与真实写入次数。
 */
function fixture(context: TestContext) {
    const project = mkdtempSync(join(tmpdir(), 'peanut-text-write-'));
    mkdirSync(join(project, 'assets'));
    writeFileSync(join(project, 'assets/a.txt'), 'original');
    writeFileSync(join(project, 'assets/a.txt.meta'), '{"uuid":"original"}');
    let writes = 0;
    let beforeCommit: (() => void) | undefined;
    const gateway = new EditorMcpTextWriteGateway(async (input, beforeWrite) => {
        beforeCommit?.();
        beforeWrite();
        writes += 1;
        return input;
    });
    context.after(() => rmSync(project, { recursive: true, force: true }));
    return { project, gateway, writes: () => writes, intercept: (callback: () => void): void => { beforeCommit = callback; } };
}

test('write prepare is immutable, call-local and absent from business JSON; missing preparation refuses', async (context) => {
    const f = fixture(context);
    const input = { path: 'assets/a.txt', content: 'new' };
    const prepared = f.gateway.prepare(f.project, input);
    assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.files) && Object.isFrozen(prepared.files[0]));
    assert.notEqual(f.gateway.prepare(f.project, input), prepared);
    assert.equal(Object.getOwnPropertySymbols(input).length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
    await assert.rejects(f.gateway.execute(f.project, input, undefined), /preparation_missing/u);
    assert.equal(f.writes(), 0);
});

test('whole batch prepares before writer and preserves files priority, original hash and canonical order', async (context) => {
    const f = fixture(context);
    const digest = createHash('sha256').update('original').digest('hex');
    const input = { path: '../ignored', content: '\u0000ignored', expectedSha256: 'invalid',
        files: [{ path: 'db://assets/a.txt', content: '\uFEFF雪🙂\r\n', expectedSha256: digest.toUpperCase() },
            { path: 'assets/new.txt', content: '', expectedSha256: 'absent' }] };
    const prepared = f.gateway.prepare(f.project, input);
    assert.equal(f.writes(), 0);
    assert.deepEqual(await f.gateway.execute(f.project, input, prepared), { files: [
        { path: 'assets/a.txt', content: '\uFEFF雪🙂\r\n', expectedSha256: digest },
        { path: 'assets/new.txt', content: '', expectedSha256: 'absent' },
    ] });
    assert.equal(f.writes(), 1);
    assert.equal(existsSync(join(f.project, 'assets/new.txt')), false, 'injected writer only observes; no native validation claim');
});

for (const change of ['content', 'inode', 'appeared', 'disappeared', 'symlink', 'parent', 'permission', 'input']) {
    test(`queued write refuses original snapshot drift: ${change}`, async (context) => {
        const f = fixture(context);
        symlinkSync(join(f.project, 'assets/a.txt'), join(f.project, 'assets/link.txt'));
        const input = { files: [{ path: 'assets/new/sub.txt', content: 'first' },
            { path: change === 'symlink' ? 'assets/link.txt' : 'assets/a.txt', content: 'last' }] };
        const prepared = f.gateway.prepare(f.project, input);
        if (change === 'content') writeFileSync(join(f.project, 'assets/a.txt'), 'external');
        if (change === 'inode') {
            renameSync(join(f.project, 'assets/a.txt'), join(f.project, 'assets/old.txt'));
            writeFileSync(join(f.project, 'assets/a.txt'), 'original');
        }
        if (change === 'appeared') {
            mkdirSync(join(f.project, 'assets/new'));
            writeFileSync(join(f.project, 'assets/new/sub.txt'), 'external');
        }
        if (change === 'disappeared') rmSync(join(f.project, 'assets/a.txt'));
        if (change === 'symlink') {
            writeFileSync(join(f.project, 'assets/other.txt'), 'original');
            rmSync(join(f.project, 'assets/link.txt'));
            symlinkSync(join(f.project, 'assets/other.txt'), join(f.project, 'assets/link.txt'));
        }
        if (change === 'parent') mkdirSync(join(f.project, 'assets/new'));
        if (change === 'permission') chmodSync(join(f.project, 'assets/a.txt'), 0o444);
        if (change === 'input') input.files[1].content = 'changed';
        const source = existsSync(join(f.project, 'assets/a.txt')) ? readFileSync(join(f.project, 'assets/a.txt')) : null;
        const complete = projectSnapshot(f.project);
        await assert.rejects(f.gateway.execute(f.project, input, prepared), /snapshot_conflict|permission_refused/u);
        assert.equal(f.writes(), 0);
        assert.equal(projectSnapshot(f.project), complete);
        assert.equal(readFileSync(join(f.project, 'assets/a.txt.meta'), 'utf8'), '{"uuid":"original"}');
        if (source != null) assert.deepEqual(readFileSync(join(f.project, 'assets/a.txt')), source);
    });
}

test('whole-batch last check runs inside the original writer before its first mutation', async (context) => {
    const f = fixture(context);
    const input = { files: [{ path: 'assets/new/sub.txt', content: 'first' }, { path: 'assets/a.txt', content: 'last' }] };
    const prepared = f.gateway.prepare(f.project, input);
    f.intercept(() => writeFileSync(join(f.project, 'assets/a.txt'), 'external-in-lock'));
    await assert.rejects(f.gateway.execute(f.project, input, prepared), /snapshot_conflict/u);
    assert.equal(f.writes(), 0);
    assert.equal(existsSync(join(f.project, 'assets/new')), false);
    assert.equal(readFileSync(join(f.project, 'assets/a.txt'), 'utf8'), 'external-in-lock');
});

test('last invalid item, duplicate physical aliases, 33 files and stale expected digest never reach writer', (context) => {
    const f = fixture(context);
    symlinkSync(join(f.project, 'assets/a.txt'), join(f.project, 'assets/link.txt'));
    const good = { path: 'assets/new/sub.txt', content: 'first' };
    for (const input of [
        { files: [good, { path: 'assets/a.txt', content: 'last', expectedSha256: 'f'.repeat(64) }] },
        { files: [good, { path: 'assets/a.png', content: 'last' }] },
        { files: [good, { path: 'assets/a.txt', content: 'x' }, { path: 'assets/link.txt', content: 'y' }] },
        { files: Array.from({ length: 33 }, (_, index) => ({ path: `assets/${index}.txt`, content: '' })) },
    ]) assert.throws(() => f.gateway.prepare(f.project, input));
    assert.equal(f.writes(), 0);
    assert.equal(existsSync(join(f.project, 'assets/new')), false);
});

test('whole JSON counts control fields, ignored fields and escaping before writer preparation', (context) => {
    const f = fixture(context);
    const input = { files: [{ path: 'assets/a.txt', content: '' }], approvalToken: '\n'.repeat(CoreTextFileIoContract.limits.maxInputBytes / 2) };
    assert.throws(() => f.gateway.assertInputBudget(input), /json_bytes_exceeded/u);
    assert.throws(() => f.gateway.prepare(f.project, input), /json_bytes_exceeded/u);
    assert.equal(f.writes(), 0);
});

/**
 * @description 记录全部目录、文件和链接，不跟随工程外链接；用于断言拒绝没有创建临时文件或修改 meta。
 * @param root 当前隔离工程。
 * @returns 有序、完整的文件系统摘要。
 */
function projectSnapshot(root: string): string {
    const entries: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) entries.push(`${path}:link:${readlinkSync(path)}`);
            else if (entry.isDirectory()) { entries.push(`${path}:directory`); visit(path); }
            else entries.push(`${path}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
        }
    };
    visit(root);
    return createHash('sha256').update(entries.join('\n')).digest('hex');
}

test('escaping final target preserves full project including directories, meta, probes, temp and owned external sentinel', (context) => {
    const f = fixture(context);
    const outside = mkdtempSync(join(tmpdir(), 'peanut-write-sentinel-'));
    context.after(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, 'sentinel.txt'), 'outside-owned-sentinel');
    mkdirSync(join(f.project, 'temp/probes'), { recursive: true });
    writeFileSync(join(f.project, 'temp/probes/keep.txt'), 'keep');
    symlinkSync(outside, join(f.project, 'assets/escape'));
    const before = projectSnapshot(f.project);
    const outsideBefore = projectSnapshot(outside);
    assert.throws(() => f.gateway.prepare(f.project, { files: [
        { path: 'assets/new/sub.txt', content: 'first' }, { path: 'assets/escape/sentinel.txt', content: 'last' },
    ] }), /path_escape/u);
    assert.equal(projectSnapshot(f.project), before);
    assert.equal(projectSnapshot(outside), outsideBefore);
    assert.equal(f.writes(), 0);
});

test('writer receives original immutable evidence only via internal argument, never a business session override', async (context) => {
    const f = fixture(context);
    const input = { path: 'assets/a.txt', content: 'new', batchSession: { files: ['forged'] } };
    const prepared = f.gateway.prepare(f.project, input);
    let observed: unknown;
    const gateway = new EditorMcpTextWriteGateway(async (_input, beforeWrite, execution) => {
        beforeWrite();
        observed = execution?.files;
        return { written: ['assets/a.txt'] };
    });
    const original = gateway.prepare(f.project, input);
    await gateway.execute(f.project, input, original);
    assert.equal(observed, original.files);
    assert.notEqual(observed, input.batchSession);
    assert.equal(prepared.files[0]?.beforeSha256, createHash('sha256').update('original').digest('hex'));
});
