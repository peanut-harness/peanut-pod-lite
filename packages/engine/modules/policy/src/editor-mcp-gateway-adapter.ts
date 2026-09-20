import { CoreCocosMcpCapabilityCatalog } from './core-cocos-mcp-capability-catalog.js';
import type { ICoreCocosMcpExecutionAdapter, ICoreCocosMcpExecutionRequest } from './core-cocos-mcp-execution-dispatcher.js';
import { CoreCocosNativeWriteCapabilityCatalog } from './core-cocos-native-write-capability-catalog.js';
import type { CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';

/**
 * @description Editor MCP 路由器端口；宿主注入真实 router 或测试 mock。
 */
export type EditorMcpGatewayExecute = (
    operation: CoreCocosMcpPublicOperation,
    input: Readonly<Record<string, unknown>>,
    invocation?: ICoreCocosMcpExecutionRequest['invocation'],
) => Promise<unknown>;

/**
 * @description 判断 operation 是否属于 Pro 独占（截图 / SnowB），Lite 永远不得注册。
 * @param operation 未信任 operation 标识。
 * @returns 属于 Pro 独占时返回 true。
 */
export function isProExclusiveCocosOperation(operation: unknown): boolean {
    if (typeof operation !== 'string' || operation.length === 0) {
        return true;
    }
    return operation === 'preview.capture' || operation.includes('snowb');
}

/**
 * @description 返回 Lite 公开的 83 个 operation（排除 preview.capture 与 snowb）。
 * @returns 冻结的公开 operation 列表。
 */
export function listLitePublicOperations(): readonly CoreCocosMcpPublicOperation[] {
    return Object.freeze([
        ...CoreCocosMcpCapabilityCatalog.list().map((capability) => capability.operation),
        ...CoreCocosNativeWriteCapabilityCatalog.list().map((capability) => capability.operation),
    ].filter((operation) => !isProExclusiveCocosOperation(operation)));
}

/**
 * @description 把 Editor MCP 路由器接到 Core dispatcher 的适配器；覆盖全部 83 个 Lite 公开 operation。
 */
export class EditorMcpGatewayAdapter implements ICoreCocosMcpExecutionAdapter {
    /** @description 此适配器覆盖的 Lite 公开 operation。 */
    public readonly operations: readonly CoreCocosMcpPublicOperation[];
    /** @description 注入的路由器执行端口。 */
    private readonly executeOperation: EditorMcpGatewayExecute;

    /**
     * @description 创建网关适配器。
     * @param executeOperation `(operation, input) => Promise<unknown>` 路由器端口。
     */
    public constructor(executeOperation: EditorMcpGatewayExecute) {
        this.executeOperation = executeOperation;
        this.operations = listLitePublicOperations();
    }

    /**
     * @description 把已由 dispatcher 校验过的请求转发给 Editor MCP 路由器。
     * @param request 已校验执行请求。
     * @returns 路由器返回值。
     */
    public async execute(request: ICoreCocosMcpExecutionRequest): Promise<unknown> {
        if (isProExclusiveCocosOperation(request.operation)) {
            throw new Error(`core_cocos_mcp_execution_operation_not_public:${request.operation}`);
        }
        return this.executeOperation(request.operation, request.input, request.invocation);
    }
}
