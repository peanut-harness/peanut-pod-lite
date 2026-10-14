import { join } from 'node:path';
import { LumenCuratedSchemaCatalog } from '../../../../packages/engine/modules/lumen/source/schema/catalog.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenNativeMeshPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/native-mesh-property-schema.ts';
import { LumenComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/component-property.ts';
import type { ILumenPropertyDescriptor } from '../../../../packages/engine/modules/lumen/source/schema/component-property-contracts.ts';
import type { ILumenPropertyFieldSpec } from '../../../../packages/engine/modules/lumen/source/schema/component-property-contracts.ts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';
import { ComponentDependencyPlanner } from './component-dependency-plan.mts';
import { ComponentValueRecipeFactory } from './component-value-recipe.mts';
import type { IComponentValueRecipe } from './component-value-recipe.mts';
import { ComponentResourceBindings } from './component-resource-bindings.mts';
import { ComponentContextValues } from './component-context-values.mts';
import { ComponentAssemblyRequirements } from './component-assembly-requirements.mts';

/**
 * @description 组件与全部公开字段的可执行输入配方；资源身份和原生加载仍需实机端口证明。
 */
export class ComponentFieldFixtures {
    /**
     * @description 为完整目录装配值和真实依赖，任何字段无法准备都直接失败而非生成占位。
     * @param root 当前工作树。
     * @param version 单一精确版本。
     * @param declarations 当前版本原生源码证明。
     * @returns 完整输入配方与未验证的原生后验约束。
     */
    public static create(root: string, version: '3.8.3' | '3.8.7', declarations: readonly IComponentNativeDeclaration[]) {
        const catalog = new LumenCuratedSchemaCatalog(join(root, 'packages/engine/modules/lumen/bundled/schema'));
        const resources = ComponentResourceBindings.create(root, version);
        const context = ComponentContextValues.create(root, resources);
        const publicSchema = new LumenComponentPropertySchema(LumenCocosVersion.parse(version), catalog);
        const components = catalog.listComponentTypes().slice().sort().map((componentType) => {
            const declared = catalog.componentFields(componentType);
            if (!declared) throw new Error(`component_fixture_catalog_missing:${componentType}`);
            const fields = LumenNativeMeshPropertySchema.forVersion(LumenCocosVersion.parse(version), componentType, declared);
            const cases: { id: string; selector: string[]; kind: string; rootValue: IComponentValueRecipe;
                validValue: IComponentValueRecipe; invalidValue: unknown; sourceOrigin: 'static-recipe'; nativeAcceptance: false;
                expectedWrite: 'set-and-readback' | 'reject-version-gate' | 'reject-native-persistence'; refusalReason: string | null }[] = [];
            const descriptors = publicSchema.describeComponent(componentType);
            const descriptorAt = (selector: readonly string[]): ILumenPropertyDescriptor | undefined => {
                let fields = descriptors; let result: ILumenPropertyDescriptor | undefined;
                for (const name of selector) { result = fields.find((field) => field.apiName === name); fields = result?.nestedProps ?? []; }
                return result;
            };
            for (const field of fields) {
                const rootValue = ComponentValueRecipeFactory.create(field, componentType, declarations, resources, context);
                const visit = (spec: ILumenPropertyFieldSpec, owner: string, selector: readonly string[]): void => {
                    const value = ComponentValueRecipeFactory.create(spec, owner, declarations, resources, context);
                    const descriptor = descriptorAt(selector);
                    const versionGated = !publicSchema.listSupportedComponents().includes(componentType) || !descriptor;
                    cases.push({ id: `field:component:${componentType}:${selector.join(':')}`, selector: [...selector], kind: spec.kind,
                        rootValue, validValue: value, invalidValue: ComponentValueRecipeFactory.invalid(spec),
                        expectedWrite: versionGated ? 'reject-version-gate' : descriptor?.writable === false ? 'reject-native-persistence' : 'set-and-readback',
                        refusalReason: versionGated ? 'product-version-boundary' : descriptor?.writeRefusedReason ?? null,
                        sourceOrigin: 'static-recipe', nativeAcceptance: false });
                    for (const nested of spec.nestedFields ?? []) {
                        if (!spec.embeddedType) throw new Error('component_fixture_nested_owner_missing');
                        visit(nested, spec.embeddedType, [...selector, nested.apiName]);
                    }
                };
                visit(field, componentType, [field.apiName]);
            }
            if (new Set(cases.map((row) => row.id)).size !== cases.length) throw new Error('component_fixture_case_duplicate');
            const declaration = declarations.find((row) => row.type === componentType);
            return { componentType, nodePath: '/Root/Target', dependencyProviders: { 'cc.UIRenderer': 'cc.Sprite' },
                dependencyPlan: ComponentDependencyPlanner.create(componentType, declarations, { 'cc.UIRenderer': 'cc.Sprite' }),
                assemblyRequirements: ComponentAssemblyRequirements.create(componentType, declaration),
                lifecycleActions: ['add', 'get', 'set', 'bind', 'remove', 'save', 'reopen'],
                nativeReadbackRequired: true, cases };
        });
        return { schemaVersion: 'peanut.component-field-fixtures.v1', creatorVersion: version,
            componentCount: components.length, fieldCount: components.reduce((count, row) => count + row.cases.length, 0),
            nativePassedRows: 0, resources, components,
            acceptanceRule: '先完成真实装配与源导入再执行字段用例；public API、Creator 原生读回及原始日志都须通过，配方本身不是实机证据' };
    }
}
