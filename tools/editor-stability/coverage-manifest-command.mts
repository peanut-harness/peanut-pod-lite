import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CoverageInventoryReader } from './coverage-inventory-reader.mjs';
import { CoverageManifestGenerator } from './coverage-manifest-generator.mjs';

/**
 * @description 生成或只读核对版本化静态清单，所有用例均保持 pending，输出不含本机路径或原始源码。
 */
export class CoverageManifestCommand {
    /**
     * @description 执行显式路径命令；生成使用排他创建，不覆盖先前证据。
     * @param args 命令行选项和精确版本。
     * @returns 可供终端展示的有界草稿摘要。
     */
    public static run(args: readonly string[]): object {
        const options = new Map<string, string>();
        let check = false;
        for (let index = 0; index < args.length; index += 1) {
            const key = args[index];
            if (key === '--check' && !check) {
                check = true;
                continue;
            }
            const value = args[index + 1];
            if (key == null || !['--repository-root', '--creator-resources-root', '--creator-version', '--output-directory'].includes(key)
                || value == null || value.startsWith('--') || options.has(key)) {
                throw new Error('coverage_command_arguments_invalid');
            }
            options.set(key, value);
            index += 1;
        }
        const repositoryRoot = options.get('--repository-root');
        const creatorResourcesRoot = options.get('--creator-resources-root');
        const creatorVersion = options.get('--creator-version');
        const outputDirectory = options.get('--output-directory');
        if (repositoryRoot == null || creatorResourcesRoot == null || outputDirectory == null
            || creatorVersion !== '3.8.3' && creatorVersion !== '3.8.7') {
            throw new Error('coverage_command_arguments_invalid');
        }
        const inventory = CoverageInventoryReader.read({ repositoryRoot, creatorResourcesRoot, creatorVersion });
        const manifest = CoverageManifestGenerator.createDraft(inventory);
        const data = `${JSON.stringify({ purpose: 'unverified_coverage_draft', inventory, manifest }, null, 2)}\n`;
        const output = join(outputDirectory, `creator-${creatorVersion}-draft.json`);
        if (check) {
            if (readFileSync(output, 'utf8') !== data) {
                throw new Error('coverage_draft_out_of_sync');
            }
        } else {
            mkdirSync(outputDirectory, { recursive: true });
            writeFileSync(output, data, { flag: 'wx' });
        }
        return { purpose: 'unverified_coverage_draft', creatorVersion, checked: check,
            targets: inventory.targets.length, requiredCases: manifest.cases.length,
            inventorySha256: manifest.inventorySha256,
            nativeImporterModules: inventory.nativeImporterModules.length,
            nativeComponentDeclarations: inventory.nativeComponentDeclarations.length,
            curatedComponentsWithoutDeclaration: inventory.curatedComponentsWithoutDeclaration };
    }
}

const invokedPath = process.argv[1];
if (invokedPath != null && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
    try {
        console.log(JSON.stringify(CoverageManifestCommand.run(process.argv.slice(2))));
    } catch (error: unknown) {
        process.exitCode = 1;
        console.error(error instanceof Error ? error.message : 'coverage_command_failed');
    }
}
