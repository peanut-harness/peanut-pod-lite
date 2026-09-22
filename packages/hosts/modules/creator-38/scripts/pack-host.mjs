import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import {
    assertCreator383BundleCompatibility,
    stripNodeBuiltinProtocol,
} from '../../../../../scripts/creator-electron-bundle-normalize.mjs';
import { buildLiteReleaseArtifacts } from '../../../../../tools/build-release-artifacts.mts';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(extensionRoot, '../../../..');
const manifest = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
const rootManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
if (manifest.version !== rootManifest.version) {
    throw new Error('lite_release_identity_mismatch');
}
const outputDirectory = resolve(extensionRoot, 'release', `${manifest.name}-${manifest.version}`);
const mainBundlePath = resolve(outputDirectory, 'dist/main.js');
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(resolve(outputDirectory, 'dist'), { recursive: true });
await build({
    bundle: true,
    entryPoints: [resolve(extensionRoot, 'src/main.js')],
    format: 'cjs',
    platform: 'node',
    target: 'node14',
    outfile: mainBundlePath,
    legalComments: 'none',
    alias: {
        '@peanut/pod-hosts': resolve(repositoryRoot, 'packages/hosts/dist/index.js'),
        '@peanut/pod-engine/kernel': resolve(repositoryRoot, 'packages/engine/modules/kernel/dist/index.js'),
        '@peanut/pod-engine/runtime': resolve(repositoryRoot, 'packages/engine/modules/runtime/dist/index.js'),
        '@peanut/pod-engine/installation': resolve(repositoryRoot, 'packages/engine/modules/installation/dist/index.js'),
        '@peanut/pod-protocol': resolve(repositoryRoot, 'packages/protocol/dist/index.js'),
        '@peanut/pod-sdk': resolve(repositoryRoot, 'packages/sdk/dist/index.js'),
        '@peanut/pod-engine/assets': resolve(repositoryRoot, 'packages/engine/modules/assets/dist/index.js'),
    },
    plugins: [
        {
            name: 'creator-38-node-builtin-compatibility',
            setup(buildApi) {
                buildApi.onResolve({ filter: /^node:/ }, (args) => ({
                    path: args.path.slice('node:'.length),
                    external: true,
                }));
            },
        },
    ],
    // Creator Electron provides electron; keep it external.
    external: ['electron', 'canvas'],
});
const bundledMain = await readFile(mainBundlePath, 'utf8');
const normalizedMain = stripNodeBuiltinProtocol(bundledMain);
assertCreator383BundleCompatibility(normalizedMain);
if (normalizedMain !== bundledMain) {
    await writeFile(mainBundlePath, normalizedMain, 'utf8');
}
await writeFile(resolve(outputDirectory, 'dist/scene.js'), "'use strict';\nmodule.exports = {};\n", 'utf8');
await cp(resolve(extensionRoot, 'package.json'), resolve(outputDirectory, 'package.json'));
await cp(resolve(extensionRoot, 'panel'), resolve(outputDirectory, 'panel'), { recursive: true });
// Static Plugin Manager UI assets shared by the Creator host package.
await cp(resolve(repositoryRoot, 'apps/panel/panels'), resolve(outputDirectory, 'panels'), { recursive: true });
await writeFile(
    resolve(outputDirectory, 'README.md'),
    '# Peanut Pod Lite Host\n\nInstall this extension before the Lite directory package.\n\n- Extension > Cocos Plugin Manager\n- Extension > Peanut Account\n',
    'utf8',
);
const releaseArtifacts = await buildLiteReleaseArtifacts(repositoryRoot);
process.stdout.write(`${JSON.stringify({
    ok: true,
    outputDirectory,
    releaseDescriptor: releaseArtifacts.descriptorPath ?? null,
    releaseArtifactsSkipped: releaseArtifacts.skipped ?? false,
}, null, 2)}\n`);
