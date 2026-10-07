import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { SilentAssetPathGuard } from '@peanut/pod-engine/assets';
import { LumenResourceWriteLock, normalizeResourceLockKey } from '@peanut/pod-engine/lumen';
import type { IEditorMcpAssetDbTransactionMessagePort, EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';

/**
 * @description 真正执行原生 reimport，而非等待监视器后将其命名为重导入。
 */
export class EditorMcpAssetReimport {
    /**
     * @description 在资源锁内依次重新导入，再核对原字节、身份和实际入库完成。
     * @param projectRoot 项目根。
     * @param paths 已归一化的资源列表。
     * @param message 真实 AssetDB 端口。
     * @param transaction 登记证明服务。
     * @returns 原生重导入与登记回执。
     */
    public static async execute(projectRoot: string, paths: readonly string[],
        message: IEditorMcpAssetDbTransactionMessagePort | null,
        transaction: EditorMcpAssetDbTransaction): Promise<unknown> {
        if (paths.length === 0) {
            return { phase: 'editor_refreshed', triggered: false, paths: [], via: 'empty_reimport' };
        }
        if (message == null) {
            throw new Error('editor_mcp_reimport_message_unavailable');
        }
        const guard = new SilentAssetPathGuard();
        const normalized = [...new Set(paths.map((path) => guard.normalize(path)))];
        return LumenResourceWriteLock.shared().runExclusiveMany(normalized.map(normalizeResourceLockKey), async () => {
            const root = realpathSync(join(projectRoot, 'assets'));
            const before = normalized.map((path) => {
                const source = join(projectRoot, path);
                const metaPath = `${source}.meta`;
                if (!realpathSync(source).startsWith(`${root}${sep}`) || lstatSync(metaPath).isSymbolicLink()) {
                    throw new Error(`editor_mcp_reimport_path_escape:${path}`);
                }
                const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
                return { path, source, metaPath, meta, hash: statSync(source).isDirectory() ? null : this._hash(source) };
            });
            for (const item of before) {
                const info = await message.request('asset-db', 'query-asset-info', `db://${item.path}`) as Record<string, unknown> | null;
                if (info == null || info.uuid !== item.meta.uuid || info.importer !== item.meta.importer) {
                    throw new Error(`editor_mcp_reimport_identity_unproven:${item.path}`);
                }
            }
            for (const item of before) {
                await message.request('asset-db', 'reimport-asset', `db://${item.path}`);
            }
            const registration = await transaction.commit(normalized, { refresh: false });
            for (const item of before) {
                const meta = JSON.parse(readFileSync(item.metaPath, 'utf8'));
                const info = await message.request('asset-db', 'query-asset-info', `db://${item.path}`) as Record<string, unknown> | null;
                if (meta.uuid !== item.meta.uuid || meta.importer !== item.meta.importer || info == null
                    || info.uuid !== item.meta.uuid || info.importer !== item.meta.importer || info.imported !== true) {
                    throw new Error(`editor_mcp_reimport_identity_or_ready_mismatch:${item.path}`);
                }
                if (item.hash != null && this._hash(item.source) !== item.hash) {
                    throw new Error(`editor_mcp_reimport_source_changed:${item.path}`);
                }
            }
            return { phase: 'editor_refreshed', triggered: true, paths: normalized,
                via: 'assetdb_native_reimport', transaction: registration };
        });
    }

    /**
     * @description 重导入只能生成缓存，不得改动源字节。
     * @param path 原始文件。
     * @returns SHA256。
     */
    private static _hash(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }
}
