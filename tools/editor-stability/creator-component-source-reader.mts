import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import ts from 'typescript';

import { CoverageManifestGenerator } from './coverage-manifest-generator.mjs';
import type { ICoverageRegistrationAlternative, ICoverageUnresolvedRegistration } from './coverage-contracts.mjs';
import { CreatorRegistrationNameReader } from './creator-registration-name-reader.mjs';

/**
 * @description 原生组件源码声明快照；声明与继承分析不是运行时加载证明。
 */
export interface ICreatorComponentDeclarations {
    /**
     * @description 全部扫描源文件的规范摘要。
     */
    readonly sourceSha256: string;
    /**
     * @description ccclass 注册名称，包含 Asset 和其它非组件类型。
     */
    readonly registeredClasses: readonly string[];
    /**
     * @description 同名注册类的源码分支；保留全部路径等待运行时对照。
     */
    readonly registrationAlternatives: readonly ICoverageRegistrationAlternative[];
    /**
     * @description 不能安全静态求值的注册声明，保存源码定位而不执行名称表达式。
     */
    readonly unresolvedRegistrations: readonly ICoverageUnresolvedRegistration[];
    /**
     * @description 继承链到实际 Component 类的注册声明，包含抽象基类。
     */
    readonly componentDeclarations: readonly string[];
    /**
     * @description 已声明为抽象类型的组件名称，保留分类证据供运行时对照。
     */
    readonly abstractComponentDeclarations: readonly string[];
}

/**
 * @description 通过 TypeScript AST 和符号继承链核对组件，避免正则扫描遗漏命名别名及私有继承。
 */
export class CreatorComponentSourceReader {
    /**
     * @description 扫描当前安装版本的 cocos 源码，只返回名称与摘要。
     * @param cocosRoot 当前版本 engine/cocos 源码目录。
     * @returns 独立于策展表的注册类和组件声明。
     */
    public static read(cocosRoot: string): ICreatorComponentDeclarations {
        const files = this.files(cocosRoot).sort();
        const program = ts.createProgram(files, {
            noEmit: true,
            skipLibCheck: true,
            experimentalDecorators: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            types: [],
        });
        const checker = program.getTypeChecker();
        const registered = new Set<string>();
        const registrationPaths = new Map<string, string[]>();
        const unresolved: ICoverageUnresolvedRegistration[] = [];
        const components = new Set<string>();
        const abstracts = new Set<string>();
        const digests: { readonly path: string; readonly sha256: string }[] = [];
        for (const file of files) {
            const source = program.getSourceFile(file);
            if (source == null) {
                throw new Error('coverage_native_source_unreadable');
            }
            digests.push({ path: relative(cocosRoot, file).split('\\').join('/'), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
            const visit = (node: ts.Node): void => {
                if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && ts.canHaveDecorators(node)) {
                    for (const decorator of ts.getDecorators(node) ?? []) {
                        const expression = decorator.expression;
                        const callee = ts.isCallExpression(expression) ? expression.expression : expression;
                        if (this.isCcclass(callee, checker)) {
                            const argument = ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
                            const name = argument == null ? null : CreatorRegistrationNameReader.read(argument, checker);
                            const component = this.isComponent(checker.getTypeAtLocation(node.name ?? node), checker, new Set(), 0);
                            const sourcePath = relative(cocosRoot, file).split('\\').join('/');
                            if (name == null) {
                                unresolved.push({ sourcePath, line: source.getLineAndCharacterOfPosition(decorator.getStart(source)).line + 1,
                                    className: node.name?.text ?? '', componentDeclaration: component });
                                continue;
                            }
                            registered.add(name);
                            const paths = registrationPaths.get(name) ?? [];
                            paths.push(sourcePath);
                            registrationPaths.set(name, paths);
                            if (component) {
                                components.add(name);
                                if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword)) {
                                    abstracts.add(name);
                                }
                            }
                        }
                    }
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
        return {
            sourceSha256: CoverageManifestGenerator.digest(digests),
            registeredClasses: [...registered].sort(),
            registrationAlternatives: [...registrationPaths].filter(([, paths]) => paths.length > 1)
                .map(([name, paths]) => ({ name, paths: paths.sort() })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
            unresolvedRegistrations: unresolved.sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : a.line - b.line),
            componentDeclarations: [...components].sort(),
            abstractComponentDeclarations: [...abstracts].sort(),
        };
    }

    /**
     * @description 识别直接、命名空间和导入别名的 ccclass 装饰器符号。
     * @param expression 装饰器调用目标。
     * @param checker 当前源码的类型检查器。
     * @returns 是否应纳入注册声明对照。
     */
    private static isCcclass(expression: ts.Expression, checker: ts.TypeChecker): boolean {
        let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
        if (symbol != null && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
            symbol = checker.getAliasedSymbol(symbol);
        }
        return symbol?.getName() === 'ccclass'
            || ts.isIdentifier(expression) && expression.text === 'ccclass'
            || ts.isPropertyAccessExpression(expression) && expression.name.text === 'ccclass';
    }

    /**
     * @description 沿 TypeScript 类型继承和交叉类型寻找实际引擎 Component 声明。
     * @param type 当前类型。
     * @param checker 当前安装版本的类型检查器。
     * @param seen 当前链已访问类型。
     * @param depth 当前继承深度。
     * @returns 是否有可核对的 Component 继承链。
     */
    private static isComponent(type: ts.Type, checker: ts.TypeChecker, seen: Set<ts.Type>, depth: number): boolean {
        if (depth > 100 || seen.has(type)) {
            return false;
        }
        seen.add(type);
        const symbol = type.getSymbol();
        if (symbol?.getName() === 'Component' && symbol.declarations?.some((declaration) =>
            declaration.getSourceFile().fileName.split('\\').join('/').endsWith('/scene-graph/component.ts'))) {
            return true;
        }
        if (type.isIntersection()) {
            return type.types.some((part) => this.isComponent(part, checker, seen, depth + 1));
        }
        return type.isClassOrInterface() && checker.getBaseTypes(type).some((base) => this.isComponent(base, checker, seen, depth + 1));
    }

    /**
     * @description 递归列出实际源码文件，排除声明文件和符号链接。
     * @param directory 当前源码目录。
     * @returns TypeScript 实现文件路径。
     */
    private static files(directory: string): string[] {
        return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? this.files(path)
                : entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
        });
    }
}
