import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'crypto';
import { ComponentSdkTimerTrace } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-timer-trace.ts';
import { ComponentSdkWindowDiagnostics } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-window-diagnostics.ts';
import { ComponentSdkUiReadyPhases } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-ui-ready-phases.ts';
import { ComponentSdkWindowModuleLifecycle } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-window-module-lifecycle.ts';

/**
 * @description 显式登记的SDK计时观测入口；不修改安装包、统计事件或原始日志。
 */
class ComponentSdkTimerTraceMain {
    private static generation = 0;
    private static lifecycle: ComponentSdkWindowModuleLifecycle | null = null;

    /**
     * @description 仅对本次4.3隔离工程的SDK计时Map安装透明观测。
     */
    public static load(): void {
        if (this.lifecycle && !this.lifecycle.canRestart) throw new Error('component_sdk_window_generation_active');
        const editor = Reflect.get(globalThis, 'Editor'); const project = realpathSync(editor.Project.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '4.3' || (registration.sdkTimerTrace !== true && registration.sdkUiReadyCompat !== true) || registration.projectPath !== project
            || !['3.8.3', '3.8.7'].includes(registration.creatorVersion) || editor.App.version !== registration.creatorVersion
            || registration.creatorVersion === '3.8.3' && (registration.sdkUiReadyCompat !== true || registration.sdkSceneCacheCompat !== true)
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-4.3' + sep))
            throw new Error('component_sdk_timer_trace_project_not_registered');
        const generationId = String(process.pid) + ':' + randomBytes(16).toString('hex') + ':' + String(++this.generation);
        const lifecycle = new ComponentSdkWindowModuleLifecycle({
            recordEvent: event => { appendFileSync(join(output, 'sdk-window-module-lifecycle.ndjson'), JSON.stringify({
                schemaVersion: 1, owner: registration.owner, runId: registration.runId, candidateSourceCommit: registration.candidateSourceCommit,
                projectPath: project, creatorVersion: registration.creatorVersion, pid: process.pid, generationId,
                closeId: generationId, at: new Date().toISOString(), ...event }) + '\n'); },
            writeReceipt: (receipt, result) => { writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n'); },
            reportError: error => { console.error(error); }, delay: milliseconds => new Promise(done => setTimeout(done, milliseconds)),
        });
        this.lifecycle = lifecycle;
        try {
            const map = editor.Metrics.__protected__.getTrackTimeStartMap(); const path = join(output, 'sdk-timer-map-trace.ndjson');
            if (registration.sdkTimerTrace === true) {
                appendFileSync(path, JSON.stringify({ method: 'installed', starts: [...map.entries()], at: Date.now(), pid: process.pid }) + '\n');
                let count = 0;
                const record = (event: Record<string, unknown>): void => {
                    if (++count > 10000) throw new Error('component_sdk_timer_trace_budget_exceeded');
                    appendFileSync(path, JSON.stringify(event) + '\n');
                };
                lifecycle.own(ComponentSdkTimerTrace.install(map, record));
                const module = Object.entries(createRequire(join(project, 'package.json')).cache)
                    .find(([path]) => path.endsWith('/app.asar/node_modules/@base/electron-base-ipc/dist/index.js'))?.[1];
                if (!module?.exports?.on || !module.exports.removeListener) throw new Error('component_sdk_timer_trace_ipc_unavailable');
                lifecycle.own(ComponentSdkTimerTrace.observeIpc(module.exports, record));
            }
            const runtime = createRequire(join(project, 'package.json'));
            const install = (script: string, receipt: string): void => {
                lifecycle.install(() => ComponentSdkWindowDiagnostics.mainContents(runtime('electron'), registration.creatorApp,
                    registration.creatorVersion), script, receipt);
            };
            if (registration.sdkUiReadyCompat === true) {
                const receipt = join(output, 'sdk-ui-ready-compat-state.json');
                writeFileSync(receipt, JSON.stringify({ installed: false, pending: true }) + '\n');
                const script = realpathSync(join(project, 'extensions/peanut-component-sdk-compat/ui-ready.js'));
                const phases = ComponentSdkUiReadyPhases.install(map, observed => {
                    if (!lifecycle.isOpen) return;
                    writeFileSync(join(output, 'sdk-ui-ready-phases.json'), JSON.stringify({ runId: registration.runId, projectPath: project,
                        observed, at: Date.now(), pid: process.pid, source: 'actual SDK Metrics.trackTimeEnd successful Map.delete' }, null, 2) + '\n', { flag: 'wx' });
                    install(script, receipt);
                });
                lifecycle.own(() => phases.restore());
            }
            if (registration.sdkRendererTimerTrace === true) {
                const receipt = join(output, 'sdk-window-renderer-trace-state.json');
                writeFileSync(receipt, JSON.stringify({ installed: false, pending: true }) + '\n');
                install(realpathSync(join(project, 'extensions/peanut-component-sdk-compat/window-trace.js')), receipt);
            }
        } catch (error) { lifecycle.abort(error); throw error; }
    }

    /**
     * @description Stop new installs and settle every owned install and cleanup before unload completes.
     */
    public static unload(): Promise<void> {
        this.lifecycle?.hookEntered();
        return this.lifecycle?.close() ?? Promise.resolve();
    }

}

export const load = (): void => ComponentSdkTimerTraceMain.load();
export const unload = (): Promise<void> => ComponentSdkTimerTraceMain.unload();
