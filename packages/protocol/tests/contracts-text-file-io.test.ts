import { TextFileWriteResultProjection } from '../src/index.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
    ITextFileIoLimits,
    ITextFileReadResult,
    ITextFileWriteInput,
    ITextFileWriteResult,
    TextFileReadInput,
} from '../src/index.js';

test('text contracts accept legacy writes and distinguish missing evidence from empty content', () => {
    const single: TextFileReadInput = { path: 'assets/a.ts' };
    const batch: TextFileReadInput = { paths: ['assets/a.ts', 'assets/b.js'] };
    // @ts-expect-error 读取入口严格禁止同时指定两种路径形式。
    const conflicting: TextFileReadInput = { path: 'assets/a.ts', paths: ['assets/b.ts'] };
    // @ts-expect-error 读取入口必须指定路径。
    const missing: TextFileReadInput = {};
    const write: ITextFileWriteInput = {
        path: 'ignored', content: 'ignored', files: [{ path: 'assets/a.ts', content: '\uFEFF雪\r\n', expectedSha256: 'absent' }],
        approvalToken: 'lease', execution: { mode: 'sync', idempotencyKey: 'one-batch' },
    };
    const readResult: ITextFileReadResult = {
        schemaVersion: 1, ok: false, consistent: false, revision: null,
        files: [{ path: 'assets/a.ts', status: 'failed', code: 'text_file_changed' }],
    };
    const writeResult: ITextFileWriteResult = {
        schemaVersion: 1, ok: false, projectState: 'may_have_changed',
        files: [
            { path: 'assets/a.ts', status: 'written_unverified', bytes: null, beforeSha256: null, sha256: null, uuid: null },
            { path: 'assets/b.ts', status: 'not_started', bytes: null, beforeSha256: null, sha256: null, uuid: null },
        ],
    };
    const newFile: ITextFileWriteResult['files'][number] = {
        path: 'assets/new.ts', status: 'verified', bytes: 0, beforeSha256: 'absent', sha256: 'a'.repeat(64), uuid: 'created-uuid',
    };
    const existingFile: ITextFileWriteResult['files'][number] = {
        path: 'assets/existing.ts', status: 'verified', bytes: 1, beforeSha256: 'b'.repeat(64), sha256: 'c'.repeat(64), uuid: 'retained-uuid',
    };
    const successfulRead: ITextFileReadResult = {
        schemaVersion: 1, ok: true, consistent: true, revision: 8,
        files: [{ path: 'assets/empty.ts', status: 'read', content: '', byteCount: 0, sha256: 'a'.repeat(64), revision: 8 }],
    };
    // @ts-expect-error 每项写入必须保留变更前证据，未知时显式为空。
    const missingBeforeDigest: ITextFileWriteResult['files'][number] = {
        path: 'assets/unknown.ts', status: 'not_started', bytes: null, sha256: null, uuid: null,
    };
    const limits: ITextFileIoLimits = { maxFiles: 32, maxFileBytes: 1048576, maxInputBytes: 4194304, maxOutputBytes: 4194304 };
    assert.equal(single.path, 'assets/a.ts');
    assert.equal(batch.paths.length, 2);
    assert.equal(write.files?.[0]?.content, '\uFEFF雪\r\n');
    assert.equal(readResult.files[0]?.status, 'failed');
    assert.equal(writeResult.files[0]?.sha256, null);
    assert.equal(newFile.beforeSha256, 'absent');
    assert.equal(existingFile.beforeSha256, 'b'.repeat(64));
    assert.equal(writeResult.files[0]?.beforeSha256, null);
    assert.equal(successfulRead.files[0]?.status === 'read' ? successfulRead.files[0].byteCount : null, 0);
    assert.equal('beforeSha256' in missingBeforeDigest, false);
    assert.equal(limits.maxFiles, 32);
    assert.equal(Object.keys(conflicting).length + Object.keys(missing).length, 2);
});

test('shared failure projection rejects fabricated verified, private data, foreign paths, getters and over-budget DTOs', () => {
    const limits = { maxFiles: 32, maxFileBytes: 1048576, maxOutputBytes: 4194304, paths: ['assets/a.txt'] };
    const value = { schemaVersion: 1, ok: false, projectState: 'may_have_changed',
        files: [{ path: 'assets/a.txt', status: 'written_unverified', bytes: null, beforeSha256: 'absent', sha256: null, uuid: null }] };
    assert.ok(TextFileWriteResultProjection.project(value, limits));
    for (const changed of [
        { ...value, ok: true, projectState: 'verified' },
        { ...value, content: 'private source' },
        { ...value, files: [{ ...value.files[0], path: '/private/project/a.txt' }] },
        { ...value, files: [{ ...value.files[0], path: 'assets/other.txt' }] },
        { ...value, files: [{ ...value.files[0], status: 'verified' }] },
        { ...value, files: [{ ...value.files[0], bytes: 1048577 }] },
        { ...value, files: [{ ...value.files[0], code: 'Error: /private/path' }] },
        { ...value, files: [{ ...value.files[0], status: 'not_started', sha256: 'a'.repeat(64) }] },
    ]) {
        assert.equal(TextFileWriteResultProjection.project(changed, limits), null);
    }
    let accesses = 0;
    const getter = Object.defineProperty({ ...value }, 'files', { get: () => { accesses += 1; return value.files; }, enumerable: true });
    assert.equal(TextFileWriteResultProjection.project(getter, limits), null);
    assert.equal(accesses, 0);
    assert.equal(TextFileWriteResultProjection.project(value, { ...limits, maxOutputBytes: 10 }), null);
    const complete = { ...value, ok: true, projectState: 'verified', files: [{ ...value.files[0], status: 'verified',
        bytes: 0, sha256: 'a'.repeat(64), uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] };
    assert.ok(TextFileWriteResultProjection.project(complete, limits)?.ok);
});
