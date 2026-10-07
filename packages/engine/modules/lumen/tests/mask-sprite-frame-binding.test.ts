import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import type { PrefabEntry } from '../source/types';

const frame = '11111111-2222-4333-8444-555555555555@3e063';

/**
 * @description 与原生 Mask getter 相同，只接受节点自有 Sprite 的持久字段，不读取 Mask 上的影子值。
 */
function setup(version: string): { document: LumenPrefabDocument; schema: LumenComponentPropertySchema; node: number; mask: number } {
    const document = LumenPrefabDocument.createEmptyScene('assets/Mask.scene', 'Root');
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
    document.setPropertySchema(schema);
    document.addChildFromSpec('/Root', { name: 'MaskNode', components: ['cc.UITransform'] });
    const node = document.findNodeIndex('/Root/MaskNode');
    const mask = document.attachBuiltinComponent('/Root/MaskNode', 'cc.Mask');
    return { document, schema, node, mask };
}

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' Mask spriteFrame writes native-owned Sprite carrier and inspector survives serialization', (): void => {
        const { document, schema, node, mask } = setup(version);
        document.setComponentProperty('/Root/MaskNode', 'cc.Mask', { type: 3, inverted: true, segments: 37, alphaThreshold: 0.23, spriteFrame: frame });
        const sprite = document.entries.find(entry => entry.__type__ === 'cc.Sprite');
        assert.ok(sprite, 'native Mask image binding needs a real serialized Sprite owner');
        assert.deepEqual(sprite.node, { __id__: node });
        assert.deepEqual(sprite._spriteFrame, { __uuid__: frame });
        assert.equal(Object.prototype.hasOwnProperty.call(document.entries[mask], '_spriteFrame'), false);
        const source: PrefabEntry[] = JSON.parse(JSON.stringify(document.entries));
        const reopened = new LumenPrefabDocument('assets/Mask.scene', source, schema);
        const snapshot = schema.decodeComponentSnapshot('cc.Mask', reopened.entries[mask]!, () => '/Root/MaskNode', index => reopened.entries[index] ?? null);
        assert.equal(snapshot.spriteFrame, frame);
        assert.equal(snapshot.type, 3);
        assert.equal(snapshot.inverted, true);
        assert.equal(snapshot.segments, 37);
        assert.equal(snapshot.alphaThreshold, 0.23);
    });

    test(version + ' Mask reuses exact existing Sprite identity and preserves unrelated fields while binding and clearing', (): void => {
        const { document, schema, mask } = setup(version);
        const spriteIndex = document.attachBuiltinComponent('/Root/MaskNode', 'cc.Sprite');
        document.setComponentProperty('/Root/MaskNode', 'cc.Sprite', { color: { r: 31, g: 79, b: 127, a: 211 }, grayscale: true, type: 2 });
        const before = JSON.parse(JSON.stringify(document.entries[spriteIndex]));
        document.setComponentProperty('/Root/MaskNode', 'cc.Mask', { type: 3, spriteFrame: frame });
        assert.equal(document.findComponentIndex(document.findNodeIndex('/Root/MaskNode'), 'cc.Sprite'), spriteIndex);
        const sprite = document.entries[spriteIndex]!;
        assert.deepEqual(sprite, { ...before, _spriteFrame: { __uuid__: frame } });
        document.setComponentProperty('/Root/MaskNode', 'cc.Mask', { spriteFrame: null });
        assert.deepEqual(sprite, { ...before, _spriteFrame: null });
        assert.equal(document.entries.filter(entry => entry.__type__ === 'cc.Sprite').length, 1);
        const snapshot = schema.decodeComponentSnapshot('cc.Mask', document.entries[mask]!, () => '/Root/MaskNode', index => document.entries[index] ?? null);
        assert.equal(snapshot.spriteFrame, null);
    });

    test(version + ' invalid mixed Mask patch refuses before owner allocation or partial field changes', (): void => {
        const { document } = setup(version);
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/MaskNode', 'cc.Mask', { type: 3, inverted: true, spriteFrame: 42 }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
        assert.equal(document.entries.some(entry => entry.__type__ === 'cc.Sprite'), false);
    });

    test(version + ' duplicate or foreign Sprite owner refuses read and write without selecting or mutating a carrier', (): void => {
        for (const corrupt of ['duplicate', 'foreign']) {
            const { document, schema, node, mask } = setup(version);
            const spriteIndex = document.attachBuiltinComponent('/Root/MaskNode', 'cc.Sprite');
            const raw: PrefabEntry[] = JSON.parse(JSON.stringify(document.entries));
            if (corrupt === 'foreign') {
                raw[spriteIndex]!.node = { __id__: node + 1000 };
            } else {
                const duplicateIndex = raw.length;
                raw.push({ ...raw[spriteIndex]! });
                assert.ok(Array.isArray(raw[node]!._components));
                raw[node]!._components.push({ __id__: duplicateIndex });
            }
            const bad = new LumenPrefabDocument('assets/Mask.scene', raw, schema);
            const before = JSON.stringify(raw);
            assert.throws(() => bad.setComponentProperty('/Root/MaskNode', 'cc.Mask', { type: 3, spriteFrame: frame }), /lumen_mask_sprite_owner/);
            assert.equal(JSON.stringify(bad.entries), before);
            assert.throws(() => schema.decodeComponentSnapshot('cc.Mask', bad.entries[mask]!, () => '/Root/MaskNode', index => bad.entries[index] ?? null), /lumen_mask_sprite_owner/);
        }
    });
}
