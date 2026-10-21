import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

/**
 * @description 4.3 独立离线检查入口。仓库根执行：
 * node --import tsx packages/hosts/modules/creator-38/scripts/resource-stability-check.mts
 * 只核对脚本类型与故障注入；不构建候选、不启动 Creator，也不产出原生 passed。
 */
class ResourceStabilityOfflineCheck {
    /**
     * @description 类型诊断通过后才运行确定性测试；继承实际退出状态。
     * @returns 检查退出码。
     */
    public static run(): number {
        const scripts = dirname(fileURLToPath(import.meta.url));
        const tests = resolve(scripts, '../tests');
        const sourceNames = readdirSync(scripts).filter((name) => /^resource-stability-.*\.mts$/u.test(name));
        const testNames = readdirSync(tests).filter((name) => /^resource-stability-.*\.test\.mts$/u.test(name));
        const roots = [...sourceNames.map((name) => resolve(scripts, name)), ...testNames.map((name) => resolve(tests, name))];
        const program = ts.createProgram(roots, {
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
            moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
            noUncheckedIndexedAccess: true, noEmit: true, allowImportingTsExtensions: true,
            skipLibCheck: true, types: ['node'],
            typeRoots: [resolve(scripts, '../../../../../node_modules/@types')],
        });
        const diagnostics = ts.getPreEmitDiagnostics(program);
        if (diagnostics.length > 0) {
            process.stderr.write(ts.formatDiagnostics(diagnostics, {
                getCurrentDirectory: () => process.cwd(), getCanonicalFileName: (name) => name,
                getNewLine: () => '\n',
            }));
            return 1;
        }
        if (testNames.length === 0) throw new Error('resource_stability_tests_missing');
        const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...testNames.map((name) => resolve(tests, name))], {
            cwd: resolve(scripts, '../../../../..'), stdio: 'inherit',
        });
        if (result.error || result.signal !== null) return 1;
        return result.status ?? 1;
    }
}

process.exitCode = ResourceStabilityOfflineCheck.run();
