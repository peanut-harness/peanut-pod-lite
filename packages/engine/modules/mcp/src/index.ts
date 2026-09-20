export { EditorMcpActionRouter } from './editor-mcp-action-router.js';
export {
    EditorMcpAssetDbTransaction,
    type IEditorMcpAssetDbRegistrationEvidence,
    type IEditorMcpAssetDbTransactionEvidence,
    type IEditorMcpAssetDbTransactionHost,
    type IEditorMcpAssetDbTransactionMessagePort,
    type IEditorMcpAssetDbTransactionOptions,
} from './editor-mcp-asset-db-transaction.js';
export { ResourceOperationTaskExecutor } from './resource-operation-task-executor.js';
export type { IResourceOperationTaskExecutorOptions } from './resource-operation-task-executor.js';
export { EditorMcpExecutionCodec } from './editor-mcp-execution-codec.js';
export type { IEditorMcpDecodedExecutionInput } from './editor-mcp-execution-codec.js';
export { ResourceOperationPlanner } from './resource-operation-planner.js';
export { ResourceOperationClosureResolver } from './resource-operation-closure-resolver.js';
export {
    type IResourceOperationTaskPlan,
    type IResourceOperationClosureSummary,
} from './resource-operation-contracts.js';
export { EditorMcpLumenGateway } from './editor-mcp-lumen-gateway.js';
export { EditorMcpPluginModule } from './editor-mcp-plugin-module.js';
export {
    createEditorMcpActionRouter,
    createEditorMcpExecuteOperation,
    type EditorMcpExecuteOperation,
} from './editor-mcp-gateway-factory.js';

import { EditorMcpPluginModule } from './editor-mcp-plugin-module.js';

/**
 * @description 创建供 Peanut 宿主动态加载的 Editor MCP 插件模块。
 * @returns 新建的 Editor MCP 插件模块
 */
export function createPluginModule(): EditorMcpPluginModule {
    return new EditorMcpPluginModule();
}

export type {
    IAssetReadClient,
    ICreatorVersionClient,
    IGrantedRuntimeClientSet,
    IPluginActivateContext,
    IPluginRegisterContext,
    IPluginServiceApi,
    IProjectReadClient,
    ISceneClient,
    ISelectionClient,
    PluginDeactivateReason,
} from '@peanut/pod-sdk';

export { EditorMcpBuilderPostBuildHookRegistry } from './editor-mcp-builder-post-build-hooks.js';
export { executeLodRecalcBounds, LOD_RECALC_PROBE_EVIDENCE } from './editor-mcp-lod-recalc.js';
export { extractArtifactHints } from './editor-mcp-builder-gateway.js';
export { REFERENCE_IMAGE_PROBE_EVIDENCE } from './editor-mcp-reference-gateway.js';

export {
    EDITOR_MCP_SCENE_HOST_ROUTES,
    SCENE_SAVE_REFUSED_REASON,
    CREATOR_SCENE_SAVE_MESSAGES,
    resolveSceneHostRoute,
    buildSceneSaveRefusePayload,
} from './editor-mcp-scene-host-routes.js';
