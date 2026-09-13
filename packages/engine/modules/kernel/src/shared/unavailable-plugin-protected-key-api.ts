import type { IPluginProtectedKeyApi } from './plugin-manager-contracts.js';

/**
 * @description 在宿主尚未配置 Keychain/Credential Manager 时明确拒绝密钥请求的实现。
 */
export class UnavailablePluginProtectedKeyApi implements IPluginProtectedKeyApi {
    /**
     * @description 拒绝创建或读取 HMAC 密钥，避免任何能力回退到普通插件存储。
     * @param _purpose 逻辑密钥用途。
     * @returns 永不成功的 Promise。
     */
    public async getOrCreateHmacSha256Key(_purpose: string): Promise<CryptoKey> {
        throw new Error('plugin_protected_key_unavailable');
    }
}
