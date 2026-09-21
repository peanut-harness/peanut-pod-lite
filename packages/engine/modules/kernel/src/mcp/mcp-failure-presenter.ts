import type {
    IMcpFailureDetails,
    McpFailureCategory,
    McpFailureRecommendedAction,
    McpFailureState,
} from '@peanut/pod-protocol';

/**
 * @description 失败详情中不包含错误码与协议版本的分类字段。
 */
interface IMcpFailureClassification {
    /**
     * @description 失败所属的处理类别。
     */
    readonly category: McpFailureCategory;
    /**
     * @description 受控失败原因。
     */
    readonly reason: string;
    /**
     * @description 完成推荐动作后是否允许重试。
     */
    readonly retryable: boolean;
    /**
     * @description 项目状态的保守判定。
     */
    readonly state: McpFailureState;
    /**
     * @description AI 应优先执行的动作。
     */
    readonly recommendedAction: McpFailureRecommendedAction;
}

/**
 * @description 将任意内部异常转换为不泄露输入内容的稳定 MCP 失败详情。
 */
export class McpFailurePresenter {
    /**
     * @description 判断异常是否携带完整且安全的结构化 MCP 失败详情。
     * @param error 未受信异常。
     * @returns 可由 Hub 直接返回且无需重复记录诊断时为 true。
     */
    public static hasStructuredFailure(error: unknown): boolean {
        return McpFailurePresenter._readEmbeddedFailure(error) != null;
    }

    /**
     * @description 生成供 MCP 调用方和 AI 使用的安全失败详情。
     * @param error 未受信的内部异常。
     * @returns 已分类且可安全序列化的失败详情。
     */
    public static present(error: unknown): IMcpFailureDetails {
        const embedded = McpFailurePresenter._readEmbeddedFailure(error);
        if (embedded != null) {
            return embedded;
        }
        const code = McpFailurePresenter._safeCode(error);
        const classification = McpFailurePresenter._classify(code);
        return Object.freeze({
            schemaVersion: 1,
            code,
            ...classification,
        });
    }

    /**
     * @description 读取受信组件附加到异常上的结构化失败详情。
     * @param error 未受信异常。
     * @returns 合法详情或 null。
     */
    private static _readEmbeddedFailure(error: unknown): IMcpFailureDetails | null {
        if (typeof error !== 'object' || error == null || !('mcpFailure' in error)) {
            return null;
        }
        const candidate = error.mcpFailure;
        if (typeof candidate !== 'object' || candidate == null || Array.isArray(candidate)) {
            return null;
        }
        const record = candidate as Readonly<Record<string, unknown>>;
        if (
            record.schemaVersion !== 1 ||
            typeof record.code !== 'string' ||
            !/^[a-z0-9._:-]+$/u.test(record.code) ||
            !McpFailurePresenter._isCategory(record.category) ||
            typeof record.reason !== 'string' ||
            record.reason.length === 0 ||
            record.reason.length > 240 ||
            typeof record.retryable !== 'boolean' ||
            !McpFailurePresenter._isState(record.state) ||
            !McpFailurePresenter._isRecommendedAction(record.recommendedAction)
        ) {
            return null;
        }
        return Object.freeze({
            schemaVersion: 1,
            code: record.code,
            category: record.category,
            reason: record.reason,
            retryable: record.retryable,
            state: record.state,
            recommendedAction: record.recommendedAction,
            ...(typeof record.taskId === 'string' ? { taskId: record.taskId } : {}),
            ...(record.taskStatus === 'failed' || record.taskStatus === 'cancelled' || record.taskStatus === 'timed_out'
                ? { taskStatus: record.taskStatus }
                : {}),
            ...(typeof record.operation === 'string' ? { operation: record.operation } : {}),
            ...(typeof record.retryAfterMs === 'number' ? { retryAfterMs: record.retryAfterMs } : {}),
            ...(McpFailurePresenter._isQueueSummary(record.queue) ? { queue: record.queue } : {}),
        });
    }

    /**
     * @description 从异常消息提取稳定错误码，丢弃路径与动态详情。
     * @param error 未受信异常。
     * @returns 安全错误码。
     */
    private static _safeCode(error: unknown): string {
        const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        if (/^[a-z0-9._:-]+$/u.test(message)) {
            return message;
        }
        const prefix = message.split(':')[0] ?? '';
        return /^[a-z0-9._-]+$/u.test(prefix) ? prefix : 'mcp_capability_execution_failed';
    }

    /**
     * @description 按稳定错误码生成保守的处理策略。
     * @param code 安全错误码。
     * @returns 不依赖动态输入的失败分类。
     */
    private static _classify(code: string): IMcpFailureClassification {
        if (code.includes('throughput_overloaded') || code.includes('retention_capacity_exceeded')) {
            return McpFailurePresenter._details(
                'overloaded',
                'The request was not started because the bounded project queue has no capacity.',
                true,
                'not_started',
                'retry_with_backoff',
            );
        }
        if (code.includes('approval_required')) {
            return McpFailurePresenter._details(
                'approval_required',
                'The operation was not started because a matching local approval lease is required.',
                true,
                'not_started',
                'request_approval',
            );
        }
        if (code.includes('destructive_confirmation_required')) {
            return McpFailurePresenter._details(
                'confirmation_required',
                'The destructive operation was not started because explicit confirmation is missing.',
                true,
                'not_started',
                'confirm_destructive',
            );
        }
        if (code.includes('registration_pending') || code.includes('assetdb_pending')) {
            return McpFailurePresenter._details(
                'assetdb_pending',
                'AssetDB did not confirm registration before the deadline; disk state may already have changed.',
                true,
                'may_have_changed',
                'query_state_before_retry',
            );
        }
        if (code.includes('postflight_failed')) {
            return McpFailurePresenter._details(
                'postflight_failed',
                'The operation ran but project.log verification reported an error or warning.',
                false,
                'may_have_changed',
                'inspect_project_log',
            );
        }
        if (code.includes('timeout')) {
            return McpFailurePresenter._details(
                'timeout',
                'The operation did not produce a confirmed final result before its deadline.',
                true,
                'unknown',
                'query_state_before_retry',
            );
        }
        if (code.includes('cancel')) {
            return McpFailurePresenter._details(
                'cancelled',
                'The operation was cancelled before a confirmed successful result was returned.',
                true,
                'unknown',
                'query_state_before_retry',
            );
        }
        if (
            code.includes('input') ||
            code.includes('schema') ||
            code.includes('path_invalid') ||
            code.endsWith('_required') ||
            code.includes('unsupported')
        ) {
            return McpFailurePresenter._details(
                'invalid_input',
                'The operation was not started because its input or current capability contract is invalid.',
                true,
                'not_started',
                'fix_input',
            );
        }
        if (code.includes('unavailable') || code.includes('not_active') || code.includes('no_supported')) {
            return McpFailurePresenter._details(
                'unavailable',
                'The required editor service or capability is currently unavailable.',
                true,
                'not_started',
                'restore_service',
            );
        }
        return McpFailurePresenter._details(
            'execution_failed',
            'The operation failed without a safely confirmed final project state.',
            false,
            'unknown',
            'stop',
        );
    }

    /**
     * @description 构造失败分类的公共字段。
     * @param category 失败分类。
     * @param reason 受控原因。
     * @param retryable 完成推荐动作后是否可重试。
     * @param state 项目状态判定。
     * @param recommendedAction 推荐动作。
     * @returns 失败详情公共字段。
     */
    private static _details(
        category: McpFailureCategory,
        reason: string,
        retryable: boolean,
        state: McpFailureState,
        recommendedAction: McpFailureRecommendedAction,
    ): IMcpFailureClassification {
        return { category, reason, retryable, state, recommendedAction };
    }

    /**
     * @description 判断值是否为已知失败分类。
     * @param value 未知值。
     * @returns 属于失败分类时返回 true。
     */
    private static _isCategory(value: unknown): value is McpFailureCategory {
        return [
            'invalid_input',
            'approval_required',
            'confirmation_required',
            'assetdb_pending',
            'postflight_failed',
            'timeout',
            'cancelled',
            'unavailable',
            'overloaded',
            'execution_failed',
        ].includes(typeof value === 'string' ? value : '');
    }

    /**
     * @description 判断值是否为已知项目状态判定。
     * @param value 未知值。
     * @returns 属于状态判定时返回 true。
     */
    private static _isState(value: unknown): value is McpFailureState {
        return ['not_started', 'unchanged', 'may_have_changed', 'unknown'].includes(typeof value === 'string' ? value : '');
    }

    /**
     * @description 判断值是否为已知推荐动作。
     * @param value 未知值。
     * @returns 属于推荐动作时返回 true。
     */
    private static _isRecommendedAction(value: unknown): value is McpFailureRecommendedAction {
        return [
            'fix_input',
            'request_approval',
            'confirm_destructive',
            'query_state_before_retry',
            'retry_same_request',
            'restore_service',
            'retry_with_backoff',
            'inspect_project_log',
            'stop',
        ].includes(typeof value === 'string' ? value : '');
    }

    /** @description 判断值是否为仅含当前连接计数的安全队列摘要。 */
    private static _isQueueSummary(value: unknown): value is NonNullable<IMcpFailureDetails['queue']> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }
        const record = value as Record<string, unknown>;
        return Number.isSafeInteger(record.connectionInFlight)
            && (record.connectionInFlight as number) >= 0
            && Number.isSafeInteger(record.connectionQueued)
            && (record.connectionQueued as number) >= 0
            && typeof record.saturated === 'boolean';
    }
}
