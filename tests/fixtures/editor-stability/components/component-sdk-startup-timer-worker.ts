import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkStartupTimerCompat } from './component-sdk-startup-timer-compat';
import { ComponentSdkWorkerDiagnostics } from './component-sdk-worker-diagnostics';

/**
 * @description 显式登记的工程内SDK启动计时修复；独立于只读probe及SDK安装目录。
 */
class ComponentSdkStartupTimerWorker {
    private static patch: ReturnType<typeof ComponentSdkStartupTimerCompat.install> | null = null;
    private static receipt = '';
    private static trace = false;

    /**
     * @description 在数据库尚未预启动时核对登记、SDK版本和真实方法，安装单一入口修复。
     */
    public static load(): void {
        const project = realpathSync(join(__dirname, '../..')); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (registration.task !== '5.1' || registration.sdkStartupTimerCompat !== true || registration.projectPath !== project
            || registration.creatorVersion !== '3.8.7'
            || !project.startsWith(realpathSync(registration.worktree) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_startup_timer_project_not_registered');
        this.receipt = join(output, 'sdk-startup-timer-compat-state.json'); this.trace = registration.sdkTimerTrace === true;
        if (this.trace) ComponentSdkWorkerDiagnostics.observe('load');
        const editor = Reflect.get(globalThis, 'Editor'); const manager = Reflect.get(globalThis, 'Manager')?.assetDBManager;
        this.patch = ComponentSdkStartupTimerCompat.install(manager, editor.Metrics, editor.App.version, () => this.save()); this.save();
    }

    /**
     * @description 只恢复本扩展安装的方法，不释放其它SDK状态或更改日志。
     */
    public static unload(): void { if (this.patch) { this.patch.restore(); this.save(); this.patch = null; } }

    /**
     * @description SDK真实钩子保留修复状态，并可选进行独立只读源码观测。
     */
    public static observe(hook: string): void { this.save(); if (this.trace) ComponentSdkWorkerDiagnostics.observe(hook); }

    /**
     * @description 保存当前工作进程与真实start调用，时间仅为观测记录，不参与SDK计时。
     */
    private static save(): void {
        if (this.receipt) writeFileSync(this.receipt, JSON.stringify({ ...this.patch?.state, workerPid: process.pid }, null, 2) + '\n');
    }
}

export const load = (): void => ComponentSdkStartupTimerWorker.load();
export const unload = (): void => ComponentSdkStartupTimerWorker.unload();
export const methods = {
    afterInit: (): void => ComponentSdkStartupTimerWorker.observe('afterInit'),
    beforePreStart: (): void => ComponentSdkStartupTimerWorker.observe('beforePreStart'),
    beforeReady: (): void => ComponentSdkStartupTimerWorker.observe('beforeReady'),
};
