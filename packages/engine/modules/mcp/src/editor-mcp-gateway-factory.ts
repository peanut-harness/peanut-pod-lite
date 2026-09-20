import type { EditorMcpOperationId, IEditorMcpActionResult, IMcpExecutionControl } from '@peanut/pod-protocol';
import type { IGrantedRuntimeClientSet, IMcpCapabilityInvocation, IPluginManagedTaskApi } from '@peanut/pod-sdk';

import { EditorMcpActionRouter } from './editor-mcp-action-router.js';
import { EditorMcpExecutionCodec } from './editor-mcp-execution-codec.js';
import { ResourceOperationTaskExecutor } from './resource-operation-task-executor.js';

/**
 * @description Lite 宿主注入的网关执行函数。
 */
export interface EditorMcpExecuteOperation {
    (
        operation: string,
        input: Readonly<Record<string, unknown>>,
        invocation?: IMcpCapabilityInvocation,
    ): Promise<unknown>;
    /**
     * @description 撤销工厂注册的受管 executor。
     */
    dispose(): void;
}

/**
 * @description 用授权 runtime 构造 Editor MCP action router。
 * @param runtime 宿主裁剪后的 runtime client 集合。
 * @returns Editor MCP action router。
 */
export function createEditorMcpActionRouter(runtime: IGrantedRuntimeClientSet): EditorMcpActionRouter {
    return new EditorMcpActionRouter(runtime);
}

/**
 * @description 把 EditorMcpActionRouter 收成宿主网关，并在可用时接入统一任务控制面。
 * @param runtime 宿主裁剪后的 runtime client 集合。
 * @param managedTasks 宿主提供的受管任务 API；缺省时保留同步直连兼容。
 * @returns 稳定 operation 执行函数。
 */
export function createEditorMcpExecuteOperation(
    runtime: IGrantedRuntimeClientSet,
    managedTasks: IPluginManagedTaskApi | null = null,
): EditorMcpExecuteOperation {
    const router = createEditorMcpActionRouter(runtime);
    const executionCodec = new EditorMcpExecutionCodec();
    const resourceExecutor = new ResourceOperationTaskExecutor({
        plan: async (operation, input) => router.planManagedResourceOperation(operation as EditorMcpOperationId, input),
        execute: async (operation, input) => router.executeManagedResourceOperation(operation as EditorMcpOperationId, input),
    });
    let taskSequence = 0;
    const disposeExecutor = managedTasks?.registerExecutor(
        ResourceOperationTaskExecutor.KIND,
        async (request, context): Promise<unknown> => resourceExecutor.execute(request, context),
        { concurrency: 'executor_managed' },
    ) ?? (() => undefined);

    const execute = async (
        operationValue: string,
        rawInput: Readonly<Record<string, unknown>>,
        invocation?: IMcpCapabilityInvocation,
    ): Promise<unknown> => {
        const operation = operationValue as EditorMcpOperationId;
        const decoded = executionCodec.decode(rawInput);
        const plan = router.plan({ operation, input: decoded.input });
        if (plan.readOnly || managedTasks == null) {
            const directResult = await router.dispatch('cocos.call', {
                operation,
                input: decoded.input,
                execution: decoded.execution,
            });
            return flattenResult(directResult as IEditorMcpActionResult);
        }
        taskSequence += 1;
        return flattenResult(await executeManaged(
            managedTasks,
            operation,
            decoded.input,
            decoded.execution,
            invocation,
            taskSequence,
        ));
    };
    return Object.assign(execute, { dispose: disposeExecutor });
}

/**
 * @description 提交受管写任务并适配同步/异步结果。
 */
async function executeManaged(
    managedTasks: IPluginManagedTaskApi,
    operation: EditorMcpOperationId,
    input: Readonly<Record<string, unknown>>,
    execution: IMcpExecutionControl,
    invocation: IMcpCapabilityInvocation | undefined,
    sequence: number,
): Promise<IEditorMcpActionResult> {
    const receipt = await managedTasks.enqueue({
        requestId: `editor-mcp-host:${operation}:${sequence}`,
        scope: 'project',
        priority: 'normal',
        kind: ResourceOperationTaskExecutor.KIND,
        payload: { operation, input },
        mergePolicy: 'none',
        ...(execution.idempotencyKey == null ? {} : { idempotencyKey: execution.idempotencyKey }),
        ...(execution.timeoutMs == null ? {} : { timeoutMs: execution.timeoutMs }),
    }, invocation);
    if (execution.mode === 'async') {
        return { operation, data: null, taskId: receipt.taskId, taskStatus: 'queued' };
    }
    const taskResult = await managedTasks.wait<Record<string, unknown>>(receipt.taskId);
    if (taskResult == null || !taskResult.ok || taskResult.status !== 'succeeded') {
        throw new Error(taskResult?.error?.code ?? 'editor_mcp_managed_task_failed');
    }
    const data = taskResult.data;
    if (data == null || typeof data.operation !== 'string' || !('data' in data)) {
        throw new Error('editor_mcp_managed_task_result_invalid');
    }
    return {
        operation: data.operation as EditorMcpOperationId,
        data: data.data,
        taskId: receipt.taskId,
        taskStatus: 'succeeded',
    };
}

/**
 * @description 将 Router 结果投影为既有 Creator flat tool 返回形状。
 */
function flattenResult(result: IEditorMcpActionResult): unknown {
    if (result.taskId == null && result.taskStatus == null) {
        return result.data;
    }
    const taskMetadata = {
        ...(result.taskId == null ? {} : { taskId: result.taskId }),
        ...(result.taskStatus == null ? {} : { taskStatus: result.taskStatus }),
    };
    if (isRecord(result.data)) {
        const postflight = 'postflight' in result.data
            ? result.data.postflight
            : 'taskPostflight' in result.data
              ? result.data.taskPostflight
              : undefined;
        return {
            ...result.data,
            ...taskMetadata,
            ...(postflight === undefined ? {} : { postflight }),
        };
    }
    return { value: result.data, ...taskMetadata };
}

/**
 * @description 判断未知值是否为普通记录。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value != null && !Array.isArray(value);
}
