import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import { LumenAssetDbReadyWaiter } from '../io/asset-db-ready-waiter';
import { TiledMapImportImages } from './tiled-map-import-images';
import { BitmapFontImportFrames } from './bitmap-font-import-frames';
import { AssetImportPlanner, type IAssetImportPlan, type IAssetImportPlannerOptions } from './asset-import-planner';

/**
 * @description 可选的日志后置检查摘要（由调用方注入，避免 lumen 依赖 runtime）。
 */
export interface IAssetImportPostflightSummary {
    /** @description 是否检查了日志。 */
    readonly logChecked: boolean;
    /** @description 是否无相关错误。 */
    readonly verified: boolean;
    /** @description 其它结构化字段。 */
    readonly [key: string]: unknown;
}

/**
 * @description 分层导入所需的最小消息端口。
 */
export interface IAssetImportMessagePort {
    /**
     * @description 向 Creator 发送请求。
     * @param target 目标。
     * @param message 消息。
     * @param args 参数。
     * @returns 结果。
     */
    request(target: string, message: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * @description 单项导入结果。
 */
export interface IAssetImportItemResult {
    /** @description 源文件路径。 */
    readonly source: string;
    /** @description 目标 db 路径。 */
    readonly targetDbPath: string;
    /** @description 宿主导入结果。 */
    readonly result: unknown;
    /** @description 所在层索引。 */
    readonly layer: number;
}

/**
 * @description 分层导入执行结果。
 */
export interface IAssetImportBatchResult {
    /** @description 按层序稳定排列的导入结果。 */
    readonly imported: readonly IAssetImportItemResult[];
    /** @description 目标目录。 */
    readonly target: string;
    /** @description 使用的计划。 */
    readonly plan: IAssetImportPlan;
    /** @description 全部成功。 */
    readonly allSucceeded: true;
    /** @description 可选 postflight。 */
    readonly postflight?: IAssetImportPostflightSummary;
}

/**
 * @description 分层导入执行参数。
 */
export interface IAssetImportBatchRequest {
    /** @description 源路径列表。 */
    readonly sources: readonly string[];
    /** @description 目标 `db://assets/...` 目录。 */
    readonly target: string;
    /** @description 是否覆盖。 */
    readonly overwrite?: boolean;
    /** @description 显式依赖。 */
    readonly dependencyMap?: Readonly<Record<string, readonly string[]>>;
    /** @description 层内并发度。 */
    readonly concurrency?: number;
    /** @description 层后是否刷新并等待。 */
    readonly refreshAfter?: boolean;
    /** @description 是否允许缺失依赖。 */
    readonly allowMissingDependencies?: boolean;
    /** @description 是否展开依赖闭包。 */
    readonly expandClosure?: boolean;
    /** @description 项目根；提供时在整批结束后做 project.log 增量检查。 */
    readonly projectRoot?: string;
    /** @description 可选 postflight 读取器。 */
    readonly readPostflight?: (projectRoot: string) => Promise<IAssetImportPostflightSummary> | IAssetImportPostflightSummary;
}

/**
 * @description 执行「闭包分析 → 分层导入 → 层间稳定等待 → 可选日志验证」。
 */
export class AssetImportBatchExecutor {
    /** @description 规划器。 */
    private readonly _planner: AssetImportPlanner;
    /** @description 消息端口。 */
    private readonly _message: IAssetImportMessagePort;
    /** @description 稳定等待超时毫秒。 */
    private readonly _readyTimeoutMs: number;

    /**
     * @description 创建执行器。
     * @param message Creator 消息端口。
     * @param readyTimeoutMs AssetDB ready 等待上限。
     */
    public constructor(message: IAssetImportMessagePort, readyTimeoutMs = 10_000) {
        this._message = message;
        this._planner = new AssetImportPlanner();
        this._readyTimeoutMs = readyTimeoutMs;
    }

    /**
     * @description 仅生成计划（含可选闭包）。
     * @param sources 源路径。
     * @param options 规划选项。
     * @returns 计划。
     */
    public plan(sources: readonly string[], options: IAssetImportPlannerOptions = {}): IAssetImportPlan {
        return this._planner.plan(sources, {
            ...options,
            expandClosure: options.expandClosure ?? true,
        });
    }

    /**
     * @description 按依赖拓扑分层导入，并在每层后等待 AssetDB 稳定。
     * @param request 导入请求。
     * @returns 稳定顺序的导入结果。
     */
    public async importBatch(request: IAssetImportBatchRequest): Promise<IAssetImportBatchResult> {
        const target = this._readTarget(request.target);
        const overwrite = request.overwrite === true;
        const plan = this._planner.plan(request.sources, {
            dependencyMap: request.dependencyMap,
            expandClosure: request.expandClosure !== false,
        });
        if (plan.cycles.length > 0) {
            throw new Error(`asset_import_dependency_cycle:${plan.cycles.join(',')}`);
        }
        if (plan.missingDependencies.length > 0 && request.allowMissingDependencies !== true) {
            const detail = plan.missingDependencies.map((item) => `${item.source}->${item.dependency}`).join(',');
            throw new Error(`asset_import_missing_dependencies:${detail}`);
        }
        const allSources = this._planner.flatten(plan);
        this._planner.assertUniqueImportTargets(allSources, target);
        if (request.projectRoot != null && request.projectRoot.trim().length > 0) {
            this._planner.assertSourcesNotAlreadyAtTarget(allSources, target, request.projectRoot);
        }
        const concurrency = this._readConcurrency(request.concurrency, 4);
        const imported: IAssetImportItemResult[] = [];
        const tiledImages = new TiledMapImportImages(this._message, this._readyTimeoutMs);
        tiledImages.validate(plan, request.projectRoot, target);
        const fontImages = new BitmapFontImportFrames(this._message, this._readyTimeoutMs);
        fontImages.validate(plan, request.projectRoot, target);
        for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex += 1) {
            const layer = [...(plan.layers[layerIndex] ?? [])];
            await tiledImages.beforeLayer(layer, imported, request.projectRoot, target);
            await fontImages.beforeLayer(layer, imported, request.projectRoot, target);
            const layerResults: Array<IAssetImportItemResult | undefined> = new Array(layer.length);
            await this._mapWithConcurrency(
                layer.map((item, index) => ({ item, index })),
                concurrency,
                async ({ item, index }) => {
                    const plannedTargetDbPath = this._planner.joinDbPath(target, basename(item.source));
                    const result = await this._importOne(item.source, plannedTargetDbPath, overwrite);
                    if (result == null) {
                        throw new Error(`asset_import_native_result_missing:${plannedTargetDbPath}`);
                    }
                    // Creator rename 时以返回 url 为准，避免账本记错目标。
                    const actualTargetDbPath = this._readActualTargetDbPath(result, plannedTargetDbPath);
                    layerResults[index] = {
                        source: item.source,
                        targetDbPath: actualTargetDbPath,
                        result,
                        layer: layerIndex,
                    };
                },
            );
            for (const item of layerResults) {
                if (item != null) {
                    imported.push(item);
                }
            }
            if (request.refreshAfter !== false) {
                if (fontImages.appliesTo(layer)) {
                    await fontImages.refresh(target);
                } else if (tiledImages.appliesTo(layer)) {
                    await tiledImages.refresh(target);
                } else {
                    await this._refreshAndWait(target);
                }
            }
            await tiledImages.afterLayer(layer, imported, request.projectRoot);
            await fontImages.afterLayer(layer, imported, request.projectRoot);
        }
        const batch: IAssetImportBatchResult = {
            imported,
            target,
            plan,
            allSucceeded: true,
        };
        if (request.projectRoot != null && request.readPostflight != null) {
            return {
                ...batch,
                postflight: await request.readPostflight(request.projectRoot),
            };
        }
        return batch;
    }

    /**
     * @description 从宿主导入结果读取实际落盘 db 路径（rename 时可能与计划不同）。
     * @param result 宿主返回。
     * @param fallback 计划目标。
     * @returns 实际目标。
     */
    private _readActualTargetDbPath(result: unknown, fallback: string): string {
        if (result == null || typeof result !== 'object' || Array.isArray(result)) {
            return fallback;
        }
        const record = result as Record<string, unknown>;
        for (const key of ['url', 'targetDbPath', 'source'] as const) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().startsWith('db://')) {
                return value.trim();
            }
        }
        return fallback;
    }

    /**
     * @description 使用已声明主导入方法；异常直接传播，不向其它方法盲重放。
     * @param source 源路径。
     * @param targetDbPath 目标 db 路径。
     * @param overwrite 是否覆盖。
     * @returns 宿主结果。
     */
    private async _importOne(source: string, targetDbPath: string, overwrite: boolean): Promise<unknown> {
        const options = { overwrite, rename: !overwrite };
        // rename 副本若携带源 .meta uuid，会与已存在资源冲突；剥离 meta 让 AssetDB 分配新 uuid。
        const staged = overwrite ? null : this._stageSourceWithoutMeta(source);
        const importSource = staged?.filePath ?? source;
        try {
            return await this._message.request('asset-db', 'import-asset', importSource, targetDbPath, options);
        } finally {
            staged?.cleanup();
        }
    }

    /**
     * @description 复制源文件到临时目录且不附带 `.meta`，避免 rename 导入复用旧 uuid。
     * @param source 源绝对/相对路径。
     * @returns 临时文件与清理回调；源不存在时返回 null。
     */
    private _stageSourceWithoutMeta(source: string): { readonly filePath: string; readonly cleanup: () => void } | null {
        if (!existsSync(source)) {
            return null;
        }
        const directory = mkdtempSync(join(tmpdir(), 'peanut-asset-import-'));
        const filePath = join(directory, basename(source));
        try {
            copyFileSync(source, filePath);
        } catch {
            rmSync(directory, { recursive: true, force: true });
            return null;
        }
        return {
            filePath,
            cleanup: (): void => {
                rmSync(directory, { recursive: true, force: true });
            },
        };
    }

    /**
     * @description 必需原生刷新后等待 AssetDB ready；异常直接传播，不吞掉或重放。
     * @param target 目标目录。
     */
    private async _refreshAndWait(target: string): Promise<void> {
        const directory = target.endsWith('/') ? target : `${target}/`;
        await this._message.request('asset-db', 'refresh-asset', directory);
        await new LumenAssetDbReadyWaiter(this._message).wait({
            timeoutMs: this._readyTimeoutMs,
            intervalMs: 100,
        });
    }

    /**
     * @description 有限并发映射；首个失败停止取新项并等待全部在途项结束后传播原错误。
     * @param items 输入。
     * @param concurrency 并发。
     * @param worker 工作函数。
     */
    private async _mapWithConcurrency<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
        let cursor = 0;
        let failed = false;
        let firstError: unknown;
        const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (!failed && cursor < items.length) {
                const index = cursor;
                cursor += 1;
                const item = items[index];
                if (item != null) {
                    try {
                        await worker(item);
                    } catch (error: unknown) {
                        if (!failed) {
                            failed = true;
                            firstError = error;
                        }
                    }
                }
            }
        });
        await Promise.all(runners);
        if (failed) { throw firstError; }
    }

    /**
     * @description 校验目标目录。
     * @param target 未校验输入。
     * @returns 规范化目标。
     */
    private _readTarget(target: string): string {
        if (typeof target !== 'string' || target.trim().length === 0) {
            throw new Error('asset_import_target_required');
        }
        const trimmed = target.trim().replace(/\\/gu, '/');
        if (!trimmed.startsWith('db://assets')) {
            throw new Error('asset_import_target_must_be_db_assets');
        }
        return trimmed.replace(/\/+$/u, '');
    }

    /**
     * @description 读取并发度。
     * @param value 输入。
     * @param fallback 默认。
     * @returns 1–8。
     */
    private _readConcurrency(value: number | undefined, fallback: number): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return fallback;
        }
        return Math.max(1, Math.min(8, Math.floor(value)));
    }
}
