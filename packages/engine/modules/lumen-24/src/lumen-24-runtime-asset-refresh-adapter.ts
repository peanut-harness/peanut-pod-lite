import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ILumen24EditorRefreshAdapter } from './lumen-24-session.js';

/**
 * @description 使用 Runtime Asset 桥接实现 Creator 2.4 资源刷新。
 */
export class Lumen24RuntimeAssetRefreshAdapter implements ILumen24EditorRefreshAdapter {
    /**
     * @description 单资源刷新函数。
     */
    private readonly _refreshOne: (pathOrUuid: string) => Promise<unknown | null>;

    /**
     * @description 可选 Prefab 写入函数。
     */
    private readonly _writePrefab: ((
        relativePath: string,
        prefab: readonly Record<string, unknown>[],
    ) => Promise<unknown>) | null;

    /**
     * @description 创建 Creator 2.4 Runtime Asset 刷新适配器。
     * @param refreshOne 单资源刷新函数
     * @param writePrefab 可选 Prefab 写入函数
     */
    public constructor(
        refreshOne: (pathOrUuid: string) => Promise<unknown | null>,
        writePrefab?: (relativePath: string, prefab: readonly Record<string, unknown>[]) => Promise<unknown>,
    ) {
        this._refreshOne = refreshOne;
        this._writePrefab = writePrefab ?? null;
    }

    /**
     * @description 刷新资源列表，Prefab 优先通过写入桥同步 AssetDB。
     * @param projectRoot 工程根目录
     * @param relativePaths 项目相对路径列表
     * @returns 刷新结果与逐项详情
     */
    public async refresh(
        projectRoot: string,
        relativePaths: readonly string[],
    ): Promise<{ readonly triggered: boolean; readonly detail?: unknown }> {
        const details: unknown[] = [];
        const refreshTargets = Lumen24RuntimeAssetRefreshAdapter.resolveRefreshTargets(
            projectRoot,
            relativePaths,
        );
        for (const normalized of refreshTargets) {
            if (this._writePrefab != null && normalized.toLowerCase().endsWith('.prefab')) {
                await this._refreshPrefab(projectRoot, normalized, details);
                continue;
            }
            await this._refreshAsset(normalized, details);
        }
        return { triggered: refreshTargets.length > 0, detail: details };
    }

    /**
     * @description 将刷新目标解析为磁盘存在路径，缺失时回落父目录。
     * @param projectRoot 工程根目录
     * @param relativePaths 原始项目相对路径
     * @returns 去重后的可刷新路径
     */
    public static resolveRefreshTargets(
        projectRoot: string,
        relativePaths: readonly string[],
    ): readonly string[] {
        const resolved = new Set<string>();
        for (const relativePath of relativePaths) {
            if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
                continue;
            }
            const normalized = relativePath.replace(/\\/gu, '/').replace(/\/+$/u, '').trim();
            if (normalized.length === 0) {
                continue;
            }
            const absolutePath = join(projectRoot, normalized);
            if (existsSync(absolutePath)) {
                resolved.add(normalized);
                continue;
            }
            const separatorIndex = normalized.lastIndexOf('/');
            if (separatorIndex < 0) {
                continue;
            }
            const parentPath = normalized.slice(0, separatorIndex);
            if (parentPath.length > 0 && existsSync(join(projectRoot, parentPath))) {
                resolved.add(parentPath);
            }
        }
        return [...resolved];
    }

    /**
     * @description 通过写入桥同步一个 Prefab，并记录可诊断结果。
     * @param projectRoot 工程根目录
     * @param relativePath Prefab 项目相对路径
     * @param details 逐项结果集合
     * @returns 无返回值
     */
    private async _refreshPrefab(
        projectRoot: string,
        relativePath: string,
        details: unknown[],
    ): Promise<void> {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            details.push({ path: relativePath, skipped: true, reason: 'prefab_missing_on_disk' });
            return;
        }
        const parsed: unknown = JSON.parse(readFileSync(absolutePath, 'utf8'));
        if (!Array.isArray(parsed) || !parsed.every((entry) => Lumen24RuntimeAssetRefreshAdapter._isRecord(entry))) {
            details.push({ path: relativePath, skipped: true, reason: 'prefab_json_not_array' });
            return;
        }
        try {
            const written = await this._writePrefab?.(relativePath, parsed);
            details.push({ path: relativePath, written });
        } catch (error) {
            details.push({
                path: relativePath,
                skipped: true,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @description 刷新一个普通资源并记录可诊断结果。
     * @param relativePath 项目相对路径
     * @param details 逐项结果集合
     * @returns 无返回值
     */
    private async _refreshAsset(relativePath: string, details: unknown[]): Promise<void> {
        try {
            const refreshed = await this._refreshOne(relativePath);
            details.push({ path: relativePath, refreshed });
        } catch (error) {
            details.push({
                path: relativePath,
                skipped: true,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * @description 判断未知值是否为 Prefab JSON 记录。
     * @param value 未受信值
     * @returns 普通记录返回 `true`
     */
    private static _isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}
