import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentNativeCubeContext } from './component-native-cube-context.ts';
const fixture = () => ({ width: 8, height: 8, mipmaps: [Object.fromEntries(['front','back','left','right','top','bottom']
    .map(face => [face, { uuid: face, width: 8, height: 8 }]))], getGFXTexture: () => ({ width: 8, height: 8, layerCount: 6 }) });
const describe = (value: unknown) => {
    if (!value || typeof value !== 'object') return { uuid: '', type: '', valid: false };
    return { uuid: String(Reflect.get(value, 'uuid')), type: 'cc.ImageAsset', valid: true };
};
test('cube dependency guard requires six distinct actual image identities, matching geometry and six GPU layers', () => {
    const cube = fixture(); const result = ComponentNativeCubeContext.read(cube, describe);
    assert.equal(Reflect.get(Object(result), 'gpuLayers'), 6);
    delete cube.mipmaps[0]?.front;
    assert.throws(() => ComponentNativeCubeContext.read(cube, describe), /face_invalid/u);
});
test('empty, repeated-face, different geometry and missing GPU cube cannot masquerade as valid asset type', () => {
    const duplicate = fixture(); duplicate.mipmaps[0]!.front = duplicate.mipmaps[0]!.back!;
    assert.throws(() => ComponentNativeCubeContext.read(duplicate, describe), /faces_not_distinct/u);
    const geometry = fixture(); geometry.mipmaps[0]!.front!.width = 4;
    assert.throws(() => ComponentNativeCubeContext.read(geometry, describe), /face_invalid/u);
    const empty = fixture(); empty.mipmaps = [];
    assert.throws(() => ComponentNativeCubeContext.read(empty, describe), /shape_missing/u);
    const gpu = fixture(); gpu.getGFXTexture = () => ({ width: 8, height: 8, layerCount: 1 });
    assert.throws(() => ComponentNativeCubeContext.read(gpu, describe), /gpu_missing/u);
});
