import type { IPluginProtectedKeyApi } from './plugin-manager-contracts.js';
import type { IMacOsKeychainCommandRunner } from './macos-security-command-runner.js';

/**
 * @description Keychain 服务名。
 */
const keychainServiceName = 'peanut.cocos.mcp.hmac.v1';

/**
 * @description Keychain 未命中退出码。
 */
const keychainMissingItemExitCode = 44;

/**
 * @description 绑定单个插件的 macOS Keychain HMAC 密钥访问端口。
 */
export class MacOsKeychainPluginProtectedKeyApi implements IPluginProtectedKeyApi {
    /**
     * @description 调用方插件 id。
     */
    private readonly _pluginId: string;
    /**
     * @description 安全命令运行器。
     */
    private readonly _commandRunner: IMacOsKeychainCommandRunner;
    /**
     * @description 按用途缓存同一会话内已导入的不可导出密钥。
     */
    private readonly _keys = new Map<string, Promise<CryptoKey>>();

    /**
     * @description 创建插件专属 Keychain 端口。
     * @param pluginId 已验证调用方插件 id。
     * @param commandRunner 安全命令运行器。
     */
    public constructor(pluginId: string, commandRunner: IMacOsKeychainCommandRunner) {
        this._pluginId = pluginId;
        this._commandRunner = commandRunner;
    }

    /**
     * @description 读取或创建插件用途专属的不可导出 HMAC-SHA-256 密钥。
     * @param purpose 已验证逻辑用途。
     * @returns 仅可签名的不可导出 HMAC 密钥。
     */
    public async getOrCreateHmacSha256Key(purpose: string): Promise<CryptoKey> {
        if (!/^[a-z][a-z0-9-]{2,63}$/u.test(purpose)) {
            throw new Error('plugin_protected_key_purpose_invalid');
        }
        let pending = this._keys.get(purpose);
        if (pending == null) {
            pending = this._loadOrCreate(purpose);
            this._keys.set(purpose, pending);
        }
        return pending;
    }

    /**
     * @description 从 Keychain 加载或首次创建密钥并导入为不可导出 WebCrypto 密钥。
     * @param purpose 已验证用途。
     * @returns 不可导出 HMAC 密钥。
     */
    private async _loadOrCreate(purpose: string): Promise<CryptoKey> {
        const account = `${this._pluginId}:${purpose}`;
        let material = await this._find(account);
        if (material == null) {
            const generated = MacOsKeychainPluginProtectedKeyApi._encodeMaterial(globalThis.crypto.getRandomValues(new Uint8Array(32)));
            const added = await this._commandRunner.run(['add-generic-password', '-s', keychainServiceName, '-a', account, '-w', generated]);
            material = added.exitCode === 0 ? generated : await this._find(account);
            if (material == null) {
                throw new Error(`plugin_protected_key_keychain_write_failed:${added.exitCode}`);
            }
        }
        const keyMaterial = MacOsKeychainPluginProtectedKeyApi._decodeMaterial(material);
        const isolatedMaterial = new Uint8Array(keyMaterial.byteLength);
        isolatedMaterial.set(keyMaterial);
        return globalThis.crypto.subtle.importKey('raw', isolatedMaterial.buffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }

    /**
     * @description 从 Keychain 查询一条 base64 编码密钥记录。
     * @param account 插件和用途组成的 account 标识。
     * @returns 密钥文本；未找到时返回 null。
     */
    private async _find(account: string): Promise<string | null> {
        const result = await this._commandRunner.run(['find-generic-password', '-s', keychainServiceName, '-a', account, '-w']);
        if (result.exitCode === keychainMissingItemExitCode) {
            return null;
        }
        if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
            throw new Error(`plugin_protected_key_keychain_read_failed:${result.exitCode}`);
        }
        return result.stdout.trim();
    }

    /**
     * @description 将 Keychain 的 base64 文本解码为严格的 32 字节密钥材料。
     * @param value 未信任 Keychain 输出。
     * @returns 独立的密钥字节副本。
     */
    private static _decodeMaterial(value: string): Uint8Array {
        if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
            throw new Error('plugin_protected_key_keychain_material_invalid');
        }
        const decoded = atob(value);
        if (decoded.length !== 32) {
            throw new Error('plugin_protected_key_keychain_material_invalid');
        }
        const material = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            material[index] = decoded.charCodeAt(index);
        }
        return material;
    }

    /**
     * @description 将随机字节编码为 Keychain 可保存的 base64 文本。
     * @param value 随机密钥字节。
     * @returns base64 密钥文本。
     */
    private static _encodeMaterial(value: Uint8Array): string {
        let binary = '';
        for (const byte of value) {
            binary += String.fromCharCode(byte);
        }
        return btoa(binary);
    }
}
