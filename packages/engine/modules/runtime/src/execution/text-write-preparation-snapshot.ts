import { types as nodeTypes } from 'node:util';

/**
 * @description 有界的原始 own-data 引用快照；不调用 getter、代理 trap 或序列化用户内容。
 */
export class TextWritePreparationSnapshot {
    /**
     * @description 捕获原请求、payload、输入及公开控制数组的完整有限数据引用图。
     * @param input 原受理文本输入。
     * @param request 原受理任务请求。
     * @returns 有界数据属性快照；不可信对象、循环或超限输入返回 null。
     */
    public static capture(input: unknown, request: object): readonly {
        object: object; keys: readonly string[]; values: readonly unknown[];
    }[] | null {
        if (input == null || typeof input !== 'object' || Array.isArray(input)
            || nodeTypes.isProxy(input) || nodeTypes.isProxy(request)) return null;
        const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
        if (payload == null || typeof payload !== 'object' || Array.isArray(payload) || nodeTypes.isProxy(payload)
            || Object.getOwnPropertyDescriptor(payload, 'input')?.value !== input) return null;
        const files: unknown = Object.getOwnPropertyDescriptor(input, 'files')?.value;
        if (files != null) {
            if (!Array.isArray(files) || nodeTypes.isProxy(files) || files.length < 1 || files.length > 32) return null;
            for (let index = 0; index < files.length; index += 1) {
                const file: unknown = Object.getOwnPropertyDescriptor(files, index)?.value;
                if (file == null || typeof file !== 'object' || Array.isArray(file) || nodeTypes.isProxy(file)) return null;
            }
        }
        const rows: { object: object; keys: string[]; values: unknown[] }[] = [];
        const visited = new Set<object>();
        const active = new Set<object>();
        const capture = (object: object, depth: number): boolean => {
            if (active.has(object) || nodeTypes.isProxy(object) || depth > 8) return false;
            if (visited.has(object)) return true;
            if (visited.size >= 128) return false;
            const keys = Reflect.ownKeys(object);
            if (keys.length > 64 || keys.some((key) => typeof key !== 'string')) return false;
            visited.add(object);
            active.add(object);
            const values: unknown[] = [];
            for (const key of keys) {
                const descriptor = Object.getOwnPropertyDescriptor(object, key);
                if (descriptor == null || !('value' in descriptor)) return false;
                const value: unknown = descriptor.value;
                if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
                    || typeof value === 'number' && !Number.isFinite(value)) return false;
                if (value != null && typeof value === 'object' && !capture(value, depth + 1)) return false;
                values.push(value);
            }
            rows.push({ object, keys: keys as string[], values });
            active.delete(object);
            return true;
        };
        // Include original public control arrays as well as file records; every nested own-data reference stays bound.
        if (!capture(request, 0)) return null;
        return rows;
    }


    /**
     * @description 验证所有原嵌套引用及数据属性未在受理后替换或改变。
     * @param snapshot 原准备阶段快照。
     * @returns 原数据图仍精确匹配时返回 true。
     */
    public static matches(snapshot: readonly {
        object: object; keys: readonly string[]; values: readonly unknown[];
    }[]): boolean {
        return snapshot.every((row) => {
            if (nodeTypes.isProxy(row.object)) return false;
            const keys = Reflect.ownKeys(row.object);
            return keys.length === row.keys.length && keys.every((key, index) => key === row.keys[index]
                && Object.getOwnPropertyDescriptor(row.object, key)?.value === row.values[index]
                && Object.getOwnPropertyDescriptor(row.object, key)?.get == null
                && Object.getOwnPropertyDescriptor(row.object, key)?.set == null);
        });
    }

}
