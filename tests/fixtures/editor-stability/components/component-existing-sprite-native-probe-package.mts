import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { build, type Metafile, type Plugin } from 'esbuild';

const PREFIX = 'tests/fixtures/editor-stability/components/';
const ACCEPTED_SOURCE_COMMIT = '371445bb78a1f3e64bb1aa788ba437b694a126c3';
const INPUTS = Object.freeze([
    { source: `${PREFIX}component-existing-sprite-native-probe-entry.ts`,
        sha256: '0c0fb92cae04e6f1c923d0ac95b4ab7badfe877aa5c15a2ac91b1839f4b62d68', bundle: 'main.js' },
    { source: `${PREFIX}component-existing-sprite-native-probe-main.ts`,
        sha256: '8e4dd0a03d14f42dffee9a341736dc44d3a3174f69baf2ce69928a6ac1072e63', bundle: 'main.js' },
    { source: `${PREFIX}component-existing-sprite-probe-descriptor.ts`,
        sha256: 'cd96a1a06da4ee137711b4e02e0649c249ec57fd46de39136b4d9a69fc0ddbca', bundle: 'main.js' },
    { source: `${PREFIX}component-existing-sprite-native-probe-scene.ts`,
        sha256: '56d2c84c8de5f25d9c64c199c3095b5abb961b34b6720062055de5f931938d46', bundle: 'scene.js' },
]);
const BUILTINS = new Set(['crypto', 'fs', 'http', 'os', 'path']);
const EXTERNALS = new Set([...BUILTINS, 'cc']);
const creatorBuiltinCompat: Plugin = { name: 'creator-builtin-compat', setup(plugin) {
    plugin.onResolve({ filter: /^node:/ }, ({ path }) => {
        const builtin = path.slice('node:'.length);
        if (!BUILTINS.has(builtin)) throw new Error('component_sprite_probe_package_external_invalid');
        return { path: builtin, external: true };
    });
} };
const BUNDLES = Object.freeze([
    { entry: INPUTS[0].source, source: [INPUTS[0].source, INPUTS[1].source, INPUTS[2].source], output: 'main.js' },
    { entry: INPUTS[3].source, source: [INPUTS[3].source], output: 'scene.js' },
]);

function sha(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
function regular(path: string): Buffer {
    if (!present(path)) throw new Error('component_sprite_probe_package_source_missing');
    if (!lstatSync(path).isFile() || lstatSync(path).nlink !== 1 || realpathSync(path) !== path)
        throw new Error('component_sprite_probe_package_source_link');
    return readFileSync(path);
}

/**
 * Build a private offline or bounded diagnostic bundle in an empty owned temp directory.
 */
export class ComponentExistingSpriteNativeProbePackage {
    public static readonly inputs = INPUTS;

    public static assertBundleClosure(meta: Metafile, sources: readonly string[], output: string, repository: string): void {
        const allowed = new Set(sources.map(source => resolve(repository, source)));
        const files = Object.keys(meta.inputs).map(file => resolve(repository, file));
        if (files.length !== allowed.size || files.some(file => !allowed.has(file)))
            throw new Error('component_sprite_probe_package_transitive_source');
        const outputs = Object.entries(meta.outputs);
        if (outputs.length !== 1 || basename(outputs[0][0]) !== output)
            throw new Error('component_sprite_probe_package_output_invalid');
        const bundledInputs = Object.keys(outputs[0][1].inputs).map(file => resolve(repository, file));
        if (bundledInputs.length !== allowed.size || bundledInputs.some(file => !allowed.has(file)))
            throw new Error('component_sprite_probe_package_transitive_source');
        for (const input of Object.values(meta.inputs)) {
            for (const dependency of input.imports) {
                if (dependency.external) {
                    if (!EXTERNALS.has(dependency.path)
                        || !['import-statement', 'require-call'].includes(dependency.kind))
                        throw new Error('component_sprite_probe_package_external_invalid');
                } else if (dependency.kind !== 'import-statement'
                    || !allowed.has(resolve(repository, dependency.path)))
                    throw new Error('component_sprite_probe_package_transitive_source');
            }
        }
        for (const dependency of outputs[0][1].imports) {
            if (!dependency.external || !EXTERNALS.has(dependency.path) || dependency.kind !== 'require-call')
                throw new Error('component_sprite_probe_package_external_invalid');
        }
    }

    public static async build(repository: string, outputRoot: string,
        mode: 'offline' | 'diagnostic-383' = 'offline'): Promise<Record<string, unknown>> {
        if (mode !== 'offline' && mode !== 'diagnostic-383')
            throw new Error('component_sprite_probe_package_mode_invalid');
        const root = realpathSync(repository);
        const destination = realpathSync(outputRoot);
        if (root !== resolve(repository) || destination !== resolve(outputRoot)
            || !destination.startsWith(`${realpathSync(tmpdir())}${sep}`)
            || !basename(destination).startsWith('component-sprite-probe-package-')
            || !lstatSync(destination).isDirectory() || readdirSync(destination).length !== 0)
            throw new Error('component_sprite_probe_package_output_root_invalid');
        const sources = INPUTS.map(row => {
            const path = resolve(root, row.source);
            if (!path.startsWith(`${root}${sep}`)) throw new Error('component_sprite_probe_package_source_escape');
            if (sha(regular(path)) !== row.sha256) throw new Error('component_sprite_probe_package_source_sha_mismatch');
            return { ...row, path };
        });
        const checkoutCommit = execFileSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'],
            { cwd: root, encoding: 'utf8' }).trim();
        if (!/^[a-f0-9]{40}$/u.test(checkoutCommit))
            throw new Error('component_sprite_probe_package_source_commit_invalid');
        execFileSync('git', ['-c', 'core.fsmonitor=false', 'merge-base', '--is-ancestor',
            ACCEPTED_SOURCE_COMMIT, checkoutCommit], { cwd: root, stdio: 'ignore' });
        for (const source of sources) {
            const accepted = execFileSync('git', ['-c', 'core.fsmonitor=false', 'show',
                `${ACCEPTED_SOURCE_COMMIT}:${source.source}`], { cwd: root });
            if (!accepted.equals(regular(source.path)) || sha(accepted) !== source.sha256)
                throw new Error('component_sprite_probe_package_accepted_source_drift');
        }
        const sourceCommit = ACCEPTED_SOURCE_COMMIT;
        const files: { path: string; sha256: string; bytes: Buffer }[] = [];
        for (const bundle of BUNDLES) {
            const result = await build({ entryPoints: [resolve(root, bundle.entry)], bundle: true, platform: 'node',
                format: 'cjs', target: 'node12', legalComments: 'none', external: [...EXTERNALS],
                plugins: [creatorBuiltinCompat],
                outfile: join(destination, bundle.output), write: false, metafile: true });
            if (!result.metafile || result.outputFiles?.length !== 1)
                throw new Error('component_sprite_probe_package_bundle_missing');
            this.assertBundleClosure(result.metafile, bundle.source, bundle.output, root);
            for (const source of sources.filter(row => row.bundle === bundle.output)) {
                if (sha(regular(source.path)) !== source.sha256)
                    throw new Error('component_sprite_probe_package_source_changed_after_build');
            }
            const bytes = Buffer.from(result.outputFiles[0].contents);
            if (/\brequire\s*\(\s*['"]node:/u.test(bytes.toString('utf8')))
                throw new Error('component_sprite_probe_package_external_invalid');
            files.push({ path: bundle.output, sha256: sha(bytes), bytes });
        }
        const manifest = {
            package_version: 2, name: 'peanut-component-sprite-probe', version: '0.1.0',
            private: true, peanutOfflineOnly: mode === 'offline',
            peanutDiagnosticOnly: mode === 'diagnostic-383', nativeCompatible: null,
            ...(mode === 'diagnostic-383' ? { diagnosticTargetVersion: '3.8.3',
                diagnosticAction: 'existingAssetIdentity' } : {}), main: './main.js',
            probeSourceCommit: sourceCommit,
            contributions: { scene: { script: './scene.js' } },
            sourceDigests: Object.fromEntries(sources.map(row => [row.source, row.sha256])),
            bundleDigests: Object.fromEntries(files.map(row => [row.path, row.sha256])),
        };
        const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
        const output = [...files, { path: 'package.json', sha256: sha(manifestBytes), bytes: manifestBytes }];
        const packageSha256 = sha(JSON.stringify({ main: files[0].sha256,
            scene: files[1].sha256, manifest: sha(manifestBytes) }));
        for (const file of output) {
            const path = join(destination, file.path);
            if (present(path)) throw new Error('component_sprite_probe_package_output_exists');
            writeFileSync(path, file.bytes, { flag: 'wx' });
        }
        return { schema: 'peanut.pod.component-existing-sprite-probe-package.v2',
            packageRoot: destination, probeId: manifest.name, probeVersion: manifest.version,
            separateFromProductCandidate: true, installable: false, executable: false,
            diagnosticMode: mode === 'diagnostic-383', nativeCompatible: null, nativeAccepted: false,
            sourceCommit, checkoutCommit, packagerSourceSha256: sha(regular(resolve(root,
                `${PREFIX}component-existing-sprite-native-probe-package.mts`))), packageSha256,
            sourceFiles: sources.map(({ source, sha256 }) => ({ path: source, sha256 })),
            outputFiles: output.map(({ path, sha256 }) => ({ path, sha256 })),
            blockers: ['Creator_API_compatibility_unverified', 'real_lease_and_stage_unregistered',
                'native_readback_unverified', 'external_project_stage_and_lease_required'] };
    }
}
