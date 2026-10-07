import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { AssetImportBatchExecutor } from '../source/asset-import/asset-import-batch-executor.js';
import { LumenResourceWriteLock } from '../source/concurrency/resource-write-lock.js';

/**
 * @description 本用例显式持有的协议完成屏障，不替换生产或原生算法。
 */
function barrier(): { promise: Promise<void>; done: () => void } {
    let done: () => void = () => { throw new Error('barrier_not_initialized'); };
    const promise = new Promise<void>(resolve => { done = resolve; });
    return { promise, done };
}
/**
 * @description 让原 Promise handler 完成一轮；不以模型作为原生时间线证据。
 */
async function turn(): Promise<void> { await new Promise<void>(resolve => { setImmediate(resolve); }); }

/**
 * @description 真实合法 PNG 源文件和自有目标文件；协议替身不当 Creator 验收。
 */
class Fixture {
    /**
     * @description 独占根。
     */
    public readonly root = mkdtempSync(join(tmpdir(), 'peanut-import-null-drain-'));
    /**
     * @description 独占工程。
     */
    public readonly project = join(this.root, 'project');
    /**
     * @description 全部合法源。
     */
    public readonly sources: string[] = [];
    /**
     * @description 初始化源文件与目标目录。
     */
    public constructor(count = 8) {
        mkdirSync(join(this.project, 'assets/Imported'), { recursive: true });
        for (let i = 0; i < count; i++) { const f = join(this.root, String(i).padStart(3, '0') + '.png'); copyFileSync(join(__dirname, 'fixtures/native-canonical-page.png'), f); this.sources.push(f); }
    }
    /**
     * @description 仅清理本用例。
     */
    public close(): void { rmSync(this.root, { recursive: true, force: true }); }
}

/**
 * @description 单个真实公开协议请求的可控回执和在途屏障，记录全部 native 方法/源顺序。
 */
class Port {
    /**
     * @description 完整方法序列。
     */
    public readonly calls: Array<{ method: string; source: string }> = [];
    /**
     * @description 需保持原对象的首个异常。
     */
    public readonly originalError = new Error('original-native-primary-import');
    /**
     * @description 被错误 fallback 覆盖的独立异常。
     */
    public readonly aliasError = new Error('legacy-alias-must-not-replay');
    /**
     * @description 已发出首个失败回执。
     */
    public readonly failed = barrier();
    /**
     * @description 在途项已进入。
     */
    public readonly heldStarted = barrier();
    /**
     * @description 在途项释放。
     */
    public readonly release = barrier();
    /**
     * @description 所有持有的项完成。
     */
    public readonly heldFinished = barrier();
    /**
     * @description 已完成持有的项数。
     */
    private _heldDone = 0;
    /**
     * @description 初始化受控故障，不调用私有生产方法。
     */
    public constructor(private readonly fixture: Fixture, public readonly mode: 'null' | 'undefined' | 'throw' | 'throw-undefined' | 'refresh-throw' | 'normal' | 'rename', public readonly concurrency = 1, private readonly held = false, private readonly badIndex = 0) {}
    /**
     * @description 返回实际接口形状、空回执或原错误；真实文件写入用于在途 writer 断言。
     */
    public async request(_target: string, method: string, ...args: unknown[]): Promise<unknown> {
        const source = String(args[0] ?? ''); this.calls.push({ method, source });
        if (method === 'query-ready') { return true; }
        if (method === 'refresh-asset') { if (this.mode === 'refresh-throw') { throw this.originalError; } return undefined; }
        if (method === 'refresh') { throw this.aliasError; }
        if (method === 'import') { throw this.aliasError; }
        assert.equal(method, 'import-asset');
        const index = Number(basename(source).split('.')[0]);
        if (index === this.badIndex && !['normal', 'rename', 'refresh-throw'].includes(this.mode)) {
            this.failed.done();
            if (this.mode === 'null') { return null; }
            if (this.mode === 'undefined') { return undefined; }
            if (this.mode === 'throw-undefined') { throw undefined; }
            throw this.originalError;
        }
        if (this.held && index > 0 && index < this.concurrency) { this.heldStarted.done(); await this.release.promise; }
        const url = String(args[1]) + (this.mode === 'rename' ? '-renamed.png' : ''), file = join(this.fixture.project, url.slice(5)); copyFileSync(source, file); const uuid = randomUUID(); writeFileSync(file + '.meta', JSON.stringify({ uuid, importer: 'image' }));
        if (this.held && index > 0 && index < this.concurrency) { this._heldDone++; if (this._heldDone === this.concurrency - 1) { this.heldFinished.done(); } }
        return { url, uuid, imported: true, invalid: false };
    }
}
/**
 * @description 使用完整公开导入方法并保持全部输入为合法文件。
 */
function run(f: Fixture, p: Port): Promise<unknown> { return new AssetImportBatchExecutor(p, 30).importBatch({ sources: f.sources, projectRoot: f.project, target: 'db://assets/Imported', concurrency: p.concurrency, refreshAfter: true }); }

for (const mode of ['null', 'undefined'] as const) {
    test(`native ${mode} import reply fails at exact target before queuing another item or refresh`, async () => {
        const f = new Fixture(), p = new Port(f, mode);
        try { await assert.rejects(run(f, p), /asset_import_native_result_missing:db:\/\/assets\/Imported\/000\.png/u); assert.equal(p.calls.filter(x => x.method === 'import-asset').length, 1); assert(!p.calls.some(x => x.method === 'import' || x.method.startsWith('refresh'))); assert.equal(existsSync(join(f.project, 'assets/Imported/001.png')), false); }
        finally { f.close(); }
    });
}
test('first legal successful import retains source/meta while following null stops the remaining source', async () => {
    const f = new Fixture(3), p = new Port(f, 'null', 1, false, 1);
    try { await assert.rejects(run(f, p), /asset_import_native_result_missing:db:\/\/assets\/Imported\/001\.png/u); assert.deepEqual(readFileSync(join(f.project, 'assets/Imported/000.png')), readFileSync(f.sources[0])); assert(existsSync(join(f.project, 'assets/Imported/000.png.meta'))); assert(!existsSync(join(f.project, 'assets/Imported/002.png'))); assert.equal(p.calls.filter(x => x.method === 'import-asset').length, 2); }
    finally { f.close(); }
});
for (const concurrency of [2, 4]) {
    test(`concurrency${concurrency} null stops new scheduling and drains every admitted physical writer before rejection`, async () => {
        const f = new Fixture(), p = new Port(f, 'null', concurrency, true); let settled = false;
        const attempt = run(f, p).then(result => { settled = true; return { ok: true, result, error: undefined }; }, error => { settled = true; return { ok: false, result: undefined, error }; });
        try { await p.failed.promise; await p.heldStarted.promise; await turn(); await turn(); assert.equal(settled, false); assert.equal(p.calls.filter(x => x.method === 'import-asset').length, concurrency); p.release.done(); await p.heldFinished.promise; const r = await attempt; assert.equal(r.ok, false); assert.match(String(r.error), /asset_import_native_result_missing/u); assert(!existsSync(join(f.project, 'assets/Imported/' + String(concurrency).padStart(3, '0') + '.png'))); for (let i = 1; i < concurrency; i++) { assert.deepEqual(readFileSync(join(f.project, 'assets/Imported/' + String(i).padStart(3, '0') + '.png')), readFileSync(f.sources[i])); } }
        finally { p.release.done(); await p.heldFinished.promise; await attempt; f.close(); }
    });
}
test('primary native exception remains exact original object and is not retried through import alias', async () => {
    const f = new Fixture(), p = new Port(f, 'throw');
    try { await assert.rejects(run(f, p), (error: unknown) => { assert.equal(error, p.originalError); return true; }); assert.equal(p.calls.filter(x => x.method === 'import-asset').length, 1); assert(!p.calls.some(x => x.method === 'import')); }
    finally { f.close(); }
});
test('exception with admitted writer drains before surfacing exact first native error', async () => {
    const f = new Fixture(), p = new Port(f, 'throw', 2, true); let settled = false;
    const attempt = run(f, p).then(result => { settled = true; return { ok: true, result, error: undefined }; }, error => { settled = true; return { ok: false, result: undefined, error }; });
    try { await p.failed.promise; await p.heldStarted.promise; await turn(); await turn(); assert.equal(settled, false); p.release.done(); await p.heldFinished.promise; const r = await attempt; assert.equal(r.ok, false); assert.equal(r.error, p.originalError); assert.equal(p.calls.filter(x => x.method === 'import-asset').length, 2); }
    finally { p.release.done(); await p.heldFinished.promise; await attempt; f.close(); }
});
test('shared writer lock stays held until admitted file writer completes after first failure', async () => {
    const f = new Fixture(), p = new Port(f, 'throw', 2, true), lock = LumenResourceWriteLock.shared(); const key = f.project + '/assets/Imported'; let nextWriter = false;
    const first = lock.runExclusive(key, () => run(f, p)).then(result => ({ ok: true, result, error: undefined }), error => ({ ok: false, result: undefined, error })); await p.failed.promise; await p.heldStarted.promise;
    const second = lock.runExclusive(key, async () => { nextWriter = true; writeFileSync(join(f.project, 'assets/Imported/writer-after.txt'), 'next'); });
    try { await turn(); await turn(); assert.equal(nextWriter, false); p.release.done(); await p.heldFinished.promise; const r = await first; assert.equal(r.error, p.originalError); await second; assert.equal(nextWriter, true); assert.deepEqual(readFileSync(join(f.project, 'assets/Imported/001.png')), readFileSync(f.sources[1])); }
    finally { p.release.done(); await p.heldFinished.promise; await first; await second; f.close(); }
});
test('primary refresh exception is preserved without fallback refresh or subsequent ready', async () => {
    const f = new Fixture(1), p = new Port(f, 'refresh-throw');
    try { await assert.rejects(run(f, p), (error: unknown) => { assert.equal(error, p.originalError); return true; }); assert(!p.calls.some(x => x.method === 'refresh')); assert.equal(p.calls[p.calls.length - 1]?.method, 'refresh-asset'); }
    finally { f.close(); }
});
test('primitive undefined native rejection remains rejection and never replays another native method', async () => {
    const f = new Fixture(1), p = new Port(f, 'throw-undefined');
    try { let rejected = false; await run(f, p).then(() => {}, error => { rejected = true; assert.equal(error, undefined); }); assert.equal(rejected, true); assert(!p.calls.some(x => x.method === 'import')); }
    finally { f.close(); }
});
test('valid concurrent native import results retain stable source order, original bytes and no alias', async () => {
    const f = new Fixture(4), p = new Port(f, 'normal', 4);
    try { const result = await new AssetImportBatchExecutor(p).importBatch({ sources: f.sources, projectRoot: f.project, target: 'db://assets/Imported', concurrency: 4 }); assert.equal(result.allSucceeded, true); assert.deepEqual(result.imported.map(x => x.source), f.sources); assert(!p.calls.some(x => x.method === 'import' || x.method === 'refresh')); for (const src of f.sources) { assert.deepEqual(readFileSync(join(f.project, 'assets/Imported', basename(src))), readFileSync(src)); } }
    finally { f.close(); }
});
test('valid native renamed URL is retained without replacing source identity or inventing planned registration', async () => {
    const f = new Fixture(1), p = new Port(f, 'rename');
    try { const result = await new AssetImportBatchExecutor(p).importBatch({ sources: f.sources, projectRoot: f.project, target: 'db://assets/Imported' }); assert.equal(result.allSucceeded, true); assert.equal(result.imported[0]?.targetDbPath, 'db://assets/Imported/000.png-renamed.png'); assert(!existsSync(join(f.project, 'assets/Imported/000.png'))); assert.deepEqual(readFileSync(join(f.project, 'assets/Imported/000.png-renamed.png')), readFileSync(f.sources[0])); }
    finally { f.close(); }
});
