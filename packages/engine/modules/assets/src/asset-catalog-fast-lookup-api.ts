import { join } from 'path';

import type { AssetCatalogBucket, IAssetCatalogEntry } from './catalog-types';
import { AssetCatalogPathResolver } from './asset-catalog-path-resolver';
import { AssetCatalogQueryGateway } from './asset-catalog-query-gateway';
import { AssetCatalogQueryService } from './asset-catalog-query-service';
import { AssetCatalogRefreshService } from './asset-catalog-refresh-service';
import { AssetCatalogStore, type IAssetCatalogSummary } from './asset-catalog-store';
import type { IAssetDbQueryClient } from './asset-db-query-client';

/**
 * @description MCP 快查请求：uuid 精确查，或 type/name/path 过滤。
 */
export interface IAssetCatalogMcpLookupInput {
    /** @description 精确 UUID。 */
    readonly uuid?: string;
    /** @description 类型分桶。 */
    readonly type?: AssetCatalogBucket | string;
    /** @description 文件名子串。 */
    readonly name?: string;
    /** @description 路径子串。 */
    readonly path?: string;
    /** @description 返回条数上限，默认 20，最大 50。 */
    readonly limit?: number;
}

/**
 * @description MCP 返回的精简命中项（控制 token）。
 */
export interface IAssetCatalogMcpHit {
    /** @description 类型。 */
    readonly type: AssetCatalogBucket;
    /** @description 路径。 */
    readonly path: string;
    /** @description UUID。 */
    readonly uuid: string;
    /** @description 压缩 UUID。 */
    readonly compressedUuid: string;
    /** @description 文件名。 */
    readonly name: string;
}

/**
 * @description MCP summary 响应。
 */
export interface IAssetCatalogMcpSummaryResult {
    /** @description 生成时间。 */
    readonly generatedAt: string;
    /** @description 各类型计数。 */
    readonly counts: IAssetCatalogSummary['counts'];
    /** @description 冲突数。 */
    readonly conflictCount: number;
}

/**
 * @description 尚未初始化目录的明确只读响应，不伪造摘要或写缓存。
 */
export interface IAssetCatalogMcpSummaryUnavailableResult {
    /**
     * @description 当前无有效摘要。
     */
    readonly available: false;
    /**
     * @description 明确拒绝本次读取。
     */
    readonly availability: 'refused';
    /**
     * @description 稳定的初始化状态码。
     */
    readonly code: 'asset_catalog_not_initialized';
    /**
     * @description 不包含本机路径的状态说明。
     */
    readonly message: 'asset_catalog_not_initialized';
    /**
     * @description 需要另行审批的初始化操作。
     */
    readonly recommendedAction: 'asset.catalog.refresh';
}

/**
 * @description MCP lookup 响应。
 */
export interface IAssetCatalogMcpLookupResult {
    /** @description 命中数量。 */
    readonly count: number;
    /** @description 精简命中列表。 */
    readonly hits: readonly IAssetCatalogMcpHit[];
}

/**
 * @description MCP refresh 响应。
 */
export interface IAssetCatalogMcpRefreshResult extends IAssetCatalogMcpSummaryResult {
    /** @description 摘要文件路径。 */
    readonly summaryPath: string;
}

/**
 * @description 面向 Cocos MCP 扩展的资产目录快查接口（内存缓存 + 分片读取）。
 */
export class AssetCatalogFastLookupApi {
    /** @description 单次查询默认条数。 */
    public static readonly defaultLimit = 20;
    /** @description 单次查询最大条数，防止 MCP 回包过大。 */
    public static readonly maxLimit = 50;

    /** @description 路径解析。 */
    private readonly _paths: AssetCatalogPathResolver;
    /** @description 分片存储。 */
    private readonly _store: AssetCatalogStore;
    /** @description 查询网关。 */
    private readonly _gateway: AssetCatalogQueryGateway;
    /** @description 类型解析。 */
    private readonly _queryService: AssetCatalogQueryService;
    /** @description 刷新服务。 */
    private readonly _refreshService: AssetCatalogRefreshService;
    /** @description 按输出目录缓存的摘要生成时间，用于判定是否失效。 */
    private readonly _summaryGeneratedAtByOutput = new Map<string, string>();
    /** @description 按输出目录缓存的 UUID 倒排。 */
    private readonly _uuidMapCache = new Map<string, ReadonlyMap<string, IAssetCatalogMcpHit>>();

    /**
     * @description 创建 MCP 快查接口。
     * @param paths 路径解析器。
     * @param store 分片存储。
     * @param gateway 查询网关。
     * @param queryService 查询服务。
     * @param refreshService 刷新服务。
     */
    public constructor(
        paths: AssetCatalogPathResolver = new AssetCatalogPathResolver(),
        store: AssetCatalogStore = new AssetCatalogStore(),
        gateway: AssetCatalogQueryGateway = new AssetCatalogQueryGateway(),
        queryService: AssetCatalogQueryService = new AssetCatalogQueryService(),
        refreshService: AssetCatalogRefreshService = new AssetCatalogRefreshService(),
    ) {
        this._paths = paths;
        this._store = store;
        this._gateway = gateway;
        this._queryService = queryService;
        this._refreshService = refreshService;
    }

    /**
     * @description 返回目录规模摘要（极小 payload）。
     * @param projectRoot 项目根绝对或相对路径。
     * @param cwd 工作目录。
     * @returns MCP summary 结果。
     */
    public summary(projectRoot: string, cwd: string = process.cwd()): IAssetCatalogMcpSummaryResult | IAssetCatalogMcpSummaryUnavailableResult {
        const outputDirectory = join(this._paths.resolveProjectRoot(projectRoot, cwd), AssetCatalogPathResolver.defaultOutputRelativePath);
        let summary: IAssetCatalogSummary;
        try {
            summary = this._store.readSummary(outputDirectory);
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT'
                && Reflect.get(error, 'syscall') === 'open'
                && Reflect.get(error, 'path') === join(outputDirectory, AssetCatalogStore.summaryFileName)) {
                return { available: false, availability: 'refused', code: 'asset_catalog_not_initialized',
                    message: 'asset_catalog_not_initialized', recommendedAction: 'asset.catalog.refresh' };
            }
            throw error;
        }
        this._summaryGeneratedAtByOutput.set(outputDirectory, summary.generatedAt);
        return {
            generatedAt: summary.generatedAt,
            counts: summary.counts,
            conflictCount: summary.conflictCount,
        };
    }

    /**
     * @description 快查：uuid 走内存倒排；否则只读对应类型分片。
     * @param projectRoot 项目根。
     * @param input MCP 查询输入。
     * @param cwd 工作目录。
     * @returns 精简命中列表。
     */
    public lookup(projectRoot: string, input: IAssetCatalogMcpLookupInput, cwd: string = process.cwd()): IAssetCatalogMcpLookupResult {
        const outputDirectory = this._resolveOutput(projectRoot, cwd);
        const limit = this._normalizeLimit(input.limit);
        const uuid = input.uuid?.trim();
        if (uuid != null && uuid.length > 0) {
            const hit = this._lookupUuidCached(outputDirectory, uuid);
            return {
                count: hit == null ? 0 : 1,
                hits: hit == null ? [] : [hit],
            };
        }
        const type = input.type == null || String(input.type).trim().length === 0
            ? undefined
            : this._queryService.parseType(String(input.type).trim());
        const hits = this._gateway.query(outputDirectory, {
            type,
            nameContains: input.name,
            pathContains: input.path,
            limit,
        }).map((entry) => this._toHit(entry));
        return {
            count: hits.length,
            hits,
        };
    }

    /**
     * @description 重建目录分片并清空快查缓存。
     * @param projectRoot 项目根。
     * @param cwd 工作目录。
     * @returns 刷新后的摘要。
     */
    public refresh(projectRoot: string, cwd: string = process.cwd()): IAssetCatalogMcpRefreshResult {
        const result = this._refreshService.refresh(projectRoot, undefined, cwd);
        const outputDirectory = this._paths.resolveOutputDirectory(
            this._paths.resolveProjectRoot(projectRoot, cwd),
            undefined,
            cwd,
        );
        this._uuidMapCache.delete(outputDirectory);
        this._summaryGeneratedAtByOutput.set(outputDirectory, result.summary.generatedAt);
        return {
            summaryPath: result.catalogPath,
            generatedAt: result.summary.generatedAt,
            counts: result.summary.counts,
            conflictCount: result.summary.conflictCount,
        };
    }

    /**
     * @description 优先经 AssetDB 消息重建目录；无 client 时回退 meta。
     * @param projectRoot 项目根。
     * @param cwd 工作目录。
     * @param assetDb 可选 AssetDB 客户端。
     * @returns 刷新后的摘要与来源。
     */
    public async refreshPreferringAssetDb(
        projectRoot: string,
        cwd: string = process.cwd(),
        assetDb?: IAssetDbQueryClient,
    ): Promise<IAssetCatalogMcpRefreshResult & { readonly source: 'asset-db' | 'meta' }> {
        const result = await this._refreshService.refreshPreferringAssetDb(projectRoot, undefined, cwd, assetDb);
        const outputDirectory = this._paths.resolveOutputDirectory(
            this._paths.resolveProjectRoot(projectRoot, cwd),
            undefined,
            cwd,
        );
        this._uuidMapCache.delete(outputDirectory);
        this._summaryGeneratedAtByOutput.set(outputDirectory, result.summary.generatedAt);
        return {
            summaryPath: result.catalogPath,
            generatedAt: result.summary.generatedAt,
            counts: result.summary.counts,
            conflictCount: result.summary.conflictCount,
            source: result.source,
        };
    }

    /**
     * @description 解析输出目录并确保摘要可读。
     * @param projectRoot 项目根。
     * @param cwd 工作目录。
     * @returns 输出目录绝对路径。
     */
    private _resolveOutput(projectRoot: string, cwd: string): string {
        const absoluteProject = this._paths.resolveProjectRoot(projectRoot, cwd);
        return this._paths.resolveOutputDirectory(absoluteProject, undefined, cwd);
    }

    /**
     * @description 规范化 limit。
     * @param limit 原始 limit。
     * @returns 合法 limit。
     */
    private _normalizeLimit(limit: number | undefined): number {
        if (limit == null) {
            return AssetCatalogFastLookupApi.defaultLimit;
        }
        if (!Number.isInteger(limit) || limit < 1) {
            throw new Error(`invalid_query_limit:${String(limit)}`);
        }
        return Math.min(limit, AssetCatalogFastLookupApi.maxLimit);
    }

    /**
     * @description 带缓存的 UUID 快查。
     * @param outputDirectory 输出目录。
     * @param uuid UUID。
     * @returns 命中或 null。
     */
    private _lookupUuidCached(outputDirectory: string, uuid: string): IAssetCatalogMcpHit | null {
        const map = this._ensureUuidMapCache(outputDirectory);
        return map.get(uuid) ?? null;
    }

    /**
     * @description 确保 UUID 倒排已加载到内存。
     * @param outputDirectory 输出目录。
     * @returns UUID → hit 映射。
     */
    private _ensureUuidMapCache(outputDirectory: string): ReadonlyMap<string, IAssetCatalogMcpHit> {
        const summary = this._store.readSummary(outputDirectory);
        const cachedGeneratedAt = this._summaryGeneratedAtByOutput.get(outputDirectory);
        const cached = this._uuidMapCache.get(outputDirectory);
        if (cached != null && cachedGeneratedAt === summary.generatedAt) {
            return cached;
        }
        const document = this._store.readUuidMap(outputDirectory);
        const map = new Map<string, IAssetCatalogMcpHit>();
        for (const [uuid, entry] of Object.entries(document)) {
            map.set(uuid, {
                type: entry.type,
                path: entry.path,
                uuid,
                compressedUuid: entry.compressedUuid,
                name: entry.name,
            });
        }
        this._uuidMapCache.set(outputDirectory, map);
        this._summaryGeneratedAtByOutput.set(outputDirectory, summary.generatedAt);
        return map;
    }

    /**
     * @description 将完整条目压成 MCP hit。
     * @param entry 目录条目。
     * @returns MCP hit。
     */
    private _toHit(entry: IAssetCatalogEntry): IAssetCatalogMcpHit {
        return {
            type: entry.type,
            path: entry.path,
            uuid: entry.uuid,
            compressedUuid: entry.compressedUuid,
            name: entry.name,
        };
    }
}

/**
 * @description 可注入的资产目录快查能力（便于 MCP 插件与测试替换实现）。
 */
export type IAssetCatalogFastLookup = Pick<
    AssetCatalogFastLookupApi,
    'summary' | 'lookup' | 'refresh' | 'refreshPreferringAssetDb'
>;
