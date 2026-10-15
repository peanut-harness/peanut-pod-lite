import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ComponentPresentationFixture } from './component-presentation-fixture.mts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
for (const version of ['3.8.3', '3.8.7'] as const) {
    test(version + ' presentation uses complete UI templates with a camera, visible Label and intact control children', () => {
        const scratch = mkdtempSync('/private/tmp/pod-presentation-fixture-');
        try {
            const assets = join(scratch, 'editor/assets'); mkdirSync(join(assets, 'default_file_content/scene'), { recursive: true });
            cpSync(join(root, `tests/fixtures/editor-stability/serialized/${version}/native-minimal/scene/scene-2d.scene`),
                join(assets, 'default_file_content/scene/scene-2d.scene'));
            // 冻结产品预设只验证条目图；实际精确SDK来源和渲染另做原生验收。
            cpSync(join(root, 'packages/engine/modules/lumen/bundled/default_prefab'), join(assets, 'default_prefab'), { recursive: true });
            const fixtures: ReturnType<typeof ComponentFieldFixtures.create> = JSON.parse(readFileSync(
                new URL(`./${version}/component-field-fixtures.json`, import.meta.url), 'utf8'));
            for (const type of ['cc.Label', 'cc.Button', 'cc.ScrollView', 'cc.ProgressBar', 'cc.RichText', 'cc.UIStaticBatch', 'cc.UIMeshRenderer', ...(version === '3.8.7' ? ['cc.Sorting2D'] : [])]) {
                const row = fixtures.components.find(row => row.componentType === type); assert(row);
                const result = ComponentPresentationFixture.create(scratch, version, row);
                assert.equal(result.status, 'authored-presentation-native-pending'); if (!('document' in result)) throw Error('presentation missing');
                assert.equal(result.rendered, false); assert.equal(result.nativePassed, false);
                assert(result.targetPath.startsWith('/Root/Canvas/'));
                result.document.findComponentIndex(result.document.findNodeIndex(result.targetPath), type);
                const camera = result.document.entries.find(entry => entry.__type__ === 'cc.Camera'); assert(camera);
                assert.equal(camera._enabled, true); assert((Number(camera._visibility) & 33554432) !== 0);
                if (type === 'cc.UIMeshRenderer') {
                    const node = result.document.findNodeIndex(result.targetPath);
                    const rendererIndex = result.document.findComponentIndex(node, 'cc.MeshRenderer');
                    assert(rendererIndex < result.document.findComponentIndex(node, type));
                    const renderer = result.document.entries[rendererIndex]; assert(renderer);
                    assert.equal(renderer._enabled, true); assert(renderer._mesh); assert(renderer._materials);
                    result.document.findComponentIndex(node, 'cc.UITransform');
                    assert.equal(result.document.entries[node]?._layer, 33554432);
                    assert.deepEqual(result.document.entries[node]?._lscale, { __type__: 'cc.Vec3', x: 160, y: 160, z: 160 });
                    assert(result.sources.some(source => source.path.endsWith('/3d/Cube.prefab')));
                }
                if (type === 'cc.Label') {
                    const label = result.document.entries.find(entry => entry.__type__ === type); assert(label);
                    assert.equal(label._isSystemFontUsed, true); assert.equal(label._font, null);
                    assert.equal(label._string, 'Task 5.1 - cc.Label'); assert.equal(label._fontSize, 32);
                    const node = result.document.findNodeIndex(result.targetPath);
                    const transform = result.document.entries[result.document.findComponentIndex(node, 'cc.UITransform')]; assert(transform);
                    assert.deepEqual(transform._contentSize, { __type__: 'cc.Size', width: 480, height: 96 });
                    const project = join(scratch, 'project');
                    ComponentPresentationFixture.saveForNativeImport(result.document, project, version);
                    const path = join(project, result.document.relativePath); const before = readFileSync(path, 'utf8');
                    const staged = JSON.parse(before); const meta = JSON.parse(readFileSync(path + '.meta', 'utf8'));
                    // 独立模拟原生导入器强制的两项身份；字段与图结构须逐字保持。
                    staged[0]._name = basename(path, '.scene');
                    staged.find((entry: { __type__: string }) => entry.__type__ === 'cc.Scene')._id = meta.uuid;
                    assert.equal(JSON.stringify(staged, null, 2) + '\n', before);
                    assert.equal(staged.find((entry: { __type__: string }) => entry.__type__ === 'cc.Label')._string, 'Task 5.1 - cc.Label');
                    ComponentPresentationFixture.saveForNativeImport(result.document, project, version);
                    assert.equal(readFileSync(path, 'utf8'), before, '重复暂存保留meta身份和场景内容');
                }
                if (type === 'cc.Button') result.document.findComponentIndex(result.document.findNodeIndex(result.targetPath + '/Label'), 'cc.Label');
                if (type === 'cc.ScrollView') result.document.findNodeIndex(result.targetPath + '/view/content/item');
            }
            const postProcess = fixtures.components.find(row => row.componentType === 'cc.HBAO'); assert(postProcess);
            const pending = ComponentPresentationFixture.create(scratch, version, postProcess);
            assert.equal(pending.status, 'presentation-context-pending'); assert.equal('document' in pending, false);
            assert(pending.reasons.includes('presentation-active-pipeline-and-effect-context-required'));
        } finally { rmSync(scratch, { recursive: true, force: true }); }
    });
}
