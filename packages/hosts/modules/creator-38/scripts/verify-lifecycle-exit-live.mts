import { createHash } from 'node:crypto';
import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

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
        quitStyle: 'apple-event' | 'app-menu' = 'apple-event'): Promise<boolean> {
        const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
        this.assertProject(repository, project, output, owner);
        const binary = join(app, 'Contents/MacOS/CocosCreator');
        accessSync(binary, constants.X_OK);
        const installed = JSON.parse(readFileSync(join(app, 'Contents/Resources/resources/3d/engine/package.json'), 'utf8')) as { version?: unknown };
        if (installed.version !== '3.8.7') throw new Error('lifecycle_installed_version_mismatch');
        if (this.processes().some((process) => this.isEditorRoot(process.command)
            && (quitStyle === 'apple-event' || process.command.startsWith(`${binary} `) || process.command.includes(project)))) {
            throw new Error('lifecycle_editor_session_conflict');
        }
        if (preflightOnly) { process.stdout.write('lifecycle:preflight-passed\n'); return true; }
        const leasePath = join(output, 'launch-lease.json');
        if (existsSync(leasePath)) throw new Error('lifecycle_run_already_started');
        const startedAt = new Date().toISOString();
        writeFileSync(leasePath, JSON.stringify({ owner, project, app, startedAt,
            status: 'launch-reserved', pid: null }, null, 2) + '\n', { flag: 'wx' });
        const stdoutFd = openSync(join(output, 'stdout.log'), 'wx');
        const stderrFd = openSync(join(output, 'stderr.log'), 'wx');
        const child = spawn(binary, ['--project', project, '--nologin'], { stdio: ['ignore', stdoutFd, stderrFd] });
        closeSync(stdoutFd); closeSync(stderrFd);
        let exitCode: number | null = null;
        let exitSignal: string | null = null;
        let exited = false;
        let spawnError = false;
        child.on('exit', (code, signal) => { exitCode = code; exitSignal = signal; exited = true; });
        child.on('error', () => { spawnError = true; });
        if (!child.pid) throw new Error('lifecycle_creator_spawn_failed');
        await this.delay(500);
        const first = this.processes().find((process) => process.pid === child.pid);
        if (!first || !first.command.includes(binary) || !first.command.includes(project)) throw new Error('lifecycle_process_ownership_missing');
        writeFileSync(leasePath, JSON.stringify({ owner, project, creatorVersion: installed.version,
            app, pid: child.pid, processStartedAt: first.startedAt, command: first.command, startedAt, status: 'started' }, null, 2) + '\n');
        const sources = { stdout: 'stdout.log', stderr: 'stderr.log', 'project.log': 'project/temp/logs/project.log' };
        const offsets = { stdout: 0, stderr: 0, 'project.log': 0 };
        const stages: { name: string; startedAt: string; endedAt: string; logs: unknown[] }[] = [];
        let phaseStart = startedAt;
        const capture = (name: string): void => {
            const endedAt = new Date().toISOString();
            const logs = Object.entries(sources).map(([channel, reference]) => {
                const file = join(output, reference);
                const bytes = existsSync(file) ? this.raw(file) : Buffer.alloc(0);
                const offsetStart = offsets[channel as keyof typeof offsets];
                if (bytes.length < offsetStart) throw new Error('lifecycle_raw_source_truncated');
                const segment = bytes.subarray(offsetStart);
                offsets[channel as keyof typeof offsets] = bytes.length;
                return { channel, reference, offsetStart, offsetEnd: bytes.length, capturedAt: endedAt,
                    byteLength: segment.length, sha256: this.sha(segment) };
            });
            stages.push({ name, startedAt: phaseStart, endedAt, logs }); phaseStart = endedAt;
            writeFileSync(join(output, 'stages.json'), JSON.stringify(stages, null, 2) + '\n');
            process.stdout.write(`lifecycle:phase:${name}\n`);
        };
        await this.delay(30_000); capture('startup');
        const owned = this.processes().filter((process) => process.pid === child.pid || process.parentPid === child.pid);
        await this.delay(10_000); capture('operation');
        await this.delay(10_000); capture('cooldown');
        const beforeQuit = this.processes();
        const current = beforeQuit.find((process) => process.pid === child.pid);
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
            const quit = spawnSync('/usr/bin/osascript', ['-e', script, quitStyle === 'app-menu' ? String(child.pid) : app],
                { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 });
            writeFileSync(join(output, 'normal-quit.stdout.log'), quit.stdout ?? '');
            writeFileSync(join(output, 'normal-quit.stderr.log'), quit.stderr ?? '');
            if (quit.error || quit.status !== 0) quitFailure = 'lifecycle_normal_quit_request_failed';
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
                const ui = spawnSync('/usr/bin/osascript', ['-e', uiScript, String(child.pid)], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
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
            && surviving.length === 0 && rawSources.every((source) => source.exists);
        const report = { schemaVersion: 'peanut.lite.lifecycle-baseline.v1', mode: 'without-lite', creatorVersion: '3.8.7',
            owner, project, projectName: 'peanut-lite-lifecycle-387', app, startedAt,
            endedAt: new Date().toISOString(), pid: child.pid, processStartedAt: first.startedAt,
            candidate: null, task22Complete: false, quitStyle, stages, rawSources, exited, exitCode, exitSignal, quitFailure,
            survivingOwnedPids: surviving.map((process) => process.pid), complete, diagnostics,
            baselinePassed: complete && diagnostics.issueCount === 0 };
        writeFileSync(join(output, 'baseline-report.json'), JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify({ complete, baselinePassed: report.baselinePassed,
            issueCount: diagnostics.issueCount, quitFailure, exitCode, exited }) + '\n');
        if (!exited) child.unref();
        return report.baselinePassed;
    }

    /**
     * @description 验收工程只位于当前已登记工作树的独占 evidence；拒绝原工程、链接和其它 owner。
     */
    private static assertProject(repository: string, project: string, output: string, owner: string): void {
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
        for (const path of ['extensions', 'packages', 'peanut-plugins', '.peanut-ai/cocos-mcp.json']) {
            if (existsSync(join(project, path))) throw new Error('lifecycle_baseline_has_extensions');
        }
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
                if (/\bwarn(?:ing)?\b|\berror\b|\bfatal\b|Object has been destroyed/iu.test(line)) {
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
        const quitStyle = process.argv.includes('--quit-style') ? process.argv[process.argv.indexOf('--quit-style') + 1] : 'apple-event';
        if (quitStyle !== 'apple-event' && quitStyle !== 'app-menu') throw new Error('lifecycle_quit_style_invalid');
        const passed = await LifecycleExitLiveBaseline.run(argument('--project'), argument('--output'), argument('--creator-app'), owner, process.argv.includes('--preflight-only'), quitStyle);
        process.exitCode = passed ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'lifecycle_baseline_failed'}\n`); process.exitCode = 1;
    }
}
