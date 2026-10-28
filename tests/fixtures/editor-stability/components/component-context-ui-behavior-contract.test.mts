import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentContextUiBehaviorContract } from './component-context-ui-behavior-contract.ts';
import { ComponentBehaviorEvidence } from './component-behavior-evidence.ts';
const pages = { pageCount: 3, pageFramesBound: true, indicatorFramesBound: true };
const pairs: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ...['cc.PageView', 'cc.PageViewIndicator'].map(type => [type,
        { ...pages, pageIndex: 0, contentX: 420, indicatorAlphas: [255, 128, 128] },
        { ...pages, pageIndex: 2, contentX: -420, indicatorAlphas: [128, 128, 255] }] as [string, Record<string, unknown>, Record<string, unknown>]),
    ['cc.EditBox', { text: 'BASELINE', labelText: 'BASELINE', changed: 0, ended: 0, returned: 0, frameBound: true },
        { text: 'TEST', labelText: 'TEST', changed: 4, ended: 1, returned: 1, frameBound: true }],
    ['cc.SafeArea', { enabled: false, width: 200, height: 180, safeWidth: 1280, safeHeight: 2770, frameBound: true },
        { enabled: true, width: 1280, height: 2770, safeWidth: 1280, safeHeight: 2770, frameBound: true }],
    ['cc.RenderRoot2D', { enabled: true, detachedFromCanvas: true, frameBound: true }, { enabled: false, detachedFromCanvas: true, frameBound: true }],
    ['cc.UICoordinateTracker', { sourceX: -2, markerX: -200, mapped: true, targetBound: true, cameraBound: true, frameBound: true },
        { sourceX: 2, markerX: 200, mapped: true, targetBound: true, cameraBound: true, frameBound: true }],
];
const binding = { expectedSceneUuid: '11111111-2222-4333-8444-555555555555', beforeSceneUuid: '11111111-2222-4333-8444-555555555555',
    afterSceneUuid: '11111111-2222-4333-8444-555555555555', sourceMetaUuid: '11111111-2222-4333-8444-555555555555',
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: 'a'.repeat(64), beforeSourceSha256: 'a'.repeat(64),
    afterSourceSha256: 'a'.repeat(64), expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const observation = (type: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2, componentType: type,
    sceneName: '', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 40 : 0,
    observedFrame: effect ? 56 : 16, engineFramesElapsed: 16, state });
const pixels = (effect = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(effect ? 64 : 0) });
test('context UI results require actual dependency and output semantics plus game pixels', () => {
    assert.deepEqual([...ComponentContextUiBehaviorContract.types].sort(), pairs.map(x => x[0]).sort());
    for (const [type, a, b] of pairs) {
        assert.equal(ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(true), binding).behaviorObserved, true);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, observation(type, a), observation(type, b, true), pixels(), pixels(), binding), /game_pixels_unchanged/u);
        for (const key of Object.keys(b)) { const missing = { ...b }; delete missing[key]; assert.throws(() => ComponentContextUiBehaviorContract.validate(type, a, missing), type + ':' + key); }
    }
});
test('page index alone, edited value without callbacks, and unmapped coordinates never prove behavior', () => {
    const page = pairs[0]!; assert.throws(() => ComponentContextUiBehaviorContract.validate(page[0], page[1], { ...page[2], contentX: page[1].contentX }));
    const edit = pairs[2]!; for (const patch of [{ changed: 0 }, { ended: 0 }, { returned: 0 }, { labelText: 'BASELINE' }])
        assert.throws(() => ComponentContextUiBehaviorContract.validate(edit[0], edit[1], { ...edit[2], ...patch }));
    const safe = pairs[3]!; assert.throws(() => ComponentContextUiBehaviorContract.validate(safe[0], safe[1], { ...safe[2], width: 200 }));
    const mapped = pairs[5]!; for (const patch of [{ markerX: NaN }, { mapped: false }, { markerX: -200 }])
        assert.throws(() => ComponentContextUiBehaviorContract.validate(mapped[0], mapped[1], { ...mapped[2], ...patch }));
});
