import assert from 'node:assert/strict';
import test from 'node:test';

import { LumenPrefabDocument, type PrefabEntry } from '../source/hierarchy/prefab-document';

test('controller rebinding merges exact event references while preserving distinct callbacks', () => {
    const entries: PrefabEntry[] = [
        { __type__: 'cc.Prefab', data: { __id__: 1 } },
        { __type__: 'cc.Node', _name: 'Panel', _children: [{ __id__: 2 }], _components: [] },
        { __type__: 'cc.Node', _name: 'Play', _children: [], _components: [{ __id__: 3 }] },
        { __type__: 'cc.Button', node: { __id__: 2 }, clickEvents: [] },
    ];
    const document = new LumenPrefabDocument('assets/Panel.prefab', entries);
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onPlay', '', 'script-id');
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onPlay', '', 'script-id');
    assert.equal(entries.length, 5);
    entries.push({ ...entries[4] });
    const button = entries[3];
    assert.ok(button);
    button.clickEvents = [{ __id__: 4 }, { __id__: 5 }];
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onOther', '', 'script-id');
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onPlay', 'other-data', 'script-id');
    document.bindClickEvent('/Panel/Play', '/Panel/Play', 'Panel', 'onPlay', '', 'script-id');
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onPlay', '', 'other-script');
    document.bindClickEvent('/Panel/Play', '/Panel', 'OtherPanel', 'onPlay', '', 'script-id');
    document.bindClickEvent('/Panel/Play', '/Panel', 'Panel', 'onPlay', '', 'script-id');
    assert.deepEqual(
        button.clickEvents,
        [4, 6, 7, 8, 9, 10].map((id) => ({ __id__: id })),
    );
});
