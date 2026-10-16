import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentSkinnedHierarchy } from './component-skinned-hierarchy.mts';
import { ComponentFieldFixtures } from './component-field-fixtures.mts';
import { ComponentSceneFixture } from './component-scene-fixture.mts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');
const proof = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.7/skinned-hierarchy-provenance.json'), 'utf8'));
const audit = JSON.parse(readFileSync(join(root, 'tests/fixtures/editor-stability/components/3.8.7/component-assembly-audit.json'), 'utf8'));
const fields = ComponentFieldFixtures.create(root, '3.8.7', audit.nativeDeclarations, true);
const hashes = new Map<string, string>(proof.sdkSources.map((item: { path: string; sha256: string }) => ['/sdk/' + item.path, item.sha256]));

/**
 * @description 只替换SDK文件摘要IO，导入模板、图链接、资源引用及产品增删流程均使用真实冻结数据。
 */
function fixture(run: (project: string, hash: (path: string) => string) => void): void {
    const output = mkdtempSync('/private/tmp/pod-skinned-hierarchy-'); const project = join(output, 'project');
    mkdirSync(join(project, 'assets/fixtures/media/assets/model'), { recursive: true });
    writeFileSync(join(project, 'assets/fixtures/media/assets/model/triangle.gltf'), readFileSync(join(root, proof.input.path)));
    try { run(project, path => { const hash = hashes.get(path); assert(hash); return hash; }); }
    finally { rmSync(output, { recursive: true, force: true }); }
}

test('SDK source drift rejects before authoring, and real imported graph remaps every same-source asset identity', () => {
    fixture((project, hash) => {
        assert.throws(() => ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', () => 'changed'), /sdk_source_mismatch/u);
        const metaPath = join(project, 'assets/fixtures/media/assets/model/triangle.gltf.meta'); assert.equal(existsSync(metaPath), false);
        const context = ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', hash); assert(context);
        const bytes = readFileSync(metaPath); const meta = JSON.parse(bytes.toString('utf8'));
        assert.notEqual(meta.uuid, proof.sourceRootUuid); assert.equal(meta.uuid, context.sourceUuid);
        const prefab = readFileSync(context.templatePath, 'utf8'); assert.equal(prefab.includes(proof.sourceRootUuid), false);
        for (const subId of [proof.nativeMeshSubId, proof.nativeSkeletonSubId, proof.nativeAnimationSubId, proof.nativeMaterialSubId])
            assert(prefab.includes(context.sourceUuid + '@' + subId));
        assert.throws(() => ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', hash), /EEXIST/u);
        assert.deepEqual(readFileSync(metaPath), bytes);
    });
});

test('started projects and unverified versions cannot acquire a new imported hierarchy', () => {
    fixture((project, hash) => {
        assert.equal(ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.3', hash), null);
        mkdirSync(join(project, 'library'));
        assert.throws(() => ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', hash), /already_started/u);
        assert.equal(existsSync(join(project, 'assets/fixtures/media/assets/model/triangle.gltf.meta')), false);
    });
});

test('all three skinned recipes retain real joint hierarchy through remove/add, with unchanged 99/795 denominator', () => {
    fixture((project, hash) => {
        assert.equal(fields.componentCount, 99); assert.equal(fields.fieldCount, 795);
        const context = ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', hash); assert(context);
        for (const type of ['cc.SkeletalAnimation', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer']) {
            const row = fields.components.find(row => row.componentType === type); assert(row);
            const scene = ComponentSceneFixture.create(root, '3.8.7', row, audit.nativeDeclarations, true, context);
            assert.notEqual(scene.status, 'blocked'); if (scene.status === 'blocked') throw Error('unexpected blocked recipe');
            const document = scene.document; const animationRoot = document.findNodeIndex('/Root/Model');
            document.findNodeIndex('/Root/Model/Joint');
            document.removeComponent(scene.targetPath, type); const added = document.attachBuiltinComponent(scene.targetPath, type);
            const component = document.entries[added]; assert(component);
            if (type !== 'cc.SkeletalAnimation') assert.deepEqual(component._skinningRoot, { __id__: animationRoot });
            if (type === 'cc.SkinnedMeshBatchRenderer') {
                assert(Array.isArray(component.units)); assert.equal(component.units.length, 1);
                assert.equal(component.units[0].mesh.__uuid__, context.sourceUuid + '@' + proof.nativeMeshSubId);
                assert.equal(component.units[0].skeleton.__uuid__, context.sourceUuid + '@' + proof.nativeSkeletonSubId);
            }
            ComponentSceneIntegrity.assert(document);
        }
        const animation = fields.components.find(row => row.componentType === 'cc.SkeletalAnimation'); assert(animation);
        const clip = animation.cases.find(field => field.selector[0] === 'defaultClip'); assert(clip);
        assert.equal(clip.rootValue.form, 'resource'); assert(clip.rootValue.resource?.sources.some(source => source.path.endsWith('triangle.gltf')));
        assert.equal(clip.rootValue.resource?.sources.some(source => source.path.endsWith('default.anim')), false);
    });
});

test('ambiguous controllers and transformed automatic batch sources reject atomically', () => {
    fixture((project, hash) => {
        const context = ComponentSkinnedHierarchy.stage(root, project, '/sdk', '3.8.7', hash); assert(context);
        const row = fields.components.find(row => row.componentType === 'cc.SkinnedMeshRenderer'); assert(row);
        const scene = ComponentSceneFixture.create(root, '3.8.7', row, audit.nativeDeclarations, true, context);
        if (scene.status === 'blocked') throw Error('unexpected blocked recipe');
        scene.document.removeComponent(scene.targetPath, row.componentType); scene.document.attachBuiltinComponent(scene.targetPath, 'cc.SkeletalAnimation');
        const before = JSON.stringify(scene.document.entries);
        assert.throws(() => scene.document.attachBuiltinComponent(scene.targetPath, row.componentType), /animation_root_ambiguous/u);
        assert.equal(JSON.stringify(scene.document.entries), before);
        const imported = LumenPrefabDocument.cloneFromTemplate('assets/components/batch.scene', context.templatePath, 'Model');
        imported.setPropertySchema(new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7')));
        const entries = structuredClone([...imported.entries]); const meshNode = entries[imported.findNodeIndex('/Model/Triangle')]; assert(meshNode);
        meshNode._lpos = { __type__: 'cc.Vec3', x: 1, y: 0, z: 0 };
        const changed = new LumenPrefabDocument('assets/components/batch.scene', entries, new LumenComponentPropertySchema(LumenCocosVersion.parse('3.8.7')));
        const prior = JSON.stringify(changed.entries);
        assert.throws(() => changed.attachBuiltinComponent('/Model', 'cc.SkinnedMeshBatchRenderer'), /relative_transform_unsupported/u);
        assert.equal(JSON.stringify(changed.entries), prior);
    });
});
