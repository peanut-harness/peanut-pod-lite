import assert from 'assert/strict';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import test from 'node:test';

import type { IPluginManifest, IPluginPackageFileIntegrity, IPluginPackageManifest } from '@peanut/pod-protocol';

import { PackagingApp } from '../src/app/packaging-app';
import { PanelPackageLayout } from '../src/panel/panel-package-layout';
import { ProjectPluginFileStore } from '../src/persistence/project-plugin-file-store';

/** @description 构造可被目录包仓检查的最小插件清单。 */
function createManifest(version: string, packageManifest: IPluginPackageManifest): IPluginManifest {
    // 保存测试面板的统一目录包布局，确保 manifest 与真实文件使用同一路径约定。
    const panelLayout = PanelPackageLayout.create('project-package-store.test-plugin.panel');
    return {
        id: 'project-package-store.test-plugin',
        version,
        kind: 'runtime-plugin',
        displayName: 'Project Package Store Test Plugin',
        main: './project-package-store.test-plugin.bundle.js',
        engines: { host: '^0.1.0' },
        activation: { autoActivate: true, events: [] },
        permissions: {},
        contributions: {
            panels: [
                {
                    id: 'project-package-store.test-plugin.panel',
                    title: 'Project Package Store Test Panel',
                    entry: panelLayout.embeddedEntryPath,
                    placement: 'utility',
                    singleton: true,
                },
            ],
        },
        package: packageManifest,
    };
}

/** @description 写入一个可由 ProjectPackageStore 安装的目录包。 */
function writeDirectoryPackage(projectPath: string, version: string): string {
    // 保存当前测试包的临时源目录，安装后仍用于验证原始包与安装目录解耦。
    const packagePath = join(projectPath, 'incoming', version);
    // 保存统一发布文件目录，所有插件均须提供相同的 runtime 和 panel 入口。
    // 保存统一第三方库目录，供面板共用运行时资源使用。
    const librariesPath = join(packagePath, 'libs');
    // 保存测试面板统一 embedded 与 standalone 路径。
    const panelLayout = PanelPackageLayout.create('project-package-store.test-plugin.panel');
    // 保存面板 embedded 目录，宿主仅加载此处的 HTML 壳层。
    const embeddedPanelPath = join(packagePath, panelLayout.embeddedDirectory);
    // 保存面板共享运行时库目录，embedded 与 standalone 都从此加载资源。
    const panelLibraryPath = join(packagePath, panelLayout.panelLibraryDirectory);
    // 保存面板 standalone 模板目录。
    const standalonePanelPath = join(packagePath, panelLayout.standaloneDirectory);
    mkdirSync(packagePath, { recursive: true });
    mkdirSync(librariesPath, { recursive: true });
    mkdirSync(embeddedPanelPath, { recursive: true });
    mkdirSync(panelLibraryPath, { recursive: true });
    mkdirSync(standalonePanelPath, { recursive: true });
    writeFileSync(join(packagePath, 'project-package-store.test-plugin.bundle.js'), 'export default {};\n', 'utf8');
    writeFileSync(join(packagePath, panelLayout.embeddedScriptPath), 'export {};\n', 'utf8');
    writeFileSync(join(packagePath, panelLayout.embeddedStylePath), '', 'utf8');
    writeFileSync(join(packagePath, panelLayout.embeddedEntryPath), '<!doctype html>\n', 'utf8');
    writeFileSync(join(packagePath, panelLayout.standaloneScriptPath), 'export {};\n', 'utf8');
    writeFileSync(join(packagePath, panelLayout.standaloneStylePath), '', 'utf8');
    writeFileSync(join(packagePath, panelLayout.standaloneEntryPath), '<!doctype html>\n', 'utf8');
    writeFileSync(join(panelLibraryPath, '.keep'), '', 'utf8');
    // 保存必须写入合并 manifest 的文件路径，manifest 自身不进入摘要避免循环依赖。
    const packageFiles = [
        'project-package-store.test-plugin.bundle.js',
        panelLayout.embeddedScriptPath,
        panelLayout.embeddedStylePath,
        panelLayout.embeddedEntryPath,
        panelLayout.standaloneScriptPath,
        panelLayout.standaloneStylePath,
        panelLayout.standaloneEntryPath,
        `${panelLayout.panelLibraryDirectory}/.keep`,
    ];
    // 保存每个文件的 SHA-256 摘要，用于覆盖 ProjectPackageStore 的完整性校验路径。
    const fileIntegrity: IPluginPackageFileIntegrity[] = packageFiles
        .map((filePath) => {
            return {
                path: filePath,
                digest: createHash('sha256').update(requireFileContent(packagePath, filePath)).digest('hex'),
            };
        })
        .sort((left, right) => left.path.localeCompare(right.path));
    // 保存固定顺序的汇总摘要输入，必须与生产打包脚本的算法一致。
    const digestPayload = fileIntegrity.map((fileRecord) => `${fileRecord.path}:${fileRecord.digest}`).join('\n');
    // 保存完整发布清单，取代旧的 plugin.package.json。
    const packageManifest: IPluginPackageManifest = {
        schemaVersion: 1,
        digest: createHash('sha256').update(digestPayload).digest('hex'),
        packedAt: '2026-07-21T00:00:00.000Z',
        sdkVersion: '0.1.0',
        files: fileIntegrity,
        libraries: [],
        changelog: [
            {
                version,
                publishedAt: '2026-07-21T00:00:00.000Z',
                changes: ['Unified package layout test fixture.'],
            },
        ],
    };
    writeFileSync(
        join(packagePath, 'project-package-store.test-plugin.manifest.json'),
        `${JSON.stringify(createManifest(version, packageManifest), null, 4)}\n`,
        'utf8',
    );
    return packagePath;
}

/**
 * @description 读取测试目录包内一个固定文件的内容。
 * @param packagePath 测试目录包根路径
 * @param relativePath 要读取的相对文件路径
 * @returns 文件 UTF-8 内容
 */
function requireFileContent(packagePath: string, relativePath: string): string {
    // 保存当前测试文件的绝对路径，避免摘要误读取进程工作目录下的同名文件。
    const filePath = join(packagePath, relativePath);
    return readFileSync(filePath, 'utf8');
}

/** @description 写入不声明面板贡献的最小 tooling 目录包。 */
function writeHeadlessToolingPackage(projectPath: string): string {
    const packagePath = join(projectPath, 'incoming', 'headless-tooling');
    const pluginId = 'project-package-store.headless-tooling';
    const bundleFileName = `${pluginId}.bundle.js`;
    const bundleContent = 'module.exports = {};\n';
    mkdirSync(join(packagePath, 'libs'), { recursive: true });
    writeFileSync(join(packagePath, 'libs', '.keep'), '', 'utf8');
    writeFileSync(join(packagePath, bundleFileName), bundleContent, 'utf8');
    const files: IPluginPackageFileIntegrity[] = [
        { path: bundleFileName, digest: createHash('sha256').update(bundleContent).digest('hex') },
        { path: 'libs/.keep', digest: createHash('sha256').update('').digest('hex') },
    ].sort((left, right) => left.path.localeCompare(right.path));
    const packageManifest: IPluginPackageManifest = {
        schemaVersion: 1,
        digest: createHash('sha256').update(files.map((file) => `${file.path}:${file.digest}`).join('\n')).digest('hex'),
        packedAt: '2026-08-01T00:00:00.000Z',
        sdkVersion: '0.1.0',
        files,
        libraries: [],
        changelog: [{ version: '1.0.0', publishedAt: '2026-08-01T00:00:00.000Z', changes: ['Headless tooling package fixture.'] }],
    };
    const manifest: IPluginManifest = {
        id: pluginId,
        version: '1.0.0',
        kind: 'tooling-plugin',
        displayName: 'Headless Tooling Plugin',
        main: `./${bundleFileName}`,
        engines: { host: '^0.1.0' },
        activation: { autoActivate: true, events: [] },
        permissions: {},
        contributions: {},
        package: packageManifest,
    };
    writeFileSync(join(packagePath, `${pluginId}.manifest.json`), `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
    return packagePath;
}

test('project packaging should install a headless tooling directory package without panel files', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-headless-tooling-package-'));
    try {
        const packagingApp = new PackagingApp({ projectPath });
        const packagePath = writeHeadlessToolingPackage(projectPath);
        const validation = await packagingApp.validate(packagePath);
        assert.equal(validation.ok, true);

        const installResult = await packagingApp.install(packagePath);
        assert.equal(installResult.pluginId, 'project-package-store.headless-tooling');
        assert.equal(existsSync(join(installResult.installPath, 'panels')), false);
        assert.equal(existsSync(join(installResult.installPath, 'libs', '.keep')), true);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should persist multiple versions and recover the active version after restart', async (): Promise<void> => {
    // 保存测试专用工程目录，结束时始终删除以避免污染仓库。
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-store-'));
    try {
        // 保存首个目录包路径，用于验证真实安装与首次活动版本。
        const packagePathV1 = writeDirectoryPackage(projectPath, '1.0.0');
        // 保存第二个目录包路径，用于验证升级不会删除旧版本。
        const packagePathV2 = writeDirectoryPackage(projectPath, '1.1.0');
        // 保存首个主入口实例，模拟 Creator 主进程在项目打开后创建包装服务。
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(packagePathV1);
        await packagingApp.upgrade(packagePathV2);

        // 保存重启后的独立实例，验证状态仅来自项目级持久化文件。
        const recoveredPackagingApp = new PackagingApp({ projectPath });
        // 保存恢复后的多版本快照，活动版本必须指向最近升级版本。
        const recoveredSnapshot = recoveredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin');
        assert.equal(recoveredSnapshot?.activeVersion, '1.1.0');
        assert.deepEqual(
            recoveredSnapshot?.versions.map((versionRecord) => versionRecord.version).sort(),
            ['1.0.0', '1.1.0'],
        );
        const installedManifest = JSON.parse(readFileSync(join(projectPath, 'peanut-plugins', 'installed.json'), 'utf8')) as {
            readonly schemaVersion: number;
            readonly plugins: readonly { readonly versions: readonly Record<string, unknown>[] }[];
        };
        assert.equal(installedManifest.schemaVersion, 2);
        assert.equal(
            installedManifest.plugins.every((plugin) => {
                return plugin.versions.every((version) => {
                    return !Object.prototype.hasOwnProperty.call(version, 'packagePath') && !isAbsolute(String(version.installPath));
                });
            }),
            true,
        );

        // 保存幂等 repair 结果；完整索引不应产生额外修复动作。
        const repairResult = await recoveredPackagingApp.repair();
        assert.equal(repairResult.repaired, false);
        const uninstallResult = await recoveredPackagingApp.uninstall('project-package-store.test-plugin');
        assert.equal(uninstallResult.removed, true);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should refresh a stale kernel snapshot before planning an upgrade', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-stale-kernel-'));
    try {
        // 两个 Packaging 实例模拟 reload 前后同时存活的 Creator kernel。
        const firstKernelPackagingApp = new PackagingApp({ projectPath });
        const staleKernelPackagingApp = new PackagingApp({ projectPath });
        await firstKernelPackagingApp.install(writeDirectoryPackage(projectPath, '1.0.0'));

        // 旧实现会依据构造时的空内存索引拒绝升级；必须在规划前读取磁盘的已提交版本。
        const upgradeResult = await staleKernelPackagingApp.upgrade(writeDirectoryPackage(projectPath, '1.1.0'));
        const recoveredPackagingApp = new PackagingApp({ projectPath });

        assert.equal(upgradeResult.operation, 'upgrade');
        assert.equal(recoveredPackagingApp.getActiveInstalledPackage('project-package-store.test-plugin')?.version, '1.1.0');
        assert.deepEqual(
            recoveredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin')?.versions.map((entry) => entry.version).sort(),
            ['1.0.0', '1.1.0'],
        );
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should recover the last valid version when the active installed directory package is corrupted', async (): Promise<void> => {
    // 保存测试专用工程目录，结束时始终删除以避免污染仓库。
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-corruption-recovery-'));
    try {
        // 保存两个真实目录包，模拟升级后活动版本在宿主异常中断期间被外部损坏。
        const packagePathV1 = writeDirectoryPackage(projectPath, '1.0.0');
        const packagePathV2 = writeDirectoryPackage(projectPath, '1.1.0');
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(packagePathV1);
        const upgradeResult = await packagingApp.upgrade(packagePathV2);

        // 损坏活动版本中受摘要保护的入口文件，确保恢复只能依赖目录包完整性检查而非旧索引。
        writeFileSync(join(upgradeResult.installPath, 'project-package-store.test-plugin.bundle.js'), 'export default { corrupted: true };\n', 'utf8');

        // 用新的包装服务实例模拟宿主重启；repair 必须移除损坏版本并重新选择可用活动版本。
        const recoveredPackagingApp = new PackagingApp({ projectPath });
        const repairResult = await recoveredPackagingApp.repair();
        const recoveredSnapshot = recoveredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin');

        assert.equal(repairResult.repaired, true);
        assert.equal(repairResult.actions.includes('reconciled_installed_manifest'), true);
        assert.equal(recoveredSnapshot?.activeVersion, '1.0.0');
        assert.deepEqual(recoveredSnapshot?.versions.map((versionRecord) => versionRecord.version), ['1.0.0']);
        assert.equal(
            (await recoveredPackagingApp.inspect(join(projectPath, 'peanut-plugins', 'plugins', 'project-package-store.test-plugin', '1.1.0'))).isValidStructure,
            false,
        );
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should clear an interrupted staging version without changing the active installed version', async (): Promise<void> => {
    // 保存测试专用工程目录，结束时始终删除以避免污染仓库。
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-staging-recovery-'));
    try {
        // 先提交一个有效版本，再构造发生在原子 rename 前的目录复制残留。
        const packagePathV1 = writeDirectoryPackage(projectPath, '1.0.0');
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(packagePathV1);
        const interruptedStagingPath = join(projectPath, 'peanut-plugins', 'staging', 'project-package-store.test-plugin', '1.1.0');
        mkdirSync(interruptedStagingPath, { recursive: true });
        writeFileSync(join(interruptedStagingPath, 'partial.bundle.js'), 'partial package copy\n', 'utf8');

        // 用新的包装服务实例模拟宿主重启；repair 只应清理未提交内容，保留原活动版本。
        const recoveredPackagingApp = new PackagingApp({ projectPath });
        const repairResult = await recoveredPackagingApp.repair();
        const recoveredSnapshot = recoveredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin');

        assert.equal(repairResult.repaired, true);
        assert.equal(repairResult.actions.includes('removed_interrupted_staging_version:project-package-store.test-plugin/1.1.0'), true);
        assert.equal(existsSync(interruptedStagingPath), false);
        assert.equal(recoveredSnapshot?.activeVersion, '1.0.0');
        assert.deepEqual(recoveredSnapshot?.versions.map((versionRecord) => versionRecord.version), ['1.0.0']);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should discard an interrupted installed manifest replacement and retain the last committed active version', async (): Promise<void> => {
    // 保存测试专用工程目录，结束时始终删除以避免污染仓库。
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-manifest-recovery-'));
    try {
        // 先提交有效索引，再模拟原子 rename 前已写出但尚未提交的临时索引。
        const packagePathV1 = writeDirectoryPackage(projectPath, '1.0.0');
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(packagePathV1);
        const temporaryManifestPath = join(projectPath, 'peanut-plugins', 'installed.json.tmp');
        writeFileSync(temporaryManifestPath, '{"interrupted":true}\n', 'utf8');

        // 用新的包装服务实例模拟宿主重启；已提交索引仍是唯一可信活动版本来源。
        const recoveredPackagingApp = new PackagingApp({ projectPath });
        const repairResult = await recoveredPackagingApp.repair();
        const recoveredSnapshot = recoveredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin');

        assert.equal(repairResult.repaired, true);
        assert.equal(repairResult.actions.includes('removed_interrupted_installed_manifest_temp'), true);
        assert.equal(existsSync(temporaryManifestPath), false);
        assert.equal(recoveredSnapshot?.activeVersion, '1.0.0');
        assert.deepEqual(recoveredSnapshot?.versions.map((versionRecord) => versionRecord.version), ['1.0.0']);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should reject legacy manifest names and tampered unified files', async (): Promise<void> => {
    // 保存测试专用工程目录，结束时始终删除以避免污染仓库。
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-layout-'));
    try {
        // 保存旧格式目录包，用于确认安装器不会继续接受双 JSON 发布格式。
        const legacyPackagePath = join(projectPath, 'incoming', 'legacy');
        mkdirSync(legacyPackagePath, { recursive: true });
        writeFileSync(join(legacyPackagePath, 'plugin.manifest.json'), '{}\n', 'utf8');
        writeFileSync(join(legacyPackagePath, 'plugin.package.json'), '{}\n', 'utf8');
        // 保存 Packaging 应用实例，确保真实目录检查走统一格式校验器。
        const packagingApp = new PackagingApp({ projectPath });
        // 保存旧目录包的检查结果，必须明确报出没有 ID 命名清单。
        const legacyInspection = await packagingApp.inspect(legacyPackagePath);
        assert.equal(legacyInspection.isValidStructure, false);
        assert.deepEqual(legacyInspection.issues, ['plugin_manifest_filename_mismatch']);

        // 保存合法目录包路径，随后篡改 bundle 验证 SHA-256 完整性检查。
        const packagePath = writeDirectoryPackage(projectPath, '1.0.0');
        writeFileSync(join(packagePath, 'project-package-store.test-plugin.bundle.js'), 'export default { altered: true };\n', 'utf8');
        // 保存被篡改目录包的检查结果，禁止安装被修改的发布文件。
        const tamperedInspection = await packagingApp.inspect(packagePath);
        assert.equal(tamperedInspection.isValidStructure, false);
        assert.equal(tamperedInspection.issues.includes('package_file_integrity_mismatch:project-package-store.test-plugin.bundle.js'), true);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should reject plugin icon paths outside the fixed asset location', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-icon-'));
    try {
        const packagePath = writeDirectoryPackage(projectPath, '1.0.0');
        const manifestPath = join(packagePath, 'project-package-store.test-plugin.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IPluginManifest;
        writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, icon: '../outside.png' }, null, 4)}\n`, 'utf8');

        const packagingApp = new PackagingApp({ projectPath });
        const validation = await packagingApp.validate(packagePath);
        assert.equal(validation.ok, false);
        assert.equal(validation.issues.includes('plugin_icon_path_invalid'), true);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project plugin file store should isolate caches, preserve configs, and repair temporary files', (): void => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-plugin-file-store-'));
    const hostSettingsPath = mkdtempSync(join(tmpdir(), 'peanut-plugin-global-settings-'));
    try {
        const fileStore = new ProjectPluginFileStore(projectPath, { globalConfigsPath: hostSettingsPath });
        fileStore.writeCacheFile('sample.plugin', 'reports/output.bin', new Uint8Array([1, 2, 3]));
        assert.deepEqual(Array.from(fileStore.readCacheFile('sample.plugin', 'reports/output.bin') ?? []), [1, 2, 3]);
        assert.equal(fileStore.getPluginCacheSize('sample.plugin'), 3);
        assert.deepEqual(fileStore.listCacheEntries('sample.plugin').map((entry) => entry.relativePath), ['reports', 'reports/output.bin']);
        assert.throws(() => fileStore.writeCacheFile('sample.plugin', '../outside.bin', new Uint8Array([1])), /plugin_cache_path_outside_scope/);

        fileStore.writePluginSettings('sample.plugin', 'global', { enabled: true, nested: { retries: 1 } });
        fileStore.writePluginSettings('sample.plugin', 'project', { nested: { retries: 2 }, theme: 'dark' });
        assert.deepEqual(fileStore.mergePluginSettings('sample.plugin', 'local', { session: 'active', theme: null }), { session: 'active' });
        assert.deepEqual(fileStore.readPluginSettings('sample.plugin', 'effective'), { enabled: true, nested: { retries: 2 }, session: 'active', theme: 'dark' });
        fileStore.writeManagerConfig({ autoRepair: true });
        assert.deepEqual(fileStore.readManagerConfig(), { autoRepair: true });

        const layout = fileStore.getLayout();
        writeFileSync(join(layout.projectConfigsPath, 'sample.plugin.json.tmp-stale'), '{}\n', 'utf8');
        const repairResult = fileStore.repair();
        assert.equal(repairResult.repaired, true);
        assert.equal(existsSync(join(layout.projectConfigsPath, 'sample.plugin.json.tmp-stale')), false);
        assert.deepEqual(fileStore.listPluginStorageSummaries(), [{ pluginId: 'sample.plugin', cacheSize: 3, hasConfig: true }]);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
        rmSync(hostSettingsPath, { recursive: true, force: true });
    }
});

test('project packaging should clear plugin cache but retain plugin config on uninstall', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-plugin-file-uninstall-'));
    try {
        const packagePath = writeDirectoryPackage(projectPath, '1.0.0');
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(packagePath);
        const fileStore = packagingApp.getProjectPluginFileStore();
        assert.notEqual(fileStore, null);
        fileStore?.writeCacheFile('project-package-store.test-plugin', 'generated.bin', new Uint8Array([7]));
        fileStore?.writePluginSettings('project-package-store.test-plugin', 'local', { selected: true });

        await packagingApp.uninstall('project-package-store.test-plugin');
        assert.equal(fileStore?.getPluginCacheSize('project-package-store.test-plugin'), 0);
        assert.deepEqual(fileStore?.readPluginSettings('project-package-store.test-plugin', 'local'), { selected: true });
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should switch persisted versions and protect the active version from removal', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-version-control-'));
    try {
        const packagingApp = new PackagingApp({ projectPath });
        await packagingApp.install(writeDirectoryPackage(projectPath, '1.0.0'));
        await packagingApp.upgrade(writeDirectoryPackage(projectPath, '2.0.0'));

        const switchedSnapshot = packagingApp.switchActiveInstalledPackageVersion('project-package-store.test-plugin', '1.0.0');
        assert.equal(switchedSnapshot?.activeVersion, '1.0.0');
        assert.equal(packagingApp.removeInactiveInstalledPackageVersion('project-package-store.test-plugin', '1.0.0'), null);

        const removedVersion = packagingApp.removeInactiveInstalledPackageVersion('project-package-store.test-plugin', '2.0.0');
        assert.equal(removedVersion?.version, '2.0.0');
        assert.deepEqual(packagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin')?.versions.map((entry) => entry.version), ['1.0.0']);

        const restoredPackagingApp = new PackagingApp({ projectPath });
        assert.deepEqual(restoredPackagingApp.getInstalledPackageSnapshot('project-package-store.test-plugin'), {
            pluginId: 'project-package-store.test-plugin',
            activeVersion: '1.0.0',
            versions: [
                {
                    pluginId: 'project-package-store.test-plugin',
                    version: '1.0.0',
                    installPath: join(projectPath, 'peanut-plugins', 'plugins', 'project-package-store.test-plugin', '1.0.0'),
                    packagePath: join(projectPath, 'peanut-plugins', 'plugins', 'project-package-store.test-plugin', '1.0.0'),
                },
            ],
        });
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('project packaging should reject the removed v1 installed manifest format', (): void => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-project-package-legacy-installed-'));
    try {
        const installedManifestPath = join(projectPath, 'peanut-plugins', 'installed.json');
        mkdirSync(join(projectPath, 'peanut-plugins'), { recursive: true });
        writeFileSync(installedManifestPath, JSON.stringify({
            schemaVersion: 1,
            plugins: [{
                pluginId: 'project-package-store.test-plugin',
                activeVersion: '1.0.0',
                versions: [{
                    version: '1.0.0',
                    installPath: 'peanut-plugins/plugins/project-package-store.test-plugin/1.0.0',
                    packagePath: '/legacy/source/package',
                }],
            }],
        }), 'utf8');

        const packagingApp = new PackagingApp({ projectPath });
        assert.equal(packagingApp.getActiveInstalledPackage('project-package-store.test-plugin'), null);
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('keeps a CPM-installed tooling package whose digest uses code-unit ordering during repair', async () => {
    const { ProjectPackageStore } = await import('../src/persistence/project-package-store');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peanut-cpm-layout-'));
    try {
        const pluginId = 'peanut.pod-lite';
        const version = '0.2.0';
        const installPath = join('peanut-plugins', 'plugins', pluginId, version);
        const packageRoot = join(projectRoot, installPath);
        const payload: Record<string, string> = {
            [`${pluginId}.bundle.js`]: 'module.exports = {};',
            'package.json': '{"type":"commonjs"}',
            'libs/.keep': '',
            'bundled/default_prefab/2d.meta': 'meta',
            'bundled/default_prefab_24/2d-camera.prefab': 'camera',
        };
        for (const [path, content] of Object.entries(payload)) {
            mkdirSync(join(packageRoot, ...path.split('/').slice(0, -1)), { recursive: true });
            writeFileSync(join(packageRoot, ...path.split('/')), content);
        }
        const files = Object.entries(payload).map(([path, content]) => ({ path, digest: createHash('sha256').update(content).digest('hex') }));
        const ordered = [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
        const digest = createHash('sha256').update(ordered.map((file) => `${file.path}:${file.digest}`).join('\n')).digest('hex');
        writeFileSync(join(packageRoot, `${pluginId}.manifest.json`), JSON.stringify({ id: pluginId, version, kind: 'tooling-plugin', main: `./${pluginId}.bundle.js`, package: { schemaVersion: 1, digest, files } }));
        const index = { schemaVersion: 2, plugins: [{ pluginId, activeVersion: version, versions: [{ version, installPath }] }] };
        writeFileSync(join(projectRoot, 'peanut-plugins', 'installed.json'), `${JSON.stringify(index, null, 4)}\n`);

        const store = new ProjectPackageStore(projectRoot);
        assert.equal(store.inspect(packageRoot).isValidStructure, true);
        assert.deepEqual(store.repair(), { repaired: false, actions: [] });
        assert.deepEqual(store.readInstalledSnapshots().map((snapshot) => [snapshot.pluginId, snapshot.activeVersion]), [[pluginId, version]]);
    } finally {
        rmSync(projectRoot, { recursive: true, force: true });
    }
});
