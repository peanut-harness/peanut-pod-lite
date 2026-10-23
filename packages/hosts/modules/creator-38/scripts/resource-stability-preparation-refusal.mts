/**
 * @description 实际HTTP400失败任务的固定安全证明，不改变真实taskStatus，也不携带输入或令牌。
 */
export class ResourceStabilityPreparationRefusal extends Error {
    private constructor(public readonly failure: Readonly<Record<string, unknown>>, code: string) { super(code); }

    /**
     * @description 仅接受经认证公共lumen.assetSet返回的完整前置无写证明；不得凭错误字符串认拒绝。
     */
    public static fromResponse(payload: unknown, operation: unknown): ResourceStabilityPreparationRefusal | null {
        if (operation !== 'peanut.editor-mcp.lumen-asset-set') return null;
        const record = this.record(payload); const failure = this.record(record?.failure);
        const marker = this.record(failure?.assetFieldPreparationRefusal);
        if (record?.ok !== false || typeof record.error !== 'string' || !record.error || !failure || !marker
            || failure.schemaVersion !== 1 || failure.code !== record.error || failure.category !== 'invalid_input'
            || failure.state !== 'unchanged' || failure.retryable !== true || failure.recommendedAction !== 'fix_input'
            || failure.operation !== 'lumen.assetSet' || failure.taskStatus !== 'failed'
            || typeof failure.taskId !== 'string' || !failure.taskId || failure.taskId.length > 256
            || marker.schemaVersion !== 1 || marker.code !== record.error || marker.phase !== 'prepare_before_writer'
            || marker.projectState !== 'unchanged' || marker.taskId !== failure.taskId) return null;
        return new ResourceStabilityPreparationRefusal(Object.freeze({ schemaVersion: 1, code: failure.code,
            category: failure.category, state: failure.state, retryable: failure.retryable, recommendedAction: failure.recommendedAction,
            operation: failure.operation, taskId: failure.taskId, taskStatus: failure.taskStatus,
            assetFieldPreparationRefusal: Object.freeze({ schemaVersion: 1, code: marker.code, phase: marker.phase,
                projectState: marker.projectState, taskId: marker.taskId }) }), record.error);
    }
    private static record(value: unknown): Record<string, unknown> | null {
        return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
    }
}
