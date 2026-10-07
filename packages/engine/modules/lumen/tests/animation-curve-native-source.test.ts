import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenAnimationClipDocument } from '../source/standalone/animation-clip';

test('public position curve survives source save/reopen as a real native vector track', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'lumen-native-curve-'));
    try {
        mkdirSync(join(root, 'assets'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version: '3.8.7' } }));
        const doc = LumenAnimationClipDocument.createEmpty('assets/Move.anim', 'Move');
        doc.applyPatch({ duration: 2, curves: [{ path: 'Mover', property: 'position', keys: [0, 2], values: [[0, 0, 0], [120, 40, 0]] }] });
        doc.save(root);
        const raw = JSON.parse(readFileSync(join(root, 'assets/Move.anim'), 'utf8'));
        assert.equal(raw._tracks.length, 1);
        assert.equal(raw._tracks[0].__type__, 'cc.animation.VectorTrack');
        assert.equal(raw._tracks[0]._nComponents, 3);
        assert.deepEqual(raw._tracks[0]._binding.path._paths, [{ __type__: 'cc.animation.HierarchyPath', path: 'Mover' }, 'position']);
        assert.deepEqual(raw._tracks[0]._channels[0]._curve._times, [0, 2]);
        assert.deepEqual(raw._tracks[0]._channels[0]._curve._values.map((x: { value: number }) => x.value), [0, 120]);
        assert.equal(raw._curves.length, 1);
        assert.equal(raw._keys.length, 1);
        const loaded = LumenAnimationClipDocument.open(root, 'assets/Move.anim');
        assert.equal(loaded.inspect().curves.length, 1);
        assert.equal(loaded.inspect().tracks.length, 1);
        assert.deepEqual(JSON.parse(loaded.serializeNativeSource()), raw);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scalar component curve retains native selector and constant interpolation', (): void => {
    const doc = LumenAnimationClipDocument.createEmpty('assets/Fade.anim', 'Fade');
    doc.applyPatch({ curves: [{ path: 'Child', component: 'cc.UIOpacity', property: 'opacity', keys: [0, 1], values: [0, 255], interpolate: false }] });
    const raw = JSON.parse(doc.serializeNativeSource());
    assert.equal(raw._tracks.length, 1);
    assert.equal(raw._tracks[0].__type__, 'cc.animation.RealTrack');
    assert.deepEqual(raw._tracks[0]._binding.path._paths, [{ __type__: 'cc.animation.HierarchyPath', path: 'Child' }, { __type__: 'cc.animation.ComponentPath', component: 'cc.UIOpacity' }, 'opacity']);
    assert.equal(raw._tracks[0]._channel._curve._values[0].interpolationMode, 1);
});

test('clearing public curves removes playable tracks and old keyframes together', (): void => {
    const doc = LumenAnimationClipDocument.createEmpty('assets/Clear.anim', 'Clear');
    doc.applyPatch({ curves: [{ path: '', property: 'position', keys: [0, 1], values: [[0, 0, 0], [1, 2, 3]] }] });
    doc.applyPatch({ curves: [] });
    const raw = JSON.parse(doc.serializeNativeSource());
    assert.deepEqual(raw._tracks, []);
    assert.deepEqual(raw._curves, []);
    assert.deepEqual(raw._keys, []);
});

for (const [label, keys, values] of [
    ['nonmonotonic', [1, 0], [0, 1]],
    ['duplicate', [0, 0], [0, 1]],
    ['negative', [-1, 1], [0, 1]],
    ['mismatched', [0, 1], [0]],
    ['mixed-vector-shape', [0, 1], [[0, 0, 0], [1, 2]]],
    ['nonfinite-value', [0, 1], [0, Infinity]],
] as const) {
    test('invalid native curve ' + label + ' refuses mixed patch before changing the document', (): void => {
        const doc = LumenAnimationClipDocument.createEmpty('assets/Invalid.anim', 'Original');
        const before = doc.serializeNativeSource();
        assert.throws(() => doc.applyPatch({ name: 'Changed', curves: [{ path: 'Mover', property: 'position', keys, values }] }), /lumen_animation_clip_curve_/);
        assert.equal(doc.serializeNativeSource(), before);
    });
}
