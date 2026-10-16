import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { ComponentSdkTimerTrace } from './component-sdk-timer-trace';
import { ComponentSdkWindowDiagnostics } from './component-sdk-window-diagnostics';

/**
 * @description 显式登记的SDK计时观测入口；不修改安装包、统计事件或原始日志。
 */
class ComponentSdkTimerTraceMain {
    private static restore: (() => void) | null = null;
    private static removeIpcObserver: (() => void) | null = null;
    private static windowContents: any = null;
    private static windowScript = '';
    private static stopping = false;

    /**
     * @description 仅对本次5.1隔离工程的SDK计时Map安装透明观测。
     */
    public static load(): void {
        this.stopping = false;
        const editor = Reflect.get(globalThis, 'Editor'); const project = realpathSync(editor.Project.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '5.1' || registration.sdkTimerTrace !== true || registration.projectPath !== project
            || registration.creatorVersion !== '3.8.7' || editor.App.version !== '3.8.7'
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_timer_trace_project_not_registered');
        const map = editor.Metrics.__protected__.getTrackTimeStartMap(); const path = join(output, 'sdk-timer-map-trace.ndjson');
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
        if (registration.sdkRendererTimerTrace === true) {
            const receipt = join(output, 'sdk-window-renderer-trace-state.json');
            writeFileSync(receipt, JSON.stringify({ installed: false, pending: true }) + '\n');
            this.windowScript = realpathSync(join(project, 'extensions/peanut-component-sdk-compat/window-trace.js'));
            void this.installWindowTrace(createRequire(join(project, 'package.json'))('electron'), registration.creatorApp, receipt)
                .catch(error => { writeFileSync(receipt, JSON.stringify({ installed: false, failed: !this.stopping, cancelled: this.stopping,
                    error: error instanceof Error ? error.message : String(error) }) + '\n'); if (!this.stopping) console.error(error); });
        }
    }

    /**
     * @description 非阻塞等待当前SDK主窗口初始化，仅读取本项目固定观测模块；不创建或选择其它窗口。
     */
    private static async installWindowTrace(electron: any, creatorApp: string, receipt: string): Promise<void> {
        for (let attempt = 0; attempt < 100 && !this.stopping; attempt++) {
            const contents = ComponentSdkWindowDiagnostics.mainContents(electron, creatorApp, '3.8.7');
            if (contents) {
                const result = await contents.executeJavaScript('require(' + JSON.stringify(this.windowScript) + ').load()', false);
                if (result?.installed === true) { this.windowContents = contents; writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n'); return; }
            }
            await new Promise(done => setTimeout(done, 250));
        }
        if (!this.stopping) throw new Error('component_sdk_window_renderer_trace_not_ready');
    }

    /**
     * @description 只恢复自己观察的Map实例，不改变任何实际计时数据。
     */
    public static async unload(): Promise<void> {
        this.stopping = true; this.removeIpcObserver?.(); this.removeIpcObserver = null; this.restore?.(); this.restore = null;
        const contents = this.windowContents; this.windowContents = null;
        if (contents && !contents.isDestroyed()) {
            try { await contents.executeJavaScript('require(' + JSON.stringify(this.windowScript) + ').unload()', false); }
            catch (error) { if (!contents.isDestroyed()) throw error; }
        }
    }
}

export const load = (): void => ComponentSdkTimerTraceMain.load();
export const unload = (): Promise<void> => ComponentSdkTimerTraceMain.unload();
