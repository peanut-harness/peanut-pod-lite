import { ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import { types } from 'node:util';
import { McpControlFlowRefusal } from '@peanut/pod-engine/kernel';
import type { ITaskResult } from '@peanut/pod-protocol';

/** @description 仅Runtime实际准备来源失败可投影为已知无写入的字段输入拒绝；任务仍为failed。 */
export class EditorMcpResourceFieldRefusal extends McpControlFlowRefusal {
    public readonly mcpFailure: Readonly<Record<string, unknown>>;
    public readonly originalFailure: unknown;

    private constructor(code: string, taskId: string, originalFailure: unknown) {
        super(code);
        this.originalFailure = originalFailure;
        this.mcpFailure = Object.freeze({ schemaVersion: 1, code, category: 'invalid_input',
            reason: 'Asset field validation refused the input before any project write.', retryable: true,
            state: 'unchanged', recommendedAction: 'fix_input', operation: 'lumen.assetSet', taskId, taskStatus: 'failed',
            assetFieldPreparationRefusal: Object.freeze({ schemaVersion: 1, code, phase: 'prepare_before_writer',
                projectState: 'unchanged', taskId }) });
    }

    /** @description 原失败身份、空changes及对应taskId证明必须完整匹配；旧unknown错误不升级。 */
    public static fromTaskResult(result: ITaskResult | null | undefined, taskId: string): EditorMcpResourceFieldRefusal | null {
        if (!result || types.isProxy(result) || result.ok !== false || result.status !== 'failed' || result.taskId !== taskId
            || !Array.isArray(result.changes) || result.changes.length !== 0 || result.error?.code !== result.error?.message) return null;
        const data: unknown = result.data;
        if (data == null || typeof data !== 'object' || types.isProxy(data)
            || Object.getOwnPropertyDescriptor(data, 'projectState')?.value !== 'unchanged') return null;
        const proof: unknown = Object.getOwnPropertyDescriptor(data, 'assetFieldPreparationRefusal')?.value;
        if (proof == null || typeof proof !== 'object' || types.isProxy(proof) || Reflect.ownKeys(proof).length !== 5) return null;
        const read = (key: string): unknown => Object.getOwnPropertyDescriptor(proof, key)?.value;
        const originalCode = result.error?.code;
        if (typeof originalCode !== 'string' || originalCode.length === 0 || originalCode.length > 512
            || read('schemaVersion') !== 1 || read('code') !== originalCode || read('taskId') !== taskId
            || read('phase') !== 'prepare_before_writer' || read('projectState') !== 'unchanged') return null;
        if (!ExecutionRuntimeService.isSafeResourceFieldPreparationCode(originalCode)) return null;
        const code = originalCode;
        return new EditorMcpResourceFieldRefusal(code, taskId, result.error);
    }
}
