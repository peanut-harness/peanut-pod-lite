import { ResourceStabilityNativeRuntime } from './resource-stability-native-runtime.mts';

/**
 * @description 冻结八类夹具的私有输入派生；仅修改已核类型的真正根_name，不遍历或改写子对象。
 */
export class ResourceStabilityNativeFixture {
    /**
     * @description 对象根或序列化数组首根均核对固定kind/type；二进制Terrain逐字节保留。
     */
    public static prepare(kind: string, source: Buffer, name: string, initial: Readonly<Record<string, unknown>>): {
        source: Buffer; initial: Record<string, unknown>;
    } {
        if (!ResourceStabilityNativeRuntime.kinds.includes(kind)) throw new Error('resource_native_fixture_kind_invalid');
        if (!/^[a-zA-Z0-9_-]+$/u.test(name)) throw new Error('resource_native_fixture_name_invalid');
        if (kind === 'terrain') {
            if (Object.hasOwn(initial, '/name')) throw new Error('resource_native_fixture_binary_name_unsupported');
            return { source: Buffer.from(source), initial: { ...initial } };
        }
        const data: unknown = JSON.parse(source.toString('utf8'));
        const root: unknown = Array.isArray(data) ? data[0] : data;
        if (!root || typeof root !== 'object' || Array.isArray(root)
            || (root as Record<string, unknown>).__type__ !== ResourceStabilityNativeRuntime.typeForKind(kind)) {
            throw new Error('resource_native_fixture_root_type_mismatch');
        }
        const object = root as Record<string, unknown>;
        const hasName = Object.hasOwn(object, '_name');
        if (hasName && typeof object._name !== 'string' || Object.hasOwn(initial, '/name') && !hasName) {
            throw new Error('resource_native_fixture_root_name_missing');
        }
        if (hasName) object._name = name;
        return { source: hasName ? Buffer.from(JSON.stringify(data)) : Buffer.from(source),
            initial: Object.hasOwn(initial, '/name') ? { ...initial, '/name': name } : { ...initial } };
    }
}
