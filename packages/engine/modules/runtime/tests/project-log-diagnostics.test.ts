import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectLogDiagnosticsPolicy } from '../src/cocos/foundation/editor-resource/project-log-diagnostics-policy.js';
import { ProjectLogDiagnostics } from '../src/cocos/foundation/editor-resource/project-log-diagnostics.js';

/**
 * @description 每个测试隔离工程与日志，结束时释放全部文件。
 * @oopException 测试fixture仅提供临时目录作用域，不参与产品领域状态。
 * @param run 测试行为。
 * @returns 无返回值。
 */
function fixture(run: (reader: ProjectLogDiagnostics, root: string, path: string) => void): void {
    const root = mkdtempSync(join(tmpdir(), 'pod-log-'));
    const path = join(root, 'temp/logs/project.log');
    mkdirSync(join(root, 'temp/logs'), { recursive: true });
    try { run(new ProjectLogDiagnostics(), root, path); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('search preserves Chinese, raw stack and neighboring context without an acceptance verdict', () => fixture((reader, root, path) => {
    writeFileSync(path, 'before\n2026 - error: 资源失败\n    at run (src.ts:4)\nafter\n');
    const result = reader.query(root, { mode: 'search', contains: '资源失败' });
    assert.equal(result.ok, true);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.before[0]?.text, 'before\n');
    assert.equal(result.matches[0]?.after[0]?.text, '    at run (src.ts:4)\n');
    assert.equal(result.matches[0]?.line.level, 'error');
    assert.equal('verified' in result, false);
}));

test('tail has backwards pages and an independent forward follow cursor', () => fixture((reader, root, path) => {
    writeFileSync(path, 'one\ntwo\nthree\n');
    const first = reader.query(root, { mode: 'tail', limit: 1 });
    assert.equal(first.matches[0]?.line.text, 'three\n');
    assert.ok(first.nextCursor);
    const second = reader.query(root, { mode: 'tail', limit: 1, cursor: first.nextCursor });
    assert.equal(second.matches[0]?.line.text, 'two\n');
    appendFileSync(path, '四\n');
    assert.ok(first.followCursor);
    const delta = reader.query(root, { mode: 'delta', cursor: first.followCursor });
    assert.deepEqual(delta.matches.map((match) => match.line.text), ['四\n']);
}));

test('partial UTF-8 and incomplete last line remain readable after append', () => fixture((reader, root, path) => {
    const text = Buffer.from('中文');
    writeFileSync(path, Buffer.concat([Buffer.from('done\n'), text.subarray(0, 4)]));
    const first = reader.query(root, { mode: 'delta' });
    assert.equal(first.pendingLine, true);
    assert.ok(first.followCursor);
    appendFileSync(path, Buffer.concat([text.subarray(4), Buffer.from('\n')]));
    const next = reader.query(root, { mode: 'delta', cursor: first.followCursor });
    assert.equal(next.matches[0]?.line.text, '中文\n');
}));

test('replacement, truncation, cross-project and forged cursors cannot masquerade as empty success', () => fixture((reader, root, path) => {
    writeFileSync(path, 'original\n');
    const first = reader.query(root, { mode: 'delta' });
    assert.ok(first.followCursor);
    writeFileSync(path, 'different content\n');
    assert.equal(reader.query(root, { mode: 'delta', cursor: first.followCursor }).resetDetected, true);
    writeFileSync(path, 'original\n');
    renameSync(path, `${path}.old`);
    writeFileSync(path, 'original\n');
    assert.equal(reader.query(root, { mode: 'delta', cursor: first.followCursor }).resetDetected, true);
    assert.equal(reader.query(root, { mode: 'delta', cursor: `${first.followCursor}bad` }).failureCode, 'log_cursor_invalid');
    fixture((_, other, otherPath) => {
        writeFileSync(otherPath, 'original\n');
        assert.equal(reader.query(other, { mode: 'delta', cursor: first.followCursor }).resetDetected, true);
    });
}));

test('large logs paginate with bounded reads and bounded encoded responses', () => fixture((reader, root, path) => {
    writeFileSync(path, 'line\n'.repeat(300_000));
    let cursor: string | undefined;
    let count = 0;
    do {
        const result = reader.query(root, { mode: 'search', limit: 100, contextBefore: 0, contextAfter: 0, cursor });
        assert.equal(result.ok, true);
        assert.ok(result.scannedBytes <= ProjectLogDiagnosticsPolicy.scanBytes);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= ProjectLogDiagnosticsPolicy.responseBytes);
        count += result.matches.length;
        cursor = result.nextCursor ?? undefined;
        if (count > 500) break;
    } while (cursor != null);
    assert.equal(count, 600);
}));

test('long UTF-8 lines are explicit resumable fragments rather than replacement characters', () => fixture((reader, root, path) => {
    writeFileSync(path, `${'文'.repeat(400_000)}\n`);
    const result = reader.query(root, { mode: 'search', limit: 100, contextBefore: 0, contextAfter: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert.ok(result.matches.every((item) => item.line.fragment));
    assert.ok(result.matches.every((item) => !item.line.text.includes('\uFFFD')));
    assert.ok(result.nextCursor);
}));

test('missing differs from empty and symlink escape is refused', () => fixture((reader, root, path) => {
    assert.equal(reader.query(root, { mode: 'tail' }).failureCode, 'log_missing');
    writeFileSync(path, '');
    assert.equal(reader.query(root, { mode: 'tail' }).complete, true);
    rmSync(path);
    symlinkSync('/etc/hosts', path);
    assert.equal(reader.query(root, { mode: 'tail' }).failureCode, 'log_path_escape');
}));

test('invalid budgets and arbitrary paths are refused before reading', () => fixture((reader, root) => {
    assert.throws(() => reader.query(root, { mode: 'tail', limit: 101 }), /limit_invalid/);
    assert.throws(() => reader.query(root, { mode: 'search', contextAfter: 11 }), /contextAfter_invalid/);
    assert.throws(() => reader.query(root, JSON.parse('{"mode":"tail","path":"/etc/hosts"}')), /unknown_field/);
}));


test('long multibyte lines reconstruct byte-for-byte across bounded pages', () => fixture((reader, root, path) => {
    const original = `${'中文😀'.repeat(140_000)}\n`;
    writeFileSync(path, original);
    let cursor: string | undefined;
    let reconstructed = '';
    for (let page = 0; page < 100; page += 1) {
        const result = reader.query(root, { mode: 'search', contextBefore: 0, contextAfter: 0, cursor });
        assert.equal(result.ok, true);
        reconstructed += result.matches.map((item) => item.line.text).join('');
        cursor = result.nextCursor ?? undefined;
        if (cursor == null) break;
    }
    assert.equal(createHash('sha256').update(reconstructed).digest('hex'), createHash('sha256').update(original).digest('hex'));
}));


test('a resumed match retains preceding context from the previous page', () => fixture((reader, root, path) => {
    writeFileSync(path, 'first\nsecond\nthird\nfourth\n');
    const first = reader.query(root, { mode: 'search', limit: 1 });
    assert.ok(first.nextCursor);
    const second = reader.query(root, { mode: 'search', limit: 1, cursor: first.nextCursor });
    assert.equal(second.matches[0]?.line.text, 'second\n');
    assert.equal(second.matches[0]?.before[0]?.text, 'first\n');
}));
