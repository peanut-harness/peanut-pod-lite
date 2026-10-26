import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { build, type Metafile } from 'esbuild';

const PREFIX = 'tests/fixtures/editor-stability/components/';
const INPUTS = Object.freeze([
    { source: `${PREFIX}component-existing-sprite-native-probe-main.ts`,
        sha256: '9d8efe0ca637b766b6168001be6d04774f2e710745c29d825386ae2729c17158', output: 'main.js' },
    { source: `${PREFIX}component-existing-sprite-native-probe-scene.ts`,
        sha256: '56d2c84c8de5f25d9c64c199c3095b5abb961b34b6720062055de5f931938d46', output: 'scene.js' },
]);
const EXTERNALS = new Set(['node:crypto', 'node:fs', 'node:path', 'cc']);

function sha(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function present(path: string): boolean { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
function regular(path: string): Buffer {
    if (!present(path)) throw new Error('component_sprite_probe_package_source_missing');
    if (!lstatSync(path).isFile() || realpathSync(path) !== path)
        throw new Error('component_sprite_probe_package_source_link');
    return readFileSync(path);
}

/**
 * Build an offline-only bundle in an empty owned temp directory; never stage an extension.
 */
export class ComponentExistingSpriteNativeProbePackage {
    public static readonly inputs = INPUTS;

    public static assertBundleClosure(meta: Metafile, source: string, output: string, repository: string): void {
        const files = Object.keys(meta.inputs);
        if (files.length !== 1 || resolve(repository, files[0]) !== resolve(repository, source))
            throw new Error('component_sprite_probe_package_transitive_source');
        const outputs = Object.entries(meta.outputs);
        if (outputs.length !== 1 || basename(outputs[0][0]) !== output)
            throw new Error('component_sprite_probe_package_output_invalid');
        for (const dependency of outputs[0][1].imports) {
            if (!dependency.external || !EXTERNALS.has(dependency.path) || dependency.kind !== 'require-call')
                throw new Error('component_sprite_probe_package_external_invalid');
        }
    }

    public static async build(repository: string, outputRoot: string): Promise<Record<string, unknown>> {
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
        const files: { path: string; sha256: string; bytes: Buffer }[] = [];
        for (const source of sources) {
            const result = await build({ entryPoints: [source.path], bundle: true, platform: 'node',
                format: 'cjs', target: 'node14', legalComments: 'none', external: [...EXTERNALS],
                outfile: join(destination, source.output), write: false, metafile: true });
            if (!result.metafile || result.outputFiles?.length !== 1)
                throw new Error('component_sprite_probe_package_bundle_missing');
            this.assertBundleClosure(result.metafile, source.source, source.output, root);
            if (sha(regular(source.path)) !== source.sha256)
                throw new Error('component_sprite_probe_package_source_changed_after_build');
            const bytes = Buffer.from(result.outputFiles[0].contents);
            files.push({ path: source.output, sha256: sha(bytes), bytes });
        }
        const manifest = {
            package_version: 2, name: 'peanut-component-sprite-probe', version: '0.1.0',
            private: true, peanutOfflineOnly: true, main: './main.js',
            contributions: { scene: { script: './scene.js' } },
            sourceDigests: Object.fromEntries(sources.map(row => [row.source, row.sha256])),
            bundleDigests: Object.fromEntries(files.map(row => [row.path, row.sha256])),
        };
        const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
        const output = [...files, { path: 'package.json', sha256: sha(manifestBytes), bytes: manifestBytes }];
        for (const file of output) {
            const path = join(destination, file.path);
            if (present(path)) throw new Error('component_sprite_probe_package_output_exists');
            writeFileSync(path, file.bytes, { flag: 'wx' });
        }
        return { schema: 'peanut.pod.component-existing-sprite-probe-package.v1',
            packageRoot: destination, probeId: manifest.name, probeVersion: manifest.version,
            separateFromProductCandidate: true, installable: false, executable: false,
            sourceFiles: sources.map(({ source, sha256 }) => ({ path: source, sha256 })),
            outputFiles: output.map(({ path, sha256 }) => ({ path, sha256 })),
            blockers: ['Creator_API_compatibility_unverified', 'runtime_entry_listener_not_wired',
                'native_readback_unverified', 'external_project_stage_and_lease_required'] };
    }
}
