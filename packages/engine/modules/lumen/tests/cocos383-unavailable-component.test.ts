import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../source/hierarchy/prefab-document';
import { LumenComponentPropertySchema } from '../source/schema/component-property';
import { LumenCocosVersion } from '../source/schema/cocos-version';

for (const type of ['cc.Sorting2D', 'cc.UISkew']) {
    test(`3.8.3 rejects absent ${type} before changing nodes, dependencies or serialized entries`, () => {
        const document = LumenPrefabDocument.createEmptyScene('assets/version.scene', 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.3')));
        document.addChildFromSpec('/Root', { name: 'Target' });
        const before = JSON.stringify(document.entries);
        assert.throws(() => document.attachBuiltinComponent('/Root/Target', type),
            error => error instanceof Error && error.message === `lumen_component_not_supported:${type}:cocos=3.8.3:reason=native_declaration_absent`);
        assert.equal(JSON.stringify(document.entries), before);
        document.attachBuiltinComponent('/Root/Target', 'cc.UITransform');
        document.attachBuiltinComponent('/Root/Target', 'cc.Sprite');
        const withDependencies = JSON.stringify(document.entries);
        assert.throws(() => document.attachBuiltinComponent('/Root/Target', type), /lumen_component_not_supported/u);
        assert.equal(JSON.stringify(document.entries), withDependencies);
    });
    test(`3.8.7 retains native ${type} attachment and removal with actual UI dependencies`, () => {
        const document = LumenPrefabDocument.createEmptyScene('assets/version.scene', 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7')));
        document.addChildFromSpec('/Root', { name: 'Target' });
        document.attachBuiltinComponent('/Root/Target', 'cc.UITransform');
        document.attachBuiltinComponent('/Root/Target', 'cc.Sprite');
        const index = document.attachBuiltinComponent('/Root/Target', type);
        assert.equal(document.entries[index]?.__type__, type);
        document.removeComponent('/Root/Target', type);
        assert.throws(() => document.findComponentIndex(document.findNodeIndex('/Root/Target'), type), /lumen_component_missing/u);
    });
}
