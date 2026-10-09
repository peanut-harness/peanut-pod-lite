import { watch, type FSWatcher } from 'fs';

import { PackagingApp } from '@peanut/pod-engine/installation';
import type { ICocosRuntime } from '@peanut/pod-engine/runtime';

import {
    PluginManagerKernelContainer,
    type IPluginManagerKernelContainerOptions,
    type PluginManagerKernelBootstrap,
} from '../kernel/plugin-manager-kernel-container.js';
import type { IPluginManagerBuiltinPanelRegistration } from './plugin-manager-builtin-panel-registration.js';
import type { IPanelBridgeBrowserWindow } from '../panels/browser-panel-bridge-bootstrap.js';
import type { IHostPanelContainerLaunchResult } from '../panels/host-panel-container-launcher.js';

/**
 * @description PluginManager 宿主壳装配参数。
 */
export interface IPluginManagerHostShellOptions extends Omit<IPluginManagerKernelContainerOptions, 'packaging' | 'bootstrap'> {
    /**
     * @description 稳定复用的 packaging 实例；省略时创建默认实例。
     */
    readonly packaging?: PackagingApp;

    /**
     * @description 追加的 kernel bootstrap 钩子，会在 builtin panel 模块注册完成后执行。
     */
    readonly bootstrap?: PluginManagerKernelBootstrap;

    /**
     * @description 可选 builtin panel 注册项；提供时 host shell 会暴露对应的 builtin panel 便捷方法。
     */
    readonly builtinPanelRegistration?: IPluginManagerBuiltinPanelRegistration;
}

/**
 * @description 文件变更在宿主壳侧的处理策略。
 */
export type PluginManagerHostShellChangeStrategy = 'kernel' | 'panel-ui' | 'ignore';

/**
 * @description 稳定持有 runtime / packaging，并把 builtin plugin-manager panel 与 kernel reload 接到同一条宿主壳链路上的最小外壳。
 */
export class PluginManagerHostShell {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _kernelContainer: PluginManagerKernelContainer;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _builtinPanelRegistration: IPluginManagerBuiltinPanelRegistration | null;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _builtinPanelBindings = new Set<IPanelBridgeBrowserWindow>();
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _watchers: FSWatcher[] = [];
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private _watchDebounceHandle: ReturnType<typeof setTimeout> | null = null;

    /**
     * @description 创建一个新的 PluginManager 宿主壳。
     * @param runtime 稳定复用的 runtime 门面
     * @param options 宿主壳装配参数
     */
    public constructor(runtime: ICocosRuntime, options: IPluginManagerHostShellOptions = {}) {
        this._builtinPanelRegistration = options.builtinPanelRegistration ?? null;
        this._kernelContainer = new PluginManagerKernelContainer(runtime, {
            packaging: options.packaging,
            pluginPackageModuleResolver: options.pluginPackageModuleResolver,
            nativeCapabilityRegistry: options.nativeCapabilityRegistry,
            diagnosticProjectPath: options.diagnosticProjectPath,
            activateInstalledPackages: options.activateInstalledPackages,
            repairInstalledPackagesOnStartup: options.repairInstalledPackagesOnStartup,
            bootstrap: async (pluginManagerApp): Promise<void> => {
                if (this._builtinPanelRegistration != null) {
                    await this._builtinPanelRegistration.register(pluginManagerApp, async (): Promise<void> => {
                        await this._kernelContainer.requestReload();
                    });
                }

                if (options.bootstrap != null) {
                    await options.bootstrap(pluginManagerApp);
                }
            },
        });
    }

    /**
     * @description 启动当前宿主壳持有的 plugin-manager 内核。
     * @returns Promise 在启动完成后结束
     */
    public async start(): Promise<void> {
        await this._kernelContainer.start();
    }

    /**
     * @description 停止当前宿主壳持有的 plugin-manager 内核。
     * @returns Promise 在收尾完成后结束
     */
    public async stop(): Promise<void> {
        await this._kernelContainer.stop('host_shutdown');
    }

    /**
     * @description 释放当前宿主壳持有的全部资源。
     * @returns Promise 在释放完成后结束
     */
    public async dispose(): Promise<void> {
        this.unwatch();
        await this._kernelContainer.dispose();
    }

    /**
     * @description 请求调度一次 plugin-manager kernel reload。
     * @returns Promise 在调度完成后结束
     */
    public async requestReload(): Promise<void> {
        await this._kernelContainer.requestReload();
    }

    /**
     * @description 在当前编辑器进程内立即完成一次 plugin-manager 内核热重载，不重启 Creator 引擎。
     * @returns Promise 在新内核、内置模块和已绑定面板均恢复后结束
     */
    public async reloadKernelNow(): Promise<void> {
        await this._kernelContainer.reload();
    }

    /**
     * @description 把 builtin plugin-manager panel 绑定到一个宿主浏览器窗口对象上。
     * @param browserWindow 宿主当前持有的浏览器侧窗口对象
     * @returns Promise 在面板绑定完成后结束
     */
    public async bindBuiltinPluginManagerPanel(browserWindow: IPanelBridgeBrowserWindow): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPanelRegistration = this._requireBuiltinPanelRegistration();
        await this._kernelContainer.start();
        this._builtinPanelBindings.add(browserWindow);
        await this._kernelContainer.registerPanelBinding({
            pluginId: builtinPanelRegistration.pluginId,
            panelId: builtinPanelRegistration.panelId,
            browserWindow,
        });
    }

    /**
     * @description 让宿主通过 runtime panel host 直接打开 builtin plugin-manager panel。
     * @returns Promise 返回当前宿主面板会话、浏览器上下文和桥接注入结果
     */
    public async openBuiltinPluginManagerPanel(): Promise<IHostPanelContainerLaunchResult> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPanelRegistration = this._requireBuiltinPanelRegistration();
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const pluginManagerApp = await this._kernelContainer.start();
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const launchResult = await pluginManagerApp.launchPanelContainer(
            builtinPanelRegistration.pluginId,
            builtinPanelRegistration.panelId,
        );
        if (launchResult.browserWindow != null) {
            this._builtinPanelBindings.add(launchResult.browserWindow);
            await this._kernelContainer.registerPanelBinding({
                pluginId: builtinPanelRegistration.pluginId,
                panelId: builtinPanelRegistration.panelId,
                browserWindow: launchResult.browserWindow,
            });
        }
        return launchResult;
    }

    /**
     * @description 基于变更路径判断当前更适合触发的热更新策略。
     * @param changedPath 发生变化的文件路径
     * @returns 对应的宿主壳处理策略
     */
    public resolveChangeStrategy(changedPath: string): PluginManagerHostShellChangeStrategy {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const normalizedPath = this._normalizePath(changedPath);
        if (normalizedPath.includes('/@peanut/pod-panel/panels/plugin-manager/')) {
            return 'panel-ui';
        }
        if (normalizedPath.includes('/@peanut/pod-engine/kernel/src/host/')) {
            return 'ignore';
        }
        if (normalizedPath.includes('/@peanut/pod-engine/kernel/src/')) {
            return 'kernel';
        }
        return 'ignore';
    }

    /**
     * @description 根据一组变化路径执行最小必要的热更新动作。
     * @param changedPaths 变化文件路径列表
     * @returns Promise 返回本次采用的处理策略
     */
    public async handleChangedPaths(changedPaths: readonly string[]): Promise<PluginManagerHostShellChangeStrategy> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const changeStrategies = changedPaths.map((changedPath) => {
            return this.resolveChangeStrategy(changedPath);
        });
        if (changeStrategies.includes('kernel')) {
            await this._kernelContainer.reload();
            return 'kernel';
        }
        if (changeStrategies.includes('panel-ui')) {
            await this._remountBuiltinPanels();
            return 'panel-ui';
        }
        return 'ignore';
    }

    /**
     * @description 返回当前宿主壳持有的活动 plugin-manager 实例。
     * @returns 当前活动 plugin-manager 实例；未启动时返回 `null`
     */
    public getPluginManager() {
        return this._kernelContainer.getPluginManager();
    }

    /**
     * @description 监听一组文件路径，并在变化时按最小策略执行 panel remount 或 kernel reload。
     * @param watchPaths 需要监听的文件或目录路径列表
     * @param debounceMs 文件变化后的防抖时间，单位毫秒
     * @returns 取消监听函数
     */
    public watch(watchPaths: readonly string[], debounceMs = 150): () => void {
        this.unwatch();
        for (const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ watchPath of watchPaths) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const watcher = watch(watchPath, { recursive: false }, (_eventType, filename) => {
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const normalizedWatchPath = this._normalizePath(watchPath);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const normalizedFilename = filename == null ? '' : this._normalizePath(filename);
                // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
                const effectiveChangedPath = normalizedFilename.length > 0
                    ? `${normalizedWatchPath}/${normalizedFilename}`.replace(/\/+/g, '/')
                    : normalizedWatchPath;
                if (this._watchDebounceHandle != null) {
                    clearTimeout(this._watchDebounceHandle);
                }
                this._watchDebounceHandle = setTimeout(() => {
                    this._watchDebounceHandle = null;
                    void this.handleChangedPaths([effectiveChangedPath]);
                }, debounceMs);
            });
            this._watchers.push(watcher);
        }
        return () => {
            this.unwatch();
        };
    }

    /**
     * @description 关闭当前宿主壳注册的全部文件监听。
     * @returns 无返回值
     */
    public unwatch(): void {
        while (this._watchers.length > 0) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const watcher = this._watchers.pop();
            watcher?.close();
        }
        if (this._watchDebounceHandle != null) {
            clearTimeout(this._watchDebounceHandle);
            this._watchDebounceHandle = null;
        }
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _remountBuiltinPanels(): Promise<void> {
        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const builtinPanelRegistration = this._requireBuiltinPanelRegistration();
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const pluginManagerApp = await this._kernelContainer.start();
        for (const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ browserWindow of this._builtinPanelBindings.values()) {
            await pluginManagerApp.launchPanelContainer(
                builtinPanelRegistration.pluginId,
                builtinPanelRegistration.panelId,
                browserWindow,
            );
        }
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _requireBuiltinPanelRegistration(): IPluginManagerBuiltinPanelRegistration {
        if (this._builtinPanelRegistration == null) {
            throw new Error('plugin_manager_builtin_panel_registration_missing');
        }
        return this._builtinPanelRegistration;
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private _normalizePath(path: string): string {
        return path.replace(/\\/g, '/').toLowerCase();
    }
}
