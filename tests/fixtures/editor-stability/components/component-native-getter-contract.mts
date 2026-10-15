import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { IComponentNativeDeclaration } from './component-native-source-reader.mts';

/**
 * @description 为已发现的弃用getter提供源码证明的现代读取路径，缺少证明时拒绝生成探针契约。
 */
export class ComponentNativeGetterContract {
    /**
     * @description 只登记已核对的组件别名，避免把Camera.color规则应用到其它组件。
     */
    private static readonly _aliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
        'cc.Camera': { color: 'clearColor', depth: 'clearDepth', stencil: 'clearStencil' },
        'cc.ParticleSystem': { enableCulling: 'dataCulling' },
    };

    /**
     * @description 弃用表的精确SDK相对路径，只有静态转发规则匹配才采用别名。
     */
    private static readonly _deprecationFiles: Readonly<Record<string, string>> = {
        'cc.Camera': 'misc/deprecated.ts', 'cc.ParticleSystem': 'particle/deprecated.ts',
    };

    /**
     * @description 验证实际getter和弃用转发声明，保留原公开字段名与独立读取证明。
     * @param engine 精确SDK引擎根。
     * @param componentType 已审计组件。
     * @param selector 原公开字段路径。
     * @param declaration 已冻结的原生声明。
     * @returns 现代getter路径及证明；无此别名时返回null。
     */
    public static resolve(engine: string, componentType: string, selector: readonly string[], declaration: IComponentNativeDeclaration | undefined) {
        const original = selector[0] ?? ''; const alias = this._aliases[componentType]?.[original];
        if (!alias) { return null; }
        const proof = declaration?.properties.find(p => [alias, '_' + alias, original, '_' + original].includes(p.name));
        if (!proof) { throw new Error('component_native_modern_getter_source_missing:' + componentType + '.' + original); }
        const bytes = readFileSync(join(engine, 'cocos', proof.reference));
        if (this.hash(bytes) !== proof.sha256) { throw new Error('component_native_modern_getter_source_changed'); }
        const source = ts.createSourceFile(proof.reference, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
        let getterFound = false;
        const visitGetter = (node: ts.Node): void => {
            if (ts.isClassDeclaration(node) && node.name?.text === componentType.slice(3)) {
                getterFound = node.members.some(member => ts.isGetAccessorDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === alias);
            }
            ts.forEachChild(node, visitGetter);
        };
        visitGetter(source);
        if (!getterFound) { throw new Error('component_native_modern_getter_missing:' + alias); }
        const relative = this._deprecationFiles[componentType];
        if (!relative) { throw new Error('component_native_deprecation_source_missing'); }
        const deprecated = readFileSync(join(engine, 'cocos', relative));
        const deprecatedSource = ts.createSourceFile(relative, deprecated.toString('utf8'), ts.ScriptTarget.Latest, true);
        let forwardFound = false;
        const visitAlias = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'replaceProperty'
                && node.arguments[0]?.getText(deprecatedSource) === componentType.slice(3) + '.prototype') {
                const entries = node.arguments[2];
                if (entries && ts.isArrayLiteralExpression(entries)) {
                    forwardFound = entries.elements.some(entry => this.matchesAlias(entry, original, alias));
                }
            }
            ts.forEachChild(node, visitAlias);
        };
        visitAlias(deprecatedSource);
        if (!forwardFound) { throw new Error('component_native_deprecation_forward_missing:' + original); }
        return { selector: [alias, ...selector.slice(1)], proof: { path: proof.reference, sha256: proof.sha256, getter: alias,
            deprecation: { path: relative, sha256: this.hash(deprecated), original, replacement: alias } } };
    }

    /**
     * @description 只接受replaceProperty实际数组中的明确字符串转发条目。
     * @param node 数组条目。
     * @param original 旧属性。
     * @param alias 新属性。
     * @returns 条目是否精确匹配。
     */
    private static matchesAlias(node: ts.Node, original: string, alias: string): boolean {
        if (!ts.isObjectLiteralExpression(node)) { return false; }
        const values = new Map(node.properties.flatMap(property => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)
            && ts.isStringLiteral(property.initializer) ? [[property.name.text, property.initializer.text] as const] : []));
        return values.get('name') === original && values.get('newName') === alias;
    }

    /**
     * @description 固定SHA256用于审计实际读取的源码字节。
     * @param bytes 实际源码。
     * @returns 十六进制摘要。
     */
    private static hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
}
