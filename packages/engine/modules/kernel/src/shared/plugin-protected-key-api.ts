import type { IPluginProtectedKeyApi } from './plugin-manager-contracts.js';
import { MacOsKeychainPluginProtectedKeyApi } from './macos-keychain-plugin-protected-key-api.js';
import { MacOsSecurityCommandRunner, type IMacOsKeychainCommandRunner } from './macos-security-command-runner.js';

export type { IMacOsKeychainCommandRunner } from './macos-security-command-runner.js';
export { UnavailablePluginProtectedKeyApi } from './unavailable-plugin-protected-key-api.js';

/**
 * @description 为指定插件提供宿主安全存储密钥端口的工厂。
 */
export interface IPluginProtectedKeyProvider {
    /**
     * @description 返回仅属于一个已激活插件的受保护密钥端口。
     * @param pluginId 已由宿主验证的插件标识。
     * @returns 该插件的密钥端口。
     */
    forPlugin(pluginId: string): IPluginProtectedKeyApi;
}
/**
 * @description 使用 macOS 系统 Keychain 为每个插件提供隔离 HMAC 密钥的提供器。
 */
export class MacOsKeychainPluginProtectedKeyProvider implements IPluginProtectedKeyProvider {
    /** @description 安全命令运行器。 */
    private readonly commandRunner: IMacOsKeychainCommandRunner;

    /**
     * @description 创建 macOS Keychain 密钥提供器。
     * @param commandRunner 可替换命令运行器；默认调用系统 `security`。
     */
    public constructor(commandRunner: IMacOsKeychainCommandRunner = new MacOsSecurityCommandRunner()) {
        this.commandRunner = commandRunner;
    }

    /**
     * @description 返回一个绑定到特定插件的 Keychain 端口。
     * @param pluginId 已验证插件标识。
     * @returns 仅用于该插件的受保护密钥端口。
     */
    public forPlugin(pluginId: string): IPluginProtectedKeyApi {
        if (!/^[a-z][a-z0-9.-]{1,127}$/u.test(pluginId)) {
            throw new Error('plugin_protected_key_plugin_id_invalid');
        }
        return new MacOsKeychainPluginProtectedKeyApi(pluginId, this.commandRunner);
    }
}
