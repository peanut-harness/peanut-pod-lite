import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import test from 'node:test';
import { ComponentNativeSkinnedContext } from './component-native-skinned-context.ts';

const base = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const asset = (type: string, sub: string) => ({ uuid: base + '@' + sub, type, valid: true });
const observation = { type: 'cc.SkinnedMeshRenderer', rootPresent: true, rootIsAncestor: true, controllerPresent: true, controllerOnAnimationNode: true,
    modelPresent: true, vertexCounts: [3], joints: [{ path: 'Joint', valid: true }], mesh: asset('cc.Mesh', 'mesh'),
    skeleton: asset('cc.Skeleton', 'skeleton'), clips: [asset('cc.AnimationClip', 'clip')], units: [] };

test('native context rejects empty geometry, unresolved joints, missing controller and unrelated clips despite correct field values', () => {
    ComponentNativeSkinnedContext.assert(observation, 'cc.SkinnedMeshRenderer', base, ['Joint']);
    for (const patch of [{ rootPresent: false }, { rootIsAncestor: false }, { controllerPresent: false }, { modelPresent: false }, { vertexCounts: [0] },
        { joints: [{ path: 'Joint', valid: false }] }, { joints: [] }, { clips: [{ ...asset('cc.AnimationClip', 'clip'), uuid: 'other@clip' }] },
        { mesh: { ...asset('cc.Mesh', 'mesh'), valid: false } }]) {
        assert.throws(() => ComponentNativeSkinnedContext.assert({ ...observation, ...patch }, 'cc.SkinnedMeshRenderer', base, ['Joint']), /component_skinned_native_/u);
    }
});

test('batch context requires nonempty cooked output and same-source units without pretending generated mesh has an imported UUID', () => {
    const batch = { ...observation, type: 'cc.SkinnedMeshBatchRenderer', mesh: { uuid: '', type: 'cc.Mesh', valid: true },
        skeleton: { uuid: '', type: 'cc.Skeleton', valid: true }, units: [{ mesh: asset('cc.Mesh', 'mesh'),
            skeleton: asset('cc.Skeleton', 'skeleton'), material: asset('cc.Material', 'material') }] };
    ComponentNativeSkinnedContext.assert(batch, batch.type, base, ['Joint']);
    assert.throws(() => ComponentNativeSkinnedContext.assert({ ...batch, units: [] }, batch.type, base, ['Joint']), /batch_units_missing/u);
    const units = [{ ...batch.units[0], skeleton: { ...asset('cc.Skeleton', 'skeleton'), uuid: 'other@skeleton' } }];
    assert.throws(() => ComponentNativeSkinnedContext.assert({ ...batch, units }, batch.type, base, ['Joint']), /asset_source_mismatch/u);
});

test('scene observation uses only fixed public queries and shared assets, never instance-creating material getters', () => {
    const compiled = buildSync({ entryPoints: [fileURLToPath(new URL('./component-native-skinned-context.ts', import.meta.url))],
        platform: 'node', format: 'cjs', target: 'node14', write: false, bundle: true, external: ['cc'] });
    const code = compiled.outputFiles?.[0]?.text; assert(code);
    const joint = { type: 'cc.Node' }; const controller = { type: 'cc.SkeletalAnimation', clips: [{ type: 'cc.AnimationClip', _uuid: base + '@clip' }] };
    const root = { getComponent: () => controller, getChildByPath: (path: string) => { assert.equal(path, 'Joint'); return joint; } };
    const renderer = { type: 'cc.SkinnedMeshRenderer', node: { type: 'cc.Node', parent: root }, skinningRoot: root,
        skeleton: { type: 'cc.Skeleton', _uuid: base + '@skeleton', joints: ['Joint'] },
        mesh: { type: 'cc.Mesh', _uuid: base + '@mesh', struct: { vertexBundles: [{ view: { count: 3 } }] } }, model: { type: 'cc.SkinningModel' } };
    let materialReads = 0;
    for (const key of ['material', 'materials']) Object.defineProperty(renderer, key, { get: () => { materialReads++; throw Error('instance getter called'); } });
    const cc = { js: { getClassName: (value: { type: string }) => value.type }, isValid: () => true, SkeletalAnimation: class {} };
    const output = { exports: {} };
    runInNewContext(code, { module: output, exports: output.exports, require: (id: string) => { assert.equal(id, 'cc'); return cc; } });
    const context: unknown = Reflect.get(output.exports, 'ComponentNativeSkinnedContext'); assert(context && typeof context === 'function');
    const read: unknown = Reflect.get(context, 'read'); assert.equal(typeof read, 'function'); if (typeof read !== 'function') throw Error('reader missing');
    const result = JSON.parse(JSON.stringify(Reflect.apply(read, context, [renderer])));
    ComponentNativeSkinnedContext.assert(result, renderer.type, base, ['Joint']); assert.equal(materialReads, 0);
});
