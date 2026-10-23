import assert from 'node:assert/strict';
import test from 'node:test';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentLifecycleFixture } from './component-lifecycle-fixture.mts';

for (const version of ['3.8.3', '3.8.7'] as const) {
    test(version + ' destructive lifecycle removal cannot empty the reference Label scene', () => {
        const document = LumenPrefabDocument.createEmptyScene('assets/components/cc.Label.scene', 'Root');
        document.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        document.addChildFromSpec('/Root', { name: 'Target', components: ['cc.UITransform', 'cc.Label'] });
        document.setComponentProperty('/Root/Target', 'cc.Label', { string: 'Visible reference', useSystemFont: true });
        const before = JSON.stringify(document.entries);
        const lifecycle = ComponentLifecycleFixture.create(document, version, 'cc.Label');
        assert.equal(lifecycle.relativePath, 'assets/components/_lifecycle/cc.Label.scene');
        lifecycle.setComponentProperty('/Root/Target', 'cc.Label', { string: 'Field test value' });
        lifecycle.removeComponent('/Root/Target', 'cc.Label');
        assert.throws(() => lifecycle.findComponentIndex(lifecycle.findNodeIndex('/Root/Target'), 'cc.Label'), /component_missing/);
        document.findComponentIndex(document.findNodeIndex('/Root/Target'), 'cc.Label');
        assert.equal(JSON.stringify(document.entries), before);
        assert.throws(() => ComponentLifecycleFixture.create(document, version, '../cc.Label'), /type_invalid/);
    });
}
