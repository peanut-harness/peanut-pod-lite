import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type {
    ContractPayload,
    EditorMcpOperationId,
    ILumenAssetSetMcpInput,
    ILumenBindClickMcpInput,
    ILumenBindSpriteMcpInput,
    ILumenBindSpriteBatchMcpInput,
    ILumenBindRefMcpInput,
    ILumenValidateRefsMcpInput,
    ILumenCompAddMcpInput,
    ILumenCompRmMcpInput,
    ILumenCompSetMcpInput,
    ILumenInspectMcpInput,
    ILumenNodeAddMcpInput,
    ILumenNodeRenameMcpInput,
    ILumenNodeReorderMcpInput,
    ILumenNodeRmMcpInput,
    ILumenNodeSetMcpInput,
    ILumenPrefabMcpInput,
    ILumenRefreshMcpInput,
    ILumenScaffoldMcpInput,
    ILumenSchemaMcpInput,
    ILumenStructureMcpInput,
    ILumenCompileRecipeMcpInput,
    ILumenTemplatesMcpInput,
    ILumenCocosInfoMcpInput,
} from '@peanut/pod-protocol';
import {
    LumenDefaultTemplateRoot,
    LumenHierarchyRefValidator,
    LumenNoopEditorRefreshAdapter,
    LumenRecipeMemoryCompiler,
    LumenSession,
    LumenSessionFactory,
    LumenStandaloneAsset,
    ManagedAssetLedger,
    LumenResourceWriteLock,
    type ILumenMessagePort,
    type ILumenNodeRecipe,
    type ILumenSessionOptions,
} from '@peanut/pod-engine/lumen';
import { Lumen24McpBridge } from './editor-mcp-lumen-24-bridge.js';
import { EditorMcpLumenInputCodec } from './editor-mcp-lumen-input-codec.js';
import { executeLodRecalcBounds } from './editor-mcp-lod-recalc.js';
import type {
    EditorMcpAssetDbCreationCoordinator,
    IEditorMcpAssetDbCreationLifecycle,
} from './editor-mcp-asset-db-creation-coordinator.js';

/**
 * @description 会写盘并建议随后 `lumen.commit` 的操作。
 */
const LUMEN_WRITE_OPERATIONS: ReadonlySet<EditorMcpOperationId> = new Set([
    'lumen.scaffold',
    'lumen.structure',
    'lumen.nodeAdd',
    'lumen.nodeRm',
    'lumen.nodeRename',
    'lumen.nodeReorder',
    'lumen.compAdd',
    'lumen.compRm',
    'lumen.compSet',
    'lumen.assetSet',
    'lumen.nodeSet',
    'lumen.bindClick',
    'lumen.bindSprite',
    'lumen.bindSpriteBatch',
    'lumen.bindRef',
]);

/**
 * @description lumen MCP 操作网关：校验输入并以当前项目根驱动 `LumenSession`。
 */
export class EditorMcpLumenGateway {
    /**
     * @description 解析当前 Creator 项目绝对路径。
     */
    private readonly _resolveProjectRoot: () => Promise<string>;

    /**
     * @description 可选 message 端口；缺省尝试 Creator `Editor.Message`。
     */
    private readonly _messagePort: ILumenMessagePort | null;
    /**
     * @description 输入编解码。
     */
    private readonly _input: EditorMcpLumenInputCodec;
    /**
     * @description 由 Router 注入的 Prefab / Scene 首次创建协调器。
     */
    private _creationCoordinator: EditorMcpAssetDbCreationCoordinator | null = null;

    /**
     * @description 创建网关。
     * @param resolveProjectRoot 返回当前项目绝对路径
     * @param messagePort 可选 AssetDB message 端口（测试注入）
     */
    public constructor(resolveProjectRoot: () => Promise<string>, messagePort: ILumenMessagePort | null = null) {
        this._resolveProjectRoot = resolveProjectRoot;
        this._messagePort = messagePort;
        this._input = new EditorMcpLumenInputCodec();
    }

    /**
     * @description 注入 Router 共享的 AssetDB 首次创建协调器。
     * @param coordinator 创建协调器。
     */
    public configureCreationCoordinator(coordinator: EditorMcpAssetDbCreationCoordinator): void {
        this._creationCoordinator = coordinator;
    }

    /**
     * @description 判断操作是否属于 lumen MCP 面。
     * @param operation 操作标识
     * @returns 是否 lumen 操作
     */
    public static isLumenOperation(operation: EditorMcpOperationId): boolean {
        return operation.startsWith('lumen.');
    }

    /**
     * @description 判断是否为会写盘的 lumen 操作。
     * @param operation 操作标识
     * @returns 是否写操作
     */
    public static isWriteOperation(operation: EditorMcpOperationId): boolean {
        return LUMEN_WRITE_OPERATIONS.has(operation);
    }

    /**
     * @description 读取写操作是否请求自动 commit。
     * @param input 未受信输入
     * @returns 是否 autoCommit
     */
    public static readAutoCommit(input: ContractPayload | undefined): boolean {
        return input?.autoCommit === true;
    }

    /**
     * @description 从写操作结果中提取建议 commit 的 prefab 路径。
     * @param data 写操作返回
     * @returns 路径列表
     */
    public static readCommitPaths(data: unknown): readonly string[] {
        if (data == null || typeof data !== 'object' || Array.isArray(data)) {
            return [];
        }
        const prefab = (data as { prefab?: unknown }).prefab;
        const primary: string[] = [];
        if (typeof prefab === 'string' && prefab.trim().length > 0) {
            primary.push(prefab.trim());
        } else {
            const recommended = (data as { recommendedNext?: { input?: { paths?: unknown } } }).recommendedNext;
            const paths = recommended?.input?.paths;
            if (Array.isArray(paths)) {
                primary.push(...paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
            }
        }
        // 同时刷父目录，避免 AssetDB/catalog 只见文件不见树。
        const expanded = new Set<string>();
        for (const pathValue of primary) {
            expanded.add(pathValue);
            const normalized = pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
            const slash = normalized.lastIndexOf('/');
            if (slash > 0) {
                expanded.add(normalized.slice(0, slash));
            }
        }
        return [...expanded];
    }

    /**
     * @description 校验 lumen 操作输入（plan / execute 共用）。
     * @param operation 操作标识
     * @param input 未受信输入
     */
    public validate(operation: EditorMcpOperationId, input: ContractPayload | undefined): void {
        switch (operation) {
            case 'lumen.schema':
                this._input.readSchemaInput(input);
                return;
            case 'lumen.templates':
                this._input.readTemplatesInput(input);
                return;
            case 'lumen.tree':
                this._input.readPrefabInput(input);
                return;
            case 'lumen.inspect':
                this._input.readInspectInput(input);
                return;
            case 'lumen.validateRefs':
                this._input.readValidateRefsInput(input);
                return;
            case 'lumen.cocosInfo':
                this._input.readCocosInfoInput(input);
                return;
            case 'lumen.scaffold':
                this._input.readScaffoldInput(input);
                return;
            case 'lumen.structure':
                this._input.readStructureInput(input);
                return;
            case 'lumen.compileRecipe':
                this._input.readCompileRecipeInput(input);
                return;
            case 'lumen.nodeAdd':
                this._input.readNodeAddInput(input);
                return;
            case 'lumen.nodeRm':
                this._input.readNodeRmInput(input);
                return;
            case 'lumen.nodeRename':
                this._input.readNodeRenameInput(input);
                return;
            case 'lumen.nodeReorder':
                this._input.readNodeReorderInput(input);
                return;
            case 'lumen.compAdd':
                this._input.readCompAddInput(input);
                return;
            case 'lumen.compRm':
                this._input.readCompRmInput(input);
                return;
            case 'lumen.compSet':
                this._input.readCompSetInput(input);
                return;
            case 'lumen.assetSet':
                this._input.readAssetSetInput(input);
                return;
            case 'lumen.nodeSet':
                this._input.readNodeSetInput(input);
                return;
            case 'lumen.bindClick':
                this._input.readBindClickInput(input);
                return;
            case 'lumen.bindSprite':
                this._input.readBindSpriteInput(input);
                return;
            case 'lumen.bindSpriteBatch':
                this._input.readBindSpriteBatchInput(input);
                return;
            case 'lumen.bindRef':
                this._input.readBindRefInput(input);
                return;
            case 'lumen.refresh':
            case 'lumen.commit':
                this._input.readRefreshInput(input);
                return;
            case 'lumen.lodRecalcBounds':
                this._readLodRecalcBoundsInput(input);
                return;
            default:
                throw new Error(`editor_mcp_lumen_operation_unsupported:${operation}`);
        }
    }

    /**
     * @description 执行已校验的 lumen 操作。
     * @param operation 操作标识
     * @param input 未受信输入
     * @returns 操作结果数据
     */
    public async execute(
        operation: EditorMcpOperationId,
        input: ContractPayload | undefined,
        lifecycle?: IEditorMcpAssetDbCreationLifecycle,
    ): Promise<unknown> {
        this.validate(operation, input);
        if (!EditorMcpLumenGateway.isWriteOperation(operation)) {
            return this._executeBody(operation, input, lifecycle);
        }
        const lockKey = this._readWriteLockKey(operation, input);
        return LumenResourceWriteLock.shared().runExclusive(lockKey, () => this._executeBody(operation, input, lifecycle));
    }

    /**
     * @description 执行已校验的 lumen 操作（不含写锁；由 `execute` 包裹写路径）。
     * @param operation 操作标识
     * @param input 未受信输入
     * @returns 操作结果数据
     */
    private async _executeBody(
        operation: EditorMcpOperationId,
        input: ContractPayload | undefined,
        lifecycle?: IEditorMcpAssetDbCreationLifecycle,
    ): Promise<unknown> {
        switch (operation) {
            case 'lumen.schema':
                return this._executeSchema(this._input.readSchemaInput(input));
            case 'lumen.templates':
                return this._executeTemplates(this._input.readTemplatesInput(input));
            case 'lumen.tree':
                return this._executeTree(this._input.readPrefabInput(input));
            case 'lumen.inspect':
                return this._executeInspect(this._input.readInspectInput(input));
            case 'lumen.validateRefs':
                return this._executeValidateRefs(this._input.readValidateRefsInput(input));
            case 'lumen.cocosInfo':
                return this._executeCocosInfo(this._input.readCocosInfoInput(input));
            case 'lumen.lodRecalcBounds':
                return executeLodRecalcBounds(
                    this._messagePort ?? this._tryCreateCreatorMessagePort(),
                    this._readLodRecalcBoundsInput(input),
                );
            case 'lumen.scaffold':
                return this._executeScaffold(this._input.readScaffoldInput(input), lifecycle);
            case 'lumen.structure':
                return this._executeStructure(this._input.readStructureInput(input));
            case 'lumen.compileRecipe':
                return await this._executeCompileRecipe(this._input.readCompileRecipeInput(input));
            case 'lumen.nodeAdd':
                return this._executeNodeAdd(this._input.readNodeAddInput(input));
            case 'lumen.nodeRm':
                return this._executeNodeRm(this._input.readNodeRmInput(input));
            case 'lumen.nodeRename':
                return this._executeNodeRename(this._input.readNodeRenameInput(input));
            case 'lumen.nodeReorder':
                return this._executeNodeReorder(this._input.readNodeReorderInput(input));
            case 'lumen.compAdd':
                return this._executeCompAdd(this._input.readCompAddInput(input));
            case 'lumen.compRm':
                return this._executeCompRm(this._input.readCompRmInput(input));
            case 'lumen.compSet':
                return this._executeCompSet(this._input.readCompSetInput(input));
            case 'lumen.assetSet':
                return this._executeAssetSet(this._input.readAssetSetInput(input));
            case 'lumen.nodeSet':
                return this._executeNodeSet(this._input.readNodeSetInput(input));
            case 'lumen.bindClick':
                return this._executeBindClick(this._input.readBindClickInput(input));
            case 'lumen.bindSprite':
                return this._executeBindSprite(this._input.readBindSpriteInput(input));
            case 'lumen.bindSpriteBatch':
                return this._executeBindSpriteBatch(this._input.readBindSpriteBatchInput(input));
            case 'lumen.bindRef':
                return this._executeBindRef(this._input.readBindRefInput(input));
            case 'lumen.refresh':
                return this._executeRefresh(this._input.readRefreshInput(input));
            case 'lumen.commit':
                throw new Error('editor_mcp_lumen_commit_handled_by_router');
            default:
                throw new Error(`editor_mcp_lumen_operation_unsupported:${operation}`);
        }
    }

    /**
     * @description 创建绑定项目根的会话；写路径优先接入 AssetDB refresh。
     * @param options 额外会话选项
     * @param withAssetDbRefresh 是否注入 AssetDB 适配器
     * @returns 会话
     */
    private async _createSession(
        options: Omit<ILumenSessionOptions, 'projectRoot'> = {},
        withAssetDbRefresh = false,
    ): Promise<LumenSession> {
        const projectRoot = await this._resolveProjectRoot();
        // editor-mcp 打包后随附的 @peanut/pod-engine/lumen 不再带 default_prefab；优先用工程内 peanut.lumen 缓存/安装包。
        const projectTemplateRoot = this._resolveProjectTemplateRoot(projectRoot);
        const sessionOptions: ILumenSessionOptions = {
            projectRoot,
            ...options,
            templateRoot: options.templateRoot ?? projectTemplateRoot ?? undefined,
        };
        if (!withAssetDbRefresh) {
            return LumenSessionFactory.create({
                ...sessionOptions,
                editorRefresh: new LumenNoopEditorRefreshAdapter(),
            });
        }
        const message = this._messagePort ?? this._tryCreateCreatorMessagePort();
        if (message == null) {
            return LumenSessionFactory.create({
                ...sessionOptions,
                editorRefresh: new LumenNoopEditorRefreshAdapter(),
            });
        }
        return LumenSessionFactory.createWithAssetDbRefresh(sessionOptions, message);
    }

    /**
     * @description 从当前工程解析 lumen 模板根（缓存优先，其次已安装 peanut.lumen 包）。
     * @param projectRoot 工程绝对路径
     * @returns 模板根；找不到时返回 `null`
     */
    private _resolveProjectTemplateRoot(projectRoot: string): string | null {
        const cacheRoot = join(projectRoot, 'peanut-plugins', 'caches', 'peanut.lumen', 'templates', 'default_prefab');
        if (this._isDirectory(cacheRoot)) {
            return cacheRoot;
        }
        const installedPath = join(projectRoot, 'peanut-plugins', 'installed.json');
        if (!existsSync(installedPath) || !statSync(installedPath).isFile()) {
            return null;
        }
        try {
            const payload: unknown = JSON.parse(readFileSync(installedPath, 'utf8'));
            if (typeof payload !== 'object' || payload == null || !Array.isArray((payload as { plugins?: unknown }).plugins)) {
                return null;
            }
            const lumen = (payload as { plugins: readonly Record<string, unknown>[] }).plugins.find(
                (plugin) => plugin.pluginId === 'peanut.lumen',
            );
            if (lumen == null || typeof lumen.activeVersion !== 'string' || lumen.activeVersion.trim().length === 0) {
                return null;
            }
            const bundledRoot = join(
                projectRoot,
                'peanut-plugins',
                'plugins',
                'peanut.lumen',
                lumen.activeVersion,
                'bundled',
                'default_prefab',
            );
            return this._isDirectory(bundledRoot) ? bundledRoot : null;
        } catch {
            return null;
        }
    }

    /**
     * @description 判断路径是否为可用目录。
     * @param directoryPath 候选路径
     * @returns 是否为目录
     */
    private _isDirectory(directoryPath: string): boolean {
        return existsSync(directoryPath) && statSync(directoryPath).isDirectory();
    }

    /**
     * @description 从写操作输入提取资源锁键（prefab/scene/standalone 相对路径）。
     * @param operation 写操作标识。
     * @param input 已通过 validate 的输入。
     * @returns 锁键；无法解析时返回空串（退化为进程内全局串行）。
     */
    private _readWriteLockKey(operation: EditorMcpOperationId, input: ContractPayload | undefined): string {
        if (input == null || typeof input !== 'object' || Array.isArray(input)) {
            return '';
        }
        try {
            if (operation === 'lumen.scaffold') {
                return this._input.readScaffoldInput(input).prefabRelativePath;
            }
            if (operation === 'lumen.structure') {
                return this._input.readStructureInput(input).prefabRelativePath;
            }
            return this._input.readAssetPath(input as Record<string, unknown>);
        } catch {
            return '';
        }
    }

    /**
     * @description 打开已有 prefab 的会话。
     * @param prefabRelativePath 相对路径
     * @param cocosVersion 可选版本
     * @returns 会话
     */
    private async _openPrefabSession(prefabRelativePath: string, cocosVersion?: string): Promise<LumenSession> {
        const session = await this._createSession(cocosVersion == null ? {} : { cocosVersion }, false);
        session.openPrefab(prefabRelativePath);
        return session;
    }

    /**
     * @description 尝试从 Creator 全局 `Editor.Message` 构造端口。
     */
    private _readLodRecalcBoundsInput(
        input: ContractPayload | undefined,
    ): import('@peanut/pod-protocol').ILumenLodRecalcBoundsMcpInput {
        if (input == null) {
            return {};
        }
        if (typeof input !== 'object' || Array.isArray(input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        const record = input as Record<string, unknown>;
        const nodePath =
            typeof record.nodePath === 'string' && record.nodePath.trim().length > 0
                ? record.nodePath.trim().replace(/\\/gu, '/')
                : undefined;
        const prefabRelativePath =
            typeof record.prefabRelativePath === 'string' && record.prefabRelativePath.trim().length > 0
                ? record.prefabRelativePath.trim().replace(/\\/gu, '/')
                : typeof record.assetRelativePath === 'string' && record.assetRelativePath.trim().length > 0
                  ? record.assetRelativePath.trim().replace(/\\/gu, '/')
                  : undefined;
        const assetRelativePath =
            typeof record.assetRelativePath === 'string' && record.assetRelativePath.trim().length > 0
                ? record.assetRelativePath.trim().replace(/\\/gu, '/')
                : undefined;
        return {
            ...(nodePath == null ? {} : { nodePath }),
            ...(prefabRelativePath == null ? {} : { prefabRelativePath }),
            ...(assetRelativePath == null ? {} : { assetRelativePath }),
        };
    }

    private _tryCreateCreatorMessagePort(): ILumenMessagePort | null {
        const editor = (globalThis as { Editor?: unknown }).Editor;
        if (editor == null || typeof editor !== 'object') {
            return null;
        }
        const messageApi = (editor as { Message?: unknown }).Message;
        if (messageApi == null || typeof messageApi !== 'object') {
            return null;
        }
        const requestFn = (messageApi as { request?: unknown }).request;
        if (typeof requestFn !== 'function') {
            return null;
        }
        return {
            async request<TData = unknown>(target: string, message: string, ...args: unknown[]): Promise<TData> {
                const result: unknown = await requestFn.call(messageApi, target, message, ...args);
                return result as TData;
            },
        };
    }

    private async _executeSchema(input: ILumenSchemaMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.describeSchema(projectRoot);
        }
        const session = await this._createSession(input.cocosVersion == null ? {} : { cocosVersion: input.cocosVersion });
        return {
            cocos: session.cocosVersion.toString(),
            schema: session.describeSchema(input.type),
        };
    }

    private async _executeTemplates(input: ILumenTemplatesMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.listTemplates(projectRoot);
        }
        const session = await this._createSession(input.cocosVersion == null ? {} : { cocosVersion: input.cocosVersion });
        const templates = session.listTemplates();
        return {
            cocos: session.cocosVersion.toString(),
            count: templates.length,
            templates,
        };
    }

    private async _executeTree(input: ILumenPrefabMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.tree(projectRoot, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        return {
            cocos: session.cocosVersion.toString(),
            prefab: input.prefabRelativePath,
            kind: session.openedAssetKind,
            tree: session.inspectTree(),
        };
    }

    private async _executeInspect(input: ILumenInspectMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.inspect(projectRoot, input.prefabRelativePath, input.nodePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        if (input.region != null && session.openedAssetKind !== 'terrain') {
            throw new Error('editor_mcp_lumen_region_terrain_only');
        }
        if (session.openedAssetKind != null && LumenStandaloneAsset.isStandaloneKind(session.openedAssetKind)) {
            return {
                cocos: session.cocosVersion.toString(),
                prefab: input.prefabRelativePath,
                kind: session.openedAssetKind,
                asset: session.inspectAsset(input.region == null ? undefined : { region: input.region }),
            };
        }
        // Prefab/Scene：省略 nodePath 时默认检视根节点，避免 Agent 漏参刷 project.log warn。
        const nodePath = input.nodePath != null && input.nodePath.trim().length > 0 ? input.nodePath.trim() : session.inspectTree().path;
        return {
            cocos: session.cocosVersion.toString(),
            prefab: input.prefabRelativePath,
            kind: session.openedAssetKind,
            node: session.inspectNode(nodePath),
        };
    }

    private async _executeScaffold(
        input: ILumenScaffoldMcpInput,
        lifecycle?: IEditorMcpAssetDbCreationLifecycle,
    ): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.scaffold(projectRoot, {
                prefabRelativePath: input.prefabRelativePath,
                rootName: input.rootName ?? 'Root',
                ...(input.template != null ? { template: input.template } : {}),
                ...(input.reset === true ? { reset: true } : {}),
            });
            return this._decorateWriteResult({ ...result }, result.prefab);
        }
        const isHierarchyCreate = /\.(?:prefab|scene)$/iu.test(input.prefabRelativePath) && input.reset !== true;
        if (isHierarchyCreate && this._creationCoordinator != null) {
            const session = await this._createSession(input.cocosVersion == null ? {} : { cocosVersion: input.cocosVersion });
            const serialized = session.serializeHierarchyScaffold({
                prefabRelativePath: input.prefabRelativePath,
                rootName: input.rootName ?? 'Root',
                template: input.template ?? 'empty',
                writeMetaIfMissing: false,
            });
            const creation = await this._creationCoordinator.create({
                targetPath: serialized.relativePath,
                resourceType: serialized.kind,
                content: serialized.content,
                lifecycle,
            });
            return this._decorateWriteResult(
                {
                    phase: session.phase,
                    prefab: serialized.relativePath,
                    cocos: session.cocosVersion.toString(),
                    kind: serialized.kind,
                    creation,
                },
                serialized.relativePath,
            );
        }
        // Create-then-edit: wire AssetDB refresh and await import/ready before returning,
        // otherwise Creator Window logs "original asset is not exist" on the new prefab.
        const session = await this._createSession(input.cocosVersion == null ? {} : { cocosVersion: input.cocosVersion }, true);
        const prefab = session.scaffoldPrefab({
            prefabRelativePath: input.prefabRelativePath,
            rootName: input.rootName ?? 'Root',
            template: input.template ?? 'empty',
            writeMetaIfMissing: true,
            ...(input.reset === true ? { reset: true } : {}),
        });
        const editorRefresh = await session.requestEditorRefreshBarrier([prefab]);
        return this._decorateWriteResult(
            {
                phase: session.phase,
                prefab,
                cocos: session.cocosVersion.toString(),
                kind: session.openedAssetKind,
                editorRefresh,
            },
            prefab,
        );
    }

    private async _executeStructure(input: ILumenStructureMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.structure(
                projectRoot,
                input.prefabRelativePath,
                input.parentPath,
                input.recipe as Parameters<typeof Lumen24McpBridge.structure>[3],
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        const created = session.buildFromRecipe({
            parentPath: input.parentPath,
            recipe: input.recipe as ILumenNodeRecipe | readonly ILumenNodeRecipe[],
        });
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                prefab: input.prefabRelativePath,
                created,
                cocos: session.cocosVersion.toString(),
            },
            input.prefabRelativePath,
        );
    }

    /**
     * @description 按配方编译内存 Prefab，不写盘。
     * @param input 已校验输入
     * @returns entries
     */
    private async _executeCompileRecipe(input: ILumenCompileRecipeMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._resolveProjectRoot();
            if (input.mode === 'replaceRoot') {
                return Lumen24McpBridge.compileRecipe(projectRoot, {
                    prefabRelativePath: input.prefabRelativePath,
                    rootName: input.rootName,
                    mode: 'replaceRoot',
                    recipe: input.recipe as Parameters<typeof Lumen24McpBridge.compileRecipe>[1]['recipe'],
                });
            }
            return Lumen24McpBridge.compileRecipe(projectRoot, {
                prefabRelativePath: input.prefabRelativePath,
                rootName: input.rootName,
                mode: 'appendChildren',
                recipes: input.recipes as Parameters<typeof Lumen24McpBridge.compileRecipe>[1]['recipes'],
            });
        }
        const compiler = new LumenRecipeMemoryCompiler();
        const templateRoot = await this._resolveCompileTemplateRoot();
        if (input.mode === 'replaceRoot') {
            const compiled = compiler.compile({
                prefabRelativePath: input.prefabRelativePath,
                rootName: input.rootName,
                mode: 'replaceRoot',
                recipe: this._input.asNodeRecipe(input.recipe),
                ...(templateRoot == null ? {} : { templateRoot }),
            });
            return { entries: compiled.entries, prefabRelativePath: input.prefabRelativePath };
        }
        const compiled = compiler.compile({
            prefabRelativePath: input.prefabRelativePath,
            rootName: input.rootName,
            mode: 'appendChildren',
            recipes: this._input.asNodeRecipeList(input.recipes),
            rootContentSize: input.rootContentSize,
            rootAnchorPoint: input.rootAnchorPoint,
            ...(templateRoot == null ? {} : { templateRoot }),
        });
        return { entries: compiled.entries, prefabRelativePath: input.prefabRelativePath };
    }

    /**
     * @description 解析 compile-recipe 可用的模板根（工程缓存优先，否则内置包）。
     * @returns 模板根；不可用时返回 null。
     */
    private async _resolveCompileTemplateRoot(): Promise<string | null> {
        try {
            const projectRoot = await this._resolveProjectRoot();
            const projectTemplateRoot = this._resolveProjectTemplateRoot(projectRoot);
            if (projectTemplateRoot != null) {
                return projectTemplateRoot;
            }
        } catch {
            // 无工程上下文时退回随包模板。
        }
        try {
            return LumenDefaultTemplateRoot.resolve();
        } catch {
            return null;
        }
    }

    private async _executeNodeAdd(input: ILumenNodeAddMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.nodeAdd(
                projectRoot,
                input.prefabRelativePath,
                input.parentPath,
                input.name ?? 'Node',
                input.template,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        const path = session.addChildFromTemplate({
            parentPath: input.parentPath,
            template: input.template,
            name: input.name,
        });
        session.save();
        return this._decorateWriteResult({ phase: session.phase, path, prefab: input.prefabRelativePath }, input.prefabRelativePath);
    }

    private async _executeNodeRm(input: ILumenNodeRmMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.nodeRm(projectRoot, input.prefabRelativePath, input.nodePath);
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        let removed = true;
        try {
            session.removeNode(input.nodePath);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.startsWith('lumen_child_missing:') || message.startsWith('lumen_node_missing:')) {
                removed = false;
            } else {
                throw error;
            }
        }
        if (removed) {
            session.save();
        }
        return this._decorateWriteResult(
            {
                phase: session.phase,
                removed: removed ? input.nodePath : null,
                skipped: !removed,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeNodeRename(input: ILumenNodeRenameMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.nodeRename(projectRoot, input.prefabRelativePath, input.nodePath, input.name);
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.renameNode(input.nodePath, input.name);
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                path: input.nodePath,
                name: input.name,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeNodeReorder(input: ILumenNodeReorderMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.nodeReorder(
                projectRoot,
                input.prefabRelativePath,
                input.parentPath,
                input.childName,
                input.index,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.reorderChild(input.parentPath, input.childName, input.index);
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                parent: input.parentPath,
                child: input.childName,
                index: input.index,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeCompAdd(input: ILumenCompAddMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.compAdd(
                projectRoot,
                input.prefabRelativePath,
                input.nodePath,
                input.builtinType,
                input.scriptName,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.refreshCatalog();
        const componentIndex = session.attachComponent({
            nodePath: input.nodePath,
            builtinType: input.builtinType,
            scriptName: input.scriptName,
        });
        session.save();
        return this._decorateWriteResult(
            { phase: session.phase, componentIndex, prefab: input.prefabRelativePath },
            input.prefabRelativePath,
        );
    }

    private async _executeCompRm(input: ILumenCompRmMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.compRm(projectRoot, input.prefabRelativePath, input.nodePath, input.componentType);
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.removeComponent(input.nodePath, input.componentType);
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                removed: input.componentType,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeCompSet(input: ILumenCompSetMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.compSet(
                projectRoot,
                input.prefabRelativePath,
                input.nodePath,
                input.componentType,
                input.props,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.setComponentProperty({
            nodePath: input.nodePath,
            componentType: input.componentType,
            patch: input.props,
        });
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                nodePath: input.nodePath,
                componentType: input.componentType,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeAssetSet(input: ILumenAssetSetMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.assetSet(projectRoot, input.prefabRelativePath, input.props);
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.setAssetProperty({ patch: input.props });
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                kind: session.openedAssetKind,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    private async _executeNodeSet(input: ILumenNodeSetMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.nodeSet(
                projectRoot,
                input.prefabRelativePath,
                input.nodePath,
                this._readLumen24NodeProps(input.props),
            );
            return this._decorateWriteResult({ ...result, nodePath: input.nodePath }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.setNodeProperty({ nodePath: input.nodePath, patch: input.props });
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                nodePath: input.nodePath,
                prefab: input.prefabRelativePath,
            },
            input.prefabRelativePath,
        );
    }

    /**
     * @description 将 MCP nodeSet props 收窄为 lumen-24 补丁。
     * @param props 原始 props
     * @returns 2.x 补丁
     */
    private _readLumen24NodeProps(props: Readonly<Record<string, unknown>>): {
        readonly active?: boolean;
        readonly opacity?: number;
        readonly x?: number;
        readonly y?: number;
        readonly z?: number;
        readonly scaleX?: number;
        readonly scaleY?: number;
        readonly scaleZ?: number;
    } {
        const patch: {
            active?: boolean;
            opacity?: number;
            x?: number;
            y?: number;
            z?: number;
            scaleX?: number;
            scaleY?: number;
            scaleZ?: number;
        } = {};
        if (typeof props.active === 'boolean') {
            patch.active = props.active;
        }
        if (typeof props.opacity === 'number') {
            patch.opacity = props.opacity;
        }
        if (typeof props.x === 'number') {
            patch.x = props.x;
        }
        if (typeof props.y === 'number') {
            patch.y = props.y;
        }
        if (typeof props.z === 'number') {
            patch.z = props.z;
        }
        if (typeof props.scaleX === 'number') {
            patch.scaleX = props.scaleX;
        }
        if (typeof props.scaleY === 'number') {
            patch.scaleY = props.scaleY;
        }
        if (typeof props.scaleZ === 'number') {
            patch.scaleZ = props.scaleZ;
        }
        const position =
            props.position != null && typeof props.position === 'object' && !Array.isArray(props.position)
                ? (props.position as Record<string, unknown>)
                : null;
        if (position != null) {
            if (typeof position.x === 'number' && patch.x == null) {
                patch.x = position.x;
            }
            if (typeof position.y === 'number' && patch.y == null) {
                patch.y = position.y;
            }
            if (typeof position.z === 'number' && patch.z == null) {
                patch.z = position.z;
            }
        }
        if (Object.keys(patch).length === 0) {
            throw new Error('lumen_24_nodeSet_props_empty:allowed=active,opacity,x,y,z,scaleX,scaleY,scaleZ,position');
        }
        return patch;
    }

    private async _executeBindClick(input: ILumenBindClickMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.bindClick(
                projectRoot,
                input.prefabRelativePath,
                input.buttonNodePath,
                input.targetNodePath,
                input.component,
                input.handler,
                input.customEventData,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.refreshCatalog();
        session.bindClick({
            buttonNodePath: input.buttonNodePath,
            targetNodePath: input.targetNodePath,
            component: input.component,
            handler: input.handler,
            customEventData: input.customEventData ?? '',
        });
        session.save();
        return this._decorateWriteResult({ phase: session.phase, prefab: input.prefabRelativePath }, input.prefabRelativePath);
    }

    private async _executeBindSprite(input: ILumenBindSpriteMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.bindSprite(projectRoot, input.prefabRelativePath, input.nodePath, input.spriteFrameUuid);
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.refreshCatalog();
        await this._assertSpriteFrameManaged(session, input.spriteFrameUuid);
        session.bindSprite({
            nodePath: input.nodePath,
            spriteFrameUuid: input.spriteFrameUuid,
        });
        session.save();
        return this._decorateWriteResult({ phase: session.phase, prefab: input.prefabRelativePath }, input.prefabRelativePath);
    }

    private async _executeBindSpriteBatch(input: ILumenBindSpriteBatchMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.bindSpriteBatch(projectRoot, input.prefabRelativePath, input.bindings);
            return this._decorateWriteResult({ ...result, recommendedNext: 'lumen.validateRefs' }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.refreshCatalog();
        for (const binding of input.bindings) {
            await this._assertSpriteFrameManaged(session, binding.spriteFrameUuid);
        }
        session.bindSpriteBatch(input.bindings);
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                prefab: input.prefabRelativePath,
                count: input.bindings.length,
                recommendedNext: 'lumen.validateRefs',
            },
            input.prefabRelativePath,
        );
    }

    private async _executeBindRef(input: ILumenBindRefMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            const result = await Lumen24McpBridge.bindRef(
                projectRoot,
                input.prefabRelativePath,
                input.nodePath,
                input.componentType,
                input.field,
                input.nodeRef,
                input.componentRef,
            );
            return this._decorateWriteResult({ ...result }, input.prefabRelativePath);
        }
        const session = await this._openPrefabSession(input.prefabRelativePath, input.cocosVersion);
        session.refreshCatalog();
        session.bindRef({
            nodePath: input.nodePath,
            componentType: input.componentType,
            field: input.field,
            nodeRef: input.nodeRef,
            componentRef: input.componentRef,
        });
        session.save();
        return this._decorateWriteResult(
            {
                phase: session.phase,
                prefab: input.prefabRelativePath,
                field: input.field,
                recommendedNext: 'lumen.validateRefs',
            },
            input.prefabRelativePath,
        );
    }

    private async _executeValidateRefs(input: ILumenValidateRefsMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._resolveProjectRoot();
            if (input.prefabRelativePath == null || input.prefabRelativePath.trim().length === 0) {
                throw new Error('editor_mcp_lumen_validateRefs_prefab_required');
            }
            return Lumen24McpBridge.validateRefs(projectRoot, input.prefabRelativePath);
        }
        const projectRoot = await this._resolveProjectRoot();
        return new LumenHierarchyRefValidator().validate(projectRoot, {
            prefabRelativePath: input.prefabRelativePath,
        });
    }

    /**
     * @description 绑定前校验 SpriteFrame 所属纹理已在导入账本中受管（或 new-assets 祖父级）。
     * @param session lumen 会话
     * @param spriteFrameUuid SpriteFrame uuid（可含 @ 子资源）
     */
    private async _assertSpriteFrameManaged(session: LumenSession, spriteFrameUuid: string): Promise<void> {
        const trimmed = spriteFrameUuid.trim();
        if (
            trimmed.length === 0 ||
            /^0{8}-0{4}-0{4}-0{4}-0{12}$/u.test(trimmed) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(@[0-9a-f]+)?$/iu.test(trimmed)
        ) {
            throw new Error(`lumen_bind_sprite_uuid_invalid:${trimmed || '(empty)'}`);
        }
        const hit = session.resolveOne({ uuid: trimmed, limit: 1 }) as { path?: unknown };
        if (hit == null || typeof hit.path !== 'string' || hit.path.trim().length === 0) {
            throw new Error(`editor_mcp_bind_sprite_catalog_miss:${trimmed}`);
        }
        const relativeOrDb = hit.path.trim().replace(/\\/g, '/');
        const withoutSub = relativeOrDb.replace(/@[^/]+$/, '');
        const dbPath = withoutSub.startsWith('db://')
            ? withoutSub
            : withoutSub.startsWith('assets/')
              ? `db://${withoutSub}`
              : `db://assets/${withoutSub.replace(/^\/+/, '')}`;
        const ledger = new ManagedAssetLedger(session.projectRoot);
        await ledger.assertManaged([dbPath]);
    }

    private async _executeRefresh(input: ILumenRefreshMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.refresh(projectRoot, input.paths ?? []);
        }
        const session = await this._createSession({}, true);
        const result = await session.requestEditorRefresh(input.paths ?? []);
        return { phase: session.phase, result };
    }

    /**
     * @description commit 专用屏障刷新：flush coalesce + hierarchy settle，再交 catalog/validate。
     * @param paths 提交路径；空则 no-op settle。
     * @returns 刷新结果
     */
    public async refreshForCommit(paths: readonly string[]): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x()) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.refresh(projectRoot, [...paths]);
        }
        const session = await this._createSession({}, true);
        const result = await session.requestEditorRefreshBarrier(paths);
        return { phase: session.phase, result, barrier: true };
    }

    private async _executeCocosInfo(input: ILumenCocosInfoMcpInput): Promise<unknown> {
        if (Lumen24McpBridge.isCreator2x(input.cocosVersion)) {
            const projectRoot = await this._resolveProjectRoot();
            return Lumen24McpBridge.cocosInfo(projectRoot);
        }
        const session = await this._createSession(input.cocosVersion == null ? {} : { cocosVersion: input.cocosVersion });
        return session.probeCocosInfo(input.engineRoot, {
            offset: input.gapOffset,
            limit: input.gapLimit,
        });
    }

    /**
     * @description 为写操作结果附加推荐的 `lumen.commit` 下一步。
     * @param payload 业务结果
     * @param prefabRelativePath 刚写入的 prefab
     * @returns 带 recommendedNext 的结果
     */
    private _decorateWriteResult(payload: Record<string, unknown>, prefabRelativePath: string): Record<string, unknown> {
        const kind = typeof payload.kind === 'string' ? payload.kind : this._input.kindFromPath(prefabRelativePath);
        return {
            ...payload,
            kind,
            recommendedNext: {
                operation: 'lumen.commit',
                input: { paths: [prefabRelativePath] },
            },
        };
    }
}
