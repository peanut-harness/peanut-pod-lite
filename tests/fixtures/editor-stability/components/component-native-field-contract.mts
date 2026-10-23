import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { LumenCuratedSchemaCatalog } from '../../../../packages/engine/modules/lumen/source/schema/catalog.ts';
import { LumenCocosVersion } from '../../../../packages/engine/modules/lumen/source/schema/cocos-version.ts';
import { LumenNativeComponentPropertySchema } from '../../../../packages/engine/modules/lumen/source/schema/native-component-property-schema.ts';
import type { ComponentFieldFixtures } from './component-field-fixtures.mts';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';
import { ComponentNativeGetterContract } from './component-native-getter-contract.mts';

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
            const specs = LumenNativeComponentPropertySchema.forVersion(version, row.componentType, catalog.componentFields(row.componentType) ?? []);
            return { ...row, cases: row.cases.map(field => {
                let nested = specs; const slots: string[] = []; let nativeBooleanEnum = false;
                for (const key of field.selector) {
                    const spec = nested.find(f => f.apiName === key); if (!spec) throw new Error('component_native_contract_spec_missing');
                    slots.push(spec.nativeReadName ?? spec.serializedName); nativeBooleanEnum = spec.nativeBooleanEnum === true; nested = spec.nestedFields ?? [];
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
                const modern = ComponentNativeGetterContract.resolve(engine, row.componentType, field.selector, declared);
                if (modern) { safeSelector = modern.selector; getterSource = modern.proof; }
                const carrier = this.editBoxCarrier(row.componentType, field.selector, engine, declarations);
                if (carrier) { safeSelector = carrier.selector; getterSource = carrier.proofs; }
                return { ...field, safeSelector, nativeBooleanEnum,
                    nativeSerializedSelector: proof && declared?.properties.some(p => p.name === slot) ? slots : null,
                    nativeSourceProof: proof ? { path: proof.reference, sha256: proof.sha256, declaredProperty: proof.name } : null, getterSource };
            }) };
        }) };
    }

    /**
     * @description 扁平EditBox样式沿源码已声明的公开Label载体读取，缺证明即停止。
     * @param componentType 已审计组件。
     * @param selector 公开目录路径。
     * @param engine 精确源码根。
     * @param declarations 全部已冻结声明。
     * @returns 已证明的公开getter路径，非载体字段返回null。
     */
    private static editBoxCarrier(componentType: string, selector: readonly string[], engine: string, declarations: readonly IComponentNativeDeclaration[]) {
        if (componentType !== 'cc.EditBox') { return null; }
        const routes: Readonly<Record<string, readonly [string, string]>> = {
            fontSize: ['textLabel', 'fontSize'], lineHeight: ['textLabel', 'lineHeight'], fontColor: ['textLabel', 'color'],
            placeholderFontSize: ['placeholderLabel', 'fontSize'], placeholderFontColor: ['placeholderLabel', 'color'],
        };
        const route = routes[selector[0] ?? ''];
        if (!route) { return null; }
        const proofs = route.map((getter, index) => {
            const type = index === 0 ? 'cc.EditBox' : 'cc.Label';
            const owner = declarations.find(d => d.type === type);
            const declaration = owner?.properties.find(p => p.name === getter || p.name === '_' + getter)
                ?? (owner?.sources.length === 1 ? owner.sources[0] : undefined);
            if (!declaration) { throw new Error('component_native_carrier_getter_missing:' + type + '.' + getter); }
            const bytes = readFileSync(join(engine, 'cocos', declaration.reference));
            if (createHash('sha256').update(bytes).digest('hex') !== declaration.sha256) { throw new Error('component_native_carrier_source_changed'); }
            const source = ts.createSourceFile(declaration.reference, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
            let found = false;
            const visit = (node: ts.Node): void => {
                if (ts.isGetAccessorDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === getter) { found = true; }
                ts.forEachChild(node, visit);
            };
            visit(source);
            if (!found) { throw new Error('component_native_carrier_not_getter'); }
            return { path: declaration.reference, sha256: declaration.sha256, getter };
        });
        return { selector: [...route, ...selector.slice(1)], proofs };
    }
}
