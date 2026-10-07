import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { ISilentAssetDeleteItem } from '@peanut/pod-engine/assets';
import { EditorMcpAssetDbDeletionCoordinator, type IEditorMcpAssetDbDeletionOptions } from './editor-mcp-asset-db-deletion-coordinator.js';
import type { IEditorMcpAssetDbTransactionMessagePort } from './editor-mcp-asset-db-transaction.js';

/**
 * @description 当前事务实际创建的目录身份；登记后冻结 meta 原字节。
 */
interface IOwnedParentDirectory {
    /**
     * @description 规范化工程内目录。
     */
    readonly path: string;
    /**
     * @description mkdir 后的设备、inode 与模式。
     */
    readonly identity: string;
    /**
     * @description 实际登记后冻结的 meta 身份；登记前为空。
     */
    meta: string | null;
    /**
     * @description 实际登记后冻结的主 UUID。
     */
    uuid: string;
}

/**
 * @description 父目录清理结果；原生异常只作为内部原对象保存。
 */
export interface ICreatedParentCleanupResult {
    /**
     * @description 是否进入物理删除步骤。
     */
    readonly attempted: boolean;
    /**
     * @description 物理路径、原生 URL 和已知 UUID 均确认不存在。
     */
    readonly complete: boolean;
    /**
     * @description 所有权、保留条目或身份已变化。
     */
    readonly ownershipMismatch: boolean;
    /**
     * @description 内部原异常；不写入公开失败 DTO。
     */
    readonly error: unknown;
}

/**
 * @description 只清理本次 mkdir 的空目录，并复用删除协调器确认原生索引移除。
 */
export class EditorMcpCreatedParentCleanup {
    /**
     * @description 真实工程根。
     */
    private readonly _root: string;
    /**
     * @description 授权原生消息端口。
     */
    private readonly _message: IEditorMcpAssetDbTransactionMessagePort;
    /**
     * @description 有限原生删除确认预算。
     */
    private readonly _options: IEditorMcpAssetDbDeletionOptions;
    /**
     * @description 当前事务实际成功创建的目录。
     */
    private readonly _owned: IOwnedParentDirectory[] = [];
    /**
     * @description 创建前已存在的最近存活父目录。
     */
    private _anchor: string | null = null;
    /**
     * @description 排除本次新目录的存活父目录与直属保留条目身份。
     */
    private _anchorBefore: string | null = null;
    /**
     * @description 创建前读到的存活父目录原生 UUID。
     */
    private _anchorUuid: string | null = null;
    /**
     * @description 清理只能消费一次。
     */
    private _consumed = false;

    /**
     * @description 注入当前工程、原生端口及有限等待参数。
     * @param root 当前真实工程。
     * @param message 当前授权原生端口。
     * @param options 原生删除确认预算。
     */
    public constructor(root: string, message: IEditorMcpAssetDbTransactionMessagePort, options: IEditorMcpAssetDbDeletionOptions = {}) {
        this._root = realpathSync(root);
        this._message = message;
        this._options = options;
    }

    /**
     * @description 逐层 mkdir，只记录实际成功创建的目录；已存在的竞争目录不归本事务。
     * @param paths 外层已校验的缺失目录，父级在前。
     * @returns 原生存活父目录核验和本次实际创建结束。
     */
    public async create(paths: readonly string[]): Promise<void> {
        if (paths.length === 0) return;
        this._anchor = dirname(paths[0]);
        this._anchorBefore = this._anchorSnapshot(paths[0]);
        const info = await this._message.request('asset-db', 'query-asset-info', `db://${this._anchor}`);
        if (!this._record(info) || typeof info.uuid !== 'string' || info.uuid === '') throw new Error('editor_mcp_parent_cleanup_anchor_unknown');
        const meta = this._readMeta(this._anchor);
        if (meta != null && meta.uuid !== info.uuid) throw new Error('editor_mcp_parent_cleanup_uuid_changed');
        this._anchorUuid = info.uuid;
        if (this._anchorBefore !== this._anchorSnapshot(paths[0])) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
        for (const path of paths) {
            const absolute = join(this._root, path);
            mkdirSync(absolute);
            this._owned.push({ path, identity: this._directoryIdentity(path), meta: null, uuid: '' });
        }
    }

    /**
     * @description 原生父目录登记完成后冻结真实 UUID 和 meta；未知或不匹配不能成为清理所有权。
     */
    public async sealRegistration(): Promise<void> {
        for (const entry of this._owned) {
            this._assertDirectory(entry);
            const before = this._metaSnapshot(entry.path);
            const info = await this._message.request('asset-db', 'query-asset-info', `db://${entry.path}`);
            if (!this._record(info) || typeof info.uuid !== 'string' || info.uuid === '') throw new Error('editor_mcp_parent_cleanup_registration_unknown');
            const meta = this._readMeta(entry.path);
            if (meta?.uuid !== info.uuid || before !== this._metaSnapshot(entry.path)) throw new Error('editor_mcp_parent_cleanup_uuid_changed');
            this._assertDirectory(entry);
            entry.meta = before;
            entry.uuid = info.uuid;
        }
    }

    /**
     * @description 保守删除当前事务的空目录；只刷新经核实的存活父目录，原异常不替换业务失败。
     * @returns 物理与原生确认结果及内部原异常。
     */
    public async cleanup(): Promise<ICreatedParentCleanupResult> {
        if (this._consumed) return { attempted: false, complete: false, ownershipMismatch: true, error: new Error('editor_mcp_parent_cleanup_reused') };
        this._consumed = true;
        if (this._owned.length === 0) return { attempted: false, complete: true, ownershipMismatch: false, error: null };
        let attempted = false;
        try {
            this._assertOwned();
            await this._assertNativeAnchor();
            const deletion = new EditorMcpAssetDbDeletionCoordinator(this._root, this._message, this._options);
            await deletion.prepare([this._owned[0].path]);
            await this._assertNativeAnchor();
            this._assertOwned();
            const deleted: ISilentAssetDeleteItem[] = [];
            for (const entry of [...this._owned].reverse()) {
                this._assertDirectory(entry);
                if (readdirSync(join(this._root, entry.path)).length !== 0) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
                if (entry.meta !== this._metaSnapshot(entry.path)) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
                attempted = true;
                rmdirSync(join(this._root, entry.path));
                rmSync(join(this._root, `${entry.path}.meta`), { force: true });
                deleted.push({ path: entry.path, uuid: entry.uuid, isDirectory: true });
            }
            await deletion.commit(deleted);
            return { attempted, complete: true, ownershipMismatch: false, error: null };
        } catch (error: unknown) {
            const ownershipMismatch = error instanceof Error && /ownership_changed|uuid_changed|path_escape|parent_changed|source_changed/u.test(error.message);
            return { attempted, complete: false, ownershipMismatch, error };
        }
    }

    /**
     * @description 原生刷新前核对创建前冻结的存活父 UUID。
     */
    private async _assertNativeAnchor(): Promise<void> {
        const info = await this._message.request('asset-db', 'query-asset-info', `db://${this._anchor}`);
        if (!this._record(info) || info.uuid !== this._anchorUuid) throw new Error('editor_mcp_parent_cleanup_uuid_changed');
    }

    /**
     * @description 重验原目录、登记 meta、空目录闭包与存活父目录；外部文件不删除。
     */
    private _assertOwned(): void {
        if (this._anchorBefore !== this._anchorSnapshot(this._owned[0].path)) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
        const paths = new Set(this._owned.map((entry) => entry.path));
        for (const entry of this._owned) {
            this._assertDirectory(entry);
            if (entry.meta !== this._metaSnapshot(entry.path)) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
            for (const name of readdirSync(join(this._root, entry.path))) {
                const path = `${entry.path}/${name.replace(/\.meta$/u, '')}`;
                if (!paths.has(path)) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
            }
        }
    }

    /**
     * @description 排除本次创建根的直属保留条目快照；不把目录 mtime 当身份。
     */
    private _anchorSnapshot(excluded: string): string {
        if (this._anchor == null) throw new Error('editor_mcp_parent_cleanup_anchor_missing');
        const names = readdirSync(join(this._root, this._anchor)).sort().filter((name) => `${this._anchor}/${name.replace(/\.meta$/u, '')}` !== excluded);
        return JSON.stringify([this._directoryIdentity(this._anchor), this._metaSnapshot(this._anchor), names.map((name) => [name, this._physical(`${this._anchor}/${name}`)])]);
    }

    /**
     * @description 核对 mkdir 时捕获的目录身份。
     * @param entry 当前事务实际创建的目录。
     */
    private _assertDirectory(entry: IOwnedParentDirectory): void {
        if (entry.identity !== this._directoryIdentity(entry.path)) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
    }

    /**
     * @description 无链接的目录身份。
     * @param path 工程相对路径。
     * @returns 稳定设备、inode 和模式。
     */
    private _directoryIdentity(path: string): string {
        if (!lstatSync(join(this._root, path)).isDirectory()) throw new Error('editor_mcp_parent_cleanup_ownership_changed');
        return this._physical(path);
    }

    /**
     * @description 安全读取有界普通 meta 并校验 UUID。
     * @param path 工程相对目录。
     * @returns 实际 meta 或明确不存在。
     */
    private _readMeta(path: string): Record<string, unknown> | null {
        if (this._metaSnapshot(path) == null) return null;
        const meta: unknown = JSON.parse(readFileSync(join(this._root, `${path}.meta`), 'utf8'));
        if (!this._record(meta) || typeof meta.uuid !== 'string' || meta.uuid === '') throw new Error('editor_mcp_parent_cleanup_meta_invalid');
        return meta;
    }

    /**
     * @description 不把读失败或悬空链接当作 meta 缺失。
     * @param path 工程相对目录。
     * @returns meta 物理身份及原字节 SHA，明确不存在则为空。
     */
    private _metaSnapshot(path: string): string | null {
        try { return this._physical(`${path}.meta`); }
        catch (error: unknown) { if (this._record(error) && error.code === 'ENOENT') return null; throw error; }
    }

    /**
     * @description 工程内无链接物理快照；文件必须普通且单链接，meta 不超过一 MiB。
     * @param path 工程相对路径。
     * @returns 稳定身份与文件 SHA。
     */
    private _physical(path: string): string {
        const absolute = join(this._root, path), stat = lstatSync(absolute);
        if (stat.isSymbolicLink() || realpathSync(absolute) !== absolute || !absolute.startsWith(`${this._root}${sep}`)) throw new Error('editor_mcp_parent_cleanup_path_escape');
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('editor_mcp_parent_cleanup_path_type');
        if (stat.isFile() && (stat.nlink !== 1 || path.endsWith('.meta') && stat.size > 1024 * 1024)) throw new Error('editor_mcp_parent_cleanup_file_unsafe');
        return JSON.stringify([stat.dev, stat.ino, stat.mode, stat.isFile() ? createHash('sha256').update(readFileSync(absolute)).digest('hex') : null]);
    }

    /**
     * @description 未受信原生数据与异常的普通记录判定。
     * @param value 未受信值。
     * @returns 是否为非数组数据对象。
     */
    private _record(value: unknown): value is Record<string, unknown> {
        return value != null && typeof value === 'object' && !Array.isArray(value);
    }
}
