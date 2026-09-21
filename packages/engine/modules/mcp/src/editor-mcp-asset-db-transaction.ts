import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CompatibleUuid, FileAssetDependencyIndex } from '@peanut/pod-engine/assets';

/**
 * @description AssetDB 事务所需的最小消息端口。
 */
export interface IEditorMcpAssetDbTransactionMessagePort {
    /**
     * @description 调用 Creator 消息。
     * @param target 消息目标。
     * @param message 消息名。
     * @param args 参数。
     * @returns 未校验响应。
     */
    request(target: string, message: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * @description AssetDB 原子登记事务宿主依赖。
 */
export interface IEditorMcpAssetDbTransactionHost {
    /**
     * @description 当前工程根。
     */
    readonly requireProjectPath: () => Promise<string>;
    /**
     * @description 当前授权消息客户端。
     */
    readonly requireMessage: () => IEditorMcpAssetDbTransactionMessagePort;
    /**
     * @description 执行 commit 级 refresh 与 hierarchy settle。
     */
    readonly refreshForCommit: (paths: readonly string[]) => Promise<unknown>;
}

/**
 * @description 单个资源的 AssetDB 登记证据。
 */
export interface IEditorMcpAssetDbRegistrationEvidence {
    /**
     * @description 规范化 `db://assets/...` 路径。
     */
    readonly dbPath: string;
    /**
     * @description AssetDB 主资源 UUID。
     */
    readonly uuid: string;
    /**
     * @description importer 名称；宿主未返回时为空串。
     */
    readonly importer: string;
    /**
     * @description `.meta` 已写入磁盘。
     */
    readonly metaPresent: boolean;
    /**
     * @description AssetDB 返回的子资源 UUID。
     */
    readonly subAssetUuids: readonly string[];
}

/**
 * @description AssetDB 事务完成证据。
 */
export interface IEditorMcpAssetDbTransactionEvidence {
    /**
     * @description 固定事务阶段标识。
     */
    readonly phase: 'assetdb_registered' | 'assetdb_unavailable';
    /**
     * @description refresh/settle 回执；跳过 refresh 时为 null。
     */
    readonly refresh: unknown | null;
    /**
     * @description 查询轮次。
     */
    readonly polls: number;
    /**
     * @description 等待毫秒数。
     */
    readonly waitedMs: number;
    /**
     * @description 每个主资源的登记证据。
     */
    readonly registrations: readonly IEditorMcpAssetDbRegistrationEvidence[];
}

/**
 * @description AssetDB 事务选项。
 */
export interface IEditorMcpAssetDbTransactionOptions {
    /**
     * @description 是否先执行 commit 级 refresh；默认 true。
     */
    readonly refresh?: boolean;
    /**
     * @description 是否要求磁盘 `.meta` 已存在；默认 true。
     */
    readonly requireMeta?: boolean;
    /**
     * @description 登记等待预算；默认 8000ms。
     */
    readonly timeoutMs?: number;
    /**
     * @description 轮询间隔；默认 100ms。
     */
    readonly pollIntervalMs?: number;
    /**
     * @description 仅供离线/headless 编排：Message 不存在时返回 unavailable 证据；真实宿主默认失败关闭。
     */
    readonly allowUnavailable?: boolean;
}

/**
 * @description 将磁盘写、AssetDB refresh/settle 与逐资源 UUID 登记收口为失败关闭事务。
 */
export class EditorMcpAssetDbTransaction {
    /**
     * @description 事务宿主。
     */
    private readonly _host: IEditorMcpAssetDbTransactionHost;

    /**
     * @description 创建 AssetDB 事务。
     * @param host 事务宿主。
     */
    public constructor(host: IEditorMcpAssetDbTransactionHost) {
        this._host = host;
    }

    /**
     * @description refresh 后等待全部资源具备 UUID 与 `.meta`，任一 pending 均抛错。
     * @param paths 工程相对路径或 `db://assets/...`。
     * @param options 事务选项。
     * @returns 可归档的登记证据。
     */
    public async commit(
        paths: readonly string[],
        options: IEditorMcpAssetDbTransactionOptions = {},
    ): Promise<IEditorMcpAssetDbTransactionEvidence> {
        const normalizedPaths = [...new Set(paths.map((pathValue) => this._normalizeDbPath(pathValue)))].sort();
        const startedAt = Date.now();
        if (normalizedPaths.length === 0) {
            const refresh = options.refresh === false ? null : await this._host.refreshForCommit([]);
            return Object.freeze({
                phase: 'assetdb_registered',
                refresh,
                polls: 0,
                waitedMs: 0,
                registrations: Object.freeze([]),
            });
        }
        const projectRoot = await this._host.requireProjectPath();
        let message: IEditorMcpAssetDbTransactionMessagePort;
        try {
            message = this._host.requireMessage();
        } catch (error: unknown) {
            if (options.allowUnavailable !== true) {
                throw error;
            }
            const refresh = options.refresh === false
                ? null
                : await this._host.refreshForCommit(normalizedPaths.map((dbPath) => dbPath.slice('db://'.length)));
            return Object.freeze({
                phase: 'assetdb_unavailable',
                refresh,
                polls: 0,
                waitedMs: Date.now() - startedAt,
                registrations: Object.freeze([]),
            });
        }
        const registrationProbes = await this._createRegistrationProbes(message, projectRoot, normalizedPaths);
        try {
            const refresh = options.refresh === false
                ? null
                : await this._host.refreshForCommit(normalizedPaths.map((dbPath) => dbPath.slice('db://'.length)));
            const requireMeta = options.requireMeta !== false;
            const timeoutMs = this._boundedInteger(options.timeoutMs, 8000, 100, 60_000);
            const pollIntervalMs = this._boundedInteger(options.pollIntervalMs, 100, 20, 1000);
            const deadline = Date.now() + timeoutMs;
            let polls = 0;
            let lastPending = normalizedPaths;
            while (Date.now() <= deadline) {
                polls += 1;
                const registrations: IEditorMcpAssetDbRegistrationEvidence[] = [];
                const pending: string[] = [];
                for (const dbPath of normalizedPaths) {
                    const evidence = await this._queryRegistration(message, projectRoot, dbPath, requireMeta);
                    if (evidence == null) {
                        pending.push(dbPath);
                    } else {
                        registrations.push(evidence);
                    }
                }
                if (pending.length === 0) {
                    return Object.freeze({
                        phase: 'assetdb_registered',
                        refresh,
                        polls,
                        waitedMs: Date.now() - startedAt,
                        registrations: Object.freeze(registrations),
                    });
                }
                lastPending = pending;
                await new Promise<void>((resolveDelay) => {
                    setTimeout(resolveDelay, pollIntervalMs);
                });
            }
            throw new Error(`editor_mcp_assetdb_registration_pending:${lastPending.join(',')}`);
        } finally {
            await this._removeRegistrationProbes(message, projectRoot, registrationProbes);
            FileAssetDependencyIndex.invalidate(projectRoot);
        }
    }

    /**
     * @description 查询单个 AssetDB 资源的当前登记身份，供首次创建协调器复用。
     * @param pathValue 工程相对路径或 `db://assets/...`。
     * @param requireMeta 是否要求相邻 `.meta` 已存在。
     * @returns 完成证据；尚未登记时返回 null。
     */
    public async queryRegistration(
        pathValue: string,
        requireMeta: boolean = true,
    ): Promise<IEditorMcpAssetDbRegistrationEvidence | null> {
        const projectRoot = await this._host.requireProjectPath();
        const message = this._host.requireMessage();
        return this._queryRegistration(message, projectRoot, this._normalizeDbPath(pathValue), requireMeta);
    }

    /**
     * @description 对尚未登记的磁盘资源，在所在目录创建短生命周期 AssetDB 资产，触发 Creator 正式登记目录与同目录资源。
     * @param message Creator 消息客户端。
     * @param projectRoot 当前工程根。
     * @param dbPaths 待登记资源路径。
     * @returns 已创建的探针 db URL。
     */
    private async _createRegistrationProbes(
        message: IEditorMcpAssetDbTransactionMessagePort,
        projectRoot: string,
        dbPaths: readonly string[],
    ): Promise<readonly string[]> {
        const directories = new Set<string>();
        for (const dbPath of dbPaths) {
            if ((await this._queryRegistration(message, projectRoot, dbPath, false)) != null) {
                continue;
            }
            const relativePath = dbPath.slice('db://'.length);
            const absolutePath = join(projectRoot, relativePath);
            if (!existsSync(absolutePath)) {
                continue;
            }
            const directoryRelativePath = statSync(absolutePath).isDirectory()
                ? relativePath
                : dirname(relativePath).replace(/\\/gu, '/');
            if (directoryRelativePath === '.' || !directoryRelativePath.startsWith('assets')) {
                continue;
            }
            directories.add(`db://${directoryRelativePath.replace(/\/+$/gu, '')}`);
        }

        const probes: string[] = [];
        try {
            for (const directory of [...directories].sort()) {
                const marker = CompatibleUuid.create().replace(/-/gu, '');
                const probeDbPath = `${directory}/__peanut_assetdb_register_${marker}.json`;
                probes.push(probeDbPath);
                await message.request('asset-db', 'create-asset', probeDbPath, '{"schemaVersion":1}\n');
            }
        } catch (error: unknown) {
            await this._removeRegistrationProbes(message, projectRoot, probes);
            throw error;
        }
        return Object.freeze(probes);
    }

    /**
     * @description 删除事务注册探针；AssetDB 删除失败时仍清理磁盘残留并交由文件监视器回收索引。
     * @param message Creator 消息客户端。
     * @param projectRoot 当前工程根。
     * @param probeDbPaths 已创建探针 db URL。
     * @returns 清理完成后返回。
     */
    private async _removeRegistrationProbes(
        message: IEditorMcpAssetDbTransactionMessagePort,
        projectRoot: string,
        probeDbPaths: readonly string[],
    ): Promise<void> {
        for (const probeDbPath of probeDbPaths) {
            await message.request('asset-db', 'delete-asset', probeDbPath).catch(() => undefined);
            const relativePath = probeDbPath.slice('db://'.length);
            rmSync(join(projectRoot, relativePath), { force: true });
            rmSync(join(projectRoot, `${relativePath}.meta`), { force: true });
        }
    }

    /**
     * @description 查询并校验单个资源登记状态。
     * @param message Creator 消息客户端。
     * @param projectRoot 当前工程根。
     * @param dbPath 规范化 db 路径。
     * @param requireMeta 是否要求 `.meta`。
     * @returns 完成证据；尚未登记时返回 null。
     */
    private async _queryRegistration(
        message: IEditorMcpAssetDbTransactionMessagePort,
        projectRoot: string,
        dbPath: string,
        requireMeta: boolean,
    ): Promise<IEditorMcpAssetDbRegistrationEvidence | null> {
        let raw: unknown;
        try {
            raw = await message.request('asset-db', 'query-asset-info', dbPath);
        } catch {
            return null;
        }
        if (!this._isRecord(raw) || typeof raw.uuid !== 'string' || raw.uuid.trim().length === 0) {
            return null;
        }
        const relativePath = dbPath.slice('db://'.length);
        const metaPresent = existsSync(join(projectRoot, `${relativePath}.meta`));
        if (requireMeta && !metaPresent) {
            return null;
        }
        return Object.freeze({
            dbPath,
            uuid: raw.uuid.trim(),
            importer: typeof raw.importer === 'string' ? raw.importer : '',
            metaPresent,
            subAssetUuids: Object.freeze(this._collectSubAssetUuids(raw.subAssets)),
        });
    }

    /**
     * @description 递归收集 AssetDB 子资源 UUID。
     * @param value 未校验 subAssets。
     * @returns 去重排序 UUID。
     */
    private _collectSubAssetUuids(value: unknown): readonly string[] {
        if (!this._isRecord(value)) {
            return Object.freeze([]);
        }
        const uuids = new Set<string>();
        for (const child of Object.values(value)) {
            if (!this._isRecord(child)) {
                continue;
            }
            if (typeof child.uuid === 'string' && child.uuid.trim().length > 0) {
                uuids.add(child.uuid.trim());
            }
            for (const nestedUuid of this._collectSubAssetUuids(child.subAssets)) {
                uuids.add(nestedUuid);
            }
        }
        return Object.freeze([...uuids].sort());
    }

    /**
     * @description 规范化项目资产路径并拒绝非 AssetDB 目标。
     * @param value 原始路径。
     * @returns `db://assets/...`。
     */
    private _normalizeDbPath(value: string): string {
        const normalized = value.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
        const dbPath = normalized.startsWith('db://') ? normalized : `db://${normalized}`;
        if (dbPath !== 'db://assets' && !dbPath.startsWith('db://assets/')) {
            throw new Error(`editor_mcp_assetdb_transaction_path_invalid:${value}`);
        }
        if (dbPath.split('/').some((segment) => segment === '..' || segment === '.')) {
            throw new Error(`editor_mcp_assetdb_transaction_path_invalid:${value}`);
        }
        return dbPath;
    }

    /**
     * @description 将数值限制在安全整数范围。
     * @param value 可选输入。
     * @param fallback 默认值。
     * @param minimum 最小值。
     * @param maximum 最大值。
     * @returns 安全整数。
     */
    private _boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
        if (value == null || !Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(maximum, Math.max(minimum, Math.floor(value)));
    }

    /**
     * @description 判断值是否为普通对象。
     * @param value 未知值。
     * @returns 普通对象时返回 true。
     */
    private _isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}
