import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { SilentAssetPathGuard } from '@peanut/pod-engine/assets';
import type { ILumenMessagePort } from '@peanut/pod-engine/lumen';
import type { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';

/**
 * @description 原生文件移动：避免字体磁盘 watcher 的重复导入，成功必须证明 UUID 和源字节。
 */
export class EditorMcpNativeFileMove {
    /**
     * @description 调用真实 AssetDB move-asset 并独立核验，失败不得转为 watcher 成功。
     * @param root 工程根。
     * @param from 输入源相对路径。
     * @param to 输入目标相对路径。
     * @param message 授权原生端口。
     * @param transaction 原登记屏障。
     * @returns 原移动字段和原生登记证据。
     */
    public static async execute(root: string, from: string, to: string, message: ILumenMessagePort,
        transaction: EditorMcpAssetDbTransaction): Promise<unknown> {
        const guard = new SilentAssetPathGuard();
        const fromPath = guard.normalize(from); const toPath = guard.normalize(to);
        const source = join(root, fromPath); const target = join(root, toPath);
        const assets = realpathSync(join(root, 'assets'));
        if (fromPath === toPath || existsSync(target) || existsSync(`${target}.meta`)) {
            throw new Error(`silent_move_rename_target_exists:${toPath}`);
        }
        if (!realpathSync(source).startsWith(`${assets}${sep}`) || !statSync(source).isFile()) {
            throw new Error(`editor_mcp_native_move_source_unproven:${fromPath}`);
        }
        if (!realpathSync(dirname(target)).startsWith(`${assets}${sep}`) && realpathSync(dirname(target)) !== assets) {
            throw new Error(`editor_mcp_native_move_target_unproven:${toPath}`);
        }
        const meta = JSON.parse(readFileSync(`${source}.meta`, 'utf8')) as Record<string, unknown>;
        const sourceHash = this._hash(source);
        const info = await message.request<Record<string, unknown> | null>('asset-db', 'query-asset-info', `db://${fromPath}`);
        if (info == null || info.uuid !== meta.uuid || info.importer !== meta.importer || info.imported !== true) {
            throw new Error(`editor_mcp_native_move_identity_unproven:${fromPath}`);
        }
        await message.request('asset-db', 'move-asset', `db://${fromPath}`, `db://${toPath}`, { overwrite: false });
        const registration = await transaction.commit([toPath], { refresh: false });
        const after = JSON.parse(readFileSync(`${target}.meta`, 'utf8')) as Record<string, unknown>;
        const live = await message.request<Record<string, unknown> | null>('asset-db', 'query-asset-info', `db://${toPath}`);
        const old = await message.request('asset-db', 'query-asset-info', `db://${fromPath}`);
        if (existsSync(source) || existsSync(`${source}.meta`) || old != null || after.uuid !== meta.uuid ||
            after.importer !== meta.importer || live == null || live.uuid !== meta.uuid || live.imported !== true ||
            this._hash(target) !== sourceHash) {
            throw new Error(`editor_mcp_native_move_readback_mismatch:${toPath}`);
        }
        return { fromPath, toPath, isDirectory: false, movedMeta: true,
            refresh: { phase: 'assetdb_native_move', triggered: true }, transaction: registration };
    }

    /**
     * @description 读取源字节身份。
     * @param path 文件绝对路径。
     * @returns SHA256。
     */
    private static _hash(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }
}
