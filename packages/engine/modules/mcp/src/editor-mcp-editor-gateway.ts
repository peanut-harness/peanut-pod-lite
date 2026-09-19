/**
 * @description 编辑器选区 / 资源查询打开 / 场景打开与恢复编排（从 action-router peel）。
 */
import type {
    ContractPayload,
    IEditorSetSelectionMcpInput,
    ISceneResolvePrefabRootUuidMcpInput,
    ISceneRestoreEditorResourceMcpInput,
} from '@peanut/pod-protocol';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';
import { LumenHierarchyRefValidator } from '@peanut/pod-engine/lumen';
import { CurrentEditorResourceQuery, EditorResourceRestorer, PrefabEditorRootResolver } from '@peanut/pod-engine/runtime';

import type { EditorMcpAssetDiagnostics } from './editor-mcp-asset-diagnostics.js';
import { Lumen24McpBridge } from './editor-mcp-lumen-24-bridge.js';
import type { EditorMcpSceneGateway } from './editor-mcp-scene-gateway.js';
import { EditorMcpThinLayerAvailabilityMapper } from './editor-mcp-thin-layer-availability.js';

/**
 * @description editor gateway 宿主依赖。
 */
export interface IEditorMcpEditorHost {
    /** @description 授权 runtime。 */
    readonly runtime: IGrantedRuntimeClientSet;
    /** @description 工程根。 */
    readonly requireProjectPath: () => Promise<string>;
    /** @description asset read grant。 */
    readonly requireAssetRead: () => NonNullable<IGrantedRuntimeClientSet['assetRead']>;
    /** @description selection grant。 */
    readonly requireSelection: () => NonNullable<IGrantedRuntimeClientSet['selection']>;
    /** @description scene grant。 */
    readonly requireScene: () => NonNullable<IGrantedRuntimeClientSet['scene']>;
    /** @description message grant。 */
    readonly requireMessage: () => NonNullable<IGrantedRuntimeClientSet['message']>;
    /** @description 资产诊断。 */
    readonly diagnostics: EditorMcpAssetDiagnostics;
    /** @description 场景薄层网关。 */
    readonly sceneGateway: EditorMcpSceneGateway;
    /** @description 普通对象判定。 */
    readonly isRecord: (value: unknown) => value is Record<string, unknown>;
}

/**
 * @description 编辑器选区、资源打开/查询与场景打开/恢复执行面。
 */
export class EditorMcpEditorGateway {
    /** @description 宿主依赖。 */
    private readonly _host: IEditorMcpEditorHost;

    /**
     * @description 创建 gateway。
     * @param host 宿主依赖
     */
    public constructor(host: IEditorMcpEditorHost) {
        this._host = host;
    }

    /**
     * @description 查询 meta schema，并尽力叠 live AssetDB。
     * @param input 未校验输入。
     * @returns schema。
     */
    public async executeAssetQueryPropertySchema(input: ContractPayload | undefined): Promise<unknown> {
        const locate = this._host.diagnostics.readAssetLocateInput(input);
        const projectRoot = await this._host.requireProjectPath();
        const disk = this._host.diagnostics.queryPropertySchema(projectRoot, locate);
        const message = this._host.runtime.message;
        if (message == null) {
            return disk;
        }
        const key =
            typeof locate.uuid === 'string' && locate.uuid.trim().length > 0
                ? locate.uuid.trim()
                : (locate.path ?? locate.url)?.replace(/^db:\/\//, '');
        if (key == null || key.length === 0) {
            return disk;
        }
        for (const candidate of ['query-asset-meta', 'query-asset-info', 'query-meta'] as const) {
            try {
                const live = await message.request('asset-db', candidate, key.startsWith('db://') ? key : `db://${key}`);
                return this._host.diagnostics.mergeLivePropertySchema(disk, live);
            } catch {
                // try next
            }
        }
        return disk;
    }

    /**
     * @description 查询资源信息，并尽力附带 catalog subAssets / extends；支持批量。
     * @param input 未校验输入。
     * @returns 资源信息。
     */
    public async executeAssetQueryInfo(input: ContractPayload | undefined): Promise<unknown> {
        const keys = this.readAssetQueryInfoKeys(input);
        if (keys.length > 1 || (keys.length === 1 && keys[0]?.batch === true)) {
            const items: unknown[] = [];
            const errors: Array<{ readonly key: string; readonly error: string }> = [];
            for (const key of keys) {
                try {
                    items.push(await this._executeAssetQueryInfoOne(key.value));
                } catch (error) {
                    errors.push({
                        key: key.value,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return {
                batch: true,
                count: items.length,
                items,
                ...(errors.length > 0 ? { errors } : {}),
            };
        }
        if (keys.length === 0) {
            throw new Error('editor_mcp_asset_path_or_uuid_required');
        }
        return this._executeAssetQueryInfoOne(keys[0]!.value);
    }

    /**
     * @description 查询选区，并尽力补齐 path / type（对齐 PinK 层级选择可读性）。
     * @returns 选区快照。
     */
    public async executeQuerySelection(): Promise<unknown> {
        const ids = await this._host.requireSelection().getActiveIds();
        const items: Array<Record<string, unknown>> = ids.map((id) => ({ id }));
        const scene = this._host.runtime.scene;
        if (scene != null && ids.length > 0) {
            try {
                const nodes = await scene.getHierarchy({ includeEditorNodes: false });
                for (const item of items) {
                    const id = String(item.id);
                    const hit = nodes.find((node) => {
                        const record = node as unknown as Record<string, unknown>;
                        return (
                            record.uuid === id ||
                            record.id === id ||
                            record.value === id ||
                            (typeof record.path === 'string' && record.path === id)
                        );
                    });
                    if (hit != null) {
                        const record = hit as unknown as Record<string, unknown>;
                        item.path =
                            typeof record.path === 'string' ? record.path : typeof record.name === 'string' ? record.name : undefined;
                        item.name = typeof record.name === 'string' ? record.name : undefined;
                        item.type =
                            typeof record.type === 'string'
                                ? record.type
                                : typeof record.__type__ === 'string'
                                  ? record.__type__
                                  : undefined;
                    }
                }
            } catch {
                // selection ids still useful alone
            }
        }
        return {
            ids,
            items,
            count: ids.length,
        };
    }

    /**
     * @description 按路径 / id 写选区，并返回写后查询快照。
     * @param input 未校验输入。
     * @returns 选区快照。
     */
    public async executeSetSelection(input: ContractPayload | undefined): Promise<unknown> {
        const parsed = this.readSetSelectionInput(input);
        let ids: string[] = [];
        if (parsed.clear === true) {
            ids = [];
        } else {
            ids = [...(parsed.ids ?? [])];
            const paths = parsed.paths ?? [];
            if (paths.length > 0) {
                const scene = this._host.runtime.scene;
                if (scene == null) {
                    throw new Error('editor_mcp_selection_paths_require_scene');
                }
                const nodes = await scene.getHierarchy({ includeEditorNodes: false });
                const unresolved: string[] = [];
                for (const path of paths) {
                    const hit = nodes.find((node) => {
                        const record = node as unknown as Record<string, unknown>;
                        const candidates = [record.path, record.nodePath, record.name, record.uuid, record.id]
                            .filter((item): item is string => typeof item === 'string')
                            .map((item) => item.replace(/\\/gu, '/'));
                        return candidates.some(
                            (item) => item === path || item.endsWith(`/${path}`) || item.toLowerCase() === path.toLowerCase(),
                        );
                    });
                    if (hit == null) {
                        unresolved.push(path);
                        continue;
                    }
                    const record = hit as unknown as Record<string, unknown>;
                    const id =
                        typeof record.uuid === 'string' && record.uuid.length > 0
                            ? record.uuid
                            : typeof record.id === 'string' && record.id.length > 0
                              ? record.id
                              : path;
                    ids.push(id);
                }
                if (ids.length === 0) {
                    if (nodes.length === 0) {
                        // 空层级：把 path 直接交给 live selection message。
                        ids = [...paths];
                    } else {
                        throw new Error(`editor_mcp_selection_path_not_found:${unresolved.join(',')}`);
                    }
                } else if (unresolved.length > 0) {
                    throw new Error(`editor_mcp_selection_path_not_found:${unresolved.join(',')}`);
                }
            }
            ids = [...new Set(ids)];
        }
        const selection = this._host.runtime.selection;
        let grantWrote = false;
        if (selection != null && typeof selection.setActiveIds === 'function') {
            await selection.setActiveIds(ids);
            grantWrote = true;
        }
        let messageWrote = false;
        const message = this._host.runtime.message;
        if (message != null) {
            const attempts: readonly (readonly [string, string, readonly unknown[]])[] =
                ids.length === 0
                    ? [
                          ['selection', 'unselect', ['node']],
                          ['selection', 'clear', []],
                          ['scene', 'unselect-node', []],
                      ]
                    : [
                          ['selection', 'select', ['node', ...ids]],
                          ['selection', 'select', [{ type: 'node', uuid: ids }]],
                          ['selection', 'select', ['node', ids]],
                          ['scene', 'select-node', [ids[0]]],
                          ['scene', 'select-nodes', [ids]],
                      ];
            for (const [target, name, args] of attempts) {
                try {
                    await message.request(target, name, ...args);
                    messageWrote = true;
                    break;
                } catch {
                    // try next
                }
            }
        }
        if (!grantWrote && !messageWrote) {
            throw new Error('editor_mcp_selection_write_unavailable');
        }
        try {
            return await this.executeQuerySelection();
        } catch {
            return {
                ids,
                items: ids.map((id) => ({ id })),
                count: ids.length,
                source: grantWrote ? 'selection_grant' : messageWrote ? 'selection_message' : 'unknown',
            };
        }
    }

    /**
     * @description 打开场景并附带 validateRefs。
     * @param input 未校验输入。
     * @returns 打开结果。
     */
    public async executeSceneOpen(input: ContractPayload | undefined): Promise<unknown> {
        const openInput = this._host.sceneGateway.readOpenInput(input);
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._host.requireProjectPath();
            const relative = openInput.path.replace(/^db:\/\//u, '').trim();
            try {
                const opened = await Lumen24McpBridge.openScene(projectRoot, relative);
                return {
                    available: true,
                    message: 'scene_open_ok:creator2x_loadSceneByUuid',
                    availability: 'live',
                    source: 'creator2x',
                    ...opened,
                    ...this._attachHierarchyValidation(projectRoot, relative),
                };
            } catch (error) {
                return {
                    available: false,
                    message: error instanceof Error ? error.message : String(error),
                    availability: 'refused',
                    source: 'creator2x',
                };
            }
        }
        const initial = await this._host.sceneGateway.open(openInput);
        const projectRoot = await this._host.requireProjectPath().catch(() => null);
        const initialSettle =
            initial.available === true
                ? await this._host.sceneGateway.waitForHierarchySettle(1500)
                : { waitedMs: 0, nodeCount: 0, settled: false };
        const fallback =
            initial.available === true && initialSettle.settled !== true
                ? await this._host.sceneGateway.retryOpenViaAssetDb(openInput)
                : null;
        const result = fallback?.available === true ? fallback : initial;
        const settle =
            fallback?.available === true
                ? await this._host.sceneGateway.waitForHierarchySettle()
                : initialSettle;
        // open-scene 消息常不抛错；层次未沉降则视为打开未完成，避免 Agent 以为成功。
        const available = result.available === true && settle.settled === true;
        const message =
            result.available !== true
                ? result.message
                : settle.settled
                  ? result.message
                  : 'scene_open_incomplete:hierarchy_empty_after_open';
        if (projectRoot == null) {
            return { ...result, available, message, settle, initial, initialSettle, fallback };
        }
        const relative = openInput.path.replace(/^db:\/\//u, '').trim();
        return {
            ...result,
            available,
            message,
            settle,
            initial,
            initialSettle,
            fallback,
            ...this._attachHierarchyValidation(projectRoot, relative),
        };
    }

    /**
     * @description 在 Creator 资源面板打开/揭示资产（尽力 message）。
     * @param input 未校验输入。
     * @returns 打开结果。
     */
    public async executeAssetOpen(input: ContractPayload | undefined): Promise<unknown> {
        const locate = this.readAssetOpenInput(input);
        const projectRoot = await this._host.requireProjectPath();
        let uuid = locate.uuid?.trim() ?? '';
        let dbPath = (locate.path ?? locate.url)?.trim().replace(/^db:\/\//, '') ?? '';
        if (uuid.length === 0 && dbPath.length === 0) {
            throw new Error('editor_mcp_asset_path_or_uuid_required');
        }
        if (uuid.length === 0 || dbPath.length === 0) {
            try {
                const resolved = this._host.diagnostics.resolve(projectRoot, locate) as {
                    readonly uuid: string;
                    readonly dbPath: string;
                    readonly path: string;
                };
                uuid = resolved.uuid;
                dbPath = resolved.path;
            } catch {
                // continue with whatever we have
            }
        }
        const url = dbPath.startsWith('db://') ? dbPath : dbPath.length > 0 ? `db://${dbPath}` : undefined;
        const message = this._host.runtime.message;
        if (message == null) {
            return EditorMcpThinLayerAvailabilityMapper.attach({
                available: false,
                message: 'asset_open_unavailable:runtime_message_missing',
                uuid: uuid || undefined,
                url,
            });
        }
        const candidates: Array<readonly [string, string, Record<string, unknown>]> = [
            ['asset-db', 'open-asset', { uuid, url }],
            ['asset-db', 'open', { uuid, url }],
            ['assets', 'open-asset', { uuid, url }],
            ['assets', 'open', { uuid, url }],
            ['asset-db', 'twinkle', { uuid, url }],
            ['assets', 'twinkle', { uuid, url }],
        ];
        for (const [target, name, payload] of candidates) {
            try {
                const raw = await message.request(target, name, payload);
                return EditorMcpThinLayerAvailabilityMapper.attach({
                    available: true,
                    source: 'live',
                    message: `asset_open_ok:${target}.${name}`,
                    uuid: uuid || undefined,
                    url,
                    data: raw,
                    ...this._attachHierarchyValidation(projectRoot, dbPath),
                });
            } catch {
                // try next
            }
        }
        return EditorMcpThinLayerAvailabilityMapper.attach({
            available: false,
            message: 'asset_open_unavailable:no_supported_message',
            uuid: uuid || undefined,
            url,
            ...this._attachHierarchyValidation(projectRoot, dbPath),
        });
    }

    /**
     * @description 查询当前编辑器资源并返回安全恢复计划。
     * @returns 快照。
     */
    public async executeQueryCurrentEditorResource(): Promise<unknown> {
        const message = this._host.requireMessage();
        return new CurrentEditorResourceQuery(message).query();
    }

    /**
     * @description 安全恢复编辑器资源；非法路径 skip 且不 open-scene。
     * @param input 未校验输入。
     * @returns 恢复结果。
     */
    public async executeRestoreEditorResource(input: ContractPayload | undefined): Promise<unknown> {
        const request = this.readRestoreEditorResourceInput(input);
        const message = this._host.requireMessage();
        const restorer = new EditorResourceRestorer(message);
        let resource = request.uuid != null || request.url != null ? restorer.resolveCurrent(request.uuid, request.url) : undefined;
        if (resource == null && request.uuid == null && request.url == null) {
            const current = await new CurrentEditorResourceQuery(message).query();
            resource = current.resource ?? undefined;
        }
        return restorer.restore(resource);
    }

    /**
     * @description 在 Prefab 编辑器层次中按根名解析 uuid。
     * @param input 未校验输入。
     * @returns `{ rootName, rootUuid }`。
     */
    public async executeResolvePrefabRootUuid(input: ContractPayload | undefined): Promise<unknown> {
        const request = this.readResolvePrefabRootUuidInput(input);
        const resolver = new PrefabEditorRootResolver();
        const rootName =
            request.rootName ??
            (request.prefabRelativePath != null ? resolver.rootNameFromPrefabPath(request.prefabRelativePath) : undefined);
        if (rootName == null) {
            throw new Error('editor_mcp_prefab_root_name_required');
        }
        const scene = this._host.requireScene();
        const timeoutMs = request.timeoutMs ?? 10_000;
        const rootUuid = await resolver.waitForRootUuid(
            async () => {
                const hierarchy = await scene.getHierarchy();
                if (hierarchy.length > 0) {
                    return hierarchy;
                }
                const current = await scene.getCurrent();
                return current;
            },
            rootName,
            timeoutMs,
            50,
        );
        if (rootUuid == null) {
            return { rootName, rootUuid: null, unresolved: true };
        }
        return { rootName, rootUuid };
    }

    /**
     * @description 查询单条资源信息。
     * @param pathOrUuid 路径或 uuid。
     * @returns 资源信息。
     */
    private async _executeAssetQueryInfoOne(pathOrUuid: string): Promise<unknown> {
        const live = await this._host.requireAssetRead().query(pathOrUuid);
        try {
            const projectRoot = await this._host.requireProjectPath();
            const locate =
                pathOrUuid.includes('/') || pathOrUuid.startsWith('db://') || pathOrUuid.includes('.')
                    ? { path: pathOrUuid.replace(/^db:\/\//, '') }
                    : { uuid: pathOrUuid };
            const inheritance = this._host.diagnostics.queryInheritance(projectRoot, locate) as {
                readonly subAssets: unknown;
                readonly extends: string | null;
                readonly importer: string;
                readonly compatibleChildImporters: readonly string[];
            };
            return {
                ...(live != null && typeof live === 'object' && !Array.isArray(live) ? live : { raw: live }),
                subAssets: inheritance.subAssets,
                extends: inheritance.extends,
                importer: inheritance.importer,
                compatibleChildImporters: inheritance.compatibleChildImporters,
            };
        } catch {
            return live;
        }
    }

    /**
     * @description Prefab/Scene 打开时附带 validateRefs（对齐 PinK「打开报缺失 UUID」）。
     * @param projectRoot 工程根。
     * @param relativeOrDbPath 相对或 db 路径。
     * @returns validation 字段或空对象。
     */
    private _attachHierarchyValidation(projectRoot: string, relativeOrDbPath: string): { readonly validation?: unknown } {
        const relative = relativeOrDbPath.replace(/^db:\/\//, '').trim();
        const lower = relative.toLowerCase();
        if (!lower.endsWith('.prefab') && !lower.endsWith('.scene')) {
            return {};
        }
        try {
            return {
                validation: new LumenHierarchyRefValidator().validate(projectRoot, {
                    prefabRelativePath: relative,
                }),
            };
        } catch (error) {
            return {
                validation: {
                    prefabRelativePath: relative,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    /**
     * @description 解析 asset.open 输入（供 plan/validate）。
     * @param input 未校验输入。
     * @returns 定位输入。
     */
    public readAssetOpenInput(input: ContractPayload | undefined): {
        readonly uuid?: string;
        readonly path?: string;
        readonly url?: string;
    } {
        if (input == null || typeof input !== 'object' || Array.isArray(input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        const record = input as Record<string, unknown>;
        const uuid = typeof record.uuid === 'string' ? record.uuid.trim() : '';
        const path = typeof record.path === 'string' ? record.path.trim() : '';
        const url = typeof record.url === 'string' ? record.url.trim() : '';
        if (uuid.length === 0 && path.length === 0 && url.length === 0) {
            throw new Error('editor_mcp_asset_path_or_uuid_required');
        }
        return {
            uuid: uuid.length > 0 ? uuid : undefined,
            path: path.length > 0 ? path : undefined,
            url: url.length > 0 ? url : undefined,
        };
    }

    /**
     * @description 读取 asset.queryInfo 的单条或批量键（供 plan/validate）。
     * @param input 未校验输入。
     * @returns 键列表。
     */
    public readAssetQueryInfoKeys(input: ContractPayload | undefined): readonly { readonly value: string; readonly batch: boolean }[] {
        if (input == null) {
            throw new Error('editor_mcp_asset_path_or_uuid_required');
        }
        const keys: Array<{ readonly value: string; readonly batch: boolean }> = [];
        const push = (value: unknown, batch: boolean): void => {
            if (typeof value !== 'string' || value.trim().length === 0) {
                return;
            }
            keys.push({ value: value.trim(), batch });
        };
        if (Array.isArray(input.paths)) {
            for (const item of input.paths) {
                push(item, true);
            }
        }
        if (Array.isArray(input.uuids)) {
            for (const item of input.uuids) {
                push(item, true);
            }
        }
        if (typeof input.pathOrUuid === 'string') {
            push(input.pathOrUuid, keys.length > 0);
        }
        if (keys.length === 0) {
            throw new Error('editor_mcp_asset_path_or_uuid_required');
        }
        return keys;
    }

    /**
     * @description 读取 editor.setSelection 输入（供 plan/validate）。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readSetSelectionInput(input: ContractPayload | undefined): IEditorSetSelectionMcpInput {
        if (input == null) {
            throw new Error('editor_mcp_set_selection_input_required');
        }
        const clear = input.clear === true;
        const paths = Array.isArray(input.paths)
            ? input.paths
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim().replace(/\\/gu, '/'))
                  .filter((item) => item.length > 0)
            : undefined;
        const ids = Array.isArray(input.ids)
            ? input.ids
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
            : undefined;
        if (!clear && (paths == null || paths.length === 0) && (ids == null || ids.length === 0)) {
            throw new Error('editor_mcp_set_selection_paths_or_ids_required');
        }
        return {
            ...(paths != null && paths.length > 0 ? { paths } : {}),
            ...(ids != null && ids.length > 0 ? { ids } : {}),
            ...(clear ? { clear: true } : {}),
        };
    }

    /**
     * @description 解析 restore 输入（供 plan/validate）。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readRestoreEditorResourceInput(input: ContractPayload | undefined): ISceneRestoreEditorResourceMcpInput {
        if (input == null) {
            return {};
        }
        if (!this._host.isRecord(input)) {
            throw new Error('editor_mcp_restore_input_invalid');
        }
        const uuid = typeof input.uuid === 'string' && input.uuid.trim().length > 0 ? input.uuid.trim() : undefined;
        const url = typeof input.url === 'string' && input.url.trim().length > 0 ? input.url.trim() : undefined;
        return { uuid, url };
    }

    /**
     * @description 解析 Prefab 根 uuid 输入（供 plan/validate）。
     * @param input 未校验输入。
     * @returns 输入。
     */
    public readResolvePrefabRootUuidInput(input: ContractPayload | undefined): ISceneResolvePrefabRootUuidMcpInput {
        if (input == null || !this._host.isRecord(input)) {
            throw new Error('editor_mcp_prefab_root_input_required');
        }
        const rootName = typeof input.rootName === 'string' && input.rootName.trim().length > 0 ? input.rootName.trim() : undefined;
        const prefabRelativePath =
            typeof input.prefabRelativePath === 'string' && input.prefabRelativePath.trim().length > 0
                ? input.prefabRelativePath.trim()
                : undefined;
        if (rootName == null && prefabRelativePath == null) {
            throw new Error('editor_mcp_prefab_root_name_or_path_required');
        }
        const timeoutMs =
            typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs) ? Math.max(1, Math.floor(input.timeoutMs)) : undefined;
        return { rootName, prefabRelativePath, timeoutMs };
    }
}
