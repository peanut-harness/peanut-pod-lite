import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentPhysics2DBehaviorContract } from './component-physics2d-behavior-contract.ts';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';

const common = { backendBox2D: true, testedComponentBound: true, dynamicBodyBound: true, bodyImplBound: true,
    debugShapesEnabled: true, steps: 90, targetEnabled: true, gravityScale: 1, contacts: 0, ballY: -224, velocityY: -15 };
const uuid = '11111111-2222-4333-8444-555555555555';
const binding = { expectedSceneUuid: uuid, beforeSceneUuid: uuid, afterSceneUuid: uuid, sourceMetaUuid: uuid,
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: 'a'.repeat(64), beforeSourceSha256: 'a'.repeat(64),
    afterSourceSha256: 'a'.repeat(64), expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const observation = (componentType: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2, componentType,
    sceneName: '', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 100 : 0,
    observedFrame: effect ? 192 : 92, engineFramesElapsed: 92, state });
const pixels = (effect = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(effect ? 64 : 0) });

test('collider evidence requires actual contact, stopped motion, fixed steps and changed game pixels', () => {
    for (const type of [...ComponentPhysics2DBehaviorContract.types].filter(t => t !== 'cc.RigidBody2D')) {
        const a = { ...common, targetEnabled: false }; const b = { ...common, contacts: 1, ballY: -44, velocityY: 0 };
        assert.equal(ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(true), binding).behaviorObserved, true);
        for (const key of Object.keys(b)) { const missing: Record<string, unknown> = { ...b }; delete missing[key]; assert.throws(() => ComponentPhysics2DBehaviorContract.validate(type, a, missing)); }
        for (const patch of [{ contacts: 0 }, { ballY: -224 }, { velocityY: -15 }, { steps: 89 }, { backendBox2D: false }, { ballY: NaN }])
            assert.throws(() => ComponentPhysics2DBehaviorContract.validate(type, a, { ...b, ...patch }));
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(), binding), /game_pixels_unchanged/u);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), { ...observation(type, b, true), requestedFrame: 176, engineFramesElapsed: 16 }, pixels(), pixels(true), binding), /frames_insufficient/u);
    }
});

test('gravity evidence requires a stationary zero-gravity baseline and actual falling dynamic body', () => {
    const a = { ...common, gravityScale: 0, ballY: 140, velocityY: 0 }; const b = { ...common, velocityY: -15 };
    ComponentPhysics2DBehaviorContract.validate('cc.RigidBody2D', a, b);
    for (const patch of [{ ballY: 140 }, { velocityY: 0 }, { contacts: 1 }, { gravityScale: 0 }, { targetEnabled: false }])
        assert.throws(() => ComponentPhysics2DBehaviorContract.validate('cc.RigidBody2D', a, { ...b, ...patch }));
    assert.throws(() => ComponentBehaviorEvidence.compare('cc.RigidBody2D', observation('cc.RigidBody2D', a), observation('cc.RigidBody2D', b, true), pixels(), pixels(true), { ...binding, afterPid: 456 }), /binding_invalid/u);
});
