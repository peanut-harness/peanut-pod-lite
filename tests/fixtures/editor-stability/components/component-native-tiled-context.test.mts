import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';
import { ComponentNativeTiledContext } from './component-native-tiled-context.ts';

const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const observed = { type: 'cc.TiledMap', source: { uuid, type: 'cc.TiledMapAsset', valid: true }, mapSize: { width: 2, height: 2 },
    layer: { valid: true, parentMatches: true, size: { width: 2, height: 2 }, firstGid: 1, textures: [{ type: 'cc.SpriteFrame', valid: true }] },
    group: { valid: true, parentMatches: true, objectCount: 1, objects: [{ name: 'Marker', gid: 1 }] },
    tile: { present: true, parentMatches: true, cacheMatches: true, x: 0, y: 0 },
    user: { present: true, layerMatches: true, row: 0, col: 0 } };

test('Tiled context rejects placeholder maps, wrong sources, empty objects/textures and unregistered tile/user components', () => {
    ComponentNativeTiledContext.assert(observed, uuid, true, true);
    for (const patch of [{ source: { ...observed.source, uuid: 'other' } }, { layer: { ...observed.layer, textures: [] } },
        { group: { ...observed.group, objects: [] } }, { tile: { ...observed.tile, cacheMatches: false } },
        { tile: { ...observed.tile, x: null } }, { user: { ...observed.user, layerMatches: false } }]) {
        assert.throws(() => ComponentNativeTiledContext.assert({ ...observed, ...patch }, uuid, true, true), /component_tiled_native_/u);
    }
    ComponentNativeTiledContext.assert({ ...observed, tile: {}, user: {} }, uuid, false, false);
});

test('actual compiled reader always passes false to getTiledTileAt and invokes no SDK mutator', () => {
    const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('./component-native-tiled-context.ts', import.meta.url))],
        platform: 'node', format: 'cjs', target: 'node14', write: false, bundle: true, external: ['cc'] });
    const code = compiled.outputFiles?.[0]?.text; assert(code);
    const mapNode = {}; const layerNode = { parent: mapNode, getChildByName: (name: string) => name === 'OwnedTile' ? tileNode : userNode };
    const tile = { type: 'cc.TiledTile', x: 0, y: 0 }; const user = { type: 'cc.TiledUserNodeData', _row: 0, _col: 0, _tiledLayer: {} };
    const tileNode = { parent: layerNode, getComponent: () => tile }; const userNode = { parent: layerNode, getComponent: () => user };
    let calls = 0;
    const layer = { node: layerNode, getLayerSize: () => ({ width: 2, height: 2 }), getTileGIDAt: () => 1,
        getTextures: () => [{ type: 'cc.SpriteFrame' }], getTiledTileAt: (x: number, y: number, create: boolean) => {
            calls++; assert.equal(x, 0); assert.equal(y, 0); assert.equal(create, false); return tile;
        } };
    user._tiledLayer = layer;
    const map = { type: 'cc.TiledMap', node: mapNode, tmxAsset: { type: 'cc.TiledMapAsset', _uuid: uuid }, getMapSize: () => ({ width: 2, height: 2 }),
        getLayer: () => layer, getObjectGroup: () => ({ node: { parent: mapNode }, getObjects: () => [{ name: 'Marker', gid: 1 }] }) };
    const cc = { js: { getClassName: (value: { type: string }) => value.type }, isValid: () => true };
    const output = { exports: {} };
    runInNewContext(code, { module: output, exports: output.exports, require: (id: string) => { assert.equal(id, 'cc'); return cc; } });
    const context: unknown = Reflect.get(output.exports, 'ComponentNativeTiledContext'); assert(typeof context === 'function');
    const read: unknown = Reflect.get(context, 'read'); assert(typeof read === 'function');
    const result = JSON.parse(JSON.stringify(Reflect.apply(read, context, [map])));
    ComponentNativeTiledContext.assert(result, uuid, true, true); assert.equal(calls, 1);
});
