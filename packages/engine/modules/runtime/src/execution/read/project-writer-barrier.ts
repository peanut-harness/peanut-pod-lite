/** @description 已接纳 writer 的屏障租约。 */
export interface IProjectWriterBarrierLease {
    readonly sequence: number;
    release(): boolean;
}

/**
 * @description 让强一致读取等待调用前已经接纳的 writer，不阻塞更早开始的读取。
 */
export class ProjectWriterBarrier {
    private _sequence = 0;
    private _tail: Promise<void> = Promise.resolve();
    private _activeWriters = 0;

    /** @description 把 writer 追加到屏障尾部。 */
    public admitWriter(): IProjectWriterBarrierLease {
        const sequence = ++this._sequence;
        const previous = this._tail;
        let resolveCurrent: (() => void) | null = null;
        const current = new Promise<void>((resolve) => { resolveCurrent = resolve; });
        this._tail = previous.then(() => current);
        this._activeWriters += 1;
        let released = false;
        return {
            sequence,
            release: (): boolean => {
                if (released) {
                    return false;
                }
                released = true;
                this._activeWriters = Math.max(0, this._activeWriters - 1);
                resolveCurrent?.();
                return true;
            },
        };
    }

    /** @description 等待调用此方法之前已接纳的 writer 全部完成。 */
    public async waitForPriorWriters(): Promise<void> {
        const boundary = this._tail;
        await boundary;
    }

    public inspect(): { readonly admittedSequence: number; readonly activeWriters: number } {
        return { admittedSequence: this._sequence, activeWriters: this._activeWriters };
    }
}
