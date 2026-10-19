/**
 * @description 失败只持久化稳定错误码与有界任务身份，不能复制请求正文、token或任意响应文本。
 */
export class ResourceStabilitySafeFailure {
    /**
     * @description 从已发生的错误提取稳定码；不把未知文本当成公开诊断。
     */
    public static code(error: unknown): string {
        const message = error instanceof Error ? error.message : '';
        return /^(?:resource_|lumen_|editor_mcp_|asset_)[a-zA-Z0-9_]{1,120}(?=:|$)/u.exec(message)?.[0]
            ?? 'resource_campaign_unclassified_failure';
    }

    /**
     * @description HTTP失败安全摘要；不保留任意body字段或路径后缀。
     */
    public static http(status: number, route: string, payload: Readonly<Record<string, unknown>>) {
        const failure = payload.failure && typeof payload.failure === 'object' && !Array.isArray(payload.failure)
            ? payload.failure as Record<string, unknown> : {};
        const identity = (value: unknown): string | null => typeof value === 'string' && value.length <= 192
            && /^peanut\.editor-mcp:editor-mcp-host:[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,3}:[0-9]{1,12}:[0-9]{1,12}$/u.test(value) ? value : null;
        return { step: 'resource-http-failure', httpStatus: status,
            route: ['/mcp', '/snapshot', '/identity', '/owned-quit'].includes(route) ? route : 'unknown',
            code: this.code(new Error(typeof payload.error === 'string' ? payload.error : '')),
            taskId: identity(failure.taskId), taskStatus: ['failed', 'cancelled', 'succeeded'].includes(String(failure.taskStatus))
                ? String(failure.taskStatus) : null };
    }
}
