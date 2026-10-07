import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'http';
import { request as httpsRequest } from 'https';

import type { IPluginNetworkRequest, IPluginNetworkResponse } from '../shared/plugin-manager-contracts.js';

/**
 * @description 宿主提供的受控网络传输接口，用于隔离不同 Creator/Electron 运行时的网络实现。
 */
export interface IPluginNetworkTransport {
    /**
     * @description 发起一个已由调用方完成权限校验的只读网络请求。
     * @param request 网络请求参数
     * @returns 最小化网络响应
     */
    fetch(request: IPluginNetworkRequest): Promise<IPluginNetworkResponse>;
}

/**
 * @description 使用 Node `http`/`https` 的兼容网络传输，避免依赖不同 Editor 内嵌运行时是否提供 Fetch。
 */
export class CompatiblePluginNetworkTransport implements IPluginNetworkTransport {
    /**
     * @description 发起只读 GET 请求。
     * @param request 网络请求参数
     * @returns 最小化网络响应
     */
    public async fetch(request: IPluginNetworkRequest): Promise<IPluginNetworkResponse> {
        const targetUrl = new URL(request.url);
        if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
            throw new Error(`plugin_network_protocol_unsupported:${targetUrl.protocol}`);
        }

        return new Promise<IPluginNetworkResponse>((resolve, reject): void => {
            const requestOptions: RequestOptions = {
                method: 'GET',
                headers: request.headers,
            };
            const requestFunction = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
            const clientRequest = requestFunction(targetUrl, requestOptions, (response): void => {
                this._readResponse(response, resolve, reject);
            });
            clientRequest.once('error', (): void => reject(new Error('plugin_network_request_failed')));
            clientRequest.end();
        });
    }

    /**
     * @description 读取 Node HTTP 响应并转换为插件可用的最小响应视图。
     * @param response Node HTTP 响应
     * @param resolve 成功回调
     * @param reject 失败回调
     * @returns 无返回值
     */
    private _readResponse(
        response: IncomingMessage,
        resolve: (value: IPluginNetworkResponse) => void,
        reject: (reason: Error) => void,
    ): void {
        const chunks: ReturnType<typeof Buffer.from>[] = [];
        response.on('data', (chunk: Uint8Array): void => {
            chunks.push(Buffer.from(chunk));
        });
        response.once('error', (): void => reject(new Error('plugin_network_response_failed')));
        response.once('end', (): void => {
            const content = Buffer.concat(chunks);
            const status = response.statusCode ?? 0;
            resolve({
                ok: status >= 200 && status < 300,
                status,
                json: async (): Promise<unknown> => JSON.parse(content.toString('utf8')),
                arrayBuffer: async (): Promise<ArrayBuffer> => {
                    const snapshot = new Uint8Array(content.byteLength);
                    snapshot.set(content);
                    return snapshot.buffer;
                },
            });
        });
    }
}
