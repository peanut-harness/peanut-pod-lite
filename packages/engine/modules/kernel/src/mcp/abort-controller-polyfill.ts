import { PolyfillAbortSignal } from './polyfill-abort-signal.js';

/**
 * @description Creator 3.8.x 部分 Electron 主进程未暴露 AbortController；Hub 请求取消依赖它。
 * 在缺省时安装最小可用 polyfill，避免 `_handleRequest` 抛错后挂死连接。
 */

/**
 * @description 若 `globalThis.AbortController` 缺失则挂上 polyfill。
 * @returns 无返回值
 */
export function ensureAbortControllerPolyfill(): void {
    const host = globalThis as typeof globalThis & {
        AbortController?: typeof AbortController;
        AbortSignal?: typeof AbortSignal;
    };
    if (typeof host.AbortController === 'function') {
        return;
    }

    class PolyfillAbortController {
        /** @description 关联 signal。 */
        public readonly signal = new PolyfillAbortSignal();

        /**
         * @description 取消。
         * @param reason 原因
         * @returns 无返回值
         */
        public abort(reason?: unknown): void {
            this.signal.abort(reason);
        }
    }

    host.AbortController = PolyfillAbortController as unknown as typeof AbortController;
    host.AbortSignal = PolyfillAbortSignal as unknown as typeof AbortSignal;
}
