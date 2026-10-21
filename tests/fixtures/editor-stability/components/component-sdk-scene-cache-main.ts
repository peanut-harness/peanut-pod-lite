import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { ComponentSdkSceneCacheCompat } from './component-sdk-scene-cache-compat';

/**
 * @description 显式登记的3.8.3项目内缓存幂等修复，不改SDK安装目录、缓存文件、日志或其它进程。
 */
class ComponentSdkSceneCacheMain {
    /**
     * @description 本扩展独占的安装控制器。
     */
    private static patch: ReturnType<typeof ComponentSdkSceneCacheCompat.install> | null = null;
    /**
     * @description 当前隔离项目和证据路径。
     */
    private static project = '';
    /**
     * @description 已保存的真实回调事件数量。
     */
    private static events = 0;
    /**
     * @description 当前公开只读状态标记，只撤销本扩展创建的对象。
     */
    private static marker: object | null = null;

    /**
     * @description 精确核对项目登记、版本和已装载SDK单例后安装，未知来源立即失败。
     */
    public static load(): void {
        const editor = Reflect.get(globalThis, 'Editor');
        this.project = realpathSync(editor.Project.path); const output = dirname(this.project);
        const registration: unknown = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8'));
        if (!registration || typeof registration !== 'object' || Reflect.get(registration, 'task') !== '5.1'
            || Reflect.get(registration, 'sdkSceneCacheCompat') !== true || Reflect.get(registration, 'projectPath') !== this.project
            || Reflect.get(registration, 'creatorVersion') !== '3.8.3' || editor.App.version !== '3.8.3'
            || typeof Reflect.get(registration, 'worktree') !== 'string'
            || !this.project.startsWith(realpathSync(Reflect.get(registration, 'worktree')) + sep + 'evidence' + sep + 'task-5.1' + sep))
            throw new Error('component_sdk_cache_project_not_registered');
        const cache = createRequire(join(this.project, 'package.json')).cache;
        const entries = Object.entries(cache).filter(([path]) => path.endsWith('/app.asar/builtin/scene/dist/browser/scene-cache.ccc'));
        if (entries.length !== 1 || !entries[0]?.[1]) throw new Error('component_sdk_cache_module_not_unique');
        const key = Symbol.for('peanut.component.sdk-scene-cache-compat');
        if (Reflect.has(globalThis, key)) throw new Error('component_sdk_cache_already_installed');
        this.patch = ComponentSdkSceneCacheCompat.install(entries[0][1].exports, this.project, editor.App.version, () => this.save());
        this.marker = { status: (): unknown => ({ ...this.patch?.state, projectPath: this.project, pid: process.pid,
            managerHookVerified: this.patch?.isInstalled() === true }) };
        Reflect.set(globalThis, key, this.marker); this.save();
    }

    /**
     * @description 保留SDK原方法并且只恢复自身安装的入口。
     */
    public static unload(): void {
        if (!this.patch) return;
        this.patch.restore(); this.save();
        const key = Symbol.for('peanut.component.sdk-scene-cache-compat');
        if (Reflect.get(globalThis, key) !== this.marker) throw new Error('component_sdk_cache_marker_identity_changed');
        Reflect.deleteProperty(globalThis, key); this.patch = null; this.marker = null;
    }

    /**
     * @description 记录真实分支计数及事件，不合成SDK计时或省略原始诊断。
     */
    private static save(): void {
        if (!this.patch) return;
        const output = dirname(this.project); const state = this.patch.state;
        writeFileSync(join(output, 'sdk-scene-cache-compat-state.json'), JSON.stringify({ ...state, projectPath: this.project,
            pid: process.pid, managerHookVerified: this.patch.isInstalled() }, null, 2) + '\n');
        const count = state.absentCleared + state.originalDelegated;
        if (count > this.events) { appendFileSync(join(output, 'sdk-scene-cache-compat-events.ndjson'), JSON.stringify(state.last) + '\n'); this.events = count; }
    }
}

export const load = (): void => ComponentSdkSceneCacheMain.load();
export const unload = (): void => ComponentSdkSceneCacheMain.unload();
