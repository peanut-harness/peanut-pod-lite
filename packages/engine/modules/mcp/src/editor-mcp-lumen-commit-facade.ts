/**
 * @description lumen.commit 收口：refresh + catalog + validateRefs + Agent 验收指引（从 action-router peel）。
 */
import type { ContractPayload } from '@peanut/pod-protocol';
import type { IAssetCatalogFastLookup } from '@peanut/pod-engine/assets';
import {
    LumenResourceWriteLock,
    normalizeResourceDirectoryLockKey,
    normalizeResourceLockKey,
} from '@peanut/pod-engine/lumen';

import { Lumen24McpBridge } from './editor-mcp-lumen-24-bridge.js';
import type { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';
import type { EditorMcpLumenGateway } from './editor-mcp-lumen-gateway.js';

/**
 * @description commit facade 宿主依赖。
 */
export interface IEditorMcpLumenCommitHost {
    /** @description 工程根。 */
    readonly requireProjectPath: () => Promise<string>;
    /** @description lumen 网关。 */
    readonly lumen: EditorMcpLumenGateway;
    /** @description catalog 快查。 */
    readonly requireCatalogLookup: () => IAssetCatalogFastLookup;
    /**
     * @description AssetDB 原子登记事务。
     */
    readonly assetDbTransaction: EditorMcpAssetDbTransaction;
}

/**
 * @description lumen.commit 编排。
 */
export class EditorMcpLumenCommitFacade {
    /** @description 宿主依赖。 */
    private readonly _host: IEditorMcpLumenCommitHost;

    /**
     * @description 创建 facade。
     * @param host 宿主依赖
     */
    public constructor(host: IEditorMcpLumenCommitHost) {
        this._host = host;
    }

    /**
     * @description 写盘后受管收口：AssetDB refresh + 本地 asset-catalog 重建。
     * @param input 可选路径列表
     * @returns 两段结果摘要
     */
    public async _executeLumenCommit(input: ContractPayload | undefined): Promise<unknown> {
        // refresh 刷全部提交路径（含 .mtl/.anim 等）；validateRefs 仍只看 prefab/scene。
        const refreshPaths = this._readCommitRefreshPaths(input);
        const fileLockKeys = [
            ...new Set(refreshPaths.map((pathValue) => normalizeResourceLockKey(pathValue)).filter((key) => key.length > 0)),
        ].sort();
        const directoryLockKeys = [
            ...new Set(refreshPaths.map((pathValue) => normalizeResourceDirectoryLockKey(pathValue)).filter((key) => key.length > 0)),
        ].sort();
        const lockKeys = [...new Set([...directoryLockKeys, ...fileLockKeys])].sort();
        return LumenResourceWriteLock.shared().runExclusiveMany(lockKeys, async () => {
                const transaction = await this._host.assetDbTransaction.commit(refreshPaths, { allowUnavailable: true });
                const projectRoot = await this._host.requireProjectPath();
                const catalog = this._host.requireCatalogLookup().refresh(projectRoot);
                const validation = await this._validateCommittedHierarchy(projectRoot, input);
                const guidance = this._buildCommitAcceptanceGuidance(validation);
                return {
                    editorRefresh: transaction.refresh,
                    transaction,
                    catalog,
                    validation,
                    pipeline: ['assetdb_refresh', 'hierarchy_settle', 'assetdb_registration', 'catalog_refresh', 'validate_refs'],
                    acceptancePipeline: guidance.acceptancePipeline,
                    recommendedNext: guidance.recommendedNext,
                    nextHint: guidance.nextHint,
                };
            });
    }

    /**
     * @description 根据 commit validation 生成 Agent 验收下一步。
     * @param validation validateRefs 结果列表。
     * @returns recommendedNext / nextHint / acceptancePipeline。
     */
    public _buildCommitAcceptanceGuidance(validation: readonly unknown[]): {
        readonly recommendedNext: { readonly operation: string; readonly input: Record<string, unknown> } | undefined;
        readonly nextHint: string;
        readonly acceptancePipeline: readonly string[];
    } {
        const acceptancePipeline = [
            'lumen.commit(+validateRefs on .prefab/.scene)',
            'preview.refresh',
            'preview.queryErrors',
        ] as const;
        if (validation.length === 0) {
            return {
                recommendedNext: undefined,
                nextHint:
                    'Pass prefab/scene paths so commit returns validateRefs. Then lane:preview → preview.refresh → preview.queryErrors. Never scene.save/open/reload for writing; scene.open is presentation-only after edits.',
                acceptancePipeline,
            };
        }
        const failed = validation.find((entry) => !this._isValidationEntryOk(entry));
        if (failed != null) {
            const failedPath = this._readValidationPrefabPath(failed);
            return {
                recommendedNext:
                    failedPath != null
                        ? {
                              operation: 'lumen.validateRefs',
                              input: { prefabRelativePath: failedPath },
                          }
                        : {
                              operation: 'lumen.validateRefs',
                              input: {},
                          },
                nextHint:
                    'validation failed: fix bind*/refs, lumen.commit again, then lane:preview → preview.refresh → preview.queryErrors. Never scene.save/open/reload for writing.',
                acceptancePipeline,
            };
        }
        return {
            recommendedNext: {
                operation: 'preview.refresh',
                input: { refreshAssets: true },
            },
            nextHint:
                'validation ok. Next lane:preview → preview.refresh → preview.queryErrors. Never scene.save/open/reload for writing; optional scene.open only to show the user.',
            acceptancePipeline,
        };
    }

    /**
     * @description 判断单条 validation 是否通过。
     * @param entry validateRefs 或错误包装。
     * @returns 是否 ok。
     */
    public _isValidationEntryOk(entry: unknown): boolean {
        if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
            return false;
        }
        return (entry as Record<string, unknown>).ok === true;
    }

    /**
     * @description 从 validation 条目读取 prefab/scene 路径。
     * @param entry validation 条目。
     * @returns 相对路径或 null。
     */
    public _readValidationPrefabPath(entry: unknown): string | null {
        if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
            return null;
        }
        const record = entry as Record<string, unknown>;
        for (const key of ['prefabRelativePath', 'assetRelativePath', 'path'] as const) {
            const value = record[key];
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim().replace(/\\/g, '/');
            }
        }
        return null;
    }

    /**
     * @description 对 commit 路径中的 Prefab/Scene 跑引用校验。
     * @param projectRoot 工程根。
     * @param input commit 输入。
     * @returns 校验结果列表（非层级路径则空）。
     */
    public async _validateCommittedHierarchy(projectRoot: string, input: ContractPayload | undefined): Promise<readonly unknown[]> {
        const paths = this._readCommitHierarchyPaths(input);
        if (paths.length === 0) {
            return [];
        }
        // Creator 2.4：走 lumen-24 uuid↔meta 校验，不用 3.x validateRefs。
        if (Lumen24McpBridge.isCreator2x()) {
            return paths.map((prefabRelativePath) => {
                try {
                    return Lumen24McpBridge.validateRefs(projectRoot, prefabRelativePath);
                } catch (error) {
                    return {
                        prefabRelativePath,
                        ok: false,
                        phase: 'creator_2x',
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            });
        }
        const results: unknown[] = [];
        const validateConcurrency = 4;
        for (let offset = 0; offset < paths.length; offset += validateConcurrency) {
            const chunk = paths.slice(offset, offset + validateConcurrency);
            const chunkResults = await Promise.all(
                chunk.map(async (prefabRelativePath) => {
                    try {
                        return await this._host.lumen.execute('lumen.validateRefs', {
                            prefabRelativePath,
                        });
                    } catch (error) {
                        return {
                            prefabRelativePath,
                            ok: false,
                            error: error instanceof Error ? error.message : String(error),
                        };
                    }
                }),
            );
            results.push(...chunkResults);
        }
        return results;
    }

    /**
     * @description 从 commit 输入提取需 AssetDB refresh 的工程相对路径（含独立资产与目录）。
     * @param input 未校验输入。
     * @returns 路径列表。
     */
    public _readCommitRefreshPaths(input: ContractPayload | undefined): readonly string[] {
        return this._collectCommitPaths(input, { hierarchyOnly: false });
    }

    /**
     * @description 从 commit 输入提取 `.prefab` / `.scene` 相对路径（供 validateRefs）。
     * @param input 未校验输入。
     * @returns 路径列表。
     */
    public _readCommitHierarchyPaths(input: ContractPayload | undefined): readonly string[] {
        return this._collectCommitPaths(input, { hierarchyOnly: true });
    }

    /**
     * @description 收集 commit 路径。
     * @param input 未校验输入。
     * @param options.hierarchyOnly 为 true 时仅保留 `.prefab` / `.scene`。
     * @returns 去重后的相对路径。
     */
    public _collectCommitPaths(
        input: ContractPayload | undefined,
        options: { readonly hierarchyOnly: boolean },
    ): readonly string[] {
        if (input == null || typeof input !== 'object' || Array.isArray(input)) {
            return [];
        }
        const record = input as Record<string, unknown>;
        const collected: string[] = [];
        const pushPath = (value: unknown): void => {
            if (typeof value !== 'string') {
                return;
            }
            const trimmed = value
                .trim()
                .replace(/^db:\/\//, '')
                .replace(/\\/g, '/');
            if (trimmed.length === 0 || trimmed.includes('..')) {
                return;
            }
            if (options.hierarchyOnly) {
                const lower = trimmed.toLowerCase();
                if (!lower.endsWith('.prefab') && !lower.endsWith('.scene')) {
                    return;
                }
            }
            collected.push(trimmed);
        };
        if (Array.isArray(record.paths)) {
            for (const item of record.paths) {
                pushPath(item);
            }
        }
        pushPath(record.prefabRelativePath);
        pushPath(record.assetRelativePath);
        return [...new Set(collected)];
    }

}
