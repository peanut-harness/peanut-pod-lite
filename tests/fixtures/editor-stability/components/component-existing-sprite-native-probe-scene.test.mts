import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentExistingSpriteNativeProbeScene } from './component-existing-sprite-native-probe-scene.ts';

const sceneUuid = '00000000-0000-4000-8000-000000000001';
const frameUuid = '00000000-0000-4000-8000-000000000003';

function fixture(withOpacity = true) {
    const frame = { type: 'cc.SpriteFrame', _uuid: frameUuid };
    const sprite = { type: 'cc.Sprite', grayscale: true, spriteFrame: frame };
    const opacity = { type: 'cc.UIOpacity', opacity: 128 };
    const target = { name: 'Target', children: [], getComponents: () => withOpacity ? [sprite, opacity] : [sprite] };
    const canvas = { name: 'Canvas', children: [target], getComponents: () => [] };
    const root = { name: 'Root', children: [canvas], getComponents: () => [] };
    const scene = { name: 'SpriteScene', uuid: sceneUuid, children: [root], getComponents: () => [] };
    const runtime = { scene, componentBase: {}, className: (value: any) => value.type,
        isValid: (value: unknown) => value === frame };
    return { runtime, scene, target, sprite, opacity, frame };
}

test('reads native Sprite and UIOpacity getters without mutating the scene graph', () => {
    const f = fixture(); const before = JSON.stringify(f.scene);
    const result = ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid, frameUuid, true);
    assert.deepEqual(result, { sceneUuid, targetPath: '/Root/Canvas/Target', frameUuid,
        frameType: 'cc.SpriteFrame', frameValid: true, grayscale: true, opacity: 128 });
    assert.equal(JSON.stringify(f.scene), before);
});

test('removed opacity is accepted only when absent was requested', () => {
    const f = fixture(false);
    assert.equal(ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid, frameUuid, false).opacity, null);
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid, frameUuid, true), /component_mismatch/);
    const present = fixture();
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(present.runtime, sceneUuid, frameUuid, false), /component_mismatch/);
});

test('wrong scene, target, frame UUID or invalid frame fails rather than returning an empty snapshot', () => {
    const f = fixture();
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime,
        '00000000-0000-4000-8000-000000000099', frameUuid, true), /scene_identity_mismatch/);
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid,
        '00000000-0000-4000-8000-000000000099', true), /frame_mismatch/);
    const missing = fixture(); missing.target.name = 'Elsewhere';
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(missing.runtime, sceneUuid, frameUuid, true), /target_missing_or_ambiguous/);
    const invalid = fixture(); invalid.runtime.isValid = () => false;
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(invalid.runtime, sceneUuid, frameUuid, true), /frame_mismatch/);
});

test('ambiguous target, wrong component type and unknown getter values refuse', () => {
    const f = fixture(); f.scene.children.push(f.scene.children[0]);
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid, frameUuid, true), /target_missing_or_ambiguous/);
    const wrong = fixture(); wrong.sprite.type = 'cc.Label';
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(wrong.runtime, sceneUuid, frameUuid, true), /component_mismatch/);
    const unknown = fixture(); (unknown.opacity as { opacity: unknown }).opacity = '128';
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(unknown.runtime, sceneUuid, frameUuid, true), /opacity_invalid/);
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(unknown.runtime, 'bad', frameUuid, true), /arguments_invalid/);
});

test('cyclic or oversized scene hierarchy is bounded before getter access', () => {
    const f = fixture();
    (f.scene.children as unknown[]).push(f.scene);
    assert.throws(() => ComponentExistingSpriteNativeProbeScene.snapshot(f.runtime, sceneUuid, frameUuid, true), /hierarchy_limit/);
});
