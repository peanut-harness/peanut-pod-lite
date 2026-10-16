import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkTimerTrace } from './component-sdk-timer-trace';

/**
 * @description 显式登记的SDK计时观测入口；不修改安装包、统计事件或原始日志。
 */
class ComponentSdkTimerTraceMain {
    private static restore: (() => void) | null = null;

    /**
     * @description 仅对本次5.1隔离工程的SDK计时Map安装透明观测。
     */
    public static load(): void {
        const editor = Reflect.get(globalThis, 'Editor'); const project = realpathSync(editor.Project.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '5.1' || registration.sdkTimerTrace !== true || registration.projectPath !== project
            || registration.creatorVersion !== '3.8.7' || editor.App.version !== '3.8.7'
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_timer_trace_project_not_registered');
        const map = editor.Metrics.__protected__.getTrackTimeStartMap(); const path = join(output, 'sdk-timer-map-trace.ndjson');
        appendFileSync(path, JSON.stringify({ method: 'installed', starts: [...map.entries()], at: Date.now(), pid: process.pid }) + '\n');
        let count = 0;
        this.restore = ComponentSdkTimerTrace.install(map, event => {
            if (++count > 10000) throw new Error('component_sdk_timer_trace_budget_exceeded');
            appendFileSync(path, JSON.stringify(event) + '\n');
        });
    }

    /**
     * @description 只恢复自己观察的Map实例，不改变任何实际计时数据。
     */
    public static unload(): void { this.restore?.(); this.restore = null; }
}

export const load = (): void => ComponentSdkTimerTraceMain.load();
export const unload = (): void => ComponentSdkTimerTraceMain.unload();
