import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import type { PrefabEntry } from '../source/types';

const path = '/Root/Button';
const normal = { r: 37, g: 91, b: 143, a: 211 };
const disabled = { r: 61, g: 127, b: 179, a: 233 };
const frame = '11111111-2222-4333-8444-555555555555@f9941';

/**
 * @description 从实际文档工厂创建普通Scene子节点，保留原属性codec及真实clickEvents引用入口。
 */
function setup(version: string): { document: LumenPrefabDocument; schema: LumenComponentPropertySchema; sprite: number; button: number; node: number } {
    const document = LumenPrefabDocument.createEmptyScene('assets/Button.scene', 'Root');
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
    document.setPropertySchema(schema);
    document.addChildFromSpec('/Root', { name: 'Button', components: ['cc.UITransform', 'cc.Sprite', 'cc.Button'] });
    const node = document.findNodeIndex(path);
    const sprite = document.findComponentIndex(node, 'cc.Sprite');
    const button = document.findComponentIndex(node, 'cc.Button');
    document.setComponentProperty(path, 'cc.Sprite', { color: normal, spriteFrame: frame, grayscale: true });
    return { document, schema, sprite, button, node };
}

/**
 * @description 完整14字段与原EventHandler路径解析，不能因载体同步绕过点击绑定。
 */
function fullPatch(): Record<string, unknown> {
    return {
        interactable: false, transition: 1, duration: 0.05, zoomScale: 1.25, target: path,
        normalColor: normal, disabledColor: disabled,
        pressedColor: { r: 43, g: 101, b: 151, a: 223 }, hoverColor: { r: 53, g: 113, b: 167, a: 229 },
        normalSprite: frame, pressedSprite: frame, hoverSprite: frame, disabledSprite: frame,
        clickEvents: [{ target: path, component: 'assets/Receiver.ts', handler: 'onClick', customEventData: 'real-pointer-DISABLED', componentId: 'receiver-id' }],
    };
}

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' initial disabled COLOR uses persistent owned Sprite color and preserves all14/event references on reopen', (): void => {
        const { document, schema, sprite, button, node } = setup(version);
        const carrier = document.entries[sprite];
        document.setComponentProperty(path, 'cc.Button', fullPatch());
        assert.equal(document.entries[sprite], carrier);
        assert.deepEqual(carrier?._color, { __type__: 'cc.Color', ...disabled });
        assert.deepEqual(carrier?.node, { __id__: node });
        assert.deepEqual(carrier?._spriteFrame, { __uuid__: frame });
        assert.equal(carrier?._useGrayscale, true);
        const source: PrefabEntry[] = JSON.parse(JSON.stringify(document.entries));
        const reopened = new LumenPrefabDocument('assets/Button.scene', source, schema);
        const snapshot = schema.decodeComponentSnapshot('cc.Button', reopened.entries[button]!, () => path, index => reopened.entries[index] ?? null);
        const expected = fullPatch();
        for (const key of ['normalColor', 'pressedColor', 'hoverColor', 'disabledColor']) {
            expected[key] = { __type__: 'cc.Color', ...fullPatch()[key] as Record<string, unknown> };
        }
        assert.equal(Object.keys(snapshot).length, 14);
        assert.deepEqual(snapshot, expected);
        const refs = reopened.entries[button]!.clickEvents;
        assert.ok(Array.isArray(refs));
        assert.equal(refs.length, 1);
        assert.deepEqual(reopened.entries[refs[0].__id__], { __type__: 'cc.ClickEvent', target: { __id__: node }, component: 'assets/Receiver.ts', handler: 'onClick', customEventData: 'real-pointer-DISABLED', _componentId: 'receiver-id' });
    });

    test(version + ' mixed invalid patch refuses before component or Sprite color changes', (): void => {
        const { document } = setup(version);
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty(path, 'cc.Button', { interactable: false, normalColor: disabled, duration: 'bad' }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' late malformed event refuses without allocating dangling entry or changing old binding/color', (): void => {
        const { document } = setup(version);
        document.setComponentProperty(path, 'cc.Button', { clickEvents: fullPatch().clickEvents });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty(path, 'cc.Button', { disabledColor: disabled, clickEvents: [{ target: path, component: 'assets/Receiver.ts', handler: 42 }] }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' late unresolved target uses original path error and leaves whole document unchanged', (): void => {
        const { document } = setup(version);
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty(path, 'cc.Button', { normalColor: disabled, target: '/Root/Missing' }), /lumen_child_missing/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' duplicate or foreign Sprite owner refuses before any field or carrier changes', (): void => {
        for (const corrupt of ['duplicate', 'foreign']) {
            const { document, schema, sprite, node } = setup(version);
            const raw: PrefabEntry[] = JSON.parse(JSON.stringify(document.entries));
            if (corrupt === 'foreign') {
                raw[sprite]!.node = { __id__: node + 1000 };
            } else {
                const duplicate = raw.length;
                raw.push({ ...raw[sprite]! });
                assert.ok(Array.isArray(raw[node]!._components));
                raw[node]!._components.push({ __id__: duplicate });
            }
            const bad = new LumenPrefabDocument('assets/Button.scene', raw, schema);
            const before = JSON.stringify(raw);
            assert.throws(() => bad.setComponentProperty(path, 'cc.Button', fullPatch()), /lumen_button_color_owner/);
            assert.equal(JSON.stringify(bad.entries), before);
        }
    });

    test(version + ' shared Button visual target refuses without changing the other Button carrier', (): void => {
        const { document } = setup(version);
        document.addChildFromSpec('/Root', { name: 'Other', components: ['cc.UITransform', 'cc.Button'] });
        document.setComponentProperty('/Root/Other', 'cc.Button', { transition: 0, target: path });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty(path, 'cc.Button', fullPatch()), /lumen_button_color_owner_shared/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' independent target path resolves normally and synchronizes only that owned Sprite', (): void => {
        const { document, sprite } = setup(version);
        document.addChildFromSpec('/Root', { name: 'Visual', components: ['cc.UITransform', 'cc.Sprite'] });
        const visual = document.findComponentIndex(document.findNodeIndex('/Root/Visual'), 'cc.Sprite');
        const before = JSON.stringify(document.entries[sprite]);
        document.setComponentProperty(path, 'cc.Button', { ...fullPatch(), target: '/Root/Visual' });
        assert.deepEqual(document.entries[visual]?._color, { __type__: 'cc.Color', ...disabled });
        assert.equal(JSON.stringify(document.entries[sprite]), before);
        assert.deepEqual(document.entries[document.findComponentIndex(document.findNodeIndex(path), 'cc.Button')]?._target, { __id__: document.findNodeIndex('/Root/Visual') });
    });

    test(version + ' enabled COLOR and changed disabledColor keep carrier identity; event replacement/clear retains original cleanup', (): void => {
        const { document, sprite, button } = setup(version);
        const carrier = document.entries[sprite];
        document.setComponentProperty(path, 'cc.Button', fullPatch());
        const next = { r: 73, g: 137, b: 191, a: 239 };
        document.setComponentProperty(path, 'cc.Button', { disabledColor: next });
        assert.deepEqual(carrier?._color, { __type__: 'cc.Color', ...next });
        document.setComponentProperty(path, 'cc.Button', { interactable: true, normalColor: normal, clickEvents: [{ target: path, component: 'assets/Receiver.ts', handler: 'other', customEventData: 'replacement' }] });
        const current = document.entries[sprite];
        assert.deepEqual(current?.node, carrier?.node);
        assert.equal(current?._id, carrier?._id);
        assert.deepEqual(current?._spriteFrame, carrier?._spriteFrame);
        assert.deepEqual(current?._color, { __type__: 'cc.Color', ...normal });
        assert.equal(document.entries.filter(entry => entry.__type__ === 'cc.ClickEvent').length, 1);
        document.setComponentProperty(path, 'cc.Button', { clickEvents: [] });
        assert.deepEqual(document.entries[button]?.clickEvents, []);
        assert.equal(document.entries.some(entry => entry.__type__ === 'cc.ClickEvent'), false);
    });

    test(version + ' NONE SPRITE SCALE preserve unrelated Sprite fields and do not force native visual lifecycle', (): void => {
        for (const transition of [0, 2, 3]) {
            const { document, sprite } = setup(version);
            const before = JSON.stringify(document.entries[sprite]);
            document.setComponentProperty(path, 'cc.Button', { ...fullPatch(), transition });
            assert.equal(JSON.stringify(document.entries[sprite]), before);
        }
    });
}

test('unknown Creator version retains original codec behavior without applying tested color carrier mapping', (): void => {
    const { document, sprite } = setup('3.8.6');
    const before = JSON.stringify(document.entries[sprite]);
    document.setComponentProperty(path, 'cc.Button', fullPatch());
    assert.equal(JSON.stringify(document.entries[sprite]), before);
});
