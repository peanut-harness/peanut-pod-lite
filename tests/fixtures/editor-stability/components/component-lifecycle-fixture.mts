import { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { ComponentSceneIntegrity } from './component-scene-integrity.mts';

/**
 * @description 字段和移除验证只能写入独立副本，原始展示场景保持可审阅。
 */
export class ComponentLifecycleFixture {
    /**
     * @description 深复制条目图并使用独立资产路径；场景meta由首次保存生成。
     * @param source 已装配的字段测试文档。
     * @param version 实际精确版本。
     * @param componentType 已审计类型。
     * @returns 独立可变测试副本。
     */
    public static create(source: LumenPrefabDocument, version: '3.8.3' | '3.8.7', componentType: string): LumenPrefabDocument {
        if (!/^cc\.[a-zA-Z0-9_.]+$|^(?:sp|dragonBones)\.[a-zA-Z0-9_]+$/u.test(componentType)) throw new Error('component_lifecycle_type_invalid');
        const document = new LumenPrefabDocument(`assets/components/_lifecycle/${componentType}.scene`,
            structuredClone([...source.entries]), new LumenComponentPropertySchema(LumenCocosVersion.parse(version)));
        ComponentSceneIntegrity.assert(document);
        return document;
    }
}
