import type { IMcpFailureDetails, IThroughputOverloadFailure } from '@peanut/pod-protocol';

/**
 * @description 稳定 overload 异常，携带可由 MCP presenter 透传的安全失败详情。
 */
export class ThroughputOverloadError extends Error {
    public readonly overload: IThroughputOverloadFailure;
    public readonly mcpFailure: IMcpFailureDetails;

    public constructor(overload: IThroughputOverloadFailure) {
        super(overload.code);
        this.name = 'ThroughputOverloadError';
        this.overload = overload;
        this.mcpFailure = Object.freeze({
            schemaVersion: 1,
            code: overload.code,
            category: 'overloaded',
            reason: 'The request was not started because the bounded project queue has no capacity.',
            retryable: true,
            state: overload.projectState,
            recommendedAction: 'retry_with_backoff',
            retryAfterMs: overload.retryAfterMs,
            queue: overload.queue,
        });
    }
}
