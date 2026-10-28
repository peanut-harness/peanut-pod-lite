import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComponentInputBehaviorContract } from './component-input-behavior-contract.ts';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';
const pairs: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['cc.Button', {}, {}],
    ['cc.Toggle', { checked: false, checkmarkActive: false, checkmarkBound: true }, { checked: true, checkmarkActive: true, checkmarkBound: true }],
    ['cc.ToggleContainer', { checked: [true, false] }, { checked: [false, true] }],
    ['cc.Slider', { progress: 0.25, handleX: -120, handleBound: true }, { progress: 0.75, handleX: 120, handleBound: true }],
    ['cc.BlockInputEvents', { nativeEvents: 1, callbacks: 1, blockEnabled: false }, { nativeEvents: 1, callbacks: 0, blockEnabled: true }],
].map(([type, a, b]) => [type as string, { frameBound: true, nativeEvents: 0, callbacks: 0, ...a as object },
    { frameBound: true, nativeEvents: 1, callbacks: 1, ...b as object }]);
const binding = { expectedSceneUuid: '11111111-2222-4333-8444-555555555555', beforeSceneUuid: '11111111-2222-4333-8444-555555555555', afterSceneUuid: '11111111-2222-4333-8444-555555555555', sourceMetaUuid: '11111111-2222-4333-8444-555555555555',
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: 'a'.repeat(64), beforeSourceSha256: 'a'.repeat(64),
    afterSourceSha256: 'a'.repeat(64), expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const observation = (type: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2, componentType: type,
    sceneName: '', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 40 : 0,
    observedFrame: effect ? 56 : 16, engineFramesElapsed: 16, state });
const pixels = (effect = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(effect ? 64 : 0) });
test('input evidence requires real callback semantics, identity, frames and game pixels', () => {
    assert.deepEqual([...ComponentInputBehaviorContract.types].sort(), pairs.map(x => x[0]).sort());
    for (const [type, a, b] of pairs) {
        assert.equal(ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(true), binding).behaviorObserved, true);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(), binding), /game_pixels_unchanged/u);
        for (const key of Object.keys(b)) { const missing = { ...b }; delete missing[key]; assert.throws(() => ComponentInputBehaviorContract.validate(type, a, missing), type + ':' + key); }
        assert.throws(() => ComponentInputBehaviorContract.validate(type, a, { ...b, nativeEvents: 0 }));
        assert.throws(() => ComponentInputBehaviorContract.validate(type, a, { ...b, callbacks: 6 }));
    }
});
test('changed slider values without real handle motion and mixed radio selection are refused', () => {
    const slider = pairs.find(x => x[0] === 'cc.Slider')!;
    for (const patch of [{ handleX: -120 }, { handleX: NaN }, { progress: Infinity }, { progress: 0.25 }])
        assert.throws(() => ComponentInputBehaviorContract.validate(slider[0], slider[1], { ...slider[2], ...patch }));
    const radio = pairs.find(x => x[0] === 'cc.ToggleContainer')!;
    assert.throws(() => ComponentInputBehaviorContract.validate(radio[0], radio[1], { ...radio[2], checked: [true, true] }));
});
