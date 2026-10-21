import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { ComponentSdkListenerCompat } from './component-sdk-listener-compat';
import { ComponentSdkRendererTimerTrace } from './component-sdk-renderer-timer-trace';

/**
 * @description 独立项目扩展提供SDK兼容修复，原只读probe保持只读，不修改Creator安装包。
 */
class ComponentSdkListenerScene {
    private static patch: ReturnType<typeof ComponentSdkListenerCompat.install> | null = null;
    private static receipt = '';
    private static timerTrace: ReturnType<typeof ComponentSdkRendererTimerTrace.install> | null = null;

    /**
     * @description 只在明确登记的全新5.1工程加载，不处理原工程或未核验SDK。
     */
    public static load(): void {
        const cce = Reflect.get(globalThis, 'cce'); const editor = Reflect.get(globalThis, 'Editor');
        const project = realpathSync(cce?.project ?? editor?.Project?.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '5.1' || registration.sdkListenerCompat !== true || registration.projectPath !== project
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_listener_project_not_registered');
        const cc = require('cc');
        this.patch = ComponentSdkListenerCompat.install(cce.Component, Reflect.get(globalThis, 'EditorExtends').Component, cc.VERSION);
        if (registration.sdkRendererTimerTrace === true) this.timerTrace = ComponentSdkRendererTimerTrace.install(require.cache, cc.VERSION, project, 'scene');
        this.receipt = join(output, 'sdk-listener-compat-state.json');
        this.save();
    }

    /**
     * @description 卸载只恢复自己安装的单一方法；SDK原有关闭路径负责当前有效回调。
     */
    public static unload(): void { this.timerTrace?.restore(); this.timerTrace = null; if (this.patch) { this.patch.restore(); this.save(); this.patch = null; } }

    /**
     * @description 只读状态回执供实际候选验证，不执行或开放其它SDK操作。
     */
    public static status(): unknown { this.save(); return this.patch ? { ...this.patch.state, rendererTimerTrace: ComponentSdkRendererTimerTrace.snapshot() } : null; }

    /**
     * @description SDK修复状态与场景进程身份单独落盘，不改变任何原始日志。
     */
    private static save(): void {
        if (this.receipt) writeFileSync(this.receipt, JSON.stringify({ ...this.patch?.state, scenePid: process.pid }, null, 2) + '\n');
    }
}

export const load = (): void => ComponentSdkListenerScene.load();
export const unload = (): void => ComponentSdkListenerScene.unload();
export const methods = { status: (): unknown => ComponentSdkListenerScene.status() };
