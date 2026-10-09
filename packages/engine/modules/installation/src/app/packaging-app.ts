import type {
    IPluginInstallPlan,
    IPluginInstallResult,
    IPluginManifest,
    IPluginPackResult,
    IPluginPackageInspection,
    IPluginPackageMeta,
    IPluginPackageValidationResult,
    IPluginRepairResult,
    IPluginUninstallResult,
} from '@peanut/pod-protocol';

import { InstallPlanner } from '../install/install-planner.js';
import { PackageInstaller } from '../install/package-installer.js';
import { PackageBuilder } from '../pack/package-builder.js';
import { PackageInspector } from '../inspect/package-inspector.js';
import { RollbackCoordinator } from '../rollback/rollback-coordinator.js';
import { InstalledPackageStore, type IInstalledPackageRecord, type IInstalledPackageSnapshot } from '../shared/installed-package-store.js';
import { PackageSnapshotStore, type IPackageSnapshot } from '../shared/package-snapshot-store.js';
import { StagingStore } from '../staging/staging-store.js';
import { PackageValidator } from '../validate/package-validator.js';
import { ProjectPackageStore } from '../persistence/project-package-store.js';
import { ProjectPluginFileStore } from '../persistence/project-plugin-file-store.js';

/**
 * @description Packaging 的可选项目持久化配置；未提供时维持内存模式以兼容单元测试和纯运行时场景。
 */
export interface IPackagingAppOptions {
    /** @description Cocos 工程根目录；提供后安装索引与插件版本将持久化到 `peanut-plugins/`。 */
    readonly projectPath?: string;
    /** @description 宿主级全局插件配置目录；提供后启用 global 设置层。 */
    readonly globalPluginConfigsPath?: string;
}

/**
 * @description Packaging 模块主入口，负责装配打包、检查、校验、安装、回滚子系统。
 */
export class PackagingApp {
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packageInspector: PackageInspector;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packageValidator: PackageValidator;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _installPlanner: InstallPlanner;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packageInstaller: PackageInstaller;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packageBuilder: PackageBuilder;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _rollbackCoordinator: RollbackCoordinator;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _stagingStore: StagingStore;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _installedPackageStore: InstalledPackageStore;
    /** @description 由当前实例持有的运行状态或协作依赖，贯穿实例生命周期供后续操作使用。 */
    private readonly _packageSnapshotStore: PackageSnapshotStore;
    /** @description 可选项目级目录包仓；负责真实安装与跨重启恢复。 */
    private readonly _projectPackageStore: ProjectPackageStore | null;
    /** @description 可选项目级插件文件系统；负责插件缓存与 JSON 配置。 */
    private readonly _projectPluginFileStore: ProjectPluginFileStore | null;

    /**
     * @description 创建一个新的 Packaging 模块主入口。
     */
    public constructor(options: IPackagingAppOptions = {}) {
        this._packageSnapshotStore = new PackageSnapshotStore();
        this._stagingStore = new StagingStore();
        this._installedPackageStore = new InstalledPackageStore();
        this._projectPackageStore = options.projectPath == null ? null : new ProjectPackageStore(options.projectPath);
        this._projectPluginFileStore = options.projectPath == null ? null : new ProjectPluginFileStore(options.projectPath, {
            globalConfigsPath: options.globalPluginConfigsPath,
        });
        if (this._projectPackageStore != null) {
            this._installedPackageStore.restoreSnapshots(this._projectPackageStore.readInstalledSnapshots());
        }

        this._packageInspector = new PackageInspector(this._packageSnapshotStore, this._projectPackageStore ?? undefined);
        this._packageValidator = new PackageValidator();
        this._installPlanner = new InstallPlanner();
        this._packageInstaller = new PackageInstaller(this._stagingStore, this._installedPackageStore);
        this._packageBuilder = new PackageBuilder(this._packageSnapshotStore);
        this._rollbackCoordinator = new RollbackCoordinator(this._stagingStore, this._installedPackageStore);
    }

    /**
     * @description 检查指定路径上的插件包结构。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化检查结果
     */
    public async inspect(packagePath: string): Promise<IPluginPackageInspection> {
        return this._packageInspector.inspect(packagePath);
    }

    /**
     * @description 校验指定路径上的插件包。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化校验结果
     */
    public async validate(packagePath: string): Promise<IPluginPackageValidationResult> {
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const packageInspection = await this.inspect(packagePath);
        return this._packageValidator.validate(packageInspection);
    }

    /**
     * @description 为指定路径上的插件包生成安装计划。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化安装计划
     */
    public async planInstall(packagePath: string): Promise<IPluginInstallPlan> {
        this._refreshProjectInstalledSnapshots();
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const packageInspection = await this.inspect(packagePath);
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const validationResult = await this._packageValidator.validate(packageInspection);
        // 保存从依赖读取的当前数据，供本步骤判断、转换或组装输出使用。
        const currentInstalledPackageRecord = packageInspection.manifest == null ? null : this._installedPackageStore.get(packageInspection.manifest.id);
        return this._installPlanner.plan(packageInspection, validationResult, currentInstalledPackageRecord);
    }

    /**
     * @description 安装指定路径上的插件包。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化安装结果
     */
    public async install(packagePath: string): Promise<IPluginInstallResult> {
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const installPlan = await this.planInstall(packagePath);
        try {
            const installResult = await this._packageInstaller.install(installPlan);
            this._projectPluginFileStore?.ensureLayout();
            const projectPackageStore = this._projectPackageStore;
            if (projectPackageStore != null) {
                const projectInstallResult = projectPackageStore.commitInstall(installPlan);
                // 目录包提交后必须刷新内存索引，确保当前宿主可立即从真实安装路径恢复模块。
                this._installedPackageStore.restoreSnapshots(projectPackageStore.readInstalledSnapshots());
                return projectInstallResult;
            }
            return installResult;
        } catch (/* 捕获当前操作失败的异常信息，用于生成失败结果或保留诊断上下文。 */ error) {
            await this._rollbackCoordinator.rollback(installPlan);
            throw error;
        }
    }

    /**
     * @description 升级指定路径上的插件包，并在成功后切换活动版本。
     * @param packagePath 插件包路径
     * @returns Promise 返回结构化升级结果
     */
    public async upgrade(packagePath: string): Promise<IPluginInstallResult> {
        // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
        const installPlan = await this.planInstall(packagePath);
        if (installPlan.operation !== 'upgrade') {
            throw new Error(`Cannot upgrade plugin "${installPlan.pluginId}" because no prior active version is installed.`);
        }

        try {
            const installResult = await this._packageInstaller.install(installPlan);
            this._projectPluginFileStore?.ensureLayout();
            const projectPackageStore = this._projectPackageStore;
            if (projectPackageStore != null) {
                const projectInstallResult = projectPackageStore.commitInstall(installPlan);
                // 升级切换后同步真实项目仓快照，避免 runtime 继续引用旧的内存安装路径。
                this._installedPackageStore.restoreSnapshots(projectPackageStore.readInstalledSnapshots());
                return projectInstallResult;
            }
            return installResult;
        } catch (/* 捕获当前操作失败的异常信息，用于生成失败结果或保留诊断上下文。 */ error) {
            await this._rollbackCoordinator.rollback(installPlan);
            throw error;
        }
    }

    /**
     * @description 卸载指定插件。
     * @param pluginId 插件标识
     * @returns Promise 返回结构化卸载结果
     */
    public async uninstall(pluginId: string): Promise<IPluginUninstallResult> {
        const uninstallResult = this._packageInstaller.uninstall(pluginId);
        const projectUninstallResult = await (this._projectPackageStore?.uninstall(pluginId) ?? uninstallResult);
        if (projectUninstallResult.removed) {
            this._projectPluginFileStore?.clearPluginCache(pluginId);
        }
        return projectUninstallResult;
    }

    /**
     * @description 执行一次幂等修复流程。
     * @returns Promise 返回修复结果
     */
    public async repair(): Promise<IPluginRepairResult> {
        const repairResult = await this._packageInstaller.repair();
        if (this._projectPackageStore == null) {
            return repairResult;
        }
        const projectRepairResult = this._projectPackageStore.repair();
        const fileRepairResult = this._projectPluginFileStore?.repair();
        this._installedPackageStore.restoreSnapshots(this._projectPackageStore.readInstalledSnapshots());
        return {
            repaired: projectRepairResult.repaired || fileRepairResult?.repaired === true,
            actions: [...projectRepairResult.actions, ...(fileRepairResult?.actions ?? [])],
        };
    }

    /** @description 在产生安装计划前从项目索引刷新内存快照，避免旧 kernel 按过期状态选择安装或升级路径。 */
    private _refreshProjectInstalledSnapshots(): void {
        if (this._projectPackageStore != null) {
            this._installedPackageStore.restoreSnapshots(this._projectPackageStore.readInstalledSnapshots());
        }
    }

    /**
     * @description 返回项目级插件文件系统；内存模式下返回 `null`。
     * @returns 项目文件系统实例或 `null`
     */
    public getProjectPluginFileStore(): ProjectPluginFileStore | null {
        return this._projectPluginFileStore;
    }

    /**
     * @description 返回指定插件当前活动的安装记录。
     * @param pluginId 插件标识
     * @returns 命中时返回活动安装记录，否则返回 `null`
     */
    public getActiveInstalledPackage(pluginId: string): IInstalledPackageRecord | null {
        return this._installedPackageStore.get(pluginId);
    }

    /**
     * @description 返回指定插件的多版本安装快照。
     * @param pluginId 插件标识
     * @returns 命中时返回安装快照，否则返回 `null`
     */
    public getInstalledPackageSnapshot(pluginId: string): IInstalledPackageSnapshot | null {
        return this._installedPackageStore.getSnapshot(pluginId);
    }

    /**
     * @description 返回当前全部插件的多版本安装快照，用于宿主启动时恢复自动激活插件。
     * @returns 已安装插件快照列表
     */
    public listInstalledPackageSnapshots(): readonly IInstalledPackageSnapshot[] {
        return this._installedPackageStore.listSnapshots();
    }

    /**
     * @description 切换指定插件的活动安装版本并同步项目级索引。
     * @param pluginId 插件稳定标识
     * @param version 已安装的目标版本
     * @returns 切换后的安装快照；目标不存在时返回 `null`
     */
    public switchActiveInstalledPackageVersion(pluginId: string, version: string): IInstalledPackageSnapshot | null {
        const snapshot = this._projectPackageStore?.switchActiveVersion(pluginId, version) ?? this._installedPackageStore.switchActiveVersion(pluginId, version);
        if (snapshot != null && this._projectPackageStore != null) {
            this._installedPackageStore.restoreSnapshots(this._projectPackageStore.readInstalledSnapshots());
        }
        return snapshot;
    }

    /**
     * @description 删除指定插件的非活动安装版本并同步项目级索引。
     * @param pluginId 插件稳定标识
     * @param version 要删除的非活动版本
     * @returns 删除的安装记录；不存在或为活动版本时返回 `null`
     */
    public removeInactiveInstalledPackageVersion(pluginId: string, version: string): IInstalledPackageRecord | null {
        const removedRecord = this._projectPackageStore?.removeInactiveVersion(pluginId, version) ?? (() => {
            const snapshot = this._installedPackageStore.getSnapshot(pluginId);
            if (snapshot?.activeVersion === version) {
                return null;
            }
            return this._installedPackageStore.removeVersion(pluginId, version);
        })();
        if (removedRecord != null && this._projectPackageStore != null) {
            this._installedPackageStore.restoreSnapshots(this._projectPackageStore.readInstalledSnapshots());
        }
        return removedRecord;
    }

    /**
     * @description 返回当前所有已打包插件的快照列表。
     * @returns 已打包插件快照只读列表
     */
    public listPackageSnapshots(): readonly IPackageSnapshot[] {
        return this._packageSnapshotStore.list();
    }

    /**
     * @description 生成一个插件包快照。
     * @param sourcePath 插件源目录路径
     * @param manifest 插件运行时清单
     * @param packageMeta 可选分发元信息；省略时自动生成默认值
     * @returns Promise 返回结构化打包结果
     */
    public async pack(sourcePath: string, manifest: IPluginManifest, packageMeta?: IPluginPackageMeta): Promise<IPluginPackResult> {
        return this._packageBuilder.pack(sourcePath, manifest, packageMeta);
    }

    public hasProjectPackageStore(): boolean {
        return this._projectPackageStore != null;
    }
}
