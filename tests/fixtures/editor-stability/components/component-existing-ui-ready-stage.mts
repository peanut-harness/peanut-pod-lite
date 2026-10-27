import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentFormalSdkWorker } from './component-formal-sdk-worker.mts';
import { ComponentMatrixScope } from './component-matrix-scope.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Stage the frozen UI-ready compatibility only in one registered existing 0.2.1 project.
 */
export class ComponentExistingUiReadyStage {
    public static run(version: '3.8.3' | '3.8.7', actor = process.env.CODEX_THREAD_ID ?? '') {
        const owner = ComponentTaskOwnership.current(root, actor);
        const project = join(realpathSync(join(root, '../../..')),
            `.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-${version}`);
        const scope = ComponentMatrixScope.locate(root, project);
        if (scope.mode !== 'existing' || realpathSync(project) !== project) throw new Error('component_existing_ui_scope_invalid');
        const processes = execFileSync('/bin/ps', ['-axo', 'args=', '-ww'], { encoding: 'utf8' });
        if (processes.split('\n').some(line => line.includes(`--project ${project}`))) throw new Error('component_existing_ui_occupied');
        const local = join(project, 'extensions/peanut-component-probe/project-ownership.json');
        const remote = join(scope.output, 'project-ownership.json');
        const original = readFileSync(local);
        if (!original.equals(readFileSync(remote))) throw new Error('component_existing_ui_registration_diverged');
        const registration = JSON.parse(original.toString('utf8'));
        if (registration.owner !== owner || registration.creatorVersion !== version
            || registration.kind !== 'registered-existing-0.2.1-project' || registration.sdkUiReadyCompat !== undefined
            || version === '3.8.3' && registration.sdkSceneCacheCompat !== true)
            throw new Error('component_existing_ui_registration_invalid');
        const extension = join(project, 'extensions/peanut-component-sdk-compat');
        const receipt = join(scope.output, 'ui-ready-stage.json');
        if (existsSync(extension) || existsSync(receipt)) throw new Error('component_existing_ui_stage_exists');
        const formal = version === '3.8.7' ? ComponentFormalSdkWorker.source(join(root, 'release/peanut.pod-lite-0.2.1'),
            JSON.parse(readFileSync(join(root, 'release/peanut.pod-lite-0.2.1/lite-release-descriptor.json'), 'utf8')).sourceCommit, version) : null;
        if (version === '3.8.7') {
            if (!formal || formal.hostSha256 !== registration.hostSha256
                || formal.hostPackageDigest !== registration.hostPackageDigest) throw new Error('component_existing_ui_formal_source_invalid');
            ComponentFormalSdkWorker.assertInstalled(project, { ...registration, candidateSourceCommit: formal.sourceCommit,
                formalSdkStartupTimer: formal }, formal);
        }
        const enabled = Buffer.from(JSON.stringify({ ...registration, sdkUiReadyCompat: true,
            ...(version === '3.8.7' ? { sdkListenerCompat: true, formalSdkStartupTimer: formal } : {}) }, null, 2) + '\n');
        const manifest = Buffer.from(JSON.stringify({ package_version: 2, name: 'peanut-component-sdk-compat',
            version: '0.1.0', main: './main.js', contributions: version === '3.8.7'
                ? { scene: { script: './scene.js' } } : {} }, null, 2) + '\n');
        const outputs = [
            ['component-sdk-timer-trace-main.ts', 'main.js'],
            ['component-sdk-ui-ready-window.ts', 'ui-ready.js'],
            ...(version === '3.8.7' ? [['component-sdk-listener-scene.ts', 'scene.js']] : []),
        ];
        const bundles = outputs.map(([source, target]) => ({ target, bytes: buildSync({
            entryPoints: [fileURLToPath(new URL(source, import.meta.url))], bundle: true,
            platform: 'node', format: 'cjs', target: 'node14', external: ['cc'], write: false,
        }).outputFiles[0]?.contents }));
        if (bundles.some(bundle => !bundle.bytes)) throw new Error('component_existing_ui_bundle_missing');
        const temporary = [local + '.ui-ready.tmp', remote + '.ui-ready.tmp'];
        try {
            mkdirSync(extension);
            writeFileSync(join(extension, 'package.json'), manifest, { flag: 'wx' });
            for (const bundle of bundles) writeFileSync(join(extension, bundle.target), bundle.bytes!, { flag: 'wx' });
            writeFileSync(temporary[0], enabled, { flag: 'wx' });
            writeFileSync(temporary[1], enabled, { flag: 'wx' });
            renameSync(temporary[0], local); renameSync(temporary[1], remote);
            const result = { schema: 'peanut.component-existing-ui-ready-stage.v1', projectPath: project, creatorVersion: version,
                owner, candidateVersion: '0.2.1', registrationBeforeSha256: hash(original),
                registrationAfterSha256: hash(enabled), packageSha256: hash(manifest),
                bundles: Object.fromEntries(bundles.map(item => [item.target, hash(item.bytes!)])),
                formalSdkStartupTimer: formal, nativePassedRows: 0 };
            writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
            return result;
        } catch (error) {
            if (existsSync(local) && hash(readFileSync(local)) === hash(enabled)) writeFileSync(local, original);
            if (existsSync(remote) && hash(readFileSync(remote)) === hash(enabled)) writeFileSync(remote, original);
            for (const file of temporary) if (existsSync(file)) rmSync(file);
            if (existsSync(extension)) rmSync(extension, { recursive: true });
            throw error;
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const version = process.argv[process.argv.indexOf('--version') + 1];
    if (!['3.8.3', '3.8.7'].includes(version) || process.argv.length !== 4)
        throw new Error('component_existing_ui_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingUiReadyStage.run(version as '3.8.3' | '3.8.7')) + '\n');
}
