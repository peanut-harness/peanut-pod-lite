import { SdkStartupTimerCompat } from './sdk-startup-timer-compat';

/**
 * @description 正式 asset-db worker 生命周期，3.8.3 不安装未经核验的兼容实现。
 */
export class SdkStartupTimerWorker {
    /**
     * @description 仅持有本 worker 实际安装的恢复句柄。
     */
    private patch: ReturnType<typeof SdkStartupTimerCompat.install> | null = null;

    /**
     * @description 在实际数据库预启动之前安装精确版本修复。
     * @param editor SDK worker 的 Editor。
     * @param manager SDK worker 的 Manager。
     */
    public load(editor: unknown, manager: unknown): void {
        if (this.patch) return;
        const app = this.field(editor, 'App'); const version = this.field(app, 'version');
        if (typeof version !== 'string') throw new Error('peanut_sdk_timer_worker_version_missing');
        if (version !== '3.8.7') return;
        this.patch = SdkStartupTimerCompat.install(this.field(manager, 'assetDBManager'), this.field(editor, 'Metrics'), version);
    }

    /**

     * @description 卸载仅恢复本 worker 安装的原始引用。

     */
    public unload(): void { if (this.patch) { this.patch.restore(); this.patch = null; } }

    /**

     * @description 可复核的有限安装状态，不写日志或改变 SDK 计时。

     */
    public status(): { installed: boolean; starts: number } { return this.patch ? { ...this.patch.state } : { installed: false, starts: 0 }; }

    /**

     * @description 安全读取外部 SDK 对象字段。

     */
    private field(value: unknown, key: string): unknown { return value && typeof value === 'object' ? Reflect.get(value, key) : undefined; }
}

const worker = new SdkStartupTimerWorker();
/**
 * @description Host asset-db 贡献可能在 beforePreStart 全局派发之后才加载；SDK 仍会在此后启动数据库。
 * 在直接 worker 入口求值时尽早安装，SDK 全局尚未就绪时交由原始生命周期钩子重试。
 */
const installIfReady = (): void => {
    const editor = Reflect.get(globalThis, 'Editor');
    const manager = Reflect.get(globalThis, 'Manager');
    const app = editor && typeof editor === 'object' ? Reflect.get(editor, 'App') : undefined;
    const assetDBManager = manager && typeof manager === 'object' ? Reflect.get(manager, 'assetDBManager') : undefined;
    if (app && typeof app === 'object' && Reflect.get(app, 'version') === '3.8.7'
        && assetDBManager && typeof assetDBManager === 'object') worker.load(editor, manager);
};
installIfReady();
/**
 * @description SDK 正式 load 钩子。
 */
export const load = (): void => worker.load(Reflect.get(globalThis, 'Editor'), Reflect.get(globalThis, 'Manager'));
/**
 * @description SDK 正式 unload 钩子。
 */
export const unload = (): void => worker.unload();
/**
 * @description load 后的预启动钩子幂等确认，绝不重放数据库工作。
 */
export const methods = { beforePreStart: load };
