import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkRendererTimerTrace } from './component-sdk-renderer-timer-trace';

/**
 * @description 仅在已登记的现有SDK主窗口装载透明发送端观测，不打开窗口或更改原始诊断。
 */
class ComponentSdkWindowTimerTrace {
    private static patch: ReturnType<typeof ComponentSdkRendererTimerTrace.install> | null = null;

    /**
     * @description 校验同一隔离工程后安装；SDK窗口仍在初始化时只报告未就绪。
     */
    public static load(): unknown {
        const project = realpathSync(join(__dirname, '../..')); const registration = JSON.parse(readFileSync(join(dirname(project), 'project-ownership.json'), 'utf8'));
        const editor = Reflect.get(globalThis, 'Editor');
        if (registration.task !== '5.1' || registration.sdkRendererTimerTrace !== true || registration.projectPath !== project
            || registration.creatorVersion !== '3.8.7' || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_window_timer_trace_project_not_registered');
        if (!editor?.App?.version || !editor?.Project?.path) return { installed: false, ready: false };
        if (realpathSync(editor.Project.path) !== project) throw new Error('component_sdk_window_timer_trace_active_project_changed');
        if (!this.patch) this.patch = ComponentSdkRendererTimerTrace.install(require.cache, editor.App.version, project, 'main-window');
        return ComponentSdkRendererTimerTrace.snapshot();
    }

    /**
     * @description 只恢复自己持有的观测租约，窗口销毁后其运行时状态自然结束。
     */
    public static unload(): void { this.patch?.restore(); this.patch = null; }
}

export const load = (): unknown => ComponentSdkWindowTimerTrace.load();
export const unload = (): void => ComponentSdkWindowTimerTrace.unload();
