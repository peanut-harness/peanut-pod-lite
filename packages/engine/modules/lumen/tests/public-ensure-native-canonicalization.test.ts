import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EnsureSpriteFramesBatchService } from '../source/asset-import/ensure-sprite-frames.js';

/**
 * @description 真实普通文件与原生协议替身；只验证离线顺序和错误边界，不作 Creator 通过。
 */
class Fixture {
    /**
     * @description 独占工程根。
     */
    public readonly root = realpathSync(mkdtempSync(join(tmpdir(), 'peanut-public-ensure-canonical-')));
    /**
     * @description PNG 主身份。
     */
    public readonly uuid = randomUUID();
    /**
     * @description PNG db 路径。
     */
    public readonly url = 'db://assets/Page.png';
    /**
     * @description 普通 PNG 文件。
     */
    public readonly image = join(this.root, 'assets/Page.png');
    /**
     * @description Meta 文件。
     */
    public readonly metaPath = this.image + '.meta';
    /**
     * @description 初始化合法原 PNG 和 Texture-only meta。
     */
    public constructor() {
        mkdirSync(join(this.root, 'assets'));
        copyFileSync(join(__dirname, 'fixtures/native-canonical-page.png'), this.image);
        writeFileSync(this.metaPath, JSON.stringify({ uuid: this.uuid, importer: 'image', imported: true,
            subMetas: { '6c48a': { uuid: `${this.uuid}@6c48a`, importer: 'texture', userData: { wrapModeS: 33071 } } }, userData: {} }));
    }
    /**
     * @description 读取实际磁盘 meta。
     */
    public meta(): Record<string, unknown> { return JSON.parse(readFileSync(this.metaPath, 'utf8')); }
    /**
     * @description 只清理本用例。
     */
    public close(): void { rmSync(this.root, { recursive: true, force: true }); }
}

/**
 * @description 实际原生重导入会以 Texture-first 输出 JSON；直接保存/刷新不做这个规范化。
 */
class Port {
    /**
     * @description 完整公开请求顺序。
     */
    public readonly calls: string[] = [];
    /**
     * @description 必须传播的原错误对象。
     */
    public readonly nativeError = new Error('original-native-reimport-canonicalization');
    /**
     * @description 单故障模式。
     */
    public mode: 'normal' | 'reimport-error' | 'source-drift' | 'uuid-drift' | 'subuuid-drift' | 'semantic-drift' | 'query-error' | 'ready-invalid' | 'frame-missing' | 'recreate' | 'ready-error' | 'pre-query-error' = 'normal';
    /**
     * @description 原生规范化次数。
     */
    public reimports = 0;
    /**
     * @description 绑定自有夹具。
     */
    public constructor(private readonly fixture: Fixture) {}
    /**
     * @description 按实际公开协议读写磁盘与状态。
     */
    public async request(_target: string, message: string, ...args: unknown[]): Promise<unknown> {
        this.calls.push(message);
        if (message === 'query-ready' && this.mode === 'ready-error') { throw this.nativeError; }
        if (message === 'query-ready') { return this.reimports && this.mode === 'ready-invalid' ? null : true; }
        if (message === 'refresh-asset') { return undefined; }
        if (message === 'save-asset-meta') { writeFileSync(this.fixture.metaPath, String(args[1])); return undefined; }
        if (message === 'reimport-asset') {
            assert.equal(args[0], this.fixture.url); this.reimports++;
            if (this.mode === 'reimport-error') { throw this.nativeError; }
            const meta = this.fixture.meta(); const subs = meta.subMetas as Record<string, Record<string, unknown>>;
            meta.subMetas = { '6c48a': subs['6c48a'], f9941: subs.f9941 };
            if (this.mode === 'uuid-drift') { meta.uuid = 'foreign'; }
            if (this.mode === 'subuuid-drift') { subs['6c48a'].uuid = this.fixture.uuid + '@foreign'; }
            if (this.mode === 'semantic-drift') { subs['6c48a'].userData = { wrapModeS: 10497 }; }
            writeFileSync(this.fixture.metaPath, JSON.stringify(meta, null, 2));
            if (this.mode === 'source-drift') { writeFileSync(this.fixture.image, 'external'); }
            if (this.mode === 'recreate') { const bytes = readFileSync(this.fixture.image); renameSync(this.fixture.image, this.fixture.image + '.owned-old'); writeFileSync(this.fixture.image, bytes); }
            return undefined;
        }
        if (message === 'query-asset-meta') { return this.fixture.meta(); }
        if (message === 'query-asset-info') {
            if ((this.reimports && this.mode === 'query-error') || (this.calls.includes('refresh-asset') && this.mode === 'pre-query-error')) { throw this.nativeError; }
            const uuid = String(args[0]);
            if (uuid.endsWith('@f9941')) { return this.reimports && this.mode === 'frame-missing' ? null : { uuid, type: 'cc.SpriteFrame', imported: true, invalid: false }; }
            return { uuid: this.fixture.meta().uuid, url: this.fixture.url, type: 'cc.ImageAsset', imported: true, invalid: false, subMetas: this.fixture.meta().subMetas };
        }
        throw new Error('unexpected-native-message:' + message);
    }
}


for (const refreshRoot of [undefined, 'db://assets']) {
    test(`public ensure ${refreshRoot ?? 'inline'} normalizes new frame once before returning preserved legacy DTO`, async () => {
        const f = new Fixture(), p = new Port(f); const source = readFileSync(f.image), physical = lstatSync(f.image);
        try {
            const result = await new EnsureSpriteFramesBatchService(p).ensureBatch({ projectRoot: f.root, dbPaths: [f.url], refreshRoot });
            assert.deepEqual([result.already, result.ensured, result.errors, result.skipped], [0, 1, 0, 0]);
            assert.equal(result.items[0].spriteFrameUuid, `${f.uuid}@f9941`); assert.equal(p.reimports, 1);
            assert.deepEqual(Object.keys(f.meta().subMetas as object), ['6c48a', 'f9941']);
            assert(p.calls.indexOf('save-asset-meta') < p.calls.indexOf('refresh-asset'));
            assert(p.calls.indexOf('refresh-asset') < p.calls.indexOf('reimport-asset'));
            assert(p.calls.lastIndexOf('query-asset-info') > p.calls.indexOf('reimport-asset'));
            assert.deepEqual(readFileSync(f.image), source); assert.equal(lstatSync(f.image).ino, physical.ino);
            assert.equal(f.meta().uuid, f.uuid);
            assert.equal((f.meta().subMetas as Record<string, Record<string, unknown>>)['6c48a'].uuid, `${f.uuid}@6c48a`);
        } finally { f.close(); }
    });
}
for (const mode of ['reimport-error', 'source-drift', 'uuid-drift', 'subuuid-drift', 'semantic-drift', 'query-error', 'ready-invalid', 'frame-missing', 'recreate', 'ready-error', 'pre-query-error'] as const) {
    test(`public ensure mandatory normalization ${mode} rejects without error laundering or replay`, async () => {
        const f = new Fixture(), p = new Port(f); p.mode = mode;
        try {
            await assert.rejects(new EnsureSpriteFramesBatchService(p).ensureBatch({ projectRoot: f.root, dbPaths: [f.url] }), (error: unknown) => {
                if (['reimport-error', 'query-error', 'ready-error', 'pre-query-error'].includes(mode)) { assert.equal(error, p.nativeError); }
                else { assert(error instanceof Error); assert.match(error.message, /lumen_sprite_frame_/u); }
                return true;
            });
            assert.equal(p.reimports, ['ready-error', 'pre-query-error'].includes(mode) ? 0 : 1);
            assert.equal(p.calls.filter(x => x === 'save-asset-meta').length, 1);
            assert.equal(p.calls.filter(x => x === 'refresh-asset').length, 1);
        } finally { f.close(); }
    });
}
test('public ensure already frame, skipped and missing retain legacy counts without native mutations', async () => {
    const f = new Fixture(), p = new Port(f); const meta = f.meta(), subs = meta.subMetas as Record<string, unknown>;
    subs.f9941 = { uuid: `${f.uuid}@f9941`, importer: 'sprite-frame' }; writeFileSync(f.metaPath, JSON.stringify(meta)); const before = readFileSync(f.metaPath);
    try {
        const result = await new EnsureSpriteFramesBatchService(p).ensureBatch({ projectRoot: f.root, dbPaths: [f.url, 'db://assets/absent.png', 'db://assets/notes.txt'], refreshRoot: 'db://assets' });
        assert.deepEqual([result.already, result.ensured, result.errors, result.skipped], [1, 0, 1, 1]);
        assert.deepEqual(readFileSync(f.metaPath), before); assert.equal(p.reimports, 0);
        assert(!p.calls.includes('save-asset-meta')); assert(!p.calls.includes('refresh-asset'));
    } finally { f.close(); }
});
