import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';
import type { PrefabEntry } from '../source/types';

const frame = '11111111-2222-4333-8444-555555555555@3e063';
const patch = { string: 'SAVED TEXT', placeholder: 'TYPE HERE', maxLength: 18, inputMode: 6, inputFlag: 5, returnType: 2, tabIndex: 7, fontSize: 27, lineHeight: 35, fontColor: { r: 31, g: 79, b: 127, a: 211 }, placeholderFontSize: 19, placeholderFontColor: { r: 139, g: 97, b: 53, a: 199 }, backgroundImage: frame };

/**
 * @description 获取真实文档条目，缺条目使夹具失败而不是伪造所有者。
 * @param document 实际文档。
 * @param index 实际索引。
 * @returns 现有条目。
 */
function entry(document: LumenPrefabDocument, index: number): PrefabEntry {
    const value = document.entries[index];
    assert.ok(value);
    return value;
}

/**
 * @description 使用正式合法EditBox模板或普通原生组件，保留实际载体引用。
 * @param version 真实受测版本。
 * @param template 是否使用合法正式模板。
 * @returns 实际内存文档与属性表。
 */
function setup(version: string, template = true) {
    const schema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version));
    const document = LumenPrefabDocument.createEmptyScene('assets/EditBox.scene', 'Root');
    document.setPropertySchema(schema);
    if (template) {
        document.addChildFromTemplate('/Root', resolve('bundled/default_prefab/ui/EditBox.prefab'), 'EditBox');
    } else {
        document.addChildFromSpec('/Root', { name: 'EditBox', components: ['cc.UITransform', 'cc.EditBox'] });
    }
    const node = document.findNodeIndex('/Root/EditBox');
    const edit = document.findComponentIndex(node, 'cc.EditBox');
    return { document, schema, node, edit };
}

/**
 * @description 核对实际自有Label，不读取EditBox影子样式字段。
 * @param document 文档。
 * @param name 原生载体节点名。
 * @returns 真实Label条目及索引。
 */
function label(document: LumenPrefabDocument, name: string) {
    const node = document.findNodeIndex('/Root/EditBox/' + name);
    const index = document.findComponentIndex(node, 'cc.Label');
    return { node, index, value: entry(document, index) };
}

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' EditBox complete13 updates actual native text/placeholder Label and background Sprite', (): void => {
        const { document, schema, node, edit } = setup(version);
        document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch);
        const text = label(document, 'TEXT_LABEL'), hint = label(document, 'PLACEHOLDER_LABEL');
        assert.equal(text.value._fontSize, 27);
        assert.equal(text.value._lineHeight, 35);
        assert.deepEqual(text.value._color, { __type__: 'cc.Color', ...patch.fontColor });
        assert.equal(hint.value._string, 'TYPE HERE');
        assert.equal(hint.value._fontSize, 19);
        assert.deepEqual(hint.value._color, { __type__: 'cc.Color', ...patch.placeholderFontColor });
        assert.deepEqual(entry(document, edit)._textLabel, { __id__: text.index });
        assert.deepEqual(entry(document, edit)._placeholderLabel, { __id__: hint.index });
        assert.deepEqual(entry(document, document.findComponentIndex(node, 'cc.Sprite'))._spriteFrame, { __uuid__: frame });
        const source: PrefabEntry[] = JSON.parse(JSON.stringify(document.entries));
        const reopened = new LumenPrefabDocument('assets/EditBox.scene', source, schema);
        const snapshot = schema.decodeComponentSnapshot('cc.EditBox', entry(reopened, edit), () => '/Root/EditBox', index => reopened.entries[index] ?? null);
        for (const [key, expected] of Object.entries(patch)) {
            assert.deepEqual(snapshot[key], key.endsWith('Color') ? { __type__: 'cc.Color', ...expected as Record<string, unknown> } : expected);
        }
    });

    test(version + ' EditBox preserves carrier identity/unrelated Label styles and inspector reads actual carrier', (): void => {
        const { document, schema, edit } = setup(version);
        const text = label(document, 'TEXT_LABEL'), hint = label(document, 'PLACEHOLDER_LABEL');
        const ids = [text.index, hint.index], original = JSON.parse(JSON.stringify(text.value));
        document.setComponentProperty('/Root/EditBox', 'cc.EditBox', { fontSize: 29, placeholder: 'New hint' });
        assert.equal(text.value._fontSize, 29);
        assert.deepEqual(text.value, { ...original, _fontSize: 29 });
        assert.deepEqual([label(document, 'TEXT_LABEL').index, label(document, 'PLACEHOLDER_LABEL').index], ids);
        text.value._fontSize = 31;
        const snapshot = schema.decodeComponentSnapshot('cc.EditBox', entry(document, edit), () => '/Root/EditBox', index => document.entries[index] ?? null);
        assert.equal(snapshot.fontSize, 31);
        assert.equal(snapshot.placeholder, 'New hint');
    });

    test(version + ' EditBox allocates missing carriers through original node/component factories only after validation', (): void => {
        const { document, node, edit } = setup(version, false);
        document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch);
        const text = label(document, 'TEXT_LABEL'), hint = label(document, 'PLACEHOLDER_LABEL');
        assert.equal(text.value._fontSize, 27);
        assert.equal(hint.value._string, 'TYPE HERE');
        assert.deepEqual(entry(document, text.node)._parent, { __id__: node });
        assert.deepEqual(entry(document, hint.node)._parent, { __id__: node });
        assert.deepEqual(entry(document, edit)._textLabel, { __id__: text.index });
        assert.deepEqual(entry(document, edit)._placeholderLabel, { __id__: hint.index });
    });

    test(version + ' invalid mixed EditBox patch leaves complete document and missing carriers unchanged', (): void => {
        const { document } = setup(version, false);
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/EditBox', 'cc.EditBox', { string: 'partial forbidden', fontSize: 23, fontColor: 42 }), /lumen_property_type/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' foreign explicit EditBox Label owner rejects whole patch before writes', (): void => {
        const { document, schema, edit } = setup(version);
        document.addChildFromSpec('/Root', { name: 'Foreign', components: ['cc.UITransform', 'cc.Label'] });
        const foreign = document.findComponentIndex(document.findNodeIndex('/Root/Foreign'), 'cc.Label');
        entry(document, edit)._textLabel = { __id__: foreign };
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch), /lumen_editbox_carrier_owner/);
        assert.equal(JSON.stringify(document.entries), before);
        assert.throws(() => schema.decodeComponentSnapshot('cc.EditBox', entry(document, edit), () => '/Root/EditBox', index => document.entries[index] ?? null), /lumen_editbox_carrier_owner/);
    });

    test(version + ' duplicate same-name carrier and foreign Sprite each refuse without partial changes', (): void => {
        for (const corrupt of ['duplicate', 'sprite']) {
            const { document, node } = setup(version);
            if (corrupt === 'duplicate') {
                document.addChildFromSpec('/Root/EditBox', { name: 'TEXT_LABEL', components: ['cc.UITransform', 'cc.Label'] });
            } else {
                entry(document, document.findComponentIndex(node, 'cc.Sprite')).node = { __id__: node + 1000 };
            }
            const before = JSON.stringify(document.entries);
            assert.throws(() => document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch), /lumen_editbox_carrier_owner/);
            assert.equal(JSON.stringify(document.entries), before);
        }
    });

    test(version + ' aliased text/placeholder Labels refuse before any actual owner allocation', (): void => {
        const { document, edit } = setup(version);
        const text = label(document, 'TEXT_LABEL');
        entry(document, edit)._textLabel = { __id__: text.index };
        entry(document, edit)._placeholderLabel = { __id__: text.index };
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch), /lumen_editbox_carrier_owner/);
        assert.equal(JSON.stringify(document.entries), before);
    });

    test(version + ' core EditBox-only patch preserves actual carrier styles and no unnecessary allocation', (): void => {
        const { document } = setup(version);
        const text = JSON.parse(JSON.stringify(label(document, 'TEXT_LABEL').value));
        const hint = JSON.parse(JSON.stringify(label(document, 'PLACEHOLDER_LABEL').value));
        const count = document.entries.length;
        document.setComponentProperty('/Root/EditBox', 'cc.EditBox', { string: 'core only', maxLength: 7 });
        assert.deepEqual(label(document, 'TEXT_LABEL').value, text);
        assert.deepEqual(label(document, 'PLACEHOLDER_LABEL').value, hint);
        assert.equal(document.entries.length, count);
    });
}

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' later missing Label renderer conflict refuses before earlier Label allocation', (): void => {
        const { document } = setup(version, false);
        document.addChildFromSpec('/Root/EditBox', { name: 'PLACEHOLDER_LABEL', components: ['cc.UITransform', 'cc.Sprite'] });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.setComponentProperty('/Root/EditBox', 'cc.EditBox', patch), /lumen_renderer_exclusive/);
        assert.equal(JSON.stringify(document.entries), before);
    });
    test(version + ' unrelated unverified version keeps original codec behavior instead of guessing native mapping', (): void => {
        const { document, edit } = setup('3.8.4');
        const text = JSON.parse(JSON.stringify(label(document, 'TEXT_LABEL').value));
        document.setComponentProperty('/Root/EditBox', 'cc.EditBox', { fontSize: 29 });
        assert.equal(entry(document, edit)._fontSize, 29);
        assert.deepEqual(label(document, 'TEXT_LABEL').value, text);
    });
}
