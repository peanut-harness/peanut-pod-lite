import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ComponentDefaultCube383 } from './component-default-cube-383.mts';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
test('3.8.3 CubeMap source is exact SDK creation template with independently pinned six default images', () => {
    ComponentDefaultCube383.assertSdk(root, '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/Resources/resources/3d/engine');
    const binding = ComponentDefaultCube383.binding(root);
    assert.equal(binding.sources.length, 1); assert(binding.sources[0]?.path.endsWith('.cubemap'));
    assert.throws(() => ComponentDefaultCube383.assertSdk(root, '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/Resources/resources/3d/engine'), /sdk_drift/u);
    const proof = JSON.parse(readFileSync(new URL('./3.8.3/default-cube-provenance.json', import.meta.url), 'utf8'));
    const report = { rows: [{ type: 'cc.TextureCube', loaded: { native: { cube: { faces: Object.entries(proof.defaultImageUuids).map(([face, uuid]) => ({ face, uuid })) } } } }] };
    ComponentDefaultCube383.assertLoaded(root, report);
    report.rows[0]!.loaded.native.cube.faces[0]!.uuid = 'different';
    assert.throws(() => ComponentDefaultCube383.assertLoaded(root, report), /face_source_mismatch/u);
});
