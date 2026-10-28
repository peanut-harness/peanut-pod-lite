import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentBehaviorEvidence, type ComponentBehaviorSceneBinding } from './component-behavior-evidence.ts';
import { ComponentUiBehaviorContract } from './component-ui-behavior-contract.ts';

const pairs: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['cc.Label', { text: 'BASELINE', fontSize: 96 }, { text: 'CHANGED', fontSize: 96 }],
    ['cc.RichText', { text: '<color=#ff4433>ONE</color>', fontSize: 96 }, { text: '<color=#33aaff>TWO</color>', fontSize: 96 }],
    ['cc.Sprite', { frameBound: true, color: '30,130,255,255' }, { frameBound: true, color: '255,60,40,255' }],
    ['cc.UIOpacity', { frameBound: true, opacity: 255 }, { frameBound: true, opacity: 32 }],
    ['cc.UITransform', { frameBound: true, width: 200, height: 180 }, { frameBound: true, width: 480, height: 180 }],
    ['cc.UISkew', { frameBound: true, skewX: 0, skewY: 0 }, { frameBound: true, skewX: 30, skewY: 0 }],
    ['cc.Graphics', { lineWidth: 4 }, { lineWidth: 32 }],
    ['cc.Mask', { inverted: false, childFrameBound: true }, { inverted: true, childFrameBound: true }],
    ['cc.Layout', { layoutType: 1, childCount: 3, childrenFramesBound: true, positions: [[-140, 0], [0, 0], [140, 0]] },
        { layoutType: 2, childCount: 3, childrenFramesBound: true, positions: [[0, 140], [0, 0], [0, -140]] }],
    ['cc.Widget', { frameBound: true, left: 120, targetIsParent: true, posX: -180 }, { frameBound: true, left: 480, targetIsParent: true, posX: 180 }],
    ['cc.Sorting2D', { frameBound: true, order: 0, backdropOrder: 1, backdropFrameBound: true }, { frameBound: true, order: 2, backdropOrder: 1, backdropFrameBound: true }],
    ['cc.ProgressBar', { progress: 0.25, totalLength: 480, barWidth: 120, barFrameBound: true }, { progress: 0.75, totalLength: 480, barWidth: 360, barFrameBound: true }],
    ['cc.ScrollView', { offsetY: 0, maxY: 660, contentY: 120, childCount: 3, contentFramesBound: true },
        { offsetY: 660, maxY: 660, contentY: 780, childCount: 3, contentFramesBound: true }],
    ['cc.ScrollBar', { offsetY: 0, maxY: 660, contentY: 120, childCount: 3, contentFramesBound: true, verticalBarBound: true, handleFrameBound: true, handleY: 88 },
        { offsetY: 660, maxY: 660, contentY: 780, childCount: 3, contentFramesBound: true, verticalBarBound: true, handleFrameBound: true, handleY: -88 }],
];
const uuid = '77750089-0910-47f7-b41c-7ae4eec22ced'; const sha = 'c'.repeat(64);
const binding: ComponentBehaviorSceneBinding = { expectedSceneUuid: uuid, beforeSceneUuid: uuid, afterSceneUuid: uuid, sourceMetaUuid: uuid,
    expectedPid: 123, beforePid: 123, afterPid: 123, expectedSourceSha256: sha, beforeSourceSha256: sha, afterSourceSha256: sha,
    expectedPreviewUrl: 'http://localhost:7456/', beforePreviewUrl: 'http://localhost:7456/', afterPreviewUrl: 'http://localhost:7456/' };
const pixels = (effect = false) => ({ width: 100, height: 100, rgba: new Uint8Array(40000).fill(effect ? 64 : 0) });
const observe = (type: string, state: unknown, effect = false) => ({ schemaVersion: 1, protocolVersion: 2, componentType: type,
    sceneName: '', phase: effect ? 'effect' : 'baseline', ready: true, accepted: false, requestedFrame: effect ? 40 : 0,
    observedFrame: effect ? 56 : 16, engineFramesElapsed: 16, state });

test('all registered UI semantics require true dependencies and actual changed game pixels', () => {
    assert.deepEqual([...ComponentUiBehaviorContract.types].sort(), pairs.map(x => x[0]).sort());
    for (const [type, first, second] of pairs) {
        const a = observe(type, first); const b = observe(type, second, true);
        assert.equal(ComponentBehaviorEvidence.compare(type, a, b, pixels(), pixels(true), binding).behaviorObserved, true);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, a, b, pixels(), pixels(), binding), /game_pixels_unchanged/u);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, a, b, pixels(), pixels(true), { ...binding, afterPid: 456 }), /binding_invalid/u);
        assert.throws(() => ComponentBehaviorEvidence.compare(type, a, { ...b, requestedFrame: 41, engineFramesElapsed: 15 }, pixels(), pixels(true), binding), /frames_insufficient/u);
        for (const key of Object.keys(second)) {
            const broken = { ...second }; delete broken[key];
            assert.throws(() => ComponentUiBehaviorContract.validate(type, first, broken), type + ':' + key);
        }
    }
});

test('changed layout type cannot replace actual position change, and NaN never proves motion', () => {
    const row = pairs.find(x => x[0] === 'cc.Layout')!;
    assert.throws(() => ComponentUiBehaviorContract.validate(row[0], row[1], { ...row[2], positions: row[1].positions }));
    assert.throws(() => ComponentUiBehaviorContract.validate(row[0], row[1], { ...row[2], positions: [[0, NaN], [0, 0], [0, -140]] }));
    const scroll = pairs.find(x => x[0] === 'cc.ScrollBar')!;
    for (const patch of [{ handleY: 88 }, { contentY: 120 }, { offsetY: 0 }, { maxY: Infinity }, { handleFrameBound: false }])
        assert.throws(() => ComponentUiBehaviorContract.validate(scroll[0], scroll[1], { ...scroll[2], ...patch }));
    const widget = pairs.find(x => x[0] === 'cc.Widget')!;
    assert.throws(() => ComponentUiBehaviorContract.validate(widget[0], widget[1], { ...widget[2], posX: -180 }));
});
