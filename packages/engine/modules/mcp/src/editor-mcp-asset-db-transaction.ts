import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { AssetMetaParser, CompatibleUuid, FileAssetDependencyIndex } from '@peanut/pod-engine/assets';
import { EditorMcpAssetReimport } from './editor-mcp-asset-reimport.js';

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
     * @description 文本严格模式下实际meta物理身份。
     */
    readonly metaIdentity?: string;
    /**
     * @description 文本严格模式下实际meta字节摘要。
     */
    readonly metaSha256?: string;
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
     * @description 文本 writer 专用严格身份与失败关闭模式；其它资源默认不变。
     */
    readonly textVerification?: boolean;
    /**
     * @description 在文本登记探针可能变化前通知原调用账本。
     */
    readonly beforePossibleMutation?: () => void;
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
     * @description 在原 writer 收口内重新导入已登记代码，复用实际原生调用与源身份校验。
     * @param paths 已存在且已通过写后登记的工程相对资源路径。
     * @returns 已核验的原生重导入回执。
     */
    public async reimportRegistered(paths: readonly string[]): Promise<unknown> {
        return EditorMcpAssetReimport.execute(await this._host.requireProjectPath(), paths,
            this._host.requireMessage(), this);
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
        const registrationProbes = await this._createRegistrationProbes(message, projectRoot, normalizedPaths, options);
        let firstFailure: unknown;
        try {
            const refresh = options.refresh === false
                ? null
                : await this._host.refreshForCommit(normalizedPaths.map((dbPath) => dbPath.slice('db://'.length)));
            if (options.textVerification === true) {
                const body = this._isRecord(refresh) && this._isRecord(refresh.result) ? refresh.result : refresh;
                const settle = this._isRecord(body) ? body.settle : null;
                if (!this._isRecord(body) || body.ok === false || body.ready === false || body.settled === false
                    || this._hasTextRefreshFailure(refresh) || this._hasTextRefreshFailure(body)
                    || this._isRecord(refresh) && refresh.barrier === true && !this._isRecord(settle)
                    || settle != null && (!this._isRecord(settle) || settle.ready !== true || settle.pending !== 0
                        || settle.softFailCount !== 0 || settle.overBudget !== false || this._hasTextRefreshFailure(settle))) {
                    throw new Error('text_file_io_refresh_not_settled');
                }
            }
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
                    const evidence = await this._queryRegistration(message, projectRoot, dbPath, requireMeta, options.textVerification === true);
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
        } catch (error: unknown) {
            firstFailure = error;
            throw error;
        } finally {
            try {
                await this._removeRegistrationProbes(message, projectRoot, registrationProbes, options.textVerification === true);
            } catch (cleanupError: unknown) {
                if (firstFailure == null) {
                    throw cleanupError;
                }
                if (firstFailure instanceof Error) {
                    Object.assign(firstFailure, { probeCleanupFailure: cleanupError });
                }
            }
            FileAssetDependencyIndex.invalidate(projectRoot);
        }
    }


    /**
     * @description 文本专用登记校验，查询异常是未知而不是未登记，逐次读回安全 meta。
     * @param pathValue 规范资产路径。
     * @param expectedUuid 已有 UUID；提供时必须保持。
     * @returns 实际登记证据；明确未登记返回 null。
     */
    public async queryTextRegistration(pathValue: string, expectedUuid?: string): Promise<IEditorMcpAssetDbRegistrationEvidence | null> {
        const projectRoot = await this._host.requireProjectPath();
        const evidence = await this._queryRegistration(this._host.requireMessage(), projectRoot, this._normalizeDbPath(pathValue), true, true);
        if (evidence != null && expectedUuid != null && evidence.uuid !== expectedUuid) {
            throw new Error('text_file_io_uuid_conflict');
        }
        return evidence;
    }

    /**
     * @description 有限无链接读取实际 meta 并核实前后物理身份和内容。
     * @param projectRoot 真实工程。
     * @param relativePath 规范资产路径。
     * @param uuid AssetDB 实际 UUID。
     */
    private _verifyTextMeta(projectRoot: string, relativePath: string, uuid: string): { readonly identity: string; readonly sha256: string } {
        const path = join(projectRoot, relativePath + '.meta');
        const root = realpathSync(projectRoot);
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024
            || realpathSync(path) !== path || !path.startsWith(join(root, 'assets') + sep)) {
            throw new Error('text_file_io_meta_unsafe');
        }
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const before = fstatSync(fd);
            if (before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size) {
                throw new Error('text_file_io_meta_changed');
            }
            const bytes = Buffer.alloc(before.size + 1);
            let used = 0;
            while (used < bytes.length) {
                const count = readSync(fd, bytes, used, bytes.length - used, null);
                if (count === 0) {
                    break;
                }
                used += count;
            }
            const after = fstatSync(fd);
            const current = lstatSync(path);
            if (used !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
                || current.dev !== before.dev || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) {
                throw new Error('text_file_io_meta_changed');
            }
            const raw = bytes.subarray(0, used);
            const text = raw.toString('utf8');
            if (!Buffer.from(text, 'utf8').equals(raw)) {
                throw new Error('text_file_io_meta_invalid');
            }
            const meta = new AssetMetaParser().parse(text, relativePath + '.meta');
            if (meta.uuid !== uuid) {
                throw new Error('text_file_io_uuid_conflict');
            }
            return { identity: `${before.dev}:${before.ino}`, sha256: createHash('sha256').update(raw).digest('hex') };
        } finally {
            closeSync(fd);
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
        options: IEditorMcpAssetDbTransactionOptions = {},
    ): Promise<readonly string[]> {
        const directories = new Set<string>();
        for (const dbPath of dbPaths) {
            if ((await this._queryRegistration(message, projectRoot, dbPath, false, options.textVerification === true)) != null) {
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
                options.beforePossibleMutation?.();
                probes.push(probeDbPath);
                await message.request('asset-db', 'create-asset', probeDbPath, '{"schemaVersion":1}\n');
            }
        } catch (error: unknown) {
            try {
                await this._removeRegistrationProbes(message, projectRoot, probes, options.textVerification === true);
            } catch (cleanupError: unknown) {
                if (error instanceof Error) {
                    Object.assign(error, { probeCleanupFailure: cleanupError });
                }
            }
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
        strict = false,
    ): Promise<void> {
        for (const probeDbPath of probeDbPaths) {
            if (strict) {
                await message.request('asset-db', 'delete-asset', probeDbPath);
            } else {
                await message.request('asset-db', 'delete-asset', probeDbPath).catch(() => undefined);
            }
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
        strict = false,
    ): Promise<IEditorMcpAssetDbRegistrationEvidence | null> {
        let raw: unknown;
        try {
            raw = await message.request('asset-db', 'query-asset-info', dbPath);
        } catch (error: unknown) {
            if (strict) {
                throw error;
            }
            return null;
        }
        if (strict && raw !== null && (!this._isRecord(raw) || typeof raw.uuid !== 'string'
            || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(raw.uuid))) {
            throw new Error('text_file_io_registration_invalid');
        }
        if (!this._isRecord(raw) || typeof raw.uuid !== 'string' || raw.uuid.trim().length === 0) {
            return null;
        }
        const relativePath = dbPath.slice('db://'.length);
        const metaPresent = existsSync(join(projectRoot, `${relativePath}.meta`));
        if (requireMeta && !metaPresent) {
            return null;
        }
        const meta = strict && requireMeta ? this._verifyTextMeta(projectRoot, relativePath, raw.uuid.trim()) : null;
        return Object.freeze({
            dbPath,
            uuid: raw.uuid.trim(),
            importer: typeof raw.importer === 'string' ? raw.importer : '',
            metaPresent,
            ...(meta == null ? {} : { metaIdentity: meta.identity, metaSha256: meta.sha256 }),
            subAssetUuids: Object.freeze(strict ? [] : this._collectSubAssetUuids(raw.subAssets)),
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
     * @description 拒绝实际刷新返回中明确的失败、错误对象或非零错误计数。
     * @param value 原刷新或 settle 返回。
     * @returns 是否已有明确失败证据。
     */
    private _hasTextRefreshFailure(value: unknown): boolean {
        if (!this._isRecord(value)) {
            return false;
        }
        return value.ok === false || value.ready === false || value.settled === false
            || value.error != null && value.error !== '' && value.error !== false
            || value.errors != null && (!Array.isArray(value.errors) || value.errors.length > 0)
            || value.errorCount != null && value.errorCount !== 0;
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
