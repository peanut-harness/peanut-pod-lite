import { constants, mkdirSync, openSync, closeSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { PodCoverageContracts } from './contracts.mjs';
import { PodCoverageEvidence } from './evidence.mjs';
import { PodCoverageInputReader, type IPodCoverageRoot } from './input-reader.mjs';
import { PodCoverageInventory } from './inventory.mjs';
import { PodCoverageMapping } from './mapping.mjs';
import { PodCoverageReport } from './report.mjs';

/**
 * @description 只读离线评估 CLI；只在 report 的新目录写入报告。
 */
export class PodCoverageCli {
    /**
     * @description 执行一个离线命令并返回稳定退出码。
     * @param argv 命令参数。
     * @returns 0 成功、2 验收未完成、1 非法输入或 I/O 错误。
     */
    public static run(argv: readonly string[]): number {
        try {
            const { command, inputPath, roots, outputPath, workflowId, syntheticCheck } = this.parse(argv);
            const reader = new PodCoverageInputReader(roots);
            const { input, sha256 } = reader.readInput(inputPath);
            const inventory = PodCoverageInventory.inspect(input, reader);
            const mapping = PodCoverageMapping.assess(input, inventory);
            const evidence = PodCoverageEvidence.assess(input, reader);
            const report = PodCoverageReport.build(input, inventory, mapping, evidence);
            if (new PodCoverageInputReader([]).readInput(inputPath).sha256 !== sha256) {
                throw new Error('pod_coverage_input_changed_during_evaluation');
            }
            if (command === 'validate') {
                process.stdout.write(PodCoverageReport.json({ valid: true, inventoryComplete: inventory.complete,
                    mappingComplete: mapping.complete, missingSourceIds: inventory.missingSourceIds,
                    missingRepositories: inventory.missingRepositories, conflicts: evidence.conflicts }));
                return 0;
            }
            if (command === 'check-acceptance') {
                const workflow = (report.workflows as readonly Readonly<Record<string, unknown>>[])
                    .find((row) => row.id === workflowId);
                if (workflow === undefined) throw new Error('pod_coverage_workflow_unknown');
                const complete = syntheticCheck ? workflow.syntheticExerciseComplete : workflow.complete;
                process.stdout.write(PodCoverageReport.json({ workflowId, acceptanceComplete: workflow.complete,
                    syntheticExerciseComplete: workflow.syntheticExerciseComplete, checkMode: syntheticCheck ? 'synthetic-exercise' : 'product' }));
                return complete ? 0 : 2;
            }
            if (outputPath === null) throw new Error('pod_coverage_output_required');
            this.writeReport(outputPath, inputPath, roots, report);
            process.stdout.write(PodCoverageReport.json({ output: outputPath, acceptanceComplete: report.acceptanceComplete }));
            return 0;
        } catch (error) {
            process.stderr.write(`${error instanceof Error ? error.message : 'pod_coverage_unknown_error'}\n`);
            return 1;
        }
    }

    /**
     * @description 拒绝未知选项、重复选项和不完整根映射。
     * @param argv 命令参数。
     * @returns 收窄后的命令参数。
     */
    private static parse(argv: readonly string[]): { command: string; inputPath: string; roots: IPodCoverageRoot[];
        outputPath: string | null; workflowId: string | null; syntheticCheck: boolean } {
        const [command, ...args] = argv;
        if (!['validate', 'report', 'check-acceptance'].includes(String(command))) throw new Error('pod_coverage_command_invalid');
        const syntheticCheck = args.includes('--synthetic-check');
        if (syntheticCheck && (command !== 'check-acceptance' || args.filter((arg) => arg === '--synthetic-check').length !== 1)) {
            throw new Error('pod_coverage_synthetic_check_invalid');
        }
        const options = args.filter((arg) => arg !== '--synthetic-check');
        const values = new Map<string, string[]>();
        for (let index = 0; index < options.length; index += 2) {
            const flag = options[index];
            const value = options[index + 1];
            if (!flag || !['--input', '--source-root', '--evidence-root', '--out', '--workflow'].includes(flag)
                || value === undefined || value.startsWith('--')) throw new Error('pod_coverage_argument_invalid');
            const list = values.get(flag) ?? [];
            list.push(value);
            values.set(flag, list);
        }
        if (values.get('--input')?.length !== 1 || (values.get('--out')?.length ?? 0) > 1 || (values.get('--workflow')?.length ?? 0) > 1
            || command !== 'report' && values.has('--out') || command !== 'check-acceptance' && values.has('--workflow')
            || command === 'report' && (values.get('--out')?.length ?? 0) !== 1
            || command === 'check-acceptance' && (values.get('--workflow')?.length ?? 0) !== 1) {
            throw new Error('pod_coverage_argument_cardinality_invalid');
        }
        const rawInputPath = values.get('--input')![0]!;
        if (!isAbsolute(rawInputPath)) throw new Error('pod_coverage_input_path_invalid');
        const inputPath = resolve(rawInputPath);
        const roots: IPodCoverageRoot[] = [];
        for (const flag of ['--source-root', '--evidence-root']) {
            for (const value of values.get(flag) ?? []) {
                const separator = value.indexOf('=');
                if (separator <= 0 || separator === value.length - 1) throw new Error('pod_coverage_root_argument_invalid');
                const id = PodCoverageContracts.identifier(value.slice(0, separator));
                const path = value.slice(separator + 1);
                if (!isAbsolute(path) || roots.some((root) => root.id === id)) throw new Error('pod_coverage_root_argument_invalid');
                roots.push({ id, path });
            }
        }
        const outputPath = values.get('--out')?.[0] ?? null;
        if (outputPath !== null && !isAbsolute(outputPath)) throw new Error('pod_coverage_output_path_invalid');
        const workflowId = values.get('--workflow')?.[0] ?? null;
        if (workflowId !== null) PodCoverageContracts.identifier(workflowId);
        return { command: String(command), inputPath, roots, outputPath, workflowId, syntheticCheck };
    }

    /**
     * @description 排他创建新目录；失败只删除本次创建的输出。
     * @param outputPath 新目录绝对路径。
     * @param inputPath 输入文件。
     * @param roots 只读根目录。
     * @param report 稳定报告。
     */
    private static writeReport(outputPath: string, inputPath: string, roots: readonly IPodCoverageRoot[],
        report: Readonly<Record<string, unknown>>): void {
        const output = resolve(outputPath);
        const parent = realpathSync(dirname(output));
        const actual = resolve(parent, basename(output));
        const inside = (path: string, root: string): boolean => path === root || relative(root, path) !== '..'
            && !relative(root, path).startsWith(`..${sep}`) && !isAbsolute(relative(root, path));
        for (const root of roots) {
            if (inside(actual, realpathSync(root.path))) throw new Error('pod_coverage_output_overlaps_root');
        }
        if (inside(inputPath, actual) || inside(actual, inputPath)) throw new Error('pod_coverage_output_overlaps_input');
        mkdirSync(actual, { recursive: false });
        try {
            for (const [name, contents] of [['report.json', PodCoverageReport.json(report)],
                ['report.md', PodCoverageReport.markdown(report)]]) {
                const descriptor = openSync(resolve(actual, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
                try { writeFileSync(descriptor, contents); } finally { closeSync(descriptor); }
            }
        } catch (error) {
            rmSync(actual, { recursive: true, force: true });
            throw error;
        }
    }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
    process.exitCode = PodCoverageCli.run(process.argv.slice(2));
}
