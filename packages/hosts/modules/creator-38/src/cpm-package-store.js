'use strict';

const { createHash } = require('crypto');
const { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } = require('fs');
const { isAbsolute, join, relative, resolve, sep } = require('path');

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
// Creator default prefabs may contain spaces (e.g. "Directional Light.prefab").
const RECORD_PATH_PATTERN = /^[A-Za-z0-9._\-\s]+(?:\/[A-Za-z0-9._\-\s]+)*$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

/**
 * Reads the CPM installation index and verifies active directory packages before they are loaded.
 */
class CpmPackageStore {
    /**
     * @description 按 release descriptor 的 Host 目录包协议计算扩展目录摘要：
     * 全部普通文件（忽略 .DS_Store）的 `path:sha256` 按码元序换行拼接后取 SHA-256。
     * 开发检出（含 node_modules）或存在链接/特殊文件时返回 null。
     * @param {string} root Host 扩展根目录。
     * @returns {string | null} 小写十六进制摘要。
     */
    static hostPackageDigest(root) {
        const records = [];
        const walk = (directory, prefix) => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (entry.name === '.DS_Store') continue;
                const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
                if (entry.isDirectory()) {
                    if (relativePath === 'node_modules') throw new Error('development_checkout');
                    walk(join(directory, entry.name), relativePath);
                } else if (entry.isFile()) {
                    records.push(`${relativePath}:${createHash('sha256').update(readFileSync(join(directory, entry.name))).digest('hex')}`);
                } else {
                    throw new Error('unsupported_entry');
                }
            }
        };
        try {
            walk(root, '');
        } catch {
            return null;
        }
        records.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
        return createHash('sha256').update(records.join('\n')).digest('hex');
    }

    /**
     * @description 核对 `query-status.artifacts` 与 Lite release descriptor 是否属于同一发行。
     * @param {object} artifacts Host 报告的 `{ host, core }` 身份。
     * @param {object} descriptor `lite-release-descriptor.json` 内容。
     * @returns {string[]} 不一致字段；空数组表示一致。
     */
    static compareReleaseIdentity(artifacts, descriptor) {
        const mismatches = [];
        const expect = (field, actual, expected) => {
            if (actual !== expected) mismatches.push(field);
        };
        expect('host.id', artifacts?.host?.id, 'peanut-pod-lite-host');
        expect('host.version', artifacts?.host?.version, descriptor?.version);
        expect('host.packageDigest', artifacts?.host?.packageDigest, descriptor?.host?.packageDigest);
        expect('core.id', artifacts?.core?.id, descriptor?.productId);
        expect('core.version', artifacts?.core?.version, descriptor?.version);
        expect('core.packageDigest', artifacts?.core?.packageDigest, descriptor?.core?.packageDigest);
        return mismatches;
    }

    constructor(projectPath) {
        this.projectPath = realpathSync(resolve(projectPath));
        this.indexPath = join(this.projectPath, 'peanut-plugins', 'installed.json');
    }

    resolveActivePackage(pluginId, required) {
        this.assertPluginId(pluginId);
        const installed = this.readInstalledIndex(required);
        if (installed === null) {
            return null;
        }
        const matching = installed.plugins.filter((record) => record?.pluginId === pluginId);
        if (matching.length === 0) {
            if (required) {
                throw new Error(`peanut_cpm_package_not_installed:${pluginId}`);
            }
            return null;
        }
        if (matching.length !== 1) {
            throw new Error(`peanut_cpm_index_plugin_duplicate:${pluginId}`);
        }
        const record = matching[0];
        if (!this.isVersion(record.activeVersion) || !Array.isArray(record.versions)) {
            throw new Error(`peanut_cpm_index_plugin_invalid:${pluginId}`);
        }
        const versions = record.versions.filter((candidate) => candidate?.version === record.activeVersion);
        if (versions.length !== 1) {
            throw new Error(`peanut_cpm_index_active_version_invalid:${pluginId}`);
        }
        const expectedInstallPath = join('peanut-plugins', 'plugins', pluginId, record.activeVersion);
        if (versions[0].installPath !== expectedInstallPath) {
            throw new Error(`peanut_cpm_index_install_path_invalid:${pluginId}`);
        }
        const packagePath = resolve(this.projectPath, expectedInstallPath);
        return this.verifyPackage(packagePath, pluginId, record.activeVersion);
    }

    verifyPackage(packagePath, pluginId, expectedVersion) {
        const resolvedPackagePath = resolve(packagePath);
        if (!existsSync(resolvedPackagePath)) {
            throw new Error(`peanut_cpm_package_missing:${pluginId}`);
        }
        const packageStat = lstatSync(resolvedPackagePath);
        if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
            throw new Error(`peanut_cpm_package_root_invalid:${pluginId}`);
        }
        const realPackagePath = realpathSync(resolvedPackagePath);
        if (!this.isWithin(this.projectPath, realPackagePath)) {
            throw new Error(`peanut_cpm_package_root_escape:${pluginId}`);
        }
        const manifestName = `${pluginId}.manifest.json`;
        const manifestPath = join(realPackagePath, manifestName);
        if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) {
            throw new Error(`peanut_cpm_manifest_missing:${pluginId}`);
        }
        const manifest = this.parseJsonFile(manifestPath, `peanut_cpm_manifest_invalid:${pluginId}`);
        this.verifyManifest(manifest, pluginId, expectedVersion, realPackagePath);
        const expectedRecords = this.verifyRecords(manifest.package.files, realPackagePath, pluginId);
        const actualRecords = this.collectPayloadRecords(realPackagePath, manifestName, pluginId);
        if (expectedRecords.size !== actualRecords.size) {
            throw new Error(`peanut_cpm_payload_set_mismatch:${pluginId}`);
        }
        for (const [recordPath, digest] of expectedRecords) {
            if (actualRecords.get(recordPath) !== digest) {
                throw new Error(`peanut_cpm_integrity_file_mismatch:${pluginId}:${recordPath}`);
            }
        }
        if (!this.matchesPackageDigest(expectedRecords, manifest.package.digest)) {
            throw new Error(`peanut_cpm_integrity_digest_mismatch:${pluginId}`);
        }
        const mainRecordPath = manifest.main.slice(2);
        if (!expectedRecords.has(mainRecordPath)) {
            throw new Error(`peanut_cpm_entry_not_integrity_checked:${pluginId}`);
        }
        return Object.freeze({ manifest: Object.freeze(manifest), mainPath: join(realPackagePath, mainRecordPath), packagePath: realPackagePath });
    }

    matchesPackageDigest(records, expected) {
        // 规范顺序为码元序（跨 ICU 稳定）；兼容旧版按 localeCompare 打包的清单。
        const digest = (compare) => createHash('sha256')
            .update([...records].sort(([left], [right]) => compare(left, right)).map(([path, digest]) => `${path}:${digest}`).join('\n'))
            .digest('hex');
        return expected === digest((left, right) => (left < right ? -1 : left > right ? 1 : 0))
            || expected === digest((left, right) => left.localeCompare(right));
    }

    readInstalledIndex(required) {
        if (!existsSync(this.indexPath)) {
            if (required) {
                throw new Error('peanut_cpm_installed_index_missing');
            }
            return null;
        }
        if (!lstatSync(this.indexPath).isFile() || lstatSync(this.indexPath).isSymbolicLink()) {
            throw new Error('peanut_cpm_installed_index_invalid');
        }
        const installed = this.parseJsonFile(this.indexPath, 'peanut_cpm_installed_index_invalid');
        if (installed.schemaVersion !== 2 || !Array.isArray(installed.plugins)) {
            throw new Error('peanut_cpm_installed_index_invalid');
        }
        const pluginIds = new Set();
        for (const plugin of installed.plugins) {
            if (
                plugin === null ||
                typeof plugin !== 'object' ||
                Array.isArray(plugin) ||
                !PLUGIN_ID_PATTERN.test(plugin.pluginId ?? '') ||
                !this.isVersion(plugin.activeVersion) ||
                !Array.isArray(plugin.versions) ||
                pluginIds.has(plugin.pluginId)
            ) {
                throw new Error('peanut_cpm_installed_index_invalid');
            }
            pluginIds.add(plugin.pluginId);
            const versions = new Set();
            for (const version of plugin.versions) {
                const expectedPath = join('peanut-plugins', 'plugins', plugin.pluginId, version?.version ?? '');
                if (
                    version === null ||
                    typeof version !== 'object' ||
                    Array.isArray(version) ||
                    !this.isVersion(version.version) ||
                    version.installPath !== expectedPath ||
                    Object.prototype.hasOwnProperty.call(version, 'packagePath') ||
                    versions.has(version.version)
                ) {
                    throw new Error('peanut_cpm_installed_index_invalid');
                }
                versions.add(version.version);
            }
            if (!versions.has(plugin.activeVersion)) {
                throw new Error('peanut_cpm_installed_index_invalid');
            }
        }
        return installed;
    }

    verifyManifest(manifest, pluginId, expectedVersion, realPackagePath) {
        if (
            manifest.id !== pluginId ||
            manifest.version !== expectedVersion ||
            manifest.kind !== 'tooling-plugin' ||
            manifest.main !== `./${pluginId}.bundle.js` ||
            manifest.package?.schemaVersion !== 1 ||
            !DIGEST_PATTERN.test(manifest.package?.digest ?? '') ||
            !Array.isArray(manifest.package?.files)
        ) {
            throw new Error(`peanut_cpm_manifest_invalid:${pluginId}`);
        }
        const packageJsonPath = join(realPackagePath, 'package.json');
        if (!existsSync(packageJsonPath) || !lstatSync(packageJsonPath).isFile() || lstatSync(packageJsonPath).isSymbolicLink()) {
            throw new Error(`peanut_cpm_package_json_missing:${pluginId}`);
        }
    }

    verifyRecords(records, packagePath, pluginId) {
        const verified = new Map();
        for (const record of records) {
            if (!this.isRecordPath(record?.path) || !DIGEST_PATTERN.test(record?.digest ?? '') || verified.has(record.path)) {
                throw new Error(`peanut_cpm_integrity_record_invalid:${pluginId}`);
            }
            const candidatePath = resolve(packagePath, ...record.path.split('/'));
            if (!this.isWithin(packagePath, candidatePath)) {
                throw new Error(`peanut_cpm_integrity_path_escape:${pluginId}`);
            }
            verified.set(record.path, record.digest);
        }
        if (verified.size === 0) {
            throw new Error(`peanut_cpm_integrity_missing:${pluginId}`);
        }
        return verified;
    }

    collectPayloadRecords(packagePath, manifestName, pluginId) {
        const records = new Map();
        const visit = (directoryPath) => {
            for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
                if (entry.name === '.DS_Store') {
                    continue;
                }
                const absolutePath = join(directoryPath, entry.name);
                const stat = lstatSync(absolutePath);
                if (stat.isSymbolicLink()) {
                    throw new Error(`peanut_cpm_payload_symlink:${pluginId}`);
                }
                if (stat.isDirectory()) {
                    visit(absolutePath);
                    continue;
                }
                if (!stat.isFile()) {
                    throw new Error(`peanut_cpm_payload_type_invalid:${pluginId}`);
                }
                const recordPath = relative(packagePath, absolutePath).split(sep).join('/');
                if (recordPath === manifestName) {
                    continue;
                }
                // Only the package-root integrity manifest is reserved. Nested
                // product manifests (e.g. bundled/lumen-templates.manifest.json) are payload.
                if (!recordPath.includes('/') && recordPath.endsWith('.manifest.json')) {
                    throw new Error(`peanut_cpm_manifest_ambiguous:${pluginId}`);
                }
                if (!this.isRecordPath(recordPath)) {
                    throw new Error(`peanut_cpm_payload_path_invalid:${pluginId}`);
                }
                records.set(recordPath, createHash('sha256').update(readFileSync(absolutePath)).digest('hex'));
            }
        };
        visit(packagePath);
        if (!existsSync(join(packagePath, 'libs')) || !lstatSync(join(packagePath, 'libs')).isDirectory()) {
            throw new Error(`peanut_cpm_libraries_directory_missing:${pluginId}`);
        }
        return records;
    }

    parseJsonFile(filePath, errorCode) {
        try {
            const value = JSON.parse(readFileSync(filePath, 'utf8'));
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error(errorCode);
            }
            return value;
        } catch {
            throw new Error(errorCode);
        }
    }

    assertPluginId(pluginId) {
        if (!PLUGIN_ID_PATTERN.test(pluginId)) {
            throw new Error('peanut_cpm_plugin_id_invalid');
        }
    }

    isRecordPath(value) {
        return typeof value === 'string' && RECORD_PATH_PATTERN.test(value) && !value.split('/').some((segment) => segment === '.' || segment === '..');
    }

    isVersion(value) {
        return typeof value === 'string' && VERSION_PATTERN.test(value);
    }

    isWithin(rootPath, childPath) {
        const child = relative(rootPath, childPath);
        return child.length > 0 && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
    }
}

module.exports = { CpmPackageStore };
