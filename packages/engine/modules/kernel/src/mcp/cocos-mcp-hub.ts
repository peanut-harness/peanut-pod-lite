import { randomBytes } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { join, resolve } from 'path';

import type { IMcpCapabilityCatalog, IMcpCapabilityDefinition, McpCapabilityRisk } from '@peanut/pod-protocol';
import { ProjectLogPostflightMonitor, ProjectLogPostflightRepairer } from '@peanut/pod-engine/runtime';

import type { PluginManagerApp } from '../app/plugin-manager-app.js';
import { toHex } from '../shared/random-hex.js';
import type { IMcpCapabilityProgress, McpPluginExposureMode } from './mcp-capability-registry.js';
import { McpBatchApprovalStore } from './mcp-batch-approval-store.js';
import {
    summarizeMcpHubCapability,
    type IMcpHubControl,
    type IMcpHubPendingPlan,
    type IMcpHubRecentCall,
    type IMcpHubStatus,
    type McpHubCallStatus,
} from './mcp-hub-control.js';
import { ensureAbortControllerPolyfill } from './abort-controller-polyfill.js';
import { CocosMcpInputReader } from './cocos-mcp-input-reader.js';
import { McpControlFlowRefusal } from './mcp-control-flow-refusal.js';

ensureAbortControllerPolyfill();

const MAX_REQUEST_BODY_LENGTH = 128 * 1024;
const PLAN_TTL_MS = 5 * 60 * 1000;
const MAX_RECENT_CALLS = 100;

/**
 * @description Cocos 内部 MCP Hub 的启动参数。
 */
export interface ICocosMcpHubOptions {
    /** @description 当前 Cocos 项目根目录，用于保存未提交的连接描述文件。 */
    readonly projectPath: string;
    /** @description 本机监听端口；提供时跳过项目 preferredPort 粘滞与冲突回退，默认由项目 settings 决定。 */
    readonly port?: number;
    /**
     * @description 可选：写操作 postflight 失败后一轮低风险 AssetDB 刷新所用的消息端口。
     */
    readonly repairMessage?: {
        request(target: string, message: string, ...args: unknown[]): Promise<unknown>;
    };
    /**
     * @description 全局并发写 capability 上限（保护 AssetDB）；默认 16，范围 1–32。
     */
    readonly maxConcurrentWrites?: number;
    /**
     * @description 可选：将 Hub approvalToken 顺带写入 Lite McpApprovalLeaseStore（同 connection/resources/ops/risk）。
     * 不自动免审；仅镜像租约。返回 Lite token（通常与 Hub token 相同）。
     */
    readonly mirrorLocalApprovalLease?: (request: {
        readonly connectionId: string;
        readonly resources: readonly string[];
        readonly operations?: readonly string[];
        readonly maxRisk?: 'write' | 'destructive';
        readonly idleLeaseMs?: number;
        readonly maxHoldMs?: number;
        readonly sessionBound?: boolean;
        readonly preferredToken?: string;
    }) => { readonly token: string; readonly expiresAt: number; readonly idleLeaseMs?: number; readonly maxHoldMs?: number } | null;
}

interface IMcpHubSettingsRecord {
    /** @description 是否为当前项目启用 MCP Hub。 */
    readonly isEnabled: boolean;
    /**
     * @description 本项目偏好的 loopback 端口；仅项目内粘滞，不得跨项目复用。
     */
    readonly preferredPort: number | null;
    /**
     * @description 保持插件运行但不公开其 MCP capability 的插件标识。
     */
    readonly disabledPluginIds: readonly string[];
    /** @description 已明确授权公开写 capability 的插件标识。 */
    readonly writeEnabledPluginIds: readonly string[];
    /**
     * @description 测试用：为 true 时写 capability 可经 `call` 直接执行，跳过 plan 审批。
     */
    readonly directWriteEnabled: boolean;
}

interface IMcpPlanRecord {
    /** @description 一次性计划标识。 */
    readonly id: string;
    /** @description 发起计划的 bridge 连接。 */
    readonly connectionId: string;
    /** @description capability 目录版本。 */
    readonly revision: number;
    /** @description 请求的工具名称。 */
    readonly name: string;
    /** @description 已校验前的原始输入；执行时仍由 registry 再次校验。 */
    readonly input: unknown;
    /** @description 计划过期时间戳。 */
    readonly expiresAt: number;
    /** @description 与计划关联的非授权审计记录标识。 */
    readonly auditId: string;
    approved: boolean;
}

interface IMcpHubRecentCallRecord extends IMcpHubRecentCall {
    status: McpHubCallStatus;
    completedAt: number | null;
    durationMs: number | null;
    errorCode: string | null;
}

interface IMcpHubInvocationOptions {
    /** @description 当前 HTTP 调用的取消信号。 */
    readonly signal?: AbortSignal;
    /** @description 仅流式 bridge 调用可用的进度上报函数。 */
    readonly reportProgress?: (progress: IMcpCapabilityProgress) => void;
}

interface IMcpHubActiveInvocation {
    /** @description 当前调用的可取消控制器。 */
    readonly abortController: AbortController;
}

/**
 * @description 编辑器进程内的 loopback Hub；只为 stdio bridge 提供经 token 认证的私有路由。
 */
export class CocosMcpHub implements IMcpHubControl {
    /** @description MCP 边界输入校验器。 */
    private readonly _inputReader = new CocosMcpInputReader();
    /** @description 动态提供当前 plugin-manager 的函数，支持 kernel reload。 */
    private readonly _pluginManagerProvider: () => PluginManagerApp | null;
    /** @description 启动期配置。 */
    private readonly _options: ICocosMcpHubOptions;
    /** @description 单次编辑器进程的认证 token。 */
    private readonly _token = toHex(randomBytes(32));
    /** @description 单次编辑器进程标识，防止旧进程删除新描述文件。 */
    private readonly _sessionId = toHex(randomBytes(16));
    /** @description 项目内非提交状态文件。 */
    private readonly _descriptorPath: string;
    /** @description 项目内持久化的面板开关设置。 */
    private readonly _settingsPath: string;
    /** @description 当前待确认写操作。 */
    private readonly _plans = new Map<string, IMcpPlanRecord>();
    /** @description 当前编辑器会话内的最近调用审计记录。 */
    private readonly _recentCalls: IMcpHubRecentCallRecord[] = [];
    /** @description 按 bridge 连接与 invocation ID 保存的正在执行调用。 */
    private readonly _activeInvocations = new Map<string, IMcpHubActiveInvocation>();
    /** @description 本地 HTTP 服务实例。 */
    private _server: Server | null = null;
    /** @description 当前项目是否允许启动 Hub。 */
    private _isEnabled: boolean;
    /**
     * @description 本项目偏好端口；仅写入本工程 settings，并行工程各自独立。
     */
    private _preferredPort: number | null;
    /**
     * @description 当前项目禁止向 Hub 公开 capability 的插件标识。
     */
    private readonly _disabledPluginIds: Set<string>;
    /** @description 已明确授权公开写 capability 的插件标识。 */
    private readonly _writeEnabledPluginIds: Set<string>;
    /** @description 测试开关：写操作是否可跳过 plan 直接执行。 */
    private _directWriteEnabled: boolean;
    /** @description 批次 approvalToken 与资源空闲租约。 */
    private readonly _batchApprovals = new McpBatchApprovalStore();
    /**
     * @description 晚绑定的 Lite 本地租约镜像（coreModule 就绪后由 host 注入；可选）。
     */
    private _localApprovalLeaseMirror: ICocosMcpHubOptions['mirrorLocalApprovalLease'] | null = null;
    /** @description 当前在飞的写 capability 数量。 */
    private _writeInFlight = 0;
    /** @description 等待写槽位的回调队列。 */
    private readonly _writeSlotWaiters: Array<() => void> = [];
    /** @description 全局写并发上限。 */
    private readonly _maxConcurrentWrites: number;

    /**
     * @description 创建一个新的 Cocos MCP Hub。
     * @param pluginManagerProvider 返回当前活动 plugin-manager 的函数。
     * @param options Hub 启动参数。
     */
    public constructor(pluginManagerProvider: () => PluginManagerApp | null, options: ICocosMcpHubOptions) {
        if (!Number.isInteger(options.port ?? 0) || (options.port ?? 0) < 0 || (options.port ?? 0) > 65535) {
            throw new Error('cocos_mcp_hub_port_invalid');
        }
        this._pluginManagerProvider = pluginManagerProvider;
        this._options = options;
        this._localApprovalLeaseMirror = options.mirrorLocalApprovalLease ?? null;
        this._descriptorPath = join(resolve(options.projectPath), '.peanut-ai', 'cocos-mcp.json');
        this._settingsPath = join(resolve(options.projectPath), '.peanut-ai', 'cocos-mcp-settings.json');
        const settings = this._readSettings();
        this._isEnabled = settings.isEnabled;
        this._preferredPort = settings.preferredPort;
        this._disabledPluginIds = new Set(settings.disabledPluginIds);
        this._writeEnabledPluginIds = new Set(settings.writeEnabledPluginIds);
        this._directWriteEnabled = settings.directWriteEnabled;
        this._maxConcurrentWrites = this._readMaxConcurrentWrites(options.maxConcurrentWrites);
    }

    /**
     * @description 启动本项目独立的 loopback Hub，并发布连接描述文件。
     * @returns Promise 在 Hub 开始接受本机请求后结束。
     */
    public async start(): Promise<void> {
        if (!this._isEnabled || this._server != null) {
            return;
        }
        const allowPreferredFallback = this._options.port === undefined;
        const listenCandidates = this._resolveListenCandidates();
        let lastError: unknown = null;
        for (let index = 0; index < listenCandidates.length; index += 1) {
            const port = listenCandidates[index];
            if (port === undefined) {
                continue;
            }
            const server = createServer(async (request, response): Promise<void> => {
                await this._handleRequest(request, response);
            });
            this._server = server;
            try {
                await this._listen(server, port);
                this._writeDescriptor();
                if (allowPreferredFallback) {
                    this._stickyPreferredPort(this.getPort());
                }
                return;
            } catch (error) {
                lastError = error;
                this._server = null;
                await this._closeServerQuietly(server);
                const hasFallback = allowPreferredFallback && index + 1 < listenCandidates.length;
                if (!hasFallback || !this._isAddressInUseError(error)) {
                    throw error;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error('cocos_mcp_hub_start_failed');
    }

    /**
     * @description 停止 Hub 并在仍属于当前会话时删除描述文件。
     * @returns Promise 在服务关闭后结束。
     */
    public async stop(): Promise<void> {
        const server = this._server;
        this._server = null;
        for (const plan of this._plans.values()) {
            this._completeRecentCall(plan.auditId, 'rejected', 'cocos_mcp_hub_disabled');
        }
        this._plans.clear();
        if (server != null) {
            await new Promise<void>((resolveStop, rejectStop) =>
                server.close((error) => (error == null ? resolveStop() : rejectStop(error))),
            );
        }
        this._removeDescriptorIfOwned();
    }

    /**
     * @description 返回当前动态监听端口。
     * @returns 服务未启动时返回 `null`。
     */
    public getPort(): number | null {
        const address = this._server?.address();
        return address != null && typeof address !== 'string' ? address.port : null;
    }

    /**
     * @description 返回面板可展示的 Hub 状态与当前公开工具。
     * @returns 不包含 token、连接标识或计划输入的状态快照。
     */
    public getStatus(): IMcpHubStatus {
        const catalog = this._getCatalog();
        return {
            isAvailable: true,
            isEnabled: this._isEnabled,
            port: this.getPort(),
            preferredPort: this._preferredPort,
            catalogRevision: catalog.revision,
            capabilities: catalog.capabilities.map((definition) => summarizeMcpHubCapability(definition)),
            disabledPluginIds: [...this._disabledPluginIds].sort((left, right) => left.localeCompare(right)),
            writeEnabledPluginIds: [...this._writeEnabledPluginIds].sort((left, right) => left.localeCompare(right)),
            directWriteEnabled: this._directWriteEnabled,
            recentCalls: this.listRecentCalls(),
        };
    }

    /**
     * @description 返回仍可由编辑器用户审批的写操作计划。
     * @returns 按到期时间排序的计划摘要。
     */
    public listPendingPlans(): readonly IMcpHubPendingPlan[] {
        this._removeExpiredPlans();
        const registry = this._requirePluginManager().getMcpCapabilityRegistry();
        return [...this._plans.values()]
            .filter((plan) => !plan.approved)
            .map((plan) => {
                const risk = registry.getDefinition(plan.name)?.risk ?? 'write';
                return this._summarizePlan(plan, risk);
            })
            .sort((left, right) => left.expiresAt - right.expiresAt);
    }

    /**
     * @description 返回当前编辑器会话内最近的 MCP 调用审计记录。
     * @returns 按最新请求时间倒序排列的安全摘要。
     */
    public listRecentCalls(): readonly IMcpHubRecentCall[] {
        return this._recentCalls.map((record) => ({ ...record }));
    }

    /**
     * @description 保存面板配置，并立即启动或停止当前项目的 Hub。
     * @param isEnabled 是否允许本项目暴露本地 MCP Hub。
     * @returns Promise 在状态切换完成后结束。
     */
    public async setEnabled(isEnabled: boolean): Promise<void> {
        this._isEnabled = isEnabled;
        this._writeSettings();
        if (isEnabled) {
            await this.start();
            return;
        }
        await this.stop();
    }

    /**
     * @description 设置指定插件的 MCP capability 是否可向当前项目的 Hub 公开。
     * @param pluginId 目标插件标识。
     * @param isEnabled 是否公开该插件 capability。
     * @returns Promise 在项目设置持久化并更新活动 registry 后结束。
     */
    public async setPluginEnabled(pluginId: string, isEnabled: boolean): Promise<void> {
        await this.setPluginExposure(pluginId, isEnabled ? 'all' : 'disabled');
    }

    /**
     * @description 设置测试用直写开关：开启后写 capability 可经 `call` 直接执行。
     * @param isEnabled 是否跳过 plan 审批。
     * @returns Promise 在设置持久化后结束。
     */
    public async setDirectWriteEnabled(isEnabled: boolean): Promise<void> {
        if (this._directWriteEnabled === isEnabled) {
            return;
        }
        this._directWriteEnabled = isEnabled;
        this._writeSettings();
    }

    /**
     * @description 设置指定插件的 MCP capability 公开级别。
     * @param pluginId 目标插件标识。
     * @param mode 关闭、仅只读或全部公开。
     * @returns Promise 在项目设置持久化并更新活动 registry 后结束。
     */
    public async setPluginExposure(pluginId: string, mode: McpPluginExposureMode): Promise<void> {
        this._assertPluginId(pluginId);
        const registry = this._requirePluginManager().getMcpCapabilityRegistry();
        const previousMode = this._getPluginExposure(pluginId);
        if (previousMode === mode) {
            return;
        }
        this._disabledPluginIds.delete(pluginId);
        this._writeEnabledPluginIds.delete(pluginId);
        if (mode === 'disabled') {
            this._disabledPluginIds.add(pluginId);
        } else if (mode === 'all') {
            this._writeEnabledPluginIds.add(pluginId);
        }
        try {
            this._writeSettings();
        } catch (error) {
            this._disabledPluginIds.delete(pluginId);
            this._writeEnabledPluginIds.delete(pluginId);
            if (previousMode === 'disabled') {
                this._disabledPluginIds.add(pluginId);
            } else if (previousMode === 'all') {
                this._writeEnabledPluginIds.add(pluginId);
            }
            throw error;
        }
        registry.setPluginExposure(pluginId, mode);
    }

    /**
     * @description 将已持久化的插件 capability 公开状态应用到新建的 plugin-manager kernel。
     * @param pluginManager 新建的 plugin-manager 实例。
     * @returns 无返回值。
     */
    public applyPluginExposureSettings(pluginManager: PluginManagerApp): void {
        const registry = pluginManager.getMcpCapabilityRegistry();
        for (const pluginId of this._disabledPluginIds) {
            registry.setPluginExposure(pluginId, 'disabled');
        }
        for (const pluginId of this._writeEnabledPluginIds) {
            if (!this._disabledPluginIds.has(pluginId)) {
                registry.setPluginExposure(pluginId, 'all');
            }
        }
    }

    /** @description 处理经过 token 认证的 bridge 私有请求。 */
    private async _handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST' || request.url !== '/mcp' || request.headers['x-peanut-mcp-token'] !== this._token) {
            response.writeHead(403).end();
            return;
        }
        const abortController = new AbortController();
        request.once('aborted', (): void => {
            abortController.abort();
        });
        response.once('close', (): void => {
            abortController.abort();
        });
        try {
            const payload = await this._readPayload(request);
            if (payload.stream === true) {
                await this._writeStreamResponse(response, payload, abortController.signal);
                return;
            }
            const result = await this._dispatch(payload, { signal: abortController.signal });
            if (abortController.signal.aborted) {
                return;
            }
            response.writeHead(200, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify({ ok: true, result }));
        } catch (error) {
            if (abortController.signal.aborted) {
                return;
            }
            const failure = this._inputReader.toSafeFailure(error);
            response
                .writeHead(400, { 'content-type': 'application/json', connection: 'close' })
                .end(JSON.stringify({ ok: false, error: failure.code, failure }));
        }
    }

    /**
     * @description 通过仅 bridge 使用的 NDJSON 响应传递 capability 进度和最终结果。
     * @param response 当前 HTTP 响应。
     * @param payload 已校验为对象的 Hub 动作参数。
     * @param signal 当前 HTTP 调用的取消信号。
     * @returns Promise 在结果事件已写入或 Client 取消后结束。
     */
    private async _writeStreamResponse(response: ServerResponse, payload: Record<string, unknown>, signal: AbortSignal): Promise<void> {
        response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/x-ndjson', connection: 'close' });
        const reportProgress = (progress: IMcpCapabilityProgress): void => {
            if (signal.aborted || response.destroyed) {
                return;
            }
            response.write(`${JSON.stringify({ type: 'progress', ...this._inputReader.readProgress(progress) })}\n`);
        };
        try {
            const result = await this._dispatch(payload, { signal, reportProgress });
            if (!signal.aborted && !response.destroyed) {
                response.end(`${JSON.stringify({ type: 'result', ok: true, result })}\n`);
            }
        } catch (error) {
            if (!signal.aborted && !response.destroyed) {
                const failure = this._inputReader.toSafeFailure(error);
                response.end(`${JSON.stringify({ type: 'result', ok: false, error: failure.code, failure })}\n`);
            }
        }
    }

    /** @description 分发受限 bridge 动作。 */
    private async _dispatch(payload: Record<string, unknown>, invocation: IMcpHubInvocationOptions = {}): Promise<unknown> {
        const action = payload.action;
        if (action === 'health') {
            return { sessionId: this._sessionId, revision: this._getCatalog().revision };
        }
        if (action === 'catalog') {
            return this._getCatalog();
        }
        if (action === 'status') {
            return this.getStatus();
        }
        if (action === 'setPluginExposure') {
            const pluginId = this._inputReader.readPluginId(payload.pluginId);
            const mode = this._inputReader.readExposureMode(payload.mode);
            await this.setPluginExposure(pluginId, mode);
            return {
                pluginId,
                mode: this._getPluginExposure(pluginId),
                catalog: this._getCatalog(),
            };
        }
        if (action === 'reloadSettings') {
            return this._reloadSettingsFromDisk();
        }
        if (action === 'setDirectWriteEnabled') {
            await this.setDirectWriteEnabled(payload.isEnabled === true);
            return { directWriteEnabled: this._directWriteEnabled };
        }
        const connectionId = this._inputReader.readConnectionId(payload.connectionId);
        if (action === 'cancel') {
            this._cancelInvocation(connectionId, this._inputReader.readInvocationId(payload.invocationId));
            return {};
        }
        const invocationId = this._inputReader.readOptionalInvocationId(payload.invocationId);
        if (action === 'call') {
            return this._withInvocation(connectionId, invocationId, invocation, async (activeInvocation): Promise<unknown> =>
                this._call(this._inputReader.readName(payload.name), payload.input, connectionId, activeInvocation),
            );
        }
        if (action === 'plan') {
            return this._createPlan(this._inputReader.readName(payload.name), payload.input, connectionId);
        }
        if (action === 'execute') {
            return this._withInvocation(connectionId, invocationId, invocation, async (activeInvocation): Promise<unknown> =>
                this._executePlan(this._inputReader.readPlanId(payload.planId), connectionId, activeInvocation),
            );
        }
        if (action === 'issueApprovalToken') {
            return this._issueApprovalToken(connectionId, payload);
        }
        if (action === 'revokeApprovalToken') {
            return { revoked: this._batchApprovals.revoke(this._inputReader.readApprovalToken(payload.approvalToken)) };
        }
        throw new Error('cocos_mcp_hub_action_invalid');
    }

    /**
     * @description 为带 invocation ID 的工具调用建立 Hub 侧可取消生命周期。
     * @param connectionId 当前 bridge 连接标识。
     * @param invocationId 当前调用的可选瞬时标识。
     * @param invocation HTTP 请求派生的调用上下文。
     * @param execute 使用已组合取消信号执行调用的函数。
     * @returns capability 或 plan 的执行结果。
     */
    private async _withInvocation(
        connectionId: string,
        invocationId: string | null,
        invocation: IMcpHubInvocationOptions,
        execute: (invocation: IMcpHubInvocationOptions) => Promise<unknown>,
    ): Promise<unknown> {
        if (invocationId == null) {
            return execute(invocation);
        }
        const key = this._getInvocationKey(connectionId, invocationId);
        if (this._activeInvocations.has(key)) {
            throw new Error('cocos_mcp_invocation_conflict');
        }
        const abortController = new AbortController();
        const onRequestAbort = (): void => {
            abortController.abort();
        };
        if (invocation.signal?.aborted) {
            onRequestAbort();
        } else {
            invocation.signal?.addEventListener('abort', onRequestAbort, { once: true });
        }
        this._activeInvocations.set(key, { abortController });
        try {
            return await execute({ ...invocation, signal: abortController.signal });
        } finally {
            invocation.signal?.removeEventListener('abort', onRequestAbort);
            if (this._activeInvocations.get(key)?.abortController === abortController) {
                this._activeInvocations.delete(key);
            }
        }
    }

    /**
     * @description 取消同一 bridge 连接内仍在运行的一次 capability 调用。
     * @param connectionId 当前 bridge 连接标识。
     * @param invocationId 当前调用的瞬时标识。
     * @returns 无返回值。
     */
    private _cancelInvocation(connectionId: string, invocationId: string): void {
        this._activeInvocations.get(this._getInvocationKey(connectionId, invocationId))?.abortController.abort();
    }

    /**
     * @description 拼接仅限当前编辑器会话内使用的调用映射键。
     * @param connectionId 当前 bridge 连接标识。
     * @param invocationId 当前调用的瞬时标识。
     * @returns 供 Hub 内部 Map 使用的稳定键。
     */
    private _getInvocationKey(connectionId: string, invocationId: string): string {
        return `${connectionId}:${invocationId}`;
    }

    /** @description 直接执行只读 capability；写操作默认转入 plan，测试直写开启或持有有效 approvalToken 时立即执行。 */
    private async _call(name: string, input: unknown, connectionId: string, invocation: IMcpHubInvocationOptions): Promise<unknown> {
        const registry = this._requirePluginManager().getMcpCapabilityRegistry();
        const definition = registry.getDefinition(name);
        if (definition == null) {
            throw new Error(`mcp_capability_unavailable:${name}`);
        }
        const risk = this._inputReader.resolveCallRisk(definition, input);
        const resourceIds = this._inputReader.readOptionalResources(input);
        let hasLocalApproval = false;
        if (!definition.readOnly && !this._directWriteEnabled) {
            const approvalToken = this._inputReader.readOptionalApprovalToken(input);
            if (
                approvalToken == null ||
                !this._batchApprovals.tryConsume(approvalToken, {
                    connectionId,
                    operation: name,
                    resources: resourceIds,
                    risk,
                })
            ) {
                return this._createPlan(name, input, connectionId);
            }
            hasLocalApproval = true;
        }
        if (risk === 'destructive' && this._inputReader.readConfirmDestructive(input) !== true) {
            McpControlFlowRefusal.reject('cocos_mcp_destructive_confirmation_required');
        }
        const recentCall = this._createRecentCall(definition, 'approved');
        try {
            const result = await this._invokeWithPostflight(definition, name, input, connectionId, invocation, risk, {
                resourceIds,
                hasLocalApproval,
            });
            this._completeRecentCall(recentCall.id, 'succeeded');
            return result;
        } catch (error) {
            this._completeRecentCall(recentCall.id, 'failed', this._inputReader.toSafeErrorCode(error));
            throw error;
        }
    }

    /** @description 为受控写 capability 创建等待编辑器确认的一次性计划。 */
    private _createPlan(name: string, input: unknown, connectionId: string): Record<string, unknown> {
        const catalog = this._getCatalog();
        const registry = this._requirePluginManager().getMcpCapabilityRegistry();
        const definition = registry.getDefinition(name);
        if (definition == null) {
            throw new Error(`mcp_capability_unavailable:${name}`);
        }
        const recentCall = this._createRecentCall(definition, 'pending_approval');
        try {
            registry.validateInput(name, input);
        } catch (error) {
            this._completeRecentCall(recentCall.id, 'failed', this._inputReader.toSafeErrorCode(error));
            throw error;
        }
        const id = toHex(randomBytes(16));
        const expiresAt = Date.now() + PLAN_TTL_MS;
        this._plans.set(id, {
            id,
            connectionId,
            revision: catalog.revision,
            name,
            input,
            expiresAt,
            auditId: recentCall.id,
            approved: false,
        });
        return {
            planId: id,
            name,
            readOnly: definition.readOnly,
            risk: definition.risk,
            expiresAt,
            confirmationRequired: !definition.readOnly,
        };
    }

    /** @description 执行已经由编辑器 UI 批准的一次性计划。 */
    private async _executePlan(planId: string, connectionId: string, invocation: IMcpHubInvocationOptions): Promise<unknown> {
        this._removeExpiredPlans();
        const plan = this._plans.get(planId);
        if (plan == null || plan.connectionId !== connectionId) {
            throw new Error('cocos_mcp_plan_unavailable');
        }
        if (!plan.approved) {
            throw new Error('cocos_mcp_plan_confirmation_required');
        }
        if (plan.revision !== this._getCatalog().revision) {
            this._completeRecentCall(plan.auditId, 'failed', 'cocos_mcp_plan_catalog_changed');
            throw new Error('cocos_mcp_plan_catalog_changed');
        }
        this._plans.delete(planId);
        try {
            const definition = this._requirePluginManager().getMcpCapabilityRegistry().getDefinition(plan.name);
            if (definition == null) {
                throw new Error(`mcp_capability_unavailable:${plan.name}`);
            }
            const result = await this._invokeWithPostflight(
                definition,
                plan.name,
                plan.input,
                connectionId,
                invocation,
                this._inputReader.resolveCallRisk(definition, plan.input),
                {
                    resourceIds: this._inputReader.readOptionalResources(plan.input),
                    hasLocalApproval: true,
                },
            );
            this._completeRecentCall(plan.auditId, 'succeeded');
            return result;
        } catch (error) {
            this._completeRecentCall(plan.auditId, 'failed', this._inputReader.toSafeErrorCode(error));
            throw error;
        }
    }

    /**
     * @description 执行 capability；写操作自动附带 project.log 增量 postflight，失败时一轮低风险 refresh 修复。
     * @param definition capability 定义。
     * @param name capability 名称。
     * @param input 调用输入。
     * @param connectionId 连接标识。
     * @param invocation 调用选项。
     * @param risk 本次解析后的风险。
     * @param authorization Hub 已计算的本地资源与审批上下文。
     * @returns 原始结果，或带 `postflight` 字段的对象。
     */
    private async _invokeWithPostflight(
        definition: IMcpCapabilityDefinition,
        name: string,
        input: unknown,
        connectionId: string,
        invocation: IMcpHubInvocationOptions,
        risk: McpCapabilityRisk = definition.risk,
        authorization: { readonly resourceIds: readonly string[]; readonly hasLocalApproval: boolean } = {
            resourceIds: [],
            hasLocalApproval: false,
        },
    ): Promise<unknown> {
        const registry = this._requirePluginManager().getMcpCapabilityRegistry();
        if (definition.readOnly) {
            return registry.invoke(name, input, { connectionId, ...invocation, risk, ...authorization });
        }
        await this._acquireWriteSlot();
        try {
            const projectRoot = resolve(this._options.projectPath);
            const monitor = new ProjectLogPostflightMonitor();
            const checkpoint = monitor.checkpoint(projectRoot);
            const result = await registry.invoke(name, input, { connectionId, ...invocation, risk, ...authorization });
            let postflight = monitor.readDelta(checkpoint);
            if (postflight.verified === false && risk !== 'destructive') {
                const repairer = new ProjectLogPostflightRepairer(this._options.repairMessage ?? null);
                postflight = await repairer.repairOnceIfNeeded(projectRoot, postflight);
            }
            if (result != null && typeof result === 'object' && !Array.isArray(result)) {
                return { ...(result as Record<string, unknown>), postflight };
            }
            return { data: result, postflight };
        } finally {
            this._releaseWriteSlot();
        }
    }

    /**
     * @description 解析并校验 Hub 写并发上限。
     * @param value 可选配置。
     * @returns 1–32 之间的整数。
     */
    private _readMaxConcurrentWrites(value: number | undefined): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return 16;
        }
        return Math.max(1, Math.min(32, Math.floor(value)));
    }

    /**
     * @description 获取一个全局写槽位；槽位满时 FIFO 等待。
     * @returns 无返回值。
     */
    private async _acquireWriteSlot(): Promise<void> {
        if (this._writeInFlight < this._maxConcurrentWrites) {
            this._writeInFlight += 1;
            return;
        }
        await new Promise<void>((resolve) => {
            this._writeSlotWaiters.push(resolve);
        });
        this._writeInFlight += 1;
    }

    /**
     * @description 释放写槽位并唤醒下一个等待者。
     * @returns 无返回值。
     */
    private _releaseWriteSlot(): void {
        this._writeInFlight = Math.max(0, this._writeInFlight - 1);
        const next = this._writeSlotWaiters.shift();
        if (next != null) {
            next();
        }
    }

    /**
     * @description 由编辑器内确认 UI 批准一个仍有效的写计划。
     * @param planId 要批准的计划标识。
     * @returns 成功标记；过期或不存在时返回 `false`。
     */
    public approvePlan(planId: string): boolean {
        this._removeExpiredPlans();
        const plan = this._plans.get(planId);
        if (plan == null) {
            return false;
        }
        plan.approved = true;
        this._updateRecentCallStatus(plan.auditId, 'approved');
        return true;
    }

    /**
     * @description 批准写计划并为同资源签发空闲租约令牌（默认同资源 10s；可 sessionBound）。
     * @param planId 计划标识。
     * @param resources 授权资源集合。
     * @param options 可选会话绑定与租约覆盖。
     * @returns 令牌信息；计划无效时返回 `null`。
     */
    public approvePlanAndIssueToken(
        planId: string,
        resources: readonly string[],
        options?: {
            readonly sessionBound?: boolean;
            readonly idleLeaseMs?: number;
            readonly maxHoldMs?: number;
        },
    ): { readonly approvalToken: string; readonly approvalId: string; readonly expiresAt: number; readonly idleLeaseMs: number; readonly liteMirrored: boolean } | null {
        this._removeExpiredPlans();
        const plan = this._plans.get(planId);
        if (plan == null) {
            return null;
        }
        plan.approved = true;
        this._updateRecentCallStatus(plan.auditId, 'approved');
        const definition = this._requirePluginManager().getMcpCapabilityRegistry().getDefinition(plan.name);
        const maxRisk = definition?.risk === 'destructive' ? 'destructive' : 'write';
        const issued = this._batchApprovals.issue({
            connectionId: plan.connectionId,
            resources,
            operations: [plan.name],
            maxRisk,
            sessionBound: options?.sessionBound === true,
            ...(options?.idleLeaseMs == null ? {} : { idleLeaseMs: options.idleLeaseMs }),
            ...(options?.maxHoldMs == null ? {} : { maxHoldMs: options.maxHoldMs }),
        });
        const approvalId = this._mirrorLocalApprovalLease(
            plan.connectionId,
            resources,
            [plan.name],
            maxRisk,
            issued.token,
            issued.idleLeaseMs,
            issued.maxHoldMs,
            options?.sessionBound === true,
        );
        return {
            approvalToken: issued.token,
            approvalId: approvalId ?? issued.token,
            expiresAt: issued.expiresAt,
            idleLeaseMs: issued.idleLeaseMs,
            liteMirrored: approvalId != null,
        };
    }

    /**
     * @description 拒绝并删除一个仍有效的写操作计划。
     * @param planId 待拒绝的一次性计划标识。
     * @returns 计划存在且仍有效时返回 `true`。
     */
    public rejectPlan(planId: string): boolean {
        this._removeExpiredPlans();
        const plan = this._plans.get(planId);
        if (plan == null) {
            return false;
        }
        this._plans.delete(planId);
        this._completeRecentCall(plan.auditId, 'rejected', 'cocos_mcp_plan_rejected');
        return true;
    }

    /** @description 返回当前已激活插件的 capability 目录。 */
    private _getCatalog(): IMcpCapabilityCatalog {
        return this._requirePluginManager().getMcpCapabilityRegistry().getCatalog();
    }

    /** @description 从请求体读取并收窄 JSON 对象。 */
    private async _readPayload(request: import('http').IncomingMessage): Promise<Record<string, unknown>> {
        let body = '';
        for await (const chunk of request) {
            body += String(chunk);
            if (body.length > MAX_REQUEST_BODY_LENGTH) {
                throw new Error('cocos_mcp_hub_request_too_large');
            }
        }
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
            throw new Error('cocos_mcp_hub_payload_invalid');
        }
        return parsed as Record<string, unknown>;
    }

    /** @description 发布经原子替换写入的本机连接描述。 */
    private _writeDescriptor(): void {
        const projectPath = resolve(this._options.projectPath);
        if (!existsSync(projectPath) || !lstatSync(projectPath).isDirectory() || lstatSync(projectPath).isSymbolicLink()) {
            throw new Error('cocos_mcp_project_path_invalid');
        }
        const stateDirectory = join(projectPath, '.peanut-ai');
        if (existsSync(stateDirectory) && (!lstatSync(stateDirectory).isDirectory() || lstatSync(stateDirectory).isSymbolicLink())) {
            throw new Error('cocos_mcp_state_directory_invalid');
        }
        mkdirSync(stateDirectory, { recursive: true });
        if (
            existsSync(this._descriptorPath) &&
            (!lstatSync(this._descriptorPath).isFile() || lstatSync(this._descriptorPath).isSymbolicLink())
        ) {
            throw new Error('cocos_mcp_descriptor_invalid');
        }
        const temporaryPath = `${this._descriptorPath}.${this._sessionId}.tmp`;
        writeFileSync(
            temporaryPath,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    endpoint: 'http://127.0.0.1',
                    port: this.getPort(),
                    token: this._token,
                    sessionId: this._sessionId,
                    protocolVersion: 1,
                },
                null,
                2,
            ),
            'utf8',
        );
        renameSync(temporaryPath, this._descriptorPath);
    }

    /** @description 读取项目内持久化的 Hub 与插件 capability 公开设置；缺失或损坏时使用安全默认值。 */
    private _readSettings(): IMcpHubSettingsRecord {
        const defaults: IMcpHubSettingsRecord = {
            isEnabled: true,
            preferredPort: null,
            disabledPluginIds: [],
            writeEnabledPluginIds: [],
            directWriteEnabled: false,
        };
        if (!existsSync(this._settingsPath) || !lstatSync(this._settingsPath).isFile() || lstatSync(this._settingsPath).isSymbolicLink()) {
            return defaults;
        }
        try {
            const value: unknown = JSON.parse(readFileSync(this._settingsPath, 'utf8'));
            if (
                typeof value === 'object' &&
                value != null &&
                !Array.isArray(value) &&
                typeof (value as Record<string, unknown>).isEnabled === 'boolean'
            ) {
                const record = value as Record<string, unknown>;
                const isEnabled = record.isEnabled;
                return {
                    isEnabled: isEnabled as boolean,
                    preferredPort: this._readOptionalPreferredPort(record.preferredPort),
                    disabledPluginIds: Array.isArray(record.disabledPluginIds)
                        ? record.disabledPluginIds.filter(
                              (pluginId): pluginId is string => typeof pluginId === 'string' && this._isPluginId(pluginId),
                          )
                        : [],
                    writeEnabledPluginIds: Array.isArray(record.writeEnabledPluginIds)
                        ? record.writeEnabledPluginIds.filter(
                              (pluginId): pluginId is string => typeof pluginId === 'string' && this._isPluginId(pluginId),
                          )
                        : [],
                    directWriteEnabled: record.directWriteEnabled === true,
                };
            }
        } catch {
            return defaults;
        }
        return defaults;
    }

    /** @description 使用原子替换保存项目 Hub 与插件 capability 公开设置。 */
    private _writeSettings(): void {
        const projectPath = resolve(this._options.projectPath);
        if (!existsSync(projectPath) || !lstatSync(projectPath).isDirectory() || lstatSync(projectPath).isSymbolicLink()) {
            throw new Error('cocos_mcp_project_path_invalid');
        }
        const stateDirectory = join(projectPath, '.peanut-ai');
        if (existsSync(stateDirectory) && (!lstatSync(stateDirectory).isDirectory() || lstatSync(stateDirectory).isSymbolicLink())) {
            throw new Error('cocos_mcp_state_directory_invalid');
        }
        mkdirSync(stateDirectory, { recursive: true });
        if (existsSync(this._settingsPath) && (!lstatSync(this._settingsPath).isFile() || lstatSync(this._settingsPath).isSymbolicLink())) {
            throw new Error('cocos_mcp_settings_invalid');
        }
        const temporaryPath = `${this._settingsPath}.${this._sessionId}.tmp`;
        writeFileSync(
            temporaryPath,
            JSON.stringify(
                {
                    isEnabled: this._isEnabled,
                    preferredPort: this._preferredPort,
                    disabledPluginIds: [...this._disabledPluginIds].sort((left, right) => left.localeCompare(right)),
                    writeEnabledPluginIds: [...this._writeEnabledPluginIds]
                        .filter((pluginId) => !this._disabledPluginIds.has(pluginId))
                        .sort((left, right) => left.localeCompare(right)),
                    directWriteEnabled: this._directWriteEnabled,
                },
                null,
                2,
            ),
            'utf8',
        );
        renameSync(temporaryPath, this._settingsPath);
    }

    /**
     * @description 解析本项目本次启动应尝试的监听端口序列。
     * @returns 有序端口列表；偏好端口冲突时可回退到 `0`，避免影响其他工程。
     */
    private _resolveListenCandidates(): readonly number[] {
        if (this._options.port !== undefined) {
            return [this._options.port];
        }
        if (this._preferredPort != null && this._preferredPort > 0) {
            return [this._preferredPort, 0];
        }
        return [0];
    }

    /**
     * @description 在本机 loopback 上监听指定端口。
     * @param server HTTP 服务实例。
     * @param port 目标端口；`0` 表示由系统分配。
     * @returns Promise 在开始接受连接后结束。
     */
    private async _listen(server: Server, port: number): Promise<void> {
        await new Promise<void>((resolveStart, rejectStart) =>
            server.once('error', rejectStart).listen(port, '127.0.0.1', resolveStart),
        );
    }

    /**
     * @description 安静关闭尚未对外发布的失败监听实例。
     * @param server 待关闭服务。
     * @returns Promise 在关闭尝试结束后结束。
     */
    private async _closeServerQuietly(server: Server): Promise<void> {
        await new Promise<void>((resolveClose): void => {
            server.close((): void => {
                resolveClose();
            });
        });
    }

    /**
     * @description 判断监听失败是否为端口占用，以便本项目回退而不影响其他工程。
     * @param error 未知错误。
     * @returns 是否为 `EADDRINUSE`。
     */
    private _isAddressInUseError(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error != null &&
            'code' in error &&
            (error as { readonly code?: unknown }).code === 'EADDRINUSE'
        );
    }

    /**
     * @description 将成功绑定的端口粘滞到本项目 settings；仅影响当前工程。
     * @param port 实际监听端口。
     * @returns 无返回值。
     */
    private _stickyPreferredPort(port: number | null): void {
        if (port == null || port <= 0 || this._preferredPort === port) {
            return;
        }
        this._preferredPort = port;
        this._writeSettings();
    }

    /**
     * @description 读取 settings 中的可选偏好端口。
     * @param value 未受信输入。
     * @returns 合法端口或 `null`。
     */
    private _readOptionalPreferredPort(value: unknown): number | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 65535) {
            return null;
        }
        return value as number;
    }

    /**
     * @description 校验插件标识满足 MCP capability 命名作用域。
     */
    private _assertPluginId(pluginId: string): void {
        if (!this._isPluginId(pluginId)) {
            throw new Error('cocos_mcp_plugin_id_invalid');
        }
    }

    /** @description 返回当前项目中某插件的持久化 MCP 公开级别。 */
    private _getPluginExposure(pluginId: string): McpPluginExposureMode {
        if (this._disabledPluginIds.has(pluginId)) {
            return 'disabled';
        }
        return this._writeEnabledPluginIds.has(pluginId) ? 'all' : 'read_only';
    }

    /**
     * @description 判断值是否为 MCP capability 支持的插件标识。
     */
    private _isPluginId(value: string): boolean {
        return /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value);
    }

    /** @description 将内部写计划转换为不含输入与连接信息的面板摘要。 */
    private _summarizePlan(plan: IMcpPlanRecord, risk: McpCapabilityRisk): IMcpHubPendingPlan {
        return {
            id: plan.id,
            name: plan.name,
            risk,
            expiresAt: plan.expiresAt,
        };
    }

    /** @description 仅在描述文件仍属于当前 Hub 会话时删除它。 */
    private _removeDescriptorIfOwned(): void {
        if (
            !existsSync(this._descriptorPath) ||
            !lstatSync(this._descriptorPath).isFile() ||
            lstatSync(this._descriptorPath).isSymbolicLink()
        ) {
            return;
        }
        try {
            const descriptor = JSON.parse(readFileSync(this._descriptorPath, 'utf8')) as Record<string, unknown>;
            if (descriptor.sessionId === this._sessionId) {
                rmSync(this._descriptorPath);
            }
        } catch {
            return;
        }
    }

    /** @description 清除到期计划，防止跨会话残留写授权。 */
    private _removeExpiredPlans(): void {
        const now = Date.now();
        for (const [id, plan] of this._plans) {
            if (plan.expiresAt <= now) {
                this._plans.delete(id);
                this._completeRecentCall(plan.auditId, 'expired', 'cocos_mcp_plan_expired');
            }
        }
    }

    /** @description 创建不含输入、结果和连接信息的调用审计记录。 */
    private _createRecentCall(definition: IMcpCapabilityDefinition, status: McpHubCallStatus): IMcpHubRecentCallRecord {
        const record: IMcpHubRecentCallRecord = {
            id: toHex(randomBytes(8)),
            name: definition.name,
            category: definition.category,
            risk: definition.risk,
            status,
            requestedAt: Date.now(),
            completedAt: null,
            durationMs: null,
            errorCode: null,
        };
        this._recentCalls.unshift(record);
        if (this._recentCalls.length > MAX_RECENT_CALLS) {
            this._recentCalls.length = MAX_RECENT_CALLS;
        }
        return record;
    }

    /** @description 更新尚未完成的调用审计阶段。 */
    private _updateRecentCallStatus(auditId: string, status: McpHubCallStatus): void {
        const record = this._recentCalls.find((candidate) => candidate.id === auditId);
        if (record != null && record.completedAt == null) {
            record.status = status;
        }
    }

    /** @description 将调用审计记录标记为终态，不保存 capability 的原始错误内容。 */
    private _completeRecentCall(
        auditId: string,
        status: Extract<McpHubCallStatus, 'succeeded' | 'failed' | 'rejected' | 'expired'>,
        errorCode: string | null = null,
    ): void {
        const record = this._recentCalls.find((candidate) => candidate.id === auditId);
        if (record == null || record.completedAt != null) {
            return;
        }
        const completedAt = Date.now();
        record.status = status;
        record.completedAt = completedAt;
        record.durationMs = completedAt - record.requestedAt;
        record.errorCode = errorCode;
    }


    /**
     * @description 从磁盘重新加载 MCP 设置并应用到当前 registry。
     * @returns 应用后的 Hub 状态摘要。
     */
    private async _reloadSettingsFromDisk(): Promise<IMcpHubStatus> {
        const previousWriteEnabledPluginIds = [...this._writeEnabledPluginIds];
        const previousDisabledPluginIds = [...this._disabledPluginIds];
        const settings = this._readSettings();
        this._preferredPort = settings.preferredPort;
        this._disabledPluginIds.clear();
        this._writeEnabledPluginIds.clear();
        for (const pluginId of settings.disabledPluginIds) {
            this._disabledPluginIds.add(pluginId);
        }
        for (const pluginId of settings.writeEnabledPluginIds) {
            this._writeEnabledPluginIds.add(pluginId);
        }
        this._directWriteEnabled = settings.directWriteEnabled;
        if (settings.isEnabled !== this._isEnabled) {
            await this.setEnabled(settings.isEnabled);
        } else {
            const pluginManager = this._requirePluginManager();
            this.applyPluginExposureSettings(pluginManager);
            const registry = pluginManager.getMcpCapabilityRegistry();
            for (const pluginId of previousWriteEnabledPluginIds) {
                if (!this._writeEnabledPluginIds.has(pluginId) && !this._disabledPluginIds.has(pluginId)) {
                    registry.setPluginExposure(pluginId, 'read_only');
                }
            }
            for (const pluginId of previousDisabledPluginIds) {
                if (!this._disabledPluginIds.has(pluginId) && !this._writeEnabledPluginIds.has(pluginId)) {
                    registry.setPluginExposure(pluginId, 'read_only');
                }
            }
        }
        return this.getStatus();
    }


    /**
     * @description 晚绑定 Lite 本地审批租约镜像（不自动免审；仅双写租约存储）。
     * @param mirror 镜像函数；传 null 清除。
     */
    public setLocalApprovalLeaseMirror(
        mirror: ICocosMcpHubOptions['mirrorLocalApprovalLease'] | null,
    ): void {
        this._localApprovalLeaseMirror = mirror;
    }


    /**
     * @description 将 Hub 已签发 token 顺带写入 Lite 本地租约存储（若已绑定镜像）。
     * @param connectionId 连接。
     * @param resources 资源。
     * @param operations 操作白名单。
     * @param maxRisk 风险。
     * @param hubToken Hub BatchStore token（作为 preferredToken）。
     * @param idleLeaseMs 可选空闲租约。
     * @param maxHoldMs 可选最长持有。
     * @returns Lite token；未绑定或失败时返回 null。
     */
    private _mirrorLocalApprovalLease(
        connectionId: string,
        resources: readonly string[],
        operations: readonly string[] | undefined,
        maxRisk: 'write' | 'destructive',
        hubToken: string,
        idleLeaseMs?: number,
        maxHoldMs?: number,
        sessionBound?: boolean,
    ): string | null {
        const mirror = this._localApprovalLeaseMirror ?? this._options.mirrorLocalApprovalLease;
        if (mirror == null) {
            return null;
        }
        try {
            const issued = mirror({
                connectionId,
                resources,
                operations,
                maxRisk,
                preferredToken: hubToken,
                // Prefer resolved durations from BatchStore so sessionBound (5m/30m) stays in sync.
                ...(idleLeaseMs == null ? {} : { idleLeaseMs }),
                ...(maxHoldMs == null ? {} : { maxHoldMs }),
                ...(sessionBound === true && idleLeaseMs == null && maxHoldMs == null
                    ? { sessionBound: true }
                    : {}),
            });
            return issued != null && typeof issued.token === 'string' && issued.token.length > 0
                ? issued.token
                : null;
        } catch {
            return null;
        }
    }

    private _issueApprovalToken(
        connectionId: string,
        payload: Record<string, unknown>,
    ): { readonly approvalToken: string; readonly approvalId: string; readonly expiresAt: number; readonly idleLeaseMs: number; readonly liteMirrored: boolean } {
        if (!Array.isArray(payload.resources)) {
            throw new Error('cocos_mcp_approval_resources_required');
        }
        const resources = payload.resources.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
        );
        const operations = Array.isArray(payload.operations)
            ? payload.operations.filter(
                  (item): item is string => typeof item === 'string' && item.trim().length > 0,
              )
            : undefined;
        const idleLeaseMs =
            typeof payload.idleLeaseMs === 'number' && Number.isFinite(payload.idleLeaseMs)
                ? payload.idleLeaseMs
                : undefined;
        const maxHoldMs =
            typeof payload.maxHoldMs === 'number' && Number.isFinite(payload.maxHoldMs)
                ? payload.maxHoldMs
                : undefined;
        const maxRisk = payload.maxRisk === 'destructive' ? 'destructive' : 'write';
        const issued = this._batchApprovals.issue({
            connectionId,
            resources,
            operations,
            maxRisk,
            sessionBound: payload.sessionBound === true,
            ...(idleLeaseMs == null ? {} : { idleLeaseMs }),
            ...(maxHoldMs == null ? {} : { maxHoldMs }),
        });
        const approvalId = this._mirrorLocalApprovalLease(
            connectionId,
            resources,
            operations,
            maxRisk,
            issued.token,
            issued.idleLeaseMs,
            issued.maxHoldMs,
            payload.sessionBound === true,
        );
        return {
            approvalToken: issued.token,
            approvalId: approvalId ?? issued.token,
            expiresAt: issued.expiresAt,
            idleLeaseMs: issued.idleLeaseMs,
            liteMirrored: approvalId != null,
        };
    }


    /** @description 返回当前活跃 plugin-manager；内核暂不可用时拒绝请求。 */
    private _requirePluginManager(): PluginManagerApp {
        const pluginManager = this._pluginManagerProvider();
        if (pluginManager == null) {
            throw new Error('cocos_mcp_plugin_manager_unavailable');
        }
        return pluginManager;
    }
}
