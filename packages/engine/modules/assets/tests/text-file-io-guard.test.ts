import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';

import { CoreTextFileIoContract } from '../../policy/src/core-text-file-io-contract.ts';
import { TextFileIoGuard, type ITextFileIoGuardLimits } from '../src/text-file-io-guard.ts';

/**
 * @description 建立不被 Creator 打开的测试工程及初始 meta，完成后只清理本测试临时目录。
 * @param context 当前测试清理上下文。
 * @param limits 注入容量。
 * @returns 临时根与无副作用守卫。
 */
function fixture(context: TestContext, limits: ITextFileIoGuardLimits = CoreTextFileIoContract.limits) {
    const root = mkdtempSync(join(tmpdir(), 'pod-text-guard-'));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets/a.txt'), 'original');
    writeFileSync(join(root, 'assets/a.txt.meta'), '{"uuid":"existing-uuid"}');
    return { root, guard: new TextFileIoGuard(root, limits) };
}

/**
 * @description 摘要全部测试文件、目录与链接位置，用于证明拒绝未创建目录或修改 meta。
 * @param root 本测试临时工程。
 * @returns 完整有序文件系统摘要。
 */
function state(root: string): string {
    const entries: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name);
            const name = relative(root, path);
            if (entry.isDirectory()) {
                entries.push(`directory:${name}`);
                visit(path);
            } else if (entry.isSymbolicLink()) {
                entries.push(`link:${name}`);
            } else {
                entries.push(`${name}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
            }
        }
    };
    visit(root);
    return createHash('sha256').update(entries.join('\n')).digest('hex');
}

test('32 files prepare in order and 33 files reject without creating source, directory or meta', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    const files = Array.from({ length: 32 }, (_, index) => ({ path: `assets/new/sub-${index}.ts`, content: `export const n = ${index};` }));
    const prepared = guard.prepareWrite({ files });
    assert.deepEqual(prepared.map((entry) => entry.path), files.map((entry) => entry.path));
    assert.ok(prepared.every((entry) => entry.beforeSha256 === 'absent' && !entry.exists));
    assert.throws(() => guard.prepareWrite({ files: [...files, { path: 'assets/extra.ts', content: '' }] }), /file_count_exceeded/u);
    assert.throws(() => guard.prepareRead({ paths: [...files.map((entry) => entry.path), 'assets/extra.ts'] }), /file_count_exceeded/u);
    assert.equal(state(root), before);
});

test('single and batch forms preserve files priority and validate optional actual source digests', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    const sha256 = createHash('sha256').update('original').digest('hex');
    assert.equal(guard.prepareWrite({ path: 'assets/a.txt', content: 'new', expectedSha256: sha256.toUpperCase() })[0]?.beforeSha256, sha256);
    assert.equal(guard.prepareWrite({ path: '../ignored', content: 'ignored', expectedSha256: 'invalid',
        files: [{ path: 'assets/new.txt', content: '', expectedSha256: 'absent' }] })[0]?.path, 'assets/new.txt');
    for (const expectedSha256 of ['absent', 'f'.repeat(64), null, `${sha256}\n`]) {
        assert.throws(() => guard.prepareWrite({ path: 'assets/a.txt', content: 'new', expectedSha256 }));
    }
    assert.throws(() => guard.prepareWrite({ files: [{ path: 'assets/new/sub.txt', content: 'first' },
        { path: 'assets/a.txt', content: 'last', expectedSha256: 'absent' }] }), /content_conflict/u);
    assert.equal(state(root), before);
});

for (const path of ['../outside.txt', 'assets/../assets/a.txt', '/absolute.txt', 'C:\\outside.txt',
    'assets/a.txt\n', 'assets/a.txt\0', 'assets/a.meta', 'assets/a.prefab', 'assets/a.scene', 'assets/a.png']) {
    test(`unsafe path or non-text type rejects unchanged: ${JSON.stringify(path)}`, (context) => {
        const { root, guard } = fixture(context);
        const before = state(root);
        assert.throws(() => guard.prepareRead({ path }));
        assert.throws(() => guard.prepareWrite({ path, content: 'new' }));
        assert.equal(state(root), before);
    });
}

test('normalized, case, hardlink and internal symlink aliases reject before any mutation', (context) => {
    const { root, guard } = fixture(context);
    linkSync(join(root, 'assets/a.txt'), join(root, 'assets/hardlink.txt'));
    symlinkSync(join(root, 'assets/a.txt'), join(root, 'assets/link.txt'));
    const before = state(root);
    for (const second of ['db://assets/a.txt', 'assets/./a.txt', 'assets/hardlink.txt', 'assets/link.txt']) {
        assert.throws(() => guard.prepareRead({ paths: ['assets/a.txt', second] }), /duplicate_target/u);
        assert.throws(() => guard.prepareWrite({ files: [{ path: 'assets/a.txt', content: 'a' }, { path: second, content: 'b' }] }), /duplicate_target/u);
    }
    const insensitive = new TextFileIoGuard(root, CoreTextFileIoContract.limits, false);
    assert.throws(() => insensitive.prepareWrite({ files: [{ path: 'assets/CaseNew.txt', content: '' },
        { path: 'assets/casenew.txt', content: '' }] }), /duplicate_target/u);
    assert.throws(() => insensitive.prepareRead({ paths: ['assets/café.txt', 'assets/cafe\u0301.txt'] }), /duplicate_target/u);
    assert.equal(guard.prepareRead({ path: 'assets/link.txt' })[0]?.path, 'assets/a.txt');
    assert.equal(state(root), before);
});

test('escaping links, sibling prefix roots and dangling links reject before reading outside content', (context) => {
    const { root, guard } = fixture(context);
    const sibling = join(root, 'assets-escape');
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'bad.txt'), Buffer.from([0xc3, 0x28]));
    symlinkSync(sibling, join(root, 'assets/escape'));
    symlinkSync(join(root, 'missing.txt'), join(root, 'assets/dangling.txt'));
    const before = state(root);
    assert.throws(() => guard.prepareRead({ path: 'assets/escape/bad.txt' }), /path_escape/u);
    assert.throws(() => guard.prepareWrite({ path: 'assets/escape/new/deep.txt', content: 'new' }), /path_escape/u);
    assert.throws(() => guard.prepareRead({ path: 'assets/dangling.txt' }), /path_unavailable/u);
    assert.equal(state(root), before);
});

test('an assets root symlink is refused and directory targets never become text files', (context) => {
    const { root, guard } = fixture(context);
    mkdirSync(join(root, 'assets/directory.txt'));
    assert.throws(() => guard.prepareRead({ path: 'assets/directory.txt' }), /target_not_file/u);
    assert.throws(() => guard.prepareWrite({ path: 'assets/a.txt/nested.txt', content: '' }), /parent_not_directory/u);
    renameSync(join(root, 'assets'), join(root, 'saved-assets'));
    symlinkSync(join(root, 'saved-assets'), join(root, 'assets'));
    const before = state(root);
    assert.throws(() => guard.prepareRead({ path: 'assets/a.txt' }), /asset_root_invalid/u);
    assert.equal(state(root), before);
});

test('BOM, CRLF, Unicode and empty content preserve original bytes, order and source digests', (context) => {
    const { root, guard } = fixture(context);
    const content = '\uFEFF行\r\n😀\t';
    writeFileSync(join(root, 'assets/中文.ts'), content);
    writeFileSync(join(root, 'assets/empty.txt'), '');
    const targets = guard.prepareRead({ paths: ['db://assets/中文.ts', 'assets\\empty.txt', 'assets/missing.txt'] });
    const snapshots = targets.map((target) => guard.readSnapshot(target));
    assert.deepEqual(snapshots.map((snapshot) => snapshot.path), ['assets/中文.ts', 'assets/empty.txt', 'assets/missing.txt']);
    assert.equal(snapshots[0]?.content, content);
    assert.equal(snapshots[0]?.byteCount, Buffer.byteLength(content));
    assert.equal(snapshots[0]?.sha256, createHash('sha256').update(Buffer.from(content)).digest('hex'));
    assert.equal(snapshots[1]?.content, '');
    assert.equal(snapshots[1]?.byteCount, 0);
    assert.equal(snapshots[2]?.exists, false);
    assert.equal(snapshots[2]?.content, null);
});

for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xc0, 0xaf]), Buffer.from([65, 0]), Buffer.from([0xff, 0xfe, 65, 0])]) {
    test(`invalid UTF-8 or binary bytes refuse unchanged: ${bytes.toString('hex')}`, (context) => {
        const { root, guard } = fixture(context);
        writeFileSync(join(root, 'assets/invalid.txt'), bytes);
        const before = state(root);
        const target = guard.prepareRead({ path: 'assets/invalid.txt' })[0];
        assert.ok(target);
        assert.throws(() => guard.readSnapshot(target), /utf8_invalid|binary_refused/u);
        assert.throws(() => guard.prepareWrite({ path: 'assets/invalid.txt', content: 'replacement' }), /utf8_invalid|binary_refused/u);
        assert.equal(state(root), before);
    });
}

test('exact 1 MiB content passes and one extra byte or a lone surrogate refuses unchanged', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    const content = 'x'.repeat(CoreTextFileIoContract.limits.maxFileBytes);
    assert.equal(guard.prepareWrite({ path: 'assets/limit.txt', content })[0]?.byteCount, content.length);
    assert.throws(() => guard.prepareWrite({ path: 'assets/limit.txt', content: `${content}x` }), /file_bytes_exceeded/u);
    assert.throws(() => guard.prepareWrite({ path: 'assets/invalid.txt', content: '\ud800' }), /utf8_invalid/u);
    assert.throws(() => guard.prepareWrite({ path: 'assets/invalid.txt', content: 'a\0b' }), /binary_refused/u);
    assert.equal(state(root), before);
});

test('injected limits count Unicode bytes and complete JSON envelopes including escaping', (context) => {
    const limits = { maxFiles: 2, maxFileBytes: 10, maxInputBytes: 80, maxOutputBytes: 16 };
    const { root, guard } = fixture(context, limits);
    const before = state(root);
    assert.equal(guard.prepareWrite({ path: 'assets/n.txt', content: '你好🌏' })[0]?.byteCount, 10);
    assert.throws(() => guard.prepareWrite({ path: 'assets/n.txt', content: '你好🌏!' }), /file_bytes_exceeded/u);
    const input = { path: 'assets/a.txt' };
    assert.throws(() => guard.prepareRead(input, { input, metadata: 'x'.repeat(80) }), /json_bytes_exceeded/u);
    guard.assertOutputBudget({ text: 'aaaaa' });
    assert.throws(() => guard.assertOutputBudget({ text: '\n'.repeat(5) }), /json_bytes_exceeded/u);
    assert.equal(state(root), before);
});

test('both read forms, empty batches, missing fields, sparse arrays and non-JSON values refuse', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    for (const input of [{}, { path: 'assets/a.txt', paths: ['assets/a.txt'] }, { paths: [] }, { paths: new Array(2) }, { paths: null }]) {
        assert.throws(() => guard.prepareRead(input));
    }
    for (const input of [{ files: [] }, { files: null }, { path: 'assets/a.txt' }, { files: [{ path: 'assets/a.txt', content: '', extra: true }] }]) {
        assert.throws(() => guard.prepareWrite(input));
    }
    assert.throws(() => guard.assertInputBudget(new Date()), /json_invalid/u);
    assert.throws(() => guard.assertInputBudget({ value: Number.NaN }), /json_invalid/u);
    const getter = Object.defineProperty({}, 'value', { enumerable: true, get: () => { throw new Error('getter_executed'); } });
    assert.throws(() => guard.assertInputBudget(getter), /json_invalid/u);
    assert.throws(() => guard.prepareRead(getter, {}), /json_invalid/u);
    assert.throws(() => guard.prepareWrite(getter, {}), /json_invalid/u);
    const serializer = Object.defineProperty({}, 'toJSON', { value: () => { throw new Error('serializer_executed'); } });
    assert.throws(() => guard.assertInputBudget(serializer), /json_invalid/u);
    assert.equal(state(root), before);
});

test('snapshot rechecks file identity and ignores a forged absolute target', (context) => {
    const { root, guard } = fixture(context);
    const target = guard.prepareRead({ path: 'assets/a.txt' })[0];
    assert.ok(target);
    assert.equal(guard.readSnapshot({ ...target, absolutePath: join(root, '../outside.txt') }).content, 'original');
    writeFileSync(join(root, 'assets/replacement.txt'), 'replaced');
    renameSync(join(root, 'assets/replacement.txt'), join(root, 'assets/a.txt'));
    const before = state(root);
    assert.throws(() => guard.readSnapshot(target), /snapshot_conflict/u);
    assert.equal(state(root), before);
});

test('complete encoded 4 MiB envelope passes and one extra byte or JSON escaping growth refuses', (context) => {
    const { root, guard } = fixture(context);
    const maximum = CoreTextFileIoContract.limits.maxInputBytes;
    const exact = 'x'.repeat(maximum - 2);
    guard.assertInputBudget(exact);
    guard.assertOutputBudget(exact);
    assert.throws(() => guard.assertInputBudget(`${exact}x`), /json_bytes_exceeded/u);
    assert.throws(() => guard.assertOutputBudget(`${exact}x`), /json_bytes_exceeded/u);
    const before = state(root);
    const content = '\n'.repeat(CoreTextFileIoContract.limits.maxFileBytes);
    assert.throws(() => guard.prepareWrite({ files: [{ path: 'assets/new/a.txt', content },
        { path: 'assets/new/b.txt', content }] }), /json_bytes_exceeded/u);
    assert.equal(state(root), before);
});

test('invalid final content or path rejects the entire preparation unchanged', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    for (const last of [{ path: 'assets/last.txt', content: '\ud800' }, { path: '../outside.txt', content: 'last' },
        { path: `assets/${'x'.repeat(256)}.txt`, content: 'last' }, { path: 'assets/\ud800.txt', content: 'last' }]) {
        assert.throws(() => guard.prepareWrite({ files: [{ path: 'assets/new/sub/a.txt', content: 'first' }, last] }));
        assert.equal(state(root), before);
    }
});

test('existing files obey the actual source byte limit before read or replacement preparation', (context) => {
    const { root, guard } = fixture(context);
    const content = 'x'.repeat(CoreTextFileIoContract.limits.maxFileBytes);
    writeFileSync(join(root, 'assets/source.txt'), content);
    const target = guard.prepareRead({ path: 'assets/source.txt' })[0];
    assert.ok(target);
    assert.equal(guard.readSnapshot(target).byteCount, content.length);
    writeFileSync(join(root, 'assets/source.txt'), `${content}x`);
    const before = state(root);
    assert.throws(() => guard.prepareRead({ path: 'assets/source.txt' }), /file_bytes_exceeded/u);
    assert.throws(() => guard.prepareWrite({ path: 'assets/source.txt', content: 'replacement' }), /file_bytes_exceeded/u);
    assert.equal(state(root), before);
});

for (const key of ['content', 'path', 'files', 'expectedSha256']) {
    test(`non-enumerable ${key} accessor rejects without invocation`, (context) => {
        const { root, guard } = fixture(context);
        const before = state(root);
        let calls = 0;
        const input = { path: 'assets/a.txt', content: 'new' };
        Object.defineProperty(input, key, { enumerable: false, get: () => { calls += 1; throw new Error('accessor_executed'); } });
        assert.throws(() => guard.prepareWrite(input), /json_invalid/u);
        assert.throws(() => guard.prepareWrite(input, {}), /json_invalid/u);
        assert.equal(calls, 0);
        assert.equal(state(root), before);
    });
}

test('hidden used data and hidden array fields cannot bypass complete JSON budget', (context) => {
    const { root, guard } = fixture(context, { maxFiles: 32, maxFileBytes: 1048576, maxInputBytes: 80, maxOutputBytes: 80 });
    const before = state(root);
    const input = { path: 'assets/a.txt' };
    Object.defineProperty(input, 'content', { value: 'x'.repeat(1000), enumerable: false });
    assert.throws(() => guard.prepareWrite(input), /json_invalid/u);
    const paths = ['assets/a.txt'];
    let calls = 0;
    Object.defineProperty(paths, 'hidden', { enumerable: false, get: () => { calls += 1; return 'x'; } });
    assert.throws(() => guard.prepareRead({ paths }), /json_invalid/u);
    assert.equal(calls, 0);
    const hiddenPaths = {};
    Object.defineProperty(hiddenPaths, 'paths', { value: ['assets/a.txt'], enumerable: false });
    assert.throws(() => guard.prepareRead(hiddenPaths), /json_invalid/u);
    assert.equal(state(root), before);
});

for (const hook of ['function', 'getter']) {
    test(`array subclass inherited toJSON ${hook} rejects without invocation`, (context) => {
        const { root, guard } = fixture(context);
        const before = state(root);
        let calls = 0;
        class Base extends Array<unknown> {}
        class Child extends Base {}
        Object.defineProperty(Base.prototype, 'toJSON', hook === 'function'
            ? { value: () => { calls += 1; return []; } }
            : { get: () => { calls += 1; return () => []; } });
        const paths = new Child('assets/a.txt');
        assert.throws(() => guard.assertInputBudget(paths), /json_invalid/u);
        assert.throws(() => guard.assertOutputBudget({ paths }), /json_invalid/u);
        assert.throws(() => guard.prepareRead({ paths }), /json_invalid/u);
        assert.equal(calls, 0);
        assert.equal(state(root), before);
    });
}

test('business fields never fall back to prototype accessors and valid own JSON data still passes', (context) => {
    const { root, guard } = fixture(context);
    const before = state(root);
    let calls = 0;
    for (const key of ['content', 'expectedSha256', 'files', 'paths']) {
        const prior = Object.getOwnPropertyDescriptor(Object.prototype, key);
        Object.defineProperty(Object.prototype, key, { configurable: true, get: () => { calls += 1; throw new Error('inherited_accessor_executed'); } });
        try {
            if (key === 'content') {
                assert.throws(() => guard.prepareWrite({ path: 'assets/a.txt' }), /write_entry_invalid/u);
            } else if (key === 'paths') {
                assert.equal(guard.prepareRead({ path: 'assets/a.txt' })[0]?.path, 'assets/a.txt');
            } else {
                assert.equal(guard.prepareWrite({ path: 'assets/a.txt', content: 'new' })[0]?.byteCount, 3);
            }
        } finally {
            if (prior == null) {
                Reflect.deleteProperty(Object.prototype, key);
            } else {
                Object.defineProperty(Object.prototype, key, prior);
            }
        }
    }
    assert.equal(calls, 0);
    const plain = Object.fromEntries([['path', 'assets/a.txt'], ['content', 'new']]);
    const nullPrototype = Object.assign(Object.create(null), plain);
    assert.equal(guard.prepareWrite(nullPrototype)[0]?.byteCount, 3);
    assert.equal(guard.prepareRead({ paths: ['assets/a.txt'] })[0]?.path, 'assets/a.txt');
    assert.equal(state(root), before);
});
