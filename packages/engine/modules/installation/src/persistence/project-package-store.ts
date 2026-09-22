import { createHash } from 'crypto';
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import type { IPluginInstallPlan, IPluginInstallResult, IPluginManifest, IPluginPackageInspection, IPluginPackageMeta, IPluginRepairResult, IPluginUninstallResult } from '@peanut/pod-protocol';

import { CpmIntegrityProtocol } from '../integrity/cpm-integrity-protocol.js';
import { PanelPackageLayout } from '../panel/panel-package-layout.js';
import type { IInstalledPackageRecord, IInstalledPackageSnapshot } from '../shared/installed-package-store.js';
import type { IPackageSnapshot } from '../shared/package-snapshot-store.js';

/** @description 项目级插件仓的持久化根目录布局。 */
export interface IProjectPluginPackageLayout {
    /** @description Cocos 工程根目录。 */
    readonly projectPath: string;
    /** @description Peanut 插件数据根目录。 */
    readonly rootPath: string;
    /** @description 多版本插件安装目录。 */
    readonly pluginsPath: string;
    /** @description 原子切换前使用的 staging 目录。 */
    readonly stagingPath: string;
    /** @description 当前活动版本索引文件。 */
    readonly installedManifestPath: string;
}

/** @description 磁盘持久化的单个插件版本记录。 */
interface IPersistedPluginVersionRecord {
    /** @description 插件版本号。 */
    readonly version: string;
    /** @description 对项目根目录的安装相对路径。 */
    readonly installPath: string;
}

/** @description 磁盘持久化的单个插件索引记录。 */
interface IPersistedPluginRecord {
    /** @description 插件稳定标识。 */
    readonly pluginId: string;
    /** @description 当前激活的插件版本。 */
    readonly activeVersion: string;
    /** @description 保留的全部插件版本。 */
    readonly versions: readonly IPersistedPluginVersionRecord[];
}

/** @description 磁盘持久化的项目安装索引。 */
interface IPersistedInstalledManifest {
    /** @description 不含机器相关来源路径的安装索引格式版本。 */
    readonly schemaVersion: 2;
    /** @description 所有已安装插件的索引。 */
    readonly plugins: readonly IPersistedPluginRecord[];
}

/**
 * @description 面向 Node/Creator 主进程的项目级插件包仓；负责真实目录包检查、staging、版本索引和磁盘修复。
 */
export class ProjectPackageStore {
    /** @description 单次仓库写事务最长等待时间，避免失联宿主无限阻塞编辑器。 */
    private static readonly MUTATION_LOCK_WAIT_MS = 30_000;
    /** @description 进程异常退出后可回收的仓库写锁最大存活时间。 */
    private static readonly STALE_MUTATION_LOCK_MS = 120_000;
    /** @description 竞争写锁时的短暂退避时间。 */
    private static readonly MUTATION_LOCK_RETRY_MS = 25;
    /** @description 当前实例操作的项目级目录布局。 */
    private readonly _layout: IProjectPluginPackageLayout;

    /**
     * @description 创建项目级插件包仓。
     * @param projectPath Cocos 工程根目录
     */
    public constructor(projectPath: string) {
        // 保存解析后的工程根路径，避免每次操作受进程工作目录影响。
        const resolvedProjectPath = resolve(projectPath);
        this._layout = {
            projectPath: resolvedProjectPath,
            rootPath: join(resolvedProjectPath, 'peanut-plugins'),
            pluginsPath: join(resolvedProjectPath, 'peanut-plugins', 'plugins'),
            stagingPath: join(resolvedProjectPath, 'peanut-plugins', 'staging'),
            installedManifestPath: join(resolvedProjectPath, 'peanut-plugins', 'installed.json'),
        };
    }

    /**
     * @description 返回当前项目的插件目录布局。
     * @returns 不可变的项目级目录布局
     */
    public getLayout(): IProjectPluginPackageLayout {
        return this._layout;
    }

    /**
     * @description 从真实统一目录包读取合并后的 manifest 与发布元信息。
     * @param packagePath 含 `<plugin-id>.manifest.json` 的插件目录
     * @returns 结构化包检查结果
     */
    public inspect(packagePath: string): IPluginPackageInspection {
        // 保存输入路径标准化后的目录位置，确保安装时和检查时使用同一路径。
        const resolvedPackagePath = resolve(packagePath);
        if (!existsSync(resolvedPackagePath) || !statSync(resolvedPackagePath).isDirectory()) {
            return this._invalidInspection(resolvedPackagePath, ['package_not_found']);
        }

        // 保存根目录内符合统一命名规则的清单文件，用于拒绝旧格式和歧义包。
        const manifestFileNames = readdirSync(resolvedPackagePath).filter((fileName) => fileName.endsWith('.manifest.json'));
        if (manifestFileNames.length !== 1) {
            return this._invalidInspection(resolvedPackagePath, [manifestFileNames.length === 0 ? 'plugin_manifest_missing' : 'plugin_manifest_ambiguous']);
        }
        // 保存唯一清单文件的绝对路径，后续从这里读取全部运行时与发布元信息。
        const manifestPath = join(resolvedPackagePath, manifestFileNames[0]);

        try {
            // 保存经过 JSON 解析的插件清单，后续继续校验固定目录与完整性。
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IPluginManifest;
            // 保存统一清单对应的预期文件名，防止插件 ID 与磁盘入口被替换后仍被加载。
            const expectedManifestFileName = `${manifest.id}.manifest.json`;
            if (manifestFileNames[0] !== expectedManifestFileName) {
                return this._invalidInspection(resolvedPackagePath, ['plugin_manifest_filename_mismatch']);
            }
            // 保存合并清单中的发布元信息，缺失时拒绝旧的双 JSON 包格式。
            const packageMeta = this._resolvePackageMeta(manifest);
            if (packageMeta == null) {
                return this._invalidInspection(resolvedPackagePath, ['package_metadata_missing']);
            }
            // 累积目录布局与文件完整性问题，保证安装前不会复制半成品。
            const issues = this._inspectUnifiedLayout(resolvedPackagePath, manifest);
            return {
                packagePath: resolvedPackagePath,
                manifest,
                packageMeta,
                isValidStructure: issues.length === 0,
                issues,
            };
        } catch {
            return this._invalidInspection(resolvedPackagePath, ['package_json_invalid']);
        }
    }

    /**
     * @description 从磁盘读取当前安装索引，供内存 package store 在启动时恢复。
     * @returns 已安装插件快照列表
     */
    public readInstalledSnapshots(): readonly IInstalledPackageSnapshot[] {
        // 保存已解析的持久化索引，缺失时使用空索引。
        const persistedManifest = this._readInstalledManifest();
        return persistedManifest.plugins.map((persistedPluginRecord) => {
            return {
                pluginId: persistedPluginRecord.pluginId,
                activeVersion: persistedPluginRecord.activeVersion,
                versions: persistedPluginRecord.versions.map((persistedVersionRecord) => {
                    // 保存项目内实际安装目录；已安装状态不保留外部来源包路径。
                    const installPath = join(this._layout.projectPath, persistedVersionRecord.installPath);
                    return {
                        pluginId: persistedPluginRecord.pluginId,
                        version: persistedVersionRecord.version,
                        installPath,
                        packagePath: installPath,
                    };
                }),
            };
        });
    }

    /**
     * @description 将已校验的目录包经 staging 原子切换到活动版本。
     * @param installPlan 已通过校验的安装计划
     * @returns 使用真实项目路径的安装结果
     */
    public commitInstall(installPlan: IPluginInstallPlan): IPluginInstallResult {
        return this._withMutationLock((): IPluginInstallResult => {
            // 保存源包检查结果，避免未经结构校验的目录进入项目仓。
            const inspection = this.inspect(installPlan.packagePath);
            if (!inspection.isValidStructure || inspection.manifest == null || inspection.packageMeta == null) {
                throw new Error(`Cannot install invalid package: ${installPlan.packagePath}`);
            }
            // 保存已通过空值检查的插件清单，避免后续实现误用未校验输入。
            const manifest = inspection.manifest;
            if (manifest.id !== installPlan.pluginId || manifest.version !== installPlan.version) {
                throw new Error('Package manifest does not match the approved install plan.');
            }

            // 保存本次插件的 staging 目录，用于同一文件系统内的原子 rename。
            const stagingVersionPath = join(this._layout.stagingPath, installPlan.pluginId, installPlan.version);
            // 保存最终版本目录；每个 id/version 永远对应一个不可变安装单元。
            const installedVersionPath = join(this._layout.pluginsPath, installPlan.pluginId, installPlan.version);
            mkdirSync(join(this._layout.stagingPath, installPlan.pluginId), { recursive: true });
            rmSync(stagingVersionPath, { recursive: true, force: true });
            cpSync(installPlan.packagePath, stagingVersionPath, { recursive: true, force: false });
            mkdirSync(join(this._layout.pluginsPath, installPlan.pluginId), { recursive: true });
            rmSync(installedVersionPath, { recursive: true, force: true });
            renameSync(stagingVersionPath, installedVersionPath);

            // 保存切换前后的磁盘索引，保留旧版本供手动切换与升级回退。
            const persistedManifest = this._readInstalledManifest();
            const nextPlugins = persistedManifest.plugins.filter((persistedPluginRecord) => {
                return persistedPluginRecord.pluginId !== installPlan.pluginId;
            });
            // 保存此前保留的版本记录，安装同版本时用新来源替换对应记录。
            const previousPluginRecord = persistedManifest.plugins.find((persistedPluginRecord) => {
                return persistedPluginRecord.pluginId === installPlan.pluginId;
            });
            // 保存当前版本的项目相对安装路径，保证工程搬迁后索引仍有效。
            const installPath = join('peanut-plugins', 'plugins', installPlan.pluginId, installPlan.version);
            // 保存更新后的版本列表，按原有记录保留非当前版本。
            const versions = [
                ...(previousPluginRecord?.versions.filter((persistedVersionRecord) => {
                    return persistedVersionRecord.version !== installPlan.version;
                }) ?? []),
                {
                    version: installPlan.version,
                    installPath,
                },
            ];
            nextPlugins.push({
                pluginId: installPlan.pluginId,
                activeVersion: installPlan.version,
                versions,
            });
            this._writeInstalledManifest({ schemaVersion: 2, plugins: nextPlugins });

            return {
                operation: installPlan.operation,
                pluginId: installPlan.pluginId,
                version: installPlan.version,
                installed: true,
                installPath: installedVersionPath,
                stagedPath: stagingVersionPath,
                previousVersion: installPlan.previousVersion,
                warnings: installPlan.warnings,
            };
        });
    }

    /**
     * @description 删除指定插件的全部版本和活动索引。
     * @param pluginId 要卸载的插件稳定标识
     * @returns 结构化卸载结果
     */
    public uninstall(pluginId: string): IPluginUninstallResult {
        return this._withMutationLock((): IPluginUninstallResult => {
        // 保存当前插件索引，卸载结果需返回此前活动版本的目录。
        const persistedManifest = this._readInstalledManifest();
        // 保存命中的插件记录，用于判断是否需要实际删除目录。
        const persistedPluginRecord = persistedManifest.plugins.find((candidate) => {
            return candidate.pluginId === pluginId;
        });
        if (persistedPluginRecord == null) {
            return { pluginId, removed: false, installPath: null };
        }

        // 保存当前活动版本记录，供调用方展示已删除的安装位置。
        const activeVersionRecord = persistedPluginRecord.versions.find((candidate) => {
            return candidate.version === persistedPluginRecord.activeVersion;
        });
        rmSync(join(this._layout.pluginsPath, pluginId), { recursive: true, force: true });
        this._writeInstalledManifest({
            schemaVersion: 2,
            plugins: persistedManifest.plugins.filter((candidate) => candidate.pluginId !== pluginId),
        });
        return {
            pluginId,
            removed: true,
            installPath: activeVersionRecord == null ? null : join(this._layout.projectPath, activeVersionRecord.installPath),
        };
        });
    }

    /**
     * @description 切换指定插件的活动版本，不会修改任何已安装版本目录。
     * @param pluginId 插件稳定标识
     * @param version 已安装的目标版本
     * @returns 切换后的安装快照；目标不存在时返回 `null`
     */
    public switchActiveVersion(pluginId: string, version: string): IInstalledPackageSnapshot | null {
        return this._withMutationLock((): IInstalledPackageSnapshot | null => {
        const persistedManifest = this._readInstalledManifest();
        const pluginRecord = persistedManifest.plugins.find((candidate) => candidate.pluginId === pluginId);
        if (pluginRecord == null || !pluginRecord.versions.some((candidate) => candidate.version === version)) {
            return null;
        }

        this._writeInstalledManifest({
            schemaVersion: 2,
            plugins: persistedManifest.plugins.map((candidate) => {
                return candidate.pluginId === pluginId
                    ? {
                          ...candidate,
                          activeVersion: version,
                      }
                    : candidate;
            }),
        });
        return this.readInstalledSnapshots().find((candidate) => candidate.pluginId === pluginId) ?? null;
        });
    }

    /**
     * @description 删除一个非活动的已安装版本及其目录。
     * @param pluginId 插件稳定标识
     * @param version 要删除的版本
     * @returns 删除的安装记录；不存在或为活动版本时返回 `null`
     */
    public removeInactiveVersion(pluginId: string, version: string): IInstalledPackageRecord | null {
        return this._withMutationLock((): IInstalledPackageRecord | null => {
        const persistedManifest = this._readInstalledManifest();
        const pluginRecord = persistedManifest.plugins.find((candidate) => candidate.pluginId === pluginId);
        if (pluginRecord == null || pluginRecord.activeVersion === version) {
            return null;
        }

        const versionRecord = pluginRecord.versions.find((candidate) => candidate.version === version);
        if (versionRecord == null) {
            return null;
        }

        rmSync(join(this._layout.projectPath, versionRecord.installPath), { recursive: true, force: true });
        this._writeInstalledManifest({
            schemaVersion: 2,
            plugins: persistedManifest.plugins.map((candidate) => {
                return candidate.pluginId === pluginId
                    ? {
                          ...candidate,
                          versions: candidate.versions.filter((entry) => entry.version !== version),
                      }
                    : candidate;
            }),
        });
        return {
            pluginId,
            version,
            installPath: join(this._layout.projectPath, versionRecord.installPath),
            packagePath: join(this._layout.projectPath, versionRecord.installPath),
        };
        });
    }

    /**
     * @description 扫描磁盘版本目录并重建或修正 installed 索引。
     * @returns 本次修复动作摘要
     */
    public repair(): IPluginRepairResult {
        return this._withMutationLock((): IPluginRepairResult => {
        // 保存修复动作摘要，供管理面板提示用户索引变化。
        const actions: string[] = [];
        this._clearInterruptedStagingEntries(actions);
        this._clearInterruptedInstalledManifestTemporaryFile(actions);
        if (!existsSync(this._layout.pluginsPath)) {
            return { repaired: false, actions };
        }

        // 保存现有索引，优先保留仍存在的活动版本。
        const persistedManifest = this._readInstalledManifest();
        // 保存按插件标识建立的旧索引，方便扫描时恢复 activeVersion。
        const previousByPluginId = new Map(persistedManifest.plugins.map((record) => [record.pluginId, record]));
        // 累积重建后的插件索引记录。
        const repairedPlugins: IPersistedPluginRecord[] = [];
        for (const pluginDirectoryEntry of readdirSync(this._layout.pluginsPath, { withFileTypes: true })) {
            if (!pluginDirectoryEntry.isDirectory()) {
                continue;
            }
            // 保存插件目录名称，作为磁盘扫描出来的候选插件标识。
            const pluginId = pluginDirectoryEntry.name;
            // 保存插件版本根目录，目录名必须通过 manifest 再次确认。
            const pluginVersionsPath = join(this._layout.pluginsPath, pluginId);
            // 累积有效版本记录，损坏目录不会阻断其他插件修复。
            const versions: IPersistedPluginVersionRecord[] = [];
            for (const versionDirectoryEntry of readdirSync(pluginVersionsPath, { withFileTypes: true })) {
                if (!versionDirectoryEntry.isDirectory()) {
                    continue;
                }
                // 保存版本目录名称，作为对应 manifest 的版本候选。
                const version = versionDirectoryEntry.name;
                // 保存实际包根目录，用固定 manifest 约定过滤损坏安装。
                const installDirectory = join(pluginVersionsPath, version);
                const inspection = this.inspect(installDirectory);
                if (!inspection.isValidStructure || inspection.manifest?.id !== pluginId || inspection.manifest.version !== version) {
                    continue;
                }
                versions.push({
                    version,
                    installPath: join('peanut-plugins', 'plugins', pluginId, version),
                });
            }
            if (versions.length === 0) {
                continue;
            }
            versions.sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
            // 保存此前活动版本；缺失时回退到扫描到的最高版本。
            const previous = previousByPluginId.get(pluginId);
            const activeVersion = versions.some((record) => record.version === previous?.activeVersion)
                ? previous?.activeVersion ?? versions[versions.length - 1].version
                : versions[versions.length - 1].version;
            repairedPlugins.push({ pluginId, activeVersion, versions });
        }

        const previousJson = JSON.stringify(persistedManifest);
        const nextManifest: IPersistedInstalledManifest = { schemaVersion: 2, plugins: repairedPlugins };
        if (JSON.stringify(nextManifest) !== previousJson) {
            this._writeInstalledManifest(nextManifest);
            actions.push('reconciled_installed_manifest');
        }
        return { repaired: actions.length > 0, actions };
        });
    }

    /**
     * @description 以项目级排他锁保护目录复制、索引重建与原子替换，防止多个 Creator 内核发生丢失更新。
     * @param operation 需要在锁内执行的同步仓库写操作
     * @returns 操作返回值
     */
    private _withMutationLock<TResult>(operation: () => TResult): TResult {
        mkdirSync(this._layout.rootPath, { recursive: true });
        const lockPath = join(this._layout.rootPath, '.installed.lock');
        const deadline = Date.now() + ProjectPackageStore.MUTATION_LOCK_WAIT_MS;
        let lockHandle: number | null = null;
        while (lockHandle == null) {
            try {
                lockHandle = openSync(lockPath, 'wx');
            } catch (error) {
                if (!this._isMutationLockAlreadyHeld(error)) {
                    throw error;
                }
                if (this._clearStaleMutationLock(lockPath)) {
                    continue;
                }
                if (Date.now() >= deadline) {
                    throw new Error('project_package_store_mutation_lock_timeout');
                }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ProjectPackageStore.MUTATION_LOCK_RETRY_MS);
            }
        }

        try {
            writeFileSync(lockHandle, `${Date.now()}\n`, 'utf8');
            return operation();
        } finally {
            closeSync(lockHandle);
            try {
                if (lstatSync(lockPath).isFile()) {
                    unlinkSync(lockPath);
                }
            } catch {
                // 锁文件已被宿主清理时无需阻断已完成的事务。
            }
        }
    }

    /** @description 判断打开排他锁失败是否由已有锁造成。 */
    private _isMutationLockAlreadyHeld(error: unknown): boolean {
        return typeof error === 'object' && error != null && 'code' in error && error.code === 'EEXIST';
    }

    /** @description 仅回收超时且为普通文件的遗留锁，拒绝跟随符号链接。 */
    private _clearStaleMutationLock(lockPath: string): boolean {
        try {
            const lockStats = lstatSync(lockPath);
            if (!lockStats.isFile() || Date.now() - lockStats.mtimeMs < ProjectPackageStore.STALE_MUTATION_LOCK_MS) {
                return false;
            }
            unlinkSync(lockPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @description 清理宿主中断后遗留在 staging 插件目录中的未提交版本。
     */
    private _clearInterruptedStagingEntries(actions: string[]): void {
        if (!existsSync(this._layout.stagingPath)) {
            return;
        }
        if (!lstatSync(this._layout.stagingPath).isDirectory()) {
            throw new Error('project_package_staging_path_not_directory');
        }
        for (const pluginDirectoryEntry of readdirSync(this._layout.stagingPath, { withFileTypes: true })) {
            const pluginStagingPath = join(this._layout.stagingPath, pluginDirectoryEntry.name);
            if (!pluginDirectoryEntry.isDirectory()) {
                rmSync(pluginStagingPath, { recursive: true, force: true });
                actions.push(`removed_invalid_staging_entry:${pluginDirectoryEntry.name}`);
                continue;
            }
            for (const versionDirectoryEntry of readdirSync(pluginStagingPath, { withFileTypes: true })) {
                const versionStagingPath = join(pluginStagingPath, versionDirectoryEntry.name);
                rmSync(versionStagingPath, { recursive: true, force: true });
                actions.push(`removed_interrupted_staging_version:${pluginDirectoryEntry.name}/${versionDirectoryEntry.name}`);
            }
        }
    }

    /**
     * @description 清理安装索引原子替换在 rename 前中断时留下的临时文件。
     */
    private _clearInterruptedInstalledManifestTemporaryFile(actions: string[]): void {
        const temporaryManifestPath = `${this._layout.installedManifestPath}.tmp`;
        if (!existsSync(temporaryManifestPath)) {
            return;
        }
        rmSync(temporaryManifestPath, { recursive: true, force: true });
        actions.push('removed_interrupted_installed_manifest_temp');
    }

    /** @description 构造一个表示无效目录包的统一检查结果。 */
    private _invalidInspection(packagePath: string, issues: readonly string[]): IPluginPackageInspection {
        return { packagePath, manifest: null, packageMeta: null, isValidStructure: false, issues };
    }

    /** @description 从合并清单提取兼容安装流程所需的发布元信息。 */
    private _resolvePackageMeta(manifest: IPluginManifest): IPluginPackageMeta | null {
        // 保存清单中统一发布字段，目录包不再读取独立 package meta 文件。
        const packageManifest = manifest.package;
        if (packageManifest == null || packageManifest.schemaVersion !== 1) {
            return null;
        }
        return {
            digest: packageManifest.digest,
            signature: packageManifest.signature,
            packedAt: packageManifest.packedAt,
            sdkVersion: packageManifest.sdkVersion,
        };
    }

    /** @description 校验统一目录包的固定入口、单面板约束与发布文件摘要。 */
    private _inspectUnifiedLayout(packagePath: string, manifest: IPluginManifest): readonly string[] {
        // 累积当前目录包的结构问题，供安装器和管理面板直接展示。
        const issues: string[] = [];
        // 保存插件固定运行时入口，所有插件都必须使用该路径避免任意入口加载。
        const bundlePath = `./${manifest.id}.bundle.js`;
        // 保存必须存在的包内文件路径；面板文件由下方按贡献逐一验证。
        const requiredPaths = [
            'libs',
            `${manifest.id}.bundle.js`,
        ];
        for (const relativePath of requiredPaths) {
            if (!existsSync(join(packagePath, relativePath))) {
                issues.push(`package_required_path_missing:${relativePath}`);
            }
        }
        if (manifest.main !== bundlePath) {
            issues.push('plugin_main_not_unified_bundle');
        }
        if (manifest.icon != null) {
            if (manifest.icon !== './assets/icon.png') {
                issues.push('plugin_icon_path_invalid');
            } else {
                const iconPath = join(packagePath, 'assets', 'icon.png');
                if (!existsSync(iconPath)) {
                    issues.push('plugin_icon_missing');
                } else {
                    const iconStat = lstatSync(iconPath);
                    if (!iconStat.isFile() || iconStat.isSymbolicLink()) {
                        issues.push('plugin_icon_invalid');
                    }
                }
            }
        }
        // 保存声明的面板列表；单面板目录包使用根 panels 目录，避免重复一层面板标识。
        const panels = manifest.contributions?.panels ?? [];
        if (manifest.kind === 'panel-plugin' && panels.length !== 1) {
            issues.push('plugin_panel_not_unified_singleton');
        }
        for (const panel of panels) {
            // 保存当前面板的共享运行时库与两类模板路径，避免发布包重新引入旧式面板入口。
            const panelLayout = PanelPackageLayout.create(panel.id);
            const panelRequiredPaths = [
                panelLayout.embeddedEntryPath,
                panelLayout.embeddedScriptPath,
                panelLayout.embeddedStylePath,
                panelLayout.standaloneEntryPath,
                panelLayout.standaloneScriptPath,
                panelLayout.standaloneStylePath,
            ];
            if (!PanelPackageLayout.isEmbeddedEntry(panel.id, panel.entry)) {
                issues.push(`plugin_panel_entry_not_embedded:${panel.id}`);
            }
            for (const relativePath of panelRequiredPaths) {
                if (!existsSync(join(packagePath, relativePath))) {
                    issues.push(`package_required_path_missing:${relativePath}`);
                }
            }
            const panelDirectoryPaths = [panelLayout.panelLibraryDirectory, panelLayout.standaloneDirectory];
            for (const relativePath of panelDirectoryPaths) {
                const directoryPath = join(packagePath, relativePath);
                if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
                    issues.push(`package_required_directory_missing:${relativePath}`);
                }
            }
        }
        // 保存合并后的发布字段，前置检查已保证其存在与 schemaVersion 正确。
        const packageManifest = manifest.package;
        if (packageManifest == null) {
            return issues;
        }
        // 保存按路径排序的文件摘要记录，用于稳定计算总摘要并逐项验证磁盘内容。
        const fileRecords = [...packageManifest.files].sort((left, right) => CpmIntegrityProtocol.comparePaths(left.path, right.path));
        if (fileRecords.length === 0) {
            issues.push('package_file_integrity_missing');
        }
        for (const fileRecord of fileRecords) {
            if (fileRecord.path.startsWith('/') || fileRecord.path.includes('..')) {
                issues.push(`package_file_integrity_path_invalid:${fileRecord.path}`);
                continue;
            }
            // 保存被记录文件的磁盘位置，避免 hash 计算越出插件根目录。
            const filePath = join(packagePath, fileRecord.path);
            if (!existsSync(filePath) || !statSync(filePath).isFile()) {
                issues.push(`package_file_integrity_missing:${fileRecord.path}`);
                continue;
            }
            // 保存当前实际文件摘要，确保包在安装前未被静默篡改。
            const actualDigest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
            if (actualDigest !== fileRecord.digest) {
                issues.push(`package_file_integrity_mismatch:${fileRecord.path}`);
            }
        }
        // 规范顺序为码元序；兼容旧版 localeCompare 打包的清单，manifest 本身不计入以避免循环依赖。
        if (!this._matchesPackageDigest(fileRecords, packageManifest.digest)) {
            issues.push('package_digest_mismatch');
        }
        return issues;
    }

    /** @description 非法或重复记录已由逐项检查报告，此处视为摘要不匹配而非抛出。 */
    private _matchesPackageDigest(fileRecords: readonly { path: string; digest: string }[], expected: string): boolean {
        try {
            return CpmIntegrityProtocol.matchesDigest(fileRecords, expected);
        } catch {
            return false;
        }
    }

    /** @description 读取 installed.json；缺失或损坏时返回安全的空索引。 */
    private _readInstalledManifest(): IPersistedInstalledManifest {
        if (!existsSync(this._layout.installedManifestPath)) {
            return { schemaVersion: 2, plugins: [] };
        }
        try {
            // 保存已解析的 JSON 索引；只接受不含外部来源路径的当前格式。
            const candidate = JSON.parse(readFileSync(this._layout.installedManifestPath, 'utf8')) as unknown;
            if (!this._isInstalledManifest(candidate)) {
                return { schemaVersion: 2, plugins: [] };
            }
            return candidate;
        } catch {
            return { schemaVersion: 2, plugins: [] };
        }
    }

    /**
     * @description 校验已安装索引仅引用项目内确定位置，拒绝旧格式和路径穿越。
     * @param value 待校验的 JSON 值
     * @returns 是否为当前已安装索引格式
     */
    private _isInstalledManifest(value: unknown): value is IPersistedInstalledManifest {
        if (!this._isRecord(value) || value.schemaVersion !== 2 || !Array.isArray(value.plugins)) {
            return false;
        }
        return value.plugins.every((pluginRecord) => {
            if (
                !this._isRecord(pluginRecord) ||
                typeof pluginRecord.pluginId !== 'string' ||
                !this._isPluginId(pluginRecord.pluginId) ||
                typeof pluginRecord.activeVersion !== 'string' ||
                !this._isPluginVersion(pluginRecord.activeVersion) ||
                !Array.isArray(pluginRecord.versions)
            ) {
                return false;
            }
            const pluginId = pluginRecord.pluginId;
            const activeVersion = pluginRecord.activeVersion;
            const hasActiveVersion = pluginRecord.versions.some((versionRecord) => {
                return this._isRecord(versionRecord) && versionRecord.version === activeVersion;
            });
            return hasActiveVersion && pluginRecord.versions.every((versionRecord) => {
                if (
                    !this._isRecord(versionRecord) ||
                    Object.prototype.hasOwnProperty.call(versionRecord, 'packagePath') ||
                    typeof versionRecord.version !== 'string' ||
                    !this._isPluginVersion(versionRecord.version) ||
                    typeof versionRecord.installPath !== 'string'
                ) {
                    return false;
                }
                return versionRecord.installPath === join('peanut-plugins', 'plugins', pluginId, versionRecord.version);
            });
        });
    }

    /**
     * @description 判断候选值是否为普通 JSON 对象。
     * @param value 待判断的值
     * @returns 是否为普通 JSON 对象
     */
    private _isRecord(value: unknown): value is Record<string, unknown> {
        return value != null && typeof value === 'object' && !Array.isArray(value);
    }

    /**
     * @description 校验插件稳定标识，避免其进入项目相对目录时发生路径逃逸。
     * @param pluginId 候选插件标识
     * @returns 是否为允许的插件稳定标识
     */
    private _isPluginId(pluginId: string): boolean {
        return /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(pluginId);
    }

    /**
     * @description 校验插件版本，避免不可信值进入项目相对目录。
     * @param version 候选插件版本
     * @returns 是否为允许的插件版本
     */
    private _isPluginVersion(version: string): boolean {
        return /^\d+\.\d+\.\d+$/.test(version);
    }

    /** @description 原子写入项目安装索引，避免编辑器中断留下半截 JSON。 */
    private _writeInstalledManifest(manifest: IPersistedInstalledManifest): void {
        mkdirSync(this._layout.rootPath, { recursive: true });
        // 保存同目录临时文件路径，rename 可保证同一文件系统上的原子替换。
        const temporaryPath = `${this._layout.installedManifestPath}.tmp`;
        writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
        renameSync(temporaryPath, this._layout.installedManifestPath);
    }
}
