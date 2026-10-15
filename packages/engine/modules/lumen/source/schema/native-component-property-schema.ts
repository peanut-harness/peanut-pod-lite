import { LumenCocosVersion } from './cocos-version';
import type { ILumenPropertyFieldSpec } from './component-property-contracts';
import { LumenNativeMeshPropertySchema } from './native-mesh-property-schema';

/**
 * @description 装配精确版本的原生字段映射，保留公开目录与未知版本行为。
 */
export class LumenNativeComponentPropertySchema {
    /**
     * @description JSON名字遵循版本精确的formerlySerializedAs，原生读取仍使用实际成员。
     */
    private static readonly _serializedNames: Readonly<Record<string, Readonly<Record<string, string>>>> = {
        'cc.FixedConstraint': { breakForce: 'breakForce', breakTorque: 'breakTorque' },
        'cc.HingeConstraint': { pivotA: 'pivotA', pivotB: 'pivotB', axis: 'axisA', limit: 'limitData', motor: 'motorData' },
        'cc.ParticleSystem': { dataCulling: 'enableCulling' },
        'cc.TextureAnimationModule': { numTilesX: 'numTilesX', numTilesY: 'numTilesY' },
        'cc.animation.AnimationController': { graph: 'graph' },
        'dragonBones.ArmatureDisplay': { playTimes: 'playTimes' },
    };

    /**
     * @description 只对源码一致的3.8.3/3.8.7应用单位和持久化名字适配，不改变公开字段数量。
     * @param version 实际Creator版本。
     * @param componentType 实际组件类型。
     * @param fields 策展字段。
     * @returns 含原生编码标记的内部规格。
     */
    public static forVersion(version: LumenCocosVersion, componentType: string, fields: readonly ILumenPropertyFieldSpec[]): readonly ILumenPropertyFieldSpec[] {
        const mesh = LumenNativeMeshPropertySchema.forVersion(version, componentType, fields);
        if (!['3.8.3', '3.8.7'].includes(version.toString())) { return mesh; }
        const names = this._serializedNames[componentType];
        return mesh.map(field => {
            if (field.embeddedType != null && field.nestedFields != null) {
                field = { ...field, nestedFields: this.forVersion(version, field.embeddedType, field.nestedFields) };
            }
            if (componentType === 'cc.Billboard' && field.apiName === 'rotation') {
                return { ...field, nativeAngleDegrees: true };
            }
            const serializedName = names?.[field.apiName];
            if (serializedName == null) { return field; }
            const nestedFields = field.nestedFields?.map(nested => ({ ...nested,
                serializedName: nested.apiName, nativeReadName: nested.serializedName }));
            const nativeReadName = componentType === 'dragonBones.ArmatureDisplay' && field.apiName === 'playTimes'
                ? 'playTimes' : field.serializedName;
            return { ...field, serializedName, nativeReadName,
                ...(nestedFields != null ? { nestedFields } : {}) };
        });
    }
}
