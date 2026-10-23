import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync, openSync, closeSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const releaseVerifierPath = new URL('../../../../../tools/release-candidate.mts', import.meta.url);
const { verifyReleaseCandidate } = await import(releaseVerifierPath.href) as { verifyReleaseCandidate: (path: string, expected: { expectedVersion: string; expectedSourceCommit: string }) => { host: { sha256: string }; core: { sha256: string } } };
import { ComponentEngineProfile } from '../../../../../tests/fixtures/editor-stability/components/component-engine-profile.mts';
import { ComponentEngineModules } from '../../../../../tests/fixtures/editor-stability/components/component-engine-modules.mts';
import { ComponentServiceProfile } from '../../../../../tests/fixtures/editor-stability/components/component-service-profile.mts';
import { ComponentTaskOwnership } from '../../../../../tests/fixtures/editor-stability/components/component-task-ownership.mts';
import { ComponentCreatorDiagnostics } from '../../../../../tests/fixtures/editor-stability/components/component-creator-diagnostics.mts';

/**
 * @description 4.3 独占隔离工程的外层 npm 启动入口；记录 PID、启动时间与完整二进制日志。
 */
class ResourceCreatorSession {
    /**
     * @description 启动前核对工作树内登记、候选、精确版本及同工程进程互斥。
     */
    public static preflight(): { registration: Record<string, string> & { offlineServiceProfile?: boolean }; project: string; output: string; binary: string; sameVersion: boolean; diagnosticArgs: string[] } {
        const repository = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));
        const project = realpathSync(process.cwd()); const output = dirname(project);
        if (!project.startsWith(`${repository}${sep}evidence${sep}task-4.3${sep}`) || project !== join(output, 'project'))
            throw new Error('resource_creator_project_out_of_scope');
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8')) as Record<string, string> & { offlineServiceProfile?: boolean };
        if (registration.task !== '4.3' || registration.kind !== 'worktree-local-validation-project'
            || registration.projectPath !== project || registration.owner !== ComponentTaskOwnership.current(repository))
            throw new Error('resource_creator_project_unregistered');
        const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
        const binary = join(registration.creatorApp ?? '', 'Contents/MacOS/CocosCreator');
        const sdk = join(registration.creatorApp ?? '', 'Contents/Resources/resources/3d/engine/package.json');
        if (JSON.parse(readFileSync(sdk, 'utf8')).version !== manifest.creator?.version
            || manifest.creator.version !== registration.creatorVersion) throw new Error('resource_creator_exact_version_mismatch');
        ComponentEngineProfile.assertProject(project, String(registration.creatorVersion));
        if (registration.offlineServiceProfile === true) ComponentServiceProfile.assertProject(project, String(registration.creatorVersion));
        if (existsSync(join(output, 'component-matrix-staging.json'))) ComponentEngineModules.assertProject(project,
            String(registration.creatorVersion), ComponentEngineModules.context(registration.engineModulesContext));
        const descriptor = verifyReleaseCandidate(join(repository, 'release/peanut.pod-lite-0.2.0'), {
            expectedVersion: '0.2.0', expectedSourceCommit: String(registration.candidateSourceCommit),
        });
        if (descriptor.host.sha256 !== registration.hostSha256 || descriptor.core.sha256 !== registration.coreSha256)
            throw new Error('resource_creator_candidate_mismatch');
        const processes = this.processes();
        if (processes.some((line) => line.includes(`${binary} --project ${project}`))) throw new Error('creator_project_session_conflict');
        const sameVersion = processes.some((line) => line.includes(`${binary} --project `));
        const diagnosticArgs = ComponentCreatorDiagnostics.args(registration.metricsDiagnostics, String(registration.creatorVersion));
        return { registration, project, output, binary, sameVersion, diagnosticArgs };
    }

    /**
     * @description 保留 npm pre/post hooks，捕获实际子进程起止与所有原始 stdout/stderr。
     */
    public static async launch(): Promise<void> {
        if (process.env.npm_lifecycle_event !== 'creator' || process.env.npm_config_ignore_scripts === 'true')
            throw new Error('resource_creator_outer_npm_required');
        const context = this.preflight();
        const out = openSync(join(context.output, 'stdout.log'), 'wx', 0o600);
        const err = openSync(join(context.output, 'stderr.log'), 'wx', 0o600);
        const useOpen = process.platform === 'darwin' || context.sameVersion;
        const launcherOut = useOpen ? openSync(join(context.output, 'launcher-stdout.log'), 'wx', 0o600) : out;
        const launcherErr = useOpen ? openSync(join(context.output, 'launcher-stderr.log'), 'wx', 0o600) : err;
        const args = useOpen ? ['-n', '-a', context.registration.creatorApp ?? '', '-W',
            '--stdout', join(context.output, 'stdout.log'), '--stderr', join(context.output, 'stderr.log'),
            '--args', '--project', context.project, '--nologin', ...context.diagnosticArgs]
            : ['--project', context.project, '--nologin', ...context.diagnosticArgs];
        const child = spawn(useOpen ? '/usr/bin/open' : context.binary, args, {
            cwd: context.project, stdio: ['ignore', launcherOut, launcherErr], detached: true,
        });
        let creatorPid: number | null = null;
        await new Promise<void>((complete, reject) => {
            child.once('error', reject);
            child.once('spawn', () => { void (async (): Promise<void> => {
                if (!child.pid) throw new Error('resource_creator_pid_missing');
                let identity: string | undefined;
                const until = Date.now() + 30000;
                do {
                    const matches = this.processes().filter((line) => useOpen
                        ? line.includes(` ${context.binary} --project ${context.project} --nologin`)
                        : new RegExp(`^\\s*${child.pid}\\s`, 'u').test(line));
                    if (matches.length > 1) throw new Error('resource_creator_start_identity_ambiguous');
                    identity = matches[0];
                    if (identity) break;
                    if (Date.now() >= until) throw new Error('resource_creator_start_identity_missing');
                    await new Promise((done) => setTimeout(done, 250));
                } while (true);
                if (!identity.includes(context.binary) || !identity.includes(context.project)) throw new Error('resource_creator_start_identity_missing');
                creatorPid = Number(/^\s*(\d+)\s/u.exec(identity)?.[1]);
                if (!Number.isInteger(creatorPid) || creatorPid <= 0) throw new Error('resource_creator_pid_missing');
                writeFileSync(join(context.output, 'creator-owned-start.json'), JSON.stringify({
                    owner: context.registration.owner, runId: context.registration.runId, pid: creatorPid,
                    launcherPid: child.pid, launchMethod: useOpen ? 'open-new-instance-wait' : 'direct-binary',
                    diagnosticArguments: context.diagnosticArgs,
                    otherSameVersionProjectsPresent: context.sameVersion,
                    project: context.project, creatorVersion: context.registration.creatorVersion, identity,
                    executableSha256: createHash('sha256').update(readFileSync(context.binary)).digest('hex'),
                    startedAt: new Date().toISOString(), candidateSourceCommit: context.registration.candidateSourceCommit,
                }, null, 2) + '\n', { flag: 'wx' });
                process.stdout.write(`resource_creator_owned_pid:${creatorPid}\n`);
            })().catch(reject); });
            child.once('close', (code, signal) => {
                closeSync(out); closeSync(err);
                if (useOpen) { closeSync(launcherOut); closeSync(launcherErr); }
                writeFileSync(join(context.output, 'creator-owned-exit.json'), JSON.stringify({
                    pid: creatorPid, launcherPid: child.pid, code, signal,
                    creatorExitCode: useOpen ? null : code,
                    exitCodeScope: useOpen ? 'open-wait-launcher-only' : 'creator-process',
                    endedAt: new Date().toISOString(), nativeAcceptance: false,
                }, null, 2) + '\n', { flag: 'wx' });
                if (code !== 0 || signal !== null) process.exitCode = 1;
                complete();
            });
        });
    }

    /**
     * @description 只读进程文本，所有终止逻辑必须另行核对这份启动身份。
     */
    private static processes(): string[] {
        return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\n');
    }
}

const phase = process.argv[process.argv.indexOf('--phase') + 1];
if (phase === 'preflight') { ResourceCreatorSession.preflight(); process.stdout.write('resource_creator_preflight_passed\n'); }
else if (phase === 'launch') await ResourceCreatorSession.launch();
else if (phase === 'post') {
    const result = JSON.parse(readFileSync(resolve('..', 'creator-owned-exit.json'), 'utf8'));
    if (result.code !== 0 || result.signal !== null) throw new Error('resource_creator_exit_not_normal');
    process.stdout.write('resource_creator_post_hook_passed\n');
} else throw new Error('resource_creator_phase_required');
