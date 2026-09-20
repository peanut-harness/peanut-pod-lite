import type { TaskMergePolicy } from '@peanut/pod-protocol';

import type { IAssetRuntimeService } from '../../cocos/foundation/asset/asset-runtime-service.js';
import type { ISceneRuntimeService } from '../../cocos/foundation/scene/scene-runtime-service.js';
import type { IAcceptedTask } from '../ingress/task-ingress.js';
import type { ITaskExecutor } from '../registry/task-executor-registry.js';
import { TaskExecutorRegistry } from '../registry/task-executor-registry.js';
import type { ITaskCommitOutcome } from './runtime-task-commit-dispatcher.js';

/**
 * @description Runtime 内建 executor 的提供插件标识。
 */
export const RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID = 'peanut.runtime';

/**
 * @description Runtime 内建 task executor 的显式组装入口。
 */
export const BuiltInRuntimeTaskExecutors = Object.freeze({
    register(
        registry: TaskExecutorRegistry,
        assetRuntimeService: IAssetRuntimeService,
        sceneRuntimeService: ISceneRuntimeService,
    ): readonly (() => void)[] {
        return [
            registry.register(RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID, 'asset.query', createAssetQueryTaskExecutor(assetRuntimeService)),
            registry.register(RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID, 'asset.refresh', createAssetRefreshTaskExecutor(assetRuntimeService)),
            registry.register(RUNTIME_BUILTIN_EXECUTOR_PLUGIN_ID, 'scene.patch', createScenePatchTaskExecutor(sceneRuntimeService)),
        ];
    },
});

/**
 * @description Runtime 内建 asset.query executor。
 */
function createAssetQueryTaskExecutor(assetRuntimeService: IAssetRuntimeService): ITaskExecutor {
    return {
        execute: async (task): Promise<ITaskCommitOutcome> => {
            const pathOrUuid = requireStringField(task.request.payload, 'pathOrUuid', task.request.kind);
            const assetSnapshot = await assetRuntimeService.query(pathOrUuid);
            return {
                taskId: task.taskId,
                kind: task.request.kind,
                data: { pathOrUuid, asset: toRecordOrValue(assetSnapshot), found: assetSnapshot != null },
                changes: [],
            };
        },
    };
}

/**
 * @description Runtime 内建 asset.refresh executor。
 */
function createAssetRefreshTaskExecutor(assetRuntimeService: IAssetRuntimeService): ITaskExecutor {
    const executeBatch = async (
        tasks: readonly IAcceptedTask[],
        batchId: string,
        _mergePolicy: TaskMergePolicy,
    ): Promise<readonly ITaskCommitOutcome[]> => {
        const uniqueTargets = new Map<string, Record<string, unknown> | null>();
        for (const task of tasks) {
            const pathOrUuid = requireStringField(task.request.payload, 'pathOrUuid', task.request.kind);
            if (!uniqueTargets.has(pathOrUuid)) {
                uniqueTargets.set(pathOrUuid, toRecordOrValue(await assetRuntimeService.refresh(pathOrUuid)));
            }
        }
        const batchTargets = [...uniqueTargets.keys()];
        const isGroupedBatch = tasks.length > 1;
        return tasks.map((task) => {
            const pathOrUuid = requireStringField(task.request.payload, 'pathOrUuid', task.request.kind);
            const asset = uniqueTargets.get(pathOrUuid) ?? null;
            return {
                taskId: task.taskId,
                kind: task.request.kind,
                data: { pathOrUuid, asset, refreshed: asset != null, batchId, batchSize: tasks.length, batchTargets },
                changes: asset == null ? [] : [{
                    kind: 'asset',
                    target: pathOrUuid,
                    operation: isGroupedBatch ? 'batch_refresh' : 'refresh',
                    summary: isGroupedBatch
                        ? `Batch refreshed asset "${pathOrUuid}" in "${batchId}".`
                        : `Refreshed asset "${pathOrUuid}".`,
                }],
            };
        });
    };
    return {
        execute: async (task): Promise<ITaskCommitOutcome> => {
            const [outcome] = await executeBatch([task], `batch:${task.taskId}`, 'none');
            if (outcome == null) {
                throw new Error('asset_refresh_outcome_missing');
            }
            return outcome;
        },
        executeBatch,
    };
}

/**
 * @description Runtime 内建 scene.patch executor。
 */
function createScenePatchTaskExecutor(sceneRuntimeService: ISceneRuntimeService): ITaskExecutor {
    const executeBatch = async (
        tasks: readonly IAcceptedTask[],
        batchId: string,
        mergePolicy: TaskMergePolicy,
    ): Promise<readonly ITaskCommitOutcome[]> => {
        const shouldCoalesce = mergePolicy === 'coalesce';
        const coalescedPatches = new Map<string, Record<string, unknown>>();
        for (const task of tasks) {
            const nodeId = requireStringField(task.request.payload, 'nodeId', task.request.kind);
            const patch = requireRecordField(task.request.payload, 'patch', task.request.kind);
            coalescedPatches.set(nodeId, shouldCoalesce ? { ...(coalescedPatches.get(nodeId) ?? {}), ...patch } : patch);
        }
        const sceneNodeSnapshots = new Map<string, Record<string, unknown>>();
        for (const [nodeId, patch] of coalescedPatches) {
            sceneNodeSnapshots.set(nodeId, await sceneRuntimeService.patch(nodeId, patch));
        }
        const coalescedNodeIds = [...coalescedPatches.keys()];
        const isGroupedCoalesce = shouldCoalesce && tasks.length > 1;
        return tasks.map((task) => {
            const nodeId = requireStringField(task.request.payload, 'nodeId', task.request.kind);
            const patch = requireRecordField(task.request.payload, 'patch', task.request.kind);
            const coalescedPatch = coalescedPatches.get(nodeId) ?? patch;
            const sceneNode = sceneNodeSnapshots.get(nodeId);
            if (sceneNode == null) {
                throw new Error(`coalesced_scene_patch_missing_node:${nodeId}`);
            }
            return {
                taskId: task.taskId,
                kind: task.request.kind,
                data: { nodeId, patch, coalescedPatch, sceneNode, batchId, coalescedTaskCount: tasks.length, coalescedNodeIds },
                changes: [{
                    kind: 'scene',
                    target: nodeId,
                    operation: isGroupedCoalesce ? 'coalesced_patch' : 'patch',
                    summary: isGroupedCoalesce
                        ? `Coalesced scene patch for node "${nodeId}" in "${batchId}".`
                        : `Patched scene node "${nodeId}".`,
                }],
            };
        });
    };
    return {
        execute: async (task): Promise<ITaskCommitOutcome> => {
            const [outcome] = await executeBatch([task], `batch:${task.taskId}`, 'none');
            if (outcome == null) {
                throw new Error('scene_patch_outcome_missing');
            }
            return outcome;
        },
        executeBatch,
    };
}

function requireStringField(payload: unknown, fieldName: string, kind: string): string {
    if (typeof payload !== 'object' || payload == null || typeof (payload as Record<string, unknown>)[fieldName] !== 'string') {
        throw new Error(`invalid_${kind}_payload:${fieldName}`);
    }
    return (payload as Record<string, string>)[fieldName] as string;
}

function requireRecordField(payload: unknown, fieldName: string, kind: string): Record<string, unknown> {
    if (typeof payload !== 'object' || payload == null) {
        throw new Error(`invalid_${kind}_payload:${fieldName}`);
    }
    const value = (payload as Record<string, unknown>)[fieldName];
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        throw new Error(`invalid_${kind}_payload:${fieldName}`);
    }
    return { ...(value as Record<string, unknown>) };
}

function toRecordOrValue(value: unknown): Record<string, unknown> | null {
    if (value == null) {
        return null;
    }
    return typeof value === 'object' ? { ...(value as Record<string, unknown>) } : { value };
}
