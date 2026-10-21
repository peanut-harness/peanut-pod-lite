import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * @description 原有Hub插件档位设置，不包含精确挂接名单。
 */
export interface IMcpHubSettingsRecord {
    /**
     * @description 是否为当前项目启用 MCP Hub。
     */
    readonly isEnabled: boolean;
    /**
     * @description 本项目偏好的 loopback 端口；仅项目内粘滞，不得跨项目复用。
     */
    readonly preferredPort: number | null;
    /**
     * @description 保持插件运行但不公开其 MCP capability 的插件标识。
     */
    readonly disabledPluginIds: readonly string[];
    /**
     * @description 已明确授权公开写 capability 的插件标识。
     */
    readonly writeEnabledPluginIds: readonly string[];
    /**
     * @description 测试用：为 true 时写 capability 可经 `call` 直接执行，跳过 plan 审批。
     */
    readonly directWriteEnabled: boolean;
}

/**
 * @description 独立保存原有整体公开档位，避免挂接控制扩大Hub编排职责。
 */
export class McpHubSettingsFile {
    /**
     * @description 当前工程根。
     */
    private readonly _project: string;
    /**
     * @description 原设置文件位置。
     */
    private readonly _settingsPath: string;
    /**
     * @description 建立同一工程的设置读取入口。
     * @param project 当前工程根。
     */
    public constructor(project: string) {
        this._project = project; this._settingsPath = join(project, '.peanut-ai', 'cocos-mcp-settings.json');
    }
    /**
     * @description 读取安全默认值或实际项目设置。
     * @returns 原有公开档位设置。
     */
    public read(): IMcpHubSettingsRecord {
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
                    preferredPort: this._preferredPort(record.preferredPort),
                    disabledPluginIds: Array.isArray(record.disabledPluginIds)
                        ? record.disabledPluginIds.filter(
                            (pluginId): pluginId is string => typeof pluginId === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u.test(pluginId),
                          )
                        : [],
                    writeEnabledPluginIds: Array.isArray(record.writeEnabledPluginIds)
                        ? record.writeEnabledPluginIds.filter(
                            (pluginId): pluginId is string => typeof pluginId === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u.test(pluginId),
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
    /**
     * @description 原子保存原有设置，不修改精确名单。
     * @param record 当前设置。
     * @param sessionId 当前进程身份。
     */
    public write(record: IMcpHubSettingsRecord, sessionId: string): void {
        const projectPath = resolve(this._project);
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
        const temporaryPath = `${this._settingsPath}.${sessionId}.tmp`;
        writeFileSync(
            temporaryPath,
            JSON.stringify(
                {
                    isEnabled: record.isEnabled,
                    preferredPort: record.preferredPort,
                    disabledPluginIds: [...record.disabledPluginIds].sort((left, right) => left.localeCompare(right)),
                    writeEnabledPluginIds: [...record.writeEnabledPluginIds]
                        .filter((pluginId) => !record.disabledPluginIds.includes(pluginId))
                        .sort((left, right) => left.localeCompare(right)),
                    directWriteEnabled: record.directWriteEnabled,
                },
                null,
                2,
            ),
            'utf8',
        );
        renameSync(temporaryPath, this._settingsPath);
    }
    /**
     * @description 保留原有偏好端口合法性约束。
     * @param value 未受信端口。
     * @returns 合法端口或null。
     */
    private _preferredPort(value: unknown): number | null {
        return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
    }
}
