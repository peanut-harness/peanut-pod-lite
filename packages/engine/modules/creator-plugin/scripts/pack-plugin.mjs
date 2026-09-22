import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
    assertCreator383BundleCompatibility,
    stripNodeBuiltinProtocol,
} from '../../../../../scripts/creator-electron-bundle-normalize.mjs';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = resolve(pluginRoot, '..');
const repositoryRoot = resolve(pluginRoot, '../../../..');
const sourceManifestName = 'peanut.pod-lite.manifest.json';
const bundleFileName = 'peanut.pod-lite.bundle.js';
const deterministicPackedAt = '1970-01-01T00:00:00.000Z';
const rootManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(resolve(pluginRoot, sourceManifestName), 'utf8'));
if (sourceManifest.version !== rootManifest.version) {
    throw new Error('lite_release_identity_mismatch');
}
const releaseDirectoryName = `${sourceManifest.id}-${rootManifest.version}`;
const entryPath = resolve(pluginRoot, 'dist/index.js');
const releaseDirectory = resolve(pluginRoot, 'release');
const stagingDirectory = resolve(pluginRoot, '.package-staging');
const packageDirectory = resolve(releaseDirectory, releaseDirectoryName);
const assetsDirectory = resolve(pluginRoot, 'assets');
const bundlePath = resolve(stagingDirectory, bundleFileName);

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
        if (entry.isFile() && entry.name !== '.DS_Store') {
            files.push(entry.name);
        }
    }
    return files;
}

await rm(stagingDirectory, { recursive: true, force: true });
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });

if (existsSync(assetsDirectory)) {
    await cp(assetsDirectory, resolve(stagingDirectory, 'assets'), { recursive: true });
}

await build({
    bundle: true,
    entryPoints: [entryPath],
    format: 'cjs',
    platform: 'node',
    target: 'es2021',
    outfile: bundlePath,
    legalComments: 'none',
    external: ['canvas'],
});

const bundled = await readFile(bundlePath, 'utf8');
const normalized = stripNodeBuiltinProtocol(bundled);
assertCreator383BundleCompatibility(normalized);
if (normalized !== bundled) {
    await writeFile(bundlePath, normalized, 'utf8');
}

const libsDirectory = resolve(stagingDirectory, 'libs');
await mkdir(libsDirectory, { recursive: true });
await writeFile(resolve(libsDirectory, '.keep'), '', 'utf8');

const lumenBundled = resolve(packagesRoot, 'lumen/bundled');
if (existsSync(lumenBundled)) {
    await cp(lumenBundled, resolve(stagingDirectory, 'bundled'), { recursive: true });
}
const lumen24Prefabs = resolve(packagesRoot, 'lumen-24/bundled/default_prefab_24');
if (existsSync(lumen24Prefabs)) {
    await cp(lumen24Prefabs, resolve(stagingDirectory, 'bundled', 'default_prefab_24'), { recursive: true });
}

await writeFile(resolve(stagingDirectory, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 4)}\n`, 'utf8');

const records = [];
for (const filePath of await listFiles(stagingDirectory)) {
    const content = await readFile(resolve(stagingDirectory, filePath));
    records.push({ path: filePath, digest: createHash('sha256').update(content).digest('hex') });
}
records.sort((left, right) => comparePaths(left.path, right.path));
const manifest = sourceManifest;
const digest = createHash('sha256')
    .update(records.map((record) => `${record.path}:${record.digest}`).join('\n'))
    .digest('hex');
const packedManifestName = `${String(manifest.id)}.manifest.json`;
await writeFile(
    resolve(stagingDirectory, packedManifestName),
    `${JSON.stringify(
        {
            ...manifest,
            main: `./${bundleFileName}`,
            package: {
                ...(manifest.package ?? {}),
                digest,
                packedAt: deterministicPackedAt,
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
process.stdout.write(`${JSON.stringify({ ok: true, outputDirectory: packageDirectory }, null, 2)}\n`);
