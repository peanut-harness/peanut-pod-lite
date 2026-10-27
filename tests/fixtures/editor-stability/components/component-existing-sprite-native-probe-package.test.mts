import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
    symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { Metafile } from 'esbuild';
import { ComponentExistingSpriteNativeProbePackage as Package } from './component-existing-sprite-native-probe-package.mts';

const repository = resolve(import.meta.dirname, '../../../..');
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function scratch(): string { return realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-probe-package-'))); }
const creatorExternals = new Set(['crypto', 'fs', 'http', 'os', 'path', 'cc']);

function loadInRestrictedRuntime(bytes: Buffer): { exports: Record<string, () => Promise<void>>;
    required: string[] } {
    const module = { exports: {} as Record<string, () => Promise<void>> };
    const required: string[] = [];
    runInNewContext(bytes.toString('utf8'), { module, exports: module.exports, Buffer, process,
        setTimeout, clearTimeout, require: (name: string) => {
            required.push(name);
            if (!creatorExternals.has(name)) throw new Error(`unknown_creator_external:${name}`);
            return name === 'cc' ? {} : createRequire(import.meta.url)(name);
        } }, { filename: 'creator-probe-bundle.js', timeout: 1000 });
    return { exports: module.exports, required };
}

test('offline package pins entry, descriptor, dispatcher and scene sources and three private outputs', async () => {
    const destination = scratch();
    try {
        const report = await Package.build(repository, destination);
        assert.deepEqual(readdirSync(destination).sort(), ['main.js', 'package.json', 'scene.js']);
        assert.equal(report.packageRoot, destination);
        assert.equal(report.installable, false);
        assert.equal(report.executable, false);
        assert.equal(report.separateFromProductCandidate, true);
        const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'));
        assert.equal(manifest.private, true);
        assert.equal(manifest.peanutOfflineOnly, true);
        assert.equal(manifest.name, 'peanut-component-sprite-probe');
        assert.equal(manifest.probeSourceCommit, '61fcce7509044d4715b25462dde2849dc929c1a1');
        assert.equal(report.sourceCommit, manifest.probeSourceCommit);
        assert.equal(report.checkoutCommit,
            execFileSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'],
                { cwd: repository, encoding: 'utf8' }).trim());
        assert.notEqual(report.checkoutCommit, report.sourceCommit);
        assert.equal(report.packagerSourceSha256,
            digest(readFileSync(join(repository, 'tests/fixtures/editor-stability/components/component-existing-sprite-native-probe-package.mts'))));
        assert.deepEqual(Object.keys(manifest.sourceDigests).sort(), Package.inputs.map(row => row.source).sort());
        for (const row of Package.inputs) {
            assert.equal(manifest.sourceDigests[row.source], digest(readFileSync(join(repository, row.source))));
            assert.equal(manifest.bundleDigests[row.bundle], digest(readFileSync(join(destination, row.bundle))));
        }
        const packageSha = digest(Buffer.from(JSON.stringify({
            main: manifest.bundleDigests['main.js'], scene: manifest.bundleDigests['scene.js'],
            manifest: digest(readFileSync(join(destination, 'package.json'))),
        })));
        assert.equal(report.packageSha256, packageSha);
        const bundled = createRequire(import.meta.url)(join(destination, 'main.js'));
        assert.equal(typeof bundled.load, 'function');
        assert.equal(typeof bundled.unload, 'function');
        await assert.rejects(bundled.load(), /version_unregistered/);
        assert.equal(JSON.stringify(report).includes('nativeAccepted":true'), false);
    } finally { rmSync(destination, { recursive: true, force: true }); }
});

test('diagnostic package is fixed to 3.8.3 existing asset and remains unaccepted', async () => {
    const destination = scratch(); const second = scratch();
    try {
        const report = await Package.build(repository, destination, 'diagnostic-383');
        const repeat = await Package.build(repository, second, 'diagnostic-383');
        const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'));
        assert.equal(manifest.private, true);
        assert.equal(manifest.peanutOfflineOnly, false);
        assert.equal(manifest.peanutDiagnosticOnly, true);
        assert.equal(manifest.nativeCompatible, null);
        assert.equal(manifest.diagnosticTargetVersion, '3.8.3');
        assert.equal(manifest.diagnosticAction, 'existingAssetIdentity');
        assert.equal(report.diagnosticMode, true);
        assert.equal(report.installable, false);
        assert.equal(report.nativeAccepted, false);
        assert.deepEqual(readdirSync(destination).sort(), ['main.js', 'package.json', 'scene.js']);
        const expected = digest(Buffer.from(JSON.stringify({
            main: manifest.bundleDigests['main.js'], scene: manifest.bundleDigests['scene.js'],
            manifest: digest(readFileSync(join(destination, 'package.json'))),
        })));
        assert.equal(report.packageSha256, expected);
        assert.equal(report.packageSha256, '985237d405c0f49dc9b29a8d09d5fbc2065f43a0705e8173c63b56ccb72e45a5');
        assert.equal(repeat.packageSha256, report.packageSha256);
        for (const file of ['main.js', 'scene.js', 'package.json'])
            assert.deepEqual(readFileSync(join(second, file)), readFileSync(join(destination, file)));
        const main = loadInRestrictedRuntime(readFileSync(join(destination, 'main.js')));
        const scene = loadInRestrictedRuntime(readFileSync(join(destination, 'scene.js')));
        assert.equal(typeof main.exports.load, 'function');
        assert.equal(typeof main.exports.unload, 'function');
        assert.ok(main.required.includes('crypto'));
        assert.ok(main.required.every(name => creatorExternals.has(name) && !name.startsWith('node:')));
        assert.ok(scene.required.every(name => creatorExternals.has(name) && !name.startsWith('node:')));
        await assert.rejects(main.exports.load(), /version_unregistered/);
        await main.exports.unload();
    } finally {
        rmSync(destination, { recursive: true, force: true });
        rmSync(second, { recursive: true, force: true });
    }
});

test('changed or linked source refuses before producing an output', async () => {
    const root = scratch(); const destination = scratch();
    try {
        const relative = Package.inputs[0].source;
        const path = join(root, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, Buffer.concat([readFileSync(join(repository, relative)), Buffer.from('\n// tampered\n')]));
        const second = Package.inputs[1].source;
        writeFileSync(join(root, second), readFileSync(join(repository, second)));
        await assert.rejects(Package.build(root, destination), /source_sha_mismatch/);
        assert.deepEqual(readdirSync(destination), []);
        rmSync(path);
        symlinkSync(join(repository, relative), path);
        await assert.rejects(Package.build(root, destination), /source_link/);
        assert.deepEqual(readdirSync(destination), []);
    } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(destination, { recursive: true, force: true });
    }
});

test('nonempty, linked or nonowned output roots refuse without overwriting', async () => {
    const destination = scratch(); const alias = `${destination}-alias`;
    try {
        writeFileSync(join(destination, 'sentinel'), 'keep');
        await assert.rejects(Package.build(repository, destination), /output_root_invalid/);
        assert.equal(readFileSync(join(destination, 'sentinel'), 'utf8'), 'keep');
        symlinkSync(destination, alias);
        await assert.rejects(Package.build(repository, alias), /output_root_invalid/);
        assert.equal(lstatSync(alias).isSymbolicLink(), true);
        await assert.rejects(Package.build(repository, repository), /output_root_invalid/);
    } finally {
        rmSync(alias, { force: true });
        rmSync(destination, { recursive: true, force: true });
    }
});

test('bundle closure refuses extra source, output, dynamic or unknown external imports', () => {
    const source = Package.inputs[0].source;
    const included = [source, Package.inputs[1].source, Package.inputs[2].source];
    const input = { bytes: 1, imports: [], format: 'esm' as const };
    const output = { bytes: 1, inputs: Object.fromEntries(included.map(file => [file, { bytesInOutput: 1 }])),
        imports: [] as Metafile['outputs'][string]['imports'],
        exports: [], entryPoint: source };
    const meta = (inputs: Record<string, typeof input>, outputs: Record<string, typeof output>): Metafile =>
        ({ inputs, outputs });
    const key = 'main.js';
    const inputs = Object.fromEntries(included.map(file => [file, input]));
    Package.assertBundleClosure(meta(inputs, { [key]: output }), included, key, repository);
    assert.throws(() => Package.assertBundleClosure(meta({ [source]: input,
        'unregistered.ts': input }, { [key]: output }), included, key, repository), /transitive_source/);
    assert.throws(() => Package.assertBundleClosure(meta(inputs, {
        [key]: output, 'extra.js': output }), included, key, repository), /output_invalid/);
    for (const dependency of [{ path: 'other', kind: 'require-call' as const, external: true },
        { path: 'node:fs', kind: 'dynamic-import' as const, external: true },
        { path: 'node:fs', kind: 'require-call' as const, external: false }]) {
        const imported = { ...output, imports: [dependency] };
        assert.throws(() => Package.assertBundleClosure(meta(inputs, {
            [key]: imported }), included, key, repository), /external_invalid/);
    }
    assert.throws(() => Package.assertBundleClosure(meta(inputs, {
        [key]: { ...output, inputs: { [source]: { bytesInOutput: 1 } } } }), included, key, repository), /transitive_source/);
});
