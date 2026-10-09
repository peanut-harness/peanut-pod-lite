import assert from 'assert/strict';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';

import type { IPluginManifest, IPluginPackageFileIntegrity, IPluginPackageManifest } from '@peanut/pod-protocol';
import { PackagingApp, PanelPackageLayout } from '@peanut/pod-engine/installation';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';

import { createBuiltinPluginManagerPanelRegistration } from '../src/builtin/builtin-plugin-manager-panel-registration';
import { PluginManagerKernelContainer } from '../src/kernel/plugin-manager-kernel-container';
import { NodePluginPackageModuleResolver } from '../src/loader/node-plugin-package-module-resolver';
import type { IPluginManagerPanelBrowserWindow } from '../src/panels/plugin-manager-panel-ui';

interface IReloadableDirectoryPackageOptions {
    /** @description 是否在插件激活阶段注入可恢复的失败。 */
    readonly failActivate?: boolean;
    /** @description 是否在插件激活阶段打开可恢复的面板。 */
    readonly openPanelOnActivate?: boolean;
    /** @description 插件稳定标识。 */
    readonly pluginId?: string;
    /** @description 插件语义版本。 */
    readonly version?: string;
}

/**
 * @description 写入包含真实 ESM 生命周期模块的最小目录包，用于验证项目级安装和 kernel 重载恢复。
 * @param projectPath 临时 Cocos 工程根目录
 * @param options 目录包的插件标识、版本与激活失败注入配置
 * @returns 目录包根路径与对应插件标识
 */
async function writeReloadableDirectoryPackage(
    projectPath: string,
    options: IReloadableDirectoryPackageOptions = {},
): Promise<{ packagePath: string; pluginId: string }> {
    const pluginId = options.pluginId ?? 'kernel.directory-package.plugin';
    const version = options.version ?? '0.1.0';
    const failActivate = options.failActivate ?? false;
    const openPanelOnActivate = options.openPanelOnActivate ?? false;
    const panelId = `${pluginId}.panel`;
    const panelLayout = PanelPackageLayout.create(panelId);
    const packagePath = join(projectPath, 'incoming', `${pluginId}-${version}`);
    const modulePath = `${pluginId}.bundle.js`;
    const moduleSource = `module.exports.createPluginModule = function createPluginModule() {
    return {
        manifest: {
            id: ${JSON.stringify(pluginId)},
            version: ${JSON.stringify(version)},
            kind: 'panel-plugin',
            displayName: 'Kernel Reload Directory Package',
            main: ${JSON.stringify(`./${pluginId}.bundle.js`)},
            engines: { host: '^0.1.0' },
            activation: { autoActivate: true, events: [] },
            permissions: { panel: { open: true, embed: true } },
            contributions: {
                panels: [{
                    id: ${JSON.stringify(panelId)},
                    title: 'Kernel Reload Panel',
                    entry: ${JSON.stringify(panelLayout.embeddedEntryPath)},
                    placement: 'utility',
                    singleton: true,
                    activationPolicy: 'manual',
                    sessionPolicy: 'restore_layout',
                    permissions: { allowSelectionRead: false },
                }],
            },
        },
        async register(context) {
            context.registry.registerPanel({
                id: ${JSON.stringify(panelId)},
                title: 'Kernel Reload Panel',
                entry: ${JSON.stringify(panelLayout.embeddedEntryPath)},
                placement: 'utility',
                singleton: true,
                activationPolicy: 'manual',
                sessionPolicy: 'restore_layout',
                permissions: { allowSelectionRead: false },
            });
        },
        async activate(context) {
            const activationCount = (await context.storage.get('activationCount')) ?? 0;
            await context.storage.set('activationCount', activationCount + 1);
            await context.storage.set('lastActivatedVersion', ${JSON.stringify(version)});
            if (${JSON.stringify(openPanelOnActivate)}) {
                await context.panels.open(${JSON.stringify(panelId)});
            }
            if (${JSON.stringify(failActivate)}) {
                throw new Error(${JSON.stringify(`directory_plugin_activate_failed:${pluginId}:${version}`)});
            }
        },
        async deactivate() {},
        async dispose() {},
    };
}
`;
    const packageFiles: readonly { readonly path: string; readonly content: string }[] = [
        { path: modulePath, content: moduleSource },
        { path: panelLayout.embeddedEntryPath, content: '<!doctype html><html><body>Kernel reload panel</body></html>' },
        { path: panelLayout.embeddedScriptPath, content: 'export {};\n' },
        { path: panelLayout.embeddedStylePath, content: '' },
        { path: panelLayout.standaloneEntryPath, content: '<!doctype html><html><body>Kernel reload panel</body></html>' },
        { path: panelLayout.standaloneScriptPath, content: 'export {};\n' },
        { path: panelLayout.standaloneStylePath, content: '' },
        { path: `${panelLayout.panelLibraryDirectory}/.keep`, content: '' },
    ];
    const integrityFiles: IPluginPackageFileIntegrity[] = packageFiles
        .map((packageFile) => {
            return {
                path: packageFile.path,
                digest: createHash('sha256').update(packageFile.content).digest('hex'),
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
    const packageManifest: IPluginPackageManifest = {
        schemaVersion: 1,
        digest: createHash('sha256')
            .update(integrityFiles.map((integrityFile) => `${integrityFile.path}:${integrityFile.digest}`).join('\n'))
            .digest('hex'),
        packedAt: '2026-08-03T00:00:00.000Z',
        sdkVersion: '0.1.0',
        files: integrityFiles,
        libraries: [],
        changelog: [{ version, publishedAt: '2026-08-03T00:00:00.000Z', changes: ['Kernel reload fixture.'] }],
    };
    const manifest: IPluginManifest = {
        id: pluginId,
        version,
        kind: 'panel-plugin',
        displayName: 'Kernel Reload Directory Package',
        main: `./${pluginId}.bundle.js`,
        engines: { host: '^0.1.0' },
        activation: { autoActivate: true, events: [] },
        permissions: {
            panel: {
                open: true,
                embed: true,
            },
        },
        contributions: {
            panels: [
                {
                    id: panelId,
                    title: 'Kernel Reload Panel',
                    entry: panelLayout.embeddedEntryPath,
                    placement: 'utility',
                    singleton: true,
                    activationPolicy: 'manual',
                    sessionPolicy: 'restore_layout',
                    permissions: { allowSelectionRead: false },
                },
            ],
        },
        package: packageManifest,
    };

    await Promise.all([
        mkdir(join(packagePath, panelLayout.panelLibraryDirectory), { recursive: true }),
        mkdir(join(packagePath, panelLayout.embeddedDirectory), { recursive: true }),
        mkdir(join(packagePath, panelLayout.standaloneDirectory), { recursive: true }),
    ]);
    await Promise.all(
        packageFiles.map(async (packageFile): Promise<void> => {
            await writeFile(join(packagePath, packageFile.path), packageFile.content, 'utf8');
        }),
    );
    await writeFile(join(packagePath, `${pluginId}.manifest.json`), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
    return { packagePath, pluginId };
}

test('plugin-manager kernel container should reload the plugin-manager core while preserving panel preferences and browser binding', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ runtimeFacade = new RuntimeFacade('3.8.7', {
        allowMemoryPanelWindowProviderFallback: true,
    });
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
        bootstrap: async (pluginManagerApp): Promise<void> => {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ builtinPluginManagerPanelRegistration = createBuiltinPluginManagerPanelRegistration();
            await builtinPluginManagerPanelRegistration.register(pluginManagerApp, async (): Promise<void> => {});
        },
    });

    // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
    const /* 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。 */ initialPluginManagerApp = await pluginManagerKernelContainer.start();
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ browserWindow: IPluginManagerPanelBrowserWindow = {};
    await pluginManagerKernelContainer.registerPanelBinding({
        pluginId: 'builtin.plugin-manager.panel',
        panelId: 'builtin.plugin-manager.panel',
        browserWindow,
    });

    await browserWindow.pluginManagerPanelUiActions?.updatePreferences({
        locale: 'en-US',
    });

    // 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。
    const /* 保存异步操作的解析结果，供当前流程后续校验、转换或编排使用。 */ reloadedPluginManagerApp = await pluginManagerKernelContainer.reload();

    assert.notEqual(reloadedPluginManagerApp, initialPluginManagerApp);
    assert.equal(browserWindow.pluginManagerPanelUi?.state.preferences.locale, 'en-US');
    assert.equal(browserWindow.pluginManagerPanelUi?.state.pluginId, 'builtin.plugin-manager.panel');
    assert.equal(browserWindow.documentTitle?.includes('Plugin Manager'), true);

    await pluginManagerKernelContainer.stop('host_shutdown');
});

test('plugin-manager kernel container should restore an active installed directory package and storage after host reload', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-directory-package-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const packagingApp = new PackagingApp({ projectPath });
        const directoryPackage = await writeReloadableDirectoryPackage(projectPath);
        const installResult = await packagingApp.install(directoryPackage.packagePath);
        const installedPackageInspection = await packagingApp.inspect(installResult.installPath);
        assert.notEqual(installedPackageInspection.manifest, null);
        const pluginPackageModuleResolver = new NodePluginPackageModuleResolver();
        const installedPluginModule = await pluginPackageModuleResolver.resolve(
            installResult.installPath,
            installedPackageInspection.manifest!,
        );
        const runtimeFacade = new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        });
        pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
            packaging: packagingApp,
            pluginPackageModuleResolver,
        });

        const initialPluginManagerApp = await pluginManagerKernelContainer.start();
        const initialRuntimeRecord = initialPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === directoryPackage.pluginId;
        });
        const reloadedPluginManagerApp = await pluginManagerKernelContainer.reload();
        const reloadedRuntimeRecord = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === directoryPackage.pluginId;
        });
        const reloadedStorageSnapshot = reloadedPluginManagerApp.exportStorageSnapshots().get(directoryPackage.pluginId);

        assert.equal(installResult.installPath.includes(join('peanut-plugins', 'plugins', 'kernel.directory-package.plugin', '0.1.0')), true);
        assert.equal(installedPluginModule.manifest.id, directoryPackage.pluginId);
        assert.equal(initialRuntimeRecord?.state, 'active');
        assert.equal(initialPluginManagerApp.exportStorageSnapshots().get(directoryPackage.pluginId)?.get('activationCount'), 1);
        assert.notEqual(reloadedPluginManagerApp, initialPluginManagerApp);
        assert.equal(reloadedRuntimeRecord?.state, 'active');
        assert.equal(reloadedPluginManagerApp.getActiveInstalledPackage(directoryPackage.pluginId)?.installPath, installResult.installPath);
        assert.equal(reloadedStorageSnapshot?.get('activationCount'), 2);
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});

test('plugin-manager kernel container should preserve rolled-back storage and panel sessions after host reload', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-upgrade-restart-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const pluginId = 'kernel.upgrade-restart.plugin';
        const packagingApp = new PackagingApp({ projectPath });
        const pluginPackageModuleResolver = new NodePluginPackageModuleResolver();
        const packageV1 = await writeReloadableDirectoryPackage(projectPath, {
            openPanelOnActivate: true,
            pluginId,
            version: '0.1.0',
        });
        await packagingApp.install(packageV1.packagePath);

        const runtimeFacade = new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        });
        pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
            packaging: packagingApp,
            pluginPackageModuleResolver,
        });
        const initialPluginManagerApp = await pluginManagerKernelContainer.start();
        const panelId = `${pluginId}.panel`;
        const initialPanelSession = await runtimeFacade.panelHost.getSession(panelId);
        assert.equal(initialPanelSession?.isOpen, true);

        const packageV2 = await writeReloadableDirectoryPackage(projectPath, {
            failActivate: true,
            openPanelOnActivate: true,
            pluginId,
            version: '0.2.0',
        });
        await assert.rejects(async (): Promise<void> => {
            await initialPluginManagerApp.upgradeAndActivatePackage(packageV2.packagePath);
        }, /directory_plugin_activate_failed:kernel\.upgrade-restart\.plugin:0\.2\.0/);

        const upgradeDiagnostics = initialPluginManagerApp.getUpgradeDiagnostics(pluginId);
        assert.equal(upgradeDiagnostics?.outcome, 'rolled_back');
        assert.equal(upgradeDiagnostics?.rollbackApplied, true);
        assert.equal(upgradeDiagnostics?.currentRuntimeVersion, '0.1.0');
        assert.equal(upgradeDiagnostics?.activeInstalledVersion, '0.1.0');
        assert.equal(upgradeDiagnostics?.previousPanelSessionCount, 1);
        assert.equal(upgradeDiagnostics?.restoredPanelSessionCount, 1);
        assert.equal(upgradeDiagnostics?.storageRestored, true);

        const reloadedPluginManagerApp = await pluginManagerKernelContainer.reload();
        const reloadedRuntimeRecord = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === pluginId;
        });
        const reloadedPanelSession = await runtimeFacade.panelHost.getSession(panelId);
        const reloadedStorageSnapshot = reloadedPluginManagerApp.exportStorageSnapshots().get(pluginId);

        assert.notEqual(reloadedPluginManagerApp, initialPluginManagerApp);
        assert.equal(reloadedRuntimeRecord?.state, 'active');
        assert.equal(reloadedRuntimeRecord?.version, '0.1.0');
        assert.equal(reloadedPluginManagerApp.getActiveInstalledPackage(pluginId)?.version, '0.1.0');
        assert.equal(reloadedPanelSession?.isOpen, true);
        assert.equal(reloadedStorageSnapshot?.get('lastActivatedVersion'), '0.1.0');
        assert.equal(reloadedStorageSnapshot?.get('activationCount'), 3);
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});

test('plugin-manager kernel container should reconcile every auto-activated package added by another kernel during reload', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-full-reconcile-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const firstPluginId = 'kernel.full-reconcile.first';
        const secondPluginId = 'kernel.full-reconcile.second';
        const activeKernelPackagingApp = new PackagingApp({ projectPath });
        const firstDirectoryPackage = await writeReloadableDirectoryPackage(projectPath, { pluginId: firstPluginId });
        await activeKernelPackagingApp.install(firstDirectoryPackage.packagePath);

        const runtimeFacade = new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        });
        pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
            packaging: activeKernelPackagingApp,
            pluginPackageModuleResolver: new NodePluginPackageModuleResolver(),
        });
        const initialPluginManagerApp = await pluginManagerKernelContainer.start();
        assert.equal(initialPluginManagerApp.listRuntimeRecords().find((record) => record.pluginId === firstPluginId)?.state, 'active');
        assert.equal(initialPluginManagerApp.listRuntimeRecords().some((record) => record.pluginId === secondPluginId), false);

        // 模拟旧 kernel 仍在运行时，另一个安装请求已将第二个包安全提交到同一项目仓。
        const otherKernelPackagingApp = new PackagingApp({ projectPath });
        const secondDirectoryPackage = await writeReloadableDirectoryPackage(projectPath, { pluginId: secondPluginId });
        await otherKernelPackagingApp.install(secondDirectoryPackage.packagePath);

        const reloadedPluginManagerApp = await pluginManagerKernelContainer.reload();
        assert.equal(reloadedPluginManagerApp.listRuntimeRecords().find((record) => record.pluginId === firstPluginId)?.state, 'active');
        assert.equal(reloadedPluginManagerApp.listRuntimeRecords().find((record) => record.pluginId === secondPluginId)?.state, 'active');
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});

test('plugin-manager kernel container should repair interrupted package state before restoring the last committed plugin version', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-interrupted-package-recovery-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const initialPackagingApp = new PackagingApp({ projectPath });
        const directoryPackage = await writeReloadableDirectoryPackage(projectPath);
        await initialPackagingApp.install(directoryPackage.packagePath);
        const interruptedStagingPath = join(projectPath, 'peanut-plugins', 'staging', directoryPackage.pluginId, '0.2.0');
        const temporaryManifestPath = join(projectPath, 'peanut-plugins', 'installed.json.tmp');
        await mkdir(interruptedStagingPath, { recursive: true });
        await writeFile(join(interruptedStagingPath, 'partial.bundle.js'), 'interrupted package copy\n', 'utf8');
        await writeFile(temporaryManifestPath, '{"interrupted":true}\n', 'utf8');

        // 使用新的 packaging 和 kernel 实例模拟宿主进程中断后的完整重启。
        const recoveredPackagingApp = new PackagingApp({ projectPath });
        const runtimeFacade = new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        });
        pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
            packaging: recoveredPackagingApp,
            pluginPackageModuleResolver: new NodePluginPackageModuleResolver(),
        });

        const recoveredPluginManagerApp = await pluginManagerKernelContainer.start();
        const startupRepairResult = pluginManagerKernelContainer.getLastStartupRepairResult();
        const recoveredRuntimeRecord = recoveredPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === directoryPackage.pluginId;
        });

        assert.equal(existsSync(interruptedStagingPath), false);
        assert.equal(existsSync(temporaryManifestPath), false);
        assert.equal(startupRepairResult?.repaired, true);
        assert.equal(startupRepairResult?.actions.includes(`removed_interrupted_staging_version:${directoryPackage.pluginId}/0.2.0`), true);
        assert.equal(startupRepairResult?.actions.includes('removed_interrupted_installed_manifest_temp'), true);
        assert.equal(recoveredPackagingApp.getActiveInstalledPackage(directoryPackage.pluginId)?.version, '0.1.0');
        assert.equal(recoveredRuntimeRecord?.state, 'active');
        assert.equal(recoveredRuntimeRecord?.version, '0.1.0');
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});

test('plugin-manager kernel container can leave external CPM index repair to its owning host', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-external-index-owner-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const interruptedStagingPath = join(projectPath, 'peanut-plugins', 'staging', 'external.owner.plugin', '0.1.0');
        const temporaryManifestPath = join(projectPath, 'peanut-plugins', 'installed.json.tmp');
        await mkdir(interruptedStagingPath, { recursive: true });
        await writeFile(join(interruptedStagingPath, 'partial.bundle.js'), 'keep for the external owner\n', 'utf8');
        await writeFile(temporaryManifestPath, '{"externalOwner":true}\n', 'utf8');
        pluginManagerKernelContainer = new PluginManagerKernelContainer(new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        }), {
            packaging: new PackagingApp({ projectPath }),
            activateInstalledPackages: false,
            repairInstalledPackagesOnStartup: false,
        });

        await pluginManagerKernelContainer.start();

        assert.equal(existsSync(interruptedStagingPath), true);
        assert.equal(existsSync(temporaryManifestPath), true);
        assert.deepEqual(pluginManagerKernelContainer.getLastStartupRepairResult(), {
            repaired: false,
            actions: ['startup_repair_skipped_external_index_owner'],
        });
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});

test('plugin-manager kernel container should isolate a failed directory package during reload and recover it after a package fix', async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), 'peanut-kernel-package-isolation-'));
    let pluginManagerKernelContainer: PluginManagerKernelContainer | null = null;
    try {
        const healthyPluginId = 'kernel.package-isolation.healthy';
        const recoverablePluginId = 'kernel.package-isolation.recoverable';
        const packagingApp = new PackagingApp({ projectPath });
        const pluginPackageModuleResolver = new NodePluginPackageModuleResolver();
        const healthyPackageV1 = await writeReloadableDirectoryPackage(projectPath, { pluginId: healthyPluginId });
        const recoverablePackageV1 = await writeReloadableDirectoryPackage(projectPath, { pluginId: recoverablePluginId });
        await packagingApp.install(healthyPackageV1.packagePath);
        await packagingApp.install(recoverablePackageV1.packagePath);

        const runtimeFacade = new RuntimeFacade('3.8.7', {
            allowMemoryPanelWindowProviderFallback: true,
        });
        pluginManagerKernelContainer = new PluginManagerKernelContainer(runtimeFacade, {
            packaging: packagingApp,
            pluginPackageModuleResolver,
        });
        const initialPluginManagerApp = await pluginManagerKernelContainer.start();
        const recoverablePackageV2 = await writeReloadableDirectoryPackage(projectPath, {
            failActivate: true,
            pluginId: recoverablePluginId,
            version: '0.2.0',
        });
        await packagingApp.upgrade(recoverablePackageV2.packagePath);

        const reloadedPluginManagerApp = await pluginManagerKernelContainer.reload();
        const healthyRuntimeRecordAfterFailure = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === healthyPluginId;
        });
        const recoverableRuntimeRecordAfterFailure = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === recoverablePluginId;
        });
        const recoverableFailureIncident = reloadedPluginManagerApp.getFailureIncident(recoverablePluginId);

        const recoverablePackageV3 = await writeReloadableDirectoryPackage(projectPath, {
            pluginId: recoverablePluginId,
            version: '0.3.0',
        });
        await packagingApp.upgrade(recoverablePackageV3.packagePath);
        await reloadedPluginManagerApp.restoreInstalledPackages([recoverablePluginId]);

        const healthyRuntimeRecordAfterRecovery = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === healthyPluginId;
        });
        const recoverableRuntimeRecordAfterRecovery = reloadedPluginManagerApp.listRuntimeRecords().find((pluginRuntimeRecord) => {
            return pluginRuntimeRecord.pluginId === recoverablePluginId;
        });
        const healthyStorageSnapshot = reloadedPluginManagerApp.exportStorageSnapshots().get(healthyPluginId);
        const recoverableStorageSnapshot = reloadedPluginManagerApp.exportStorageSnapshots().get(recoverablePluginId);

        assert.equal(healthyRuntimeRecordAfterFailure?.state, 'active');
        assert.equal(recoverableRuntimeRecordAfterFailure?.state, 'failed');
        assert.equal(recoverableFailureIncident?.phase, 'activate');
        assert.equal(recoverableFailureIncident?.errorMessage, 'directory_plugin_activate_failed:kernel.package-isolation.recoverable:0.2.0');
        assert.equal(healthyRuntimeRecordAfterRecovery?.state, 'active');
        assert.equal(recoverableRuntimeRecordAfterRecovery?.state, 'active');
        assert.equal(recoverableRuntimeRecordAfterRecovery?.version, '0.3.0');
        assert.equal(reloadedPluginManagerApp.getFailureIncident(recoverablePluginId), null);
        assert.equal(healthyStorageSnapshot?.get('activationCount'), 2);
        assert.equal(recoverableStorageSnapshot?.get('activationCount'), 3);
    } finally {
        await pluginManagerKernelContainer?.dispose();
        await rm(projectPath, { recursive: true, force: true });
    }
});
