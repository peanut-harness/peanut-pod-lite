import type { LumenComponentPropertySchema } from '../schema/component-property';
import { LumenPrefabDocument } from './prefab-document';
import { LumenMaskSpriteFrameBinding } from './mask-sprite-frame-binding';
import { LumenEditBoxLabelBinding } from './editbox-label-binding';
import { LumenDeepClone } from './deep-clone';

/**
 * @description 统一受测原生组件载体映射入口，保持文档与属性codec的稳定职责边界。
 */
export class LumenNativeComponentBinding {
    /**
     * @description 原生角度、约束、粒子和动画的新映射先在独立内存文档校验，失败不改变真实文档或分配内嵌条目。
     * @param document 当前真实文档。
     * @param componentType 实际组件类型。
     * @param schema 精确版本属性表。
     * @param write 原codec写入流程，禁止外部副作用。
     */
    public static validate(document: LumenPrefabDocument, componentType: string, schema: LumenComponentPropertySchema, write: (target: LumenPrefabDocument) => void): void {
        if (!['3.8.3', '3.8.7'].includes(schema.version.toString()) ||
            !['cc.Billboard', 'cc.FixedConstraint', 'cc.HingeConstraint', 'cc.ParticleSystem',
                'cc.animation.AnimationController', 'dragonBones.ArmatureDisplay'].includes(componentType)) { return; }
        write(new LumenPrefabDocument(document.relativePath, LumenDeepClone.clone([...document.entries]), schema));
    }

    /**
     * @description 在任何实际载体赋值前委托组件自己的整补丁校验与所有权检查。
     * @param document 当前文档。
     * @param nodePath 自有节点路径。
     * @param componentType 实际组件类型。
     * @param patch 完整补丁。
     * @param schema 实际版本属性表。
     * @returns 是否已由载体映射处理。
     */
    public static apply(document: LumenPrefabDocument, nodePath: string, componentType: string, patch: Readonly<Record<string, unknown>>, schema: LumenComponentPropertySchema): boolean {
        return LumenMaskSpriteFrameBinding.apply(document, nodePath, componentType, patch, schema) ||
            LumenEditBoxLabelBinding.apply(document, nodePath, componentType, patch, schema);
    }

    /**
     * @description 保留Mask真实Sprite读取，并为EditBox委托其真实Label载体读取。
     * @param componentType 实际类型。
     * @param component 实际条目。
     * @param field 序列化字段。
     * @param version 实际版本。
     * @param resolveEntry 文档引用解析器。
     * @returns 实际载体字段或原字段。
     */
    public static readField(componentType: string, component: Readonly<Record<string, unknown>>, field: string, version: string, resolveEntry?: (index: number) => Record<string, unknown> | null): unknown {
        if (componentType === 'cc.EditBox') {
            return LumenEditBoxLabelBinding.readField(componentType, component, field, version, resolveEntry);
        }
        return LumenMaskSpriteFrameBinding.readField(componentType, component, field, version, resolveEntry);
    }
}
