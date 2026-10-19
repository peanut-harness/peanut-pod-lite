import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, lstatSync, readdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { verifyReleaseCandidate } from '../../../../../tools/release-candidate.mts';

/**
 * @description 在登记工作树内启动独占的无 Lite 基线，原始通道不经过产品 postflight 过滤。
 * 此控制组没有 Host/Core；不能转成带候选的 lifecycle validator 通过证据。
 */
export class LifecycleExitLiveBaseline {
    /**
     * @description 捕获五阶段原始 offsets，正常退出通过 macOS quit 事件或所属进程的原生菜单。
     * @param project 工作树 evidence 下的新项目。
     * @param output 对应独占运行目录。
     * @param app 实际发现并核对版本的安装包。
     * @param owner 已登记的调用方 owner；设备会话 ID 不写死在源码。
     * @param preflightOnly 仅检查目标与进程互斥。
     * @param quitStyle 对照 macOS quit 事件与原生菜单退出入口。
     * @returns 基线记录是否完整且无原始诊断；不代表任务 2.2 验收。
     */
    public static async run(project: string, output: string, app: string, owner: string, preflightOnly = false,
        quitStyle: 'apple-event' | 'app-menu' | 'pid-terminate' = 'app-menu',
        candidateInput?: { directory: string; sourceCommit: string },
        sdkEnvironmentInput?: { directory: string; sourceCommit: string }): Promise<boolean> {
        const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
        if (candidateInput && sdkEnvironmentInput) throw new Error('lifecycle_sdk_environment_mode_conflict');
        this.assertProject(repository, project, output, owner, candidateInput !== undefined, sdkEnvironmentInput !== undefined);
        const candidate = candidateInput ? this.assertCandidate(project, output, candidateInput.directory, candidateInput.sourceCommit) : null;
        const sdkTimerEnvironment = sdkEnvironmentInput
            ? this.assertSdkTimerEnvironment(project, output, sdkEnvironmentInput.directory, sdkEnvironmentInput.sourceCommit)
            : candidateInput && candidate ? { kind: 'formal-host-sdk-worker', sourceCommit: candidate.sourceCommit,
                workerSha256: this.sha(this.readCandidateWorker(candidateInput.directory, candidate)) } : null;
        const binary = join(app, 'Contents/MacOS/CocosCreator');
        accessSync(binary, constants.X_OK);
        const installed = JSON.parse(readFileSync(join(app, 'Contents/Resources/resources/3d/engine/package.json'), 'utf8')) as { version?: unknown };
        if (installed.version !== '3.8.7') throw new Error('lifecycle_installed_version_mismatch');
        if (this.processes().some((process) => this.isEditorRoot(process.command)
            && (quitStyle === 'apple-event' || process.command.startsWith(`${binary} `) || process.command.includes(project)))) {
            throw new Error('lifecycle_editor_session_conflict');
        }
        if (preflightOnly) { process.stdout.write('lifecycle:preflight-passed\n'); return true; }
        this.assertOuterNpm(project, process.cwd(), process.env);
        const leasePath = join(output, 'launch-lease.json');
        if (existsSync(leasePath)) throw new Error('lifecycle_run_already_started');
        const startedAt = new Date().toISOString();
        writeFileSync(leasePath, JSON.stringify({ owner, project, app, startedAt,
            status: 'launch-reserved', pid: null }, null, 2) + '\n', { flag: 'wx' });
        const stdoutFd = openSync(join(output, 'stdout.log'), 'wx');
        const stderrFd = openSync(join(output, 'stderr.log'), 'wx');
        closeSync(stdoutFd); closeSync(stderrFd);
        const launch = this.launchCommand(app, project, output, process.platform);
        const launcherStdout = openSync(join(output, 'launcher-stdout.log'), 'wx');
        const launcherStderr = openSync(join(output, 'launcher-stderr.log'), 'wx');
        const child = spawn(launch.command, launch.args, { cwd: project,
            stdio: ['ignore', launcherStdout, launcherStderr] });
        closeSync(launcherStdout); closeSync(launcherStderr);
        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let exited = false;
        let spawnError = false;
        child.on('exit', (code, signal) => { exitCode = code; exitSignal = signal; exited = true; });
        child.on('error', () => { spawnError = true; });
        if (!child.pid) throw new Error('lifecycle_creator_spawn_failed');
        let matching = this.processes().filter((entry) => entry.command.startsWith(`${binary} `) && entry.command.includes(project));
        const discoveryDeadline = Date.now() + 15_000;
        while (matching.length === 0 && !exited && !spawnError && Date.now() < discoveryDeadline) {
            await this.delay(200);
            matching = this.processes().filter((entry) => entry.command.startsWith(`${binary} `) && entry.command.includes(project));
        }
        const first = matching[0];
        if (matching.length !== 1 || !first) throw new Error('lifecycle_process_ownership_missing');
        const creatorPid = first.pid;
        writeFileSync(leasePath, JSON.stringify({ owner, project, creatorVersion: installed.version,
            app, pid: creatorPid, launcherPid: child.pid, launcherCommand: launch,
            processStartedAt: first.startedAt, command: first.command, startedAt, status: 'started' }, null, 2) + '\n');
        const sources = { stdout: 'stdout.log', stderr: 'stderr.log', 'project.log': 'project/temp/logs/project.log',
            launcherStdout: 'launcher-stdout.log', launcherStderr: 'launcher-stderr.log' };
        const offsets: Record<string, number> = Object.fromEntries(Object.keys(sources).map((channel) => [channel, 0]));
        const stages: { name: string; startedAt: string; endedAt: string; logs: unknown[] }[] = [];
        let phaseStart = startedAt;
        const capture = (name: string): void => {
            const endedAt = new Date().toISOString();
            const logs = Object.entries(sources).map(([channel, reference]) => {
                const file = join(output, reference);
                const bytes = existsSync(file) ? this.raw(file) : Buffer.alloc(0);
                const offsetStart = offsets[channel] ?? 0;
                if (bytes.length < offsetStart) throw new Error('lifecycle_raw_source_truncated');
                const segment = bytes.subarray(offsetStart);
                offsets[channel] = bytes.length;
                return { channel, reference, offsetStart, offsetEnd: bytes.length, capturedAt: endedAt,
                    byteLength: segment.length, sha256: this.sha(segment) };
            });
            stages.push({ name, startedAt: phaseStart, endedAt, logs }); phaseStart = endedAt;
            writeFileSync(join(output, 'stages.json'), JSON.stringify(stages, null, 2) + '\n');
            process.stdout.write(`lifecycle:phase:${name}\n`);
        };
        await this.delay(30_000); capture('startup');
        const owned = this.processes().filter((process) => process.pid === creatorPid || process.parentPid === creatorPid);
        await this.delay(10_000); capture('operation');
        await this.delay(10_000); capture('cooldown');
        const beforeQuit = this.processes();
        const current = beforeQuit.find((process) => process.pid === creatorPid);
        let quitFailure: string | null = null;
        const editors = beforeQuit.filter((process) => this.isEditorRoot(process.command));
        if (!current || current.startedAt !== first.startedAt || current.command !== first.command
            || quitStyle === 'apple-event' && editors.length !== 1) {
            quitFailure = 'lifecycle_quit_ownership_changed';
        } else {
            const menuScript = 'on run argv\nset ownPid to (item 1 of argv) as integer\ntell application "System Events"\n'
                + 'set ownProcess to first application process whose unix id is ownPid\ntell ownProcess\n'
                + 'repeat with ownMenu in every menu bar item of menu bar 1\nrepeat with ownItem in every menu item of menu 1 of ownMenu\n'
                + 'if exists attribute "AXMenuItemCmdChar" of ownItem then\n'
                + 'if (value of attribute "AXMenuItemCmdChar" of ownItem is "q") and (value of attribute "AXMenuItemCmdModifiers" of ownItem is 0) then\n'
                + 'set quitLabel to name of ownItem\nclick ownItem\nreturn quitLabel\nend if\nend if\nend repeat\nend repeat\nend tell\nend tell\n'
                + 'error "owned_editor_quit_menu_missing"\nend run';
            const script = quitStyle === 'app-menu' ? menuScript : 'on run argv\nset editorApp to item 1 of argv\ntell application editorApp to quit\nend run';
            const quitArgs = quitStyle === 'pid-terminate' ? ['-l', 'JavaScript', '-e',
                `ObjC.import('AppKit'); var app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${creatorPid}); if(!app) throw Error('owned instance missing'); app.terminate;`]
                : ['-e', script, quitStyle === 'app-menu' ? String(creatorPid) : app];
            const quit = spawnSync('/usr/bin/osascript', quitArgs,
                { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
            writeFileSync(join(output, 'normal-quit.stdout.log'), quit.stdout ?? '');
            writeFileSync(join(output, 'normal-quit.stderr.log'), quit.stderr ?? '');
            if (quit.error || quit.status !== 0 || quitStyle === 'pid-terminate' && quit.stdout.trim() !== 'true') quitFailure = 'lifecycle_normal_quit_request_failed';
            if (quitStyle === 'app-menu' && quit.status === 0) {
                await this.delay(2000);
                const uiScript = 'on run argv\nset ownPid to (item 1 of argv) as integer\ntell application "System Events"\n'
                    + 'set ownProcess to first application process whose unix id is ownPid\nset reportText to ""\ntell ownProcess\n'
                    + 'repeat with ownWindow in every window\nset reportText to reportText & "WINDOW: " & name of ownWindow & linefeed\n'
                    + 'repeat with ownElement in every UI element of ownWindow\ntry\n'
                    + 'set reportText to reportText & (role of ownElement as text) & ": " & (name of ownElement as text) & linefeed\n'
                    + 'repeat with ownChild in every UI element of ownElement\ntry\n'
                    + 'set reportText to reportText & (role of ownChild as text) & ": " & (name of ownChild as text) & linefeed\n'
                    + 'end try\nend repeat\nend try\nend repeat\nend repeat\nend tell\nend tell\nreturn reportText\nend run';
                const ui = spawnSync('/usr/bin/osascript', ['-e', uiScript, String(creatorPid)], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
                writeFileSync(join(output, 'after-quit-ui.stdout.log'), ui.stdout ?? '');
                writeFileSync(join(output, 'after-quit-ui.stderr.log'), ui.stderr ?? '');
            }
        }
        const deadline = Date.now() + 30_000;
        while (!exited && Date.now() < deadline) await this.delay(500);
        capture('exit'); await this.delay(8_000); capture('delayed_diagnostics');
        const afterQuit = this.processes();
        const surviving = owned.filter((entry) => afterQuit.some((process) => process.pid === entry.pid && process.startedAt === entry.startedAt));
        const rawSources = Object.entries(sources).map(([channel, reference]) => {
            const file = join(output, reference);
            return { channel, reference, exists: existsSync(file), byteLength: existsSync(file) ? statSync(file).size : 0,
                sha256: existsSync(file) ? this.sha(this.raw(file)) : null };
        });
        const diagnostics = this.assessRaw(output, rawSources);
        const complete = !spawnError && exited && exitCode === 0 && exitSignal === null && quitFailure === null
            && !afterQuit.some((entry) => entry.pid === creatorPid && entry.startedAt === first.startedAt)
            && surviving.length === 0 && rawSources.every((source) => source.exists);
        const report = { schemaVersion: 'peanut.lite.lifecycle-baseline.v1', mode: candidate === null ? 'without-lite' : 'with-lite', creatorVersion: '3.8.7',
            owner, project, projectName: 'peanut-lite-lifecycle-387', app, startedAt,
            endedAt: new Date().toISOString(), pid: creatorPid, processStartedAt: first.startedAt,
            candidate, sdkTimerEnvironment, task22Complete: false, quitStyle, stages, rawSources, exited, exitCode, exitSignal, quitFailure,
            survivingOwnedPids: surviving.map((process) => process.pid), complete, diagnostics,
            baselinePassed: candidate === null && complete && diagnostics.issueCount === 0,
            candidateRunPassed: candidate !== null && complete && diagnostics.issueCount === 0 };
        writeFileSync(join(output, 'baseline-report.json'), JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify({ complete, baselinePassed: report.baselinePassed,
            issueCount: diagnostics.issueCount, quitFailure, exitCode, exited }) + '\n');
        if (!exited) child.unref();
        return complete && diagnostics.issueCount === 0;
    }

    /**
     * @description macOS 通过 LaunchServices 建立真正应用生命周期，并等待该独立实例退出。
     * @param app 已验证的 Creator 安装包。
     * @param project 独占工程。
     * @param output 独占原始日志目录。
     * @param platform 实际平台。
     * @returns 无 shell 插值的命令与参数。
     */
    public static launchCommand(app: string, project: string, output: string, platform: NodeJS.Platform): { command: string; args: string[] } {
        if (platform !== 'darwin') throw new Error('lifecycle_macos_required');
        return { command: '/usr/bin/open', args: ['-n', '-a', app, '-W', '--stdout', join(output, 'stdout.log'),
            '--stderr', join(output, 'stderr.log'), '--args', '--project', project, '--nologin'] };
    }

    /**
     * @description 实际启动只能由工程 npm creator 生命周期进入，保留外层 pre/post hooks。
     * @param project 已登记的工程根。
     * @param cwd 当前生命周期执行目录。
     * @param environment 实际 npm 环境，测试可注入拒绝条件。
     */
    public static assertOuterNpm(project: string, cwd: string, environment: NodeJS.ProcessEnv): void {
        if (environment.npm_lifecycle_event !== 'creator' || environment.npm_config_ignore_scripts === 'true'
            || cwd !== project || environment.npm_package_json !== join(project, 'package.json')) {
            throw new Error('lifecycle_creator_outer_npm_required');
        }
    }

    /**
     * @description 验收工程只位于当前已登记工作树的独占 evidence；拒绝原工程、链接和其它 owner。
     */
    private static assertProject(repository: string, project: string, output: string, owner: string, withLite = false, sdkEnvironment = false): void {
        const root = realpathSync(repository);
        if (!isAbsolute(project) || !isAbsolute(output) || realpathSync(output) !== output
            || realpathSync(project) !== project || project !== join(output, 'project')
            || !output.startsWith(`${root}${sep}evidence${sep}`)) throw new Error('lifecycle_project_out_of_scope');
        const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { name?: unknown; creator?: { version?: unknown } };
        if (manifest.name !== 'peanut-lite-lifecycle-387' || manifest.creator?.version !== '3.8.7') throw new Error('lifecycle_project_version_or_name_invalid');
        const workspace = resolve(root, '../../..');
        const registry = JSON.parse(readFileSync(join(workspace, '.peanut-ai/worktree-registry.json'), 'utf8')) as { entries?: Record<string, unknown>[] };
        if (!owner || !registry.entries?.some((entry) => entry.owner === owner && entry.change === this.change
            && entry.state === 'active' && resolve(workspace, String(entry.path)) === root)) throw new Error('lifecycle_worktree_registration_missing');
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8')) as Record<string, unknown>;
        if (registration.owner !== owner || registration.change !== this.change || registration.projectPath !== project
            || registration.kind !== 'worktree-local-validation-project' || registration.creatorVersion !== '3.8.7') throw new Error('lifecycle_project_registration_missing');
        if (registration.mode !== (withLite ? 'with-lite' : 'without-lite')) throw new Error('lifecycle_mode_registration_mismatch');
        for (const path of withLite ? ['packages', '.peanut-ai/cocos-mcp.json']
            : sdkEnvironment ? ['packages', 'peanut-plugins', '.peanut-ai/cocos-mcp.json']
                : ['extensions', 'packages', 'peanut-plugins', '.peanut-ai/cocos-mcp.json']) {
            if (existsSync(join(project, path))) throw new Error('lifecycle_baseline_has_extensions');
        }
    }

    /**
     * @description 无 Host/Core 控制组仅允许固定共同 SDK 修复夹具，worker 字节必须等于已核验候选。
     * @param project 独占无 Lite 控制工程。
     * @param output 对应明确登记。
     * @param directory 显式冻结候选。
     * @param sourceCommit 显式完整源码身份。
     * @returns 共同 SDK 环境身份；不把夹具冒充纯净无扩展基线。
     */
    public static assertSdkTimerEnvironment(project: string, output: string, directory: string, sourceCommit: string): {
        kind: string; sourceCommit: string; workerSha256: string;
    } {
        if (!/^[a-f0-9]{40}$/u.test(sourceCommit) || !isAbsolute(directory) || realpathSync(directory) !== directory)
            throw new Error('lifecycle_sdk_environment_input_invalid');
        const candidate = verifyReleaseCandidate(directory, { expectedSourceCommit: sourceCommit });
        const workerSha256 = this.sha(this.readCandidateWorker(directory, candidate));
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.mode !== 'without-lite' || registration.sdkTimerEnvironment?.kind !== 'fixed-common-sdk-worker'
            || registration.sdkTimerEnvironment.sourceCommit !== sourceCommit || registration.sdkTimerEnvironment.workerSha256 !== workerSha256)
            throw new Error('lifecycle_sdk_environment_registration_mismatch');
        const extensions = readdirSync(join(project, 'extensions'));
        if (extensions.length !== 1 || extensions[0] !== 'peanut-sdk-startup-timer-helper')
            throw new Error('lifecycle_sdk_environment_extension_set_invalid');
        const helper = join(project, 'extensions/peanut-sdk-startup-timer-helper');
        this.assertSdkHelper(helper, workerSha256);
        return { kind: 'fixed-common-sdk-worker', sourceCommit, workerSha256 };
    }

    /**
     * @description 固定夹具只含 SDK worker、空主入口和精确清单，不允许额外业务能力或扩展代码。
     * @param helper 固定夹具目录。
     * @param workerSha256 已冻结正式 worker 摘要。
     */
    public static assertSdkHelper(helper: string, workerSha256: string): void {
        if (lstatSync(helper).isSymbolicLink() || realpathSync(helper) !== helper)
            throw new Error('lifecycle_sdk_helper_link_refused');
        const files = readdirSync(helper).sort();
        if (files.join(',') !== 'main.js,package.json,worker.js') throw new Error('lifecycle_sdk_helper_file_set_invalid');
        for (const file of files) if (!lstatSync(join(helper, file)).isFile() || lstatSync(join(helper, file)).isSymbolicLink())
            throw new Error('lifecycle_sdk_helper_file_type_refused');
        const manifest = JSON.parse(readFileSync(join(helper, 'package.json'), 'utf8'));
        const expected = { package_version: 2, name: 'peanut-sdk-startup-timer-helper', version: '0.1.0', private: true,
            main: './main.js', editor: '3.8.7', contributions: { 'asset-db': { script: './worker.js', 'global-hook': ['beforePreStart'] } } };
        const stable = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
        if (stable(manifest) !== stable(expected) || readFileSync(join(helper, 'main.js'), 'utf8') !== "'use strict';\nmodule.exports = {};\n"
            || this.sha(readFileSync(join(helper, 'worker.js'))) !== workerSha256) throw new Error('lifecycle_sdk_helper_payload_mismatch');
    }

    /**

     * @description 仅从已通过 archive SHA/目录摘要验证的正式 Host 制品读取 worker。

     */
    private static readCandidateWorker(directory: string, candidate: ReturnType<typeof verifyReleaseCandidate>): Buffer {
        const result = spawnSync('/usr/bin/tar', ['-xOf', join(directory, candidate.host.archive),
            `peanut-pod-lite-host-${candidate.version}/dist/sdk-startup-timer-worker.js`], { maxBuffer: 4 * 1024 * 1024 });
        if (result.error || result.status !== 0 || result.stdout.length === 0) throw new Error('lifecycle_sdk_worker_archive_missing');
        return result.stdout;
    }

    /**
     * @description 显式候选先验证制品，再核对工程内实际安装内容；不接受历史候选冒充当前身份。
     * @param project 独占工程。
     * @param output 独占登记目录。
     * @param directory 显式指定的已冻结候选目录。
     * @param sourceCommit 显式期望的完整源码提交。
     * @returns 已核对的候选身份。
     */
    public static assertCandidate(project: string, output: string, directory: string, sourceCommit: string): ReturnType<typeof verifyReleaseCandidate> {
        if (!/^[a-f0-9]{40}$/u.test(sourceCommit) || !isAbsolute(directory) || realpathSync(directory) !== directory)
            throw new Error('lifecycle_candidate_input_invalid');
        const candidate = verifyReleaseCandidate(directory, { expectedSourceCommit: sourceCommit });
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8')) as Record<string, unknown>;
        if (registration.candidateSourceCommit !== sourceCommit || registration.hostSha256 !== candidate.host.sha256
            || registration.coreSha256 !== candidate.core.sha256) throw new Error('lifecycle_candidate_registration_mismatch');
        const extensions = readdirSync(join(project, 'extensions'));
        if (extensions.length !== 1 || extensions[0] !== 'peanut-pod-lite-host') throw new Error('lifecycle_candidate_extension_set_invalid');
        this.assertTreeDigest(join(project, 'extensions/peanut-pod-lite-host'), candidate.host.packageDigest);
        const coreRelative = `peanut-plugins/plugins/peanut.pod-lite/${candidate.version}`;
        const installed = JSON.parse(readFileSync(join(project, 'peanut-plugins/installed.json'), 'utf8'));
        if (installed.schemaVersion !== 2 || installed.plugins?.length !== 1
            || installed.plugins[0]?.pluginId !== 'peanut.pod-lite' || installed.plugins[0]?.activeVersion !== candidate.version
            || installed.plugins[0]?.versions?.length !== 1 || installed.plugins[0]?.versions[0]?.version !== candidate.version
            || installed.plugins[0]?.versions[0]?.installPath !== coreRelative) throw new Error('lifecycle_candidate_active_core_invalid');
        this.assertTreeDigest(join(project, coreRelative), candidate.core.packageDigest, 'peanut.pod-lite.manifest.json');
        const archivedManifest = spawnSync('/usr/bin/tar', ['-xOf', join(directory, candidate.core.archive),
            `peanut.pod-lite-${candidate.version}/peanut.pod-lite.manifest.json`], { maxBuffer: 4 * 1024 * 1024 });
        if (archivedManifest.error || archivedManifest.status !== 0
            || this.sha(archivedManifest.stdout) !== this.sha(readFileSync(join(project, coreRelative, 'peanut.pod-lite.manifest.json'))))
            throw new Error('lifecycle_candidate_core_manifest_mismatch');
        return candidate;
    }

    /**
     * @description 从实际文件重算候选包摘要，拒绝链接、额外文件、缺文件或被修改的内容。
     * @param root 候选安装目录。
     * @param expected 经过制品校验的摘要。
     * @param excluded Core 外置清单。
     */
    public static assertTreeDigest(root: string, expected: string, excluded?: string): void {
        const records: string[] = []; let byteLength = 0;
        const visit = (directory: string, relative = ''): void => {
            if (lstatSync(directory).isSymbolicLink()) throw new Error('lifecycle_candidate_link_refused');
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                const name = relative ? `${relative}/${entry.name}` : entry.name;
                const path = join(directory, entry.name);
                if (entry.isSymbolicLink()) throw new Error('lifecycle_candidate_link_refused');
                if (entry.isDirectory()) visit(path, name);
                else if (entry.isFile()) {
                    if (name === excluded) continue;
                    byteLength += statSync(path).size;
                    if (records.length >= 20_000 || byteLength > 512 * 1024 * 1024) throw new Error('lifecycle_candidate_budget_exceeded');
                    records.push(`${name}:${this.sha(readFileSync(path))}`);
                } else throw new Error('lifecycle_candidate_file_type_refused');
            }
        };
        visit(root); records.sort((left, right) => {
            const leftPath = left.slice(0, left.lastIndexOf(':')); const rightPath = right.slice(0, right.lastIndexOf(':'));
            return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
        });
        if (this.sha(Buffer.from(records.join('\n'))) !== expected) throw new Error('lifecycle_candidate_tree_digest_mismatch');
    }

    /**
     * @description 对完整 raw bytes 做保守诊断计数，不隐藏命名、退出或延迟错误。
     * @param output 独占证据根。
     * @param sources 实际通道记录。
     * @returns 全部问题数和有限位置索引；原始正文始终保留在文件。
     */
    public static assessRaw(output: string, sources: readonly { readonly channel: string; readonly reference: string; readonly exists: boolean }[]): {
        readonly issueCount: number; readonly locations: readonly { channel: string; line: number }[];
    } {
        let issueCount = 0;
        const locations: { channel: string; line: number }[] = [];
        for (const source of sources) {
            if (!source.exists) { issueCount += 1; continue; }
            let text: string;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(this.raw(join(output, source.reference))); }
            catch { issueCount += 1; continue; }
            for (const [index, line] of text.split(/\r\n|\n|\r/u).entries()) {
                if (/\bwarn(?:ing)?\b|\berror\b|\bfatal\b|Object has been destroyed/iu.test(line)
                    || /^\s*trackTimeEnd failed! Can not find the track time .+ start\s*$/iu.test(line)) {
                    issueCount += 1;
                    if (locations.length < 100) locations.push({ channel: source.channel, line: index + 1 });
                }
            }
        }
        return { issueCount, locations };
    }

    /**
     * @description 未归一化的实际文件；过大时拒绝而不截断。
     */
    private static raw(path: string): Buffer {
        if (statSync(path).size > 128 * 1024 * 1024) throw new Error('lifecycle_raw_budget_exceeded');
        return readFileSync(path);
    }

    /**
     * @description SHA 绑定原始字节。
     */
    private static sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

    /**
     * @description 只输出匹配 Creator 的进程归属；ps 失败不能当作没有实例。
     */
    private static processes(): { pid: number; parentPid: number; startedAt: string; command: string }[] {
        const result = spawnSync('ps', ['-axo', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        if (result.error || result.status !== 0) throw new Error('lifecycle_process_inventory_unavailable');
        const entries: { pid: number; parentPid: number; startedAt: string; command: string }[] = [];
        for (const line of result.stdout.split('\n')) {
            const matched = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/u.exec(line);
            if (matched?.[3] && matched[4]?.includes('/CocosCreator.app/')) entries.push({
                pid: Number(matched[1]), parentPid: Number(matched[2]), startedAt: matched[3], command: matched[4] });
        }
        return entries;
    }

    /**
     * @description 主程序必须直属 Creator app；Frameworks 下的 Helper 不是独立编辑器实例。
     * @param command ps 实际命令行。
     * @returns 是否是主编辑器可执行文件。
     */
    public static isEditorRoot(command: string): boolean {
        return /\/CocosCreator\.app\/Contents\/MacOS\/CocosCreator(?:\s|$)/u.test(command);
    }

    /**
     * @description 等待时 runner 保持可被正常退出；宿主按短周期读取进度。
     */
    private static delay(milliseconds: number): Promise<void> { return new Promise((done) => setTimeout(done, milliseconds)); }

    /**
     * @description 已批准的目标。
     */
    private static readonly change = 'stabilize-editor-operations-and-bulk-file-io';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const argument = (key: string): string => {
        const value = process.argv[process.argv.indexOf(key) + 1];
        if (!process.argv.includes(key) || !value || value.startsWith('--')) throw new Error(`lifecycle_argument_missing:${key}`);
        return resolve(value);
    };
    try {
        const owner = process.argv.includes('--owner') ? process.argv[process.argv.indexOf('--owner') + 1] : undefined;
        if (!owner || owner.startsWith('--')) throw new Error('lifecycle_owner_argument_missing');
        const quitStyle = process.argv.includes('--quit-style') ? process.argv[process.argv.indexOf('--quit-style') + 1] : 'app-menu';
        if (quitStyle !== 'apple-event' && quitStyle !== 'app-menu' && quitStyle !== 'pid-terminate') throw new Error('lifecycle_quit_style_invalid');
        const candidateInput = process.argv.includes('--candidate-dir') ? { directory: argument('--candidate-dir'),
            sourceCommit: process.argv[process.argv.indexOf('--source-commit') + 1] ?? '' } : undefined;
        if (candidateInput && !process.argv.includes('--source-commit')) throw new Error('lifecycle_source_commit_argument_missing');
        const sdkEnvironmentInput = process.argv.includes('--sdk-timer-environment') ? { directory: argument('--sdk-timer-environment'),
            sourceCommit: process.argv[process.argv.indexOf('--source-commit') + 1] ?? '' } : undefined;
        if (sdkEnvironmentInput && !process.argv.includes('--source-commit')) throw new Error('lifecycle_source_commit_argument_missing');
        const passed = await LifecycleExitLiveBaseline.run(argument('--project'), argument('--output'), argument('--creator-app'), owner, process.argv.includes('--preflight-only'), quitStyle, candidateInput, sdkEnvironmentInput);
        process.exitCode = passed ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'lifecycle_baseline_failed'}\n`); process.exitCode = 1;
    }
}
