/**
 * @description Creator 旧 Electron 环境的最小 AbortSignal 实现。
 */
export class PolyfillAbortSignal {
    /**
     * @description 是否已 abort。
     */
    public aborted = false;

    /**
     * @description abort 原因。
     */
    public reason: unknown;

    /**
     * @description 监听器。
     */
    private readonly _listeners = new Set<() => void>();

    /**
     * @description 注册 abort 监听。
     * @param type 事件名
     * @param listener 回调
     * @returns 无返回值
     */
    public addEventListener(type: string, listener: () => void): void {
        if (type === 'abort') {
            this._listeners.add(listener);
        }
    }

    /**
     * @description 移除 abort 监听。
     * @param type 事件名
     * @param listener 回调
     * @returns 无返回值
     */
    public removeEventListener(type: string, listener: () => void): void {
        if (type === 'abort') {
            this._listeners.delete(listener);
        }
    }

    /**
     * @description 触发 abort。
     * @param reason 原因
     * @returns 无返回值
     */
    public abort(reason?: unknown): void {
        if (this.aborted) {
            return;
        }
        this.aborted = true;
        this.reason = reason;
        for (const listener of [...this._listeners]) {
            listener();
        }
    }
}
