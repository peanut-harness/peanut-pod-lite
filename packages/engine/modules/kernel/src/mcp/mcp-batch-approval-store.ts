import { randomBytes } from 'crypto';

import { toHex } from '../shared/random-hex.js';

import type { McpCapabilityRisk } from '@peanut/pod-protocol';

/**
 * @description 批次授权令牌内容。
 */
export interface IMcpApprovalTokenRecord {
    /** @description 令牌标识。 */
    readonly token: string;
    /** @description 发起连接。 */
    readonly connectionId: string;
    /** @description 授权资源集合（规范化路径/uuid）。 */
    readonly resources: ReadonlySet<string>;
    /** @description 授权操作/工具名集合；空集表示同连接下任意写工具。 */
    readonly operations: ReadonlySet<string>;
    /** @description 允许的最高风险；destructive 需单独确认。 */
    readonly maxRisk: Exclude<McpCapabilityRisk, 'read'>;
    /** @description 空闲租约毫秒（默认 10s）。 */
    readonly idleLeaseMs: number;
    /** @description 最长持有毫秒。 */
    readonly maxHoldMs: number;
    /** @description 签发时间。 */
    readonly issuedAt: number;
    /** @description 绝对过期时间。 */
    readonly expiresAt: number;
    /** @description 最近一次使用时间（用于空闲判定）。 */
    lastUsedAt: number;
}

/**
 * @description 校验令牌时的请求上下文。
 */
export interface IMcpApprovalConsumeRequest {
    /** @description 连接标识。 */
    readonly connectionId: string;
    /** @description 工具名。 */
    readonly operation: string;
    /** @description 涉及资源；空表示无法绑定资源（仍可按 operation 匹配）。 */
    readonly resources: readonly string[];
    /** @description 本次调用风险。 */
    readonly risk: McpCapabilityRisk;
}

/**
 * @description 管理批次 `approvalToken` 与同资源 10s 空闲租约。
 */
export class McpBatchApprovalStore {
    /** @description 默认空闲租约。 */
    public static readonly defaultIdleLeaseMs = 10_000;
    /** @description 默认最长持有。 */
    public static readonly defaultMaxHoldMs = 60_000;
    /** @description 会话绑定空闲租约（降打扰）。 */
    public static readonly sessionIdleLeaseMs = 5 * 60_000;
    /** @description 会话绑定最长持有。 */
    public static readonly sessionMaxHoldMs = 30 * 60_000;

    /** @description 活动令牌。 */
    private readonly _tokens = new Map<string, IMcpApprovalTokenRecord>();

    /**
     * @description 签发批次授权令牌。
     * @param input 签发参数。
     * @returns 令牌字符串与过期时间。
     */
    public issue(input: {
        readonly connectionId: string;
        readonly resources: readonly string[];
        readonly operations?: readonly string[];
        readonly maxRisk?: Exclude<McpCapabilityRisk, 'read'>;
        readonly idleLeaseMs?: number;
        readonly maxHoldMs?: number;
        /** @description 为 true 时使用会话级租约（可被显式 idle/max 覆盖）。 */
        readonly sessionBound?: boolean;
    }): { readonly token: string; readonly expiresAt: number; readonly idleLeaseMs: number; readonly maxHoldMs: number } {
        this.sweep();
        const connectionId = this._readNonEmpty(input.connectionId, 'connectionId');
        const resources = this._normalizeResources(input.resources);
        if (resources.size === 0) {
            throw new Error('mcp_approval_resources_required');
        }
        const now = Date.now();
        const sessionDefaults = input.sessionBound === true;
        const defaultIdle = sessionDefaults
            ? McpBatchApprovalStore.sessionIdleLeaseMs
            : McpBatchApprovalStore.defaultIdleLeaseMs;
        const defaultMax = sessionDefaults
            ? McpBatchApprovalStore.sessionMaxHoldMs
            : McpBatchApprovalStore.defaultMaxHoldMs;
        const idleLeaseMs =
            typeof input.idleLeaseMs === 'number' && Number.isFinite(input.idleLeaseMs)
                ? Math.max(20, Math.floor(input.idleLeaseMs))
                : defaultIdle;
        const maxHoldMs =
            typeof input.maxHoldMs === 'number' && Number.isFinite(input.maxHoldMs)
                ? Math.max(idleLeaseMs, Math.floor(input.maxHoldMs))
                : Math.max(idleLeaseMs, defaultMax);
        const token = toHex(randomBytes(16));
        const record: IMcpApprovalTokenRecord = {
            token,
            connectionId,
            resources,
            operations: new Set(
                (input.operations ?? [])
                    .filter((item) => typeof item === 'string' && item.trim().length > 0)
                    .map((item) => item.trim()),
            ),
            maxRisk: input.maxRisk === 'destructive' ? 'destructive' : 'write',
            idleLeaseMs,
            maxHoldMs,
            issuedAt: now,
            expiresAt: now + maxHoldMs,
            lastUsedAt: now,
        };
        this._tokens.set(token, record);
        return { token, expiresAt: record.expiresAt, idleLeaseMs, maxHoldMs };
    }

    /**
     * @description 校验并消费令牌（成功则续期空闲时钟）。
     * @param token 令牌。
     * @param request 调用上下文。
     * @returns 是否允许跳过二次确认。
     */
    public tryConsume(token: string, request: IMcpApprovalConsumeRequest): boolean {
        return this.tryConsumeAll([{ token, request }]);
    }

    /**
     * @description 原子校验一组批次授权；任一项失败时不续期任何令牌。
     */
    public tryConsumeAll(
        entries: readonly { readonly token: string; readonly request: IMcpApprovalConsumeRequest }[],
    ): boolean {
        this.sweep();
        const now = Date.now();
        const records: IMcpApprovalTokenRecord[] = [];
        for (const { token, request } of entries) {
            if (typeof token !== 'string' || token.trim().length === 0) {
                return false;
            }
            const record = this._tokens.get(token.trim());
            if (record == null || now > record.expiresAt || now - record.lastUsedAt > record.idleLeaseMs) {
                return false;
            }
            if (record.connectionId !== request.connectionId) {
                return false;
            }
            if (request.risk !== 'read') {
                if (request.risk === 'destructive' && record.maxRisk !== 'destructive') {
                    return false;
                }
                if (record.operations.size > 0 && !record.operations.has(request.operation)) {
                    return false;
                }
                const requested = this._normalizeResources(request.resources);
                if (requested.size === 0 || [...requested].some((resource) => !record.resources.has(resource))) {
                    return false;
                }
            }
            records.push(record);
        }
        for (const record of records) {
            record.lastUsedAt = now;
        }
        return true;
    }

    /**
     * @description 撤销令牌。
     * @param token 令牌。
     * @returns 是否存在并已删除。
     */
    public revoke(token: string): boolean {
        if (typeof token !== 'string' || token.trim().length === 0) {
            return false;
        }
        return this._tokens.delete(token.trim());
    }

    /**
     * @description 清理过期令牌。
     */
    public sweep(): void {
        const now = Date.now();
        for (const [token, record] of this._tokens) {
            if (now > record.expiresAt || now - record.lastUsedAt > record.idleLeaseMs) {
                this._tokens.delete(token);
            }
        }
    }

    /**
     * @description 规范化资源键。
     * @param resources 输入。
     * @returns 集合。
     */
    private _normalizeResources(resources: readonly string[]): Set<string> {
        const result = new Set<string>();
        for (const item of resources) {
            if (typeof item !== 'string') {
                continue;
            }
            const key = this._normalizeResourceKey(item);
            if (key.length > 0) {
                result.add(key);
            }
        }
        return result;
    }

    /**
     * @description 与 Lite `normalizeResourceKey` 对齐（精确匹配；assets ↔ db://assets；uuid 无解析器则保持）。
     * @param value 原始键。
     * @returns 归一键。
     */
    private _normalizeResourceKey(value: string): string {
        const trimmed = value.trim().replace(/\\/gu, '/');
        if (trimmed.length === 0) {
            return '';
        }
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:@[\w.-]+)?$/iu;
        if (uuidRe.test(trimmed)) {
            const at = trimmed.indexOf('@');
            if (at < 0) {
                return trimmed.toLowerCase();
            }
            return `${trimmed.slice(0, at).toLowerCase()}${trimmed.slice(at)}`;
        }
        if (trimmed === 'assets' || trimmed.startsWith('assets/')) {
            return `db://${trimmed}`;
        }
        if (trimmed === 'db://assets' || trimmed.startsWith('db://assets/')) {
            return trimmed;
        }
        return trimmed;
    }

    /**
     * @description 读取非空字符串。
     * @param value 输入。
     * @param field 字段名。
     * @returns 规范化字符串。
     */
    private _readNonEmpty(value: string, field: string): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`mcp_approval_${field}_invalid`);
        }
        return value.trim();
    }
}
