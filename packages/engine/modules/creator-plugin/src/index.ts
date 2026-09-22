import { createEditorMcpExecuteOperation } from '@peanut/pod-engine/mcp';
import type { IGrantedRuntimeClientSet, IPluginServiceApi, IPluginTaskApi } from '@peanut/pod-sdk';

import {
    CoreCocosCreatorReadAdapter,
    CoreCocosMcpToolDefinitionCatalog,
    CoreCocosMcpExecutionDispatcher,
    EditorMcpGatewayAdapter,
    isProExclusiveCocosOperation,
    McpApprovalLeaseStore,
    resolveAuthorizedResources,
    type ICoreCocosMcpToolDefinition,
    type ICoreCocosCreatorReadRuntime,
    type ICoreCocosMcpExecutionContext,
    type EditorMcpGatewayExecute,
} from '@peanut/pod-engine/policy';
import { PEANUT_POD_LITE_VERSION } from './release-version.js';

/**
 * @description MCP 调用时由宿主注入的连接与资源范围。
 */
export interface ICoreCocosMcpInvocation {
    /**
     * @description 经宿主认证的本地连接标识。
     */
    readonly connectionId?: string;
    /**
     * @description 由实际操作参数解析出的规范化资源范围。
     */
    readonly resourceIds?: readonly string[];
}

/**
 * @description Core Creator 宿主提供的最小 MCP 注册端口。
 */
export interface ICoreCocosMcpRegistry {
    /**
     * @description 注册一个 Core MCP 工具并返回注销函数。
     * @param definition 工具定义。
     * @param handler 工具处理器。
     * @returns 注销函数。
     */
    register(
        definition: ICoreCocosMcpToolDefinition,
        handler: (input: Readonly<Record<string, unknown>>, invocation?: ICoreCocosMcpInvocation) => Promise<unknown>,
    ): () => void;
}

/**
 * @description 可执行 Editor MCP 路由器或函数端口。
 */
export type CoreCocosMcpGatewayPort = EditorMcpGatewayExecute | { execute: EditorMcpGatewayExecute };

/**
 * @description Core Creator 宿主激活上下文。
 */
export interface ICoreCocosCreatorHostActivateContext {
    /**
     * @description 已受宿主校验的运行时读取端口；无网关时必填。
     */
    readonly runtime?: ICoreCocosCreatorReadRuntime;
    /**
     * @description Creator 宿主裁剪后的完整 grant 集合；存在时自动接入 EditorMcp gateway（83 项）。
     */
    readonly grantedRuntime?: IGrantedRuntimeClientSet;
    /**
     * @description 插件服务端口；与 grantedRuntime 一起用于构造 gateway（可调 Pro 服务）。
     */
    readonly services?: IPluginServiceApi;
    /**
     * @description 可选 MCP 注册中心。
     */
    readonly mcp?: ICoreCocosMcpRegistry;
    /**
     * @description 非敏感生命周期日志端口。
     */
    readonly logger: { info(message: string): void };
    /**
     * @description 由宿主持有的本地审批租约；网关注册写入时使用。缺省时模块内建一份。
     */
    readonly approvalLeases?: McpApprovalLeaseStore;
    /**
     * @description 直接注入的 83 项网关执行函数。
     */
    readonly executeOperation?: EditorMcpGatewayExecute;
    /**
     * @description 可选网关端口；存在时注册全部 83 项 Lite 公开操作。
     */
    readonly gateway?: CoreCocosMcpGatewayPort;
    /**
     * @description 与 gateway 同义的路由器端口别名。
     */
    readonly router?: CoreCocosMcpGatewayPort;
    /**
     * @description 写入调用缺省连接标识。
     */
    readonly connectionId?: string;
    /**
     * @description Kernel 为 Creator 宿主直接加载路径提供的统一任务 API。
     */
    readonly tasks?: IPluginTaskApi;
}

/**
 * @description Core 目录包供 Creator 加载的最小生命周期模块。
 */
export class CoreCocosCreatorHostPluginModule {
    /**
     * @description 目录包运行时清单。
     */
    public readonly manifest = Object.freeze({
        id: 'peanut.pod-lite',
        version: PEANUT_POD_LITE_VERSION,
        kind: 'tooling-plugin',
        displayName: 'Peanut Pod Lite',
        main: './peanut.pod-lite.bundle.js',
        engines: { host: `^${PEANUT_POD_LITE_VERSION}` },
        // Host loads this package via CPM (activateCore). Plugin Manager must not
        // auto-activate it as a legacy MCP capability plugin.
        activation: { autoActivate: false, events: ['onStartup'] },
        permissions: {},
    });
    /**
     * @description 已注册工具的注销函数。
     */
    private readonly disposers: Array<() => void> = [];
    /**
     * @description 当前激活使用的审批租约存储。
     */
    private approvalLeases: McpApprovalLeaseStore | null = null;
    /**
     * @description 当前网关注册的 executor 清理函数。
     */
    private disposeGateway: (() => void) | null = null;

    /**
     * @description 满足 Creator 插件宿主注册阶段协议；工具仅在激活时注册。
     * @param context 宿主提供的非敏感日志端口。
     * @returns 注册阶段完成后结束。
     */
    public async register(context: Pick<ICoreCocosCreatorHostActivateContext, 'logger'>): Promise<void> {
        context.logger.info('pod_lite_registered');
    }

    /**
     * @description 激活 Core 宿主并注册已经迁入的工具。
     * @param context Creator 宿主上下文。
     * @returns 激活完成后结束。
     */
    public async activate(context: ICoreCocosCreatorHostActivateContext): Promise<void> {
        this.dispose();
        this.approvalLeases = context.approvalLeases ?? new McpApprovalLeaseStore();
        const executeOperation = resolveGatewayExecute(context);
        const disposableGateway = executeOperation as (EditorMcpGatewayExecute & { dispose?: () => void }) | null;
        this.disposeGateway = typeof disposableGateway?.dispose === 'function'
            ? () => disposableGateway.dispose?.()
            : null;
        const adapter =
            executeOperation != null
                ? new EditorMcpGatewayAdapter(executeOperation)
                : new CoreCocosCreatorReadAdapter(requireReadRuntime(context.runtime));
        const dispatcher = new CoreCocosMcpExecutionDispatcher([adapter], this.approvalLeases);
        const definitionCatalog = new CoreCocosMcpToolDefinitionCatalog();
        const gatewayEnabled = executeOperation != null;
        if (context.mcp != null) {
            for (const definition of definitionCatalog.list().filter((item) => isRegisterable(item, adapter.operations, gatewayEnabled))) {
                this.disposers.push(
                    context.mcp.register(definition, async (input, invocation): Promise<unknown> => {
                        const executionContext = definition.requiresLocalApproval
                            ? resolveWriteExecutionContext(definition.operation, input, context, invocation)
                            : null;
                        const trustedInvocation = toTrustedInvocation(invocation);
                        return dispatcher.execute(definition.operation, input, executionContext, trustedInvocation);
                    }),
                );
            }
        }
        const mode = gatewayEnabled ? 'gateway_operations' : 'read_operations';
        context.logger.info(`pod_lite_creator_host_ready:${adapter.operations.length}_${mode}`);
    }

    /**
     * @description 签发本地审批租约；供 Creator host 的写入入口使用。
     */
    public issueApprovalLease(request: Parameters<McpApprovalLeaseStore['issue']>[0]): ReturnType<McpApprovalLeaseStore['issue']> {
        if (this.approvalLeases == null) {
            throw new Error('pod_lite_approval_leases_unavailable');
        }
        return this.approvalLeases.issue(request);
    }

    /**
     * @description 停用 Core 宿主并注销所有工具。
     * @returns 停用完成后结束。
     */
    public async deactivate(): Promise<void> {
        this.dispose();
    }

    /**
     * @description 释放已注册的 MCP 工具。
     * @returns 无返回值。
     */
    public dispose(): void {
        for (const dispose of this.disposers.splice(0)) {
            dispose();
        }
        this.disposeGateway?.();
        this.disposeGateway = null;
        this.approvalLeases = null;
    }
}

/**
 * @description 创建供 Peanut Creator 宿主动态加载的 Core 模块。
 * @returns Core 宿主模块实例。
 */
export function createPluginModule(): CoreCocosCreatorHostPluginModule {
    return new CoreCocosCreatorHostPluginModule();
}

/**
 * @description 从激活上下文解析网关执行函数。
 * @param context 激活上下文。
 * @returns 网关执行函数；未提供时返回 null。
 */
function resolveGatewayExecute(context: ICoreCocosCreatorHostActivateContext): EditorMcpGatewayExecute | null {
    const candidate = context.executeOperation ?? context.gateway ?? context.router;
    if (candidate != null) {
        if (typeof candidate === 'function') {
            return candidate;
        }
        if (typeof candidate.execute === 'function') {
            return (operation, input, invocation) => candidate.execute(operation, input, invocation);
        }
    }
    // Use the full EditorMcp router when the host supplies grants and services.
    // Paid operations remain refused by Lite policy.
    if (context.grantedRuntime != null && context.services != null) {
        return createEditorMcpExecuteOperation(context.grantedRuntime, context.tasks?.managed ?? null);
    }
    return null;
}

/**
 * @description 保留由宿主签发的 invocation 对象身份，仅过滤缺少连接标识的旧调用。
 */
function toTrustedInvocation(
    invocation: ICoreCocosMcpInvocation | undefined,
): Parameters<EditorMcpGatewayExecute>[2] {
    return typeof invocation?.connectionId === 'string' && invocation.connectionId.trim().length > 0
        ? invocation as NonNullable<Parameters<EditorMcpGatewayExecute>[2]>
        : undefined;
}

/**
 * @description 无网关时要求读取 runtime 已注入。
 * @param runtime 可选读取 runtime。
 * @returns 已确认的读取 runtime。
 */
function requireReadRuntime(runtime: ICoreCocosCreatorReadRuntime | undefined): ICoreCocosCreatorReadRuntime {
    if (runtime == null) {
        throw new Error('pod_lite_creator_host_runtime_required');
    }
    return runtime;
}

/**
 * @description 判断工具是否应注册；始终排除 preview.capture 与 snowb。
 * @param definition 工具定义。
 * @param operations 当前适配器支持的 operation。
 * @param gatewayEnabled 是否走 83 项网关路径。
 * @returns 是否注册。
 */
function isRegisterable(
    definition: ICoreCocosMcpToolDefinition,
    operations: readonly string[],
    gatewayEnabled: boolean,
): definition is ICoreCocosMcpToolDefinition {
    if (isProExclusiveCocosOperation(definition.operation) || !operations.includes(definition.operation)) {
        return false;
    }
    return gatewayEnabled || (definition.readOnly && definition.risk === 'read');
}

/**
 * @description 为写入构造 dispatcher 执行上下文。
 * @param operation 稳定 operation。
 * @param input 已校验输入。
 * @param context 激活上下文。
 * @param invocation MCP 调用身份。
 * @returns 连接与资源范围。
 */
function resolveWriteExecutionContext(
    operation: string,
    input: Readonly<Record<string, unknown>>,
    context: ICoreCocosCreatorHostActivateContext,
    invocation: ICoreCocosMcpInvocation | undefined,
): ICoreCocosMcpExecutionContext {
    const connectionId =
        (typeof invocation?.connectionId === 'string' && invocation.connectionId.trim().length > 0
            ? invocation.connectionId.trim()
            : context.connectionId) ?? 'local';
    // 推导业务资源 ∪ 声明 resources；声明不得单独放行越权写（策略 A：归一后精确 ⊆，无前缀）
    const resources = resolveAuthorizedResources(operation, input, invocation?.resourceIds);
    return { connectionId, resources };
}
