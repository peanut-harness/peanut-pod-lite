import type { IMcpCapabilityCatalog, IMcpCapabilityDefinition, LocalizedText } from '@peanut/pod-protocol';
import type { IMcpCapabilityInvocation, IMcpCapabilityProgress, McpCapabilityHandler } from '@peanut/pod-sdk';

import { isMcpControlFlowRefusal } from './mcp-control-flow-refusal.js';
import { McpFailurePresenter } from './mcp-failure-presenter.js';

export type { IMcpCapabilityInvocation, IMcpCapabilityProgress, McpCapabilityHandler } from '@peanut/pod-sdk';

/** @description 插件 MCP capability 面向外部 Hub 的公开级别。 */
export type McpPluginExposureMode = 'disabled' | 'read_only' | 'all';

interface IMcpCapabilityRegistration {
    /** @description capability 所属插件。 */
    readonly pluginId: string;
    /** @description 对外公开的稳定定义。 */
    readonly definition: IMcpCapabilityDefinition;
    /** @description 通过宿主边界执行的处理函数。 */
    readonly handler: McpCapabilityHandler;
}

/**
 * @description 已激活插件的 MCP capability 注册中心；负责目录、schema 校验和生命周期撤销。
 */
export class McpCapabilityRegistry {
    private readonly _reporter?: (pluginId: string, error: unknown, context: Record<string, unknown>) => void;
    /** @description 按全局工具名称保存活动注册。 */
    private readonly _registrations = new Map<string, IMcpCapabilityRegistration>();
    /**
     * @description 已保持运行但不向 MCP Hub 公开能力的插件标识。
     */
    private readonly _disabledPluginIds = new Set<string>();
    /** @description 已允许公开写 capability 的插件标识；未显式允许时仅公开只读 capability。 */
    private readonly _writeEnabledPluginIds = new Set<string>();
    /** @description 每次目录变化时递增，用于 bridge 刷新工具列表。 */
    private _revision = 0;

    /** @param reporter MCP capability 异常诊断回调。 */
    public constructor(reporter?: (pluginId: string, error: unknown, context: Record<string, unknown>) => void) { this._reporter = reporter; }

    /**
     * @description 注册一个当前激活插件公开的 MCP capability。
     * @param pluginId 当前激活插件标识。
     * @param definition 可公开的 capability 定义。
     * @param handler 已验证输入的处理函数。
     * @returns 用于提前注销当前 capability 的清理函数。
     */
    public register(pluginId: string, definition: IMcpCapabilityDefinition, handler: McpCapabilityHandler): () => void {
        this._assertDefinition(pluginId, definition);
        if (this._registrations.has(definition.name)) {
            throw new Error(`mcp_capability_name_conflict:${definition.name}`);
        }
        const registration: IMcpCapabilityRegistration = { pluginId, definition, handler };
        this._registrations.set(definition.name, registration);
        this._revision += 1;
        let isDisposed = false;
        return (): void => {
            if (isDisposed || this._registrations.get(definition.name) !== registration) {
                return;
            }
            isDisposed = true;
            this._registrations.delete(definition.name);
            this._revision += 1;
        };
    }

    /**
     * @description 撤销指定插件当前注册的全部 MCP capability。
     * @param pluginId 要撤销的插件标识。
     * @returns 无返回值。
     */
    public revokePlugin(pluginId: string): void {
        const wasEnabled = !this._disabledPluginIds.has(pluginId);
        let hasChanges = false;
        for (const [name, registration] of this._registrations) {
            if (registration.pluginId === pluginId) {
                this._registrations.delete(name);
                hasChanges = true;
            }
        }
        if (hasChanges && wasEnabled) {
            this._revision += 1;
        }
    }

    /**
     * @description 设置插件 MCP capability 是否可向统一 Hub 公开。
     * @param pluginId 目标插件标识。
     * @param isEnabled 是否公开该插件已注册和后续注册的 capability。
     * @returns 无返回值。
     */
    public setPluginEnabled(pluginId: string, isEnabled: boolean): void {
        this.setPluginExposure(pluginId, isEnabled ? 'all' : 'disabled');
    }

    /**
     * @description 设置插件 capability 面向 MCP Hub 的公开级别。
     * @param pluginId 目标插件标识。
     * @param mode 关闭、仅只读或全部公开。
     * @returns 无返回值。
     */
    public setPluginExposure(pluginId: string, mode: McpPluginExposureMode): void {
        this._assertPluginId(pluginId);
        const previousMode = this.getPluginExposure(pluginId);
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
        if ([...this._registrations.values()].some((registration) => registration.pluginId === pluginId)) {
            this._revision += 1;
        }
    }

    /**
     * @description 返回指定插件的 MCP capability 是否允许公开。
     * @param pluginId 目标插件标识。
     * @returns 允许向 MCP Hub 公开时返回 `true`。
     */
    public isPluginEnabled(pluginId: string): boolean {
        this._assertPluginId(pluginId);
        return !this._disabledPluginIds.has(pluginId);
    }

    /**
     * @description 返回插件当前的 MCP 公开级别；未显式配置时默认仅公开只读 capability。
     * @param pluginId 目标插件标识。
     * @returns 当前公开级别。
     */
    public getPluginExposure(pluginId: string): McpPluginExposureMode {
        this._assertPluginId(pluginId);
        if (this._disabledPluginIds.has(pluginId)) {
            return 'disabled';
        }
        return this._writeEnabledPluginIds.has(pluginId) ? 'all' : 'read_only';
    }

    /** @description 返回已显式允许公开写 capability 的插件标识。 */
    public getWriteEnabledPluginIds(): readonly string[] {
        return [...this._writeEnabledPluginIds].sort((left, right) => left.localeCompare(right));
    }

    /**
     * @description 返回当前项目中已禁止 MCP capability 公开的插件标识。
     * @returns 按字典序排列的插件标识。
     */
    public getDisabledPluginIds(): readonly string[] {
        return [...this._disabledPluginIds].sort((left, right) => left.localeCompare(right));
    }

    /**
     * @description 返回当前统一 MCP Hub 可发现的 capability 目录。
     * @returns 带单调递增版本的稳定 capability 快照。
     */
    public getCatalog(): IMcpCapabilityCatalog {
        return {
            revision: this._revision,
            capabilities: [...this._registrations.values()]
                .filter((registration) => this._isRegistrationExposed(registration))
                .map((registration) => registration.definition)
                .sort((left, right) => left.name.localeCompare(right.name)),
        };
    }

    /**
     * @description 查询单项 capability 定义。
     * @param name 全局工具名称。
     * @returns 已注册定义；未注册时为 `null`。
     */
    public getDefinition(name: string): IMcpCapabilityDefinition | null {
        const registration = this._registrations.get(name);
        return registration == null || !this._isRegistrationExposed(registration) ? null : registration.definition;
    }

    /**
     * @description 校验未受信输入是否满足 Hub 当前公开的 capability 的参数 schema。
     * @param name 全局工具名称。
     * @param input 未受信的 MCP 输入。
     * @returns 无返回值；校验失败时抛出稳定错误。
     */
    public validateInput(name: string, input: unknown): void {
        const registration = this._requireExposedRegistration(name);
        this._assertInputMatches(registration, name, input);
    }

    /**
     * @description 校验调用输入后执行一个对 Hub 公开的 capability。
     * @param name 全局工具名称。
     * @param input 未受信的 MCP 输入。
     * @param invocation 当前 bridge 调用关联信息。
     * @returns capability 的结构化结果。
     */
    public async invoke(name: string, input: unknown, invocation: IMcpCapabilityInvocation): Promise<unknown> {
        const registration = this._requireExposedRegistration(name);
        this._assertInputMatches(registration, name, input);
        return this._runHandler(registration, name, input, invocation);
    }

    /**
     * @description 已激活插件互调：执行已注册 capability，忽略 Hub 公开级别与写审批。
     * @param callerPluginId 调用方插件标识，由宿主注入。
     * @param name 全局工具名称。
     * @param input 未受信输入。
     * @returns capability 的结构化结果。
     */
    public async invokeForPlugin(callerPluginId: string, name: string, input: unknown): Promise<unknown> {
        this._assertPluginId(callerPluginId);
        const registration = this._registrations.get(name);
        if (registration == null) {
            throw new Error(`mcp_capability_unregistered:${name}`);
        }
        this._assertInputMatches(registration, name, input);
        return this._runHandler(registration, name, input, {
            connectionId: `plugin:${callerPluginId}`,
            callerPluginId,
        });
    }

    /**
     * @description 要求 capability 已注册且对当前 Hub 公开。
     * @param name 全局工具名称。
     * @returns 注册项
     */
    private _requireExposedRegistration(name: string): IMcpCapabilityRegistration {
        const registration = this._registrations.get(name);
        if (registration == null || !this._isRegistrationExposed(registration)) {
            throw new Error(`mcp_capability_unavailable:${name}`);
        }
        return registration;
    }

    /**
     * @description 按注册表 inputSchema 校验输入。
     * @param registration 注册项
     * @param name 工具名
     * @param input 未受信输入
     * @returns 无返回值
     */
    private _assertInputMatches(registration: IMcpCapabilityRegistration, name: string, input: unknown): void {
        if (!this._matchesSchema(input, registration.definition.inputSchema)) {
            throw new Error(`mcp_capability_input_invalid:${name}`);
        }
    }

    /**
     * @description 执行 handler 并校验可选 outputSchema。
     * @param registration 注册项
     * @param name 工具名
     * @param input 已通过 schema 的输入
     * @param invocation 调用上下文
     * @returns handler 结果
     */
    private async _runHandler(
        registration: IMcpCapabilityRegistration,
        name: string,
        input: unknown,
        invocation: IMcpCapabilityInvocation,
    ): Promise<unknown> {
        let output: unknown;
        try {
            output = await registration.handler(this._asHandlerInput(input), invocation);
        } catch (error) {
            // Expected gate/policy refusal: Hub gets structured ok:false; do not console.error via diagnostic.
            if (!isMcpControlFlowRefusal(error) && !McpFailurePresenter.hasStructuredFailure(error)) {
                this._reporter?.(registration.pluginId, error, {
                    capability: name,
                    connectionId: invocation.connectionId,
                    callerPluginId: invocation.callerPluginId,
                });
            }
            throw error;
        }
        if (registration.definition.outputSchema != null && !this._matchesSchema(output, registration.definition.outputSchema)) {
            throw new Error(`mcp_capability_output_invalid:${name}`);
        }
        return output;
    }

    /**
     * @description 将已通过 object schema 的输入交给 handler。
     * @param input 已校验输入
     * @returns 记录对象
     */
    private _asHandlerInput(input: unknown): Record<string, unknown> {
        if (typeof input !== 'object' || input == null || Array.isArray(input)) {
            throw new Error('mcp_capability_input_invalid:not_object');
        }
        const record: Record<string, unknown> = Object.create(null);
        for (const key of Object.keys(input)) {
            record[key] = Reflect.get(input, key);
        }
        return record;
    }

    /** @description 验证注册定义不会扩大插件或 Host 的能力边界。 */
    private _assertDefinition(pluginId: string, definition: IMcpCapabilityDefinition): void {
        if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(pluginId) || !definition.name.startsWith(`${pluginId}.`)) {
            throw new Error('mcp_capability_name_not_plugin_scoped');
        }
        if (!isValidLocalizedText(definition.description) || !['cocos', 'atom', 'workflow'].includes(definition.category) || definition.risk === 'read' !== definition.readOnly) {
            throw new Error(`mcp_capability_definition_invalid:${definition.name}`);
        }
        if (!this._isSchema(definition.inputSchema) || definition.outputSchema != null && !this._isSchema(definition.outputSchema)) {
            throw new Error(`mcp_capability_schema_invalid:${definition.name}`);
        }
        if (definition.aiHandling != null && !this._isAiHandlingGuidance(definition.aiHandling)) {
            throw new Error(`mcp_capability_ai_handling_invalid:${definition.name}`);
        }
    }

    /**
     * @description 校验插件标识满足 MCP capability 命名作用域。
     */
    private _assertPluginId(pluginId: string): void {
        if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(pluginId)) {
            throw new Error('mcp_capability_plugin_id_invalid');
        }
    }

    /** @description 判断活动注册是否符合所属插件当前公开级别。 */
    private _isRegistrationExposed(registration: IMcpCapabilityRegistration): boolean {
        const exposure = this.getPluginExposure(registration.pluginId);
        return exposure === 'all' || exposure === 'read_only' && registration.definition.readOnly;
    }

    /** @description 验证公开 JSON Schema 仅使用受支持的安全子集。 */
    private _isSchema(value: unknown): value is IMcpCapabilityDefinition['inputSchema'] {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            return false;
        }
        const schema = value as Record<string, unknown>;
        if (!['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(schema.type as string)) {
            return false;
        }
        return true;
    }

    /**
     * @description 验证公开给 AI 的调用处理规则使用受支持的稳定协议。
     */
    private _isAiHandlingGuidance(value: unknown): value is NonNullable<IMcpCapabilityDefinition['aiHandling']> {
        if (typeof value !== 'object' || value == null || Array.isArray(value)) {
            return false;
        }
        const guidance = value as Record<string, unknown>;
        return guidance.schemaVersion === 1
            && Array.isArray(guidance.successSignals)
            && guidance.successSignals.length > 0
            && guidance.successSignals.every((signal) => typeof signal === 'string' && signal.trim().length > 0)
            && guidance.failureField === 'failure'
            && guidance.unknownStateAction === 'query_before_retry'
            && guidance.blindRetryAllowed === false;
    }

    /** @description 按受支持的 JSON Schema 子集收窄外部输入。 */
    private _matchesSchema(value: unknown, schema: IMcpCapabilityDefinition['inputSchema']): boolean {
        if (schema.type === 'object') {
            if (typeof value !== 'object' || value == null || Array.isArray(value)) {
                return false;
            }
            const record = value as Record<string, unknown>;
            const properties = schema.properties ?? {};
            if ((schema.required ?? []).some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
                return false;
            }
            if (schema.additionalProperties !== true && Object.keys(record).some((key) => properties[key] == null)) {
                return false;
            }
            return Object.entries(properties).every(([key, propertySchema]) => !Object.prototype.hasOwnProperty.call(record, key) || this._matchesSchema(record[key], propertySchema));
        }
        if (schema.type === 'array') {
            return Array.isArray(value) && (schema.items == null || value.every((item) => this._matchesSchema(item, schema.items!)));
        }
        if (schema.type === 'string') {
            return typeof value === 'string' && (schema.enum == null || schema.enum.includes(value));
        }
        if (schema.type === 'boolean') {
            return typeof value === 'boolean';
        }
        return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value));
    }
}

/**
 * @description 验证 description 使用旧字符串格式或完整中英文映射，避免注册空白说明。
 * @param value 待验证的说明文本。
 * @returns 是否为可展示的说明文本。
 */
function isValidLocalizedText(value: LocalizedText): boolean {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    return value['en-US'].trim().length > 0 && value['zh-CN'].trim().length > 0;
}
