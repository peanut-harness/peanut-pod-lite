import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { appendFileSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PodCoverageContracts } from '../pod-test-coverage/contracts.mjs';
import { PodCoverageInputReader } from '../pod-test-coverage/input-reader.mjs';

const fixture = new URL('../../tests/fixtures/pod-test-coverage/synthetic-input.json', import.meta.url);

/**
 * @description 每次构造独立的合成输入，不用于证明产品行为。
 * @returns 可在测试中修改的记录。
 * @oopException 测试夹具是纯 JSON 值，没有独立业务生命周期。
 */
const sample = (): Record<string, unknown> => PodCoverageContracts.record(JSON.parse(readFileSync(fixture, 'utf8')), null, 'test');

/**
 * @description 写入临时输入并立即读回，检测对磁盘文件的隐式改写。
 * @param value 合成输入。
 * @returns 解析与原始字节一致性结果。
 * @oopException 临时文件写入只属于当前单次测试夹具。
 */
const readSample = (value: unknown): { input: unknown; sameBytes: boolean } => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-input-'));
    try {
        const inputPath = join(root, 'input.json');
        const bytes = Buffer.from(JSON.stringify(value));
        writeFileSync(inputPath, bytes);
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        const result = reader.readInput(inputPath);
        return { input: result.input, sameBytes: readFileSync(inputPath).equals(bytes) };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

test('valid input with no case results stays unexecuted and byte-identical', () => {
    const result = readSample(sample());
    const input = PodCoverageContracts.validateInput(result.input);
    assert.equal(result.sameBytes, true);
    assert.equal(input.capabilities.length, 1);
    assert.equal(input.cases.length, 0);
    assert.equal(input.results.length, 0);
});

test('unknown versions, fields and duplicate IDs fail before any report exists', () => {
    const version = { ...sample(), schemaVersion: 'pod-test-coverage-input.v2' };
    assert.throws(() => readSample(version), /schema_version_invalid/u);
    const extra = { ...sample(), passed: 1 };
    assert.throws(() => readSample(extra), /input_fields_invalid/u);
    const nested = sample();
    if (!Array.isArray(nested.sources)) throw new Error('synthetic_sources_invalid');
    const source = PodCoverageContracts.record(nested.sources[0], null, 'source');
    nested.sources = [{ ...source, unexpected: true }];
    assert.throws(() => readSample(nested), /sources_fields_invalid/u);
    const duplicate = sample();
    if (!Array.isArray(duplicate.capabilities)) throw new Error('synthetic_capabilities_invalid');
    duplicate.capabilities = [duplicate.capabilities[0], duplicate.capabilities[0]];
    assert.throws(() => readSample(duplicate), /capabilities_duplicate_id/u);
});

test('path traversal and remote references are rejected before disk access', () => {
    for (const path of ['../outside.json', '/etc/passwd', 'http://example.test/a', 'C:/Windows/a', 'folder/./a', 'folder//a', 'folder\\a']) {
        assert.throws(() => PodCoverageContracts.reference({ rootId: 'lite', path, sha256: 'a'.repeat(64) }), /reference_path_invalid/u);
    }
});

test('references are read only under explicit roots and checked against raw bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-reference-'));
    try {
        const content = Buffer.from('{"operation":"editor.queryVersion"}');
        writeFileSync(join(root, 'catalog.json'), content);
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        const reference = { rootId: 'lite', path: 'catalog.json', sha256: createHash('sha256').update(content).digest('hex') };
        assert.deepEqual(reader.readReference(reference), content);
        assert.throws(() => reader.readReference({ ...reference, sha256: 'a'.repeat(64) }), /reference_content_changed/u);
        assert.throws(() => reader.readReference({ ...reference, rootId: 'unknown' }), /reference_root_missing/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('symlink escape is rejected, including a linked input file', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'pod-coverage-outside-'));
    try {
        const content = Buffer.from('outside');
        const target = join(outside, 'secret.json');
        writeFileSync(target, content);
        symlinkSync(outside, join(root, 'linked'));
        symlinkSync(target, join(root, 'input.json'));
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        assert.throws(() => reader.readReference({ rootId: 'lite', path: 'linked/secret.json', sha256: PodCoverageContracts.sha256(content) }), /symlink_forbidden/u);
        assert.throws(() => reader.readInput(join(root, 'input.json')), /file_invalid/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    }
});

test('path swap immediately before open cannot read outside the explicit root', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-race-'));
    const outside = mkdtempSync(join(tmpdir(), 'pod-coverage-race-outside-'));
    const originalOpen = fs.openSync;
    try {
        const path = join(root, 'source.txt');
        const saved = join(root, 'saved.txt');
        const foreign = join(outside, 'foreign.txt');
        const localBytes = Buffer.from('LOCAL_0000');
        const foreignBytes = Buffer.from('OTHER_9999');
        writeFileSync(path, localBytes);
        writeFileSync(foreign, foreignBytes);
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        const canonicalPath = realpathSync(path);
        let swapped = false;
        fs.openSync = new Proxy(originalOpen, { apply(target, receiver, args) {
            if (args[0] !== canonicalPath) return Reflect.apply(target, receiver, args);
            renameSync(path, saved);
            symlinkSync(foreign, path);
            swapped = true;
            try { return Reflect.apply(target, receiver, args); }
            finally { unlinkSync(path); renameSync(saved, path); }
        } });
        syncBuiltinESMExports();
        const reference = { rootId: 'lite', path: 'source.txt', sha256: PodCoverageContracts.sha256(foreignBytes) };
        assert.throws(() => reader.readReference(reference), /file_changed_during_read/u);
        assert.equal(swapped, true);
        assert.deepEqual(readFileSync(path), localBytes);
    } finally {
        fs.openSync = originalOpen;
        syncBuiltinESMExports();
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    }
});

test('file growth during pinned reading stops at the hard byte budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-growth-'));
    const originalRead = fs.readSync;
    try {
        const path = join(root, 'source.bin');
        writeFileSync(path, Buffer.alloc(PodCoverageContracts.maxFileBytes));
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        let grew = false;
        fs.readSync = new Proxy(originalRead, { apply(target, receiver, args) {
            if (!grew) { appendFileSync(path, Buffer.from('x')); grew = true; }
            return Reflect.apply(target, receiver, args);
        } });
        syncBuiltinESMExports();
        const reference = { rootId: 'lite', path: 'source.bin', sha256: 'a'.repeat(64) };
        assert.throws(() => reader.readReference(reference), /file_too_large/u);
        assert.equal(grew, true);
    } finally {
        fs.readSync = originalRead;
        syncBuiltinESMExports();
        rmSync(root, { recursive: true, force: true });
    }
});

test('oversized files and deep JSON fail explicitly without partial parsing', () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-coverage-limits-'));
    try {
        const inputPath = join(root, 'input.json');
        writeFileSync(inputPath, Buffer.alloc(PodCoverageContracts.maxFileBytes + 1));
        const reader = new PodCoverageInputReader([{ id: 'lite', path: root }]);
        assert.throws(() => reader.readInput(inputPath), /file_too_large/u);
        let nested: unknown = 1;
        for (let index = 0; index <= PodCoverageContracts.maxJsonDepth; index += 1) nested = { nested };
        assert.throws(() => PodCoverageContracts.assertJsonBounds(nested), /json_bounds_exceeded/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
