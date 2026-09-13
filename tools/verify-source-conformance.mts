import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SourceFileConformanceInspector } from './source-file-conformance-inspector.mjs';

/**
 * @description 可增长性门禁使用的历史代码质量基线。
 */
interface ICodeQualityBaseline {
    /**
     * @description 最大生产 TypeScript 实现文件行数。
     */
    readonly maxProductionSourceLines: number;

    /**
     * @description 尚未迁移为 TypeScript 的脚本文件数量。
     */
    readonly legacyScriptFiles: number;

    /**
     * @description 尚未迁移为多行格式的单行 JSDoc 数量。
     */
    readonly singleLineJSDoc: number;

    /**
     * @description 生产源码中尚未迁移为类职责的导出自由函数数量。
     */
    readonly exportedFreeFunctions: number;

    /**
     * @description 生产源码中仍包含多个类的文件数量。
     */
    readonly multiClassSourceFiles: number;
}

/**
 * @description 扫描仓库源码并阻止已知规范旧债继续增长。
 */
class SourceConformanceVerifier {
    /**
     * @description 受基线约束的全部质量指标。
     */
    private readonly _metricNames: readonly (keyof ICodeQualityBaseline)[] = [
        'maxProductionSourceLines',
        'legacyScriptFiles',
        'singleLineJSDoc',
        'exportedFreeFunctions',
        'multiClassSourceFiles',
    ];

    /**
     * @description 扫描时忽略的生成目录与外部依赖目录。
     */
    private readonly _ignoredDirectories = new Set([
        '.git',
        '.npm-cache',
        'dist',
        'evidence',
        'node_modules',
        'release',
    ]);

    /**
     * @description 仓库绝对根目录。
     */
    private readonly _repositoryRoot = resolve(import.meta.dirname, '..');

    /**
     * @description 执行规范基线核对并在增长时失败。
     * @returns 无返回值
     */
    public run(): void {
        this._assertAdapterBoundaries();
        const baseline = this._readBaseline();
        const current = this._scan();
        for (const metric of this._metricNames) {
            if (current[metric] > baseline[metric]) {
                throw new Error(`source_conformance_regression:${metric}:${current[metric]}>${baseline[metric]}`);
            }
        }
        process.stdout.write(`${JSON.stringify({ ok: true, baseline, current }, null, 2)}\n`);
    }

    /**
     * @description 阻止版本适配器直接依赖其他版本目录，公共能力必须下沉到 core 或 shared。
     * @returns 无返回值
     */
    private _assertAdapterBoundaries(): void {
        const adaptersDirectory = join(
            this._repositoryRoot,
            'packages',
            'engine',
            'modules',
            'runtime',
            'src',
            'cocos',
            'adapters',
        );
        for (const adapterDirectoryName of ['adapter-24', 'adapter-35', 'adapter-38']) {
            const adapterDirectory = join(adaptersDirectory, adapterDirectoryName);
            for (const filePath of this._collectSourceFiles(adapterDirectory)) {
                const source = readFileSync(filePath, 'utf8');
                const siblingAdapterImport = source.match(/from\s+['"]\.\.\/adapter-(?:24|35|38)\//u)?.[0];
                if (siblingAdapterImport != null) {
                    throw new Error(`adapter_boundary_violation:${adapterDirectoryName}:${filePath}`);
                }
            }
        }
    }

    /**
     * @description 读取受版本控制的代码质量基线。
     * @returns 代码质量基线
     */
    private _readBaseline(): ICodeQualityBaseline {
        const value: unknown = JSON.parse(
            readFileSync(join(this._repositoryRoot, 'specs/code-quality-baseline.json'), 'utf8'),
        );
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            throw new Error('source_conformance_baseline_invalid:root');
        }
        return {
            maxProductionSourceLines: this._readBaselineMetric(value, 'maxProductionSourceLines'),
            legacyScriptFiles: this._readBaselineMetric(value, 'legacyScriptFiles'),
            singleLineJSDoc: this._readBaselineMetric(value, 'singleLineJSDoc'),
            exportedFreeFunctions: this._readBaselineMetric(value, 'exportedFreeFunctions'),
            multiClassSourceFiles: this._readBaselineMetric(value, 'multiClassSourceFiles'),
        };
    }

    /**
     * @description 从未知基线对象读取非负整数指标。
     * @param baseline 未受信的基线对象
     * @param metricName 指标名称
     * @returns 已验证的指标值
     */
    private _readBaselineMetric(baseline: object, metricName: keyof ICodeQualityBaseline): number {
        const metricValue: unknown = Reflect.get(baseline, metricName);
        if (typeof metricValue !== 'number' || !Number.isSafeInteger(metricValue) || metricValue < 0) {
            throw new Error(`source_conformance_baseline_invalid:${metricName}`);
        }
        return metricValue;
    }

    /**
     * @description 扫描当前仓库并计算受控旧债指标。
     * @returns 当前代码质量指标
     */
    private _scan(): ICodeQualityBaseline {
        const sourceFiles = this._collectSourceFiles(this._repositoryRoot);
        const inspector = new SourceFileConformanceInspector(this._repositoryRoot);
        const legacyScriptFiles = sourceFiles.filter((filePath) => inspector.isLegacyScript(filePath)).length;
        let singleLineJSDoc = 0;
        let exportedFreeFunctions = 0;
        let multiClassSourceFiles = 0;
        let maxProductionSourceLines = 0;

        for (const filePath of sourceFiles) {
            const source = readFileSync(filePath, 'utf8');
            const inspection = inspector.inspect(filePath, source);
            maxProductionSourceLines = Math.max(maxProductionSourceLines, inspection.productionLineCount);
            singleLineJSDoc += inspection.singleLineJSDoc;
            exportedFreeFunctions += inspection.exportedFreeFunctions;
            if (inspection.hasMultipleClasses) {
                multiClassSourceFiles += 1;
            }
        }

        return {
            maxProductionSourceLines,
            legacyScriptFiles,
            singleLineJSDoc,
            exportedFreeFunctions,
            multiClassSourceFiles,
        };
    }

    /**
     * @description 递归收集参与规范核对的源码与脚本文件。
     * @param directory 当前扫描目录
     * @returns 源码绝对路径列表
     */
    private _collectSourceFiles(directory: string): readonly string[] {
        const sourceFiles: string[] = [];
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory() && this._ignoredDirectories.has(entry.name)) {
                continue;
            }
            const absolutePath = join(directory, entry.name);
            if (entry.isDirectory()) {
                sourceFiles.push(...this._collectSourceFiles(absolutePath));
            } else if (/\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/u.test(entry.name)) {
                sourceFiles.push(absolutePath);
            }
        }
        return sourceFiles;
    }
}

new SourceConformanceVerifier().run();
