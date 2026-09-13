export { McpCapabilityPolicy, type IMcpCapabilityPolicy, type McpCapabilityAccess } from './mcp-capability-policy.js';
export {
    CreatorOperationAvailabilityMatrix,
    type CreatorOperationAvailability,
    type ICreatorOperationAvailabilityEntry,
} from './creator-operation-availability-matrix.js';
export {
    CoreCocosMcpCapabilityCatalog,
    type CoreCocosMcpOperation,
    type ICoreCocosMcpCapability,
} from './core-cocos-mcp-capability-catalog.js';
export { CoreCocosMcpOperationResolver } from './core-cocos-mcp-operation-resolver.js';
export {
    CoreCocosNativeWriteCapabilityCatalog,
    type CoreCocosNativeWriteOperation,
    type CoreCocosNativeWriteRisk,
    type ICoreCocosNativeWriteCapability,
} from './core-cocos-native-write-capability-catalog.js';
export { CoreCocosMcpToolNameResolver, type CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';
export { CoreCocosMcpReadToolSchemaCatalog, type ICoreMcpJsonSchema } from './core-cocos-mcp-read-tool-schema-catalog.js';
export { CoreCocosNativeWriteToolSchemaCatalog } from './core-cocos-native-write-tool-schema-catalog.js';
export { CoreCocosMcpToolDefinitionCatalog, type ICoreCocosMcpToolDefinition } from './core-cocos-mcp-tool-definition-catalog.js';
export {
    CoreCocosMcpExecutionDispatcher,
    type ICoreCocosMcpExecutionAdapter,
    type ICoreCocosMcpExecutionRequest,
    type ICoreCocosMcpExecutionContext,
} from './core-cocos-mcp-execution-dispatcher.js';
export {
    CoreCocosCreatorReadAdapter,
    type ICoreCocosCreatorReadRuntime,
    type ICoreCocosCreatorVersionPort,
    type ICoreCocosCreatorProjectPort,
    type ICoreCocosCreatorSelectionPort,
    type ICoreCocosCreatorMessageReadPort,
} from './core-cocos-creator-read-adapter.js';
export {
    EditorMcpGatewayAdapter,
    isProExclusiveCocosOperation,
    listLitePublicOperations,
    type EditorMcpGatewayExecute,
} from './editor-mcp-gateway-adapter.js';
export {
    McpApprovalLeaseStore,
    type IMcpApprovalLeaseRequest,
    type IMcpApprovalLeaseUse,
    type McpExecutionRisk,
} from './mcp-approval-lease-store.js';

export { McpControlFlowRefusal, isMcpControlFlowRefusal } from './mcp-control-flow-refusal.js';

export {
    normalizeResourceKey,
    normalizeResourceKeySet,
    normalizeResourceKeys,
    type INormalizeResourceKeyOptions,
} from './normalize-resource-key.js';
export {
    extractWriteResources,
    readDeclaredResources,
    resolveAuthorizedResources,
} from './write-resource-authorization.js';
