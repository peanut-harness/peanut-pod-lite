import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import { LumenNativeComponentPersistence } from '../source/schema/native-component-persistence';

for (const version of ['3.8.3', '3.8.7'] as const) {
test(`${version} refuses source-owned layer/group removal atomically while allowing persistent fields and tile lifecycle`, () => {
    const document = LumenPrefabDocument.createEmptyScene('assets/tiled.scene', 'Root');
    document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
    document.addChildFromSpec('/Root', { name: 'Map' });
    document.attachBuiltinComponent('/Root/Map', 'cc.TiledMap');
    document.setComponentProperty('/Root/Map', 'cc.TiledMap', { tmxFile: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    for (const [name, type] of [['Ground', 'cc.TiledLayer'], ['Objects', 'cc.TiledObjectGroup']] as const) {
        const path = '/Root/Map/' + name; document.addChildFromSpec('/Root/Map', { name });
        document.attachBuiltinComponent(path, 'cc.UITransform'); document.attachBuiltinComponent(path, type);
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.removeComponent(path, type), /^Error: lumen_component_source_owned:/u);
        assert.equal(JSON.stringify(document.entries), before);
        assert.equal(document.attachBuiltinComponent(path, type), document.findComponentIndex(document.findNodeIndex(path), type));
    }
    const layer = '/Root/Map/Ground'; const color = { r: 128, g: 160, b: 192, a: 255 };
    document.setComponentProperty(layer, 'cc.TiledLayer', { color });
    const before = JSON.stringify(document.entries);
    assert.throws(() => document.setComponentProperty(layer, 'cc.TiledLayer', { color: { r: 0, g: 0, b: 0, a: 255 }, enableCulling: true }), /lumen_property_not_persistent:cc.TiledLayer.enableCulling/u);
    assert.equal(JSON.stringify(document.entries), before);
    assert.throws(() => document.setComponentProperty('/Root/Map/Objects', 'cc.TiledObjectGroup', { premultiplyAlpha: true }), /lumen_property_not_persistent/u);
    document.addChildFromSpec(layer, { name: 'Tile' }); document.attachBuiltinComponent(layer + '/Tile', 'cc.UITransform');
    document.attachBuiltinComponent(layer + '/Tile', 'cc.TiledTile'); document.setComponentProperty(layer + '/Tile', 'cc.TiledTile', { x: 1, y: 1 });
    document.removeComponent(layer + '/Tile', 'cc.TiledTile'); document.attachBuiltinComponent(layer + '/Tile', 'cc.TiledTile');
});

test(`${version} SDK user registration is never emulated by hand attachment or removal; missing source ownership does not broaden removal refusal`, () => {
    const document = LumenPrefabDocument.createEmptyScene('assets/tiled.scene', 'Root');
    document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
    const before = JSON.stringify(document.entries);
    assert.throws(() => document.attachBuiltinComponent('/Root', 'cc.TiledUserNodeData'), /lumen_component_source_owned:cc.TiledUserNodeData:TiledLayer.addUserNode/u);
    assert.throws(() => document.removeComponent('/Root', 'cc.TiledUserNodeData'), /lumen_component_source_owned:cc.TiledUserNodeData:TiledLayer.addUserNode/u);
    assert.equal(JSON.stringify(document.entries), before);
    document.addChildFromSpec('/Root', { name: 'Standalone' });
    document.attachBuiltinComponent('/Root/Standalone', 'cc.TiledLayer');
    document.removeComponent('/Root/Standalone', 'cc.TiledLayer');
    for (const version of ['3.8.3', '3.8.7', '3.9.0']) {
        for (const [type, field] of [['cc.TiledLayer', 'enableCulling'], ['cc.TiledObjectGroup', 'premultiplyAlpha']] as const)
            assert.equal(LumenNativeComponentPersistence.isNonPersistent(LumenCocosVersion.parse(version), type, field), ['3.8.3', '3.8.7'].includes(version));
    }
});
}
