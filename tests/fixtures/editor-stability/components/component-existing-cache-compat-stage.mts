import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { ComponentMatrixScope } from './component-matrix-scope.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
const project = join(realpathSync(join(root, '../../..')), '.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Stage the already verified 3.8.3 scene-cache compatibility in the exact existing project.
 */
export class ComponentExistingCacheCompatStage {
    public static run(actor = process.env.CODEX_THREAD_ID ?? '') {
        const owner = ComponentTaskOwnership.current(root, actor);
        const scope = ComponentMatrixScope.locate(root, project);
        if (scope.mode !== 'existing' || realpathSync(project) !== project) throw new Error('component_existing_cache_scope_invalid');
        const processes = execFileSync('/bin/ps', ['-axo', 'args=', '-ww'], { encoding: 'utf8' });
        if (processes.split('\n').some(line => line.includes(`--project ${project}`))) throw new Error('component_existing_cache_occupied');
        const local = join(project, 'extensions/peanut-component-probe/project-ownership.json');
        const remote = join(scope.output, 'project-ownership.json');
        const original = readFileSync(local);
        if (!original.equals(readFileSync(remote))) throw new Error('component_existing_cache_registration_diverged');
        const registration = JSON.parse(original.toString('utf8'));
        if (registration.owner !== owner || registration.creatorVersion !== '3.8.3'
            || registration.kind !== 'registered-existing-0.2.1-project'
            || registration.sdkSceneCacheCompat !== undefined) throw new Error('component_existing_cache_registration_invalid');
        const extension = join(project, 'extensions/peanut-component-cache-compat');
        const receipt = join(scope.output, 'cache-compat-stage.json');
        if (existsSync(extension) || existsSync(receipt)) throw new Error('component_existing_cache_stage_exists');
        const bundle = buildSync({ entryPoints: [fileURLToPath(new URL('./component-sdk-scene-cache-main.ts', import.meta.url))],
            bundle: true, platform: 'node', format: 'cjs', target: 'node14', write: false }).outputFiles;
        if (bundle?.length !== 1) throw new Error('component_existing_cache_bundle_missing');
        const enabled = Buffer.from(JSON.stringify({ ...registration, sdkSceneCacheCompat: true }, null, 2) + '\n');
        const manifest = Buffer.from(JSON.stringify({ package_version: 2, name: 'peanut-component-cache-compat',
            version: '0.1.0', main: './main.js' }, null, 2) + '\n');
        const temporary = [local + '.cache-compat.tmp', remote + '.cache-compat.tmp'];
        try {
            mkdirSync(extension);
            writeFileSync(join(extension, 'package.json'), manifest, { flag: 'wx' });
            writeFileSync(join(extension, 'main.js'), bundle[0].contents, { flag: 'wx' });
            writeFileSync(temporary[0], enabled, { flag: 'wx' });
            writeFileSync(temporary[1], enabled, { flag: 'wx' });
            renameSync(temporary[0], local); renameSync(temporary[1], remote);
            const result = { schema: 'peanut.component-existing-cache-compat-stage.v1', projectPath: project,
                creatorVersion: '3.8.3', owner, candidateVersion: '0.2.1',
                registrationBeforeSha256: hash(original), registrationAfterSha256: hash(enabled),
                packageSha256: hash(manifest), bundleSha256: hash(bundle[0].contents),
                source: 'component-sdk-scene-cache-main.ts', nativePassedRows: 0 };
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
    if (process.argv.length !== 2) throw new Error('component_existing_cache_arguments_invalid');
    process.stdout.write(JSON.stringify(ComponentExistingCacheCompatStage.run()) + '\n');
}
