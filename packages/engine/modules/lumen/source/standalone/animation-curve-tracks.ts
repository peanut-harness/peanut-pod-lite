/**
 * @description 把公开数值与向量曲线编码为当前原生可反序列化的轨道。
 */
export class LumenAnimationCurveTracks {
    /**
     * @description 在文档变更前验证曲线并构造完整轨道集合。
     * @param value 未受信公开曲线数组。
     * @returns 数值与向量简写对应的原生轨道；旧原样曲线不擅自重写。
     */
    public static encode(value: unknown): Record<string, unknown>[] {
        if (!Array.isArray(value)) {
            throw new Error('lumen_property_type:curves:array');
        }
        const tracks: Record<string, unknown>[] = [];
        value.forEach((item: unknown, index: number): void => {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:curves[${index}]:object`);
            }
            if ('modifiers' in item || 'data' in item) {
                return;
            }
            tracks.push(this._track(item, index));
        });
        return tracks;
    }

    /**
     * @description 验证单条简写曲线并选择标量或向量轨道。
     * @param item 未受信曲线对象。
     * @param index 输入序号。
     * @returns 原生轨道对象。
     */
    private static _track(item: object, index: number): Record<string, unknown> {
        const path = 'path' in item ? item.path : undefined;
        const property = 'property' in item ? item.property : undefined;
        const keys = 'keys' in item ? item.keys : undefined;
        const values = 'values' in item ? item.values : undefined;
        const component = 'component' in item ? item.component : undefined;
        if (typeof path !== 'string' || /\s|\\/.test(path) || path.includes('..')) {
            throw new Error(`lumen_animation_clip_curve_path_invalid:${index}`);
        }
        if (typeof property !== 'string' || !property || !Array.isArray(values)) {
            throw new Error(`lumen_animation_clip_curve_shape_invalid:${index}`);
        }
        const times = this._times(keys, values.length, index);
        const paths: unknown[] = [];
        if (path) {
            paths.push({ __type__: 'cc.animation.HierarchyPath', path });
        }
        if (component !== undefined) {
            if (typeof component !== 'string' || !component) {
                throw new Error(`lumen_animation_clip_curve_component_invalid:${index}`);
            }
            paths.push({ __type__: 'cc.animation.ComponentPath', component });
        }
        paths.push(property);
        const binding = { __type__: 'cc.animation.TrackBinding', path: {
            __type__: 'cc.animation.TrackPath', _paths: paths,
        } };
        const interpolation = 'interpolate' in item && item.interpolate === false ? 1 : 0;
        if (values.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
            return { __type__: 'cc.animation.RealTrack', _binding: binding,
                _channel: this._channel(times, values, interpolation) };
        }
        const vectors = this._vectors(values, index);
        const dimensions = vectors[0].length;
        const channels = [0, 1, 2, 3].map((axis: number) => this._channel(
            times, vectors.map((vector: number[]) => vector[axis] ?? 0), interpolation,
        ));
        return { __type__: 'cc.animation.VectorTrack', _binding: binding,
            _nComponents: dimensions, _channels: channels };
    }

    /**
     * @description 要求严格递增、有限且非负的对应关键帧时间。
     * @param value 未受信时间数组。
     * @param count 值数组长度。
     * @param index 曲线序号。
     * @returns 独立数值时间数组。
     */
    private static _times(value: unknown, count: number, index: number): number[] {
        if (!Array.isArray(value) || count === 0 || value.length !== count) {
            throw new Error(`lumen_animation_clip_curve_keys_invalid:${index}`);
        }
        const times: number[] = [];
        for (const time of value) {
            if (typeof time !== 'number' || !Number.isFinite(time) || time < 0
                || (times.length > 0 && time <= times[times.length - 1])) {
                throw new Error(`lumen_animation_clip_curve_keys_invalid:${index}`);
            }
            times.push(time);
        }
        return times;
    }

    /**
     * @description 要求一致的二至四维有限数值向量。
     * @param values 未受信值数组。
     * @param index 曲线序号。
     * @returns 独立数值向量数组。
     */
    private static _vectors(values: readonly unknown[], index: number): number[][] {
        const vectors: number[][] = [];
        for (const value of values) {
            if (!Array.isArray(value) || value.length < 2 || value.length > 4
                || (vectors.length > 0 && value.length !== vectors[0].length)) {
                throw new Error(`lumen_animation_clip_curve_values_invalid:${index}`);
            }
            const vector: number[] = [];
            for (const component of value) {
                if (typeof component !== 'number' || !Number.isFinite(component)) {
                    throw new Error(`lumen_animation_clip_curve_values_invalid:${index}`);
                }
                vector.push(component);
            }
            vectors.push(vector);
        }
        return vectors;
    }

    /**
     * @description 生成原生实数曲线及其关键帧通道。
     * @param times 已验证的时间。
     * @param values 已验证的标量值。
     * @param interpolation 原生线性零或常量一枚举。
     * @returns 可序列化通道。
     */
    private static _channel(times: readonly number[], values: readonly number[], interpolation: number): Record<string, unknown> {
        return { __type__: 'cc.animation.Channel', _curve: {
            __type__: 'cc.RealCurve', _times: [...times],
            _values: values.map((value: number) => ({
                __type__: 'cc.RealKeyframeValue', value, interpolationMode: interpolation,
            })), preExtrapolation: 0, postExtrapolation: 0,
        } };
    }
}
