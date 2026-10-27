import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';

const image = (changed = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(changed ? 64 : 0) });
const observation = (type: string, effect = false) => ({ schemaVersion: 1, componentType: type, sceneName: type,
    phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 8 : 1,
    observedFrame: effect ? 10 : 3, engineFramesElapsed: 2, enabled: effect,
    meshBound: true, skeletonBound: true, threshold: 0, intensity: 5 });

test('behavior evidence requires both the real renderer transition and a different game image', () => {
    for (const type of ['cc.Bloom', 'cc.SkinnedMeshRenderer', 'cc.SkinnedMeshBatchRenderer']) {
        const first = observation(type); const second = observation(type, true);
        const result = ComponentBehaviorEvidence.compare(type, first, second, image(), image(true));
        assert.equal(result.behaviorObserved, true); assert.equal(result.task51Complete, false);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, first, second, image(), image()), /game_pixels_unchanged/u);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, first, { ...second, enabled: false }, image(), image(true)), /enable_transition/u);
    }
});

test('behavior evidence refuses wrong identity, premature frames, reordered frames and automatic acceptance', () => {
    const type = 'cc.Bloom'; const first = observation(type); const second = observation(type, true);
    for (const patch of [{ phase: 'baseline' }, { sceneName: 'another' }, { componentType: 'cc.TAA' }, { ready: false },
        { accepted: true }, { schemaVersion: 2 }, { requestedFrame: 9, engineFramesElapsed: 1 },
        { observedFrame: 2, requestedFrame: 0 }, { observedFrame: NaN }, { engineFramesElapsed: 100 }])
        assert.throws(() => ComponentBehaviorEvidence.compare(type, first, { ...second, ...patch }, image(), image(true)));
    assert.throws(() => ComponentBehaviorEvidence.compare('cc.TAA', first, second, image(), image(true)), /not_registered/u);
    assert.throws(() => ComponentBehaviorEvidence.compare(type, first, { ...second, threshold: 0.8 }, image(), image(true)), /stimulus/u);
    assert.throws(() => ComponentBehaviorEvidence.compare('cc.SkinnedMeshRenderer', observation('cc.SkinnedMeshRenderer'),
        { ...observation('cc.SkinnedMeshRenderer', true), skeletonBound: false }, image(), image(true)), /dependency/u);
});

test('animation time readback cannot replace changed real joint poses and actual pixels', () => {
    const type = 'cc.SkeletalAnimation';
    const pose = (x: number) => [{ path: '/Model/Joint', position: [x, 0, 0], rotation: [0, 0, 0, 1] }];
    const first = { ...observation(type), enabled: true, animationDuration: 1, animationTime: 0, poses: pose(0) };
    const second = { ...observation(type, true), animationDuration: 1, animationTime: 0.75, poses: pose(0.5) };
    assert.equal(ComponentBehaviorEvidence.compare(type, first, second, image(), image(true)).behaviorObserved, true);
    for (const patch of [{ poses: pose(0) }, { poses: [] }, { poses: pose(NaN) }, { animationTime: 0.5 },
        { animationDuration: Infinity }, { poses: [...pose(0.5), ...pose(0.5)] },
        { poses: [{ ...pose(0.5)[0], path: '/Different' }] }])
        assert.throws(() => ComponentBehaviorEvidence.compare(type, first, { ...second, ...patch }, image(), image(true)));
    assert.throws(() => ComponentBehaviorEvidence.compare(type, first, second, image(), image()), /game_pixels/u);
});

test('pixel proof refuses alpha-only, tiny changes, malformed or differently sized game regions', () => {
    const type = 'cc.Bloom'; const first = observation(type); const second = observation(type, true);
    const alpha = image(); for (let i = 3; i < alpha.rgba.length; i += 4) alpha.rgba[i] = 255;
    const tiny = image(); tiny.rgba[0] = 255;
    for (const value of [alpha, tiny, { ...image(true), width: 99 }, { ...image(true), rgba: new Uint8Array(1) },
        { ...image(true), width: NaN }, { ...image(true), height: -1 }])
        assert.throws(() => ComponentBehaviorEvidence.compare(type, first, second, image(), value));
});
