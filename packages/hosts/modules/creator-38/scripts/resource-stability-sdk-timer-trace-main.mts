import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { ComponentSdkTimerTrace } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-timer-trace.ts';
import { ComponentSdkWindowDiagnostics } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-window-diagnostics.ts';
import { ComponentSdkUiReadyPhases } from '../../../../../tests/fixtures/editor-stability/components/component-sdk-ui-ready-phases.ts';

/**
 * @description 显式登记的SDK计时观测入口；不修改安装包、统计事件或原始日志。
 */
class ComponentSdkTimerTraceMain {
    private static restore: (() => void) | null = null;
    private static removeIpcObserver: (() => void) | null = null;
    private static windows: { contents: any; script: string }[] = [];
    private static phases: ReturnType<typeof ComponentSdkUiReadyPhases.install> | null = null;
    private static stopping = false;

    /**
     * @description 仅对本次4.3隔离工程的SDK计时Map安装透明观测。
     */
    public static load(): void {
        this.stopping = false;
        const editor = Reflect.get(globalThis, 'Editor'); const project = realpathSync(editor.Project.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '4.3' || (registration.sdkTimerTrace !== true && registration.sdkUiReadyCompat !== true) || registration.projectPath !== project
            || !['3.8.3', '3.8.7'].includes(registration.creatorVersion) || editor.App.version !== registration.creatorVersion
            || registration.creatorVersion === '3.8.3' && (registration.sdkUiReadyCompat !== true || registration.sdkSceneCacheCompat !== true)
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-4.3' + sep))
            throw new Error('component_sdk_timer_trace_project_not_registered');
        const map = editor.Metrics.__protected__.getTrackTimeStartMap(); const path = join(output, 'sdk-timer-map-trace.ndjson');
        if (registration.sdkTimerTrace === true) {
            appendFileSync(path, JSON.stringify({ method: 'installed', starts: [...map.entries()], at: Date.now(), pid: process.pid }) + '\n');
            let count = 0;
            const record = (event: Record<string, unknown>): void => {
                if (++count > 10000) throw new Error('component_sdk_timer_trace_budget_exceeded');
                appendFileSync(path, JSON.stringify(event) + '\n');
            };
            this.restore = ComponentSdkTimerTrace.install(map, record);
            const module = Object.entries(createRequire(join(project, 'package.json')).cache)
                .find(([path]) => path.endsWith('/app.asar/node_modules/@base/electron-base-ipc/dist/index.js'))?.[1];
            if (!module?.exports?.on || !module.exports.removeListener) throw new Error('component_sdk_timer_trace_ipc_unavailable');
            this.removeIpcObserver = ComponentSdkTimerTrace.observeIpc(module.exports, record);
        }
        const runtime = createRequire(join(project, 'package.json'));
        const install = (script: string, receipt: string): void => {
            void this.installWindowModule(runtime('electron'), registration.creatorApp, registration.creatorVersion, script, receipt)
                .catch(error => { writeFileSync(receipt, JSON.stringify({ installed: false, failed: !this.stopping, cancelled: this.stopping,
                    error: error instanceof Error ? error.message : String(error) }) + '\n'); if (!this.stopping) console.error(error); });
        };
        if (registration.sdkUiReadyCompat === true) {
            const receipt = join(output, 'sdk-ui-ready-compat-state.json');
            writeFileSync(receipt, JSON.stringify({ installed: false, pending: true }) + '\n');
            const script = realpathSync(join(project, 'extensions/peanut-component-sdk-compat/ui-ready.js'));
            this.phases = ComponentSdkUiReadyPhases.install(map, observed => {
                if (this.stopping) return;
                writeFileSync(join(output, 'sdk-ui-ready-phases.json'), JSON.stringify({ runId: registration.runId, projectPath: project,
                    observed, at: Date.now(), pid: process.pid, source: 'actual SDK Metrics.trackTimeEnd successful Map.delete' }, null, 2) + '\n', { flag: 'wx' });
                install(script, receipt);
            });
        }
        if (registration.sdkRendererTimerTrace === true) {
            const receipt = join(output, 'sdk-window-renderer-trace-state.json');
            writeFileSync(receipt, JSON.stringify({ installed: false, pending: true }) + '\n');
            install(realpathSync(join(project, 'extensions/peanut-component-sdk-compat/window-trace.js')), receipt);
        }
    }

    /**
     * @description 非阻塞等待当前SDK主窗口初始化，仅读取本项目固定观测模块；不创建或选择其它窗口。
     */
    private static async installWindowModule(electron: any, creatorApp: string, version: string, script: string, receipt: string): Promise<void> {
        for (let attempt = 0; attempt < 100 && !this.stopping; attempt++) {
            const contents = ComponentSdkWindowDiagnostics.mainContents(electron, creatorApp, version);
            if (contents) {
                const result = await contents.executeJavaScript('require(' + JSON.stringify(script) + ').load()', false);
                if (result?.installed === true) { this.windows.push({ contents, script }); writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n'); return; }
            }
            await new Promise(done => setTimeout(done, 250));
        }
        if (!this.stopping) throw new Error('component_sdk_window_renderer_trace_not_ready');
    }

    /**
     * @description 只恢复自己观察的Map实例，不改变任何实际计时数据。
     */
    public static async unload(): Promise<void> {
        this.stopping = true; this.phases?.restore(); this.phases = null;
        this.removeIpcObserver?.(); this.removeIpcObserver = null; this.restore?.(); this.restore = null;
        const windows = this.windows.splice(0);
        for (const { contents, script } of windows) if (!contents.isDestroyed()) {
            try { await contents.executeJavaScript('require(' + JSON.stringify(script) + ').unload()', false); }
            catch (error) { if (!contents.isDestroyed()) throw error; }
        }
    }
}

export const load = (): void => ComponentSdkTimerTraceMain.load();
export const unload = (): Promise<void> => ComponentSdkTimerTraceMain.unload();
