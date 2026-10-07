import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { SilentAssetPathGuard, type ISilentAssetDeleteItem } from '@peanut/pod-engine/assets';
import type { IEditorMcpAssetDbTransactionMessagePort } from './editor-mcp-asset-db-transaction.js';

/**
 * @description 删除确认预算；默认短等监视器，再刷新存活父目录并轮询，覆盖值必须有限。
 */
export interface IEditorMcpAssetDbDeletionOptions {
    /**
     * @description 监视器等待毫秒数，默认 600，允许 0..60000。
     */
    readonly watcherMs?: number;
    /**
     * @description 刷新后等待毫秒数，默认 8000，允许 100..60000。
     */
    readonly timeoutMs?: number;
    /**
     * @description 轮询间隔毫秒数，默认 100，允许 20..1000。
     */
    readonly pollIntervalMs?: number;
}

/**
 * @description 删除前的主资源、子资源及物理身份快照。
 */
interface IDeletionTarget {
    /**
     * @description 相对资源路径。
     */
    readonly path: string;
    /**
     * @description 磁盘主 UUID。
     */
    readonly uuid: string;
    /**
     * @description 全部已知主/子 UUID。
     */
    readonly uuids: readonly string[];
    /**
     * @description 主文件/目录和 meta 的物理快照。
     */
    readonly physical: string;
}

/**
 * @description 存活父目录及其非删除子条目的删除前快照。
 */
interface IDeletionParent {
    /**
     * @description 工程相对路径。
     */
    readonly path: string;
    /**
     * @description 原生目录 UUID。
     */
    readonly uuid: string;
    /**
     * @description 目录身份、meta 和非删除子条目的物理快照。
     */
    readonly physical: string;
}

/**
 * @description 将物理删除与 AssetDB URL、主/子 UUID 移除确认连接起来，未知响应与原生异常均失败关闭。
 */
export class EditorMcpAssetDbDeletionCoordinator {
    /**
     * @description 当前真实工程根。
     */
    private readonly _root: string;
    /**
     * @description 授权原生消息端口。
     */
    private readonly _message: IEditorMcpAssetDbTransactionMessagePort;
    /**
     * @description 有限等待参数。
     */
    private readonly _options: IEditorMcpAssetDbDeletionOptions;
    /**
     * @description 本实例受理的删除根集合。
     */
    private _paths: readonly string[] = [];
    /**
     * @description 本实例受理的完整删除集合。
     */
    private _targets: readonly IDeletionTarget[] = [];
    /**
     * @description 必须存活的刷新目录。
     */
    private _parents: readonly IDeletionParent[] = [];
    /**
     * @description prepare 与 commit 各只能受理一次。
     */
    private _state: 'new' | 'preparing' | 'prepared' | 'consumed' = 'new';

    /**
     * @description 注入当前工程与原生端口，不启动任何原生进程。
     * @param root 工程根。
     * @param message 原生消息客户端。
     * @param options 有限等待参数。
     */
    public constructor(root: string, message: IEditorMcpAssetDbTransactionMessagePort, options: IEditorMcpAssetDbDeletionOptions = {}) {
        this._root = realpathSync(root);
        this._message = message;
        this._options = options;
        this._bounded(options.watcherMs, 600, 0, 60_000);
        this._bounded(options.timeoutMs, 8000, 100, 60_000);
        this._bounded(options.pollIntervalMs, 100, 20, 1000);
    }

    /**
     * @description 在任何删除之前核实路径、主/子 UUID、存活父目录和物理身份。
     * @param paths 删除根。
     */
    public async prepare(paths: readonly string[]): Promise<void> {
        if (this._state !== 'new') throw new Error('editor_mcp_asset_delete_prepare_reused');
        this._state = 'preparing';
        const guard = new SilentAssetPathGuard();
        this._paths = [...new Set(paths.map((path) => guard.normalize(path)))];
        if (this._paths.length === 0 || this._paths.includes('assets')) throw new Error('editor_mcp_asset_delete_surviving_parent_required');
        const expanded = new Set<string>();
        for (const path of this._paths) this._expand(path, expanded);
        const targets: IDeletionTarget[] = [];
        for (const path of expanded) {
            const physical = this._physical(path);
            const metaPath = join(this._root, `${path}.meta`);
            const meta: unknown = this._present(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null;
            const uuid = this._record(meta) && typeof meta.uuid === 'string' ? meta.uuid : '';
            const info = await this._query(`db://${path}`);
            if (info != null && uuid !== '' && info.uuid !== uuid) throw new Error(`editor_mcp_asset_delete_uuid_conflict:${path}`);
            const uuids = new Set<string>();
            this._collectUuids(meta, uuids);
            this._collectUuids(info, uuids);
            targets.push({ path, uuid, uuids: [...uuids], physical });
        }
        this._targets = targets;
        const parentPaths = new Set<string>();
        for (const path of this._paths) {
            let parent = dirname(path);
            while (this._deleted(parent)) parent = dirname(parent);
            if (parent !== 'assets' && !parent.startsWith('assets/')) throw new Error('editor_mcp_asset_delete_surviving_parent_required');
            parentPaths.add(parent);
        }
        const parents: IDeletionParent[] = [];
        for (const path of parentPaths) {
            const physical = this._parentPhysical(path);
            const info = await this._query(`db://${path}`);
            if (info == null || typeof info.uuid !== 'string' || info.uuid === '') throw new Error(`editor_mcp_asset_delete_parent_unregistered:${path}`);
            parents.push({ path, uuid: info.uuid, physical });
        }
        this._parents = parents;
        for (const target of this._targets) {
            if (target.physical !== this._physical(target.path)) throw new Error(`editor_mcp_asset_delete_source_changed:${target.path}`);
        }
        await this._assertParents();
        for (const target of this._targets) {
            if (target.physical !== this._physical(target.path)) throw new Error(`editor_mcp_asset_delete_source_changed:${target.path}`);
        }
        this._state = 'prepared';
    }

    /**
     * @description 物理删除后只刷新身份不变的存活父目录；确认 URL 和全部旧 UUID 消失后才成功。
     * @param deleted 物理删除器返回的完整展开集合。
     * @returns 删除确认回执；失败抛原异常，调用方不得声明未改。
     */
    public async commit(deleted: readonly ISilentAssetDeleteItem[]): Promise<unknown> {
        if (this._state !== 'prepared') throw new Error('editor_mcp_asset_delete_commit_not_prepared');
        this._state = 'consumed';
        if (deleted.length !== this._targets.length || this._targets.some((target) => !deleted.some((item) => item.path === target.path && item.uuid === target.uuid))) {
            throw new Error('editor_mcp_asset_delete_result_mismatch');
        }
        const start = Date.now();
        let polls = 0;
        const interval = this._bounded(this._options.pollIntervalMs, 100, 20, 1000);
        const waitAbsent = async (milliseconds: number): Promise<boolean> => {
            const deadline = Date.now() + milliseconds;
            do {
                polls += 1;
                await this._assertParents();
                let absent = true;
                for (const target of this._targets) {
                    if (this._present(join(this._root, target.path)) || this._present(join(this._root, `${target.path}.meta`))) throw new Error(`editor_mcp_asset_delete_physical_remaining:${target.path}`);
                    if (await this._query(`db://${target.path}`) != null) absent = false;
                    for (const uuid of target.uuids) if (await this._query(uuid) != null) absent = false;
                }
                if (absent) return true;
                if (Date.now() >= deadline) return false;
                await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, interval));
            } while (true);
        };
        const refreshedParents: string[] = [];
        if (!await waitAbsent(this._bounded(this._options.watcherMs, 600, 0, 60_000))) {
            for (const parent of this._parents) {
                await this._assertParents();
                const response = await this._message.request('asset-db', 'refresh-asset', `db://${parent.path}`);
                if (response !== true && response != null) throw new Error(`editor_mcp_asset_delete_refresh_rejected:${parent.path}`);
                refreshedParents.push(parent.path);
            }
            if (!await waitAbsent(this._bounded(this._options.timeoutMs, 8000, 100, 60_000))) throw new Error('editor_mcp_asset_delete_registration_pending');
        }
        await this._assertParents();
        return { phase: 'assetdb_deleted', polls, waitedMs: Date.now() - start, refreshedParents, deleted: this._targets.map((target) => ({ path: target.path, uuids: target.uuids })) };
    }

    /**
     * @description 查询错误保留原异常；仅 null/undefined 是明确不存在。
     */
    private async _query(key: string): Promise<Record<string, unknown> | null> {
        const info = await this._message.request('asset-db', 'query-asset-info', key);
        if (info == null) return null;
        if (!this._record(info) || typeof info.uuid !== 'string' || info.uuid === '') throw new Error(`editor_mcp_asset_delete_query_invalid:${key}`);
        return info;
    }

    /**
     * @description 收集 meta 与原生 subAssets 的 UUID，保持查询子资源而非只检查主资源。
     */
    private _collectUuids(value: unknown, output: Set<string>, depth = 0): void {
        if (depth > 32) throw new Error('editor_mcp_asset_delete_metadata_depth');
        if (!this._record(value)) return;
        if (typeof value.uuid === 'string' && value.uuid !== '') output.add(value.uuid);
        for (const key of ['subMetas', 'subAssets']) {
            const children = value[key];
            if (this._record(children)) for (const child of Object.values(children)) this._collectUuids(child, output, depth + 1);
        }
    }

    /**
     * @description 按物理删除器规则递归展开，任何链接或越界均在写前失败。
     */
    private _expand(path: string, output: Set<string>): void {
        if (output.has(path)) return;
        const absolute = join(this._root, path);
        this._physical(path);
        output.add(path);
        if (!lstatSync(absolute).isDirectory()) return;
        for (const entry of readdirSync(absolute)) {
            if (entry.endsWith('.meta') || entry === '.git' || entry === 'node_modules') continue;
            this._expand(`${path}/${entry}`, output);
        }
    }

    /**
     * @description 判定路径属于请求删除根或其子树，刷新候选与保留条目都使用同一边界。
     */
    private _deleted(path: string): boolean {
        return this._paths.some((root) => path === root || path.startsWith(`${root}/`));
    }

    /**
     * @description 非删除的存活目录、其 meta 与直属保留条目快照。
     */
    private _parentPhysical(path: string): string {
        if (!lstatSync(join(this._root, path)).isDirectory()) throw new Error(`editor_mcp_asset_delete_parent_not_directory:${path}`);
        const children = readdirSync(join(this._root, path)).sort().filter((name) => !this._deleted(`${path}/${name.replace(/\.meta$/u, '')}`));
        return JSON.stringify([this._physical(path), children.map((name) => [name, this._physical(`${path}/${name}`, false)])]);
    }

    /**
     * @description 核对刷新父目录与保留资源；身份或字节漂移保守失败。
     */
    private async _assertParents(): Promise<void> {
        for (const parent of this._parents) {
            if (parent.physical !== this._parentPhysical(parent.path)) throw new Error(`editor_mcp_asset_delete_parent_changed:${parent.path}`);
            if ((await this._query(`db://${parent.path}`))?.uuid !== parent.uuid) throw new Error(`editor_mcp_asset_delete_parent_uuid_changed:${parent.path}`);
            if (parent.physical !== this._parentPhysical(parent.path)) throw new Error(`editor_mcp_asset_delete_parent_changed:${parent.path}`);
        }
    }

    /**
     * @description 有限工程内无链接物理快照；文件字节和 meta 同时纳入身份。
     */
    private _physical(path: string, includeMeta = true): string {
        const absolute = join(this._root, path);
        const snapshot = (file: string): unknown => {
            const stat = lstatSync(file);
            if (stat.isSymbolicLink() || !(realpathSync(file).startsWith(`${this._root}${sep}`)) || realpathSync(file) !== file) throw new Error(`editor_mcp_asset_delete_path_escape:${path}`);
            if (!stat.isFile() && !stat.isDirectory()) throw new Error(`editor_mcp_asset_delete_path_type:${path}`);
            return [stat.dev, stat.ino, stat.mode, stat.isFile() ? createHash('sha256').update(readFileSync(file)).digest('hex') : null];
        };
        const metaPath = `${absolute}.meta`;
        return JSON.stringify([snapshot(absolute), includeMeta && this._present(metaPath) ? snapshot(metaPath) : null]);
    }

    /**
     * @description 不把悬空链接或读失败视为不存在。
     */
    private _present(path: string): boolean {
        try { lstatSync(path); return true; }
        catch (error: unknown) {
            if (this._record(error) && error.code === 'ENOENT') return false;
            throw error;
        }
    }

    /**
     * @description 有限等待参数校验，非法覆盖值显式拒绝。
     */
    private _bounded(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
        if (value === undefined) return fallback;
        if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error('editor_mcp_asset_delete_wait_option_invalid');
        return value;
    }

    /**
     * @description 原生与 JSON 数据对象判定。
     */
    private _record(value: unknown): value is Record<string, unknown> {
        return value != null && typeof value === 'object' && !Array.isArray(value);
    }
}
