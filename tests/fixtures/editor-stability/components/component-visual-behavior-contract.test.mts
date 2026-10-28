import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentVisualBehaviorContract } from './component-visual-behavior-contract.ts';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';
const dependencies: [string, Record<string, unknown>][] = [
    ...[...ComponentVisualBehaviorContract.lights].map(t => [t, { geometryBound: true, materialBound: true, standardEffect: true, effectBound: true, passesReady: true, sphereEnabled: true, ambientIllum: 0 }] as [string, Record<string, unknown>]),
    ['cc.MeshRenderer', { geometryBound: true, materialBound: true }], ['cc.Canvas', { frameBound: true, cameraBound: true }],
    ['cc.SpriteRenderer', { frameBound: true, geometryBound: true, materialBound: true, textureBound: true, passesReady: true }], ['cc.Billboard', { textureBound: true, width: 4, height: 4 }],
    ['cc.Line', { positions: [[-2, -1, 0], [0, 1, 0], [2, -1, 0]], lineWidth: 0.3, materialBound: true }],
];
const uuid = '11111111-2222-4333-8444-555555555555';
const binding = { expectedSceneUuid: uuid, beforeSceneUuid: uuid, afterSceneUuid: uuid, sourceMetaUuid: uuid,
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: 'a'.repeat(64), beforeSourceSha256: 'a'.repeat(64),
    afterSourceSha256: 'a'.repeat(64), expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const observation = (type: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2, componentType: type,
    sceneName: '', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 40 : 0,
    observedFrame: effect ? 56 : 16, engineFramesElapsed: 16, state });
const pixels = (effect = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(effect ? 64 : 0) });
test('visual cases require real rendering dependencies, lifecycle and changed game pixels', () => {
    assert.deepEqual([...ComponentVisualBehaviorContract.types].sort(), dependencies.map(x => x[0]).sort());
    for (const [type, dependency] of dependencies) {
        const a = { ...dependency, enabled: false }; const b = { ...dependency, enabled: true };
        assert.equal(ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(true), binding).behaviorObserved, true);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(), binding), /game_pixels_unchanged/u);
        for (const key of Object.keys(b)) { const missing = { ...b }; delete missing[key]; assert.throws(() => ComponentVisualBehaviorContract.validate(type, a, missing), type + ':' + key); }
        assert.throws(() => ComponentVisualBehaviorContract.validate(type, a, a));
    }
});
test('ambient-only illumination, invalid line geometry and wrong native binding cannot prove the tested component', () => {
    const light = dependencies[0]!;
    assert.throws(() => ComponentVisualBehaviorContract.validate(light[0], { ...light[1], enabled: false }, { ...light[1], enabled: true, ambientIllum: 1 }));
    const line = dependencies.find(x => x[0] === 'cc.Line')!;
    assert.throws(() => ComponentVisualBehaviorContract.validate(line[0], { ...line[1], enabled: false }, { ...line[1], enabled: true, positions: [[NaN, 0, 0]] }));
    assert.throws(() => ComponentBehaviorEvidence.compare(light[0], observation(light[0], { ...light[1], enabled: false }),
        observation(light[0], { ...light[1], enabled: true }, true), pixels(), pixels(true), { ...binding, afterPid: 456 }), /binding_invalid/u);
});
