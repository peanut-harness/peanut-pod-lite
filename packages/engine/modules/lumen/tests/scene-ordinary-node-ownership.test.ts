import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenSession } from '../source/session';

test('Scene specification nodes remain ordinary nodes through recursive additions', (): void => {
    const document = LumenPrefabDocument.createEmptyScene('assets/Layout.scene', 'Root');
    document.addChildFromSpec('/Root', {
        name: 'Container',
        components: ['cc.UITransform', 'cc.Layout'],
        children: [
            { name: 'First', components: ['cc.UITransform'] },
            { name: 'Second', children: [{ name: 'Nested' }] },
        ],
    });
    assert.equal(document.assetKind, 'scene');
    assert.equal(document.entries.some((entry) => entry.__type__ === 'cc.PrefabInfo'), false);
    assert.equal(document.entries.some((entry) => entry.__type__ === 'cc.CompPrefabInfo'), false);
    for (const path of ['/Root/Container', '/Root/Container/First', '/Root/Container/Second', '/Root/Container/Second/Nested']) {
        const node = document.entries[document.findNodeIndex(path)];
        assert.ok(node != null);
        assert.equal(node._prefab, null);
    }
    const second = document.entries[document.findNodeIndex('/Root/Container/Second')];
    assert.ok(second != null);
    assert.deepEqual(second._children, [{ __id__: document.findNodeIndex('/Root/Container/Second/Nested') }]);
    const nested = document.entries[document.findNodeIndex('/Root/Container/Second/Nested')];
    assert.ok(nested != null);
    assert.deepEqual(nested._parent, { __id__: document.findNodeIndex('/Root/Container/Second') });
    const layout = document.entries.find((entry) => entry.__type__ === 'cc.Layout');
    assert.ok(layout != null);
    assert.deepEqual(layout.node, { __id__: document.findNodeIndex('/Root/Container') });
    assert.equal(Object.hasOwn(layout, '__prefab'), false);
});

test('Scene empty recipe nodes keep valid hierarchy indexes after rename and removal', (): void => {
    const document = LumenPrefabDocument.createEmptyScene('assets/Recipe.scene', 'Root');
    document.buildFromRecipe('/Root', {
        name: 'Container',
        template: 'empty',
        children: [
            { name: 'Keep', template: 'empty', components: ['cc.UITransform'] },
            { name: 'Remove', template: 'empty' },
        ],
    });
    document.renameNode('/Root/Container/Keep', 'Retained');
    document.removeNode('/Root/Container/Remove');
    assert.equal(document.entries.some((entry) => entry.__type__ === 'cc.PrefabInfo'), false);
    assert.equal(document.entries.some((entry) => entry.__type__ === 'cc.CompPrefabInfo'), false);
    const childIndex = document.findNodeIndex('/Root/Container/Retained');
    const parentIndex = document.findNodeIndex('/Root/Container');
    assert.deepEqual(document.entries[parentIndex]?._children, [{ __id__: childIndex }]);
    assert.deepEqual(document.entries[childIndex]?._parent, { __id__: parentIndex });
    assert.equal(document.entries[childIndex]?._prefab, null);
});

test('Public Scene empty-node save and reopen retain ordinary nodes and scene identity', (): void => {
    const project = mkdtempSync(join(tmpdir(), 'lumen-scene-ordinary-node-'));
    try {
        mkdirSync(join(project, 'assets'));
        writeFileSync(join(project, 'package.json'), '{"name":"scene-node-test","creator":{"version":"3.8.7"}}\n');
        const session = new LumenSession({ projectRoot: project });
        session.scaffoldPrefab({ prefabRelativePath: 'assets/Layout.scene', rootName: 'Root', template: 'ui/Canvas' });
        const originalMeta = readFileSync(join(project, 'assets/Layout.scene.meta'));
        session.addChildFromTemplate({ parentPath: '/Root/Canvas', name: 'Ordinary', template: 'empty' });
        session.attachComponent({ nodePath: '/Root/Canvas/Ordinary', builtinType: 'cc.UITransform' });
        session.attachComponent({ nodePath: '/Root/Canvas/Ordinary', builtinType: 'cc.Layout' });
        session.setComponentProperty({ nodePath: '/Root/Canvas/Ordinary', componentType: 'cc.Layout', patch: { type: 1, spacingX: 7 } });
        session.save();
        const source: unknown = JSON.parse(readFileSync(join(project, 'assets/Layout.scene'), 'utf8'));
        assert.ok(Array.isArray(source));
        assert.equal(source.some((entry) => entry.__type__ === 'cc.PrefabInfo'), false);
        assert.equal(source.some((entry) => entry.__type__ === 'cc.CompPrefabInfo'), false);
        assert.deepEqual(readFileSync(join(project, 'assets/Layout.scene.meta')), originalMeta);
        const reopened = new LumenSession({ projectRoot: project });
        reopened.openPrefab('assets/Layout.scene');
        assert.equal(reopened.openedAssetKind, 'scene');
        const node = reopened.inspectNode('/Root/Canvas/Ordinary');
        const layout = node.components.find((component) => component.type === 'cc.Layout');
        assert.ok(layout != null);
        assert.equal(layout.props.type, 1);
        assert.equal(layout.props.spacingX, 7);
        reopened.save();
        assert.deepEqual(readFileSync(join(project, 'assets/Layout.scene.meta')), originalMeta);
    } finally {
        rmSync(project, { recursive: true, force: true });
    }
});

test('Prefab specification nodes preserve prefab ownership metadata and component links', (): void => {
    const document = LumenPrefabDocument.createEmpty('assets/Ordinary.prefab', 'Root');
    document.addChildFromSpec('/Root', {
        name: 'Container',
        components: ['cc.UITransform', 'cc.Layout'],
        children: [{ name: 'Child', components: ['cc.UITransform'] }],
    });
    assert.equal(document.assetKind, 'prefab');
    assert.equal(document.entries.filter((entry) => entry.__type__ === 'cc.PrefabInfo').length, 3);
    assert.equal(document.entries.filter((entry) => entry.__type__ === 'cc.CompPrefabInfo').length, 4);
    for (const entry of document.entries.filter((item) => item.__type__ === 'cc.PrefabInfo')) {
        assert.deepEqual(entry.asset, { __id__: 0 });
        assert.deepEqual(entry.root, { __id__: 1 });
    }
    const child = document.entries[document.findNodeIndex('/Root/Container/Child')];
    assert.ok(child != null);
    assert.deepEqual(child._parent, { __id__: document.findNodeIndex('/Root/Container') });
    const layout = document.entries.find((entry) => entry.__type__ === 'cc.Layout');
    assert.ok(layout != null);
    assert.deepEqual(layout.node, { __id__: document.findNodeIndex('/Root/Container') });
});
