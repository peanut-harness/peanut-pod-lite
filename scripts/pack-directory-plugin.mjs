import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { stripNodeBuiltinProtocol } from './creator-electron-bundle-normalize.mjs';
import { EsbuildCliRunner } from './esbuild-cli-runner.mjs';

const DETERMINISTIC_PACKED_AT = '1970-01-01T00:00:00.000Z';

function comparePaths(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * @description 递归列出普通文件，用于生成稳定的完整性清单。
 * @param {string} directoryPath
 * @returns {Promise<string[]>}
 */
async function listFiles(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
        const entryPath = resolve(directoryPath, entry.name);
        if (entry.isDirectory()) {
            const nestedFiles = await listFiles(entryPath);
            for (const nestedFile of nestedFiles) {
                files.push(`${entry.name}/${nestedFile}`);
            }
            continue;
        }
        if (entry.isFile()) {
            files.push(entry.name);
        }
    }
    return files;
}

/**
 * @description 将已编译业务插件打成可安装目录包。
 * @param {{
 *   pluginRoot: string,
 *   sourceManifestName: string,
 *   bundleFileName: string,
 *   releaseDirectoryName: string,
 *   entryRelativePath?: string,
 *   assetsRelativePath?: string,
 *   copyDirectories?: Array<{ from: string, to: string }>,
 *   keepPaths?: string[],
 *   bundleExternals?: string[],
 *   prepareStaging?: (context: { stagingDirectory: string, pluginRoot: string, esbuild: EsbuildCliRunner }) => Promise<void>,
 * }} options
 * @returns {Promise<string>} 发布目录绝对路径；清单文件名为 `${manifest.id}.manifest.json`
 */
export async function packDirectoryPlugin(options) {
    const esbuild = new EsbuildCliRunner();
    const pluginRoot = options.pluginRoot;
    const entryPath = resolve(pluginRoot, options.entryRelativePath ?? 'dist/index.js');
    const sourceManifestPath = resolve(pluginRoot, options.sourceManifestName);
    const releaseDirectory = resolve(pluginRoot, 'release');
    const stagingDirectory = resolve(pluginRoot, '.package-staging');
    const packageDirectory = resolve(releaseDirectory, options.releaseDirectoryName);
    const assetsDirectory = resolve(pluginRoot, options.assetsRelativePath ?? 'assets');
    const bundlePath = resolve(stagingDirectory, options.bundleFileName);

    await rm(stagingDirectory, { recursive: true, force: true });
    // 清空整个 release/ 而非仅当前版本目录：每个插件只保留唯一的当前版本包，历史版本目录一旦残留，
    // 其内嵌 bundle 的 version 会与被覆盖写成新版的 packed manifest 漂移，导致 findPackedPackagePath 误选旧包、
    // 模块加载时抛 plugin_module_manifest_mismatch。
    await rm(releaseDirectory, { recursive: true, force: true });
    await mkdir(stagingDirectory, { recursive: true });
    if (existsSync(assetsDirectory)) {
        await cp(assetsDirectory, resolve(stagingDirectory, 'assets'), { recursive: true });
    }
    await esbuild.run([
        entryPath,
        '--bundle',
        '--format=cjs',
        '--platform=node',
        '--target=es2021',
        ...['canvas', ...(options.bundleExternals ?? [])].map((externalName) => `--external:${externalName}`),
        `--outfile=${bundlePath}`,
    ]);
    // Creator 3.8.x Electron 不识别 require('node:fs')；产物去掉 node: 前缀。
    const bundled = await readFile(bundlePath, 'utf8');
    const normalized = stripNodeBuiltinProtocol(bundled);
    if (normalized !== bundled) {
        await writeFile(bundlePath, normalized, 'utf8');
    }
    for (const copy of options.copyDirectories ?? []) {
        await cp(resolve(pluginRoot, copy.from), resolve(stagingDirectory, copy.to), { recursive: true });
    }
    for (const keepPath of options.keepPaths ?? []) {
        const keepDirectory = resolve(stagingDirectory, keepPath);
        await mkdir(keepDirectory, { recursive: true });
        await writeFile(resolve(keepDirectory, '.keep'), '', 'utf8');
    }
    if (options.prepareStaging != null) {
        await options.prepareStaging({
            stagingDirectory,
            pluginRoot,
            esbuild,
        });
    }
    const libsDirectory = resolve(stagingDirectory, 'libs');
    if (!existsSync(libsDirectory)) {
        await mkdir(libsDirectory, { recursive: true });
        await writeFile(resolve(libsDirectory, '.keep'), '', 'utf8');
    }
    await writeFile(resolve(stagingDirectory, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 4)}\n`, 'utf8');
    const records = [];
    for (const filePath of await listFiles(stagingDirectory)) {
        const content = await readFile(resolve(stagingDirectory, filePath));
        records.push({ path: filePath, digest: createHash('sha256').update(content).digest('hex') });
    }
    // 与 ProjectPackageStore 安装校验一致：按稳定 path 顺序计算总 digest。
    records.sort((left, right) => comparePaths(left.path, right.path));
    const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
    const digest = createHash('sha256')
        .update(records.map((record) => `${record.path}:${record.digest}`).join('\n'))
        .digest('hex');
    const packedManifestName = `${String(manifest.id)}.manifest.json`;
    await writeFile(
        resolve(stagingDirectory, packedManifestName),
        `${JSON.stringify(
            {
                ...manifest,
                main: `./${options.bundleFileName}`,
                package: {
                    ...(manifest.package ?? {}),
                    digest,
                    packedAt: DETERMINISTIC_PACKED_AT,
                    files: records,
                    libraries: [],
                },
            },
            null,
            4,
        )}\n`,
        'utf8',
    );
    await mkdir(releaseDirectory, { recursive: true });
    await cp(stagingDirectory, packageDirectory, { recursive: true });
    await rm(stagingDirectory, { recursive: true, force: true });
    return packageDirectory;
}
