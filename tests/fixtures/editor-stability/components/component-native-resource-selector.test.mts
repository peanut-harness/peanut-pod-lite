import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentNativeResourceSelector } from './component-native-resource-selector.mts';

test('native carrier selects the frozen standalone material among glTF materials and includes only its actual URL', () => {
    const path = 'serialized/3.8.3/native-minimal/material/default.mtl';
    const binding = { nativeType: 'cc.Material', sources: [{ path: 'tests/fixtures/editor-stability/' + path }] };
    const material = { type: 'cc.Material', uuid: 'actual-standalone', url: 'db://assets/fixtures/' + path, imported: true, invalid: false };
    const other = { ...material, uuid: 'actual-gltf-material', url: 'db://assets/fixtures/media/assets/model/triangle.gltf/UnnamedMaterial.material' };
    const result = ComponentNativeResourceSelector.resolve(binding, [other, material]);
    assert.equal(result.input, material.uuid); assert.deepEqual(result.resources, [material.url]);
    assert.deepEqual(result.expected, { reference: 'asset', uuid: material.uuid, type: 'cc.Material', valid: true });
    assert.throws(() => ComponentNativeResourceSelector.resolve(binding, [other]), /resource_not_unique/);
    assert.throws(() => ComponentNativeResourceSelector.resolve(binding, [other, { ...material, invalid: true }]), /resource_not_unique/);
});

test('native model sources admit only unique imported children, preserving missing and ambiguous input failures', () => {
    const binding = { nativeType: 'cc.Mesh', sources: [{ path: 'tests/fixtures/editor-stability/media/assets/model/triangle.gltf' }] };
    const mesh = { type: 'cc.Mesh', uuid: 'actual-sub-mesh', url: 'db://assets/fixtures/media/assets/model/triangle.gltf/Mesh.mesh', imported: true };
    assert.equal(ComponentNativeResourceSelector.resolve(binding, [mesh]).input, mesh.uuid);
    assert.throws(() => ComponentNativeResourceSelector.resolve(binding, [mesh, { ...mesh, uuid: 'other', url: mesh.url + '/Other.mesh' }]), /resource_not_unique/);
    assert.throws(() => ComponentNativeResourceSelector.resolve(binding, [{ ...mesh, imported: false }]), /resource_not_unique/);
    for (const path of ['tests/fixtures/editor-stability/../escape', 'outside/model.gltf']) {
        assert.throws(() => ComponentNativeResourceSelector.resolve({ ...binding, sources: [{ path }] }, [mesh]), /source_invalid/);
    }
});
