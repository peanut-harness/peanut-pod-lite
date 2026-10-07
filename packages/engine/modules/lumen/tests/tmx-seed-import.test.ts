import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { AssetImportBatchExecutor } from '../source/asset-import/asset-import-batch-executor.js';
import { AssetImportPlanner } from '../source/asset-import/asset-import-planner.js';

const xml = '<?xml version="1.0"?><map version="1.4" orientation="orthogonal" width="2" height="2" tilewidth="16" tileheight="16" infinite="0"><tileset firstgid="1" name="Tiles" tilewidth="16" tileheight="16" tilecount="448" columns="32"><image source="Tiles.png" width="512" height="224"/></tileset><layer name="Ground" width="2" height="2"><data encoding="csv">1,2,3,4</data></layer></map>';
const png = Buffer.from('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', 'base64');

/**
 * @description 使用合法原始 PNG 与有限 TMX；消息替身只证明离线调用顺序与失败边界，不作原生证明。
 */
class Fixture {
    /**
     * @description 本用例独占临时根。
     */
    public readonly root = mkdtempSync(join(tmpdir(), 'peanut-tmx-seed-'));
    /**
     * @description 模拟工程资产根。
     */
    public readonly project = join(this.root, 'project');
    /**
     * @description 原 TMX 源。
     */
    public readonly map = join(this.root, 'Map.tmx');
    /**
     * @description 原合法 PNG 源。
     */
    public readonly image = join(this.root, 'Tiles.png');
    /**
     * @description 创建自有源文件与工程。
     * @param document TMX 全文。
     */
    public constructor(document = xml) {
        mkdirSync(join(this.project, 'assets'), { recursive: true });
        writeFileSync(this.map, document);
        writeFileSync(this.image, png);
    }
    /**
     * @description 只释放本用例独占目录。
     * @returns 无。
     */
    public close(): void { rmSync(this.root, { recursive: true, force: true }); }
}

/**
 * @description 模拟 AssetDB 最小公开协议，实际复制源与 meta，检查真实文件身份及顺序。
 */
class Port {
    /**
     * @description 已发生的公开消息。
     */
    public readonly calls: string[] = [];
    /**
     * @description 原生请求故障原对象。
     */
    public readonly nativeError = new Error('original-native-save');
    /**
     * @description 注入的独立故障或控制。
     */
    public mode: 'normal' | 'save-error' | 'frame-missing' | 'source-drift' | 'uuid-drift' | 'rename' | 'already' | 'map-ref-wrong' | 'map-source-drift' | 'map-query-error' = 'normal';
    /**
     * @description 每个已导入目标的真实模拟主身份。
     */
    private readonly _ids = new Map<string, string>();
    /**
     * @description 故障注入后的帧登记状态。
     */
    private _frame = false;
    /**
     * @description 实际模拟地图 library 路径。
     */
    private readonly _mapLibraries = new Map<string, string>();
    /**
     * @description 捕获层后 ready 屏障。
     */
    private _ready = false;
    /**
     * @description 绑定唯一自有工程。
     * @param fixture 用例工程。
     */
    public constructor(private readonly fixture: Fixture) {}
    /**
     * @description 执行受控公开消息，不替代真实 Creator 验收。
     * @param _target 公开 target。
     * @param message 消息名。
     * @param args 参数。
     * @returns 实际模拟回执。
     */
    public async request(_target: string, message: string, ...args: unknown[]): Promise<unknown> {
        this.calls.push(message);
        if (message === 'query-ready') { this._ready = true; return true; }
        if (message === 'refresh-asset') { return true; }
        if (message === 'import-asset' || message === 'import') {
            const source = String(args[0]);
            let url = String(args[1]);
            if (source.endsWith('.tmx')) {
                assert(this._ready, 'PNG readiness before TMX');
                assert(this._frame, 'real SpriteFrame registration before TMX');
            }
            if (source.endsWith('.png') && this.mode === 'rename') { url = url.replace('Tiles.png', 'Tiles-1.png'); }
            const file = join(this.fixture.project, url.slice(5));
            mkdirSync(dirname(file), { recursive: true });
            copyFileSync(source, file);
            const uuid = randomUUID();
            this._ids.set(url, uuid);
            const meta = { uuid, importer: source.endsWith('.png') ? 'image' : 'tiled-map', imported: true, subMetas: source.endsWith('.png') ? { '6c48a': { importer: 'texture', uuid: `${uuid}@6c48a`, userData: {} } } : {}, userData: {} };
            writeFileSync(file + '.meta', JSON.stringify(meta));
            if (source.endsWith('.png') && this.mode === 'already') {
                this._frame = true;
                writeFileSync(file + '.meta', JSON.stringify({ ...meta, subMetas: { ...meta.subMetas, f9941: { importer: 'sprite-frame', uuid: `${uuid}@f9941` } } }));
            }
            if (source.endsWith('.tmx')) {
                const library = join(this.fixture.project, 'library', uuid + '.json');
                mkdirSync(dirname(library), { recursive: true });
                const imageUuid = this._ids.get(url.replace(/[^/]+$/u, 'Tiles.png'));
                writeFileSync(library, JSON.stringify({ __type__: 'cc.TiledMapAsset', tmxXmlStr: readFileSync(file, 'utf8'), spriteFrameNames: ['Tiles.png'], spriteFrames: [{ __uuid__: this.mode === 'map-ref-wrong' ? 'foreign@f9941' : `${imageUuid}@f9941` }] }));
                this._mapLibraries.set(url, library);
                if (this.mode === 'map-source-drift') { writeFileSync(file, 'external'); }
            }
            return { url, uuid };
        }
        const url = String(args[0]);
        const file = join(this.fixture.project, url.slice(5));
        if (message === 'reimport-asset') {
            const metadata = JSON.parse(readFileSync(file + '.meta', 'utf8'));
            metadata.subMetas = { '6c48a': metadata.subMetas['6c48a'], f9941: metadata.subMetas.f9941 };
            writeFileSync(file + '.meta', JSON.stringify(metadata));
            return undefined;
        }
        if (message === 'query-asset-meta') { return JSON.parse(readFileSync(file + '.meta', 'utf8')); }
        if (message === 'query-asset-info') {
            if (url.endsWith('@f9941')) {
                return this._frame && this.mode !== 'frame-missing' ? { uuid: url, type: 'cc.SpriteFrame', imported: true, invalid: false } : null;
            }
            if (url.endsWith('@6c48a')) { return { uuid: url, type: 'cc.Texture2D', imported: true, invalid: false }; }
            if (this._mapLibraries.has(url)) {
                if (this.mode === 'map-query-error') { throw this.nativeError; }
                return { uuid: this._ids.get(url), url, importer: 'tiled-map', type: 'cc.TiledMapAsset', imported: true, invalid: false, library: { '.json': this._mapLibraries.get(url) } };
            }
            const uuid = this._ids.get(url);
            return uuid == null ? null : { uuid, url, importer: 'image', type: 'cc.ImageAsset', imported: true, invalid: false };
        }
        if (message === 'save-asset-meta') {
            if (this.mode === 'save-error') { throw this.nativeError; }
            writeFileSync(file + '.meta', String(args[1]));
            this._frame = true;
            if (this.mode === 'source-drift') { writeFileSync(file, Buffer.concat([png, Buffer.from('external')])); }
            if (this.mode === 'uuid-drift') { this._ids.set(url, randomUUID()); }
            return { uuid: this._ids.get(url), url };
        }
        throw new Error(`unexpected-public-message:${message}`);
    }
}

test('TMX seed expands same-directory PNG and places it before map without dependencyMap', (): void => {
    const f = new Fixture();
    try {
        const p = new AssetImportPlanner();
        const plan = p.plan([f.map], { expandClosure: true });
        assert.deepEqual(p.flatten(plan), [f.image, f.map]);
        assert.deepEqual(plan.missingDependencies, []);
        assert.deepEqual(readFileSync(f.image), png);
    } finally { f.close(); }
});

test('XML builtin entity is decoded once for an actual local filename', (): void => {
    const f = new Fixture(xml.replace('Tiles.png', 'Tiles &amp; page.png'));
    try {
        const image = join(f.root, 'Tiles & page.png'); writeFileSync(image, png);
        assert.deepEqual(new AssetImportPlanner().plan([f.map], { expandClosure: true }).expandedSources.slice().sort(), [f.map, image].sort());
    } finally { f.close(); }
});

for (const [name, document] of [
    ['parent escape', xml.replace('Tiles.png', '../Tiles.png')],
    ['URI', xml.replace('Tiles.png', 'https://example.invalid/Tiles.png')],
    ['numeric escaped slash', xml.replace('Tiles.png', '&#47;Tiles.png')],
    ['unknown entity', xml.replace('Tiles.png', '&other;.png')],
    ['DTD', '<!DOCTYPE map SYSTEM "external.dtd">' + xml],
    ['external TSX', xml.replace('<tileset firstgid="1"', '<tileset source="external.tsx" firstgid="1"')],
    ['infinite chunks', xml.replace('infinite="0"', 'infinite="1"')],
    ['compression', xml.replace('encoding="csv"', 'encoding="base64" compression="zlib"')],
    ['missing image declaration', xml.replace(/<image[^>]*\/>/u, '')],
]) {
    test(`invalid ${name} is refused before any native mutation`, async (): Promise<void> => {
        const f = new Fixture(document); const p = new Port(f);
        try {
            await assert.rejects(new AssetImportBatchExecutor(p, 50).importBatch({ sources: [f.map, f.image], target: 'db://assets/Maps', projectRoot: f.project }), /asset_import_tmx_/u);
            assert.deepEqual(p.calls, []);
            assert(!existsSync(join(f.project, 'assets/Maps')));
        } finally { f.close(); }
    });
}

test('missing local image refuses the entire batch before any native call', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f); rmSync(f.image);
    try {
        await assert.rejects(new AssetImportBatchExecutor(p).importBatch({ sources: [f.map], target: 'db://assets/Maps', projectRoot: f.project }), /asset_import_(missing_dependencies|tmx_)/u);
        assert.deepEqual(p.calls, []);
    } finally { f.close(); }
});

test('mixed valid then invalid map is wholly rejected before the first native call', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f); const bad = join(f.root, 'Bad.tmx'); writeFileSync(bad, xml.replace('Tiles.png', '../Tiles.png'));
    try {
        await assert.rejects(new AssetImportBatchExecutor(p).importBatch({ sources: [f.map, bad], target: 'db://assets/Maps', projectRoot: f.project }), /asset_import_tmx_/u);
        assert.deepEqual(p.calls, []);
    } finally { f.close(); }
});

test('symlink image source cannot escape the owned dependency directory', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f); const other = join(f.root, 'Other.png'); writeFileSync(other, png); rmSync(f.image); symlinkSync(other, f.image);
    try {
        await assert.rejects(new AssetImportBatchExecutor(p).importBatch({ sources: [f.map], target: 'db://assets/Maps', projectRoot: f.project }), /asset_import_tmx_/u);
        assert.deepEqual(p.calls, []);
    } finally { f.close(); }
});

test('actual PNG native promotion and UUID queries occur before TMX import', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f);
    try {
        const r = await new AssetImportBatchExecutor(p, 50).importBatch({ sources: [f.map], target: 'db://assets/Maps', projectRoot: f.project });
        assert.equal(r.allSucceeded, true); assert.deepEqual(r.imported.map(x => basename(x.source)), ['Tiles.png', 'Map.tmx']);
        assert.equal(p.calls.filter(x => x === 'save-asset-meta').length, 1); assert(p.calls.includes('query-asset-info'));
        assert.deepEqual(readFileSync(join(f.project, 'assets/Maps/Tiles.png')), png);
    } finally { f.close(); }
});

for (const mode of ['save-error', 'frame-missing', 'source-drift', 'uuid-drift', 'rename'] as const) {
    test(`native ${mode} stops before TMX and never blindly replays PNG or meta`, async (): Promise<void> => {
        const f = new Fixture(); const p = new Port(f); p.mode = mode;
        try {
            await assert.rejects(new AssetImportBatchExecutor(p, 10).importBatch({ sources: [f.image, f.map], target: 'db://assets/Maps', dependencyMap: { [f.map]: [f.image] }, projectRoot: f.project }), (e: unknown): boolean => {
                if (mode === 'save-error') { assert.equal(e, p.nativeError); } else { assert(e instanceof Error && /asset_import_tmx_/u.test(e.message)); }
                return true;
            });
            assert.equal(p.calls.filter(x => x === 'import-asset').length, 1); assert(!existsSync(join(f.project, 'assets/Maps/Map.tmx')));
            assert(p.calls.filter(x => x === 'save-asset-meta').length <= 1);
        } finally { f.close(); }
    });
}

test('already typed imported PNG is verified without another native meta save', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f); p.mode = 'already';
    try {
        assert.equal((await new AssetImportBatchExecutor(p, 50).importBatch({ sources: [f.map], target: 'db://assets/Maps', projectRoot: f.project })).allSucceeded, true);
        assert.equal(p.calls.filter(x => x === 'save-asset-meta').length, 0);
    } finally { f.close(); }
});

test('unrelated image-only import retains the original workflow without promotion', async (): Promise<void> => {
    const f = new Fixture(); const p = new Port(f);
    try {
        assert.equal((await new AssetImportBatchExecutor(p, 50).importBatch({ sources: [f.image], target: 'db://assets/Maps', projectRoot: f.project })).allSucceeded, true);
        assert.equal(p.calls.filter(x => x === 'save-asset-meta').length, 0);
        assert.equal(p.calls.filter(x => x === 'query-asset-info').length, 0);
    } finally { f.close(); }
});

for (const mode of ['map-ref-wrong', 'map-source-drift', 'map-query-error'] as const) {
    test(`post-import ${mode} cannot report allSucceeded`, async (): Promise<void> => {
        const f = new Fixture(); const p = new Port(f); p.mode = mode;
        try {
            await assert.rejects(new AssetImportBatchExecutor(p, 50).importBatch({ sources: [f.map], target: 'db://assets/Maps', projectRoot: f.project }), (e: unknown): boolean => {
                if (mode === 'map-query-error') { assert.equal(e, p.nativeError); } else { assert(e instanceof Error && /asset_import_tmx_/u.test(e.message)); }
                return true;
            });
            assert.equal(p.calls.filter(x => x === 'import-asset').length, 2);
            assert.equal(p.calls.filter(x => x === 'save-asset-meta').length, 1);
        } finally { f.close(); }
    });
}
