import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import type { ComponentCatalogAudit } from './component-catalog-audit.mts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

for (const version of ['3.8.3', '3.8.7'] as const) {
    const audit: ReturnType<typeof ComponentCatalogAudit.create> = JSON.parse(
        readFileSync(new URL(`./${version}/component-assembly-audit.json`, import.meta.url), 'utf8'));
    const fixtures: ReturnType<typeof ComponentFieldFixtures.create> = JSON.parse(
        readFileSync(new URL(`./${version}/component-field-fixtures.json`, import.meta.url), 'utf8'));
    const component = (type: string) => {
        const found = fixtures.components.find((row) => row.componentType === type);
        if (!found) throw new Error('test_component_missing');
        return found;
    };
    const create = (type: string) => ComponentSceneFixture.create(root, version, component(type), audit.nativeDeclarations);
    test(`${version} official scene assembly preserves dependencies and references after save/reopen/removal`, () => {
        const scratch = mkdtempSync('/private/tmp/pod-component-scene-');
        const failures: { component: string; message: string }[] = [];
        let assembled = 0; let blocked = 0;
        try {
            for (const row of fixtures.components) {
                try {
                    const result = create(row.componentType);
                    assert.equal(result.nativePassed, false);
                    if (result.status === 'blocked') {
                        blocked++; assert.ok(result.blockers.length); assert.equal(Object.hasOwn(result, 'document'), false); continue;
                    }
                    assert.equal(result.resourceFieldsBound, false);
                    const doc = result.document;
                    assert.equal(doc.assetKind, 'scene');
                    const target = doc.findNodeIndex(result.targetPath);
                    for (const type of row.dependencyPlan.attachOrder) doc.findComponentIndex(target, type);
                    if (row.dependencyPlan.attachOrder.includes('cc.UITransform')) assert.equal(result.targetPath, '/Root/Canvas/Target');
                    for (const path of Object.values(result.nodePaths)) doc.findNodeIndex(path);
                    doc.save(scratch, false, LumenCocosVersion.parse(version));
                    const reopened = LumenPrefabDocument.open(scratch, doc.relativePath);
                    reopened.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
                    ComponentSceneIntegrity.assert(reopened);
                    for (const type of row.dependencyPlan.attachOrder) reopened.findComponentIndex(reopened.findNodeIndex(result.targetPath), type);
                    reopened.removeComponent(result.targetPath, row.componentType);
                    reopened.save(scratch, false, LumenCocosVersion.parse(version));
                    const removed = LumenPrefabDocument.open(scratch, doc.relativePath);
                    ComponentSceneIntegrity.assert(removed);
                    const node = removed.findNodeIndex(result.targetPath);
                    assert.throws(() => removed.findComponentIndex(node, row.componentType), /lumen_component_missing/u);
                    for (const type of row.dependencyPlan.attachOrder.filter((type) => type !== row.componentType)) removed.findComponentIndex(node, type);
                    assembled++;
                } catch (error) {
                    failures.push({ component: row.componentType, message: error instanceof Error ? error.message : String(error) });
                }
            }
            assert.deepEqual(failures, []);
            assert.equal(assembled, version === '3.8.3' ? 53 : 55);
            assert.equal(blocked, version === '3.8.3' ? 46 : 44);
            assert.equal(assembled + blocked, 99);
        } finally { rmSync(scratch, { recursive: true, force: true }); }
    });
    test(`${version} active backend and native-owned hierarchy requirements cannot be replaced with empty components`, () => {
        const examples = {
            'cc.RigidBody': 'active-physics-backend-unverified:bullet',
            'cc.RigidBody2D': 'active-physics-backend-unverified:box2d',
            'cc.BoxCharacterController': 'active-physics-backend-unverified:physx',
            'cc.TiledLayer': 'source-owned-tiled-not-initialized',
            'cc.SkinnedMeshRenderer': 'same-source-skinned-hierarchy-not-imported',
            'cc.PostProcess': 'active-high-quality-render-pipeline-unverified',
        };
        for (const [type, blocker] of Object.entries(examples)) {
            const result = create(type); assert.equal(result.status, 'blocked'); assert.ok(result.blockers.includes(blocker));
        }
        const forged = structuredClone(component('cc.RigidBody'));
        forged.assemblyRequirements.physicsBackend = null;
        assert.throws(() => ComponentSceneFixture.create(root, version, forged, audit.nativeDeclarations), /component_scene_requirements_stale/u);
        const stale = structuredClone(component('cc.Button'));
        stale.dependencyPlan = { ...stale.dependencyPlan, attachOrder: [] };
        assert.throws(() => ComponentSceneFixture.create(root, version, stale, audit.nativeDeclarations), /component_scene_dependency_plan_stale/u);
    });
    test(`${version} reference components and event handlers bind actual scene nodes under the Canvas`, () => {
        const scroll = create('cc.ScrollView');
        assert.equal(scroll.status, 'assembled');
        if (scroll.status !== 'assembled') throw new Error('test_scroll_blocked');
        const barPath = scroll.nodePaths['/Root/References/cc_ScrollBar'];
        assert.equal(barPath, '/Root/Canvas/References/cc_ScrollBar');
        assert.ok(barPath);
        scroll.document.findComponentIndex(scroll.document.findNodeIndex(barPath), 'cc.ScrollBar');
        scroll.document.findComponentIndex(scroll.document.findNodeIndex(barPath), 'cc.UITransform');
        const barIndex = scroll.document.findComponentIndex(scroll.document.findNodeIndex(barPath), 'cc.ScrollBar');
        const scrollIndex = scroll.document.findComponentIndex(scroll.document.findNodeIndex(scroll.targetPath), 'cc.ScrollView');
        assert.deepEqual(scroll.document.entries[scrollIndex]?._horizontalScrollBar, { __id__: barIndex });
        assert.deepEqual(scroll.document.entries[scrollIndex]?._verticalScrollBar, { __id__: barIndex });
        assert.equal(scroll.fieldStates.length, component('cc.ScrollView').cases.length);
        assert.equal(new Set(scroll.fieldStates.map((field) => field.id)).size, scroll.fieldStates.length);
        const sprite = create('cc.Sprite');
        if (sprite.status !== 'assembled') throw new Error('test_sprite_blocked');
        assert.equal(sprite.fieldStates.find((field) => field.id.endsWith(':spriteFrame'))?.status, 'native-input-pending');
        const spriteEntry = sprite.document.entries[sprite.document.findComponentIndex(sprite.document.findNodeIndex(sprite.targetPath), 'cc.Sprite')];
        assert.equal(spriteEntry?._spriteFrame, null);
        const button = create('cc.Button');
        assert.equal(button.status, 'assembled');
        if (button.status !== 'assembled') throw new Error('test_button_blocked');
        const controller = button.document.findNodeIndex('/Root/Controller');
        button.document.findComponentIndex(controller, 'cc.Animation');
        const handler = button.document.entries.find((entry) => entry.__type__ === 'cc.ClickEvent');
        assert.ok(handler); assert.deepEqual(handler.target, { __id__: controller }); assert.equal(handler.handler, 'play');
    });
    test(`${version} independent structural validation rejects dangling, duplicate and detached links`, () => {
        const result = create('cc.Label');
        if (result.status !== 'assembled') throw new Error('test_label_blocked');
        const corrupt = () => new LumenPrefabDocument('assets/corrupt.scene', structuredClone([...result.document.entries]));
        const dangling = corrupt();
        const label = dangling.entries[dangling.findComponentIndex(dangling.findNodeIndex(result.targetPath), 'cc.Label')];
        assert.ok(label); label.node = { __id__: dangling.entries.length + 10 };
        assert.throws(() => ComponentSceneIntegrity.assert(dangling), /component_scene_dangling_id/u);
        const detached = corrupt();
        const node = detached.entries[detached.findNodeIndex(result.targetPath)];
        assert.ok(node); node._components = [];
        assert.throws(() => ComponentSceneIntegrity.assert(detached), /component_scene_orphan_component/u);
        const duplicate = corrupt();
        const host = duplicate.entries[duplicate.findNodeIndex('/Root/Canvas')];
        assert.ok(host); assert.ok(Array.isArray(host._children)); host._children.push(host._children[0]);
        assert.throws(() => ComponentSceneIntegrity.assert(duplicate), /component_scene_duplicate_link/u);
    });
}
