import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentFormalSdkWorker } from './component-formal-sdk-worker.mts';
import { ComponentMatrixScope } from './component-matrix-scope.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Stage a read-only lifecycle trace in the exact existing 3.8.7 project after its failed run.
 */
export class ComponentExistingFormalWorkerObserverStage {
    public static run(actor = process.env.CODEX_THREAD_ID ?? '') {
        const owner = ComponentTaskOwnership.current(root, actor);
        const project = join(realpathSync(join(root, '../../..')),
            '.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7');
        const scope = ComponentMatrixScope.locate(root, project);
        if (scope.mode !== 'existing' || realpathSync(project) !== project) throw new Error('component_formal_worker_observer_scope_invalid');
        if (execFileSync('/bin/ps', ['-axo', 'args=', '-ww'], { encoding: 'utf8' }).split('\n')
            .some(line => line.includes(`--project ${project}`))) throw new Error('component_formal_worker_observer_occupied');
        const local = join(project, 'extensions/peanut-component-probe/project-ownership.json');
        const remote = join(scope.output, 'project-ownership.json');
        const original = readFileSync(local);
        if (!original.equals(readFileSync(remote))) throw new Error('component_formal_worker_observer_registration_diverged');
        const registration = JSON.parse(original.toString('utf8'));
        if (registration.owner !== owner || registration.kind !== 'registered-existing-0.2.1-project'
            || registration.creatorVersion !== '3.8.7' || registration.sdkUiReadyCompat !== true
            || registration.sdkFormalTimerTrace !== undefined) throw new Error('component_formal_worker_observer_registration_invalid');
        const extension = join(project, 'extensions/peanut-component-sdk-compat');
        const manifestPath = join(extension, 'package.json');
        const originalManifest = readFileSync(manifestPath);
        const parsed = JSON.parse(originalManifest.toString('utf8'));
        if (parsed.name !== 'peanut-component-sdk-compat' || parsed.contributions?.['asset-db'] !== undefined)
            throw new Error('component_formal_worker_observer_manifest_invalid');
        const descriptor = JSON.parse(readFileSync(join(root, 'release/peanut.pod-lite-0.2.1/lite-release-descriptor.json'), 'utf8'));
        const formal = ComponentFormalSdkWorker.source(join(root, 'release/peanut.pod-lite-0.2.1'), descriptor.sourceCommit, '3.8.7');
        if (!formal || formal.hostSha256 !== registration.hostSha256) throw new Error('component_formal_worker_observer_source_invalid');
        ComponentFormalSdkWorker.assertInstalled(project, { ...registration, candidateSourceCommit: formal.sourceCommit,
            formalSdkStartupTimer: formal }, formal);
        const enabled = Buffer.from(JSON.stringify({ ...registration, formalSdkStartupTimer: formal,
            sdkFormalTimerTrace: true }, null, 2) + '\n');
        const manifest = Buffer.from(JSON.stringify({ ...parsed, contributions: { ...parsed.contributions,
            'asset-db': { script: './worker-observe.js', 'global-hook': ['afterInit', 'beforePreStart', 'beforeReady'] } } }, null, 2) + '\n');
        const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./component-sdk-formal-worker-observer.ts', import.meta.url))],
            bundle: true, platform: 'node', format: 'cjs', target: 'node14', write: false }).outputFiles[0]?.contents;
        if (!bundle) throw new Error('component_formal_worker_observer_bundle_missing');
        const workerPath = join(extension, 'worker-observe.js');
        const receipt = join(scope.output, 'formal-worker-observer-stage.json');
        if (existsSync(workerPath) || existsSync(receipt)) throw new Error('component_formal_worker_observer_stage_exists');
        const temporary = [local + '.formal-observer.tmp', remote + '.formal-observer.tmp', manifestPath + '.formal-observer.tmp'];
        try {
            writeFileSync(workerPath, bundle, { flag: 'wx' });
            writeFileSync(temporary[0], enabled, { flag: 'wx' });
            writeFileSync(temporary[1], enabled, { flag: 'wx' });
            writeFileSync(temporary[2], manifest, { flag: 'wx' });
            renameSync(temporary[0], local); renameSync(temporary[1], remote); renameSync(temporary[2], manifestPath);
            const result = { schema: 'peanut.component-formal-worker-observer-stage.v1', projectPath: project, owner,
                registrationBeforeSha256: hash(original), registrationAfterSha256: hash(enabled),
                manifestBeforeSha256: hash(originalManifest), manifestAfterSha256: hash(manifest), bundleSha256: hash(bundle),
                formalSdkStartupTimer: formal, nativePassedRows: 0 };
            writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
            return result;
        } catch (error) {
            if (existsSync(local) && hash(readFileSync(local)) === hash(enabled)) writeFileSync(local, original);
            if (existsSync(remote) && hash(readFileSync(remote)) === hash(enabled)) writeFileSync(remote, original);
            if (existsSync(manifestPath) && hash(readFileSync(manifestPath)) === hash(manifest)) writeFileSync(manifestPath, originalManifest);
            for (const file of temporary) if (existsSync(file)) rmSync(file);
            if (existsSync(workerPath)) rmSync(workerPath);
            throw error;
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length !== 2) throw new Error('component_formal_worker_observer_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingFormalWorkerObserverStage.run()) + '\n');
}
