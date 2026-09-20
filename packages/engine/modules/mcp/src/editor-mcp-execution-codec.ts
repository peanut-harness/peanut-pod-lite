import type { IMcpExecutionControl } from '@peanut/pod-protocol';

/** @description flat tool 输入中的统一执行控制解析结果。 */
export interface IEditorMcpDecodedExecutionInput {
    readonly input: Readonly<Record<string, unknown>>;
    readonly execution: IMcpExecutionControl;
}

/** @description 校验并从业务输入剥离 execution 控制，防止控制字段进入业务 codec。 */
export class EditorMcpExecutionCodec {
    public decode(input: Readonly<Record<string, unknown>>): IEditorMcpDecodedExecutionInput {
        const businessInput = { ...input };
        delete businessInput.execution;
        const raw = input.execution;
        if (raw === undefined) {
            return { input: businessInput, execution: {} };
        }
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('editor_mcp_execution_invalid');
        }
        const record = raw as Record<string, unknown>;
        if (Object.keys(record).some((key) => !['mode', 'idempotencyKey', 'timeoutMs'].includes(key))) {
            throw new Error('editor_mcp_execution_invalid');
        }
        if (record.mode !== undefined && record.mode !== 'sync' && record.mode !== 'async') {
            throw new Error('editor_mcp_execution_mode_invalid');
        }
        if (record.idempotencyKey !== undefined && (typeof record.idempotencyKey !== 'string' || record.idempotencyKey.trim().length === 0 || record.idempotencyKey.length > 256)) {
            throw new Error('editor_mcp_execution_idempotency_key_invalid');
        }
        if (record.timeoutMs !== undefined && (!Number.isInteger(record.timeoutMs) || (record.timeoutMs as number) <= 0 || (record.timeoutMs as number) > 30 * 60 * 1000)) {
            throw new Error('editor_mcp_execution_timeout_invalid');
        }
        return {
            input: businessInput,
            execution: {
                ...(record.mode == null ? {} : { mode: record.mode as 'sync' | 'async' }),
                ...(record.idempotencyKey == null ? {} : { idempotencyKey: (record.idempotencyKey as string).trim() }),
                ...(record.timeoutMs == null ? {} : { timeoutMs: record.timeoutMs as number }),
            },
        };
    }
}
