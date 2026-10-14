import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { LumenCuratedSchemaCatalog } from '../../../../packages/engine/modules/lumen/source/schema/catalog.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenNativeMeshPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/native-mesh-property-schema.ts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

/**
 * @description 从版本精确目录及源码声明生成原生只读访问白名单，避免会克隆资产的getter。
 */
export class ComponentNativeFieldContract {
    /**
     * @description 公开输入名保持原样；原生getter别名与序列化槽另记源码证明。
     * @param root 当前工作树。
     * @param engine 精确SDK源码根。
     * @param fields 完整字段矩阵。
     * @param declarations 已审计原生声明。
     * @returns 保留完整分母且有源码证明的原生访问契约。
     */
    public static create(root: string, engine: string, fields: ReturnType<typeof ComponentFieldFixtures.create>, declarations: readonly IComponentNativeDeclaration[]) {
        const catalog = new LumenCuratedSchemaCatalog(join(root, 'packages/engine/modules/lumen/bundled/schema'));
        const version = LumenCocosVersion.parse(fields.creatorVersion);
        return { ...fields, components: fields.components.map(row => {
            const declared = declarations.find(d => d.type === row.componentType);
            const specs = LumenNativeMeshPropertySchema.forVersion(version, row.componentType, catalog.componentFields(row.componentType) ?? []);
            return { ...row, cases: row.cases.map(field => {
                let nested = specs; const slots: string[] = []; let nativeBooleanEnum = false;
                for (const key of field.selector) {
                    const spec = nested.find(f => f.apiName === key); if (!spec) throw new Error('component_native_contract_spec_missing');
                    slots.push(spec.serializedName); nativeBooleanEnum = spec.nativeBooleanEnum === true; nested = spec.nestedFields ?? [];
                }
                const rootName = field.selector[0]; const slot = slots[0];
                const proof = declared?.properties.find(p => p.name === slot || p.name === rootName);
                const aliases: Record<string, string> = { materials: 'sharedMaterials', material: 'sharedMaterial',
                    enabledGlobalStandardSkinObject: 'isGlobalStandardSkinObject' };
                const alias = rootName ? aliases[rootName] : undefined;
                let safeSelector = field.selector;
                let getterSource: unknown = null;
                if (alias && proof) {
                    const bytes = readFileSync(join(engine, 'cocos', proof.reference));
                    if (createHash('sha256').update(bytes).digest('hex') !== proof.sha256) throw new Error('component_native_getter_source_changed');
                    const source = ts.createSourceFile(proof.reference, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
                    let found = false;
                    const visit = (node: ts.Node): void => {
                        if (ts.isGetAccessorDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === alias) found = true;
                        ts.forEachChild(node, visit);
                    };
                    visit(source);
                    if (found) { safeSelector = [alias, ...field.selector.slice(1)]; getterSource = { path: proof.reference, sha256: proof.sha256, getter: alias }; }
                }
                return { ...field, safeSelector, nativeBooleanEnum,
                    nativeSerializedSelector: proof && declared?.properties.some(p => p.name === slot) ? slots : null,
                    nativeSourceProof: proof ? { path: proof.reference, sha256: proof.sha256, declaredProperty: proof.name } : null, getterSource };
            }) };
        }) };
    }
}
