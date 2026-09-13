/**
 * @description 解码 Prefab 内嵌条目与节点、组件引用。
 */
export class LumenComponentPropertyReferenceDecoder {
    /**
     * @description 解析 `__id__` 或内联对象。
     * @param raw 序列化值
     * @param resolveEntry 条目解析器
     * @returns 对象或 `null`
     */
    public resolveEmbeddedRaw(
        raw: unknown,
        resolveEntry?: (entryIndex: number) => Record<string, unknown> | null,
    ): Record<string, unknown> | null {
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const record = raw as Record<string, unknown>;
        if ('__id__' in record) {
            const id = record.__id__;
            if (typeof id !== 'number' || resolveEntry == null) {
                return null;
            }
            return resolveEntry(id);
        }
        return record;
    }

    /**
     * @description 将 `{ __id__ }` 解码为路径，组件引用附带类型。
     * @param raw 序列化引用
     * @param pathForNodeIndex 节点下标到路径的映射器
     * @param componentType 组件类型；节点引用时为 `null`
     * @returns 路径字符串、带类型对象或 `null`
     */
    public decodeIdRef(
        raw: unknown,
        pathForNodeIndex: (nodeIndex: number) => string | null,
        componentType: string | null,
    ): unknown {
        if (raw === null) {
            return null;
        }
        if (raw == null || typeof raw !== 'object' || !('__id__' in raw)) {
            return null;
        }
        const id = (raw as { __id__?: unknown }).__id__;
        if (typeof id !== 'number') {
            return null;
        }
        if (componentType == null) {
            return pathForNodeIndex(id);
        }
        const path = pathForNodeIndex(id);
        if (path == null) {
            return { componentType, index: id };
        }
        return { nodePath: path, componentType, index: id };
    }
}
