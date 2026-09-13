/**
 * @description 将公开属性值校验并转换为 Cocos 可序列化值。
 */
export class LumenComponentPropertyValueParser {
    /**
     * @description 从 RealCurve 读回简易关键帧。
     * @param spline 内嵌曲线
     * @returns 关键帧列表；无法识别时为 `null`
     */
    public decodeRealCurveKeys(spline: unknown): readonly { readonly time: number; readonly value: number }[] | null {
        if (spline == null || typeof spline !== 'object' || Array.isArray(spline)) {
            return null;
        }
        const record = spline as Record<string, unknown>;
        const times = record._times;
        const values = record._values;
        if (!Array.isArray(times) || !Array.isArray(values) || times.length === 0 || times.length !== values.length) {
            return null;
        }
        const keys: Array<{ readonly time: number; readonly value: number }> = [];
        for (const [index, timeRaw] of times.entries()) {
            if (typeof timeRaw !== 'number') {
                return null;
            }
            const valueRaw = values[index];
            let value = 0;
            if (typeof valueRaw === 'number') {
                value = valueRaw;
            } else if (valueRaw != null && typeof valueRaw === 'object' && !Array.isArray(valueRaw)) {
                const frame = valueRaw as Record<string, unknown>;
                if (typeof frame.value !== 'number') {
                    return null;
                }
                value = frame.value;
            } else {
                return null;
            }
            keys.push({ time: timeRaw, value });
        }
        return keys;
    }

    /**
     * @description 从 Gradient 读回颜色关键帧。
     * @param gradient 内嵌渐变
     * @returns 颜色关键帧列表；无法识别时为 `null`
     */
    public decodeGradientColorKeys(gradient: unknown): readonly Record<string, unknown>[] | null {
        if (gradient == null || typeof gradient !== 'object' || Array.isArray(gradient)) {
            return null;
        }
        const record = gradient as Record<string, unknown>;
        const colorKeys = record.colorKeys;
        if (!Array.isArray(colorKeys) || colorKeys.length === 0) {
            return null;
        }
        const decoded: Array<Record<string, unknown>> = [];
        for (const item of colorKeys) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                return null;
            }
            const frame = item as Record<string, unknown>;
            decoded.push({
                time: typeof frame.time === 'number' ? frame.time : 0,
                color: frame.color,
            });
        }
        return decoded;
    }

    /**
     * @description 解析有限数字。
     * @param value 输入值
     * @param apiName 属性名
     * @returns 已验证数字
     */
    public asNumber(value: unknown, apiName: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`lumen_property_type:${apiName}:number`);
        }
        return value;
    }

    /**
     * @description 解析 Size。
     * @param value 输入值
     * @returns Size 对象
     */
    public asSize(value: unknown): { __type__: 'cc.Size'; width: number; height: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            const width = record.width;
            const height = record.height;
            if (typeof width === 'number' && typeof height === 'number') {
                return { __type__: 'cc.Size', width, height };
            }
        }
        throw new Error('lumen_property_type:size:{width,height}');
    }

    /**
     * @description 解析 Vec2。
     * @param value 输入值
     * @returns Vec2 对象
     */
    public asVec2(value: unknown): { __type__: 'cc.Vec2'; x: number; y: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (typeof record.x === 'number' && typeof record.y === 'number') {
                return { __type__: 'cc.Vec2', x: record.x, y: record.y };
            }
        }
        throw new Error('lumen_property_type:vec2:{x,y}');
    }

    /**
     * @description 解析 Vec3。
     * @param value 输入值
     * @returns Vec3 对象
     */
    public asVec3(value: unknown): { __type__: 'cc.Vec3'; x: number; y: number; z: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (typeof record.x === 'number' && typeof record.y === 'number' && typeof record.z === 'number') {
                return { __type__: 'cc.Vec3', x: record.x, y: record.y, z: record.z };
            }
        }
        throw new Error('lumen_property_type:vec3:{x,y,z}');
    }

    /**
     * @description 解析 Rect。
     * @param value 输入值
     * @returns Rect 对象
     */
    public asRect(value: unknown): { __type__: 'cc.Rect'; x: number; y: number; width: number; height: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (
                typeof record.x === 'number' &&
                typeof record.y === 'number' &&
                typeof record.width === 'number' &&
                typeof record.height === 'number'
            ) {
                return {
                    __type__: 'cc.Rect',
                    x: record.x,
                    y: record.y,
                    width: record.width,
                    height: record.height,
                };
            }
        }
        throw new Error('lumen_property_type:rect:{x,y,width,height}');
    }

    /**
     * @description 解析 Color。
     * @param value 输入值
     * @returns Color 对象
     */
    public asColor(value: unknown): { __type__: 'cc.Color'; r: number; g: number; b: number; a: number } {
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const record = value as Record<string, unknown>;
            if (
                typeof record.r === 'number' &&
                typeof record.g === 'number' &&
                typeof record.b === 'number' &&
                typeof record.a === 'number'
            ) {
                return { __type__: 'cc.Color', r: record.r, g: record.g, b: record.b, a: record.a };
            }
        }
        throw new Error('lumen_property_type:color:{r,g,b,a}');
    }

    /**
     * @description 解析资源 UUID 引用，`null` 表示清空引用。
     * @param value 字符串 UUID、已有引用对象或 `null`
     * @param apiName 属性名
     * @returns UUID 引用或 `null`
     */
    public asUuidRef(value: unknown, apiName: string): { __uuid__: string } | null {
        if (value === null) {
            return null;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            return { __uuid__: value };
        }
        if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            const uuid = (value as { __uuid__?: unknown }).__uuid__;
            if (typeof uuid === 'string' && uuid.length > 0) {
                return { __uuid__: uuid };
            }
        }
        throw new Error(`lumen_property_type:${apiName}:uuid`);
    }

    /**
     * @description 解析 UUID 引用列表。
     * @param value 字符串数组、引用对象数组或单个 UUID
     * @param apiName 属性名
     * @returns UUID 引用列表
     */
    public asUuidList(value: unknown, apiName: string): Array<{ __uuid__: string }> {
        if (typeof value === 'string' || (value != null && typeof value === 'object' && !Array.isArray(value))) {
            const item = this.asUuidRef(value, apiName);
            if (item == null) {
                throw new Error(`lumen_property_type:${apiName}:uuidList`);
            }
            return [item];
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:uuidList`);
        }
        return value.map((entry, index) => {
            const item = this.asUuidRef(entry, `${apiName}[${index}]`);
            if (item == null) {
                throw new Error(`lumen_property_type:${apiName}[${index}]:uuid`);
            }
            return item;
        });
    }

    /**
     * @description 解析 Vec2 点列。
     * @param value Vec2 数组
     * @param apiName 属性名
     * @returns 引擎序列化点列
     */
    public asVec2List(value: unknown, apiName: string): Array<{ __type__: 'cc.Vec2'; x: number; y: number }> {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:vec2List`);
        }
        return value.map((item, index) => {
            try {
                return this.asVec2(item);
            } catch {
                throw new Error(`lumen_property_type:${apiName}[${index}]:vec2`);
            }
        });
    }

    /**
     * @description 解析 Vec3 点列。
     * @param value Vec3 数组
     * @param apiName 属性名
     * @returns 引擎序列化点列
     */
    public asVec3List(value: unknown, apiName: string): Array<{ __type__: 'cc.Vec3'; x: number; y: number; z: number }> {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`lumen_property_type:${apiName}:vec3List`);
        }
        return value.map((item, index) => {
            try {
                return this.asVec3(item);
            } catch {
                throw new Error(`lumen_property_type:${apiName}[${index}]:vec3`);
            }
        });
    }

    /**
     * @description 解析字符串列表。
     * @param value 字符串数组
     * @param apiName 属性名
     * @returns 字符串数组
     */
    public asStringList(value: unknown, apiName: string): string[] {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:stringList`);
        }
        return value.map((item, index) => {
            if (typeof item !== 'string') {
                throw new Error(`lumen_property_type:${apiName}[${index}]:string`);
            }
            return item;
        });
    }

    /**
     * @description 解析数字列表。
     * @param value 数字数组
     * @param apiName 属性名
     * @returns 数字数组
     */
    public asNumberList(value: unknown, apiName: string): number[] {
        if (!Array.isArray(value)) {
            throw new Error(`lumen_property_type:${apiName}:numberList`);
        }
        return value.map((item, index) => this.asNumber(item, `${apiName}[${index}]`));
    }
}
