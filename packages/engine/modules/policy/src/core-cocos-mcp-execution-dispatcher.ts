import { CoreCocosMcpToolDefinitionCatalog, type ICoreCocosMcpToolDefinition } from './core-cocos-mcp-tool-definition-catalog.js';
import type { CoreCocosMcpPublicOperation } from './core-cocos-mcp-tool-name-resolver.js';
import { CoreMcpInputValidator } from './core-mcp-input-validator.js';
import type { McpApprovalLeaseStore } from './mcp-approval-lease-store.js';
import { McpControlFlowRefusal } from './mcp-control-flow-refusal.js';
import { WriteResourceAuthorization } from './write-resource-authorization.js';

/**
 * @description 由宿主计算的调用身份与资源范围，不能从 MCP 输入字段直接填入。
 */
export interface ICoreCocosMcpExecutionContext {
    /**
     * @description 经宿主认证的本地连接标识。
     */
    readonly connectionId: string;
    /**
     * @description 由实际操作参数解析出的规范化资源范围。
     */
    readonly resources: readonly string[];
}

/**
 * @description 不依赖 Creator SDK 的公开 Core 执行请求。
 */
export interface ICoreCocosMcpExecutionRequest {
    readonly operation: CoreCocosMcpPublicOperation;
    readonly input: Readonly<Record<string, unknown>>;
    readonly invocation?: {
        readonly connectionId: string;
        readonly callerPluginId?: string;
        readonly signal?: AbortSignal;
        readonly reportProgress?: (progress: { readonly progress: number; readonly total?: number; readonly message?: string }) => void;
        readonly risk?: 'read' | 'write' | 'destructive';
        readonly resourceIds?: readonly string[];
        readonly hasLocalApproval?: boolean;
    };
}

/**
 * @description 由 Cocos Creator 宿主实现的实际操作适配器。
 */
export interface ICoreCocosMcpExecutionAdapter {
    /**
     * @description 此适配器实际实现的公开 operation。
     */
    readonly operations: readonly CoreCocosMcpPublicOperation[];
    /**
     * @description 在宿主上下文中执行已验证的公开 operation。
     */
    execute(request: ICoreCocosMcpExecutionRequest): Promise<unknown>;
}

/**
 * @description Core 的 fail-closed 执行分发器。
 * 不直接依赖 Creator 全局对象；宿主通过适配器接入 Message、AssetDB、Scene 或 Lumen 运行时。
 */
export class CoreCocosMcpExecutionDispatcher {
    /**
     * @description 当前发布包的公开工具定义。
     */
    private readonly definitions = new CoreCocosMcpToolDefinitionCatalog();
    /**
     * @description 已验证且按操作唯一注册的实际执行器。
     */
    private readonly adapters = new Map<CoreCocosMcpPublicOperation, ICoreCocosMcpExecutionAdapter>();
    /**
     * @description 执行前的目录输入校验器。
     */
    private readonly validator = new CoreMcpInputValidator();

    /**
     * @description 组装可执行适配器；未提供租约存储时拒绝全部写入。
     * @param adapters 当前宿主实际实现的适配器。
     * @param approvalLeases 由宿主持有的本地审批存储。
     */
    public constructor(
        adapters: readonly ICoreCocosMcpExecutionAdapter[],
        private readonly approvalLeases: McpApprovalLeaseStore | null = null,
    ) {
        for (const adapter of adapters) {
            for (const operation of adapter.operations) {
                if (this.definitions.findByOperation(operation) == null) {
                    throw new Error(`core_cocos_mcp_execution_adapter_operation_not_public:${operation}`);
                }
                if (this.adapters.has(operation)) {
                    throw new Error(`core_cocos_mcp_execution_adapter_duplicate:${operation}`);
                }
                this.adapters.set(operation, adapter);
            }
        }
    }

    /**
     * @description 执行公开操作，在副作用前验证输入及本地审批范围。
     * @param operation 未受信操作标识。
     * @param input 未受信业务参数。
     * @param context 宿主解析的连接和资源范围。
     * @returns 实际适配器的执行结果。
     */
    public async execute(
        operation: unknown,
        input: unknown,
        context: ICoreCocosMcpExecutionContext | null = null,
        invocation?: ICoreCocosMcpExecutionRequest['invocation'],
    ): Promise<unknown> {
        const definition = this.definitions.findByOperation(operation);
        if (definition == null) {
            throw new Error('core_cocos_mcp_execution_operation_not_public');
        }
        if (!CoreCocosMcpExecutionDispatcher.isRecord(input)) {
            throw new Error('core_cocos_mcp_execution_input_invalid');
        }
        if (!this.validator.validate(definition.inputSchema, input)) {
            throw new Error('core_cocos_mcp_execution_schema_invalid');
        }
        const adapter = this.adapters.get(definition.operation);
        if (adapter == null) {
            throw new Error(`core_cocos_mcp_execution_adapter_missing:${definition.operation}`);
        }
        WriteResourceAuthorization.assertSafePaths(definition.operation, input);
        this.requireApproval(definition, input, context, CoreCocosMcpExecutionDispatcher.resolveRisk(definition, input));
        return adapter.execute({ operation: definition.operation, input, ...(invocation == null ? {} : { invocation }) });
    }

    /**
     * @description 在调用写入适配器之前消费宿主签发的审批租约。
     * @param definition 可信目录定义。
     * @param input 已通过 schema 检查的参数。
     * @param context 宿主提供的连接及资源范围。
     * @param risk 当前输入对应的实际风险。
     * @returns 审批通过时返回，否则抛出拒绝错误。
     */
    private requireApproval(
        definition: ICoreCocosMcpToolDefinition,
        input: Readonly<Record<string, unknown>>,
        context: ICoreCocosMcpExecutionContext | null,
        risk: ICoreCocosMcpToolDefinition['risk'],
    ): void {
        if (!definition.requiresLocalApproval) {
            return;
        }
        if (risk === 'destructive' && input.confirmDestructive !== true) {
            McpControlFlowRefusal.reject(`core_cocos_mcp_execution_destructive_confirmation_required:${definition.operation}`);
        }
        const leaseId = CoreCocosMcpExecutionDispatcher.resolveLeaseId(input);
        if (
            context == null ||
            context.resources.length === 0 ||
            context.resources.some((resource) => typeof resource !== 'string' || resource.trim().length === 0) ||
            this.approvalLeases == null ||
            leaseId == null ||
            !this.approvalLeases.consume(leaseId, {
                connectionId: context.connectionId,
                resources: context.resources,
                operation: definition.operation,
                risk,
            })
        ) {
            McpControlFlowRefusal.reject(`core_cocos_mcp_execution_approval_required:${definition.operation}`);
        }
    }

    /**
     * @description 解析依赖输入的实际风险；覆盖导入与 legacy router 一致的 overwrite 语义。
     * @param definition 可信目录定义
     * @param input 已通过 schema 校验的参数
     */
    private static resolveRisk(
        definition: ICoreCocosMcpToolDefinition,
        input: Readonly<Record<string, unknown>>,
    ): ICoreCocosMcpToolDefinition['risk'] {
        if (
            definition.operation === 'asset.import'
            && (input.overwrite === true || input.mode === 'override')
        ) {
            return 'destructive';
        }
        return definition.risk;
    }

    /**
     * @description 从写工具输入解析本地租约 ID；双传时优先 approvalId，其次 approvalToken（二者等价）。
     * @param input 已通过 schema 检查的参数。
     * @returns 非空 trim 后的租约串，或 null。
     */
    private static resolveLeaseId(input: Readonly<Record<string, unknown>>): string | null {
        const pick = (value: unknown): string | null => {
            if (typeof value !== 'string') {
                return null;
            }
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        };
        return pick(input.approvalId) ?? pick(input.approvalToken);
    }

    /**
     * @description 将未受信输入缩窄为记录对象。
     * @param value 未受信输入。
     * @returns 是否为非空且非数组的对象。
     */
    private static isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}
