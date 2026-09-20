import type { IMcpCapabilityDefinition, IMcpFailureDetails, McpCapabilityRisk } from '@peanut/pod-protocol';

import type { IMcpCapabilityProgress, McpPluginExposureMode } from './mcp-capability-registry.js';
import { McpFailurePresenter } from './mcp-failure-presenter.js';

/**
 * @description 校验并规范化来自 MCP loopback 边界的未受信输入。
 */
export class CocosMcpInputReader {
    /**
     * @description 将未知 capability 错误收窄为可安全展示的稳定错误码。
     */
    public toSafeErrorCode(error: unknown): string {
        return McpFailurePresenter.present(error).code;
    }

    /**
     * @description 将未知 capability 错误收窄为结构化安全失败详情。
     * @param error 未受信异常。
     * @returns 可安全返回给 MCP 调用方的失败详情。
     */
    public toSafeFailure(error: unknown): IMcpFailureDetails {
        return McpFailurePresenter.present(error);
    }

    /**
     * @description 校验 capability 上报的 progress。
     * @param value capability 提供的进度事件
     * @returns 可安全序列化的进度事件
     */
    public readProgress(value: IMcpCapabilityProgress): IMcpCapabilityProgress {
        if (!Number.isFinite(value.progress) || value.progress < 0) {
            throw new Error('cocos_mcp_progress_invalid');
        }
        if (value.total !== undefined && (!Number.isFinite(value.total) || value.total < value.progress)) {
            throw new Error('cocos_mcp_progress_invalid');
        }
        if (value.message !== undefined && typeof value.message !== 'string') {
            throw new Error('cocos_mcp_progress_invalid');
        }
        return value.total === undefined && value.message === undefined
            ? { progress: value.progress }
            : value.total === undefined
              ? { progress: value.progress, message: value.message }
              : value.message === undefined
                ? { progress: value.progress, total: value.total }
                : { progress: value.progress, total: value.total, message: value.message };
    }

    /**
     * @description 读取插件标识。
     */
    public readPluginId(value: unknown): string {
        if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{1,127}$/u.test(value)) {
            throw new Error('cocos_mcp_plugin_id_invalid');
        }
        return value;
    }

    /**
     * @description 读取插件公开级别。
     */
    public readExposureMode(value: unknown): McpPluginExposureMode {
        if (value === 'disabled' || value === 'read_only' || value === 'all') {
            return value;
        }
        throw new Error('cocos_mcp_plugin_exposure_invalid');
    }

    /**
     * @description 读取 capability 名称。
     */
    public readName(value: unknown): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('cocos_mcp_capability_name_invalid');
        }
        return value;
    }

    /**
     * @description 读取 bridge 连接标识。
     */
    public readConnectionId(value: unknown): string {
        if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
            throw new Error('cocos_mcp_connection_id_invalid');
        }
        return value;
    }

    /**
     * @description 读取可选 invocation ID。
     */
    public readOptionalInvocationId(value: unknown): string | null {
        return value === undefined ? null : this.readInvocationId(value);
    }

    /**
     * @description 读取 invocation ID。
     */
    public readInvocationId(value: unknown): string {
        if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
            throw new Error('cocos_mcp_invocation_id_invalid');
        }
        return value;
    }

    /**
     * @description 读取计划标识。
     */
    public readPlanId(value: unknown): string {
        if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
            throw new Error('cocos_mcp_plan_id_invalid');
        }
        return value;
    }

    /** @description 读取受管任务标识，不对其内部命名格式作业务推断。 */
    public readTaskId(value: unknown): string {
        if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
            throw new Error('cocos_mcp_task_id_invalid');
        }
        return value;
    }

    /**
     * @description 解析调用风险；覆盖导入视为 destructive。
     * @param definition capability 定义
     * @param input 调用输入
     * @returns 实际风险
     */
    public resolveCallRisk(definition: IMcpCapabilityDefinition, input: unknown): McpCapabilityRisk {
        if (definition.name.endsWith('.asset-import') && CocosMcpInputReader._isRecord(input)) {
            const overwrite: unknown = Reflect.get(input, 'overwrite');
            const mode: unknown = Reflect.get(input, 'mode');
            if (overwrite === true || mode === 'override') {
                return 'destructive';
            }
        }
        return definition.risk;
    }

    /**
     * @description 从输入读取可选 approvalToken。
     */
    public readOptionalApprovalToken(input: unknown): string | undefined {
        if (!CocosMcpInputReader._isRecord(input)) {
            return undefined;
        }
        const token: unknown = Reflect.get(input, 'approvalToken');
        return typeof token === 'string' && token.trim().length > 0 ? token.trim() : undefined;
    }

    /**
     * @description 读取必填 approvalToken。
     */
    public readApprovalToken(value: unknown): string {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('cocos_mcp_approval_token_invalid');
        }
        return value.trim();
    }

    /**
     * @description 从输入读取并规范化资源列表。
     * @param input 调用输入
     * @returns 资源列表
     */
    public readOptionalResources(input: unknown): readonly string[] {
        if (!CocosMcpInputReader._isRecord(input)) {
            return [];
        }
        const collected: string[] = [];
        for (const key of CocosMcpInputReader._resourceKeys) {
            this._collectResourceValue(Reflect.get(input, key), collected);
        }
        const normalized = new Set<string>();
        for (const item of collected) {
            const trimmed = item.replace(/\\/gu, '/');
            if (trimmed.length === 0) {
                continue;
            }
            normalized.add(trimmed === 'assets' || trimmed.startsWith('assets/') ? `db://${trimmed}` : trimmed);
        }
        return [...normalized];
    }

    /**
     * @description 读取破坏性确认标记。
     */
    public readConfirmDestructive(input: unknown): boolean {
        return CocosMcpInputReader._isRecord(input) && Reflect.get(input, 'confirmDestructive') === true;
    }

    /**
     * @description 可能携带资源标识的业务字段。
     */
    private static readonly _resourceKeys = [
        'resources', 'paths', 'sources', 'targets', 'dbPaths', 'files', 'path', 'from', 'to', 'target',
        'targetDirectory', 'uuid', 'url', 'fromUuid', 'toUuid', 'prefabRelativePath', 'assetRelativePath',
        'imagePath', 'scenePath', 'prefabPath', 'parentPath', 'scriptRelativePath',
    ] as const;

    /**
     * @description 收集单值、数组与带 path 字段的资源输入。
     */
    private _collectResourceValue(value: unknown, collected: string[]): void {
        if (typeof value === 'string' && value.trim().length > 0) {
            collected.push(value.trim());
            return;
        }
        if (!Array.isArray(value)) {
            return;
        }
        for (const item of value) {
            if (typeof item === 'string' && item.trim().length > 0) {
                collected.push(item.trim());
            } else if (CocosMcpInputReader._isRecord(item)) {
                this._collectResourceValue(Reflect.get(item, 'path'), collected);
            }
        }
    }

    /**
     * @description 判断未知值是否为普通记录。
     */
    private static _isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}
