import { CoreCocosMcpCapabilityCatalog, type CoreCocosMcpOperation } from './core-cocos-mcp-capability-catalog.js';
import { CoreCocosNativeWriteCapabilityCatalog, type CoreCocosNativeWriteOperation } from './core-cocos-native-write-capability-catalog.js';
import { CoreCocosNativeWriteToolSchemaCatalog } from './core-cocos-native-write-tool-schema-catalog.js';
import { CoreCocosMcpReadToolSchemaCatalog, type ICoreMcpJsonSchema } from './core-cocos-mcp-read-tool-schema-catalog.js';
import { CoreCocosMcpToolNameResolver, type CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';
import type { McpExecutionRisk } from './mcp-approval-lease-store.js';

/**
 * @description Core 工具目录公开的 JSON schema；保持 policy 包无运行时依赖。
 */
interface ICoreCocosMcpAiHandlingGuidance {
    readonly schemaVersion: 1;
    readonly successSignals: readonly string[];
    readonly failureField: 'failure';
    readonly unknownStateAction: 'query_before_retry';
    readonly blindRetryAllowed: false;
}

/**
 * @description 可直接注册到 MCP Hub 的 Core 工具定义。
 */
export interface ICoreCocosMcpToolDefinition {
    /** @description 保持旧客户端兼容的一级工具名。 */
    readonly name: string;
    /** @description 稳定 Cocos MCP operation 标识。 */
    readonly operation: CoreCocosMcpPublicOperation;
    /** @description 简明工具说明；详细输入说明位于 inputSchema。 */
    readonly description: string;
    /** @description MCP 参数 schema。 */
    readonly inputSchema: ICoreMcpJsonSchema;
    /**
     * @description 写操作成功返回值的最小 schema。
     */
    readonly outputSchema?: ICoreMcpJsonSchema;
    readonly readOnly: boolean;
    readonly risk: McpExecutionRisk;
    /** @description 工具执行模型；写工具由宿主管理任务执行。 */
    readonly executionModel: 'inline' | 'managed_task';
    /** @description 写操作执行前必须消费本地审批租约。 */
    readonly requiresLocalApproval: boolean;
    /**
     * @description AI 判定成功、处理失败与重试的机器可读规则。
     */
    readonly aiHandling: ICoreCocosMcpAiHandlingGuidance;
}

/**
 * @description 将 Core capability、工具命名和 schema 汇合为可直接注册的 fail-closed MCP 工具目录。
 */
export class CoreCocosMcpToolDefinitionCatalog {
    /** @description Core operation 到公开工具定义的不可变映射。 */
    private readonly definitions: ReadonlyMap<CoreCocosMcpPublicOperation, ICoreCocosMcpToolDefinition>;
    /** @description 兼容工具名解析器。 */
    private readonly toolNameResolver: CoreCocosMcpToolNameResolver;

    /**
     * @description 建立完整的 Core 工具定义目录；缺少任何公开 schema 都视为发布时错误。
     */
    public constructor() {
        this.toolNameResolver = new CoreCocosMcpToolNameResolver();
        const readSchemas = new CoreCocosMcpReadToolSchemaCatalog();
        const writeSchemas = new CoreCocosNativeWriteToolSchemaCatalog();
        const definitions = new Map<CoreCocosMcpPublicOperation, ICoreCocosMcpToolDefinition>();
        for (const capability of CoreCocosMcpCapabilityCatalog.list()) {
            const name = this.toolNameResolver.toolName(capability.operation);
            const inputSchema = readSchemas.find(capability.operation);
            if (name == null || inputSchema == null) {
                throw new Error(`core_cocos_mcp_tool_definition_incomplete:${capability.operation}`);
            }
            definitions.set(
                capability.operation,
                Object.freeze({
                    name,
                    operation: capability.operation,
                    description: `Read-only Cocos MCP capability: ${capability.operation}. Treat the call as successful only when response.ok=true. On response.ok=false, inspect failure.code, failure.category, and failure.recommendedAction.`,
                    inputSchema,
                    readOnly: true,
                    risk: 'read',
                    executionModel: 'inline',
                    requiresLocalApproval: false,
                    aiHandling: this.createAiHandling(true),
                }),
            );
        }
        for (const capability of CoreCocosNativeWriteCapabilityCatalog.list()) {
            const name = this.toolNameResolver.toolName(capability.operation);
            const inputSchema = writeSchemas.find(capability.operation);
            if (name == null || inputSchema == null) {
                throw new Error(`core_cocos_mcp_tool_definition_incomplete:${capability.operation}`);
            }
            definitions.set(capability.operation, Object.freeze({
                name,
                operation: capability.operation,
                description: `Locally-approved Cocos MCP capability: ${capability.operation}. Accept success only when response.ok=true, result.taskStatus=succeeded, and result.postflight.verified=true. On failure inspect failure; when failure.state is unknown or may_have_changed, query the target state before retrying. Never retry a write blindly.`,
                inputSchema,
                outputSchema: this.createWriteOutputSchema(),
                readOnly: false,
                risk: capability.risk,
                executionModel: 'managed_task',
                requiresLocalApproval: true,
                aiHandling: this.createAiHandling(false),
            }));
        }
        this.definitions = definitions;
    }

    /**
     * @description 返回可直接注册到 MCP Hub 的完整 Core 工具定义快照。
     * @returns 不可变工具定义列表。
     */
    public list(): readonly ICoreCocosMcpToolDefinition[] {
        return Object.freeze([...this.definitions.values()]);
    }

    /**
     * @description 按兼容 MCP 工具名查询 Core 定义。
     * @param toolName 未信任工具名。
     * @returns 命中的 Core 定义；未知或 Pro 工具名返回 null。
     */
    public findByToolName(toolName: unknown): ICoreCocosMcpToolDefinition | null {
        const operation = this.toolNameResolver.operationForToolName(toolName);
        return operation == null ? null : (this.definitions.get(operation) ?? null);
    }

    /**
     * @description 按 operation 查询 Core 定义。
     * @param operation 未信任 operation 标识。
     * @returns 命中的 Core 定义；未知或 Pro operation 返回 null。
     */
    public findByOperation(operation: unknown): ICoreCocosMcpToolDefinition | null {
        const capability = CoreCocosMcpCapabilityCatalog.find(operation) ?? CoreCocosNativeWriteCapabilityCatalog.find(operation);
        return capability == null ? null : (this.definitions.get(capability.operation) ?? null);
    }

    /**
     * @description 构造 AI 调用处理的稳定规则。
     * @param readOnly 是否为只读工具。
     * @returns 不可变调用规则。
     */
    private createAiHandling(readOnly: boolean): ICoreCocosMcpAiHandlingGuidance {
        return Object.freeze({
            schemaVersion: 1,
            successSignals: Object.freeze(
                readOnly
                    ? ['response.ok=true']
                    : ['response.ok=true', 'result.taskStatus=succeeded', 'result.postflight.verified=true'],
            ),
            failureField: 'failure',
            unknownStateAction: 'query_before_retry',
            blindRetryAllowed: false,
        });
    }

    /**
     * @description 构造写操作共享的最小成功输出 schema。
     * @returns 要求任务状态与日志验收信号的输出 schema。
     */
    private createWriteOutputSchema(): ICoreMcpJsonSchema {
        return Object.freeze({
            type: 'object',
            properties: Object.freeze({
                taskId: Object.freeze({ type: 'string', description: 'Stable resource-operation task id.' }),
                taskStatus: Object.freeze({
                    type: 'string',
                    enum: Object.freeze(['queued', 'succeeded']),
                    description: 'Async admission returns queued; synchronous writes return succeeded.',
                }),
                postflight: Object.freeze({
                    type: 'object',
                    properties: Object.freeze({
                        verified: Object.freeze({ type: 'boolean', description: 'Whether project.log verification passed.' }),
                    }),
                    required: Object.freeze(['verified']),
                    additionalProperties: true,
                    description: 'Incremental project.log verification; verified must be true.',
                }),
            }),
            required: Object.freeze(['taskId', 'taskStatus']),
            additionalProperties: true,
        });
    }
}
