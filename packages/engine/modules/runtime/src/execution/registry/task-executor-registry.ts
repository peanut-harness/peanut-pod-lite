import type { TaskMergePolicy } from '@peanut/pod-protocol';

import type { ITaskCommitOutcome } from '../commit/runtime-task-commit-dispatcher.js';
import type { IAcceptedTask } from '../ingress/task-ingress.js';

/**
 * @description 按插件与 kind 注册的任务执行器。
 */
export interface ITaskExecutor {
    /**
     * @description executor 是否在内部使用原子资源锁管理并发；默认由 Runtime 串行提交。
     */
    readonly concurrency?: 'runtime_serial' | 'executor_managed';
    /**
     * @description 执行单个标准化任务。
     */
    execute(task: IAcceptedTask): Promise<ITaskCommitOutcome>;
    /**
     * @description 可选批执行入口；未提供时调度器逐任务执行。
     */
    executeBatch?(
        tasks: readonly IAcceptedTask[],
        batchId: string,
        mergePolicy: TaskMergePolicy,
    ): Promise<readonly ITaskCommitOutcome[]>;
}

/**
 * @description 实例级 task executor 注册表，以 `(pluginId, kind)` 作为唯一键。
 */
export class TaskExecutorRegistry {
    /**
     * @description 当前实例的 executor 索引。
     */
    private readonly _executors = new Map<string, ITaskExecutor>();

    /**
     * @description 注册 executor 并返回严格的一次性撤销函数。
     */
    public register(pluginId: string, kind: string, executor: ITaskExecutor): () => void {
        const key = this._key(pluginId, kind);
        if (this._executors.has(key)) {
            throw new Error(`task_executor_duplicate:${pluginId}:${kind}`);
        }
        this._executors.set(key, executor);
        let active = true;
        return (): void => {
            if (!active || !this._executors.delete(key)) {
                throw new Error(`task_executor_already_revoked:${pluginId}:${kind}`);
            }
            active = false;
        };
    }

    /**
     * @description 解析 executor；未知或已撤销键显式失败。
     */
    public resolve(pluginId: string, kind: string): ITaskExecutor {
        const executor = this._executors.get(this._key(pluginId, kind));
        if (executor == null) {
            throw new Error(`task_executor_unavailable:${pluginId}:${kind}`);
        }
        return executor;
    }

    /**
     * @description 返回指定 executor 是否仍处于注册状态。
     */
    public has(pluginId: string, kind: string): boolean {
        return this._executors.has(this._key(pluginId, kind));
    }

    /**
     * @description 构造不发生字符串边界碰撞的注册键。
     */
    private _key(pluginId: string, kind: string): string {
        if (pluginId.trim().length === 0 || kind.trim().length === 0) {
            throw new Error('task_executor_key_invalid');
        }
        return `${pluginId}\u0000${kind}`;
    }
}
