import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AssetCatalogStore } from '../src/asset-catalog-store';
import { AssetCatalogBuilder } from '../src/asset-catalog-builder';
import { AssetCatalogFastLookupApi } from '../src/asset-catalog-fast-lookup-api';
import { AssetCatalogQueryService } from '../src/asset-catalog-query-service';
import { AssetCatalogRefreshService } from '../src/asset-catalog-refresh-service';
import { CocosUuidCodec } from '../src/cocos-uuid-codec';

test('compresses Creator script uuid to prefab __type__ form', (): void => {
    const codec = new CocosUuidCodec();
    assert.equal(codec.compress('79507851-d12b-4e25-adc1-31f29ea29cc6'), '79507hR0StOJa3BMfKeopzG');
});

test('builds typed catalog from assets metas and supports query', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-cac-'));
    try {
        const scriptUuid = '79507851-d12b-4e25-adc1-31f29ea29cc6';
        const imageUuid = '120f8397-962e-40dc-ae57-230feffa02fa';
        mkdirSync(join(root, 'assets', 'match', 'items'), { recursive: true });
        writeFileSync(join(root, 'assets', 'match', 'items', 'SeatItem.ts'), 'export class SeatItem {}\n', 'utf8');
        writeFileSync(
            join(root, 'assets', 'match', 'items', 'SeatItem.ts.meta'),
            JSON.stringify({
                ver: '4.0.24',
                importer: 'typescript',
                imported: true,
                uuid: scriptUuid,
                files: [],
                subMetas: {},
                userData: {},
            }),
            'utf8',
        );
        writeFileSync(join(root, 'assets', 'match', 'items', 'icon.png'), 'png', 'utf8');
        writeFileSync(
            join(root, 'assets', 'match', 'items', 'icon.png.meta'),
            JSON.stringify({
                ver: '1.0.27',
                importer: 'image',
                imported: true,
                uuid: imageUuid,
                files: ['.json', '.png'],
                subMetas: {
                    f9941: {
                        importer: 'sprite-frame',
                        uuid: `${imageUuid}@f9941`,
                        displayName: 'icon',
                        id: 'f9941',
                        name: 'spriteFrame',
                        userData: {},
                        ver: '1.0.12',
                        imported: true,
                        files: ['.json'],
                        subMetas: {},
                    },
                },
                userData: { type: 'sprite-frame' },
            }),
            'utf8',
        );
        writeFileSync(
            join(root, 'assets', 'match.meta'),
            JSON.stringify({
                ver: '1.2.0',
                importer: 'directory',
                imported: true,
                uuid: 'a117722c-0656-458d-9fbd-44d0642ee3d3',
                files: [],
                subMetas: {},
                userData: { isBundle: true },
            }),
            'utf8',
        );

        const document = new AssetCatalogBuilder().build(root);
        assert.equal(document.counts.script, 1);
        assert.equal(document.counts.image, 1);
        assert.equal(document.counts.spriteFrame, 1);
        assert.equal(document.uuidMap[scriptUuid]?.compressedUuid, '79507hR0StOJa3BMfKeopzG');
        assert.equal(document.uuidMap[scriptUuid]?.bundle, 'assets/match');
        assert.equal(document.uuidMap[`${imageUuid}@f9941`]?.type, 'spriteFrame');

        const query = new AssetCatalogQueryService();
        const hits = query.query(document, { type: 'script', nameContains: 'Seat' });
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.path, 'assets/match/items/SeatItem.ts');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('classifies Creator 2.4 folder importer as directory', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-cac-folder-'));
    try {
        mkdirSync(join(root, 'assets', 'ui'), { recursive: true });
        writeFileSync(
            join(root, 'assets', 'ui.meta'),
            JSON.stringify({
                ver: '1.0.0',
                importer: 'folder',
                imported: true,
                uuid: 'f01de700-2a4a-4f01-8f01-de7002a4a4f0',
                files: [],
                subMetas: {},
                userData: {},
            }),
            'utf8',
        );
        const document = new AssetCatalogBuilder().build(root);
        assert.equal(document.counts.directory, 1);
        assert.equal(document.counts.other, 0);
        assert.equal(document.byType.directory?.[0]?.importer, 'folder');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('classifies material animation physics and terrain importers', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-cac-lumen-'));
    try {
        mkdirSync(join(root, 'assets'), { recursive: true });
        const files: Array<{ name: string; importer: string; uuid: string }> = [
            { name: 'Lit.mtl', importer: 'material', uuid: '11111111-1111-4111-8111-111111111111' },
            { name: 'Idle.anim', importer: 'animation-clip', uuid: '22222222-2222-4222-8222-222222222222' },
            { name: 'Ground.pmtl', importer: 'physics-material', uuid: '33333333-3333-4333-8333-333333333333' },
            { name: 'Field.terrain', importer: 'terrain', uuid: '44444444-4444-4444-8444-444444444444' },
            { name: 'Unlit.effect', importer: 'effect', uuid: '55555555-5555-4555-8555-555555555555' },
            { name: 'Hero.fbx', importer: 'fbx', uuid: '66666666-6666-4666-8666-666666666666' },
            { name: 'Icons.pac', importer: 'auto-atlas', uuid: '77777777-7777-4777-8777-777777777777' },
            { name: 'Digits.labelatlas', importer: 'label-atlas', uuid: '88888888-8888-4888-8888-888888888888' },
            { name: 'Hero.animgraph', importer: 'animation-graph', uuid: '99999999-9999-4999-8999-999999999999' },
            { name: 'Hero.animgraphvari', importer: 'animation-graph-variant', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { name: 'Body.animask', importer: 'animation-mask', uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
            { name: 'Screen.rt', importer: 'render-texture', uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
            { name: 'Forward.rpp', importer: 'render-pipeline', uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
            { name: 'Main.flow', importer: 'render-flow', uuid: '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b' },
            { name: 'Opaque.stg', importer: 'render-stage', uuid: '1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c' },
            { name: 'Cube.mesh', importer: 'instantiation-mesh', uuid: '1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d' },
            { name: 'Skin.skeleton', importer: 'instantiation-skeleton', uuid: '1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e' },
            { name: 'Walk.animation', importer: 'instantiation-animation', uuid: '1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f' },
            { name: 'Body.material', importer: 'instantiation-material', uuid: '20202020-2020-4202-8202-202020202020' },
            { name: 'Click.wav', importer: 'audio-clip', uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
            { name: 'Intro.mp4', importer: 'video-clip', uuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
            { name: 'Title.ttf', importer: 'ttf-font', uuid: '10101010-1010-4010-8010-101010101010' },
            { name: 'Score.fnt', importer: 'bitmap-font', uuid: '12121212-1212-4212-8212-121212121212' },
            { name: 'Hero.skel', importer: 'spine-data', uuid: '13131313-1313-4313-8313-131313131313' },
            { name: 'Hero.dbbin', importer: 'dragonbones', uuid: '14141414-1414-4414-8414-141414141414' },
            { name: 'Hero_tex.json', importer: 'dragonbones-atlas', uuid: '15151515-1515-4515-8515-151515151515' },
            { name: 'Sky.cubemap', importer: 'texture-cube', uuid: '16161616-1616-4616-8616-161616161616' },
            { name: 'Level.tmx', importer: 'tiled-map', uuid: '17171717-1717-4717-8717-171717171717' },
            { name: 'Smoke.plist', importer: 'particle', uuid: '18181818-1818-4818-8818-181818181818' },
            { name: 'HeroAtlas.plist', importer: 'sprite-atlas', uuid: '19191919-1919-4919-8919-191919191919' },
            { name: 'Table.bin', importer: 'buffer', uuid: '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a' },
        ];
        for (const file of files) {
            writeFileSync(join(root, 'assets', file.name), '{}\n', 'utf8');
            const subMetas =
                file.importer === 'fbx'
                    ? {
                          mesh0: {
                              importer: 'mesh',
                              uuid: `${file.uuid}@mesh`,
                              name: 'Cube',
                              displayName: 'Cube',
                          },
                          prefab0: {
                              importer: 'prefab',
                              uuid: `${file.uuid}@prefab`,
                              name: 'Hero',
                              displayName: 'Hero',
                          },
                      }
                    : file.importer === 'render-texture'
                      ? {
                            f9941: {
                                importer: 'rt-sprite-frame',
                                uuid: `${file.uuid}@f9941`,
                                name: 'spriteFrame',
                                displayName: 'Screen',
                            },
                        }
                      : file.importer === 'sprite-atlas'
                        ? {
                              icon: {
                                  importer: 'sprite-frame',
                                  uuid: `${file.uuid}@icon`,
                                  name: 'icon',
                                  displayName: 'icon',
                              },
                          }
                        : {};
            writeFileSync(
                join(root, 'assets', `${file.name}.meta`),
                JSON.stringify({
                    ver: '1.1.50',
                    importer: file.importer,
                    imported: true,
                    uuid: file.uuid,
                    files: [],
                    subMetas,
                    userData: {},
                }),
                'utf8',
            );
        }
        const document = new AssetCatalogBuilder().build(root);
        assert.equal(document.counts.material, 2);
        assert.equal(document.counts.animationClip, 2);
        assert.equal(document.counts.physicsMaterial, 1);
        assert.equal(document.counts.terrain, 1);
        assert.equal(document.counts.effect, 1);
        assert.equal(document.counts.model, 1);
        assert.equal(document.counts.mesh, 2);
        assert.equal(document.counts.prefab, 1);
        assert.equal(document.counts.autoAtlas, 1);
        assert.equal(document.counts.font, 3);
        assert.equal(document.counts.animationGraph, 3);
        assert.equal(document.counts.renderTexture, 1);
        assert.equal(document.counts.renderPipeline, 1);
        assert.equal(document.counts.renderFlow, 1);
        assert.equal(document.counts.renderStage, 1);
        assert.equal(document.counts.other, 1);
        assert.equal(document.counts.audio, 1);
        assert.equal(document.counts.video, 1);
        assert.equal(document.counts.spine, 1);
        assert.equal(document.counts.dragonBones, 2);
        assert.equal(document.counts.cubeMap, 1);
        assert.equal(document.counts.tiledMap, 1);
        assert.equal(document.counts.particle, 1);
        assert.equal(document.counts.spriteAtlas, 1);
        assert.equal(document.counts.buffer, 1);
        assert.equal(document.counts.spriteFrame, 2);
        const query = new AssetCatalogQueryService();
        assert.ok(query.query(document, { type: 'material' }).some((entry) => entry.name === 'Lit.mtl'));
        assert.equal(query.parseType('animationClip'), 'animationClip');
        assert.equal(query.query(document, { type: 'model' })[0]?.name, 'Hero.fbx');
        assert.ok(query.query(document, { type: 'mesh' }).some((entry) => entry.displayName === 'Cube'));
        assert.equal(query.query(document, { type: 'autoAtlas' })[0]?.name, 'Icons.pac');
        const fonts = query.query(document, { type: 'font' });
        assert.equal(fonts.length, 3);
        assert.ok(fonts.some((entry) => entry.name === 'Digits.labelatlas'));
        assert.ok(fonts.some((entry) => entry.name === 'Title.ttf'));
        assert.ok(fonts.some((entry) => entry.name === 'Score.fnt'));
        assert.equal(query.query(document, { type: 'animationGraph' }).length, 3);
        assert.equal(query.query(document, { type: 'renderTexture' })[0]?.name, 'Screen.rt');
        assert.equal(query.query(document, { type: 'renderPipeline' })[0]?.name, 'Forward.rpp');
        assert.equal(query.query(document, { type: 'renderFlow' })[0]?.name, 'Main.flow');
        assert.equal(query.query(document, { type: 'renderStage' })[0]?.name, 'Opaque.stg');
        assert.ok(query.query(document, { type: 'mesh' }).some((entry) => entry.name === 'Cube.mesh'));
        assert.ok(query.query(document, { type: 'material' }).some((entry) => entry.name === 'Body.material'));
        assert.ok(query.query(document, { type: 'animationClip' }).some((entry) => entry.name === 'Walk.animation'));
        assert.equal(query.query(document, { type: 'other' })[0]?.name, 'Skin.skeleton');
        assert.equal(query.query(document, { type: 'audio' })[0]?.name, 'Click.wav');
        assert.equal(query.query(document, { type: 'video' })[0]?.name, 'Intro.mp4');
        assert.equal(query.query(document, { type: 'spine' })[0]?.name, 'Hero.skel');
        assert.equal(query.query(document, { type: 'dragonBones' }).length, 2);
        assert.equal(query.query(document, { type: 'cubeMap' })[0]?.name, 'Sky.cubemap');
        assert.equal(query.query(document, { type: 'tiledMap' })[0]?.name, 'Level.tmx');
        assert.equal(query.query(document, { type: 'particle' })[0]?.name, 'Smoke.plist');
        assert.equal(query.query(document, { type: 'spriteAtlas' })[0]?.name, 'HeroAtlas.plist');
        assert.equal(query.query(document, { type: 'buffer' })[0]?.name, 'Table.bin');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('refresh service writes catalog files under .peanut-ai', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-cac-refresh-'));
    try {
        mkdirSync(join(root, 'assets'), { recursive: true });
        writeFileSync(join(root, 'assets', 'note.json'), '{}\n', 'utf8');
        writeFileSync(
            join(root, 'assets', 'note.json.meta'),
            JSON.stringify({
                ver: '2.0.1',
                importer: 'json',
                imported: true,
                uuid: 'fcd35f06-7b24-4a02-902c-9f5c8a39b063',
                files: ['.json'],
                subMetas: {},
                userData: {},
            }),
            'utf8',
        );
        const result = new AssetCatalogRefreshService().refresh(root, undefined, root);
        const raw = readFileSync(result.catalogPath, 'utf8');
        const parsed = JSON.parse(raw) as { counts: { config: number } };
        assert.equal(parsed.counts.config, 1);
        assert.match(result.catalogPath.replaceAll('\\', '/'), /\.peanut-ai\/asset-catalog\/summary\.json$/u);
        const hits = new AssetCatalogRefreshService().query(root, undefined, root, {
            type: 'config',
            nameContains: 'note',
            limit: 5,
        });
        assert.equal(hits.length, 1);

        const api = new AssetCatalogFastLookupApi();
        const summary = api.summary(root, root);
        assert.ok('counts' in summary);
        assert.equal(summary.counts.config, 1);
        const lookup = api.lookup(root, { type: 'config', name: 'note', limit: 5 }, root);
        assert.equal(lookup.count, 1);
        assert.equal(lookup.hits[0]?.uuid, 'fcd35f06-7b24-4a02-902c-9f5c8a39b063');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('rebuilds catalog from AssetDB query-assets snapshots', async (): Promise<void> => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-cac-assetdb-'));
    try {
        mkdirSync(join(root, 'assets'), { recursive: true });
        const scriptUuid = '79507851-d12b-4e25-adc1-31f29ea29cc6';
        const imageUuid = '120f8397-962e-40dc-ae57-230feffa02fa';
        const assetDb = {
            queryAssets: async (): Promise<readonly import('../src/asset-db-query-client').IEditorAssetInfoSnapshot[]> => [
                {
                    uuid: scriptUuid,
                    importer: 'typescript',
                    name: 'SeatItem.ts',
                    url: 'db://assets/match/items/SeatItem.ts',
                },
                {
                    uuid: imageUuid,
                    importer: 'image',
                    name: 'icon.png',
                    url: 'db://assets/match/items/icon.png',
                    subAssets: {
                        f9941: {
                            uuid: `${imageUuid}@f9941`,
                            importer: 'sprite-frame',
                            name: 'spriteFrame',
                            url: 'db://assets/match/items/icon.png@f9941',
                        },
                    },
                },
            ],
        };
        const result = await new AssetCatalogRefreshService().refreshPreferringAssetDb(root, undefined, root, assetDb);
        assert.equal(result.source, 'asset-db');
        assert.equal(result.document.counts.script, 1);
        assert.equal(result.document.counts.spriteFrame, 1);
        assert.equal(result.document.uuidMap[scriptUuid]?.compressedUuid, '79507hR0StOJa3BMfKeopzG');
        assert.equal(result.document.uuidMap[`${imageUuid}@f9941`]?.type, 'spriteFrame');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});


test('cold summary is explicit and readonly; approved refresh restores actual counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-catalog-cold-'));
    try {
        mkdirSync(join(root, 'assets'));
        const api = new AssetCatalogFastLookupApi();
        const unavailable = api.summary(root, root);
        assert.deepEqual(unavailable, { available: false, availability: 'refused', code: 'asset_catalog_not_initialized',
            message: 'asset_catalog_not_initialized', recommendedAction: 'asset.catalog.refresh' });
        assert.equal(existsSync(join(root, '.peanut-ai')), false);
        assert.equal('counts' in unavailable, false);
        assert.equal('generatedAt' in unavailable, false);
        writeFileSync(join(root, 'assets/note.json'), '{"test":true}');
        writeFileSync(join(root, 'assets/note.json.meta'), JSON.stringify({ importer: 'json', uuid: 'fcd35f06-7b24-4a02-902c-9f5c8a39b063' }));
        const refreshed = api.refresh(root, root);
        const before = readFileSync(refreshed.summaryPath);
        const summary = api.summary(root, root);
        assert.ok('counts' in summary);
        assert.equal(summary.counts.config, 1);
        assert.equal(summary.generatedAt, refreshed.generatedAt);
        assert.deepEqual(readFileSync(refreshed.summaryPath), before);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('corrupt summary is not classified as an uninitialized catalog', () => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-catalog-corrupt-'));
    try {
        mkdirSync(join(root, 'assets'));
        mkdirSync(join(root, '.peanut-ai/asset-catalog'), { recursive: true });
        writeFileSync(join(root, '.peanut-ai/asset-catalog/summary.json'), '{');
        assert.throws(() => new AssetCatalogFastLookupApi().summary(root, root), /catalog_json_invalid/u);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('permission, IO and other ENOENT retain their original errors', (context) => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-catalog-errors-'));
    try {
        mkdirSync(join(root, 'assets'));
        const store = new AssetCatalogStore();
        const api = new AssetCatalogFastLookupApi(undefined, store);
        for (const fields of [
            { code: 'EACCES', syscall: 'open', path: join(root, '.peanut-ai/asset-catalog/summary.json') },
            { code: 'EIO', syscall: 'open', path: join(root, '.peanut-ai/asset-catalog/summary.json') },
            { code: 'ENOENT', syscall: 'open', path: join(root, '.peanut-ai/asset-catalog/other.json') },
        ]) {
            const failure = Object.assign(new Error('original-store-failure'), fields);
            const mocked = context.mock.method(store, 'readSummary', () => { throw failure; });
            assert.throws(() => api.summary(root, root), (error: unknown) => error === failure);
            mocked.mock.restore();
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
