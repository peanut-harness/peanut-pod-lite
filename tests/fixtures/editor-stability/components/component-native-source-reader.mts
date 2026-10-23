import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { CreatorRegistrationNameReader } from '../../../../tools/editor-stability/creator-registration-name-reader.mts';

/**
 * @description 原生声明证据；声明存在不代表组件已经通过 Creator 加载。
 */
export interface IComponentNativeDeclaration {
    /**
     * @description 注册名。
     */
    readonly type: string;
    /**
     * @description 同名分支的全部源码定位和摘要。
     */
    readonly sources: readonly { readonly reference: string; readonly sha256: string; readonly line: number }[];
    /**
     * @description 继承链上可静态确认的 requireComponent 依赖。
     */
    readonly requiredComponents: readonly string[];
    /**
     * @description 依赖装饰器的真实定位，包含继承来源。
     */
    readonly dependencyProofs: readonly { readonly componentType: string; readonly reference: string; readonly line: number; readonly sha256: string }[];
    /**
     * @description 原生注册父类，用于确认资源子类型和组件归属。
     */
    readonly baseTypes: readonly string[];
    /**
     * @description 不能静态确认的依赖表达式；有此项时不能宣称依赖闭合。
     */
    readonly unresolvedDependencies: readonly { readonly reference: string; readonly line: number; readonly expression: string }[];
    /**
     * @description 原生属性类型和定位；包含继承属性，供独立字段夹具选择引用类型。
     */
    readonly properties: readonly { readonly name: string; readonly type: string; readonly reference: string; readonly line: number;
        readonly sha256: string; readonly registeredTypes: readonly string[]; readonly numericEnumValues: readonly number[] }[];
    /**
     * @description 未经运行时验证的声明分类。
     */
    readonly classification: 'source-declared-runtime-unverified';
}

/**
 * @description 从指定版本源码提取 requireComponent 与继承依赖，不执行引擎模块。
 */
export class ComponentNativeSourceReader {
    /**
     * @description 对全部原生注册类构造来源与依赖证明，保留同名分支和未解析表达式。
     * @param cocosRoot 已核对版本的 cocos 实现源码目录。
     * @returns 注册名到声明证明；调用方独立与策展分母核对。
     */
    public static read(cocosRoot: string): readonly IComponentNativeDeclaration[] {
        const files = this.files(cocosRoot).sort();
        const program = ts.createProgram(files, { noEmit: true, skipLibCheck: true, experimentalDecorators: true,
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] });
        const checker = program.getTypeChecker();
        const hashes = new Map<string, string>();
        const sourceHash = (file: string): string => {
            const cached = hashes.get(file);
            if (cached) return cached;
            const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
            hashes.set(file, hash); return hash;
        };
        const names = new Map<ts.ClassLikeDeclaration, string>();
        for (const file of files) {
            const source = program.getSourceFile(file);
            if (!source) throw new Error('component_native_source_missing');
            const visit = (node: ts.Node): void => {
                if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && ts.canHaveDecorators(node)) {
                    for (const decorator of ts.getDecorators(node) ?? []) {
                        const call = decorator.expression;
                        if (ts.isCallExpression(call) && this.decoratorName(call.expression, checker) === 'ccclass' && call.arguments[0]) {
                            const name = CreatorRegistrationNameReader.read(call.arguments[0], checker);
                            if (name !== null) names.set(node, name);
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
        const byName = new Map<string, ts.ClassLikeDeclaration[]>();
        for (const [node, name] of names) byName.set(name, [...(byName.get(name) ?? []), node]);
        return [...byName].sort(([a], [b]) => a.localeCompare(b)).map(([type, nodes]) => {
            const required = new Set<string>();
            const dependencyProofs: { componentType: string; reference: string; line: number; sha256: string }[] = [];
            const unresolved: { reference: string; line: number; expression: string }[] = [];
            const seen = new Set<ts.ClassLikeDeclaration>();
            const visitClass = (node: ts.ClassLikeDeclaration): void => {
                if (seen.has(node)) return;
                if (seen.size >= 128) throw new Error('component_native_inheritance_budget');
                seen.add(node);
                const source = node.getSourceFile();
                const reference = relative(cocosRoot, source.fileName).split('\\').join('/');
                for (const decorator of ts.getDecorators(node) ?? []) {
                    const call = decorator.expression;
                    if (!ts.isCallExpression(call) || this.decoratorName(call.expression, checker) !== 'requireComponent') continue;
                    const first = call.arguments[0];
                    const argumentsList = first && ts.isArrayLiteralExpression(first) ? first.elements : call.arguments;
                    if (argumentsList.length === 0) unresolved.push({ reference,
                        line: source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1, expression: call.getText(source) });
                    for (const argument of argumentsList) {
                        const candidates = this.classes(argument, checker);
                        const resolved = candidates.map((candidate) => names.get(candidate));
                        if (resolved.length === 0 || resolved.some((name) => name === undefined)) {
                            unresolved.push({ reference, line: source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1,
                                expression: argument.getText(source) });
                        } else for (const name of resolved) if (name) {
                            required.add(name);
                            dependencyProofs.push({ componentType: name, reference,
                                line: source.getLineAndCharacterOfPosition(argument.getStart(source)).line + 1, sha256: sourceHash(source.fileName) });
                        }
                    }
                }
                for (const clause of node.heritageClauses ?? []) {
                    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
                        for (const base of clause.types) for (const candidate of this.classes(base.expression, checker)) visitClass(candidate);
                    }
                }
                const inheritedTypes = new Set<ts.Type>();
                const visitBaseType = (value: ts.Type, depth: number): void => {
                    if (inheritedTypes.has(value) || depth > 100) return;
                    inheritedTypes.add(value);
                    for (const declaration of value.getSymbol()?.declarations ?? []) {
                        if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) visitClass(declaration);
                    }
                    if (value.isIntersection()) value.types.forEach((part) => visitBaseType(part, depth + 1));
                    if (value.isClassOrInterface()) checker.getBaseTypes(value).forEach((base) => visitBaseType(base, depth + 1));
                };
                const currentType = checker.getTypeAtLocation(node.name ?? node);
                if (currentType.isClassOrInterface()) checker.getBaseTypes(currentType).forEach((base) => visitBaseType(base, 0));
            };
            nodes.forEach(visitClass);
            const properties = nodes.flatMap((node) => checker.getPropertiesOfType(checker.getTypeAtLocation(node.name ?? node))
                .flatMap((symbol) => {
                    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
                    if (!declaration || !declaration.getSourceFile().fileName.startsWith(cocosRoot)) return [];
                    const source = declaration.getSourceFile();
                    const valueType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
                    const registeredTypes = new Set<string>();
                    const numericEnumValues = new Set<number>();
                    const seenTypes = new Set<ts.Type>();
                    const visitType = (value: ts.Type): void => {
                        if (seenTypes.has(value) || seenTypes.size >= 64) return;
                        seenTypes.add(value);
                        if (value.isUnionOrIntersection()) value.types.forEach(visitType);
                        if ((value.flags & ts.TypeFlags.NumberLiteral) !== 0) numericEnumValues.add((value as ts.NumberLiteralType).value);
                        for (const declaration of value.getSymbol()?.declarations ?? []) {
                            if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
                                const registered = names.get(declaration);
                                if (registered) registeredTypes.add(registered);
                            }
                        }
                        if ((value.flags & ts.TypeFlags.Object) !== 0 && ((value as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0) {
                            checker.getTypeArguments(value as ts.TypeReference).forEach(visitType);
                        }
                    };
                    visitType(valueType);
                    if (ts.canHaveDecorators(declaration)) for (const decorator of ts.getDecorators(declaration) ?? []) {
                        const call = decorator.expression;
                        if (!ts.isCallExpression(call) || this.decoratorName(call.expression, checker) !== 'type') continue;
                        for (const argument of call.arguments) {
                            this.enumValues(argument, checker).forEach((value) => numericEnumValues.add(value));
                            const expressions = ts.isArrayLiteralExpression(argument) ? argument.elements : [argument];
                            for (const expression of expressions) for (const candidate of this.classes(expression, checker)) {
                                const registered = names.get(candidate);
                                if (registered) registeredTypes.add(registered);
                            }
                        }
                    }
                    return [{ name: symbol.getName(), type: checker.typeToString(valueType),
                        reference: relative(cocosRoot, source.fileName).split('\\').join('/'),
                        sha256: sourceHash(source.fileName),
                        line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1,
                        registeredTypes: [...registeredTypes].sort(), numericEnumValues: [...numericEnumValues].sort((a, b) => a - b) }];
                })).sort((a, b) => a.name.localeCompare(b.name) || a.reference.localeCompare(b.reference));
            return { type, sources: nodes.map((node) => {
                const source = node.getSourceFile();
                return { reference: relative(cocosRoot, source.fileName).split('\\').join('/'),
                    sha256: sourceHash(source.fileName),
                    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
            }).sort((a, b) => a.reference.localeCompare(b.reference)), requiredComponents: [...required].sort(),
                dependencyProofs, baseTypes: [...new Set([...seen].flatMap((node) => { const name = names.get(node); return name && name !== type ? [name] : []; }))].sort(),
                unresolvedDependencies: unresolved, properties, classification: 'source-declared-runtime-unverified' as const };
        });
    }

    /**
     * @description 解析导入别名或命名空间所指向的类，不把同名字符串当类证明。
     */
    private static classes(expression: ts.Expression, checker: ts.TypeChecker): readonly ts.ClassLikeDeclaration[] {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        return (symbol?.declarations ?? []).filter((node): node is ts.ClassLikeDeclaration =>
            ts.isClassDeclaration(node) || ts.isClassExpression(node));
    }

    /**
     * @description 从装饰器符号恢复导入别名对应的正式名称。
     */
    private static decoratorName(expression: ts.Expression, checker: ts.TypeChecker): string {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        const resolved = symbol?.getName();
        if (resolved === 'ccclass' || resolved === 'requireComponent' || resolved === 'type') return resolved;
        const spelling = ts.isIdentifier(expression) ? expression.text
            : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
        if (spelling === 'ccclass' || spelling === 'requireComponent' || spelling === 'type') return spelling;
        for (const declaration of checker.getSymbolAtLocation(expression)?.declarations ?? []) {
            if (ts.isImportSpecifier(declaration)) {
                const imported = declaration.propertyName?.text ?? declaration.name.text;
                if (imported === 'ccclass' || imported === 'requireComponent' || imported === 'type') return imported;
            }
        }
        return '';
    }

    /**
     * @description 从 enum 声明及静态别名提取编译器可证明的数值，不执行 Enum 包装函数。
     */
    private static enumValues(expression: ts.Expression, checker: ts.TypeChecker,
        seen = new Set<ts.Symbol>(), depth = 0): readonly number[] {
        if (depth > 32) return [];
        if (ts.isObjectLiteralExpression(expression)) return expression.properties.flatMap((property) => {
            if (!ts.isPropertyAssignment(property)) return [];
            const type = checker.getTypeAtLocation(property.initializer);
            if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) return [(type as ts.NumberLiteralType).value];
            if (ts.isPropertyAccessExpression(property.initializer) || ts.isElementAccessExpression(property.initializer)) {
                const value = checker.getConstantValue(property.initializer);
                return typeof value === 'number' && Number.isFinite(value) ? [value] : [];
            }
            return [];
        });
        if (ts.isCallExpression(expression)) {
            const name = ts.isIdentifier(expression.expression) ? expression.expression.text
                : ts.isPropertyAccessExpression(expression.expression) ? expression.expression.name.text : '';
            return name === 'Enum' && expression.arguments[0] ? this.enumValues(expression.arguments[0], checker, seen, depth + 1) : [];
        }
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
        if (!symbol || seen.has(symbol)) return [];
        seen.add(symbol);
        const values: number[] = [];
        for (const declaration of symbol.declarations ?? []) {
            if (ts.isEnumDeclaration(declaration)) {
                for (const member of declaration.members) {
                    const value = checker.getConstantValue(member);
                    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
                }
            } else if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.initializer) {
                values.push(...this.enumValues(declaration.initializer, checker, seen, depth + 1));
            }
        }
        return [...new Set(values)].sort((a, b) => a - b);
    }

    /**
     * @description 枚举普通源码文件，拒绝借符号链接进入安装范围之外。
     */
    private static files(directory: string): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            const file = join(directory, entry.name);
            return entry.isDirectory() ? this.files(file)
                : entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [file] : [];
        });
    }
}
