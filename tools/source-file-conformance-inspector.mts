import { relative, resolve, sep } from 'node:path';

import ts from 'typescript';

/**
 * @description 单个源码文件的质量旧债统计结果。
 */
export interface ISourceFileConformanceInspection {
    /**
     * @description 生产 TypeScript 实现文件的有效行数，非生产文件为零。
     */
    readonly productionLineCount: number;

    /**
     * @description 文件中单行 JSDoc 的数量。
     */
    readonly singleLineJSDoc: number;

    /**
     * @description 生产 TypeScript 文件中导出自由函数的数量。
     */
    readonly exportedFreeFunctions: number;

    /**
     * @description 生产 TypeScript 文件是否包含多个类声明或类表达式。
     */
    readonly hasMultipleClasses: boolean;
}

/**
 * @description 使用 TypeScript AST 检查源码质量指标，避免注释、字符串和声明文件造成误报。
 */
export class SourceFileConformanceInspector {
    /**
     * @description 被检查仓库的绝对根目录。
     */
    private readonly _repositoryRoot: string;

    /**
     * @description 创建源码质量检查器。
     * @param repositoryRoot 被检查仓库根目录
     */
    public constructor(repositoryRoot: string) {
        this._repositoryRoot = resolve(repositoryRoot);
    }

    /**
     * @description 检查单个源码文件，并仅对真实生产 TypeScript 计算结构指标。
     * @param filePath 源码文件路径
     * @param source 源码文本
     * @returns 文件质量统计结果
     */
    public inspect(filePath: string, source: string): ISourceFileConformanceInspection {
        const singleLineJSDoc = source.match(/\/\*\* [^\r\n]*\*\//gu)?.length ?? 0;
        if (!this._isProductionTypeScript(filePath)) {
            return {
                productionLineCount: 0,
                singleLineJSDoc,
                exportedFreeFunctions: 0,
                hasMultipleClasses: false,
            };
        }

        const sourceFile = ts.createSourceFile(
            filePath,
            source,
            ts.ScriptTarget.Latest,
            false,
            filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        return {
            productionLineCount: this._countLines(source),
            singleLineJSDoc,
            exportedFreeFunctions: this._countExportedFreeFunctions(sourceFile),
            hasMultipleClasses: this._countClasses(sourceFile) > 1,
        };
    }

    /**
     * @description 统计源码有效行数，不把文件末尾换行计为额外空行。
     * @param source 源码文本
     * @returns 行数
     */
    private _countLines(source: string): number {
        if (source.length === 0) {
            return 0;
        }
        const normalized = source.replace(/\r\n?/gu, '\n');
        const lineCount = normalized.split('\n').length;
        return normalized.endsWith('\n') ? lineCount - 1 : lineCount;
    }

    /**
     * @description 判断文件是否属于仍需迁移的 JavaScript 类脚本。
     * @param filePath 源码文件路径
     * @returns 属于 JavaScript、MJS、CJS 或 JSX 时返回 `true`
     */
    public isLegacyScript(filePath: string): boolean {
        return /\.(?:js|mjs|cjs|jsx)$/u.test(filePath);
    }

    /**
     * @description 判断文件是否属于 `src` 或 `source` 下的生产 TypeScript 实现。
     * @param filePath 源码文件路径
     * @returns 需要计算结构指标时返回 `true`
     */
    private _isProductionTypeScript(filePath: string): boolean {
        if (!/\.(?:ts|mts|cts|tsx)$/u.test(filePath) || /\.d\.(?:ts|mts|cts)$/u.test(filePath)) {
            return false;
        }
        const relativePath = relative(this._repositoryRoot, resolve(filePath));
        if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
            return false;
        }
        const segments = relativePath.split(sep);
        const hasSourceDirectory = segments.includes('src') || segments.includes('source');
        const hasNonProductionDirectory = segments.some((segment) =>
            segment === 'test' || segment === 'tests' || segment === 'fixture' || segment === 'fixtures'
        );
        return hasSourceDirectory && !hasNonProductionDirectory;
    }

    /**
     * @description 统计顶层导出自由函数，声明文件已在路径分类阶段排除。
     * @param sourceFile TypeScript AST 根节点
     * @returns 导出自由函数数量
     */
    private _countExportedFreeFunctions(sourceFile: ts.SourceFile): number {
        return sourceFile.statements.filter((statement) => {
            if (!ts.isFunctionDeclaration(statement) || !ts.canHaveModifiers(statement)) {
                return false;
            }
            return ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
        }).length;
    }

    /**
     * @description 统计文件内全部类声明与类表达式。
     * @param sourceFile TypeScript AST 根节点
     * @returns 类节点数量
     */
    private _countClasses(sourceFile: ts.SourceFile): number {
        let classCount = 0;
        const visit = (node: ts.Node): void => {
            if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
                classCount += 1;
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        return classCount;
    }
}
