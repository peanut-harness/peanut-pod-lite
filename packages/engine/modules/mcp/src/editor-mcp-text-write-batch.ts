import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { ProjectLogPostflightMonitor } from '@peanut/pod-engine/runtime';
import type { ContractPayload } from '@peanut/pod-protocol';
import { EditorMcpTextWriteOutcome } from './editor-mcp-text-write-outcome.js';
import { EditorMcpTextWriteSession } from './editor-mcp-text-write-session.js';
import type { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';
import type { IResourceOperationBatchContext, IResourceOperationTaskPlan } from './resource-operation-contracts.js';

/**
 * @description 沿用原事务和唯一日志检查点，收口当前联合 writer 窗口的有限文本证据。
 */
export class EditorMcpTextWriteBatch {
    /**
     * @description 当前已核实的工程根。
     */
    private readonly _projectRoot: string;
    /**
     * @description 原 Router 持有的 AssetDB 事务。
     */
    private readonly _transaction: EditorMcpAssetDbTransaction;

    /**
     * @description 绑定原工程和事务，不创建额外 writer 或调度器。
     * @param projectRoot 原 Router 核实的工程根。
     * @param transaction 原有 AssetDB 事务。
     */
    public constructor(projectRoot: string, transaction: EditorMcpAssetDbTransaction) {
        this._projectRoot = projectRoot;
        this._transaction = transaction;
    }

    /**
     * @description 在原联合锁内创建一次日志检查点及有限文本账本，统一最终收口。
     * @param plans 原始有序任务计划。
     * @param requests 原始请求，供局部失败映射。
     * @returns 不进入业务 JSON 的内部上下文。
     */
    public async begin(
        plans: readonly IResourceOperationTaskPlan[],
        requests: readonly Readonly<import('@peanut/pod-protocol').ITaskRequest>[],
    ): Promise<IResourceOperationBatchContext> {
        const root = this._projectRoot;
        const monitor = new ProjectLogPostflightMonitor();
        const checkpoint = monitor.checkpoint(root);
        const outcomes = plans.map((plan, index) => ({
            taskId: requests[index]?.requestId ?? '',
            request: requests[index],
            outcome: plan.preparedTextWrite == null ? null
                : new EditorMcpTextWriteOutcome(root, plan.preparedTextWrite.files, this._transaction),
        }));
        const session = new EditorMcpTextWriteSession(outcomes);
        const byPlan = new Map(plans.map((plan, index) => [plan, outcomes[index]?.outcome ?? null]));
        const hasText = outcomes.some((entry) => entry.outcome != null);
        let postflight: ReturnType<ProjectLogPostflightMonitor['readDelta']> | undefined;
        // 全批恢复材料在首个worker前有界预读，不能写完前项才发现后项总预算超限。
        try {
            for (let taskIndex = 0; taskIndex < plans.length; taskIndex += 1) {
                const files = plans[taskIndex]?.preparedTextWrite?.files ?? [];
                for (let index = 0; index < files.length; index += 1) {
                    const file = files[index];
                    if (file == null) {
                        throw new Error('text_file_io_stage_index_invalid');
                    }
                    try {
                        if (await this._transaction.queryTextRegistration(file.path) === null) {
                            session.prepareRecovery(root, file);
                        }
                    } catch (error: unknown) {
                        outcomes[taskIndex]?.outcome?.markAttemptFailure(index);
                        throw error;
                    }
                }
            }
        } catch (error: unknown) {
            postflight = monitor.readDelta(checkpoint);
            throw Object.assign(session.failure(error), { taskPostflight: postflight });
        }
        return {
            textWrites: session,
            outcome: (plan) => byPlan.get(plan) ?? undefined,
            failure: (error) => {
                postflight ??= monitor.readDelta(checkpoint);
                return Object.assign(session.failure(error), { taskPostflight: postflight });
            },
            finish: async (results) => {
                if (results.length !== plans.length || results.some((result) => !this._isRecord(result))) {
                    throw new Error('editor_mcp_task_result_invalid');
                }
                if (results.some((result, index) => outcomes[index]?.outcome == null
                    && this._isRecord(result) && this._isRecord(result.data) && result.data.ok === false)) {
                    throw new Error('editor_mcp_business_result_failed');
                }
                // 父目录 meta 是最终校验证据，不是显式目录刷新请求；文件同步仍经过原屏障。
                const paths = plans.flatMap((plan) => plan.preparedTextWrite?.files.map((file) => file.path) ?? []);
                const transaction = paths.length === 0 ? null : await this._transaction.commit(paths, {
                    textVerification: true,
                    beforePossibleMutation: () => {
                        for (let taskIndex = 0; taskIndex < plans.length; taskIndex += 1) {
                            const entry = outcomes[taskIndex];
                            const files = plans[taskIndex]?.preparedTextWrite?.files ?? [];
                            for (let index = 0; index < files.length; index += 1) {
                                entry?.outcome?.markPossibleMutation(index);
                            }
                        }
                    },
                });
                // 已存在的代码只写源并 refresh 会留下旧编译缓存；在原联合 writer 和提交窗口内完成真实重导入。
                const existingCodePaths = plans.flatMap((plan) => plan.preparedTextWrite?.files
                    .filter((file) => file.beforeSha256 !== 'absent' && ['.ts', '.js'].includes(extname(file.path).toLowerCase()))
                    .map((file) => file.path) ?? []);
                if (existingCodePaths.length > 0) {
                    await this._transaction.reimportRegistered(existingCodePaths);
                }
                for (const entry of outcomes) {
                    await entry.outcome?.verifyFinal();
                }
                postflight = monitor.readDelta(checkpoint);
                if (!postflight.logChecked || hasText && !existsSync(checkpoint.path)
                    || postflight.newErrorCount > 0 || postflight.newWarningCount > 0) {
                    throw new Error('editor_mcp_project_log_postflight_failed');
                }
                const finalResults = results.map((result, index) => {
                    if (!this._isRecord(result)) {
                        throw new Error('editor_mcp_task_result_invalid');
                    }
                    const data = this._isRecord(result.data) ? result.data : { value: result.data };
                    const outcome = outcomes[index]?.outcome;
                    return { ...result, data: { ...data, taskPostflight: postflight,
                        ...(outcome == null || transaction == null ? {} : { ...outcome.result(true),
                            transaction, refresh: transaction.refresh,
                            metaReady: plans[index]?.preparedTextWrite?.files.map((file) => file.path) ?? [] }) } };
                });
                for (const entry of outcomes) {
                    entry.outcome?.releaseRecovery();
                }
                return finalResults;
            },
        };
    }

    /**
     * @description 判断原任务结果是否为普通对象载荷。
     * @param value 当前未知结果。
     * @returns 是否为对象载荷。
     */
    private _isRecord(value: unknown): value is ContractPayload {
        return typeof value === 'object' && value != null && !Array.isArray(value);
    }
}
