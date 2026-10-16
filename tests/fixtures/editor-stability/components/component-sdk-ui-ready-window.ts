import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkUiReadyCompat } from './component-sdk-ui-ready-compat';

/**
 * @description 仅在两次真实SDK首次计时结束的证明落盘后，安装当前隔离窗口的精确兼容。
 */
class ComponentSdkUiReadyWindow {
    private static patch: ReturnType<typeof ComponentSdkUiReadyCompat.install> | null = null;
    private static project = '';

    /**
     * @description 核对工程、SDK及实际阶段证据；不执行SDK函数文本或生成计时数据。
     */
    public static load(): unknown {
        const project = realpathSync(join(__dirname, '../..')); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        const proof = JSON.parse(readFileSync(join(output, 'sdk-ui-ready-phases.json'), 'utf8'));
        const editor = Reflect.get(globalThis, 'Editor');
        if (registration.task !== '5.1' || registration.sdkUiReadyCompat !== true || registration.projectPath !== project
            || !['3.8.3', '3.8.7'].includes(registration.creatorVersion) || editor.App.version !== registration.creatorVersion || realpathSync(editor.Project.path) !== project
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep)
            || proof.runId !== registration.runId || proof.projectPath !== project
            || !['main-window:ready', 'hierarchy:render-tree'].every(label => proof.observed?.includes(label)))
            throw new Error('component_sdk_ui_ready_project_or_phase_unverified');
        this.project = project;
        if (!this.patch) this.patch = ComponentSdkUiReadyCompat.install(require.cache, Reflect.get(globalThis, 'window'), editor.App.version);
        return this.status();
    }

    /**
     * @description 只读已安装兼容及真实串行调用统计。
     */
    public static status(): unknown { return this.patch ? { ...this.patch.state, scope: this.project, processPid: process.pid } : null; }

    /**
     * @description SDK实际ready结束后恢复自己的函数，不重新激活已完成启动阶段的标记。
     */
    public static async unload(): Promise<void> { if (this.patch) { await this.patch.idle(); this.patch.restore(); this.patch = null; } }
}

export const load = (): unknown => ComponentSdkUiReadyWindow.load();
export const status = (): unknown => ComponentSdkUiReadyWindow.status();
export const unload = (): Promise<void> => ComponentSdkUiReadyWindow.unload();
