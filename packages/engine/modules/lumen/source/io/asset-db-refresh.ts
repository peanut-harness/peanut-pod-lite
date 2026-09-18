import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { AssetImportPlanner } from '../asset-import/asset-import-planner';
import type { ILumenEditorRefreshAdapter, ILumenEditorRefreshResult, ILumenEditorRefreshSettle, ILumenMessagePort } from '../types';
import { LumenAssetDbReadyWaiter } from './asset-db-ready-waiter';
import { LumenAssetDbRefreshCoalescer } from './asset-db-refresh-coalescer';

/**
 * @description 通过 AssetDB 消息将磁盘上的 lumen 直写对齐进编辑器的适配器。
 *
 * 策略：磁盘已是真源时，已登记资产只 `refresh-asset`（避免 `save-asset` 二次写盘触发
 * Assets 面板 `changed` 竞态报「原资产不存在」）；未登记资产只等待文件监视器发现，
 * 禁止对磁盘已存在但未登记的 URL 调 `create-asset` / `refresh-asset` 触发覆盖确认。
 * 已删除/迁走的文件路径只刷父目录，不对缺失文件 URL 发 refresh（3.8.x Window 竞态）。
 * 全部 AssetDB 同步串行化，降低并发 refresh 打爆面板的概率。
 * 短时间多次 refresh 经 {@link LumenAssetDbRefreshCoalescer} 合并为一次（大批量 commit 友好）。
 */
export class LumenAssetDbEditorRefreshAdapter implements ILumenEditorRefreshAdapter {
    /** @description 全局串行队列，避免并发 refresh/create 打乱 Assets 树。 */
    private static _queue: Promise<void> = Promise.resolve();

    /** @description 宿主 message 端口。 */
    private readonly _message: ILumenMessagePort;
    /** @description AssetDB ready 等待器。 */
    private readonly _readyWaiter: LumenAssetDbReadyWaiter;
    /** @description 刷新前对路径做依赖分层排序。 */
    private readonly _planner: AssetImportPlanner;
    /** @description 短窗合并多次 refresh；null 表示关闭合并。 */
    private readonly _coalescer: LumenAssetDbRefreshCoalescer | null;
    /** @description 合并窗毫秒（0=关闭）。 */
    private readonly _coalesceWindowMs: number;
    /** @description softRequest 吞掉的失败次数（本适配器实例内累计）。 */
    private _softFailureCount = 0;
    /** @description 最近一次 softRequest 失败摘要。 */
    private _lastSoftFailure: string | null = null;

    /**
     * @description 创建适配器。
     * @param message 可调用 `asset-db` 的 message 端口
     * @param coalesceWindowMs 合并窗毫秒；≤0 关闭合并（测试用）。
     */
    public constructor(message: ILumenMessagePort, coalesceWindowMs = 350) {
        this._message = message;
        this._readyWaiter = new LumenAssetDbReadyWaiter(message);
        this._planner = new AssetImportPlanner();
        this._coalesceWindowMs = coalesceWindowMs;
        this._coalescer =
            coalesceWindowMs > 0
                ? new LumenAssetDbRefreshCoalescer(
                      (projectRoot, relativePaths) => this._runExclusive(() => this._refreshUnlocked(projectRoot, relativePaths)),
                      coalesceWindowMs,
                  )
                : null;
    }

    /**
     * @description 对给定相对路径按依赖拓扑排序后逐个请求 AssetDB 刷新；空列表刷新 `db://assets`。
     * 短窗内多次调用会合并路径，只打一轮 AssetDB（`coalesceWindowMs>0` 时）。
     * @param projectRoot 项目根
     * @param relativePaths 相对路径列表
     * @returns 刷新结果
     */
    public async refresh(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshResult> {
        if (this._coalescer == null) {
            return this._runExclusive(() => this._refreshUnlocked(projectRoot, relativePaths));
        }
        const result = await this._coalescer.schedule(projectRoot, relativePaths);
        return result as ILumenEditorRefreshResult;
    }

    /**
     * @description commit 屏障刷新：flush 合并窗 → 立即 refresh → hierarchy settle。
     * @param projectRoot 项目根
     * @param relativePaths 相对路径
     * @returns 刷新 + settle 结果
     */
    public async refreshBarrier(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshResult> {
        if (this._coalescer != null) {
            await this._coalescer.flushNow(projectRoot);
        }
        return this._runExclusive(async () => {
            const refreshed = await this._refreshUnlocked(projectRoot, relativePaths);
            const settle = await this._settleHierarchy(projectRoot, relativePaths);
            if (settle.pending > 0) {
                const pendingPaths = relativePaths
                    .map((pathValue) => this._normalizeRelativePath(pathValue))
                    .filter((relative) => existsSync(join(projectRoot, relative)) && !statSync(join(projectRoot, relative)).isDirectory())
                    .map((relative) => this._toDbUrl(relative));
                throw new Error(`lumen_asset_db_registration_pending:${pendingPaths.join(',')}`);
            }
            return {
                ...refreshed,
                message: `${refreshed.message}|settle:${settle.registered}/${settle.registered + settle.pending}:${settle.waitedMs}ms/budget:${settle.budgetMs}ms${settle.overBudget ? ':overBudget' : ''}`,
                settle,
            };
        });
    }

    /**
     * @description 串行执行 AssetDB 同步工作。
     * @param work 异步工作。
     * @returns 工作结果。
     */
    private async _runExclusive<T>(work: () => Promise<T>): Promise<T> {
        const previous = LumenAssetDbEditorRefreshAdapter._queue;
        let release!: () => void;
        LumenAssetDbEditorRefreshAdapter._queue = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    }

    /**
     * @description 已持有全局队列时执行刷新。
     * @param projectRoot 项目根。
     * @param relativePaths 相对路径列表。
     * @returns 刷新结果。
     */
    private async _refreshUnlocked(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshResult> {
        if (relativePaths.length === 0) {
            // 禁止 refresh-asset `db://assets`：3.8.x Assets 面板会稳定刷
            // `assets/.meta` ENOENT（工程根 assets 无侧车 .meta）。空 paths 视为 no-op。
            return {
                triggered: false,
                message: 'lumen_asset_db_refresh:skipped_assets_root',
            };
        }

        const normalizedPaths = relativePaths.map((pathValue) => this._normalizeRelativePath(pathValue));
        const missingPaths = normalizedPaths.filter((relative) => !existsSync(join(projectRoot, relative)));
        const presentPaths = normalizedPaths.filter((relative) => existsSync(join(projectRoot, relative)));
        if (missingPaths.length > 0 && presentPaths.length > 0) {
            const staleResult = await this._refreshPresentPathsOnly(projectRoot, missingPaths);
            await this._settleAfterStaleReconcile(projectRoot, missingPaths);
            const newResult = await this._refreshPresentPathsOnly(projectRoot, presentPaths);
            const staleMessage = staleResult.message.replace(/^lumen_asset_db_refresh:/u, '');
            const newMessage = newResult.message.replace(/^lumen_asset_db_refresh:/u, '');
            return {
                triggered: staleResult.triggered || newResult.triggered,
                message: `lumen_asset_db_refresh:${[staleMessage, newMessage].filter((entry) => entry.length > 0).join('|')}`,
            };
        }

        return this._refreshPresentPathsOnly(projectRoot, normalizedPaths);
    }

    /**
     * @description 刷新一批磁盘仍存在的路径，或 reconcile 已缺失的陈旧路径。
     * @param projectRoot 项目根。
     * @param relativePaths 相对路径列表。
     * @returns 刷新结果。
     */
    private async _refreshPresentPathsOnly(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshResult> {
        const plan = this._planner.plan(relativePaths);
        if (plan.cycles.length > 0) {
            throw new Error(`asset_import_dependency_cycle:${plan.cycles.join(',')}`);
        }
        const orderedPaths = this._planner.flatten(plan);
        const directoryTargets: string[] = [];
        const fileTargets: string[] = [];
        const reconciledStaleUrls: string[] = [];

        for (const pathValue of orderedPaths) {
            const relative = this._normalizeRelativePath(pathValue);
            const absolute = join(projectRoot, relative);
            if (!existsSync(absolute)) {
                const staleUrl = this._toDbUrl(relative);
                await this._reconcileRelocatedSourceUrl(staleUrl);
                reconciledStaleUrls.push(staleUrl);
                continue;
            }
            if (statSync(absolute).isDirectory()) {
                const dirUrl = this._toDbDirectoryUrl(relative);
                if (!directoryTargets.includes(dirUrl)) {
                    directoryTargets.push(dirUrl);
                }
                continue;
            }
            // 刷文件前先登记祖先目录，避免新建目录只 mkdir、Assets 面板空壳无子节点。
            for (const ancestorUrl of this._ancestorDirectoryUrls(relative)) {
                if (!directoryTargets.includes(ancestorUrl)) {
                    directoryTargets.push(ancestorUrl);
                }
            }
            const fileUrl = this._toDbUrl(relative);
            if (!fileTargets.includes(fileUrl)) {
                fileTargets.push(fileUrl);
            }
        }

        if (reconciledStaleUrls.length > 0) {
            await this._settleAfterStaleReconcile(
                projectRoot,
                reconciledStaleUrls.map((dbUrl) => dbUrl.replace(/^db:\/\//u, '')),
            );
        }

        directoryTargets.sort((left, right) => left.split('/').length - right.split('/').length);
        const explicitlyRequestedDirectories = new Set(
            relativePaths
                .map((pathValue) => this._normalizeRelativePath(pathValue))
                .filter((relative) => {
                    const absolute = join(projectRoot, relative);
                    return existsSync(absolute) && statSync(absolute).isDirectory();
                })
                .map((relative) => this._toDbDirectoryUrl(relative)),
        );
        for (const dirUrl of directoryTargets) {
            await this._syncDirectoryWithAssetDb(projectRoot, dirUrl, {
                forceRefresh: explicitlyRequestedDirectories.has(dirUrl),
            });
        }

        for (const fileUrl of fileTargets.sort()) {
            await this._syncFileAssetWithAssetDb(projectRoot, fileUrl);
        }

        await this._waitAssetDbReady();
        const targets = [...reconciledStaleUrls, ...directoryTargets, ...fileTargets];
        const softSuffix =
            this._softFailureCount > 0
                ? `|softFail:${this._softFailureCount}${this._lastSoftFailure != null ? `:${this._lastSoftFailure}` : ''}`
                : '';
        return {
            triggered: true,
            message: `lumen_asset_db_refresh:${targets.join(',')}${softSuffix}`,
        };
    }

    /**
     * @description 将磁盘上的文本资产对齐进 AssetDB（磁盘为真源，避免 save-asset 二次写）。
     * @param projectRoot 项目根。
     * @param dbUrl 文件 db URL。
     * @returns 无返回值。
     */
    private async _syncFileAssetWithAssetDb(projectRoot: string, dbUrl: string): Promise<void> {
        const relativePath = dbUrl.replace(/^db:\/\//u, '');
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath) || statSync(absolutePath).isDirectory()) {
            return;
        }

        let existing = await this._queryAssetInfo(dbUrl);
        if (existing == null) {
            if (this._hasSidecarMeta(projectRoot, relativePath)) {
                await this._waitUntilAssetRegistered(dbUrl, 10000);
                await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
                return;
            }

            const parent = this._parentDbDirectory(dbUrl);
            if (parent != null && !(await this._waitUntilDirectoryRegistered(parent, 3000))) {
                await this._waitAssetDbReady(400);
                return;
            }
            existing = await this._queryAssetInfo(dbUrl);
        }

        if (existing == null) {
            await this._waitUntilAssetRegistered(dbUrl, 10000);
            await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
            return;
        }

        // 已登记图片/音频：磁盘已对齐，禁止 refresh-asset（子资源 Window 竞态）。
        if (
            this._isBinaryDiskAsset(relativePath) &&
            this._sidecarMetaImported(projectRoot, relativePath) &&
            !this._assetDbPathMatchesDisk(existing, dbUrl)
        ) {
            // 静默 rename 后 uuid 仍在、路径未跟上：等监视器，禁止 refresh-asset（会打爆子资源 Window）。
            await this._waitUntilAssetPathMatches(dbUrl, 8000);
            await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
            return;
        }

        if (this._isBinaryDiskAsset(relativePath) && this._sidecarMetaImported(projectRoot, relativePath)) {
            await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
            return;
        }

        // 已登记脚本/文本：内容写盘即可，Creator 监视器会热更；
        // 再 refresh-asset 会稳定触发 Assets 面板 Window「原资产不存在」。
        if (this._isTextDiskAsset(relativePath)) {
            await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
            return;
        }

        await this._softRequest('refresh-asset', dbUrl);
        await this._settleAfterFileSync(projectRoot, relativePath, dbUrl);
    }

    /**
     * @description 将磁盘上的文件夹对齐进 AssetDB；不对目录路径走 create-asset / readFileSync。
     * @param projectRoot 项目根。
     * @param dbUrl 以 `/` 结尾的目录 db URL。
     * @param options.forceRefresh 显式刷新该目录时才对已登记目录发 refresh-asset；祖先连带发现默认不刷，避免 3.8.x Window。
     * @returns 无返回值。
     */
    private async _syncDirectoryWithAssetDb(projectRoot: string, dbUrl: string, options: { forceRefresh?: boolean } = {}): Promise<void> {
        const relative = dbUrl.replace(/^db:\/\//u, '').replace(/\/+$/, '');
        const absolutePath = join(projectRoot, relative);
        const metaPath = `${absolutePath}.meta`;
        if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
            return;
        }

        let existing = await this._queryDirectoryAssetInfo(dbUrl);
        if (existing == null) {
            // 未登记目录完全交给 Creator 文件监视器发现。刷新已登记父目录仍会向尚未入树的
            // 子目录发送 changed，3.8.x Assets 面板因此报「original asset is not exist」。
            await this._waitUntilDirectoryRegistered(dbUrl, 3000);
            existing = await this._queryDirectoryAssetInfo(dbUrl);
            if (existing == null) {
                // 仍未入库：保留磁盘真相，不再对子 URL 发 changed 类消息。
                if (!existsSync(metaPath)) {
                    return;
                }
                await this._waitAssetDbReady(400);
                return;
            }
            // 刚发现入库时 Assets 面板仍可能尚未消费 added 事件，本轮一律不再 force refresh。
            await this._waitAssetDbReady(600);
            return;
        }

        if (options.forceRefresh !== true) {
            // 已登记且只是文件刷新的祖先：禁止再 refresh-asset。
            // 实测静默 rename 后刷父目录会稳定触发 Window「原资产不存在」。
            return;
        }

        // 显式刷新已登记目录（如 createFolder 目标）。
        await this._softRequest('refresh-asset', dbUrl);
        await this._waitAssetDbReady(200);
    }

    /**
     * @description 静默 rename/move 后：磁盘路径已迁走但 AssetDB 仍登记旧 URL 时，尽力摘除陈旧索引。
     * @param dbUrl 已不存在的源文件 db URL。
     * @returns 无返回值。
     */
    private async _reconcileRelocatedSourceUrl(dbUrl: string): Promise<void> {
        if ((await this._queryAssetInfo(dbUrl)) == null) {
            return;
        }
        try {
            await this._message.request('asset-db', 'delete-asset', dbUrl);
        } catch {
            // 部分宿主对「盘无库有」会拒绝 delete；等待自然过期。
        }
        await this._waitUntilAssetPathAbsent(dbUrl, 6000);
    }

    /**
     * @description 等待 AssetDB 不再登记指定 db URL（静默 rename/move 后旧路径应消失）。
     * @param dbUrl 文件 db URL。
     * @param timeoutMs 最长等待毫秒。
     * @returns 无返回值。
     */
    private async _waitUntilAssetPathAbsent(dbUrl: string, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const existing = await this._queryAssetInfo(dbUrl);
            if (existing == null) {
                return;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 80);
            });
        }
    }

    /**
     * @description 等待 AssetDB 快照路径与磁盘 db URL 对齐（静默 rename 后 uuid 仍在、url 滞后）。
     * @param dbUrl 期望的文件 db URL。
     * @param timeoutMs 最长等待毫秒。
     * @returns 无返回值。
     */
    private async _waitUntilAssetPathMatches(dbUrl: string, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const existing = await this._queryAssetInfo(dbUrl);
            if (existing != null && this._assetDbPathMatchesDisk(existing, dbUrl)) {
                return;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 100);
            });
        }
    }

    /**
     * @description 等待 AssetDB 登记指定 db URL（新 copy / import 的子资源就绪前不要继续 rename）。
     * @param dbUrl 文件 db URL。
     * @param timeoutMs 最长等待毫秒。
     * @returns 无返回值。
     */
    private async _waitUntilAssetRegistered(dbUrl: string, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const existing = await this._queryAssetInfo(dbUrl);
            if (existing != null) {
                return;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 80);
            });
        }
    }

    /**
     * @description 等待目录 URL 被 AssetDB 登记，同时兼容带与不带尾斜杠的查询形态。
     * @param dbUrl 目录 db URL。
     * @param timeoutMs 最长等待毫秒。
     * @returns 是否在时限内登记。
     */
    private async _waitUntilDirectoryRegistered(dbUrl: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ((await this._queryDirectoryAssetInfo(dbUrl)) != null) {
                return true;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 80);
            });
        }
        return false;
    }

    /**
     * @description 文件 refresh / create 后等待 Import 与子资源登记，降低 3.8.x Window 子资源竞态日志。
     * @param projectRoot 项目根。
     * @param relativePath 项目相对路径。
     * @param dbUrl 文件 db URL。
     * @returns 无返回值。
     */
    private async _settleAfterFileSync(projectRoot: string, relativePath: string, dbUrl: string): Promise<void> {
        const metaPath = `${join(projectRoot, relativePath)}.meta`;
        if (!existsSync(metaPath)) {
            await this._waitAssetDbReady(400);
            return;
        }
        let importer = '';
        try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { importer?: string };
            importer = typeof meta.importer === 'string' ? meta.importer : '';
        } catch {
            await this._waitAssetDbReady(400);
            return;
        }
        if (importer === 'image' || importer === 'auto-atlas') {
            await this._waitUntilAssetRegistered(dbUrl, 6000);
            await this._waitUntilImageSubAssetsReady(dbUrl, 10000);
            await this._waitAssetDbReady(2500);
            return;
        }
        await this._waitAssetDbReady(600);
    }

    /**
     * @description 等待 PNG 等图片资源的 texture / spriteFrame 子资源登记完成。
     * @param dbUrl 主资源 db URL。
     * @param timeoutMs 最长等待毫秒。
     * @returns 无返回值。
     */
    private async _waitUntilImageSubAssetsReady(dbUrl: string, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const info = await this._queryAssetInfo(dbUrl);
            if (info != null && this._readSpriteFrameUuid(info) != null) {
                return;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 100);
            });
        }
    }

    /**
     * @description 从 AssetDB 快照读取 SpriteFrame 子资源 UUID。
     * @param value query-asset-info 返回值。
     * @returns SpriteFrame UUID 或 null。
     */
    private _readSpriteFrameUuid(value: unknown): string | null {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.spriteFrameUuid === 'string' && record.spriteFrameUuid.length > 0) {
            return record.spriteFrameUuid;
        }
        for (const collectionKey of ['subMetas', 'subAssets'] as const) {
            const collection = record[collectionKey];
            if (typeof collection !== 'object' || collection == null || Array.isArray(collection)) {
                continue;
            }
            for (const [key, item] of Object.entries(collection as Record<string, unknown>)) {
                const uuid = this._readAssetUuid(item);
                if (uuid != null && uuid.includes('@f9941')) {
                    return uuid;
                }
                if (key.toLowerCase().includes('spriteframe')) {
                    const resolved = this._readAssetUuid(item);
                    if (resolved != null) {
                        return resolved;
                    }
                }
            }
        }
        return this._readSpriteFrameUuid(record.asset);
    }

    /**
     * @description 读取 AssetDB 快照中的 uuid 字段。
     * @param value 快照对象。
     * @returns uuid 或 null。
     */
    private _readAssetUuid(value: unknown): string | null {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.uuid === 'string' && record.uuid.length > 0) {
            return record.uuid;
        }
        return this._readAssetUuid(record.asset);
    }

    /**
     * @description 陈旧 URL reconcile 后等待 AssetDB 稳定（图片 rename/move 子资源竞态）。
     * @param projectRoot 项目根。
     * @param relativePaths 已从磁盘消失的路径。
     * @returns 无返回值。
     */
    private async _settleAfterStaleReconcile(projectRoot: string, relativePaths: readonly string[]): Promise<void> {
        void projectRoot;
        let includesImage = false;
        for (const relativePath of relativePaths) {
            if (this._isBinaryDiskAsset(relativePath) && /\.(png|jpe?g|webp|pac)$/iu.test(relativePath)) {
                includesImage = true;
            }
            await this._waitUntilAssetPathAbsent(this._toDbUrl(relativePath), 8000);
        }
        await this._waitAssetDbReady(includesImage ? 1500 : 600);
    }

    /**
     * @description 判断 AssetDB 快照是否仍登记在指定 db URL（静默 rename 后 uuid 在、路径错）。
     * @param value query-asset-info 返回值。
     * @param dbUrl 期望的文件 db URL。
     * @returns 路径是否一致。
     */
    private _assetDbPathMatchesDisk(value: unknown, dbUrl: string): boolean {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            return false;
        }
        const record = value as Record<string, unknown>;
        const candidates = [record.url, record.path, record.file];
        for (const candidate of candidates) {
            if (typeof candidate !== 'string' || candidate.trim().length === 0) {
                continue;
            }
            const normalized = candidate.replace(/\\/g, '/').trim();
            if (normalized === dbUrl || normalized === `${dbUrl}/`) {
                return true;
            }
            if (normalized.endsWith(dbUrl.replace(/^db:\/\//u, ''))) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description 读取 sidecar `.meta` 的 `imported` 标记（rename 后已导入图片跳过 refresh-asset）。
     * @param projectRoot 项目根。
     * @param relativePath 项目相对路径。
     * @returns 是否已导入。
     */
    private _sidecarMetaImported(projectRoot: string, relativePath: string): boolean {
        const metaPath = `${join(projectRoot, relativePath)}.meta`;
        if (!existsSync(metaPath)) {
            return false;
        }
        try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { imported?: boolean };
            return meta.imported === true;
        } catch {
            return false;
        }
    }

    /**
     * @description 判断磁盘资产是否已有 Creator sidecar `.meta`，用于区分监视器登记与主动创建路径。
     * @param projectRoot 项目根。
     * @param relativePath 项目相对路径。
     * @returns 是否存在 sidecar。
     */
    private _hasSidecarMeta(projectRoot: string, relativePath: string): boolean {
        return existsSync(`${join(projectRoot, relativePath)}.meta`);
    }

    /**
     * @description 判断路径是否为带 sidecar meta 的二进制资源（禁止 utf8 create-asset）。
     * @param relativePath 项目相对路径。
     * @returns 是否二进制 sidecar 资源。
     */
    private _isBinaryDiskAsset(relativePath: string): boolean {
        return /\.(png|jpe?g|webp|bmp|tga|gif|psd|pac|mp3|ogg|wav|ttf|otf|bin|atlas)$/iu.test(relativePath);
    }

    /**
     * @description 判断是否为脚本/文本/Creator 序列化资产（已登记时禁止 refresh-asset）。
     *
     * Prefab/Scene/Material 等与 `.ts` 一样：磁盘写后靠监视器热更；再 `refresh-asset`
     * 会稳定触发 Assets 面板 Window「原资产不存在」。
     * @param relativePath 项目相对路径。
     * @returns 是否文本/序列化磁盘资源。
     */
    private _isTextDiskAsset(relativePath: string): boolean {
        return /\.(tsx?|jsx?|mts|cts|mjs|cjs|md|txt|json|jsonc|prefab|scene|mtl|material|anim|effect|pmtl|fire)$/iu.test(
            relativePath,
        );
    }

    /**
     * @description 查询 AssetDB 是否已登记指定资源。
     * @param dbUrl 文件 db URL。
     * @returns 资源信息或 null。
     */
    private async _queryAssetInfo(dbUrl: string): Promise<unknown | null> {
        try {
            return await this._message.request('asset-db', 'query-asset-info', dbUrl);
        } catch {
            return null;
        }
    }

    /**
     * @description 查询目录 AssetDB 信息，兼容 Creator 对目录尾斜杠的差异。
     * @param dbUrl 目录 db URL。
     * @returns 目录信息或 null。
     */
    private async _queryDirectoryAssetInfo(dbUrl: string): Promise<unknown | null> {
        const withSlash = dbUrl.endsWith('/') ? dbUrl : `${dbUrl}/`;
        const direct = await this._queryAssetInfo(withSlash);
        if (direct != null) {
            return direct;
        }
        return this._queryAssetInfo(withSlash.replace(/\/+$/u, ''));
    }

    /**
     * @description commit 后等待 AssetDB 登记齐 + ready，降低立刻 preview 的面板竞态。
     * @param projectRoot 项目根
     * @param relativePaths 本次提交路径
     * @returns settle 摘要
     */
    private async _settleHierarchy(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshSettle> {
        const started = Date.now();
        const fileUrls = relativePaths
            .map((pathValue) => this._normalizeRelativePath(pathValue))
            .filter((relative) => {
                const absolute = join(projectRoot, relative);
                return existsSync(absolute) && !statSync(absolute).isDirectory();
            })
            .map((relative) => this._toDbUrl(relative));
        const uniqueUrls = [...new Set(fileUrls)];
        const perUrlTimeoutMs = Math.min(4000, Math.max(1200, Math.floor(8000 / Math.max(1, uniqueUrls.length))));
        const envBudget = Number(process.env.LUMEN_SETTLE_BUDGET_MS);
        const budgetMs =
            Number.isFinite(envBudget) && envBudget > 0
                ? Math.floor(envBudget)
                : Math.min(12_000, Math.max(2_000, 1_200 + uniqueUrls.length * perUrlTimeoutMs + 800));
        const outcomes = await Promise.all(
            uniqueUrls.map(async (dbUrl): Promise<'registered' | 'pending'> => {
                const before = await this._queryAssetInfo(dbUrl);
                if (before != null) {
                    return 'registered';
                }
                await this._waitUntilAssetRegistered(dbUrl, perUrlTimeoutMs);
                const after = await this._queryAssetInfo(dbUrl);
                return after != null ? 'registered' : 'pending';
            }),
        );
        const registered = outcomes.filter((entry) => entry === 'registered').length;
        const pending = outcomes.filter((entry) => entry === 'pending').length;
        await this._waitAssetDbReady(Math.min(1500, 400 + uniqueUrls.length * 20));
        const ready = await this._waitReadyQuietWindow(
            Math.min(400, 120 + Math.min(uniqueUrls.length, 24) * 8),
        );
        const waitedMs = Date.now() - started;
        return {
            waitedMs,
            budgetMs,
            overBudget: waitedMs > budgetMs,
            registered,
            pending,
            ready,
            softFailCount: this._softFailureCount,
        };
    }

    /**
     * @description 事件驱动静默窗：连续两次 query-ready=true 即退出，否则直到超时。
     * @param maxQuietMs 最长静默毫秒
     * @returns 退出时是否 ready
     */
    private async _waitReadyQuietWindow(maxQuietMs: number): Promise<boolean> {
        const deadline = Date.now() + Math.max(0, maxQuietMs);
        let consecutiveReady = 0;
        let ready = false;
        while (Date.now() <= deadline) {
            try {
                ready = (await this._message.request('asset-db', 'query-ready')) === true;
            } catch {
                ready = false;
            }
            if (ready) {
                consecutiveReady += 1;
                if (consecutiveReady >= 2) {
                    return true;
                }
            } else {
                consecutiveReady = 0;
            }
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 40);
            });
        }
        try {
            return (await this._message.request('asset-db', 'query-ready')) === true;
        } catch {
            return false;
        }
    }

    /**
     * @description 软调用 AssetDB 消息，吞掉「原资产不存在」类瞬时错误（计入可观测计数）。
     * @param messageName 消息名。
     * @param dbUrl 目标 URL。
     * @returns 无返回值。
     */
    private async _softRequest(messageName: string, dbUrl: string): Promise<void> {
        if (messageName === 'refresh-asset' && this._isAssetsRootDbUrl(dbUrl)) {
            return;
        }
        try {
            await this._message.request('asset-db', messageName, dbUrl);
        } catch (error) {
            this._softFailureCount += 1;
            const detail = error instanceof Error ? error.message : String(error);
            this._lastSoftFailure = `${messageName}:${dbUrl}:${detail.slice(0, 160)}`;
        }
    }

    /**
     * @description 等待 AssetDB ready（委托 {@link LumenAssetDbReadyWaiter}）。
     * @param timeoutMs 最长等待毫秒。
     * @returns 无返回值。
     */
    private async _waitAssetDbReady(timeoutMs: number = 1500): Promise<void> {
        await this._readyWaiter.wait({ timeoutMs });
    }

    /**
     * @description 规范化为项目相对路径（无 `db://` 前缀）。
     * @param relativePath 相对路径或 db URL
     * @returns 项目相对路径
     */
    private _normalizeRelativePath(relativePath: string): string {
        const dbUrl = this._toDbUrl(relativePath);
        return dbUrl.replace(/^db:\/\//u, '');
    }

    /**
     * @description 列出文件相对路径下、位于 `assets/` 内的祖先目录 db URL（浅→深）。
     * @param relativeFilePath 文件相对路径。
     * @returns 目录 URL 列表（以 `/` 结尾）。
     */
    private _ancestorDirectoryUrls(relativeFilePath: string): string[] {
        const normalized = this._normalizeRelativePath(relativeFilePath).replace(/\/+$/, '');
        const parts = normalized.split('/').filter((part) => part.length > 0);
        if (parts.length < 2 || parts[0] !== 'assets') {
            return [];
        }
        const urls: string[] = [];
        // assets 本身通常已登记；从 assets/<seg> 起补到文件父目录。
        for (let index = 1; index < parts.length - 1; index += 1) {
            const ancestor = parts.slice(0, index + 1).join('/');
            urls.push(this._toDbDirectoryUrl(ancestor));
        }
        return urls;
    }

    /**
     * @description 目录 db URL（Creator 目录 refresh 以 `/` 结尾）。
     * @param relativePath 相对路径或 db URL
     * @returns 目录 db URL
     */
    private _toDbDirectoryUrl(relativePath: string): string {
        const dbUrl = this._toDbUrl(relativePath).replace(/\/+$/, '');
        return `${dbUrl}/`;
    }

    /**
     * @description 取 db URL 的父目录（目录自身返回 null）。
     * @param dbUrl `db://assets/...`
     * @returns 父目录或以 `/` 结尾的目录 URL
     */
    private _parentDbDirectory(dbUrl: string): string | null {
        const normalized = dbUrl.replace(/\\/g, '/').replace(/\/+$/, '');
        const slash = normalized.lastIndexOf('/');
        if (slash <= 'db://assets'.length) {
            return 'db://assets';
        }
        return `${normalized.slice(0, slash)}/`;
    }

    /**
     * @description 是否为工程 assets 根 URL（禁止对其 refresh-asset）。
     * @param dbUrl db URL
     * @returns 是否 assets 根
     */
    private _isAssetsRootDbUrl(dbUrl: string): boolean {
        const normalized = dbUrl.replace(/\\/g, '/').replace(/\/+$/, '');
        return normalized === 'db://assets';
    }

    /**
     * @description 将项目相对路径转为 `db://` URL。
     * @param relativePath 相对路径
     * @returns db URL
     */
    private _toDbUrl(relativePath: string): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
        if (normalized.startsWith('db://')) {
            return normalized;
        }
        if (normalized.startsWith('assets/') || normalized === 'assets') {
            return `db://${normalized}`;
        }
        return `db://assets/${normalized.replace(/^\/+/, '')}`;
    }
}
