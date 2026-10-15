import assert from 'node:assert/strict';
import test from 'node:test';
import { ComponentNativeRangeReader } from './component-native-range-reader.ts';

test('native curve projection uses actual modern spline frames without calling deprecated getters', () => {
    let oldReads = 0;
    const value = { mode: 1, spline: { *keyframes() { yield [0, { value: 13 }]; yield [1, { value: 47 }]; } } };
    Object.defineProperty(value, 'curve', { get() { oldReads++; throw Error('deprecated'); } });
    assert.deepEqual(ComponentNativeRangeReader.project(value, 'cc.CurveRange', ['mode', 'keys']), {
        mode: 1, keys: [{ time: 0, value: 13 }, { time: 1, value: 47 }],
    });
    assert.equal(oldReads, 0);
    assert.throws(() => ComponentNativeRangeReader.project(value, 'cc.CurveRange', ['curve']), /deprecated_range_getter/);
    assert.equal(oldReads, 0);
});

test('native two-curve and two-gradient representations preserve their distinct actual values', () => {
    const spline = (value: number) => ({ *keyframes() { yield [0.5, { value }]; } });
    assert.deepEqual(ComponentNativeRangeReader.project({ splineMin: spline(2), splineMax: spline(9) }, 'cc.CurveRange', ['keysMin', 'keysMax']), {
        keysMin: [{ time: 0.5, value: 2 }], keysMax: [{ time: 0.5, value: 9 }],
    });
    const gradient = { colorKeys: [{ time: 0.25, color: { r: 9, g: 8, b: 7, a: 255 } }], alphaKeys: [{ time: 0.75, alpha: 0.4 }] };
    assert.deepEqual(ComponentNativeRangeReader.project({ gradientMin: gradient, gradientMax: gradient }, 'cc.GradientRange', ['colorKeysMin', 'alphaKeysMax']), {
        colorKeysMin: gradient.colorKeys, alphaKeysMax: gradient.alphaKeys,
    });
});

test('malformed or oversized native ranges fail instead of using fixture values', () => {
    for (const spline of [undefined, {}, { *keyframes() { yield [NaN, { value: 3 }]; } },
        { *keyframes() { for (let i = 0; i < 129; i++) yield [i, { value: i }]; } }]) {
        assert.throws(() => ComponentNativeRangeReader.project({ spline }, 'cc.CurveRange', ['keys']), /component_native_(spline|range)/);
    }
    assert.throws(() => ComponentNativeRangeReader.project({ gradient: { colorKeys: Array(129).fill({}) } }, 'cc.GradientRange', ['colorKeys']), /gradient_keys/);
    const value = { x: 4 }; assert.equal(ComponentNativeRangeReader.project(value, 'cc.Vec2', ['x']), value);
});
