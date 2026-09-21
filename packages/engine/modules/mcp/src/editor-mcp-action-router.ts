import type {
    ContractPayload,
    EditorMcpActionId,
    EditorMcpOperationId,
    IAssetCatalogLookupMcpInput,
    IEditorMcpActionPlan,
    IEditorMcpActionResult,
    IEditorMcpCapabilityDescriptor,
    IEditorMcpOperationRequest,
    ISceneGetHierarchyMcpInput,
    LocalizedText,
} from '@peanut/pod-protocol';
import { McpControlFlowRefusal } from '@peanut/pod-engine/kernel';
import { ProjectLogPostflightMonitor, ResourceLockManager } from '@peanut/pod-engine/runtime';
import { EditorMcpExecutionLaneResolver, ProductLineMcpPolicy } from '@peanut/pod-protocol';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';
import { AssetCatalogFastLookupApi, CompatibleUuid, type IAssetCatalogFastLookup } from '@peanut/pod-engine/assets';

import { EditorMcpAssetDiagnostics } from './editor-mcp-asset-diagnostics.js';
import { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';
import {
    EditorMcpAssetDbCreationCoordinator,
    type IEditorMcpAssetDbCreationEvidence,
} from './editor-mcp-asset-db-creation-coordinator.js';
import { EditorMcpBuilderGateway } from './editor-mcp-builder-gateway.js';
import { EditorMcpReferenceGateway } from './editor-mcp-reference-gateway.js';
import { Lumen24McpBridge } from './editor-mcp-lumen-24-bridge.js';
import { EditorMcpSilentAssetGateway } from './editor-mcp-silent-asset-gateway.js';
import { EditorMcpEditorGateway } from './editor-mcp-editor-gateway.js';
import { EditorMcpLumenCommitFacade } from './editor-mcp-lumen-commit-facade.js';
import { EditorMcpLumenGateway } from './editor-mcp-lumen-gateway.js';
import { EditorMcpPreviewGateway } from './editor-mcp-preview-gateway.js';
import { EditorMcpSceneGateway } from './editor-mcp-scene-gateway.js';
import { EditorMcpPrefabOfflineGateway } from './editor-mcp-prefab-offline-gateway.js';
import { CAPABILITIES, type EditorMcpCapabilitySeed } from './editor-mcp-capability-catalog.js';
import { ResourceOperationPlanner } from './resource-operation-planner.js';
import { ResourceOperationTaskExecutor } from './resource-operation-task-executor.js';

/**
 * @description 显式校验外部 MCP 输入，并通过受限 runtime grant 与插件服务执行 action。
 */
export class EditorMcpActionRouter {
    /**
     * @description 跨 Router 共享的原子资源锁管理器。
     */
    private static readonly _sharedResourceLockManager = new ResourceLockManager();
    /**
     * @description 由当前实例持有的授权 runtime client 集合。
     */
    private readonly _runtime: IGrantedRuntimeClientSet;
    /**
     * @description 资产目录 MCP 快查接口。
     */
    private readonly _catalogLookup: IAssetCatalogFastLookup;
    /**
     * @description 资产诊断与搜索。
     */
    private readonly _diagnostics: EditorMcpAssetDiagnostics;
    /**
     * @description 预览网关。
     */
    private readonly _preview: EditorMcpPreviewGateway;
    /**
     * @description 构建网关。
     */
    private readonly _builder: EditorMcpBuilderGateway;
    /**
     * @description 场景参考图薄层（P1 MVP / refused stubs）。
     */
    private readonly _reference: EditorMcpReferenceGateway;
    /**
     * @description 场景 / Prefab 薄层网关。
     */
    private readonly _sceneGateway: EditorMcpSceneGateway;
    /**
     * @description lumen 资产文档网关。
     */
    private readonly _lumen: EditorMcpLumenGateway;
    /**
     * @description 当前 lumen 网关是否已接入首次创建协调器。
     */
    private _lumenCreationCoordinationEnabled = false;
    /**
     * @description 离线 Prefab 控制器绑定网关。
     */
    private readonly _prefabOffline: EditorMcpPrefabOfflineGateway;
    /**
     * @description 静默资产 / import 编排。
     */
    private readonly _silentAssets: EditorMcpSilentAssetGateway;
    /**
     * @description lumen.commit 收口。
     */
    private readonly _lumenCommit: EditorMcpLumenCommitFacade;
    /**
     * @description 编辑器选区 / 打开 / 恢复。
     */
    private readonly _editor: EditorMcpEditorGateway;
    /**
     * @description 跨 Router 共享的项目级资源调度器。
     */
    private readonly _resourceTaskExecutor: ResourceOperationTaskExecutor;
    /**
     * @description 写 operation 资源闭包规划器。
     */
    private readonly _taskPlanner: ResourceOperationPlanner;

    /**
     * @description 创建一个新的 Editor MCP action router。
     * @param runtime 由插件宿主裁剪并可撤销的 runtime client 集合
     * @param catalogLookup 资产目录快查接口；测试可注入替代实现
     * @param lumenGateway 可选 lumen 网关；测试可注入替代实现
     * @param resourceLockManager 可选项目级原子资源锁管理器；默认跨 Router 共享
     */
    public constructor(
        runtime: IGrantedRuntimeClientSet,
        catalogLookup: IAssetCatalogFastLookup = new AssetCatalogFastLookupApi(),
        lumenGateway?: EditorMcpLumenGateway,
        resourceLockManager: ResourceLockManager = EditorMcpActionRouter._sharedResourceLockManager,
    ) {
        this._runtime = runtime;
        this._catalogLookup = catalogLookup;
        this._taskPlanner = new ResourceOperationPlanner();
        this._diagnostics = new EditorMcpAssetDiagnostics();
        this._preview = new EditorMcpPreviewGateway(runtime, async () => {
            try {
                return await this._requireProjectPath();
            } catch {
                return null;
            }
        });
        this._builder = new EditorMcpBuilderGateway(runtime);
        this._reference = new EditorMcpReferenceGateway(runtime, async () => {
            try {
                return await this._requireProjectPath();
            } catch {
                return null;
            }
        });
        this._sceneGateway = new EditorMcpSceneGateway(runtime);
        this._lumen = lumenGateway ?? new EditorMcpLumenGateway(async () => this._requireProjectPath());
        const assetDbTransaction = new EditorMcpAssetDbTransaction({
            requireProjectPath: async () => this._requireProjectPath(),
            requireMessage: () => this._requireMessage(),
            refreshForCommit: async (paths) => this._lumen.refreshForCommit(paths),
        });
        const creationCoordinator = new EditorMcpAssetDbCreationCoordinator({
            requireProjectPath: async () => this._requireProjectPath(),
            requireMessage: () => this._requireMessage(),
            transaction: assetDbTransaction,
        });
        if (this._runtime.message != null) {
            const configurableLumen = this._lumen as unknown as {
                configureCreationCoordinator?: (coordinator: EditorMcpAssetDbCreationCoordinator) => void;
            };
            if (configurableLumen.configureCreationCoordinator != null) {
                configurableLumen.configureCreationCoordinator(creationCoordinator);
                this._lumenCreationCoordinationEnabled = true;
            }
            this._sceneGateway.configureCreationCoordinator(creationCoordinator);
        }
        this._prefabOffline = new EditorMcpPrefabOfflineGateway();
        this._silentAssets = new EditorMcpSilentAssetGateway({
            requireProjectPath: async () => this._requireProjectPath(),
            lumen: this._lumen,
            runtime: this._runtime,
            assetDbTransaction,
            isRecord: (value: unknown): value is Record<string, unknown> => this._isRecord(value),
        });
        this._lumenCommit = new EditorMcpLumenCommitFacade({
            requireProjectPath: async () => this._requireProjectPath(),
            lumen: this._lumen,
            requireCatalogLookup: () => this._requireCatalogLookup(),
            assetDbTransaction,
        });
        this._editor = new EditorMcpEditorGateway({
            runtime: this._runtime,
            requireProjectPath: async () => this._requireProjectPath(),
            requireAssetRead: () => this._requireAssetRead(),
            requireSelection: () => this._requireSelection(),
            requireScene: () => this._requireScene(),
            requireMessage: () => this._requireMessage(),
            diagnostics: this._diagnostics,
            sceneGateway: this._sceneGateway,
            isRecord: (value: unknown): value is Record<string, unknown> => this._isRecord(value),
        });
        this._resourceTaskExecutor = new ResourceOperationTaskExecutor({
            plan: async (operation, input) => this.planManagedResourceOperation(operation as EditorMcpOperationId, input),
            execute: async (operation, input, context) =>
                this.executeManagedResourceOperation(operation as EditorMcpOperationId, input, context),
            lockManager: resourceLockManager,
        });
    }

    /**
     * @description 返回当前 MVP 可调用的 MCP 能力（注入 lane 与 description 前缀）。
     * @returns 稳定能力描述列表
     */
    public listCapabilities(): readonly IEditorMcpCapabilityDescriptor[] {
        const phase = this._runtime.version.getCurrentVersion().phase;
        return CAPABILITIES.filter((capability) => ProductLineMcpPolicy.decide(phase, capability.operation) === 'allow').map((capability) =>
            this._enrichCapabilityDescriptor(capability),
        );
    }

    /**
     * @description 为能力种子注入执行车道与 description 前缀。
     * @param capability 能力种子。
     * @returns 完整能力描述。
     */
    private _enrichCapabilityDescriptor(capability: EditorMcpCapabilitySeed): IEditorMcpCapabilityDescriptor {
        const lane = EditorMcpExecutionLaneResolver.resolve(capability.operation);
        const prefix = EditorMcpExecutionLaneResolver.descriptionPrefix(lane);
        return {
            operation: capability.operation,
            readOnly: capability.readOnly,
            risk: capability.risk,
            requiresInput: capability.requiresInput,
            lane,
            description: this._prependLocalizedText(prefix, capability.description),
        };
    }

    /**
     * @description 将车道前缀拼到已有 LocalizedText（避免重复前缀）。
     * @param prefix 车道前缀。
     * @param description 原说明。
     * @returns 合并后的说明。
     */
    private _prependLocalizedText(prefix: LocalizedText, description: LocalizedText): LocalizedText {
        const prefixRecord = typeof prefix === 'string' ? { 'en-US': prefix, 'zh-CN': prefix } : prefix;
        if (typeof description === 'string') {
            const enPrefix = prefixRecord['en-US'] ?? '';
            if (description.startsWith('[lane:')) {
                return description;
            }
            return `${enPrefix}${description}`;
        }
        const en = description['en-US'] ?? '';
        const zh = description['zh-CN'] ?? en;
        if (en.startsWith('[lane:')) {
            return description;
        }
        return {
            'en-US': `${prefixRecord['en-US'] ?? ''}${en}`,
            'zh-CN': `${prefixRecord['zh-CN'] ?? ''}${zh}`,
        };
    }

    /**
     * @description 根据 action 路由外部 MCP 请求。
     * @param action 稳定 MCP action 标识
     * @param payload 外部请求负载
     * @returns 能力列表、执行计划或查询结果
     */
    public async dispatch(
        action: EditorMcpActionId,
        payload?: unknown,
    ): Promise<readonly IEditorMcpCapabilityDescriptor[] | IEditorMcpActionPlan | IEditorMcpActionResult> {
        if (action === 'editor-mcp.capabilities.list' || action === 'cocos.capabilities') {
            return this.listCapabilities();
        }
        const request = this._readOperationRequest(payload);
        if (action === 'editor-mcp.plan' || action === 'cocos.plan') {
            return this.plan(request);
        }
        if (action === 'editor-mcp.execute' || action === 'cocos.call') {
            return this.execute(request);
        }
        throw new Error(`editor_mcp_action_unsupported:${action}`);
    }

    /**
     * @description 为已校验的操作生成执行计划。
     * @param request 已校验的操作请求
     * @returns 当前操作的执行计划
     */
    public plan(request: IEditorMcpOperationRequest): IEditorMcpActionPlan {
        this._validateOperationInput(request);
        const readOnly = this._isReadOnlyOperation(request.operation);
        let risk = this._riskForOperation(request.operation);
        if (request.operation === 'asset.import' && (request.input?.overwrite === true || request.input?.mode === 'override')) {
            risk = 'destructive';
        }
        return {
            operation: request.operation,
            readOnly,
            risk,
            lane: EditorMcpExecutionLaneResolver.resolve(request.operation),
            executable: this._isRuntimeGrantAvailable(request.operation),
        };
    }

    /**
     * @description 执行已校验的 MCP 操作。
     * @param request 已校验的操作请求
     * @returns 查询结果
     */
    public async execute(request: IEditorMcpOperationRequest): Promise<IEditorMcpActionResult> {
        this._validateOperationInput(request);
        const phase = this._runtime.version.getCurrentVersion().phase;
        if (ProductLineMcpPolicy.decide(phase, request.operation) === 'refuse') {
            McpControlFlowRefusal.reject(ProductLineMcpPolicy.refuseError(phase, request.operation));
        }
        const planned = this.plan(request);
        if (planned.readOnly) {
            return this._executeDirect(request);
        }
        if (planned.risk === 'destructive' && this._readConfirmDestructive(request.input) !== true) {
            McpControlFlowRefusal.reject('editor_mcp_destructive_confirmation_required');
        }
        const taskId = CompatibleUuid.create();
        const projectKey = await this._requireProjectPath();
        const taskResult = await this._resourceTaskExecutor.execute({
            requestId: taskId,
            pluginId: 'peanut.editor-mcp',
            scope: 'project',
            priority: 'normal',
            kind: ResourceOperationTaskExecutor.KIND,
            payload: { operation: request.operation, input: request.input ?? {} },
            ...(request.execution?.timeoutMs == null ? {} : { timeoutMs: request.execution.timeoutMs }),
        }, {
            owner: {
                pluginId: 'peanut.editor-mcp',
                connectionId: 'internal:editor-mcp-router',
                projectKey,
                capability: request.operation,
            },
            signal: new AbortController().signal,
            enterCommitWindow: () => true,
            recordEvidence: () => undefined,
        });
        if (!this._isRecord(taskResult) || typeof taskResult.operation !== 'string' || !('data' in taskResult)) {
            throw new Error(`editor_mcp_task_result_invalid:${taskId}`);
        }
        return {
            ...taskResult,
            operation: taskResult.operation as EditorMcpOperationId,
            data: taskResult.data,
            taskId,
            taskStatus: 'succeeded',
        };
    }

    /**
     * @description 为受管 executor 规划完整资源闭包。
     */
    public async planManagedResourceOperation(
        operation: EditorMcpOperationId,
        input: Readonly<Record<string, unknown>>,
    ): Promise<ReturnType<ResourceOperationPlanner['plan']>> {
        return this._taskPlanner.plan(await this._requireProjectPath(), operation, input);
    }

    /**
     * @description 在 executor 已取得资源锁后执行原业务 worker 与唯一项目日志 postflight。
     */
    public async executeManagedResourceOperation(
        operation: EditorMcpOperationId,
        input: Readonly<Record<string, unknown>>,
        context?: import('@peanut/pod-sdk').IPluginTaskExecutorContext,
    ): Promise<IEditorMcpActionResult> {
        const request: IEditorMcpOperationRequest = { operation, input };
        this._validateOperationInput(request);
        const planned = this.plan(request);
        if (planned.readOnly) {
            throw new Error(`editor_mcp_managed_operation_read_only:${operation}`);
        }
        if (planned.risk === 'destructive' && this._readConfirmDestructive(input) !== true) {
            McpControlFlowRefusal.reject('editor_mcp_destructive_confirmation_required');
        }
        const projectRoot = await this._requireProjectPath();
        const postflightMonitor = new ProjectLogPostflightMonitor();
        const logCheckpoint = postflightMonitor.checkpoint(projectRoot);
        const result = await this._executeDirect(request, context);
        const creation = this._readRequiredCreationEvidence(operation, input, result.data);
        const postflight = postflightMonitor.readDelta(logCheckpoint);
        if (!postflight.logChecked || postflight.newErrorCount > 0 || postflight.newWarningCount > 0) {
            throw new Error(
                `editor_mcp_project_log_postflight_failed:errors=${postflight.newErrorCount}:warnings=${postflight.newWarningCount}`,
            );
        }
        if (creation != null) {
            context?.recordEvidence({
                id: 'assetdb-creation',
                kind: 'assetdb_settle',
                status: 'completed',
                summary: `Verified ${creation.resourceType} AssetDB identity; polls=${creation.polls}; meta=${creation.metaPresent}.`,
                recordedAt: new Date().toISOString(),
            });
        }
        return {
            ...result,
            data: this._isRecord(result.data)
                ? { ...result.data, taskPostflight: postflight, ...(creation == null ? {} : { creation }) }
                : { value: result.data, taskPostflight: postflight, ...(creation == null ? {} : { creation }) },
        };
    }

    /**
     * @description 执行已排队的单个 operation；写任务必须由 execute 统一排队。
     * @param request 已校验操作请求。
     * @returns 原有 MCP 执行结果。
     */
    private async _executeDirect(
        request: IEditorMcpOperationRequest,
        context?: import('@peanut/pod-sdk').IPluginTaskExecutorContext,
    ): Promise<IEditorMcpActionResult> {
        this._validateOperationInput(request);
        const phase = this._runtime.version.getCurrentVersion().phase;
        if (ProductLineMcpPolicy.decide(phase, request.operation) === 'refuse') {
            McpControlFlowRefusal.reject(ProductLineMcpPolicy.refuseError(phase, request.operation));
        }
        const planned = this.plan(request);
        if (planned.risk === 'destructive' && this._readConfirmDestructive(request.input) !== true) {
            McpControlFlowRefusal.reject('editor_mcp_destructive_confirmation_required');
        }
        switch (request.operation) {
            case 'editor.queryVersion':
                return {
                    operation: request.operation,
                    data: this._runtime.version.getCurrentVersion(),
                };
            case 'editor.queryProject':
                return {
                    operation: request.operation,
                    data: {
                        name: await this._requireProjectRead().getProjectName(),
                        path: await this._requireProjectRead().getProjectPath(),
                    },
                };
            case 'editor.querySelection':
                return {
                    operation: request.operation,
                    data: await this._editor.executeQuerySelection(),
                };
            case 'editor.setSelection':
                return {
                    operation: request.operation,
                    data: await this._editor.executeSetSelection(request.input),
                };
            case 'asset.queryInfo':
                return {
                    operation: request.operation,
                    data: await this._editor.executeAssetQueryInfo(request.input),
                };
            case 'asset.catalog.summary':
                return {
                    operation: request.operation,
                    data: this._requireCatalogLookup().summary(await this._requireProjectPath()),
                };
            case 'asset.catalog.lookup':
                return {
                    operation: request.operation,
                    data: this._requireCatalogLookup().lookup(
                        await this._requireProjectPath(),
                        this._readCatalogLookupInput(request.input),
                    ),
                };
            case 'asset.catalog.refresh':
                return {
                    operation: request.operation,
                    data: this._requireCatalogLookup().refresh(await this._requireProjectPath()),
                };
            case 'asset.importPlan':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetImportPlan(request.input),
                };
            case 'asset.import':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetImport(request.input),
                };
            case 'asset.managedStatus':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetManagedStatus(request.input),
                };
            case 'asset.queryDependencies':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetQueryDependencies(request.input),
                };
            case 'asset.replaceReferences':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetReplaceReferences(request.input),
                };
            case 'asset.waitReady':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetWaitReady(request.input),
                };
            case 'asset.scanMissingReferences':
                return {
                    operation: request.operation,
                    data: this._diagnostics.scanMissing(
                        await this._requireProjectPath(),
                        this._diagnostics.readScanMissingInput(request.input),
                    ),
                };
            case 'asset.findReferencingNodes':
                return {
                    operation: request.operation,
                    data: this._diagnostics.findReferencingNodes(
                        await this._requireProjectPath(),
                        this._diagnostics.readFindReferencingNodesInput(request.input),
                    ),
                };
            case 'asset.resolve':
                return {
                    operation: request.operation,
                    data: this._diagnostics.resolve(await this._requireProjectPath(), this._diagnostics.readResolveInput(request.input)),
                };
            case 'asset.search':
                return {
                    operation: request.operation,
                    data: this._diagnostics.search(await this._requireProjectPath(), this._diagnostics.readSearchInput(request.input)),
                };
            case 'asset.auditUnmanagedWrites':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetAuditUnmanagedWrites(request.input),
                };
            case 'asset.queryPropertySchema':
                return {
                    operation: request.operation,
                    data: await this._editor.executeAssetQueryPropertySchema(request.input),
                };
            case 'asset.queryInheritance':
                return {
                    operation: request.operation,
                    data: this._diagnostics.queryInheritance(
                        await this._requireProjectPath(),
                        this._diagnostics.readAssetLocateInput(request.input),
                    ),
                };
            case 'asset.queryCompatibleTypes':
                return {
                    operation: request.operation,
                    data: this._diagnostics.queryCompatibleTypes(
                        await this._requireProjectPath(),
                        this._diagnostics.readCompatibleTypesInput(request.input),
                    ),
                };
            case 'asset.open':
                return {
                    operation: request.operation,
                    data: await this._editor.executeAssetOpen(request.input),
                };
            case 'asset.copy':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetCopy(request.input),
                };
            case 'asset.move':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetMove(request.input),
                };
            case 'asset.rename':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetRename(request.input),
                };
            case 'asset.createFolder':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetCreateFolder(request.input),
                };
            case 'asset.delete':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetDelete(request.input),
                };
            case 'asset.reimport':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetReimport(request.input),
                };
            case 'asset.writeText':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetWriteText(request.input),
                };
            case 'asset.ensureSpriteFramesBatch':
                return {
                    operation: request.operation,
                    data: await this._silentAssets._executeAssetEnsureSpriteFramesBatch(request.input),
                };
            case 'scene.getCurrent':
                return {
                    operation: request.operation,
                    data: await this._requireScene().getCurrent(),
                };
            case 'scene.getHierarchy': {
                const hierarchy = await this._sceneGateway.getHierarchyWithFallback(this._readSceneHierarchyInput(request.input));
                return {
                    operation: request.operation,
                    data: {
                        nodes: hierarchy.nodes,
                        count: hierarchy.nodes.length,
                        availability: hierarchy.availability,
                    },
                };
            }
            case 'scene.queryCurrentEditorResource':
                return {
                    operation: request.operation,
                    data: await this._editor.executeQueryCurrentEditorResource(),
                };
            case 'scene.restoreEditorResource':
                return {
                    operation: request.operation,
                    data: await this._editor.executeRestoreEditorResource(request.input),
                };
            case 'scene.resolvePrefabRootUuid':
                return {
                    operation: request.operation,
                    data: await this._editor.executeResolvePrefabRootUuid(request.input),
                };
            case 'scene.open':
                return {
                    operation: request.operation,
                    data: await this._editor.executeSceneOpen(request.input),
                };
            case 'scene.save':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.save(this._sceneGateway.readSaveInput(request.input)),
                };
            case 'scene.reload':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.reload(this._sceneGateway.readReloadInput(request.input)),
                };
            case 'scene.queryNode': {
                const queryInput = this._sceneGateway.readQueryNodeInput(request.input);
                const hierarchy = await this._sceneGateway.getHierarchyWithFallback({
                    includeEditorNodes: queryInput.includeEditorNodes === true,
                });
                return {
                    operation: request.operation,
                    data: this._sceneGateway.queryNodeWithNodes(queryInput, hierarchy.nodes, hierarchy.availability),
                };
            }
            case 'scene.focusNode':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.focusNode(this._sceneGateway.readFocusNodeInput(request.input)),
                };
            case 'scene.createNode':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.createNode(this._sceneGateway.readCreateNodeInput(request.input)),
                };
            case 'prefab.createFromNode':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.createFromNode(
                        this._sceneGateway.readCreateFromNodeInput(request.input),
                        context,
                    ),
                };
            case 'prefab.apply':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.apply(this._sceneGateway.readInstanceOpInput(request.input)),
                };
            case 'prefab.revert':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.revert(this._sceneGateway.readInstanceOpInput(request.input)),
                };
            case 'prefab.unpack':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.unpack(this._sceneGateway.readInstanceOpInput(request.input)),
                };
            case 'prefab.unlink':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.unlink(this._sceneGateway.readInstanceOpInput(request.input)),
                };
            case 'prefab.getInfo':
                return {
                    operation: request.operation,
                    data: await this._sceneGateway.getInfo(this._sceneGateway.readGetInfoInput(request.input)),
                };
            case 'preview.query':
                return {
                    operation: request.operation,
                    data: await this._preview.query(this._preview.readQueryInput(request.input)),
                };
            case 'preview.refresh':
                return {
                    operation: request.operation,
                    data: await this._preview.refresh(this._preview.readRefreshInput(request.input)),
                };
            case 'preview.queryErrors':
                return {
                    operation: request.operation,
                    data: await this._preview.queryErrors(this._preview.readErrorsInput(request.input)),
                };
            case 'builder.queryPlatforms':
                return {
                    operation: request.operation,
                    data: await this._builder.queryPlatforms(this._builder.readPlatformsInput(request.input)),
                };
            case 'builder.querySchema':
                return {
                    operation: request.operation,
                    data: await this._builder.querySchema(this._builder.readSchemaInput(request.input)),
                };
            case 'builder.queryDefaultConfig':
                return {
                    operation: request.operation,
                    data: await this._builder.queryDefaultConfig(this._builder.readDefaultConfigInput(request.input)),
                };
            case 'builder.build':
                return {
                    operation: request.operation,
                    data: await this._builder.build(this._builder.readBuildInput(request.input)),
                };
            case 'reference.queryImage':
                return {
                    operation: request.operation,
                    data: await this._reference.queryImage(this._reference.readQueryInput(request.input)),
                };
            case 'reference.setImage':
                return {
                    operation: request.operation,
                    data: await this._reference.setImage(this._reference.readSetInput(request.input)),
                };
            case 'lumen.bindController':
                return {
                    operation: request.operation,
                    data: await this._executeLumenBindController(request.input),
                };
            default:
                if (request.operation === 'lumen.commit') {
                    return {
                        operation: request.operation,
                        data: await this._lumenCommit._executeLumenCommit(request.input),
                    };
                }
                if (EditorMcpLumenGateway.isLumenOperation(request.operation)) {
                    const lumenInput = this._stripHubControlFields(request.input);
                    const data = await this._lumen.execute(request.operation, lumenInput, context);
                    if (EditorMcpLumenGateway.isWriteOperation(request.operation) && EditorMcpLumenGateway.readAutoCommit(request.input)) {
                        const paths = EditorMcpLumenGateway.readCommitPaths(data);
                        const commit = await this._lumenCommit._executeLumenCommit(paths.length === 0 ? lumenInput : { paths });
                        return {
                            operation: request.operation,
                            data: {
                                ...(typeof data === 'object' && data != null && !Array.isArray(data) ? data : { result: data }),
                                autoCommit: true,
                                commit,
                            },
                        };
                    }
                    return {
                        operation: request.operation,
                        data,
                    };
                }
                throw new Error(`editor_mcp_operation_unsupported:${request.operation}`);
        }
    }

    /**
     * @description 解析 scene.getHierarchy 输入。
     * @param input 未校验输入。
     * @returns 层次选项。
     */
    private _readSceneHierarchyInput(input: ContractPayload | undefined): ISceneGetHierarchyMcpInput {
        if (input == null) {
            return {};
        }
        if (!this._isRecord(input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        return {
            includeEditorNodes: input.includeEditorNodes === true,
        };
    }

    /**
     * @description 校验并收窄未知外部 payload 为操作请求。
     * @param payload 未校验负载。
     * @returns 操作请求。
     */
    private _readOperationRequest(payload: unknown): IEditorMcpOperationRequest {
        if (!this._isRecord(payload) || typeof payload.operation !== 'string') {
            throw new Error('editor_mcp_invalid_operation_request');
        }
        if (!CAPABILITIES.some((capability) => capability.operation === payload.operation)) {
            throw new Error(`editor_mcp_operation_unsupported:${payload.operation}`);
        }
        if (payload.input != null && !this._isRecord(payload.input)) {
            throw new Error('editor_mcp_invalid_operation_input');
        }
        return {
            operation: payload.operation as EditorMcpOperationId,
            input: payload.input ?? undefined,
        };
    }

    /**
     * @description 校验单项操作的输入约束。
     */
    private _validateOperationInput(request: IEditorMcpOperationRequest): void {
        if (request.operation === 'editor.setSelection') {
            this._editor.readSetSelectionInput(request.input);
        }
        if (request.operation === 'asset.queryInfo') {
            this._editor.readAssetQueryInfoKeys(request.input);
        }
        if (request.operation === 'asset.catalog.lookup') {
            this._readCatalogLookupInput(request.input);
        }
        if (request.operation === 'asset.importPlan') {
            this._silentAssets._readAssetImportPlanInput(request.input);
        }
        if (request.operation === 'asset.import') {
            this._silentAssets._readAssetImportInput(request.input);
        }
        if (request.operation === 'asset.managedStatus') {
            this._silentAssets._readAssetManagedStatusInput(request.input);
        }
        if (request.operation === 'asset.queryDependencies') {
            this._silentAssets._readAssetQueryDependenciesInput(request.input);
        }
        if (request.operation === 'asset.replaceReferences') {
            this._silentAssets._readAssetReplaceReferencesInput(request.input);
        }
        if (request.operation === 'asset.waitReady') {
            this._silentAssets._readAssetWaitReadyInput(request.input);
        }
        if (request.operation === 'asset.scanMissingReferences') {
            this._diagnostics.readScanMissingInput(request.input);
        }
        if (request.operation === 'asset.findReferencingNodes') {
            this._diagnostics.readFindReferencingNodesInput(request.input);
        }
        if (request.operation === 'asset.resolve') {
            this._diagnostics.readResolveInput(request.input);
        }
        if (request.operation === 'asset.search') {
            this._diagnostics.readSearchInput(request.input);
        }
        if (request.operation === 'asset.auditUnmanagedWrites') {
            // optional filters only
        }
        if (request.operation === 'asset.queryPropertySchema' || request.operation === 'asset.queryInheritance') {
            this._diagnostics.readAssetLocateInput(request.input);
        }
        if (request.operation === 'asset.queryCompatibleTypes') {
            this._diagnostics.readCompatibleTypesInput(request.input);
        }
        if (request.operation === 'asset.open') {
            this._editor.readAssetOpenInput(request.input);
        }
        if (request.operation === 'asset.copy') {
            this._silentAssets._readAssetCopyInput(request.input);
        }
        if (request.operation === 'asset.move') {
            this._silentAssets._readAssetMoveInput(request.input);
        }
        if (request.operation === 'asset.rename') {
            this._silentAssets._readAssetRenameInput(request.input);
        }
        if (request.operation === 'asset.createFolder') {
            this._silentAssets._readAssetCreateFolderInput(request.input);
        }
        if (request.operation === 'asset.delete') {
            this._silentAssets._readAssetDeleteInput(request.input);
        }
        if (request.operation === 'asset.reimport') {
            this._silentAssets._readAssetReimportInput(request.input);
        }
        if (request.operation === 'asset.writeText') {
            this._silentAssets._readAssetWriteTextInput(request.input);
        }
        if (request.operation === 'asset.ensureSpriteFramesBatch') {
            this._silentAssets._readAssetEnsureSpriteFramesBatchInput(request.input);
        }
        if (request.operation === 'preview.query') {
            this._preview.readQueryInput(request.input);
        }
        if (request.operation === 'preview.refresh') {
            this._preview.readRefreshInput(request.input);
        }
        if (request.operation === 'preview.queryErrors') {
            this._preview.readErrorsInput(request.input);
        }
        if (request.operation === 'builder.queryPlatforms') {
            this._builder.readPlatformsInput(request.input);
        }
        if (request.operation === 'builder.querySchema') {
            this._builder.readSchemaInput(request.input);
        }
        if (request.operation === 'builder.queryDefaultConfig') {
            this._builder.readDefaultConfigInput(request.input);
        }
        if (request.operation === 'builder.build') {
            this._builder.readBuildInput(request.input);
        }
        if (request.operation === 'reference.queryImage') {
            this._reference.readQueryInput(request.input);
        }
        if (request.operation === 'reference.setImage') {
            this._reference.readSetInput(request.input);
        }
        if (request.operation === 'scene.getHierarchy') {
            this._readSceneHierarchyInput(request.input);
        }
        if (request.operation === 'scene.resolvePrefabRootUuid') {
            this._editor.readResolvePrefabRootUuidInput(request.input);
        }
        if (request.operation === 'scene.restoreEditorResource') {
            this._editor.readRestoreEditorResourceInput(request.input);
        }
        if (request.operation === 'scene.open') {
            this._sceneGateway.readOpenInput(request.input);
        }
        if (request.operation === 'scene.save') {
            this._sceneGateway.readSaveInput(request.input);
        }
        if (request.operation === 'scene.reload') {
            this._sceneGateway.readReloadInput(request.input);
        }
        if (request.operation === 'scene.queryNode') {
            this._sceneGateway.readQueryNodeInput(request.input);
        }
        if (request.operation === 'scene.focusNode') {
            this._sceneGateway.readFocusNodeInput(request.input);
        }
        if (request.operation === 'scene.createNode') {
            this._sceneGateway.readCreateNodeInput(request.input);
        }
        if (request.operation === 'prefab.createFromNode') {
            this._sceneGateway.readCreateFromNodeInput(request.input);
        }
        if (
            request.operation === 'prefab.apply' ||
            request.operation === 'prefab.revert' ||
            request.operation === 'prefab.unpack' ||
            request.operation === 'prefab.unlink'
        ) {
            this._sceneGateway.readInstanceOpInput(request.input);
        }
        if (request.operation === 'prefab.getInfo') {
            this._sceneGateway.readGetInfoInput(request.input);
        }
        // bindController 由 router 直连 2.4/离线路径，不经 3.x lumen gateway。
        if (request.operation === 'lumen.bindController') {
            this._readLumenBindControllerInput(this._stripHubControlFields(request.input));
            return;
        }
        if (EditorMcpLumenGateway.isLumenOperation(request.operation)) {
            this._lumen.validate(request.operation, this._stripHubControlFields(request.input));
        }
    }

    /**
     * @description 读取并校验资产目录快查输入。
     */
    private _readCatalogLookupInput(input: ContractPayload | undefined): IAssetCatalogLookupMcpInput {
        if (input == null) {
            throw new Error('editor_mcp_catalog_lookup_input_required');
        }
        const supportedFields = new Set(['uuid', 'type', 'name', 'path', 'limit']);
        for (const fieldName of Object.keys(input)) {
            if (!supportedFields.has(fieldName)) {
                throw new Error(`editor_mcp_catalog_lookup_field_unsupported:${fieldName}`);
            }
        }
        const uuid = this._readOptionalNonEmptyString(input.uuid, 'uuid');
        const type = this._readOptionalNonEmptyString(input.type, 'type');
        const name = this._readOptionalNonEmptyString(input.name, 'name');
        const path = this._readOptionalNonEmptyString(input.path, 'path');
        const limit = this._readOptionalLimit(input.limit);
        if (uuid == null && type == null && name == null && path == null) {
            throw new Error('editor_mcp_catalog_lookup_requires_uuid_or_type_or_name_or_path');
        }
        return { uuid, type, name, path, limit };
    }

    /**
     * @description 读取可选非空字符串字段。
     */
    private _readOptionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
        if (value == null) {
            return undefined;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`editor_mcp_catalog_lookup_${fieldName}_invalid`);
        }
        return value.trim();
    }

    /**
     * @description 读取可选 limit。
     */
    private _readOptionalLimit(value: unknown): number | undefined {
        if (value == null) {
            return undefined;
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > AssetCatalogFastLookupApi.maxLimit) {
            throw new Error('editor_mcp_catalog_lookup_limit_invalid');
        }
        return value;
    }

    /**
     * @description 离线绑定同名控制器脚本到 Prefab。
     * @param input 未校验输入
     * @returns 绑定摘要
     */
    private async _executeLumenBindController(input: ContractPayload | undefined): Promise<unknown> {
        const projectRoot = await this._requireProjectPath();
        const request = this._readLumenBindControllerInput(this._stripHubControlFields(input));
        if (Lumen24McpBridge.isCreator2x()) {
            return Lumen24McpBridge.bindController(projectRoot, {
                prefabRelativePath: request.prefabRelativePath,
                scriptRelativePath: request.scriptRelativePath,
                className: request.className,
                propertyBindings: request.propertyBindings,
                propertyComponents: request.propertyComponents,
                buttonEvents: request.buttonEvents,
            });
        }
        return this._prefabOffline.bindScriptInPrefab(
            projectRoot,
            request,
            async (scriptRelativePath: string) => await this._resolveAssetUuidByPath(scriptRelativePath),
        );
    }

    /**
     * @description 读取 lumen.bindController 输入。
     * @param input 未校验输入
     * @returns 绑定入参
     */
    private _readLumenBindControllerInput(
        input: ContractPayload | undefined,
    ): import('./editor-mcp-prefab-offline-gateway.js').IPrefabBindScriptMcpInput {
        if (input == null) {
            throw new Error('editor_mcp_bind_controller_input_required');
        }
        const supportedFields = new Set([
            'prefabRelativePath',
            'scriptRelativePath',
            'className',
            'propertyBindings',
            'propertyComponents',
            'buttonEvents',
            'autoCommit',
        ]);
        for (const fieldName of Object.keys(input)) {
            if (!supportedFields.has(fieldName)) {
                throw new Error(`editor_mcp_bind_controller_field_unsupported:${fieldName}`);
            }
        }
        if (typeof input.prefabRelativePath !== 'string') {
            throw new Error('editor_mcp_bind_controller_prefabRelativePath_invalid');
        }
        if (typeof input.scriptRelativePath !== 'string') {
            throw new Error('editor_mcp_bind_controller_scriptRelativePath_invalid');
        }
        if (typeof input.className !== 'string' || input.className.trim().length === 0) {
            throw new Error('editor_mcp_bind_controller_className_invalid');
        }
        const propertyBindings = readStringRecord(input.propertyBindings);
        const propertyComponents = readStringRecord(input.propertyComponents);
        const buttonEvents = Array.isArray(input.buttonEvents)
            ? input.buttonEvents.flatMap((entry) => {
                  if (typeof entry !== 'object' || entry == null || Array.isArray(entry)) {
                      return [];
                  }
                  const row = entry as Record<string, unknown>;
                  const nodeName = typeof row.nodeName === 'string' ? row.nodeName : '';
                  const nodePath = typeof row.nodePath === 'string' ? row.nodePath : '';
                  const handler = typeof row.handler === 'string' ? row.handler : '';
                  if ((nodeName.length === 0 && nodePath.length === 0) || handler.length === 0) {
                      return [];
                  }
                  return [
                      {
                          nodeName: nodeName || nodePath,
                          ...(nodePath.length === 0 ? {} : { nodePath }),
                          handler,
                          ...(typeof row.customEventData === 'string' ? { customEventData: row.customEventData } : {}),
                      },
                  ];
              })
            : [];
        return {
            prefabRelativePath: input.prefabRelativePath.trim().replace(/\\/g, '/'),
            scriptRelativePath: input.scriptRelativePath.trim().replace(/\\/g, '/'),
            className: input.className.trim(),
            propertyBindings,
            ...(Object.keys(propertyComponents).length === 0 ? {} : { propertyComponents }),
            ...(buttonEvents.length === 0 ? {} : { buttonEvents }),
        };
    }

    /**
     * @description 按项目相对路径解析资源 UUID。
     * @param assetRelativePath 资源相对路径
     * @returns UUID；未命中时 undefined
     */
    private async _resolveAssetUuidByPath(assetRelativePath: string): Promise<string | undefined> {
        const normalized = assetRelativePath.trim().replace(/\\/g, '/');
        if (this._runtime.assetRead != null) {
            try {
                const asset = await this._runtime.assetRead.query(normalized);
                if (typeof asset === 'object' && asset != null && !Array.isArray(asset)) {
                    const uuid = (asset as { uuid?: unknown }).uuid;
                    if (typeof uuid === 'string' && uuid.length > 0) {
                        return uuid;
                    }
                }
            } catch {
                // 回退 catalog
            }
        }
        const projectRoot = await this._requireProjectPath();
        const lookupResult = this._requireCatalogLookup().lookup(projectRoot, {
            path: normalized,
            limit: 5,
        });
        const hits = lookupResult.hits;
        const exact = hits.find((hit) => hit.path.replace(/\\/g, '/') === normalized);
        return exact?.uuid ?? hits[0]?.uuid;
    }

    /**
     * @description 要求 message grant。
     */
    private _requireMessage() {
        if (this._runtime.message == null) {
            throw new Error('editor_mcp_message_grant_required');
        }
        return this._runtime.message;
    }

    /**
     * @description 读取破坏性确认标记；删/覆盖类操作必须显式传入。
     * @param input 未校验输入。
     * @returns 是否确认。
     */
    private _readConfirmDestructive(input: ContractPayload | undefined): boolean {
        return input?.confirmDestructive === true;
    }

    /**
     * @description 去掉 Hub 控制字段，避免灌入 lumen 操作字段校验。
     * @param input 入口合并后的输入。
     * @returns 仅业务字段。
     */
    private _stripHubControlFields(input: ContractPayload | undefined): ContractPayload | undefined {
        if (input == null) {
            return input;
        }
        const cleaned: Record<string, unknown> = { ...input };
        delete cleaned.confirmDestructive;
        delete cleaned.approvalToken;
        delete cleaned.approvalId;
        // P2：剥离 resources，勿再写入 __peanutResourcesAudit——lumen/strict gateway
        // 会把未知字段当 field_unsupported；绑定审计已由 Hub/lease 侧完成。
        delete cleaned.resources;
        return cleaned;
    }

    /**
     * @description 判断当前操作是否不会产生项目写入。
     */
    private _isReadOnlyOperation(operation: EditorMcpOperationId): boolean {
        const capability = CAPABILITIES.find((item) => item.operation === operation);
        if (capability != null) {
            return capability.readOnly;
        }
        return true;
    }

    /**
     * @description 返回操作风险等级，供 cocos.plan / capabilities 使用。
     * @param operation 操作标识。
     * @returns 风险。
     */
    private _riskForOperation(operation: EditorMcpOperationId): 'read' | 'write' | 'destructive' {
        const capability = CAPABILITIES.find((item) => item.operation === operation);
        if (capability != null) {
            return capability.risk;
        }
        return this._isReadOnlyOperation(operation) ? 'read' : 'write';
    }

    /**
     * @description 判断当前操作所需的 runtime grant 是否可用。
     */
    private _isRuntimeGrantAvailable(operation: EditorMcpOperationId): boolean {
        switch (operation) {
            case 'editor.queryVersion':
                return true;
            case 'editor.queryProject':
                return this._runtime.projectRead != null;
            case 'editor.querySelection':
                return this._runtime.selection != null;
            case 'editor.setSelection':
                return this._runtime.selection != null || this._runtime.message != null;
            case 'asset.queryInfo':
                return this._runtime.assetRead != null;
            case 'asset.catalog.summary':
            case 'asset.catalog.lookup':
            case 'asset.catalog.refresh':
            case 'asset.importPlan':
            case 'asset.managedStatus':
            case 'asset.queryDependencies':
            case 'asset.waitReady':
            case 'asset.scanMissingReferences':
            case 'asset.findReferencingNodes':
            case 'asset.resolve':
            case 'asset.search':
            case 'asset.auditUnmanagedWrites':
            case 'asset.queryPropertySchema':
            case 'asset.queryInheritance':
            case 'asset.queryCompatibleTypes':
                return this._runtime.projectRead != null;
            case 'asset.open':
            case 'asset.import':
                return this._runtime.projectRead != null && (Lumen24McpBridge.isCreator2x() || this._runtime.message != null);
            case 'asset.copy':
            case 'asset.move':
            case 'asset.rename':
            case 'asset.createFolder':
            case 'asset.delete':
            case 'asset.replaceReferences':
            case 'asset.reimport':
            case 'asset.writeText':
                return this._runtime.projectRead != null;
            case 'asset.ensureSpriteFramesBatch':
                return this._runtime.projectRead != null && (Lumen24McpBridge.isCreator2x() || this._runtime.message != null);
            case 'scene.getCurrent':
            case 'scene.getHierarchy':
            case 'scene.resolvePrefabRootUuid':
            case 'scene.queryNode':
                return this._runtime.scene != null;
            case 'scene.focusNode':
                return this._runtime.scene != null || this._runtime.selection != null;
            case 'scene.createNode':
                return this._runtime.message != null;
            case 'scene.queryCurrentEditorResource':
            case 'scene.restoreEditorResource':
            case 'scene.open':
            case 'scene.save':
            case 'scene.reload':
            case 'prefab.createFromNode':
            case 'prefab.apply':
            case 'prefab.revert':
            case 'prefab.unpack':
            case 'prefab.unlink':
                return this._runtime.message != null;
            case 'prefab.getInfo':
                return this._runtime.assetRead != null || this._runtime.message != null;
            case 'preview.query':
            case 'preview.refresh':
            case 'preview.queryErrors':
            case 'builder.queryPlatforms':
            case 'builder.querySchema':
            case 'builder.queryDefaultConfig':
            case 'builder.build':
                return this._runtime.message != null || this._runtime.projectRead != null;
            case 'reference.queryImage':
            case 'reference.setImage':
                return true;
            default:
                if (operation === 'lumen.compileRecipe') {
                    return true;
                }
                if (EditorMcpLumenGateway.isLumenOperation(operation)) {
                    return this._runtime.projectRead != null;
                }
                return false;
        }
    }

    /**
     * @description 对首次创建 operation 强制消费唯一 AssetDB 身份证据。
     * @param operation operation。
     * @param input 已校验输入。
     * @param data worker 数据。
     * @returns 已验证创建证据；非首次创建返回 null。
     */
    private _readRequiredCreationEvidence(
        operation: EditorMcpOperationId,
        input: Readonly<Record<string, unknown>>,
        data: unknown,
    ): IEditorMcpAssetDbCreationEvidence | null {
        const scaffoldPath = typeof input.prefabRelativePath === 'string'
            ? input.prefabRelativePath
            : typeof input.assetRelativePath === 'string'
                ? input.assetRelativePath
                : '';
        const creator2x = typeof input.cocosVersion === 'string' && Lumen24McpBridge.isCreator2x(input.cocosVersion);
        const required = operation === 'prefab.createFromNode' || (
            operation === 'lumen.scaffold' &&
            input.reset !== true &&
            !creator2x &&
            this._runtime.message != null &&
            this._lumenCreationCoordinationEnabled &&
            /\.(?:prefab|scene)$/iu.test(scaffoldPath)
        );
        if (!required) {
            return null;
        }
        const outer = this._isRecord(data) ? data : null;
        const nested = outer != null && this._isRecord(outer.data) ? outer.data : null;
        const value = outer?.creation ?? nested?.creation;
        if (!this._isRecord(value)) {
            throw new Error(`editor_mcp_asset_create_evidence_missing:${operation}`);
        }
        const cleanup = this._isRecord(value.cleanup) ? value.cleanup : null;
        if (
            value.phase !== 'verified' ||
            (value.resourceType !== 'prefab' && value.resourceType !== 'scene') ||
            typeof value.targetDbPath !== 'string' || !value.targetDbPath.startsWith('db://assets/') ||
            typeof value.uuid !== 'string' || value.uuid.trim().length === 0 ||
            value.metaPresent !== true ||
            value.parentRegistered !== true ||
            !Array.isArray(value.subAssetUuids) ||
            typeof value.polls !== 'number' ||
            typeof value.waitedMs !== 'number' ||
            cleanup?.complete !== true ||
            value.projectState !== 'changed'
        ) {
            throw new Error(`editor_mcp_asset_create_evidence_invalid:${operation}`);
        }
        return value as unknown as IEditorMcpAssetDbCreationEvidence;
    }

    /**
     * @description 返回当前项目绝对路径。
     */
    private async _requireProjectPath(): Promise<string> {
        const projectDirectory = await this._requireProjectRead().getProjectPath();
        if (typeof projectDirectory !== 'string' || projectDirectory.trim().length === 0) {
            throw new Error('editor_mcp_project_path_unavailable');
        }
        return projectDirectory;
    }

    /**
     * @description 优先使用 grant 注入的 assetCatalog，否则回退构造期注入实现。
     * @returns 资产目录快查接口。
     */
    private _requireCatalogLookup(): IAssetCatalogFastLookup {
        return this._runtime.assetCatalog ?? this._catalogLookup;
    }

    /**
     * @description 返回 asset read grant，缺失时抛出稳定错误。
     */
    private _requireAssetRead() {
        if (this._runtime.assetRead == null) throw new Error('editor_mcp_asset_read_not_granted');
        return this._runtime.assetRead;
    }

    /**
     * @description 返回 scene grant，缺失时抛出稳定错误。
     */
    private _requireScene() {
        if (this._runtime.scene == null) throw new Error('editor_mcp_scene_read_not_granted');
        return this._runtime.scene;
    }

    /**
     * @description 返回 selection grant，缺失时抛出稳定错误。
     */
    private _requireSelection() {
        if (this._runtime.selection == null) throw new Error('editor_mcp_selection_read_not_granted');
        return this._runtime.selection;
    }

    /**
     * @description 返回 project grant，缺失时抛出稳定错误。
     */
    private _requireProjectRead() {
        if (this._runtime.projectRead == null) throw new Error('editor_mcp_project_read_not_granted');
        return this._runtime.projectRead;
    }

    /**
     * @description 判断未知值是否为普通对象载荷。
     */
    private _isRecord(value: unknown): value is ContractPayload {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}

/**
 * @description 读取 string 记录。
 * @param value 未校验值
 * @returns 字符串记录
 */
function readStringRecord(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        return {};
    }
    const record: Record<string, string> = Object.create(null);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'string') {
            record[key] = entry;
        }
    }
    return record;
}
