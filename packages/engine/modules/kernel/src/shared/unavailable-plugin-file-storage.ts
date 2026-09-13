import type { IPluginCacheEntry } from '@peanut/pod-engine/installation';

import type { IPluginFileStorageApi } from './plugin-manager-contracts.js';

/**
 * @description 未配置项目文件仓时返回明确错误的插件文件存储客户端。
 */
export class UnavailablePluginFileStorage implements IPluginFileStorageApi {
    /**
     * @description 返回项目文件仓未配置错误。
     */
    private _unavailable(): never { throw new Error('plugin_file_storage_unavailable'); }
    /**
     * @description 返回 cache scope 内逻辑路径的宿主描述路径。
     */
    public async describe(_scope: 'cache', _relativePath?: string): Promise<string> { return this._unavailable(); }
    /**
     * @description 在 cache scope 内创建目录。
     */
    public async mkdir(_scope: 'cache', _relativePath: string): Promise<void> { return this._unavailable(); }
    /**
     * @description 从 cache scope 内读取二进制文件。
     */
    public async read(_scope: 'cache', _relativePath: string): Promise<Uint8Array | null> { return this._unavailable(); }
    /**
     * @description 向 cache scope 内原子写入二进制文件。
     */
    public async write(_scope: 'cache', _relativePath: string, _content: Uint8Array): Promise<void> { return this._unavailable(); }
    /**
     * @description 列出 cache scope 内条目。
     */
    public async list(_scope: 'cache', _relativePath?: string): Promise<readonly IPluginCacheEntry[]> { return this._unavailable(); }
    /**
     * @description 删除 cache scope 内文件或目录。
     */
    public async remove(_scope: 'cache', _relativePath: string): Promise<boolean> { return this._unavailable(); }
    /**
     * @description 读取当前插件 local settings。
     */
    public async getLocalSettings(): Promise<Readonly<Record<string, unknown>>> { return this._unavailable(); }
    /**
     * @description 原子替换当前插件 local settings。
     */
    public async setLocalSettings(_settings: Readonly<Record<string, unknown>>): Promise<void> { return this._unavailable(); }
    /**
     * @description 深层合并当前插件 local settings，`null` 删除字段。
     */
    public async mergeLocalSettings(_patch: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> { return this._unavailable(); }
}
