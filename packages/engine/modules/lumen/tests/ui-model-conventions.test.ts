import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenNodeConventions } from '../source/schema/node-conventions';

test('UI model bridge and its SDK-supported carriers share a UI node in either attach order and in recipes', () => {
    const template = fileURLToPath(new URL('../bundled/default_prefab/ui/Label.prefab', import.meta.url));
    for (const carrier of ['cc.MeshRenderer', 'cc.ParticleSystem']) {
        for (const order of [[carrier, 'cc.UIMeshRenderer'], ['cc.UIMeshRenderer', carrier]]) {
            const document = LumenPrefabDocument.cloneFromTemplate('assets/Model.prefab', template, 'Root');
            document.removeComponent('/Root', 'cc.Label');
            for (const type of order) document.attachBuiltinComponent('/Root', type);
            const node = document.findNodeIndex('/Root');
            assert.equal(document.entries[node]?._layer, 1 << 25);
            for (const type of order) document.findComponentIndex(node, type);
            const before = JSON.stringify(document.entries);
            for (const incompatible of ['cc.Sprite', 'cc.Label', 'cc.Line', 'cc.SkinnedMeshRenderer', carrier === 'cc.MeshRenderer' ? 'cc.ParticleSystem' : 'cc.MeshRenderer']) {
                assert.throws(() => document.attachBuiltinComponent('/Root', incompatible), /renderer_exclusive/);
                assert.equal(JSON.stringify(document.entries), before);
            }
            const child = document.addChildFromSpec('/Root', { name: 'Model', components: order });
            assert.equal(document.entries[document.findNodeIndex(child)]?._layer, 1 << 25);
            assert.throws(() => document.addChildFromSpec('/Root', { name: 'Bad', components: [...order, 'cc.Sprite'] }), /renderer_exclusive_batch/);
        }
    }
    assert.equal(LumenNodeConventions.layerRoleForComponent('cc.UIMeshRenderer'), 'ui2d');
});
