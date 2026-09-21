import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CompatibleUuid, FileAssetDependencyIndex } from '@peanut/pod-engine/assets';

import {
    EditorMcpAssetDbTransaction,
    type IEditorMcpAssetDbRegistrationEvidence,
    type IEditorMcpAssetDbTransactionMessagePort,
} from './editor-mcp-asset-db-transaction.js';
import { EditorMcpAssetDbCreationError } from './editor-mcp-asset-db-creation-error.js';

export { EditorMcpAssetDbCreationError } from './editor-mcp-asset-db-creation-error.js';

/**
 * @description 首次创建生命周期边界。
 */
export interface IEditorMcpAssetDbCreationLifecycle {
    /**
     * @description 任务取消信号。
     */
    readonly signal?: AbortSignal;
    /**
     * @description 进入不可逆发布窗口；返回 false 表示取消已经生效。
     */
    readonly enterCommitWindow?: () => boolean;
}

/**
 * @description AssetDB 首次创建阶段。
 */
export type EditorMcpAssetDbCreationPhase =
    | 'reserved'
    | 'parent_ready'
    | 'publishing'
    | 'registered'
    | 'verified';

/**
 * @description 首次创建失败后的项目状态判定。
 */
export type EditorMcpAssetDbCreationProjectState = 'unchanged' | 'may_have_changed';

/**
 * @description 首次创建清理摘要。
 */
export interface IEditorMcpAssetDbCreationCleanupEvidence {
    /**
     * @description 是否尝试删除主资源。
     */
    readonly attempted: boolean;
    /**
     * @description 是否已证明主资源、`.meta` 与 AssetDB 登记均不存在。
     */
    readonly complete: boolean;
    /**
     * @description 所有权不匹配时为 true，协调器不会继续删除。
     */
    readonly ownershipMismatch: boolean;
}

/**
 * @description 可安全投影到任务证据的首次创建结果。
 */
export interface IEditorMcpAssetDbCreationEvidence {
    /**
     * @description 创建状态机最后完成阶段。
     */
    readonly phase: EditorMcpAssetDbCreationPhase;
    /**
     * @description 规范化目标 db URL。
     */
    readonly targetDbPath: string;
    /**
     * @description 资源种类。
     */
    readonly resourceType: 'prefab' | 'scene';
    /**
     * @description AssetDB 主资源 UUID。
     */
    readonly uuid: string;
    /**
     * @description `.meta` 是否就绪。
     */
    readonly metaPresent: boolean;
    /**
     * @description AssetDB 子资源 UUID 摘要。
     */
    readonly subAssetUuids: readonly string[];
    /**
     * @description 父目录是否已通过 AssetDB 屏障登记。
     */
    readonly parentRegistered: boolean;
    /**
     * @description 主资源身份查询轮次。
     */
    readonly polls: number;
    /**
     * @description 创建与登记等待耗时。
     */
    readonly waitedMs: number;
    /**
     * @description 成功路径无须清理主资源。
     */
    readonly cleanup: IEditorMcpAssetDbCreationCleanupEvidence;
    /**
     * @description 成功后项目状态。
     */
    readonly projectState: 'changed';
}

/**
 * @description 首次创建结构化失败证据。
 */
export interface IEditorMcpAssetDbCreationFailureEvidence {
    /**
     * @description 最后完成阶段。
     */
    readonly phase: EditorMcpAssetDbCreationPhase;
    /**
     * @description 规范化目标 db URL。
     */
    readonly targetDbPath: string;
    /**
     * @description 资源种类。
     */
    readonly resourceType: 'prefab' | 'scene';
    /**
     * @description 清理摘要。
     */
    readonly cleanup: IEditorMcpAssetDbCreationCleanupEvidence;
    /**
     * @description 保守项目状态。
     */
    readonly projectState: EditorMcpAssetDbCreationProjectState;
    /**
     * @description 推荐先执行的只读查询。
     */
    readonly recommendedQuery: 'asset.queryInfo';
}

/**
 * @description 首次创建协调器宿主依赖。
 */
export interface IEditorMcpAssetDbCreationCoordinatorHost {
    /**
     * @description 当前工程根。
     */
    readonly requireProjectPath: () => Promise<string>;
    /**
     * @description 当前授权 Creator message。
     */
    readonly requireMessage: () => IEditorMcpAssetDbTransactionMessagePort;
    /**
     * @description 复用现有 AssetDB 身份查询。
     */
    readonly transaction: EditorMcpAssetDbTransaction;
}

/**
 * @description 首次创建请求。
 */
export interface IEditorMcpAssetDbCreationRequest {
    /**
     * @description 目标工程相对路径或 db URL。
     */
    readonly targetPath: string;
    /**
     * @description 资源种类。
     */
    readonly resourceType: 'prefab' | 'scene';
    /**
     * @description 可选内存内容；提供时协调器调用 `create-asset`。
     */
    readonly content?: string;
    /**
     * @description 可选 Creator 原生发布器；与 content 二选一。
     */
    readonly publish?: () => Promise<unknown>;
    /**
     * @description 任务生命周期。
     */
    readonly lifecycle?: IEditorMcpAssetDbCreationLifecycle;
    /**
     * @description 登记等待预算。
     */
    readonly timeoutMs?: number;
    /**
     * @description 轮询间隔。
     */
    readonly pollIntervalMs?: number;
}

/**
 * @description Prefab / Scene 首次发布协调器：目标预检、父目录登记、AssetDB 发布、身份确认与保守清理。
 */
export class EditorMcpAssetDbCreationCoordinator {
    /**
     * @description 宿主依赖。
     */
    private readonly _host: IEditorMcpAssetDbCreationCoordinatorHost;

    /**
     * @description 创建协调器。
     * @param host 宿主依赖。
     */
    public constructor(host: IEditorMcpAssetDbCreationCoordinatorHost) {
        this._host = host;
    }

    /**
     * @description 执行一次首次创建事务。
     * @param request 创建请求。
     * @returns 已验证身份证据。
     */
    public async create(request: IEditorMcpAssetDbCreationRequest): Promise<IEditorMcpAssetDbCreationEvidence> {
        const targetDbPath = this._normalizeTarget(request.targetPath, request.resourceType);
        const projectRoot = await this._host.requireProjectPath();
        const message = this._host.requireMessage();
        const targetRelativePath = targetDbPath.slice('db://'.length);
        const targetAbsolutePath = join(projectRoot, targetRelativePath);
        const startedAt = Date.now();
        let phase: EditorMcpAssetDbCreationPhase = 'reserved';
        let publicationResponse: unknown;
        let published = false;
        let parentPreparation: IParentPreparation | null = null;
        if ((request.content == null) === (request.publish == null)) {
            throw new Error('editor_mcp_asset_create_publisher_invalid');
        }
        const existing = await this._host.transaction.queryRegistration(targetDbPath, false);
        if (existing != null || existsSync(targetAbsolutePath) || existsSync(`${targetAbsolutePath}.meta`)) {
            throw this._failure(
                `editor_mcp_asset_create_conflict:${targetDbPath}`,
                phase,
                targetDbPath,
                request.resourceType,
                this._emptyCleanup(true),
                'unchanged',
            );
        }
        try {
            this._throwIfCancelled(request.lifecycle);
            parentPreparation = await this._prepareParent(message, projectRoot, targetDbPath, request);
            phase = 'parent_ready';
            this._throwIfCancelled(request.lifecycle);
            if (request.lifecycle?.enterCommitWindow != null && !request.lifecycle.enterCommitWindow()) {
                throw new Error('editor_mcp_task_cancelled_before_commit');
            }
            phase = 'publishing';
            publicationResponse = request.content != null
                ? await message.request('asset-db', 'create-asset', targetDbPath, request.content)
                : await request.publish!();
            published = true;
            const registration = await this._waitForRegistration(targetDbPath, request);
            phase = 'registered';
            const responseUuid = this._readUuid(publicationResponse);
            if (responseUuid != null && responseUuid !== registration.evidence.uuid) {
                throw new Error('editor_mcp_asset_create_identity_mismatch');
            }
            phase = 'verified';
            FileAssetDependencyIndex.invalidate(projectRoot);
            return Object.freeze({
                phase,
                targetDbPath,
                resourceType: request.resourceType,
                uuid: registration.evidence.uuid,
                metaPresent: registration.evidence.metaPresent,
                subAssetUuids: registration.evidence.subAssetUuids,
                parentRegistered: true,
                polls: registration.polls,
                waitedMs: Date.now() - startedAt,
                cleanup: this._emptyCleanup(true),
                projectState: 'changed',
            });
        } catch (error: unknown) {
            if (error instanceof EditorMcpAssetDbCreationError) {
                throw error;
            }
            const cleanup = published || phase === 'publishing'
                ? await this._cleanupPublishedTarget(message, projectRoot, targetDbPath, publicationResponse)
                : this._emptyCleanup(true);
            if (!published && parentPreparation != null) {
                this._cleanupCreatedDirectories(projectRoot, parentPreparation.createdDirectories);
            }
            FileAssetDependencyIndex.invalidate(projectRoot);
            const state: EditorMcpAssetDbCreationProjectState = cleanup.complete ? 'unchanged' : 'may_have_changed';
            const detail = error instanceof Error ? error.message : String(error);
            const code = detail.includes('registration_pending')
                ? 'editor_mcp_asset_create_registration_pending'
                : detail;
            throw this._failure(code, phase, targetDbPath, request.resourceType, cleanup, state);
        }
    }

    /**
     * @description 为主资源发布准备并验证父目录，且在 commit 前移除登记探针。
     */
    private async _prepareParent(
        message: IEditorMcpAssetDbTransactionMessagePort,
        projectRoot: string,
        targetDbPath: string,
        request: IEditorMcpAssetDbCreationRequest,
    ): Promise<IParentPreparation> {
        const targetRelativePath = targetDbPath.slice('db://'.length);
        const parentRelativePath = dirname(targetRelativePath).replace(/\\/gu, '/');
        const parentDbPath = `db://${parentRelativePath}`;
        const createdDirectories = this._collectMissingDirectories(projectRoot, parentRelativePath);
        mkdirSync(join(projectRoot, parentRelativePath), { recursive: true });
        try {
            if ((await this._host.transaction.queryRegistration(parentDbPath, false)) == null) {
                const probeDbPath = `${parentDbPath}/__peanut_assetdb_register_${CompatibleUuid.create().replace(/-/gu, '')}.json`;
                try {
                    await message.request('asset-db', 'create-asset', probeDbPath, '{"schemaVersion":1}\n');
                    await this._waitForRegistration(parentDbPath, {
                        timeoutMs: request.timeoutMs,
                        pollIntervalMs: request.pollIntervalMs,
                        lifecycle: request.lifecycle,
                    }, false);
                } finally {
                    await message.request('asset-db', 'delete-asset', probeDbPath).catch(() => undefined);
                    const probeRelativePath = probeDbPath.slice('db://'.length);
                    rmSync(join(projectRoot, probeRelativePath), { force: true });
                    rmSync(join(projectRoot, `${probeRelativePath}.meta`), { force: true });
                }
                if ((await this._host.transaction.queryRegistration(probeDbPath, false)) != null) {
                    throw this._failure(
                        'editor_mcp_asset_create_probe_cleanup_failed',
                        'reserved',
                        targetDbPath,
                        request.resourceType,
                        Object.freeze({ attempted: true, complete: false, ownershipMismatch: false }),
                        'may_have_changed',
                    );
                }
            }
        } catch (error: unknown) {
            this._cleanupCreatedDirectories(projectRoot, createdDirectories);
            throw error;
        }
        return Object.freeze({ parentDbPath, createdDirectories: Object.freeze(createdDirectories) });
    }

    /**
     * @description 等待目标身份、`.meta` 和子资源快照可查询。
     */
    private async _waitForRegistration(
        targetDbPath: string,
        request: Pick<IEditorMcpAssetDbCreationRequest, 'timeoutMs' | 'pollIntervalMs' | 'lifecycle'>,
        requireMeta: boolean = true,
    ): Promise<{ readonly evidence: IEditorMcpAssetDbRegistrationEvidence; readonly polls: number }> {
        const timeoutMs = this._boundedInteger(request.timeoutMs, 8000, 100, 60_000);
        const pollIntervalMs = this._boundedInteger(request.pollIntervalMs, 100, 20, 1000);
        const deadline = Date.now() + timeoutMs;
        let polls = 0;
        while (Date.now() <= deadline) {
            polls += 1;
            const evidence = await this._host.transaction.queryRegistration(targetDbPath, requireMeta);
            if (evidence != null) {
                return { evidence, polls };
            }
            this._throwIfCancelled(request.lifecycle);
            await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
        }
        throw new Error(`editor_mcp_asset_create_registration_pending:${targetDbPath}`);
    }

    /**
     * @description 对可能已经发布的目标执行所有权校验、AssetDB 删除与双侧确认。
     */
    private async _cleanupPublishedTarget(
        message: IEditorMcpAssetDbTransactionMessagePort,
        projectRoot: string,
        targetDbPath: string,
        publicationResponse: unknown,
    ): Promise<IEditorMcpAssetDbCreationCleanupEvidence> {
        const registration = await this._host.transaction.queryRegistration(targetDbPath, false);
        const responseUuid = this._readUuid(publicationResponse);
        if (registration != null && responseUuid != null && registration.uuid !== responseUuid) {
            return Object.freeze({ attempted: false, complete: false, ownershipMismatch: true });
        }
        if (registration == null && responseUuid == null) {
            return Object.freeze({ attempted: false, complete: false, ownershipMismatch: false });
        }
        await message.request('asset-db', 'delete-asset', targetDbPath).catch(() => undefined);
        const targetRelativePath = targetDbPath.slice('db://'.length);
        const targetAbsolutePath = join(projectRoot, targetRelativePath);
        const stillRegistered = await this._host.transaction.queryRegistration(targetDbPath, false);
        const complete = stillRegistered == null && !existsSync(targetAbsolutePath) && !existsSync(`${targetAbsolutePath}.meta`);
        return Object.freeze({ attempted: true, complete, ownershipMismatch: false });
    }

    /**
     * @description 收集 mkdir 前尚不存在的目录，供发布前失败时逆序清理。
     */
    private _collectMissingDirectories(projectRoot: string, parentRelativePath: string): readonly string[] {
        const segments = parentRelativePath.replace(/\\/gu, '/').split('/').filter((segment) => segment.length > 0);
        const missing: string[] = [];
        let current = '';
        for (const segment of segments) {
            current = current.length === 0 ? segment : `${current}/${segment}`;
            if (current !== 'assets' && !existsSync(join(projectRoot, current))) {
                missing.push(current);
            }
        }
        return Object.freeze(missing);
    }

    /**
     * @description 仅删除本事务创建且仍为空的目录与其 sidecar。
     */
    private _cleanupCreatedDirectories(projectRoot: string, directories: readonly string[]): void {
        for (const relativePath of [...directories].reverse()) {
            const absolutePath = join(projectRoot, relativePath);
            if (existsSync(absolutePath) && readdirSync(absolutePath).length === 0) {
                rmdirSync(absolutePath);
                rmSync(`${absolutePath}.meta`, { force: true });
            }
        }
    }

    /**
     * @description 在发布窗口前响应任务取消。
     */
    private _throwIfCancelled(lifecycle: IEditorMcpAssetDbCreationLifecycle | undefined): void {
        if (lifecycle?.signal?.aborted === true) {
            throw new Error('editor_mcp_task_cancelled_before_commit');
        }
    }

    /**
     * @description 规范化并校验 Prefab / Scene 目标。
     */
    private _normalizeTarget(pathValue: string, resourceType: 'prefab' | 'scene'): string {
        const normalized = pathValue.trim().replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
        const dbPath = normalized.startsWith('db://') ? normalized : `db://${normalized}`;
        const extension = resourceType === 'prefab' ? '.prefab' : '.scene';
        if (!dbPath.startsWith('db://assets/') || !dbPath.toLowerCase().endsWith(extension)) {
            throw new Error(`editor_mcp_asset_create_target_invalid:${pathValue}`);
        }
        if (dbPath.split('/').some((segment) => segment === '.' || segment === '..')) {
            throw new Error(`editor_mcp_asset_create_target_invalid:${pathValue}`);
        }
        return dbPath;
    }

    /**
     * @description 从 Creator 发布响应读取可选 UUID。
     */
    private _readUuid(value: unknown): string | null {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const uuid = (value as Record<string, unknown>).uuid;
        return typeof uuid === 'string' && uuid.trim().length > 0 ? uuid.trim() : null;
    }

    /**
     * @description 构造空主资源清理证据。
     */
    private _emptyCleanup(complete: boolean): IEditorMcpAssetDbCreationCleanupEvidence {
        return Object.freeze({ attempted: false, complete, ownershipMismatch: false });
    }

    /**
     * @description 构造带安全证据的稳定失败。
     */
    private _failure(
        message: string,
        phase: EditorMcpAssetDbCreationPhase,
        targetDbPath: string,
        resourceType: 'prefab' | 'scene',
        cleanup: IEditorMcpAssetDbCreationCleanupEvidence,
        projectState: EditorMcpAssetDbCreationProjectState = cleanup.complete ? 'unchanged' : 'may_have_changed',
    ): EditorMcpAssetDbCreationError {
        return new EditorMcpAssetDbCreationError(message, Object.freeze({
            phase,
            targetDbPath,
            resourceType,
            cleanup,
            projectState,
            recommendedQuery: 'asset.queryInfo',
        }));
    }

    /**
     * @description 将数值限制到安全整数范围。
     */
    private _boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
        if (value == null || !Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(maximum, Math.max(minimum, Math.floor(value)));
    }
}

/**
 * @description 父目录登记的内部结果。
 */
interface IParentPreparation {
    /**
     * @description 已确认的父目录 db URL。
     */
    readonly parentDbPath: string;
    /**
     * @description 本事务创建的目录。
     */
    readonly createdDirectories: readonly string[];
}
