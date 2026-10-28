import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentBatchPhysicsContract } from './component-batch-physics-contract.ts';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';
import { BULLET_BATCH_TYPES, JOINT_BATCH_TYPES } from './component-batch-physics-catalog.ts';

const uuid = '11111111-2222-4333-8444-555555555555';
const binding = { expectedSceneUuid: uuid, beforeSceneUuid: uuid, afterSceneUuid: uuid, sourceMetaUuid: uuid,
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: 'a'.repeat(64), beforeSourceSha256: 'a'.repeat(64),
    afterSourceSha256: 'a'.repeat(64), expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const observation = (type: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2,
    componentType: type, sceneName: 'Task51BatchPhysics', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false,
    requestedFrame: effect ? 100 : 0, observedFrame: effect ? 194 : 94, engineFramesElapsed: 94, state });
const image = (moved = false, blue = true) => {
    const rgba = new Uint8Array(100 * 100 * 4); const offset = moved ? 50 : 0;
    for (let y = 0; y < 25; y++) for (let x = offset; x < offset + 25; x++) {
        const i = (y * 100 + x) * 4; rgba[i] = blue ? 25 : 100; rgba[i + 1] = blue ? 175 : 100;
        rgba[i + 2] = blue ? 250 : 100; rgba[i + 3] = 255;
    }
    return { width: 100, height: 100, rgba };
};
const states = (type: string): [Record<string, unknown>, Record<string, unknown>] => {
    const base = { backend: 'bullet', backendBound: true, targetBound: true, targetNode: type, bodyBound: true,
        visualBound: true, materialBound: true, steps: 90, connectedBodyBound: true, x: 0, vx: 0, y: -8, vy: -15,
        targetEnabled: false, floorEnabled: false, contacts: 0, grounded: false, gravity: true, phase: 'baseline' };
    const effect = { ...base, targetEnabled: true, floorEnabled: true, contacts: 1, y: 0, vy: 0, phase: 'effect' };
    if (type === 'cc.RigidBody') return [{ ...base, targetEnabled: true, gravity: false, y: 3, vy: 0 }, { ...effect, gravity: true, y: -8, vy: -15 }];
    if (type === 'cc.ConstantForce') return [{ ...base, gravity: false, y: 0, vy: 0 }, { ...effect, gravity: false, x: 4, vx: 6 }];
    if (type.endsWith('Constraint')) return [base, { ...effect, y: 1 }];
    if (type.endsWith('CharacterController')) return [{ ...base, targetEnabled: true }, { ...effect, grounded: true }];
    if (type.endsWith('Joint2D')) return [{ ...base, backend: 'box2d', y: -224, nativeJointBound: false },
        { ...effect, backend: 'box2d', y: 140, nativeJointBound: true }];
    return [base, effect];
};

test('all23 pending physics types require real backend/object/visual/motion dependencies and valid shared-scene identity', () => {
    assert.equal(BULLET_BATCH_TYPES.length, 16); assert.equal(JOINT_BATCH_TYPES.length, 7); assert.equal(ComponentBatchPhysicsContract.types.size, 23);
    for (const type of ComponentBatchPhysicsContract.types) {
        const [a, b] = states(type);
        assert.equal(ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), image(), image(true), binding).behaviorObserved, true);
        for (const key of ['backendBound', 'targetBound', 'bodyBound', 'visualBound', 'materialBound', 'connectedBodyBound'])
            assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, [key]: false }), type + ':' + key);
        for (const patch of [{ steps: 89 }, { targetNode: 'other' }, { y: NaN }, { phase: 'baseline' }])
            assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, ...patch }));
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), { ...observation(type, b, true), sceneName: 'other' }, image(), image(true), binding));
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), { ...observation(type, b, true), requestedFrame: 180, engineFramesElapsed: 14 }, image(), image(true), binding));
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), image(), image(), binding), /game_pixels_unchanged/u);
    }
});

test('wrong contact, unbound native joint, controller non-grounded and unrestrained motion are refused', () => {
    for (const type of ComponentBatchPhysicsContract.types) {
        const [a, b] = states(type);
        if (type.endsWith('Joint2D')) assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, nativeJointBound: false }));
        else if (type.endsWith('Collider')) assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, contacts: 0 }));
        else if (type.endsWith('CharacterController')) assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, grounded: false }));
        else if (type.endsWith('Constraint')) assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, y: -8 }));
        else if (type === 'cc.RigidBody') assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, y: 3 }));
        else assert.throws(() => ComponentBatchPhysicsContract.validate(type, a, { ...b, x: 0 }));
    }
});

test('floor/HUD-only changes cannot replace a visible moving body and wrong native binding remains refused', () => {
    assert.throws(() => ComponentBatchPhysicsContract.motionPixels(image(false, false), image(true, false)), /body_image_missing/u);
    assert.throws(() => ComponentBatchPhysicsContract.motionPixels(image(), image()), /body_image_unchanged/u);
    const type = 'cc.RigidBody'; const [a, b] = states(type);
    assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), image(), image(true), { ...binding, afterPid: 456 }), /binding_invalid/u);
    assert.throws(() => ComponentBatchPhysicsContract.validate('cc.SkinnedMeshBatchRenderer', a, b), /unregistered/u);
    assert.throws(() => ComponentBatchPhysicsContract.validate('cc.RigidBody2D', a, b), /unregistered/u);
});
