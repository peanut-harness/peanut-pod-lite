/**
 * @description 将随包分发的 default_prefab 同步到插件/运行时缓存（按 manifest 指纹判断是否最新）。
 */
import { createHash } from 'crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'fs';
import { dirname, join, relative, sep } from 'path';

import type {
    ILumenTemplateCacheStatus,
    ILumenTemplateCacheSyncResult,
    ILumenTemplateManifest,
} from './manifest';
import { LumenPackageRoot } from '../package-root';

/**
 * @description 内置模板包与缓存同步器。
 */
export class LumenTemplateCache {
    /** @description 缓存目录内模板子目录名。 */
    public static readonly CACHE_TEMPLATE_DIR = 'default_prefab';

    /** @description 清单文件名。 */
    public static readonly MANIFEST_FILE = 'lumen-templates.manifest.json';

    /** @description 包内默认 Creator 模板版本。 */
    public static readonly BUNDLED_COCOS_VERSION = '3.8.3';

    /**
     * @description 解析随包（或 monorepo 开发态）模板根。
     * @param packageRoot lumen 包根（含 `package.json` / `bundled`）
     * @returns 模板根绝对路径
     */
    public static resolveBundledRoot(packageRoot: string = LumenPackageRoot.resolve()): string {
        const bundled = join(LumenPackageRoot.resolveBundled(packageRoot), LumenTemplateCache.CACHE_TEMPLATE_DIR);
        if (existsSync(bundled) && statSync(bundled).isDirectory()) {
            return bundled;
        }
        const monorepo = join(packageRoot, '..', '..', '..', 'default_prefab');
        if (existsSync(monorepo) && statSync(monorepo).isDirectory()) {
            return monorepo;
        }
        throw new Error(`lumen_bundled_templates_missing:expected=${bundled}`);
    }

    /**
     * @description 读取包内清单；缺失时现场根据目录计算（开发回退）。
     * @param packageRoot 包根
     * @returns 清单
     */
    public static readBundledManifest(packageRoot: string = LumenPackageRoot.resolve()): ILumenTemplateManifest {
        const manifestPath = join(LumenPackageRoot.resolveBundled(packageRoot), LumenTemplateCache.MANIFEST_FILE);
        if (existsSync(manifestPath)) {
            return this._parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
        }
        const templateRoot = this.resolveBundledRoot(packageRoot);
        const packageVersion = this._readPackageVersion(packageRoot);
        return this.buildManifest(
            templateRoot,
            packageVersion,
            LumenTemplateCache.BUNDLED_COCOS_VERSION,
        );
    }

    /**
     * @description 根据模板目录计算清单。
     * @param templateRoot 模板根
     * @param packageVersion 包版本
     * @param cocosVersion Creator 模板版本
     * @returns 清单
     */
    public static buildManifest(
        templateRoot: string,
        packageVersion: string,
        cocosVersion: string = LumenTemplateCache.BUNDLED_COCOS_VERSION,
    ): ILumenTemplateManifest {
        const files = this._listPrefabRelativePaths(templateRoot);
        const hash = createHash('sha256');
        hash.update(`v2\n${cocosVersion}\n${packageVersion}\n`);
        for (const relativePath of files) {
            hash.update(relativePath);
            hash.update('\0');
            hash.update(
                readFileSync(join(templateRoot, relativePath), 'utf8').replace(/\r\n?/gu, '\n'),
            );
            hash.update('\n');
        }
        return {
            cocosVersion,
            packageVersion,
            contentHash: hash.digest('hex'),
            templateCount: files.length,
            generatedAt: new Date().toISOString(),
        };
    }

    /**
     * @description 若缓存不是最新则从内置包复制；返回可用模板根。
     * @param cacheDir 插件缓存根
     * @param packageRoot lumen 包根
     * @returns 同步结果
     */
    public static ensureSynced(
        cacheDir: string,
        packageRoot: string = LumenPackageRoot.resolve(),
    ): ILumenTemplateCacheSyncResult {
        return this._writeFromBundled(cacheDir, packageRoot, false);
    }

    /**
     * @description 强制用包内 3.8.3 模板覆盖缓存（重置）。
     * @param cacheDir 插件缓存根
     * @param packageRoot lumen 包根
     * @returns 同步结果
     */
    public static resetFromBundled(
        cacheDir: string,
        packageRoot: string = LumenPackageRoot.resolve(),
    ): ILumenTemplateCacheSyncResult {
        return this._writeFromBundled(cacheDir, packageRoot, true);
    }

    /**
     * @description 从外部版本包导入到缓存（布局：manifest + default_prefab）。
     * @param sourceRoot 版本包根
     * @param cacheDir 插件缓存根
     * @returns 同步结果（bundledRoot 指向源模板目录）
     */
    public static importPack(sourceRoot: string, cacheDir: string): ILumenTemplateCacheSyncResult {
        if (sourceRoot.trim().length === 0) {
            throw new Error('lumen_template_pack_source_empty');
        }
        if (cacheDir.trim().length === 0) {
            throw new Error('lumen_template_cache_dir_empty');
        }
        const sourceManifestPath = join(sourceRoot, LumenTemplateCache.MANIFEST_FILE);
        const sourceTemplates = join(sourceRoot, LumenTemplateCache.CACHE_TEMPLATE_DIR);
        if (!existsSync(sourceManifestPath)) {
            throw new Error(`lumen_template_pack_manifest_missing:${sourceManifestPath}`);
        }
        if (!existsSync(sourceTemplates) || !statSync(sourceTemplates).isDirectory()) {
            throw new Error(`lumen_template_pack_templates_missing:${sourceTemplates}`);
        }
        const manifest = this._parseManifest(JSON.parse(readFileSync(sourceManifestPath, 'utf8')));
        const actualCount = this._countPrefabs(sourceTemplates);
        if (actualCount !== manifest.templateCount) {
            throw new Error(
                `lumen_template_pack_count_mismatch:manifest=${manifest.templateCount}:actual=${actualCount}`,
            );
        }
        const recomputed = this.buildManifest(sourceTemplates, manifest.packageVersion, manifest.cocosVersion);
        if (recomputed.contentHash !== manifest.contentHash) {
            throw new Error(
                `lumen_template_pack_hash_mismatch:manifest=${manifest.contentHash}:actual=${recomputed.contentHash}`,
            );
        }
        const cachedTemplateRoot = join(cacheDir, LumenTemplateCache.CACHE_TEMPLATE_DIR);
        const cachedManifestPath = join(cacheDir, LumenTemplateCache.MANIFEST_FILE);
        mkdirSync(cacheDir, { recursive: true });
        if (existsSync(cachedTemplateRoot)) {
            rmSync(cachedTemplateRoot, { recursive: true, force: true });
        }
        this._copyDirectory(sourceTemplates, cachedTemplateRoot);
        writeFileSync(cachedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        return {
            templateRoot: cachedTemplateRoot,
            copied: true,
            manifest,
            bundledRoot: sourceTemplates,
        };
    }

    /**
     * @description 读取缓存相对包内的状态。
     * @param cacheDir 缓存根
     * @param packageRoot lumen 包根
     * @returns 状态
     */
    public static readCacheStatus(
        cacheDir: string,
        packageRoot: string = LumenPackageRoot.resolve(),
    ): ILumenTemplateCacheStatus {
        const bundled = this.readBundledManifest(packageRoot);
        const cachedManifestPath = join(cacheDir, LumenTemplateCache.MANIFEST_FILE);
        const cachedTemplateRoot = join(cacheDir, LumenTemplateCache.CACHE_TEMPLATE_DIR);
        const cache = this._tryReadManifest(cachedManifestPath);
        const templateRoot =
            cache != null && existsSync(cachedTemplateRoot) ? cachedTemplateRoot : null;
        const inSyncWithBundled =
            cache != null &&
            templateRoot != null &&
            cache.contentHash === bundled.contentHash &&
            cache.packageVersion === bundled.packageVersion &&
            cache.cocosVersion === bundled.cocosVersion &&
            this._countPrefabs(cachedTemplateRoot) === bundled.templateCount;
        return {
            cacheDir,
            templateRoot,
            bundled,
            cache,
            inSyncWithBundled,
        };
    }

    /**
     * @description 从 bundled 写入缓存。
     * @param cacheDir 缓存根
     * @param packageRoot 包根
     * @param force 是否强制覆盖
     * @returns 结果
     */
    private static _writeFromBundled(
        cacheDir: string,
        packageRoot: string,
        force: boolean,
    ): ILumenTemplateCacheSyncResult {
        if (cacheDir.trim().length === 0) {
            throw new Error('lumen_template_cache_dir_empty');
        }
        const bundledRoot = this.resolveBundledRoot(packageRoot);
        const desired = this.readBundledManifest(packageRoot);
        const cachedTemplateRoot = join(cacheDir, LumenTemplateCache.CACHE_TEMPLATE_DIR);
        const cachedManifestPath = join(cacheDir, LumenTemplateCache.MANIFEST_FILE);
        const current = this._tryReadManifest(cachedManifestPath);
        const upToDate =
            !force &&
            current != null &&
            current.contentHash === desired.contentHash &&
            current.packageVersion === desired.packageVersion &&
            current.cocosVersion === desired.cocosVersion &&
            existsSync(cachedTemplateRoot) &&
            this._countPrefabs(cachedTemplateRoot) === desired.templateCount;
        if (upToDate) {
            return {
                templateRoot: cachedTemplateRoot,
                copied: false,
                manifest: current,
                bundledRoot,
            };
        }
        mkdirSync(cacheDir, { recursive: true });
        if (existsSync(cachedTemplateRoot)) {
            rmSync(cachedTemplateRoot, { recursive: true, force: true });
        }
        this._copyDirectory(bundledRoot, cachedTemplateRoot);
        writeFileSync(cachedManifestPath, `${JSON.stringify(desired, null, 2)}\n`, 'utf8');
        return {
            templateRoot: cachedTemplateRoot,
            copied: true,
            manifest: desired,
            bundledRoot,
        };
    }

    /**
     * @description 解析清单对象。
     * @param value 未受信 JSON
     * @returns 清单
     */
    private static _parseManifest(value: unknown): ILumenTemplateManifest {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('lumen_template_manifest_invalid');
        }
        const record = value as Record<string, unknown>;
        if (typeof record.packageVersion !== 'string' || record.packageVersion.trim().length === 0) {
            throw new Error('lumen_template_manifest_packageVersion');
        }
        if (typeof record.contentHash !== 'string' || record.contentHash.trim().length === 0) {
            throw new Error('lumen_template_manifest_contentHash');
        }
        if (typeof record.templateCount !== 'number' || !Number.isFinite(record.templateCount)) {
            throw new Error('lumen_template_manifest_templateCount');
        }
        if (typeof record.generatedAt !== 'string') {
            throw new Error('lumen_template_manifest_generatedAt');
        }
        const cocosVersion =
            typeof record.cocosVersion === 'string' && record.cocosVersion.trim().length > 0
                ? record.cocosVersion.trim()
                : LumenTemplateCache.BUNDLED_COCOS_VERSION;
        return {
            cocosVersion,
            packageVersion: record.packageVersion,
            contentHash: record.contentHash,
            templateCount: record.templateCount,
            generatedAt: record.generatedAt,
        };
    }

    /**
     * @description 尝试读缓存清单。
     * @param absolutePath 路径
     * @returns 清单或 null
     */
    private static _tryReadManifest(absolutePath: string): ILumenTemplateManifest | null {
        try {
            if (!existsSync(absolutePath)) {
                return null;
            }
            return this._parseManifest(JSON.parse(readFileSync(absolutePath, 'utf8')));
        } catch {
            return null;
        }
    }

    /**
     * @description 读包版本。
     * @param packageRoot 包根
     * @returns 版本
     */
    private static _readPackageVersion(packageRoot: string): string {
        try {
            const raw = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
                version?: unknown;
            };
            return typeof raw.version === 'string' ? raw.version : '0.0.0';
        } catch {
            return '0.0.0';
        }
    }

    /**
     * @description 列出相对路径（排序）。
     * @param templateRoot 模板根
     * @returns 相对路径列表
     */
    private static _listPrefabRelativePaths(templateRoot: string): readonly string[] {
        const out: string[] = [];
        this._walkPrefabs(templateRoot, templateRoot, out);
        return out.sort();
    }

    /**
     * @description 统计 prefab 数。
     * @param templateRoot 模板根
     * @returns 数量
     */
    private static _countPrefabs(templateRoot: string): number {
        return this._listPrefabRelativePaths(templateRoot).length;
    }

    /**
     * @description 递归收集 prefab。
     * @param root 根
     * @param current 当前
     * @param out 输出
     */
    private static _walkPrefabs(root: string, current: string, out: string[]): void {
        for (const name of readdirSync(current)) {
            if (name.startsWith('.')) {
                continue;
            }
            const absolute = join(current, name);
            const stat = statSync(absolute);
            if (stat.isDirectory()) {
                this._walkPrefabs(root, absolute, out);
                continue;
            }
            if (name.endsWith('.prefab')) {
                out.push(relative(root, absolute).split(sep).join('/'));
            }
        }
    }

    /**
     * @description 递归复制目录。
     * @param source 源
     * @param target 目标
     */
    private static _copyDirectory(source: string, target: string): void {
        mkdirSync(target, { recursive: true });
        for (const name of readdirSync(source)) {
            if (name.startsWith('.')) {
                continue;
            }
            const from = join(source, name);
            const to = join(target, name);
            const stat = statSync(from);
            if (stat.isDirectory()) {
                this._copyDirectory(from, to);
            } else {
                mkdirSync(dirname(to), { recursive: true });
                copyFileSync(from, to);
            }
        }
    }
}
