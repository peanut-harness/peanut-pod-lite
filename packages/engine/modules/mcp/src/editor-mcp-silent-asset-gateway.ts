/**
 * @description 静默资产生命周期与 import / waitReady 编排（从 action-router peel）。
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
    ContractPayload,
    IAssetCopyMcpInput,
    IAssetCreateFolderMcpInput,
    IAssetDeleteMcpInput,
    IAssetImportMcpInput,
    IAssetImportPlanMcpInput,
    IAssetManagedStatusMcpInput,
    IAssetMoveMcpInput,
    IAssetQueryDependenciesMcpInput,
    IAssetReplaceReferencesMcpInput,
    IAssetReimportMcpInput,
    IAssetRenameMcpInput,
    IAssetWaitReadyMcpInput,
    IAssetWriteTextMcpInput,
} from '@peanut/pod-protocol';
import { CompatibleUuid } from '@peanut/pod-engine/assets';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';
import {
    FileAssetDependencyIndex,
    SilentAssetClosureCopy,
    SilentAssetCreateFolder,
    SilentAssetDelete,
    SilentAssetMoveRename,
    SilentAssetPathGuard,
    SilentAssetReferenceReplace,
    type ISilentAssetClosureCopyItem,
} from '@peanut/pod-engine/assets';
import {
    AssetImportBatchExecutor,
    AssetImportPlanner,
    EnsureSpriteFramesBatchService,
    LumenAssetDbReadyWaiter,
    LumenResourceWriteLock,
    ManagedAssetLedger,
    normalizeResourceDirectoryLockKey,
    normalizeResourceLockKey,
} from '@peanut/pod-engine/lumen';
import { McpControlFlowRefusal } from '@peanut/pod-engine/kernel';
import { ProjectLogPostflightMonitor } from '@peanut/pod-engine/runtime';

import { Lumen24McpBridge } from './editor-mcp-lumen-24-bridge.js';
import type { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';
import type { EditorMcpLumenGateway } from './editor-mcp-lumen-gateway.js';

/**
 * @description silent-asset gateway 宿主依赖。
 */
export interface IEditorMcpSilentAssetHost {
    /** @description 当前工程根。 */
    readonly requireProjectPath: () => Promise<string>;
    /** @description lumen 网关。 */
    readonly lumen: EditorMcpLumenGateway;
    /** @description 授权 runtime。 */
    readonly runtime: IGrantedRuntimeClientSet;
    /**
     * @description AssetDB 原子登记事务。
     */
    readonly assetDbTransaction: EditorMcpAssetDbTransaction;
    /** @description 普通对象判定。 */
    readonly isRecord: (value: unknown) => value is Record<string, unknown>;
}

/**
 * @description 静默资产 / import / waitReady 执行面。
 */
export class EditorMcpSilentAssetGateway {
    /** @description 宿主依赖。 */
    private readonly _host: IEditorMcpSilentAssetHost;

    /**
     * @description 创建 gateway。
     * @param host 宿主依赖
     */
    public constructor(host: IEditorMcpSilentAssetHost) {
        this._host = host;
    }


    /**
     * @description create/write/rename 后统一走 commit 级 AssetDB barrier（flush coalesce + refresh + hierarchy settle），
     * 避免 Creator 未登记完就改路径触发 Window「original asset is not exist」。
     * @param paths 相对路径列表。
     * @returns barrier 刷新结果。
     */
    private async _awaitAssetDbRefreshBarrier(paths: readonly string[]): Promise<unknown> {
        return this._host.lumen.refreshForCommit(paths);
    }


    /**
     * @description 新建目录/资源登记等待：只 waitReady + 短 settle，不对新建目录 force refresh-asset。
     * 3.8.x 对刚 create 的目录 refresh-asset 会稳定刷 Window「original asset is not exist」。
     * @param paths 新建相对路径。
     * @returns ready 等待结果。
     */
    private async _awaitNewAssetReadyWithoutForceRefresh(paths: readonly string[]): Promise<unknown> {
        const ready =
            this._host.runtime.message == null
                ? {
                      ready: true,
                      polls: 0,
                      waitedMs: 0,
                      status: 'unsupported',
                      message: 'editor_mcp_asset_wait_ready_no_message_port',
                  }
                : await new LumenAssetDbReadyWaiter(this._host.runtime.message).wait({
                      timeoutMs: 8000,
                      throwOnTimeout: false,
                  });
        // Give Assets panel a beat to ingest watcher events without refresh-asset.
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 600);
        });
        return {
            phase: 'new_asset_ready_without_force_refresh',
            paths: [...paths],
            ready,
            skippedForceRefresh: true,
        };
    }

    /**
     * @description 静默把资产依赖闭包复制到目标目录（磁盘为真源，换新 uuid，不弹 AssetDB 覆盖确认），随后刷新受影响路径。
     * @param input 未校验输入。
     * @returns 复制结果，附带刷新回执。
     */
    public async _executeAssetCopy(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetCopyInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const lockKey = normalizeResourceDirectoryLockKey(request.targetDirectory);
        return LumenResourceWriteLock.shared().runExclusive(lockKey, async () => {
            const result = new SilentAssetClosureCopy().copy({
                projectRoot,
                seedRelativePaths: request.paths,
                targetDirectoryRelative: request.targetDirectory,
            });
            FileAssetDependencyIndex.invalidate(projectRoot);
            const copiedPaths = [...new Set(result.items.map((item: ISilentAssetClosureCopyItem) => item.toPath))];
            const dirReady = await this._awaitNewAssetReadyWithoutForceRefresh([request.targetDirectory]);
            const transaction = await this._host.assetDbTransaction.commit(copiedPaths);
            return { ...result, dirReady, refresh: transaction.refresh, transaction };
        });
    }

    /**
     * @description 解析 asset.copy 输入。
     * @param input 未校验输入。
     * @returns 已校验的复制输入。
     */
    public _readAssetCopyInput(input: ContractPayload | undefined): IAssetCopyMcpInput {
        if (input == null || !this._host.isRecord(input) || !Array.isArray(input.paths)) {
            throw new Error('editor_mcp_asset_copy_paths_required');
        }
        const paths = input.paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (paths.length === 0) {
            throw new Error('editor_mcp_asset_copy_paths_required');
        }
        if (typeof input.targetDirectory !== 'string' || input.targetDirectory.trim().length === 0) {
            throw new Error('editor_mcp_asset_copy_targetDirectory_required');
        }
        return { paths, targetDirectory: input.targetDirectory.trim() };
    }

    /**
     * @description 静默移动文件/文件夹（保留 uuid），随后刷新受影响路径。
     * @param input 未校验输入。
     * @returns 移动结果，附带刷新回执。
     */
    public async _executeAssetMove(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetMoveInput(input);
        return this._executeSilentMoveOrRename(request.from, request.to);
    }

    /**
     * @description 解析 asset.move 输入。
     * @param input 未校验输入。
     * @returns 已校验的移动输入。
     */
    public _readAssetMoveInput(input: ContractPayload | undefined): IAssetMoveMcpInput {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('editor_mcp_asset_move_input_required');
        }
        const from = typeof input.from === 'string' ? input.from.trim() : '';
        const to = typeof input.to === 'string' ? input.to.trim() : '';
        if (from.length === 0) {
            throw new Error('editor_mcp_asset_move_from_required');
        }
        if (to.length === 0) {
            throw new Error('editor_mcp_asset_move_to_required');
        }
        return { from, to };
    }

    /**
     * @description 静默原地重命名文件/文件夹（保留 uuid），随后刷新受影响路径。
     * @param input 未校验输入。
     * @returns 重命名结果，附带刷新回执。
     */
    public async _executeAssetRename(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetRenameInput(input);
        const to = this._composeRenameTarget(request.path, request.newName);
        return this._executeSilentMoveOrRename(request.path, to);
    }

    /**
     * @description 解析 asset.rename 输入。
     * @param input 未校验输入。
     * @returns 已校验的重命名输入。
     */
    public _readAssetRenameInput(input: ContractPayload | undefined): IAssetRenameMcpInput {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('editor_mcp_asset_rename_input_required');
        }
        const path = typeof input.path === 'string' ? input.path.trim() : '';
        const newName = typeof input.newName === 'string' ? input.newName.trim() : '';
        if (path.length === 0) {
            throw new Error('editor_mcp_asset_rename_path_required');
        }
        if (newName.length === 0 || newName.includes('/') || newName.includes('\\')) {
            throw new Error('editor_mcp_asset_rename_newName_invalid');
        }
        return { path, newName };
    }

    /**
     * @description 由原相对路径与新名拼出同目录目标相对路径。
     * @param relativePath 原相对路径。
     * @param newName 新文件/文件夹名（不含路径分隔符）。
     * @returns 目标相对路径。
     */
    private _composeRenameTarget(relativePath: string, newName: string): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
        const slash = normalized.lastIndexOf('/');
        const parentDirectory = slash >= 0 ? normalized.slice(0, slash) : '';
        return parentDirectory.length > 0 ? `${parentDirectory}/${newName}` : newName;
    }

    /**
     * @description 移动/重命名后刷新：只刷目标文件与必要时源父目录（不刷已消失的源文件路径）。
     * @param fromRelativePath 源相对路径。
     * @param toRelativePath 目标相对路径。
     * @returns 待 refresh 的相对路径列表。
     */
    /**
     * @description 静默移动/重命名后对齐 AssetDB。
     *
     * 3.8.x 实测：磁盘 rename 本身不产生 Window 错误；随后立刻 `lumen.refresh` /
     * `refresh-asset`（尤其刷父目录）会稳定触发 Assets 面板
     * 「Can not change the asset … original asset is not exist」。
     * 因此优先等待 Creator 文件监视器自然对齐；仅当超时后新路径仍未登记时，
     * 才对**目标文件**做一次 refresh（不再先刷陈旧源路径）。
     * @param fromRelativePath 源相对路径。
     * @param toRelativePath 目标相对路径。
     * @returns 刷新回执。
     */
    private async _refreshAfterSilentMoveOrRename(fromRelativePath: string, toRelativePath: string): Promise<unknown> {
        if (fromRelativePath === toRelativePath) {
            return this._awaitNewAssetReadyWithoutForceRefresh([fromRelativePath]);
        }
        // 3.8.x：磁盘 rename/move 本身通常不刷 Window；随后立刻 refresh-asset 才会
        // 稳定触发「original asset is not exist」。统一走 watcher settle + waitReady，
        // 图片与文本同源策略（禁止 post-rename force refresh-asset）。
        const waitMs = this._isImageSidecarAsset(toRelativePath) ? 4500 : 2200;
        await new Promise<void>((resolve) => {
            setTimeout(resolve, waitMs);
        });
        const ready =
            this._host.runtime.message == null
                ? null
                : await new LumenAssetDbReadyWaiter(this._host.runtime.message).wait({
                      timeoutMs: 4000,
                      throwOnTimeout: false,
                  });
        return {
            phase: 'watcher_settle_skip_refresh',
            waitedMs: waitMs,
            from: fromRelativePath,
            to: toRelativePath,
            triggered: false,
            ready,
            next: 'rename/move settled via Creator watcher + AssetDB ready; skipped refresh-asset to avoid Window original-asset race',
        };
    }


    private _isImageSidecarAsset(relativePath: string): boolean {
        return /\.(png|jpe?g|webp|bmp|tga|gif|psd|pac)$/iu.test(relativePath.replace(/\\/g, '/').trim());
    }

    /**
     * @description 删除后刷新：只刷各被删资源的父目录（不刷已消失的路径本身）。
     * @param relativePaths 已删除的相对路径列表。
     * @returns 待 refresh 的相对路径列表。
     */
    private _lifecycleRefreshPathsAfterDelete(relativePaths: readonly string[]): readonly string[] {
        return [
            ...new Set(relativePaths.map((pathValue) => this._parentAssetDirectory(pathValue)).filter((pathValue) => pathValue.length > 0)),
        ];
    }

    /**
     * @description 取资源路径的父目录相对路径。
     * @param relativePath 文件或文件夹相对路径。
     * @returns 父目录相对路径；无父级时为空串。
     */
    private _parentAssetDirectory(relativePath: string): string {
        const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/, '');
        const slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.slice(0, slash) : '';
    }

    /**
     * @description 执行静默移动/重命名磁盘操作，并刷新源、目标两端路径。
     * @param fromRelativePath 源相对路径。
     * @param toRelativePath 目标相对路径。
     * @returns 移动/重命名结果，附带刷新回执。
     */
    private async _executeSilentMoveOrRename(fromRelativePath: string, toRelativePath: string): Promise<unknown> {
        const projectRoot = await this._host.requireProjectPath();
        const lockKeys = [
            normalizeResourceLockKey(fromRelativePath),
            normalizeResourceDirectoryLockKey(fromRelativePath),
            normalizeResourceDirectoryLockKey(toRelativePath),
        ];
        return LumenResourceWriteLock.shared().runExclusiveMany(lockKeys, async () => {
            // create → AssetDB ready → then rename/move. Do NOT refresh-asset here:
            // pre-move force refresh + disk rename still races Assets panel on 3.8.x.
            await this._awaitNewAssetReadyWithoutForceRefresh([fromRelativePath]);
            const result = new SilentAssetMoveRename().moveOrRename({
                projectRoot,
                fromRelativePath,
                toRelativePath,
            });
            FileAssetDependencyIndex.invalidate(projectRoot);
            const refresh = await this._refreshAfterSilentMoveOrRename(result.fromPath, result.toPath);
            const transaction = await this._host.assetDbTransaction.commit([result.toPath], { refresh: false });
            return { ...result, refresh, transaction };
        });
    }

    /**
     * @description 静默创建资源文件夹（含缺失的中间目录 .meta），随后刷新目标路径。
     * @param input 未校验输入。
     * @returns 建目录结果，附带刷新回执。
     */
    public async _executeAssetCreateFolder(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetCreateFolderInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const lockKey = normalizeResourceDirectoryLockKey(request.path);
        return LumenResourceWriteLock.shared().runExclusive(lockKey, async () => {
            if (Lumen24McpBridge.isCreator2x()) {
                const created = await Lumen24McpBridge.createFolder(projectRoot, request.path);
                const refresh = await this._awaitNewAssetReadyWithoutForceRefresh([created.path]);
                const transaction = await this._host.assetDbTransaction.commit([created.path], { refresh: false });
                return { ...created, refresh, transaction, source: 'editor.assetdb' };
            }
            const folder = new SilentAssetCreateFolder();
            let result: {
                readonly path: string;
                readonly createdDirectories: readonly string[];
                readonly existed: boolean;
            };
            try {
                const created = folder.create({
                    projectRoot,
                    relativePath: request.path,
                });
                result = { ...created, existed: false };
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.startsWith('silent_create_folder_target_exists:')) {
                    throw error instanceof Error ? error : new Error(message);
                }
                // 上线路径：目录已存在视为幂等成功，只补齐缺失 .meta。
                const ensured = folder.ensureDirectoryMetas({
                    projectRoot,
                    relativePath: request.path,
                });
                result = { ...ensured, existed: true };
            }
            const refresh = await this._awaitNewAssetReadyWithoutForceRefresh([result.path]);
            const transaction = await this._host.assetDbTransaction.commit([result.path], { refresh: false });
            return { ...result, refresh, transaction };
        });
    }

    /**
     * @description 解析 asset.createFolder 输入。
     * @param input 未校验输入。
     * @returns 已校验的建目录输入。
     */
    public _readAssetCreateFolderInput(input: ContractPayload | undefined): IAssetCreateFolderMcpInput {
        if (input == null || !this._host.isRecord(input) || typeof input.path !== 'string' || input.path.trim().length === 0) {
            throw new Error('editor_mcp_asset_createFolder_path_required');
        }
        return { path: input.path.trim() };
    }

    /**
     * @description 静默删除文件/文件夹（含 .meta），不弹回收站确认；随后刷新受影响路径。
     * 破坏性确认（`confirmDestructive`）与依赖阻断已由 router 统一网关与
     * `SilentAssetDelete` 分别把关，此处只负责编排。
     * @param input 未校验输入。
     * @returns 删除结果，附带刷新回执。
     */
    public async _executeAssetDelete(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetDeleteInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const lockKeys = request.paths.map((pathValue) => normalizeResourceLockKey(pathValue));
        return LumenResourceWriteLock.shared().runExclusiveMany(lockKeys, async () => {
            if (Lumen24McpBridge.isCreator2x()) {
                const result = await Lumen24McpBridge.deleteAssets(projectRoot, request.paths);
                FileAssetDependencyIndex.invalidate(projectRoot);
                const refresh = await this._awaitAssetDbRefreshBarrier(this._lifecycleRefreshPathsAfterDelete(request.paths),);
                return { ...result, refresh, source: 'editor.assetdb' };
            }
            let result;
            try {
                result = new SilentAssetDelete().delete({
                    projectRoot,
                    relativePaths: request.paths,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                if (
                    message.startsWith('silent_delete_source_missing:') ||
                    message.startsWith('silent_delete_') ||
                    message.startsWith('silent_asset_')
                ) {
                    McpControlFlowRefusal.reject(message);
                }
                throw error instanceof Error ? error : new Error(message);
            }
            FileAssetDependencyIndex.invalidate(projectRoot);
            const refresh = await this._awaitNewAssetReadyWithoutForceRefresh(
                this._lifecycleRefreshPathsAfterDelete(request.paths),
            );
            return { ...result, refresh };
        });
    }

    /**
     * @description 解析 asset.delete 输入。
     * @param input 未校验输入。
     * @returns 已校验的删除输入。
     */
    public _readAssetDeleteInput(input: ContractPayload | undefined): IAssetDeleteMcpInput {
        if (input == null || !this._host.isRecord(input) || !Array.isArray(input.paths)) {
            throw new Error('editor_mcp_asset_delete_paths_required');
        }
        const paths = input.paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (paths.length === 0) {
            throw new Error('editor_mcp_asset_delete_paths_required');
        }
        return { paths };
    }

    /**
     * @description 静默重新导入：薄层封装，等价 `lumen.refresh` 的静默 `refresh-asset`（磁盘为真源刷入 library，无弹窗）。
     * @param input 未校验输入。
     * @returns lumen.refresh 的执行结果。
     */
    public async _executeAssetReimport(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetReimportInput(input);
        const imageOnly = request.paths.length > 0 && request.paths.every((pathValue) => this._isImageSidecarAsset(pathValue));
        if (imageOnly) {
            // 3.8.x：对刚静默 rename/move 的图片做 refresh-asset 会稳定打出
            // texture/spriteFrame Window「原资产不存在」。监视器已对齐磁盘时跳过 refresh。
            const waitMs = 4500;
            await new Promise<void>((resolve) => {
                setTimeout(resolve, waitMs);
            });
            return {
                phase: 'editor_refreshed',
                triggered: false,
                waitedMs: waitMs,
                paths: request.paths,
                via: 'watcher_settle_skip_refresh_for_images',
            };
        }
        return this._awaitAssetDbRefreshBarrier(request.paths);
    }

    /**
     * @description 静默写入 UTF-8 文本资产：补齐目录 meta → 写盘 → 一次合并 lumen.refresh（禁止 save-asset）。
     * @param input 未校验输入。
     * @returns 写入与刷新回执。
     */
    public async _executeAssetWriteText(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetWriteTextInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const message = this._host.runtime.message;
        const pathGuard = new SilentAssetCreateFolder();
        const lockKeys = request.files.map((file) => normalizeResourceLockKey(file.path));
        return LumenResourceWriteLock.shared().runExclusiveMany(lockKeys, async () => {
            const createdDirectories: string[] = [];
            const written: string[] = [];
            for (const file of request.files) {
                const parentRelative = dirname(file.path).replace(/\\/g, '/');
                if (parentRelative.length > 0 && parentRelative !== '.' && parentRelative.startsWith('assets')) {
                    const ensured = pathGuard.ensureDirectoryMetas({
                        projectRoot,
                        relativePath: parentRelative,
                    });
                    for (const dir of ensured.createdDirectories) {
                        if (!createdDirectories.includes(dir)) {
                            createdDirectories.push(dir);
                        }
                    }
                }
                const absolutePath = join(projectRoot, file.path);
                const dbUrl = `db://${file.path}`;
                const existing =
                    message == null
                        ? null
                        : await message.request<Record<string, unknown> | null>('asset-db', 'query-asset-info', dbUrl);
                if (message != null && existing == null) {
                    const recoveryDirectory = join(projectRoot, 'temp', '.peanut-write-text-recovery', CompatibleUuid.create());
                    const orphanPaths = [absolutePath, `${absolutePath}.meta`].filter((candidate) => existsSync(candidate));
                    const backups = orphanPaths.map((orphanPath) => ({
                        originalPath: orphanPath,
                        backupPath: join(recoveryDirectory, orphanPath.endsWith('.meta') ? 'asset.meta' : 'asset'),
                    }));
                    try {
                        if (backups.length > 0) {
                            mkdirSync(recoveryDirectory, { recursive: true });
                            for (const backup of backups) {
                                renameSync(backup.originalPath, backup.backupPath);
                            }
                        }
                        await message.request('asset-db', 'create-asset', dbUrl, file.content);
                        rmSync(recoveryDirectory, { recursive: true, force: true });
                    } catch (error) {
                        for (const backup of backups) {
                            if (existsSync(backup.backupPath) && !existsSync(backup.originalPath)) {
                                renameSync(backup.backupPath, backup.originalPath);
                            }
                        }
                        rmSync(recoveryDirectory, { recursive: true, force: true });
                        throw error;
                    }
                } else {
                    writeFileSync(absolutePath, file.content, 'utf8');
                }
                written.push(file.path);
            }
            // 新建目录只 waitReady（禁止 force refresh-asset）；文件走 barrier 登记。
            const dirReady =
                createdDirectories.length > 0
                    ? await this._awaitNewAssetReadyWithoutForceRefresh(createdDirectories)
                    : null;
            const transaction = await this._host.assetDbTransaction.commit(written);
            return {
                written,
                createdDirectories,
                byteCount: request.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0),
                dirReady,
                refresh: transaction.refresh,
                metaReady: transaction.registrations.map((registration) => registration.dbPath.slice('db://'.length)),
                transaction,
            };
        });
    }

    /**
     * @description 解析 asset.writeText 输入（单文件或 files 批量）。
     * @param input 未校验输入。
     * @returns 已规范化的文件列表。
     */
    public _readAssetWriteTextInput(input: ContractPayload | undefined): { files: readonly { path: string; content: string }[] } {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('editor_mcp_asset_writeText_input_required');
        }
        const pathGuard = new SilentAssetPathGuard();
        /** @description 仅允许常见文本扩展，避免误写二进制。 */
        const allowedExt = /\.(?:ts|mts|cts|js|mjs|cjs|json|md|txt|html|htm|css|scss|less|yaml|yml|xml|csv)$/iu;
        const normalizeOne = (pathValue: unknown, contentValue: unknown): { path: string; content: string } => {
            if (typeof pathValue !== 'string' || pathValue.trim().length === 0) {
                throw new Error('editor_mcp_asset_writeText_path_required');
            }
            if (typeof contentValue !== 'string') {
                throw new Error('editor_mcp_asset_writeText_content_required');
            }
            const normalized = pathGuard.normalize(pathValue.trim());
            if (!allowedExt.test(normalized)) {
                throw new Error(`editor_mcp_asset_writeText_extension_refused:${normalized}`);
            }
            return { path: normalized, content: contentValue };
        };

        if (Array.isArray(input.files)) {
            if (input.files.length === 0) {
                throw new Error('editor_mcp_asset_writeText_files_empty');
            }
            const files = input.files.map((entry) => {
                if (entry == null || !this._host.isRecord(entry)) {
                    throw new Error('editor_mcp_asset_writeText_files_invalid');
                }
                return normalizeOne(entry.path, entry.content);
            });
            return { files };
        }
        return { files: [normalizeOne(input.path, input.content)] };
    }

    /**
     * @description 经 AssetDB `save-asset-meta` 批量提升 PNG 为 SpriteFrame。
     * @param input 未校验输入。
     * @returns 批量提升结果。
     */
    public async _executeAssetEnsureSpriteFramesBatch(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetEnsureSpriteFramesBatchInput(input);
        const projectRoot = await this._host.requireProjectPath();
        if (Lumen24McpBridge.isCreator2x()) {
            return Lumen24McpBridge.ensureSpriteFrames(projectRoot, request.dbPaths);
        }
        const message = this._host.runtime.message;
        if (message == null) {
            throw new Error('editor_mcp_message_grant_required');
        }
        const service = new EnsureSpriteFramesBatchService(message);
        return service.ensureBatch({
            projectRoot,
            dbPaths: request.dbPaths,
            ...(request.refreshRoot != null ? { refreshRoot: request.refreshRoot } : {}),
        });
    }

    /**
     * @description 解析 asset.reimport 输入；`path` 为 `paths` 的单值别名。
     * @param input 未校验输入。
     * @returns 已校验的重新导入输入（`paths` 始终为数组）。
     */
    public _readAssetReimportInput(input: ContractPayload | undefined): IAssetReimportMcpInput & { readonly paths: readonly string[] } {
        if (input == null) {
            return { paths: [] };
        }
        if (!this._host.isRecord(input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        const paths: string[] = [];
        if (input.paths != null) {
            if (!Array.isArray(input.paths)) {
                throw new Error('editor_mcp_asset_reimport_paths_invalid');
            }
            for (const item of input.paths) {
                if (typeof item !== 'string' || item.trim().length === 0) {
                    throw new Error('editor_mcp_asset_reimport_paths_invalid');
                }
                paths.push(this._normalizeProjectRelativeAssetPath(item));
            }
        }
        if (typeof input.path === 'string' && input.path.trim().length > 0) {
            const single = this._normalizeProjectRelativeAssetPath(input.path);
            if (!paths.includes(single)) {
                paths.push(single);
            }
        }
        return { paths };
    }

    /**
     * @description 将 `db://` / 前导 `/` 归一成项目相对路径（reimport / write 输入容错）。
     * @param raw 原始路径。
     * @returns 项目相对路径。
     */
    private _normalizeProjectRelativeAssetPath(raw: string): string {
        let normalized = raw.trim().replace(/\\/g, '/');
        if (normalized.startsWith('db://')) {
            normalized = normalized.slice('db://'.length);
        }
        normalized = normalized.replace(/^\/+/u, '');
        if (
            normalized.length === 0 ||
            normalized.startsWith('/') ||
            /^[a-zA-Z]:/u.test(normalized) ||
            normalized.split('/').some((segment) => segment.length === 0 || segment === '..')
        ) {
            throw new Error('editor_mcp_asset_path_not_project_relative');
        }
        return normalized;
    }

    /**
     * @description 解析 asset.ensureSpriteFramesBatch 输入。
     * @param input 未校验输入。
     * @returns 已校验输入。
     */
    public _readAssetEnsureSpriteFramesBatchInput(input: ContractPayload | undefined): {
        readonly dbPaths: readonly string[];
        readonly refreshRoot?: string;
    } {
        if (input == null || !this._host.isRecord(input) || !Array.isArray(input.dbPaths)) {
            throw new Error('editor_mcp_asset_ensure_sprite_frames_db_paths_required');
        }
        const dbPaths = input.dbPaths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (dbPaths.length === 0) {
            throw new Error('editor_mcp_asset_ensure_sprite_frames_db_paths_required');
        }
        const refreshRoot =
            typeof input.refreshRoot === 'string' && input.refreshRoot.trim().length > 0 ? input.refreshRoot.trim() : undefined;
        return {
            dbPaths,
            ...(refreshRoot != null ? { refreshRoot } : {}),
        };
    }

    /**
     * @description 生成依赖分层导入计划（含闭包）并登记账本票据。
     * @param input 未校验输入。
     * @returns 计划。
     */
    public async _executeAssetImportPlan(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetImportPlanInput(input);
        const plan = new AssetImportPlanner().plan(request.sources, {
            dependencyMap: request.dependencyMap,
            expandClosure: request.expandClosure !== false,
        });
        return this._attachImportPlanTicket(plan);
    }

    /**
     * @description 为计划附加账本 planId。
     * @param plan 导入计划。
     * @returns 带 planId 的计划。
     */
    private async _attachImportPlanTicket(plan: unknown): Promise<unknown> {
        const projectRoot = await this._host.requireProjectPath();
        const ledger = new ManagedAssetLedger(projectRoot);
        if (ledger.mode() === 'off') {
            return { ...(plan as object), managedAssetsMode: 'off' };
        }
        const layers =
            plan != null && typeof plan === 'object' && !Array.isArray(plan)
                ? (plan as { layers?: readonly { source: string }[][] }).layers
                : undefined;
        const sources = (layers ?? []).flat().map((item) => item.source);
        const ticket = ledger.recordPlan(sources);
        return {
            ...(plan as object),
            planId: ticket.id,
            expiresInMs: 10 * 60_000,
            managedAssetsMode: ledger.mode(),
        };
    }

    /**
     * @description 分层导入并等待 AssetDB 稳定，最后附带 project.log 增量。
     * @param input 未校验输入。
     * @returns 导入结果。
     */
    public async _executeAssetImport(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetImportInput(input);
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._host.requireProjectPath();
            const dest = request.target.startsWith('db://') ? request.target : `db://${request.target.replace(/^\/+/u, '')}`;
            const absoluteSources = request.sources.map((source) =>
                source.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(source) ? source : join(projectRoot, source),
            );
            return Lumen24McpBridge.importAssets(projectRoot, absoluteSources, dest.endsWith('/') ? dest : `${dest}/`);
        }
        const importLockKey = normalizeResourceDirectoryLockKey(request.target);
        return LumenResourceWriteLock.shared().runExclusive(importLockKey, async () => {
            const message = this._host.runtime.message;
            if (message == null) {
                throw new Error('editor_mcp_message_grant_required');
            }
            const projectRoot = await this._host.requireProjectPath();
            const ledger = new ManagedAssetLedger(projectRoot);
            const planner = new AssetImportPlanner();
            const planned = planner.plan(request.sources, {
                dependencyMap: request.dependencyMap,
                expandClosure: request.expandClosure !== false,
            });
            const closure = planned.layers.flat().map((item) => item.source);
            const managedAssetsMode = ledger.mode();
            /** @type {import('@peanut/pod-engine/lumen').IManagedImportPlanTicket | undefined} */
            let ticket;
            if (managedAssetsMode === 'strict') {
                ticket = ledger.requireRecentPlan(closure, request.planId);
            } else if (managedAssetsMode === 'new-assets') {
                try {
                    ticket = ledger.requireRecentPlan(closure, request.planId);
                } catch {
                    ticket = ledger.recordPlan(closure);
                }
            } else {
                ticket = undefined;
            }
            const monitor = new ProjectLogPostflightMonitor();
            const checkpoint = monitor.checkpoint(projectRoot);
            const executor = new AssetImportBatchExecutor(message);
            const overwrite = request.overwrite === true || request.mode === 'override';
            const result = await executor.importBatch({
                sources: request.sources,
                target: request.target,
                overwrite,
                dependencyMap: request.dependencyMap,
                concurrency: request.concurrency,
                refreshAfter: request.refreshAfter,
                allowMissingDependencies: request.allowMissingDependencies,
                expandClosure: request.expandClosure !== false,
                projectRoot,
            });
            const transaction = await this._host.assetDbTransaction.commit(
                result.imported.map((row) => row.targetDbPath),
                { refresh: false, requireMeta: false },
            );
            if (ticket != null) {
                for (const row of result.imported) {
                    let uuid: string | undefined;
                    try {
                        const info = await message.request<Record<string, unknown>>('asset-db', 'query-asset-info', row.targetDbPath);
                        uuid = typeof info?.uuid === 'string' ? info.uuid : undefined;
                    } catch {
                        uuid = undefined;
                    }
                    ledger.recordImport({
                        source: row.source,
                        target: row.targetDbPath,
                        uuid,
                        planId: ticket.id,
                        assetDbReady: true,
                    });
                }
                FileAssetDependencyIndex.invalidate(projectRoot);
            }
            const postflight = monitor.readDelta(checkpoint);
            return { ...result, transaction, postflight, planId: ticket?.id, managedAssetsMode };
        });
    }

    /**
     * @description 查询导入账本受管状态。
     * @param input 未校验输入。
     * @returns 状态汇总。
     */
    public async _executeAssetManagedStatus(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetManagedStatusInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const ledger = new ManagedAssetLedger(projectRoot);
        const message = this._host.runtime.message;
        const resolveUuid =
            message == null
                ? undefined
                : async (dbPath: string): Promise<string | undefined> => {
                      const info = await message.request<Record<string, unknown>>('asset-db', 'query-asset-info', dbPath);
                      return typeof info?.uuid === 'string' ? info.uuid : undefined;
                  };
        const statuses = await Promise.all(request.targets.map((target) => ledger.status(target, resolveUuid)));
        return {
            statuses,
            allVerified: statuses.every((status) => status.verified),
        };
    }

    /**
     * @description 审计非受管 / 账外变更写盘。
     * @param input 未校验输入。
     * @returns 审计结果。
     */
    public async _executeAssetAuditUnmanagedWrites(input: ContractPayload | undefined): Promise<unknown> {
        const projectRoot = await this._host.requireProjectPath();
        const pathContains =
            input != null && typeof input.pathContains === 'string' && input.pathContains.trim().length > 0
                ? input.pathContains.trim()
                : undefined;
        const modifiedSince =
            input != null && typeof input.modifiedSince === 'string' && input.modifiedSince.trim().length > 0
                ? input.modifiedSince.trim()
                : undefined;
        const limit = input != null && typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : undefined;
        return new ManagedAssetLedger(projectRoot).auditUnmanagedWrites({
            pathContains,
            modifiedSince,
            limit,
            includeGit: input?.includeGit === true,
        });
    }

    /**
     * @description 查询磁盘依赖图。
     * @param input 未校验输入。
     * @returns 依赖结果。
     */
    public async _executeAssetQueryDependencies(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetQueryDependenciesInput(input);
        const projectRoot = await this._host.requireProjectPath();
        return new FileAssetDependencyIndex().query(projectRoot, request);
    }

    /**
     * @description 批量替换序列化资产中的 uuid 引用，非 dryRun 时刷新改动路径。
     * @param input 未校验输入。
     * @returns 替换结果。
     */
    public async _executeAssetReplaceReferences(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetReplaceReferencesInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const lockKeys =
            request.pathContains != null && request.pathContains.length > 0
                ? [normalizeResourceDirectoryLockKey(request.pathContains)]
                : [normalizeResourceDirectoryLockKey('assets')];
        return LumenResourceWriteLock.shared().runExclusiveMany(lockKeys, async () => {
            let result;
            try {
                result = new SilentAssetReferenceReplace().replace({
                    projectRoot,
                    fromUuid: request.fromUuid,
                    toUuid: request.toUuid,
                    pathContains: request.pathContains,
                    dryRun: request.dryRun,
                    allowMissingTarget: request.allowMissingTarget,
                    refreshIndex: request.refreshIndex,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                // Expected business miss (fake/missing target uuid): structured control-flow, never console.error.
                if (message.startsWith('silent_replace_target_not_found:')) {
                    McpControlFlowRefusal.reject(message);
                }
                if (
                    message === 'silent_replace_from_to_required' ||
                    message === 'silent_replace_from_equals_to' ||
                    message.startsWith('silent_replace_')
                ) {
                    McpControlFlowRefusal.reject(message);
                }
                throw error instanceof Error ? error : new Error(message);
            }
            if (result.dryRun || result.files.length === 0) {
                return result;
            }
            const refresh = await this._awaitAssetDbRefreshBarrier(
                result.files.map((file: { path: string }) => file.path),
            );
            return { ...result, refresh };
        });
    }

    /**
     * @description 等待 AssetDB ready。
     * @param input 未校验输入。
     * @returns 等待结果。
     */
    public async _executeAssetWaitReady(input: ContractPayload | undefined): Promise<unknown> {
        const request = this._readAssetWaitReadyInput(input);
        if (this._host.runtime.message == null) {
            return {
                ready: true,
                polls: 0,
                waitedMs: 0,
                status: 'unsupported',
                message: 'editor_mcp_asset_wait_ready_no_message_port',
            };
        }
        return new LumenAssetDbReadyWaiter(this._host.runtime.message).wait(request);
    }

    /**
     * @description 解析 importPlan 输入。
     * @param input 未校验输入。
     * @returns 计划输入。
     */
    public _readAssetImportPlanInput(input: ContractPayload | undefined): IAssetImportPlanMcpInput {
        if (input == null || !this._host.isRecord(input) || !Array.isArray(input.sources)) {
            throw new Error('editor_mcp_asset_import_sources_required');
        }
        const sources = input.sources.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (sources.length === 0) {
            throw new Error('editor_mcp_asset_import_sources_required');
        }
        return {
            sources,
            dependencyMap: this._readDependencyMap(input.dependencyMap),
            expandClosure: typeof input.expandClosure === 'boolean' ? input.expandClosure : undefined,
        };
    }

    /**
     * @description 解析 import 输入。
     * @param input 未校验输入。
     * @returns 导入输入。
     */
    public _readAssetImportInput(input: ContractPayload | undefined): IAssetImportMcpInput {
        const planInput = this._readAssetImportPlanInput(input);
        if (input == null || typeof input.target !== 'string' || input.target.trim().length === 0) {
            throw new Error('editor_mcp_asset_import_target_required');
        }
        return {
            ...planInput,
            target: input.target.trim(),
            mode: typeof input.mode === 'string' ? input.mode : undefined,
            overwrite: input.overwrite === true,
            concurrency: typeof input.concurrency === 'number' ? input.concurrency : undefined,
            refreshAfter: typeof input.refreshAfter === 'boolean' ? input.refreshAfter : undefined,
            allowMissingDependencies: input.allowMissingDependencies === true,
            planId: typeof input.planId === 'string' && input.planId.trim().length > 0 ? input.planId.trim() : undefined,
        };
    }

    /**
     * @description 解析 managedStatus 输入。
     * @param input 未校验输入。
     * @returns 受管状态输入。
     */
    public _readAssetManagedStatusInput(input: ContractPayload | undefined): IAssetManagedStatusMcpInput {
        if (input == null || !this._host.isRecord(input) || !Array.isArray(input.targets)) {
            throw new Error('editor_mcp_asset_managed_status_targets_required');
        }
        const targets = input.targets.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        if (targets.length === 0) {
            throw new Error('editor_mcp_asset_managed_status_targets_required');
        }
        return { targets };
    }

    /**
     * @description 解析 queryDependencies 输入。
     * @param input 未校验输入。
     * @returns 依赖查询输入。
     */
    public _readAssetQueryDependenciesInput(input: ContractPayload | undefined): IAssetQueryDependenciesMcpInput {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('dbPath_or_uuid_required');
        }
        const dbPath = typeof input.dbPath === 'string' ? input.dbPath.trim() : undefined;
        const uuid = typeof input.uuid === 'string' ? input.uuid.trim() : undefined;
        if ((dbPath == null || dbPath.length === 0) && (uuid == null || uuid.length === 0)) {
            throw new Error('dbPath_or_uuid_required');
        }
        const direction =
            input.direction === 'dependencies' || input.direction === 'dependents' || input.direction === 'both'
                ? input.direction
                : undefined;
        const expand = Array.isArray(input.expand)
            ? input.expand.filter((item): item is 'materialTextures' => item === 'materialTextures')
            : undefined;
        return {
            dbPath: dbPath != null && dbPath.length > 0 ? dbPath : undefined,
            uuid: uuid != null && uuid.length > 0 ? uuid : undefined,
            direction,
            refreshIndex: input.refreshIndex === true,
            expand: expand != null && expand.length > 0 ? expand : undefined,
        };
    }

    /**
     * @description 解析 replaceReferences 输入。
     * @param input 未校验输入。
     * @returns 替换输入。
     */
    public _readAssetReplaceReferencesInput(input: ContractPayload | undefined): IAssetReplaceReferencesMcpInput {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('editor_mcp_asset_replace_from_to_required');
        }
        const fromUuid = typeof input.fromUuid === 'string' ? input.fromUuid.trim() : '';
        const toUuid = typeof input.toUuid === 'string' ? input.toUuid.trim() : '';
        if (fromUuid.length === 0 || toUuid.length === 0) {
            throw new Error('editor_mcp_asset_replace_from_to_required');
        }
        const pathContains =
            typeof input.pathContains === 'string' && input.pathContains.trim().length > 0 ? input.pathContains.trim() : undefined;
        return {
            fromUuid,
            toUuid,
            pathContains,
            dryRun: input.dryRun === true,
            allowMissingTarget: input.allowMissingTarget === true,
            refreshIndex: input.refreshIndex === true,
        };
    }

    /**
     * @description 解析 waitReady 输入。
     * @param input 未校验输入。
     * @returns 等待输入。
     */
    public _readAssetWaitReadyInput(input: ContractPayload | undefined): IAssetWaitReadyMcpInput {
        if (input == null) {
            return {};
        }
        if (!this._host.isRecord(input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        return {
            timeoutMs:
                typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
                    ? Math.max(0, Math.floor(input.timeoutMs))
                    : undefined,
            intervalMs:
                typeof input.intervalMs === 'number' && Number.isFinite(input.intervalMs)
                    ? Math.max(1, Math.floor(input.intervalMs))
                    : undefined,
            throwOnTimeout: input.throwOnTimeout === true,
        };
    }

    /**
     * @description 读取依赖表。
     * @param value 未校验值。
     * @returns 依赖表。
     */
    private _readDependencyMap(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
        if (value == null) {
            return undefined;
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('editor_mcp_asset_import_dependencyMap_invalid');
        }
        const result: Record<string, readonly string[]> = {};
        for (const [source, dependencies] of Object.entries(value as Record<string, unknown>)) {
            if (!Array.isArray(dependencies) || dependencies.some((item) => typeof item !== 'string')) {
                throw new Error(`editor_mcp_asset_import_dependencyMap_invalid:${source}`);
            }
            result[source] = dependencies as readonly string[];
        }
        return result;
    }
}
