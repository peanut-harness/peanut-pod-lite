import { LumenAssetDbEditorRefreshAdapter } from './io/asset-db-refresh';
import { LumenSession } from './session';
import type { ILumenMessagePort, ILumenSessionOptions } from './types';

/**
 * @description 创建 Lumen 会话，并在组合入口注入可选的 Creator AssetDB 刷新能力。
 */
export class LumenSessionFactory {
    /**
     * @description 创建默认会话，编辑器刷新使用会话默认实现。
     * @param options 会话选项
     * @returns Lumen 会话
     */
    public static create(options: ILumenSessionOptions): LumenSession {
        return new LumenSession(options);
    }

    /**
     * @description 创建接入 AssetDB `refresh-asset` 的会话。
     * @param options 会话选项
     * @param message 可调用 `asset-db` 的消息端口
     * @returns Lumen 会话
     */
    public static createWithAssetDbRefresh(
        options: ILumenSessionOptions,
        message: ILumenMessagePort,
    ): LumenSession {
        return new LumenSession({
            ...options,
            editorRefresh: new LumenAssetDbEditorRefreshAdapter(message),
        });
    }
}
