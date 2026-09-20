import type {
    ITaskCancelResult,
    ITaskEvidenceIndex,
    ITaskOwner,
    ITaskStatusSummary,
} from '@peanut/pod-protocol';
import type { IExecutionRuntimeService } from '@peanut/pod-engine/runtime';

/**
 * @description MCP Hub 的受管任务控制入口；记录由宿主创建的 owner 绑定并拒绝跨连接访问。
 */
export class McpTaskControl {
    /**
     * @description Runtime 共享任务控制面。
     */
    private readonly _execution: IExecutionRuntimeService;
    /**
     * @description Hub 已受理任务的不可变 owner。
     */
    private readonly _owners = new Map<string, ITaskOwner>();
    /**
     * @description capability 与连接到可信 owner 的宿主解析器。
     */
    private readonly _resolveOwner: ((capability: string, connectionId: string) => ITaskOwner | null) | null;

    /**
     * @param execution Runtime 执行服务。 @param resolveOwner 宿主 owner 解析器。
     */
    public constructor(
        execution: IExecutionRuntimeService,
        resolveOwner: ((capability: string, connectionId: string) => ITaskOwner | null) | null = null,
    ) {
        this._execution = execution;
        this._resolveOwner = resolveOwner;
    }

    /**
     * @description 通过 capability 与连接绑定 Hub 返回的受管任务。
     */
    public attachCapability(taskId: string, capability: string, connectionId: string): void {
        const owner = this._resolveOwner?.(capability, connectionId) ?? null;
        if (owner == null) {
            throw new Error('cocos_mcp_task_owner_unavailable');
        }
        this.attach(taskId, owner);
    }

    /**
     * @description 关联 Hub 返回的 taskId 与宿主解析的不可变 owner。
     */
    public attach(taskId: string, owner: ITaskOwner): void {
        const current = this._owners.get(taskId);
        if (current != null && this._ownerKey(current) !== this._ownerKey(owner)) {
            throw new Error('cocos_mcp_task_owner_conflict');
        }
        if (current == null) {
            this._owners.set(taskId, { ...owner });
        }
    }

    /**
     * @description 按 Bridge 连接查询 owner-safe 状态。
     */
    public async getStatus(taskId: string, connectionId: string): Promise<ITaskStatusSummary | null> {
        const owner = this._getConnectionOwner(taskId, connectionId);
        return owner == null ? null : this._execution.getOwnedStatus(taskId, owner);
    }

    /**
     * @description 按 Bridge 连接取消任务；未知任务与非 owner 返回同一不可用结果。
     */
    public async cancel(taskId: string, connectionId: string): Promise<ITaskCancelResult> {
        const owner = this._getConnectionOwner(taskId, connectionId);
        return owner == null
            ? { taskId, cancelled: false, reason: 'task_unavailable' }
            : this._execution.cancelOwned(taskId, owner);
    }

    /**
     * @description 按 Bridge 连接读取 allow-list 证据索引。
     */
    public async getEvidence(taskId: string, connectionId: string): Promise<ITaskEvidenceIndex | null> {
        const owner = this._getConnectionOwner(taskId, connectionId);
        return owner == null ? null : this._execution.getOwnedEvidence(taskId, owner);
    }

    /**
     * @description 仅当连接完全匹配时返回任务 owner。
     */
    private _getConnectionOwner(taskId: string, connectionId: string): ITaskOwner | null {
        const owner = this._owners.get(taskId);
        return owner?.connectionId === connectionId ? owner : null;
    }

    /**
     * @description 生成 owner 不含敏感信息的稳定比较键。
     */
    private _ownerKey(owner: ITaskOwner): string {
        return [owner.pluginId, owner.connectionId, owner.projectKey, owner.capability].join('\u0000');
    }
}
