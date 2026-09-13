import type { PluginConfig } from '@peanut/pod-engine/installation';

/**
 * @description 将插件提交的 settings 校验为可持久化 JSON 对象。
 */
export class PluginConfigReader {
    /**
     * @description 读取并校验插件 settings。
     * @param value 插件提交的未受信对象
     * @returns 可写入 packaging 文件仓的 JSON 配置
     */
    public static read(value: Readonly<Record<string, unknown>>): PluginConfig {
        if (!PluginConfigReader._isConfig(value)) {
            throw new Error('plugin_settings_not_json_object');
        }
        return value;
    }

    /**
     * @description 判断值是否为可序列化的 JSON 对象。
     * @param value 未受信输入
     * @returns 是否可作为 PluginConfig
     */
    private static _isConfig(value: unknown): value is PluginConfig {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && PluginConfigReader._isJsonValue(value);
    }

    /**
     * @description 递归判断值是否仅由 JSON 允许的原始值、数组和对象组成。
     * @param value 未受信输入
     * @returns 是否为 JSON 值
     */
    private static _isJsonValue(value: unknown): boolean {
        if (value === null || typeof value === 'boolean' || typeof value === 'string') {
            return true;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value);
        }
        if (Array.isArray(value)) {
            return value.every((item) => PluginConfigReader._isJsonValue(item));
        }
        if (typeof value !== 'object' || value == null) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return false;
        }
        return Object.values(value).every((item) => PluginConfigReader._isJsonValue(item));
    }
}
