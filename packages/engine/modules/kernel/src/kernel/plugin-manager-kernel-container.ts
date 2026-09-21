import { watch, type FSWatcher } from 'fs';

import type { IPluginRepairResult, PluginDeactivateReason } from '@peanut/pod-protocol';
import { PackagingApp } from '@peanut/pod-engine/installation';
import type { ICocosRuntime } from '@peanut/pod-engine/runtime';

import { PluginManagerApp } from '../app/plugin-manager-app.js';
import { NativeCapabilityRegistry } from '../grants/native-capability-registry.js';
import { MacOsKeychainPluginProtectedKeyProvider, type IPluginProtectedKeyProvider } from '../shared/plugin-protected-key-api.js';
import type { IPluginPackageModuleResolver } from '../loader/node-plugin-package-module-resolver.js';
import type { IPanelBridgeBrowserWindow } from '../panels/browser-panel-bridge-bootstrap.js';

/**
 * @description 单个宿主面板绑定记录，用于在 kernel reload 后重新挂载 panel bridge 与 UI。
 */
export interface IPluginManagerKernelPanelBinding {
    /**
     * @description 面板所属插件标识。
     */
    readonly pluginId: string;

    /**
     * @description 面板稳定标识。
     */
    readonly panelId: string;

    /**
     * @description 宿主当前持有的浏览器侧窗口对象。
     */
    readonly browserWindow: IPanelBridgeBrowserWindow;
}

/**
 * @description PluginManager kernel 启动钩子，用于在每次 start/reload 后重新注册内置或业务插件。
 */
export type PluginManagerKernelBootstrap = (pluginManagerApp: PluginManagerApp) => Promise<void> | void;

/**
 * @description PluginManager kernel container 可选装配参数。
 */
export interface IPluginManagerKernelContainerOptions {
    /** @description 当前项目根目录，用于写入 peanut-plugins/logs/<pluginId>。 */
    readonly diagnosticProjectPath?: string;
    /**
     * @description 稳定复用的 packaging 实例；省略时创建默认实例。
     */
    readonly packaging?: PackagingApp;

    /** @description 可选真实目录包解析器；提供后已安装第三方包可直接加载其 manifest main。 */
    readonly pluginPackageModuleResolver?: IPluginPackageModuleResolver;

    /** @description 宿主原生 capability 注册表；每次 kernel 重建时稳定复用。 */
    readonly nativeCapabilityRegistry?: NativeCapabilityRegistry;

    /** @description 宿主受保护密钥提供器；省略时 macOS 使用系统 Keychain，其它平台 fail-closed。 */
    readonly protectedKeyProvider?: IPluginProtectedKeyProvider;

    /**
     * @description 是否由通用 Plugin Manager 自动激活安装索引中的插件；由专用 CPM 宿主管理生命周期时必须关闭。
     */
    readonly activateInstalledPackages?: boolean;

    /**
     * @description 每次启动新 kernel 后执行的 bootstrap 钩子。
     */
    readonly bootstrap?: PluginManagerKernelBootstrap;
}

/**
 * @description 稳定持有宿主 runtime 与 packaging，并支持替换 plugin-manager 内核的容器。
 */
export class PluginManagerKernelContainer {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _runtime: ICocosRuntime;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packaging: PackagingApp;
    /** @description 可选真实目录包解析器，随 kernel 重建稳定复用。 */
    private readonly _pluginPackageModuleResolver: IPluginPackageModuleResolver | undefined;
    /** @description 由宿主提供的原生 capability 注册表。 */
    private readonly _nativeCapabilityRegistry: NativeCapabilityRegistry | undefined;
    /** @description 宿主受保护密钥提供器。 */
    private readonly _protectedKeyProvider: IPluginProtectedKeyProvider | undefined;
    /** @description 项目诊断日志根目录。 */
    private readonly _diagnosticProjectPath: string | undefined;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _bootstrap?: PluginManagerKernelBootstrap;
    /** @description 是否由当前容器自动激活安装索引中的插件。 */
    private readonly _activateInstalledPackages: boolean;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _panelBindings = new Map<string, IPluginManagerKernelPanelBinding>();
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _watchers: FSWatcher[] = [];
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private _reloadDebounceHandle: ReturnType<typeof setTimeout> | null = null;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private _pluginManager: PluginManagerApp | null = null;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private _storageSnapshots: ReadonlyMap<string, ReadonlyMap<string, unknown>> = new Map();
    /**
     * @description 最近一次 kernel 启动前执行的包修复结果。
     */
    private _lastStartupRepairResult: IPluginRepairResult | null = null;

    /**
     * @description 创建一个新的 PluginManager kernel container。
     * @param runtime 稳定复用的 runtime 门面
     * @param options container 装配参数
     */
    public constructor(runtime: ICocosRuntime, options: IPluginManagerKernelContainerOptions = {}) {
        this._runtime = runtime;
        this._packaging = options.packaging ?? new PackagingApp();
        this._pluginPackageModuleResolver = options.pluginPackageModuleResolver;
        this._nativeCapabilityRegistry = options.nativeCapabilityRegistry;
        this._protectedKeyProvider = options.protectedKeyProvider ?? (process.platform === 'darwin' ? new MacOsKeychainPluginProtectedKeyProvider() : undefined);
        this._diagnosticProjectPath = options.diagnosticProjectPath;
        this._bootstrap = options.bootstrap;
        this._activateInstalledPackages = options.activateInstalledPackages ?? true;
    }

    /**
     * @description 判断当前 container 是否已持有活动 kernel。
     * @returns 已启动时返回 `true`
     */
    public isStarted(): boolean {
        return this._pluginManager != null;
    }

    /**
     * @description 返回当前活动 kernel 对应的 plugin-manager 实例。
     * @returns 当前 plugin-manager 实例；未启动时返回 `null`
     */
    public getPluginManager(): PluginManagerApp | null {
        return this._pluginManager;
    }

    /**
     * @description 返回最近一次 kernel 启动前的结构化包修复结果。
     * @returns 未启动过时返回 `null`；否则返回不可影响内部记录的结果副本。
     */
    public getLastStartupRepairResult(): IPluginRepairResult | null {
        if (this._lastStartupRepairResult == null) {
            return null;
        }
        return {
            repaired: this._lastStartupRepairResult.repaired,
            actions: [...this._lastStartupRepairResult.actions],
        };
    }

    /**
     * @description 启动当前 container 的 plugin-manager 内核。
     * @returns Promise 返回当前活动的 plugin-manager 实例
     */
    public async start(): Promise<PluginManagerApp> {
        if (this._pluginManager != null) {
            return this._pluginManager;
        }

        // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
        const pluginManagerApp = new PluginManagerApp(
            this._runtime,
            this._packaging,
            this._pluginPackageModuleResolver,
            this._nativeCapabilityRegistry,
            this._diagnosticProjectPath,
            this._protectedKeyProvider,
        );
        pluginManagerApp.importStorageSnapshots(this._storageSnapshots);
        // 宿主进程可能在目录复制或索引原子替换期间中断，恢复前先清理未提交的包状态。
        this._lastStartupRepairResult = await pluginManagerApp.repairPackages();
        if (this._bootstrap != null) {
            await this._bootstrap(pluginManagerApp);
        }
        // reload 与冷启动均按安装清单的 autoActivate 收敛，避免此前漏恢复的插件永久滞留在旧运行态之外。
        if (this._activateInstalledPackages) {
            await pluginManagerApp.activateInstalledPackages();
        }
        this._pluginManager = pluginManagerApp;
        await this._restorePanelBindings(pluginManagerApp);
        return pluginManagerApp;
    }

    /**
     * @description 停止当前活动 kernel，并保留可跨 reload 的插件私有存储快照。
     * @param reason 停用原因
     * @returns Promise 在收尾完成后结束
     */
    public async stop(reason: Extract<PluginDeactivateReason, 'host_reload' | 'host_shutdown'> = 'host_reload'): Promise<void> {
        if (this._pluginManager == null) {
            return;
        }

        this._storageSnapshots = this._pluginManager.exportStorageSnapshots();
        await this._unmountPanelBindings();
        await this._pluginManager.shutdown(reason);
        this._pluginManager = null;
    }

    /**
     * @description 使用稳定 runtime 与 packaging 替换当前 plugin-manager 内核。
     * @returns Promise 返回新的 plugin-manager 实例
     */
    public async reload(): Promise<PluginManagerApp> {
        if (this._reloadDebounceHandle != null) {
            clearTimeout(this._reloadDebounceHandle);
            this._reloadDebounceHandle = null;
        }
        await this.stop('host_reload');
        return this.start();
    }

    /**
     * @description 请求调度一次 plugin-manager kernel reload。
     * @returns Promise 在调度完成后结束
     */
    public async requestReload(): Promise<void> {
        if (this._reloadDebounceHandle != null) {
            clearTimeout(this._reloadDebounceHandle);
        }
        this._reloadDebounceHandle = setTimeout(() => {
            this._reloadDebounceHandle = null;
            void this.reload();
        }, 0);
    }

    /**
     * @description 监听一组文件路径，并在变化后调度 kernel reload。
     * @param watchPaths 需要监听的文件或目录路径列表
     * @param debounceMs 文件变化后的防抖时间，单位毫秒
     * @returns 取消监听函数
     */
    public watch(watchPaths: readonly string[], debounceMs = 150): () => void {
        this.unwatch();
        for (const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ watchPath of watchPaths) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const watcher = watch(watchPath, { recursive: false }, () => {
                if (this._reloadDebounceHandle != null) {
                    clearTimeout(this._reloadDebounceHandle);
                }
                this._reloadDebounceHandle = setTimeout(() => {
                    this._reloadDebounceHandle = null;
                    void this.reload();
                }, debounceMs);
            });
            this._watchers.push(watcher);
        }

        return () => {
            this.unwatch();
        };
    }

    /**
     * @description 停止当前 container 持有的全部文件监听。
     * @returns 无返回值
     */
    public unwatch(): void {
        while (this._watchers.length > 0) {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const watcher = this._watchers.pop();
            watcher?.close();
        }
        if (this._reloadDebounceHandle != null) {
            clearTimeout(this._reloadDebounceHandle);
            this._reloadDebounceHandle = null;
        }
    }

    /**
     * @description 注册一个宿主面板绑定，并在 kernel 已启动时立即恢复 live panel bridge。
     * @param panelBinding 宿主面板绑定记录
     * @returns Promise 在绑定恢复完成后结束
     */
    public async registerPanelBinding(panelBinding: IPluginManagerKernelPanelBinding): Promise<void> {
        this._panelBindings.set(panelBinding.panelId, panelBinding);
        if (this._pluginManager == null) {
            return;
        }
        await this._restorePanelBinding(this._pluginManager, panelBinding);
    }

    /**
     * @description 删除一个宿主面板绑定。
     * @param panelId 面板稳定标识
     * @returns 无返回值
     */
    public unregisterPanelBinding(panelId: string): void {
        this._panelBindings.delete(panelId);
    }

    /**
     * @description 释放当前 container 持有的文件监听与活动 kernel。
     * @returns Promise 在全部资源释放完成后结束
     */
    public async dispose(): Promise<void> {
        this.unwatch();
        await this.stop('host_shutdown');
        this._runtime.execution.dispose();
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _restorePanelBindings(pluginManagerApp: PluginManagerApp): Promise<void> {
        for (const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ panelBinding of this._panelBindings.values()) {
            await this._restorePanelBinding(pluginManagerApp, panelBinding);
        }
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _restorePanelBinding(
        pluginManagerApp: PluginManagerApp,
        panelBinding: IPluginManagerKernelPanelBinding,
    ): Promise<void> {
        await pluginManagerApp.launchPanelContainer(
            panelBinding.pluginId,
            panelBinding.panelId,
            panelBinding.browserWindow,
        );
    }

    /** @description 封装当前职责中的一个处理步骤，并协调所需校验、状态与依赖调用。 */
    private async _unmountPanelBindings(): Promise<void> {
        if (this._pluginManager == null) {
            return;
        }
        for (const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ panelBinding of this._panelBindings.values()) {
            await this._pluginManager.unmountPanelUiFromWindow(
                panelBinding.pluginId,
                panelBinding.panelId,
                panelBinding.browserWindow,
            );
        }
    }
}
