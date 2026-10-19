import { existsSync, realpathSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
const { HostUpdateCoordinator } = require('./host-update-coordinator.ts');

/**
 * @description SDK worker runtime 生命周期契约；不装载 Host 主进程 runtime。
 */
interface ISdkWorkerRuntime { load(): void; unload(): void; methods?: { beforePreStart?(): void } }

/**
 * @description SDK worker 与主 bootstrap 共享正式更新协调器的活动版本和回滚选择。
 */
export class SdkStartupTimerBootstrap {
    /**
     * @description 仅持有当前 worker 的运行时，不修改其它进程状态。
     */
    private static bootstrap: ISdkWorkerRuntime | null = null;

    /**
     * @description 从升级目录识别稳定扩展根。
     * @param directory 实际 bootstrap 的 dist 目录。
     * @returns 当前稳定 Host 扩展根。
     */
    public static extensionRoot(directory: string): string {
        const root = resolve(directory, '..');
        return basename(dirname(root)) === '.peanut-pod-lite-host-versions'
            ? resolve(dirname(root), '../peanut-pod-lite-host') : root;
    }

    /**
     * @description 通过正式更新协调器选择 worker runtime，不硬钉安装时旧版本。
     * @param extensionRoot 稳定扩展根。
     * @param projectPath 实际工程。
     * @returns 独立 worker 的装卸钩子。
     */
    public static create(extensionRoot: string, projectPath: string): ISdkWorkerRuntime {
        let runtime: ISdkWorkerRuntime | null = null;
        const coordinator = new HostUpdateCoordinator({ extensionRoot, projectPath });
        return {
            load(): void {
                if (runtime) return;
                const entry = join(dirname(coordinator.runtimeEntry()), 'sdk-startup-timer-worker.js');
                if (!existsSync(entry)) throw new Error('peanut_sdk_timer_worker_runtime_missing');
                const selected: unknown = require(entry);
                if (!selected || typeof selected !== 'object' || typeof Reflect.get(selected, 'load') !== 'function'
                    || typeof Reflect.get(selected, 'unload') !== 'function') throw new Error('peanut_sdk_timer_worker_runtime_invalid');
                const loaded = selected as ISdkWorkerRuntime;
                loaded.load(); runtime = loaded;
            },
            unload(): void { if (runtime) { runtime.unload(); runtime = null; } },
            methods: { beforePreStart(): void { runtime?.methods?.beforePreStart?.(); } },
        };
    }

    /**
     * @description 首次 SDK load 才解析工程归属，单测导入不启动 SDK。
     */
    public static load(): void {
        if (!this.bootstrap) {
            const extensionRoot = this.extensionRoot(__dirname);
            const editor: unknown = Reflect.get(globalThis, 'Editor');
            const project: unknown = editor && typeof editor === 'object' ? Reflect.get(editor, 'Project') : undefined;
            const path: unknown = project && typeof project === 'object' ? Reflect.get(project, 'path') : undefined;
            const localProject = resolve(extensionRoot, '../..');
            const projectPath = typeof path === 'string' ? path
                : basename(dirname(extensionRoot)) === 'extensions' && existsSync(join(localProject, 'package.json')) ? localProject : null;
            if (!projectPath) throw new Error('peanut_sdk_timer_worker_project_missing');
            this.bootstrap = this.create(realpathSync(extensionRoot), realpathSync(projectPath));
        }
        this.bootstrap.load();
    }

    /**
     * @description SDK 卸载时只清理当前 worker 的运行时。
     */
    public static unload(): void { if (this.bootstrap) { this.bootstrap.unload(); this.bootstrap = null; } }

    /**
     * @description SDK 正式预启动入口。
     */
    public static beforePreStart(): void { if (!this.bootstrap) this.load(); this.bootstrap?.methods?.beforePreStart?.(); }
}

export const load = (): void => SdkStartupTimerBootstrap.load();
export const unload = (): void => SdkStartupTimerBootstrap.unload();
export const methods = { beforePreStart: (): void => SdkStartupTimerBootstrap.beforePreStart() };
