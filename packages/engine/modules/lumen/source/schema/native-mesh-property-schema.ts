import { LumenCocosVersion } from './cocos-version';
import type { ILumenPropertyFieldSpec } from './component-property-contracts';

/**
 * @description 已核对版本的 MeshRenderer 内嵌烘焙设置，保留公开十二字段目录。
 */
export class LumenNativeMeshPropertySchema {
    /**
     * @description 为合法 ModelBakeSettings 声明原生类型及公开属性的序列化名字。
     * @param version 真实会话 Creator 版本。
     * @param componentType 组件类型。
     * @param fields 原字段目录。
     * @returns 保留原目录的字段规格；未知版本不作原生能力外推。
     */
    public static forVersion(
        version: LumenCocosVersion,
        componentType: string,
        fields: readonly ILumenPropertyFieldSpec[],
    ): readonly ILumenPropertyFieldSpec[] {
        if (componentType !== 'cc.MeshRenderer' || !['3.8.3', '3.8.7'].includes(version.toString())) {
            return fields;
        }
        const nested: readonly ILumenPropertyFieldSpec[] = [
            { apiName: 'bakeable', serializedName: '_bakeable', kind: 'boolean' },
            { apiName: 'castShadow', serializedName: '_castShadow', kind: 'boolean' },
            { apiName: 'receiveShadow', serializedName: '_receiveShadow', kind: 'boolean' },
            { apiName: 'lightmapSize', serializedName: '_lightmapSize', kind: 'number' },
            { apiName: 'useLightProbe', serializedName: '_useLightProbe', kind: 'boolean' },
            { apiName: 'bakeToLightProbe', serializedName: '_bakeToLightProbe', kind: 'boolean' },
            { apiName: 'reflectionProbe', serializedName: '_reflectionProbeType', kind: 'enum' },
            { apiName: 'bakeToReflectionProbe', serializedName: '_bakeToReflectionProbe', kind: 'boolean' },
        ];
        return fields.map(field => this._nativeField(field, nested));
    }

    /**
     * @description 编码已明确标记的布尔原生枚举，其余组件和脚本布尔值保持原样。
     * @param spec 当前字段规格。
     * @param value 已完成原有布尔类型验证的值。
     * @returns 原生 0 / 1 或原布尔值。
     */
    public static encodeBoolean(spec: ILumenPropertyFieldSpec, value: boolean): boolean | number {
        return spec.nativeBooleanEnum === true ? (value ? 1 : 0) : value;
    }

    /**
     * @description 只把已标记字段的精确 0 / 1 解为布尔值，不猜测未知原生值。
     * @param spec 当前字段规格。
     * @param value 原始序列化值。
     * @returns 公开布尔值或未归一化的原始值。
     */
    public static decodeBoolean(spec: ILumenPropertyFieldSpec, value: unknown): unknown {
        if (spec.nativeBooleanEnum === true && (value === 0 || value === 1)) {
            return value === 1;
        }
        return value;
    }

    /**
     * @description 保留完整目录并映射接收阴影枚举及合法烘焙内嵌类型。
     * @param field 原字段规格。
     * @param nested 已验证的烘焙字段。
     * @returns 对应原生持久化规格。
     */
    private static _nativeField(
        field: ILumenPropertyFieldSpec,
        nested: readonly ILumenPropertyFieldSpec[],
    ): ILumenPropertyFieldSpec {
        if (field.apiName === 'receiveShadow') {
            return { ...field, serializedName: '_shadowReceivingMode', nativeBooleanEnum: true };
        }
        return field.apiName === 'bakeSettings'
            ? { ...field, embeddedType: 'cc.ModelBakeSettings', nestedFields: nested }
            : field;
    }
}
