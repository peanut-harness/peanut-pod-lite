/**
 * @description 将实际现代曲线和渐变API投影为公开线格式，不访问已废弃curve getter。
 */
export class ComponentNativeRangeReader {
    /**
     * @description 只转换已审计范围类型中配方要求的键，全部值来自实际对象。
     * @param value 原生范围对象。
     * @param type 引擎报告的实际类型。
     * @param keys 公开配方所需的键。
     * @returns 线格式字段或非范围类型时的原对象。
     */
    public static project(value: Record<string, unknown>, type: string, keys: readonly string[]): Record<string, unknown> {
        if (type !== 'cc.CurveRange' && type !== 'cc.GradientRange') return value;
        return Object.fromEntries(keys.map(key => {
            if (type === 'cc.CurveRange') {
                const names: Readonly<Record<string, string>> = { keys: 'spline', points: 'spline', keysMin: 'splineMin', keysMax: 'splineMax' };
                const spline = names[key];
                if (spline) return [key, this.curve(value[spline])];
            } else {
                const names: Readonly<Record<string, string>> = { colorKeys: 'gradient', alphaKeys: 'gradient', colorKeysMin: 'gradientMin',
                    alphaKeysMin: 'gradientMin', colorKeysMax: 'gradientMax', alphaKeysMax: 'gradientMax' };
                const gradient = names[key];
                if (gradient) return [key, this.gradient(value[gradient], key.startsWith('color') ? 'colorKeys' : 'alphaKeys')];
            }
            if (['curve', 'curveMin', 'curveMax'].includes(key)) throw new Error('component_native_deprecated_range_getter');
            return [key, value[key]];
        }));
    }

    /**
     * @description 从RealCurve公开迭代器读取实际关键帧，拒绝缺失、非有限或超限数据。
     * @param value 实际RealCurve。
     * @returns 真实time/value对。
     */
    private static curve(value: unknown): unknown[] {
        if (!this.record(value) || typeof value.keyframes !== 'function') throw new Error('component_native_spline_missing');
        const iterator: unknown = Reflect.apply(value.keyframes, value, []);
        if (!this.iterable(iterator)) throw new Error('component_native_spline_iterator');
        const keys: unknown[] = [];
        for (const pair of iterator) {
            if (keys.length >= 128 || !Array.isArray(pair) || pair.length !== 2 || !this.record(pair[1])) throw new Error('component_native_spline_key');
            keys.push({ time: this.number(pair[0]), value: this.number(pair[1].value) });
        }
        return keys;
    }

    /**
     * @description 从Gradient公开数组读取真实颜色或透明度关键帧。
     * @param value 实际Gradient。
     * @param key 已审计的键数组名。
     * @returns 有界真实数组。
     */
    private static gradient(value: unknown, key: 'colorKeys' | 'alphaKeys'): unknown[] {
        const keys = this.record(value) ? value[key] : null;
        if (!Array.isArray(keys) || keys.length > 128) throw new Error('component_native_gradient_keys');
        return keys.map(item => {
            if (!this.record(item)) throw new Error('component_native_gradient_key');
            return key === 'colorKeys' ? { time: this.number(item.time), color: item.color }
                : { time: this.number(item.time), alpha: this.number(item.alpha) };
        });
    }

    /**
     * @description 拒绝非有限原生数值。
     * @param value 实际值。
     * @returns 有限数值。
     */
    private static number(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('component_native_range_nonfinite');
        return value;
    }

    /**
     * @description 校验公开迭代协议，不断言未知对象具备接口。
     * @param value 实际返回值。
     * @returns 是否可迭代。
     */
    private static iterable(value: unknown): value is Iterable<unknown> {
        return value !== null && typeof value === 'object' && typeof Reflect.get(value, Symbol.iterator) === 'function';
    }

    /**
     * @description 缩窄原生对象。
     * @param value 实际值。
     * @returns 是否为对象。
     */
    private static record(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
}
