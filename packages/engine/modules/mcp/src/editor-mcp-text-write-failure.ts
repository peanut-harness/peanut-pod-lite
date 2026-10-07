import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { TextFileWriteResultProjection, type ITextFileWriteResult, type ITaskResult, type ITaskRequest } from '@peanut/pod-protocol';

/**
 * @description 带安全附件的领域失败；保留原始原因供内部调查，公开只投影固定字段。
 */
export class EditorMcpTextWriteFailure extends Error {
    /**
     * @description 保守工程状态。
     */
    public readonly projectState: ITextFileWriteResult['projectState'];
    /**
     * @description 仅当前调用的有序逐任务失败。
     */
    public readonly taskFailures: readonly { readonly request?: Readonly<ITaskRequest>; readonly textFileWrite: ITextFileWriteResult }[];
    /**
     * @description 公开 MCP 失败投影。
     */
    public readonly mcpFailure: Readonly<Record<string, unknown>>;
    /**
     * @description 原始内部失败，不进入 MCP DTO。
     */
    public readonly originalFailure: unknown;

    /**
     * @description 构造有限失败结果。
     * @param code 稳定原因码。
     * @param result 当前任务结果。
     * @param originalFailure 原始错误。
     * @param taskFailures 当前批次任务映射。
     * @param taskId 当前任务标识。
     */
    public constructor(code: string, result: ITextFileWriteResult, originalFailure?: unknown,
        taskFailures: readonly { readonly request?: Readonly<ITaskRequest>; readonly textFileWrite: ITextFileWriteResult }[] = [], taskId?: string) {
        super(code);
        this.name = 'EditorMcpTextWriteFailure';
        this.projectState = result.projectState;
        this.taskFailures = taskFailures;
        this.originalFailure = originalFailure;
        this.mcpFailure = Object.freeze({ schemaVersion: 1, code, category: 'execution_failed',
            reason: 'Text write verification failed.', retryable: false, state: result.projectState,
            recommendedAction: 'query_state_before_retry', textFileWrite: result, operation: 'asset.writeText',
            ...(taskId == null ? {} : { taskId, taskStatus: 'failed' }) });
    }

    /**
     * @description 从实际失败任务中保留安全附件，不将失败重建为成功。
     * @param result 实际 Runtime 结果。
     * @param taskId 本次任务标识。
     * @param code 原有稳定失败码。
     * @returns 保留附件的失败或原有普通失败。
     */
    public static fromTaskResult(result: ITaskResult | null | undefined, taskId: string, code: string): Error {
        const data = result?.data;
        const candidate = data != null && typeof data === 'object' && !Array.isArray(data) ? Object.getOwnPropertyDescriptor(data, 'textFileWrite')?.value : null;
        const safe = TextFileWriteResultProjection.project(candidate, CoreTextFileIoContract.limits);
        if (safe != null && !safe.ok) {
            return new EditorMcpTextWriteFailure(code, safe, undefined, [], taskId);
        }
        if (result?.ok === false && result.status === 'failed' && result.taskId === taskId
            && result.error?.code === code && result.error.message === code && code === 'text_file_io_content_conflict'
            && Array.isArray(result.changes) && result.changes.length === 0
            && EditorMcpTextWriteFailure._hasPreparationRefusal(data, taskId)) {
            // 只改变内部诊断；公开 Presenter 仍产生原来完整的保守失败 DTO。
            return Object.assign(new Error(code), { isMcpControlFlowRefusal: true,
                projectState: 'unchanged', originalFailure: result.error });
        }
        const failure = new Error(code);
        if (result?.ok === false && result.status === 'failed' && result.taskId === taskId) {
            // 受管执行已经失败；无后验附件时不能仅从输入类错误码推断整个工程未开始变化。
            Object.defineProperty(failure, 'projectState', { value: 'unknown' });
        }
        return failure;
    }

    /**
     * @description 核实由实际 Runtime 签发并绑定当前 taskId 的有限内部拒绝附件。
     * @param data 实际任务数据。
     * @param taskId 当前任务标识。
     * @returns 是否本任务的准备阶段安全拒绝。
     */
    private static _hasPreparationRefusal(data: unknown, taskId: string): boolean {
        if (data == null || typeof data !== 'object' || Array.isArray(data)
            || Object.getOwnPropertyDescriptor(data, 'projectState')?.value !== 'unchanged'
            || Object.getOwnPropertyDescriptor(data, 'textFileWrite') != null) return false;
        const marker: unknown = Object.getOwnPropertyDescriptor(data, 'textWritePreparationRefusal')?.value;
        return marker != null && typeof marker === 'object' && !Array.isArray(marker) && Reflect.ownKeys(marker).length === 5
            && Object.getOwnPropertyDescriptor(marker, 'schemaVersion')?.value === 1
            && Object.getOwnPropertyDescriptor(marker, 'code')?.value === 'text_file_io_content_conflict'
            && Object.getOwnPropertyDescriptor(marker, 'phase')?.value === 'prepare_before_writer'
            && Object.getOwnPropertyDescriptor(marker, 'projectState')?.value === 'unchanged'
            && Object.getOwnPropertyDescriptor(marker, 'taskId')?.value === taskId;
    }
}
