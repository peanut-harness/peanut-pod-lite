import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';

/**
 * @description 使用Creator实际预览连接状态刷新会话；开窗至多请求一次，未知状态不重开。
 */
export class EditorMcpPreviewSession {
    /**
     * @description 受信宿主的消息通道。
     */
    private readonly _message: NonNullable<IGrantedRuntimeClientSet['message']>;
    /**
     * @description 零连接时独立核对物理浏览器窗口；不可检查就保持未知。
     */
    private readonly _inspectWindow: () => Promise<'exists' | 'absent' | 'unknown'>;
    /**
     * @description 同一宿主会话已经请求过打开，避免启动延迟或失败导致重复开窗。
     */
    private _openRequested = false;
    /**
     * @description 曾观测到已连接预览；随后零连接可能是刷新中的断线，不能推断窗口已关闭。
     */
    private _observedConnected = false;
    /**
     * @description 窗口检查不可用后不反复触发系统权限请求；实际连接恢复后仍可刷新。
     */
    private _windowStateUnknown = false;
    /**
     * @description 串行化状态检查与开窗决定，阻止并发请求同时打开。
     */
    private _tail: Promise<void> = Promise.resolve();

    /**
     * @description 将会话状态绑定到当前宿主的实际消息客户端。
     * @param message 已授权消息客户端。
     * @param inspectWindow 独立只读窗口核对。
     */
    public constructor(message: NonNullable<IGrantedRuntimeClientSet['message']>,
        inspectWindow: () => Promise<'exists' | 'absent' | 'unknown'> = async () => 'unknown') {
        this._message = message; this._inspectWindow = inspectWindow;
    }

    /**
     * @description 先检查已开预览，存在则只reload；初始无连接时仅请求一次打开。
     * @returns 实际操作结果或未知状态下的明确拒绝。
     */
    public async refresh(): Promise<{ available: boolean; source: 'live'; message: string }> {
        const prior = this._tail;
        let release: () => void = () => undefined;
        this._tail = new Promise<void>((resolve) => { release = resolve; });
        await prior;
        try { return await this._refresh(); }
        finally { release(); }
    }

    /**
     * @description Creator的query-connect-num只读查询；无效或不支持的结果保持未知。
     * @returns 非负连接数或null。
     */
    private async _connections(): Promise<number | null> {
        try {
            const count: unknown = await this._message.request('preview', 'query-connect-num');
            return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null;
        } catch { return null; }
    }

    /**
     * @description 在串行窗口内决定唯一一次打开或刷新；不尝试未知fallback命令。
     * @returns 保留明确操作路线的实际结果。
     */
    private async _refresh(): Promise<{ available: boolean; source: 'live'; message: string }> {
        const count = await this._connections();
        if (count === null) return this._result(false, 'preview_refresh_unavailable:preview_state_unknown');
        if (count > 0) return this._refreshConnectedPreview();
        if (this._openRequested || this._observedConnected)
            return this._result(false, 'preview_refresh_unavailable:preview_disconnected_no_reopen');
        if (this._windowStateUnknown) return this._result(false, 'preview_refresh_unavailable:window_state_unknown');
        // 决定打开之前再次只读确认，避免第一轮查询期间有预览连接完成。
        const checked = await this._connections();
        if (checked === null) return this._result(false, 'preview_refresh_unavailable:preview_state_unknown');
        if (checked > 0) return this._refreshConnectedPreview();
        const presence = await this._inspectWindow();
        if (presence === 'unknown') {
            this._windowStateUnknown = true;
            return this._result(false, 'preview_refresh_unavailable:window_state_unknown');
        }
        if (presence === 'exists') {
            this._observedConnected = true;
            return this._result(false, 'preview_refresh_unavailable:existing_window_disconnected_no_reopen');
        }
        const afterInspection = await this._connections();
        if (afterInspection === null) return this._result(false, 'preview_refresh_unavailable:preview_state_unknown');
        if (afterInspection > 0) return this._refreshConnectedPreview();
        return this._openOnce();
    }

    /**
     * @description 连接数不证明浏览器窗口存在；先核实实际标签再决定reload、单次开窗或拒绝。
     */
    private async _refreshConnectedPreview(): Promise<{ available: boolean; source: 'live'; message: string }> {
        if (this._windowStateUnknown) return this._result(false, 'preview_refresh_unavailable:window_state_unknown');
        const presence = await this._inspectWindow();
        if (presence === 'unknown') {
            this._windowStateUnknown = true;
            return this._result(false, 'preview_refresh_unavailable:window_state_unknown');
        }
        if (presence === 'absent') {
            if (this._observedConnected || this._openRequested)
                return this._result(false, 'preview_refresh_unavailable:preview_disconnected_no_reopen');
            return this._openOnce();
        }
        this._observedConnected = true;
        return this._reloadExistingPreview();
    }

    /**
     * @description 物理窗口已核实存在后才请求Creator重载，避免刷新陈旧guest连接。
     */
    private async _reloadExistingPreview(): Promise<{ available: boolean; source: 'live'; message: string }> {
        try {
            await this._message.request('preview', 'reload-terminal');
            return this._result(true, 'preview_refresh_ok:existing-preview+reload-terminal');
        } catch { return this._result(false, 'preview_refresh_unavailable:existing_preview_reload_failed'); }
    }

    /**
     * @description 只有真实窗口被证明不存在时才允许一次开窗；请求失败后不重试。
     */
    private async _openOnce(): Promise<{ available: boolean; source: 'live'; message: string }> {
        if (this._openRequested || this._observedConnected)
            return this._result(false, 'preview_refresh_unavailable:preview_disconnected_no_reopen');
        this._openRequested = true;
        try {
            await this._message.send('preview', 'open-terminal', undefined);
            return this._result(true, 'preview_refresh_ok:open-requested-once');
        } catch { return this._result(false, 'preview_refresh_unavailable:open_request_failed_no_retry'); }
    }

    /**
     * @description 构造不声称页面就绪的操作结果。
     * @param available 命令是否已成功请求。
     * @param message 操作或拒绝路线。
     * @returns 纯结果记录。
     */
    private _result(available: boolean, message: string): { available: boolean; source: 'live'; message: string } {
        return { available, source: 'live', message };
    }
}
