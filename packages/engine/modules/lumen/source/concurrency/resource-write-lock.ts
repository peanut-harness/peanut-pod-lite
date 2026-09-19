const GLOBAL_FALLBACK_LOCK_KEY = 'project:global';

/**
 * @description 等待原子获取一组 Lumen 资源锁的请求。
 */
interface IResourceWriteLockRequest {
    /**
     * @description 已归一、去重的完整资源集合。
     */
    readonly lockKeys: ReadonlySet<string>;
    /**
     * @description 全部资源同时可用时授予锁。
     */
    readonly grant: () => void;
}

/**
 * @description 按资源键串行化 lumen 磁盘写，并对多资源任务执行原子预约。
 */
export class LumenResourceWriteLock {
    /**
     * @description 进程内共享实例（MCP 网关 / router 复用）。
     */
    private static _shared: LumenResourceWriteLock | null = null;
    /**
     * @description 尚未取得完整资源集合的 FIFO 请求。
     */
    private readonly _pending: IResourceWriteLockRequest[] = [];
    /**
     * @description 当前持锁的资源键集合。
     */
    private readonly _held = new Set<string>();

    /**
     * @description 返回进程内共享写锁协调器。
     * @returns 共享实例。
     */
    public static shared(): LumenResourceWriteLock {
        if (LumenResourceWriteLock._shared == null) {
            LumenResourceWriteLock._shared = new LumenResourceWriteLock();
        }
        return LumenResourceWriteLock._shared;
    }

    /**
     * @description 测试专用：重置共享实例。
     * @returns 无返回值。
     */
    public static resetSharedForTests(): void {
        LumenResourceWriteLock._shared = null;
    }

    /**
     * @description 在单资源键上独占执行异步任务；并发调用按资源 FIFO 排队。
     * @param lockKey 规范化资源键（如 `assets/ui/Foo.prefab`）。
     * @param worker 受保护任务。
     * @returns worker 结果。
     */
    public async runExclusive<T>(lockKey: string, worker: () => Promise<T>): Promise<T> {
        return this.runExclusiveMany([lockKey], worker);
    }

    /**
     * @description 原子获取全部资源锁后执行 worker，避免持有部分资源等待其余资源。
     * @param lockKeys 资源键列表；空集合降级为进程级项目锁，不允许绕锁。
     * @param worker 受保护任务。
     * @returns worker 结果。
     */
    public async runExclusiveMany<T>(lockKeys: readonly string[], worker: () => Promise<T>): Promise<T> {
        const normalizedKeys = lockKeys.map((key) => normalizeResourceLockKey(key)).filter((key) => key.length > 0);
        const lockSet = new Set(normalizedKeys.length > 0 ? normalizedKeys : [GLOBAL_FALLBACK_LOCK_KEY]);
        await this._acquireMany(lockSet);
        try {
            return await worker();
        } finally {
            this._releaseMany(lockSet);
        }
    }

    /**
     * @description 等待完整资源集合一次性可用。
     * @param lockKeys 已归一资源集合。
     * @returns 全部锁已登记后完成。
     */
    private async _acquireMany(lockKeys: ReadonlySet<string>): Promise<void> {
        await new Promise<void>((resolveAcquire) => {
            this._pending.push({ lockKeys, grant: resolveAcquire });
            this._drain();
        });
    }

    /**
     * @description 启动所有不冲突且未越过同资源前序请求的任务。
     * @returns 无返回值。
     */
    private _drain(): void {
        let index = 0;
        while (index < this._pending.length) {
            const request = this._pending[index];
            if (request == null || !this._canGrant(request, this._pending.slice(0, index))) {
                index += 1;
                continue;
            }
            this._pending.splice(index, 1);
            for (const lockKey of request.lockKeys) {
                this._held.add(lockKey);
            }
            request.grant();
        }
    }

    /**
     * @description 判断请求是否可原子授予且不越过冲突的前序请求。
     * @param request 当前请求。
     * @param earlierRequests 更早但尚未授予的请求。
     * @returns 可以授予时返回 true。
     */
    private _canGrant(
        request: IResourceWriteLockRequest,
        earlierRequests: readonly IResourceWriteLockRequest[],
    ): boolean {
        if (this._intersects(request.lockKeys, this._held)) {
            return false;
        }
        return !earlierRequests.some((earlier) => this._intersects(request.lockKeys, earlier.lockKeys));
    }

    /**
     * @description 一次性释放完整资源集合并继续调度。
     * @param lockKeys 当前任务持有的资源集合。
     * @returns 无返回值。
     */
    private _releaseMany(lockKeys: ReadonlySet<string>): void {
        for (const lockKey of lockKeys) {
            this._held.delete(lockKey);
        }
        this._drain();
    }

    /**
     * @description 判断两个资源集合是否相交。
     * @param left 左集合。
     * @param right 右集合。
     * @returns 存在相同资源键时返回 true。
     */
    private _intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
        for (const lockKey of left) {
            if (right.has(lockKey)) {
                return true;
            }
        }
        return false;
    }
}

/**
 * @description 规范化 MCP/lumen 资源锁键。
 * @param value 原始路径或 db 路径。
 * @returns 小写 POSIX 相对路径。
 * @oopException 纯字符串规范化，无对象归属。
 */
export function normalizeResourceLockKey(value: string): string {
    return value
        .trim()
        .replace(/\\/gu, '/')
        .replace(/^db:\/\//iu, '')
        .replace(/^\/+/u, '')
        .toLowerCase();
}

/**
 * @description 规范化资源父目录锁键（AssetDB refresh / import 与 commit 共用）。
 * @param value 文件或目录相对/db 路径。
 * @returns `dir:assets/...` 形式键；空输入返回空串。
 * @oopException 纯字符串规范化，无对象归属。
 */
export function normalizeResourceDirectoryLockKey(value: string): string {
    const normalized = normalizeResourceLockKey(value);
    if (normalized.length === 0) {
        return '';
    }
    const slash = normalized.lastIndexOf('/');
    const baseName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const dirPath = baseName.includes('.') ? (slash >= 0 ? normalized.slice(0, slash) : 'assets') : normalized;
    return `dir:${dirPath.length > 0 ? dirPath : 'assets'}`;
}
