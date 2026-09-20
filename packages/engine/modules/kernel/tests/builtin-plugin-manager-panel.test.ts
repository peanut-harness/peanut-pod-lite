import assert from 'assert/strict';
import test from 'node:test';

import type { IPanelBridgeClient, IPanelBridgeEnvelope, IPanelBridgeRequest, IPanelBridgeResponse, IPluginRuntimeRecord } from '@peanut/pod-protocol';
import type { IExecutionDiagnosticsSnapshot } from '@peanut/pod-engine/runtime';

import { BuiltinPluginManagerPanelHarness } from '../src/integration/builtin-plugin-manager-panel-harness';
import type { IPluginFailureDetailPayload, IPluginManagerSnapshotPayload } from '../src/panels/plugin-manager-panel-contracts';
import { PluginManagerPanelUiController } from '../src/panels/plugin-manager-panel-ui';
import type { IMcpHubControl } from '../src/mcp/mcp-hub-control';

function createExecutionDiagnosticsSnapshot(): IExecutionDiagnosticsSnapshot {
    return {
        queue: {
            queuedTaskIds: ['task-live'],
            planningGroups: [
                {
                    groupId: 'group-live',
                    priority: 'high',
                    mergePolicy: 'none',
                    taskIds: ['task-live'],
                    sequence: 1,
                    kind: 'asset.query',
                    stage: 'planning',
                    targets: ['assets/live.prefab'],
                },
            ],
            pendingCommitGroups: [],
            activeCommitGroup: null,
            isDrainingCommitQueue: true,
            lastCommittedPriority: 'normal',
            consecutiveCommitCount: 1,
        },
        currentGroups: [
            {
                groupId: 'group-live',
                priority: 'high',
                mergePolicy: 'none',
                sequence: 1,
                kind: 'asset.query',
                taskIds: ['task-live'],
                stage: 'planning',
                targets: ['assets/live.prefab'],
                status: 'active',
                hasTimeout: false,
                hasCancellation: false,
                hasReplan: false,
                traceTaskId: 'task-live',
                taskSummaries: [
                    {
                        taskId: 'task-live',
                        status: 'planning',
                        isCancelled: false,
                        isTimedOut: false,
                        isReplanned: false,
                        errorCode: null,
                        trace: null,
                    },
                ],
                startedAt: '2026-07-12T00:00:00.000Z',
                finishedAt: null,
            },
        ],
        recentGroups: [
            {
                groupId: 'group-timeout',
                priority: 'critical',
                mergePolicy: 'dedupe',
                sequence: 2,
                kind: 'asset.query',
                taskIds: ['task-timeout'],
                stage: 'planning',
                targets: ['assets/timeout.prefab'],
                status: 'failed',
                hasTimeout: true,
                hasCancellation: false,
                hasReplan: false,
                traceTaskId: 'task-timeout',
                taskSummaries: [
                    {
                        taskId: 'task-timeout',
                        status: 'failed',
                        isCancelled: false,
                        isTimedOut: true,
                        isReplanned: false,
                        errorCode: 'task_timeout',
                        trace: {
                            traceId: 'task-timeout:trace',
                            taskId: 'task-timeout',
                            kind: 'asset.query',
                            startedAt: '2026-07-12T00:00:01.000Z',
                            finishedAt: '2026-07-12T00:00:02.000Z',
                            steps: [
                                {
                                    id: 'planning',
                                    title: 'Task timed out before commit',
                                    status: 'failed',
                                    detail: 'task_timeout',
                                },
                            ],
                        },
                    },
                ],
                startedAt: '2026-07-12T00:00:01.000Z',
                finishedAt: '2026-07-12T00:00:02.000Z',
            },
            {
                groupId: 'group-replan',
                priority: 'normal',
                mergePolicy: 'coalesce',
                sequence: 3,
                kind: 'scene.patch',
                taskIds: ['task-replan'],
                stage: 'committing',
                targets: ['root-node'],
                status: 'succeeded',
                hasTimeout: false,
                hasCancellation: false,
                hasReplan: true,
                traceTaskId: 'task-replan',
                taskSummaries: [
                    {
                        taskId: 'task-replan',
                        status: 'succeeded',
                        isCancelled: false,
                        isTimedOut: false,
                        isReplanned: true,
                        errorCode: null,
                        trace: {
                            traceId: 'task-replan:trace',
                            taskId: 'task-replan',
                            kind: 'scene.patch',
                            startedAt: '2026-07-12T00:00:03.000Z',
                            finishedAt: '2026-07-12T00:00:04.000Z',
                            steps: [
                                {
                                    id: 'planning',
                                    title: 'Plan tasks',
                                    status: 'planned',
                                    detail: 'replanned once',
                                },
                                {
                                    id: 'commit',
                                    title: 'Commit task group',
                                    status: 'completed',
                                    detail: 'Applied coalesce group.',
                                },
                            ],
                        },
                    },
                ],
                startedAt: '2026-07-12T00:00:03.000Z',
                finishedAt: '2026-07-12T00:00:04.000Z',
            },
        ],
        updatedAt: '2026-07-12T00:00:05.000Z',
    };
}

test('builtin plugin-manager panel should expose only trusted managed task audit fields', async (): Promise<void> => {
    const harness = new BuiltinPluginManagerPanelHarness('3.8.7');
    const control: IMcpHubControl = {
        getStatus: () => ({
            isAvailable: true,
            isEnabled: true,
            port: 3210,
            preferredPort: 3210,
            catalogRevision: 1,
            capabilities: [],
            disabledPluginIds: [],
            writeEnabledPluginIds: ['peanut.example'],
            directWriteEnabled: false,
            recentCalls: [],
        }),
        listPendingPlans: () => [],
        listRecentCalls: () => [{
            id: 'audit-safe',
            name: 'peanut.example.controlled-write',
            category: 'cocos',
            risk: 'write',
            status: 'succeeded',
            requestedAt: 1,
            completedAt: 2,
            durationMs: 1,
            errorCode: null,
            taskId: 'task-safe',
            taskStatus: 'succeeded',
        }],
        setEnabled: async () => {},
        setPluginEnabled: async () => {},
        setDirectWriteEnabled: async () => {},
        setPluginExposure: async () => {},
        approvePlan: () => false,
        rejectPlan: () => false,
    };
    const summary = await harness.runMcpTaskSummaryFlow(control);

    assert.equal(summary?.taskId, 'task-safe');
    assert.equal(summary?.taskStatus, 'succeeded');
    assert.deepEqual(Object.keys(summary ?? {}).sort(), [
        'category', 'completedAt', 'durationMs', 'errorCode', 'id', 'name', 'requestedAt', 'risk', 'status', 'taskId', 'taskStatus',
    ]);
});

function createRuntimeRecord(pluginId: string): IPluginRuntimeRecord {
    return {
        pluginId,
        version: '0.1.0',
        trustLevel: 'builtin',
        state: 'active',
        health: undefined,
        failureIncident: undefined,
    };
}

function createSnapshotPayload(executionDiagnosticsSnapshot: IExecutionDiagnosticsSnapshot): IPluginManagerSnapshotPayload {
    return {
        runtimeRecords: [createRuntimeRecord('builtin.plugin-manager.panel')],
        failureItems: [],
        packageCatalog: [],
        recentPackagePaths: [],
        kernelReloadSupported: false,
        preferences: {
            locale: 'zh-CN',
            packageFilter: 'all',
            packageCatalogSort: 'plugin-id-asc',
            selectedPluginId: 'builtin.plugin-manager.panel',
            selectedPackagePath: null,
        },
        executionDiagnosticsSnapshot,
    };
}

function createDetailPayload(pluginId: string): IPluginFailureDetailPayload {
    return {
        runtimeRecord: createRuntimeRecord(pluginId),
        incident: null,
        installedPackageSnapshot: null,
    };
}

function createMockPanelBridgeClient(
    snapshotPayload: IPluginManagerSnapshotPayload,
    detailPayload: IPluginFailureDetailPayload,
): {
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    panelBridgeClient: IPanelBridgeClient;
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    executionDiagnosticsRequestCount: () => number;
} {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    let diagnosticsRequestCount = 0;
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const listeners = new Map<string, Array<(envelope: IPanelBridgeEnvelope) => void | Promise<void>>>();

    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const panelBridgeClient: IPanelBridgeClient = {
        /** @description 执行当前模块对外提供的处理流程。 */
        async postMessage(): Promise<void> {},
        /** @description 执行当前模块对外提供的处理流程。
 * @param request 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
        async request<TPayload extends Record<string, unknown>, TResponse extends Record<string, unknown>>(
            request: IPanelBridgeRequest<TPayload>,
        ): Promise<IPanelBridgeResponse<TResponse>> {
            if (request.event === 'pluginManager.snapshot') {
                return {
                    requestId: request.id,
                    ok: true,
                    payload: snapshotPayload as unknown as TResponse,
                };
            }
            if (request.event === 'pluginManager.executionDiagnostics') {
                diagnosticsRequestCount += 1;
                return {
                    requestId: request.id,
                    ok: true,
                    payload: snapshotPayload.executionDiagnosticsSnapshot as unknown as TResponse,
                };
            }
            if (request.event === 'pluginManager.failure.detail') {
                return {
                    requestId: request.id,
                    ok: true,
                    payload: detailPayload as unknown as TResponse,
                };
            }
            if (request.event === 'pluginManager.panel.resolve') {
                return {
                    requestId: request.id,
                    ok: true,
                    payload: {
                        pluginId: detailPayload.runtimeRecord?.pluginId ?? 'sample.plugin',
                        panelId: 'sample.panel',
                        title: 'Sample Panel',
                        entry: '/plugins/sample/panels/embedded/index.html',
                    } as unknown as TResponse,
                };
            }
            if (request.event === 'pluginManager.preferences.update') {
                return {
                    requestId: request.id,
                    ok: true,
                    payload: {
                        preferences: snapshotPayload.preferences,
                    } as unknown as TResponse,
                };
            }
            return {
                requestId: request.id,
                ok: false,
                error: `unsupported_event:${request.event}`,
            };
        },
        /** @description 执行当前模块对外提供的处理流程。
 * @param event 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @param listener 当前调用所需的输入参数，决定本次处理的目标或行为。
 * @returns 当前操作完成后产生的处理结果。
 */
        subscribe<TPayload extends Record<string, unknown>>(
            event: string,
            listener: (envelope: IPanelBridgeEnvelope<TPayload>) => void | Promise<void>,
        ): () => void {
            // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
            const eventListeners = listeners.get(event) ?? [];
            eventListeners.push(listener as (envelope: IPanelBridgeEnvelope) => void | Promise<void>);
            listeners.set(event, eventListeners);
            return () => {
                listeners.set(event, (listeners.get(event) ?? []).filter((currentListener) => currentListener !== listener));
            };
        },
        /** @description 执行当前模块对外提供的处理流程。 */
        async dispose(): Promise<void> {
            listeners.clear();
        },
    };

    return {
        panelBridgeClient,
        executionDiagnosticsRequestCount: () => {
            return diagnosticsRequestCount;
        },
    };
}

test('builtin plugin-manager panel should expose failure list, detail, export, and retry cleanup actions', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelResult = await builtinPluginManagerPanelHarness.runFailureRecoveryFlow();

    assert.equal(builtinPluginManagerPanelResult.listResponse.ok, true);
    assert.equal(builtinPluginManagerPanelResult.listResponse.payload?.items.length, 1);
    assert.equal(builtinPluginManagerPanelResult.listResponse.payload?.items[0]?.pluginId, 'builtin.plugin-manager.failure-target');
    assert.equal(builtinPluginManagerPanelResult.listResponse.payload?.items[0]?.state, 'failed');

    assert.equal(builtinPluginManagerPanelResult.detailResponse.ok, true);
    assert.equal(builtinPluginManagerPanelResult.detailResponse.payload?.runtimeRecord?.pluginId, 'builtin.plugin-manager.failure-target');
    assert.equal(builtinPluginManagerPanelResult.detailResponse.payload?.runtimeRecord?.state, 'failed');
    assert.equal(builtinPluginManagerPanelResult.detailResponse.payload?.incident?.phase, 'deactivate');

    assert.equal(builtinPluginManagerPanelResult.exportResponse.ok, true);
    assert.equal(
        builtinPluginManagerPanelResult.exportResponse.payload?.exportResult.pluginId,
        'builtin.plugin-manager.failure-target',
    );
    assert.equal(
        builtinPluginManagerPanelResult.exportResponse.payload?.exportResult.serializedIncident.includes('builtin.plugin-manager.failure-target'),
        true,
    );

    assert.equal(builtinPluginManagerPanelResult.retryCleanupResponse.ok, true);
    assert.equal(
        builtinPluginManagerPanelResult.retryCleanupResponse.payload?.cleanupSteps.every((cleanupStepResult) => cleanupStepResult.ok),
        true,
    );
    assert.equal(
        builtinPluginManagerPanelResult.retryCleanupResponse.payload?.incident?.cleanupSteps.every((cleanupStepResult) => cleanupStepResult.ok),
        true,
    );
    assert.equal(builtinPluginManagerPanelResult.notifications.length, 1);
    assert.equal(builtinPluginManagerPanelResult.notifications[0]?.event, 'pluginManager.failure.updated');
});

test('builtin plugin-manager panel should auto-mount a browser-side UI and support lifecycle actions', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelResult = await builtinPluginManagerPanelHarness.runBrowserUiFlow();

    assert.equal(builtinPluginManagerPanelResult.initialState.status, 'ready');
    assert.equal(builtinPluginManagerPanelResult.initialState.selectedPluginId, 'builtin.plugin-manager.ui.failure-target');
    assert.equal(builtinPluginManagerPanelResult.initialState.failureItems.length, 1);
    assert.notEqual(builtinPluginManagerPanelResult.initialState.executionDiagnosticsSnapshot, null);
    assert.equal(builtinPluginManagerPanelResult.initialState.developmentSession.enabled, false);
    assert.equal(
        builtinPluginManagerPanelResult.initialMarkup.includes('builtin.plugin-manager.ui.failure-target'),
        true,
    );
    assert.equal(builtinPluginManagerPanelResult.initialMarkup.includes('执行诊断'), true);
    assert.equal(builtinPluginManagerPanelResult.initialMarkup.includes('开发会话'), true);
    assert.equal(
        builtinPluginManagerPanelResult.exportResult?.serializedIncident.includes('builtin.plugin-manager.ui.failure-target'),
        true,
    );
    assert.equal(
        builtinPluginManagerPanelResult.retryCleanupSteps.every((cleanupStepResult) => cleanupStepResult.ok),
        true,
    );
    assert.equal(builtinPluginManagerPanelResult.afterDeactivateState.selectedRuntimeRecord?.state, 'inactive');
    assert.equal(builtinPluginManagerPanelResult.afterActivateState.selectedRuntimeRecord?.state, 'active');
    assert.equal(builtinPluginManagerPanelResult.afterDisposeState.selectedRuntimeRecord?.state, 'disposed');
    assert.equal(builtinPluginManagerPanelResult.refreshedState.status, 'ready');
    assert.equal(builtinPluginManagerPanelResult.refreshedState.failureItems.length, 0);
    assert.equal(builtinPluginManagerPanelResult.browserTitle?.includes('builtin.plugin-manager.ui.failure-target'), true);
    assert.equal(
        builtinPluginManagerPanelResult.browserBodyHtml?.includes('可执行：刷新、导出、重试清理、激活、停用、释放。所有动作都通过实时 panel bridge 执行。'),
        true,
    );
    assert.equal(builtinPluginManagerPanelResult.refreshedMarkup.includes('当前没有插件故障。'), true);
});

test('plugin-manager panel ui controller should filter diagnostics, select a group, and stop polling after dispose', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const executionDiagnosticsSnapshot = createExecutionDiagnosticsSnapshot();
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const snapshotPayload = createSnapshotPayload(executionDiagnosticsSnapshot);
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const detailPayload = createDetailPayload('builtin.plugin-manager.panel');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const mockPanelBridgeClient = createMockPanelBridgeClient(snapshotPayload, detailPayload);
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const pluginManagerPanelUiController = new PluginManagerPanelUiController(
        'builtin.plugin-manager.panel',
        'builtin.plugin-manager.panel',
        mockPanelBridgeClient.panelBridgeClient,
    );

    await pluginManagerPanelUiController.initialize();
    assert.notEqual(pluginManagerPanelUiController.state.executionDiagnosticsSnapshot, null);
    assert.equal(pluginManagerPanelUiController.renderMarkup().includes('group-timeout'), true);
    assert.equal(pluginManagerPanelUiController.renderMarkup().includes('timeout'), true);

    await pluginManagerPanelUiController.setExecutionPriorityFilter('critical');
    await pluginManagerPanelUiController.selectExecutionGroup('group-timeout');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const filteredMarkup = pluginManagerPanelUiController.renderMarkup();
    assert.equal(filteredMarkup.includes('group-timeout'), true);
    assert.equal(filteredMarkup.includes('task-timeout'), true);
    assert.equal(filteredMarkup.includes('task_timeout'), true);

    await pluginManagerPanelUiController.toggleExceptionalExecutionGroups();
    assert.equal(pluginManagerPanelUiController.state.showOnlyExceptionalExecutionGroups, true);

    await new Promise((resolve) => {
        setTimeout(resolve, 1100);
    });
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const requestCountAfterPolling = mockPanelBridgeClient.executionDiagnosticsRequestCount();
    assert.equal(requestCountAfterPolling >= 1, true);

    await pluginManagerPanelUiController.dispose();
    await new Promise((resolve) => {
        setTimeout(resolve, 1100);
    });
    assert.equal(mockPanelBridgeClient.executionDiagnosticsRequestCount(), requestCountAfterPolling);
});

test('plugin-manager panel ui controller should expose and close a resolved embedded panel', async (): Promise<void> => {
    // 保存包含活动插件的管理器快照，用于驱动打开按钮状态。
    const snapshotPayload = createSnapshotPayload(createExecutionDiagnosticsSnapshot());
    // 保存当前活动插件详情。
    const detailPayload = createDetailPayload('builtin.plugin-manager.panel');
    // 保存能够响应面板解析请求的浏览器桥。
    const mockPanelBridgeClient = createMockPanelBridgeClient(snapshotPayload, detailPayload);
    // 保存被测管理器 UI 控制器。
    const controller = new PluginManagerPanelUiController(
        'builtin.plugin-manager.panel',
        'builtin.plugin-manager.panel',
        mockPanelBridgeClient.panelBridgeClient,
    );

    await controller.initialize();
    await controller.openSelectedPluginPanel();
    assert.equal(controller.state.embeddedPanel?.panelId, 'sample.panel');
    assert.equal(controller.state.embeddedPanel?.entry, '/plugins/sample/panels/embedded/index.html');
    assert.equal(controller.state.lastError, null);

    await controller.closeEmbeddedPluginPanel();
    assert.equal(controller.state.embeddedPanel, null);
    await controller.dispose();
});

test('builtin plugin-manager panel should drive package plan, install, upgrade, and uninstall actions', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelResult = await builtinPluginManagerPanelHarness.runPackageActionFlow();

    assert.equal(
        builtinPluginManagerPanelResult.planSummary?.includes('已生成 builtin.plugin-manager.package-target@0.1.0 的安装计划。'),
        true,
    );
    assert.equal(
        builtinPluginManagerPanelResult.installSummary,
        '已完成 builtin.plugin-manager.package-target@0.1.0 的安装。',
    );
    assert.equal(builtinPluginManagerPanelResult.installActiveVersion, '0.1.0');
    assert.equal(builtinPluginManagerPanelResult.installRuntimeVersion, '0.1.0');
    assert.equal(
        builtinPluginManagerPanelResult.upgradeSummary,
        '已完成 builtin.plugin-manager.package-target@0.2.0 的升级。',
    );
    assert.equal(builtinPluginManagerPanelResult.upgradeActiveVersion, '0.2.0');
    assert.equal(builtinPluginManagerPanelResult.upgradeRuntimeVersion, '0.2.0');
    assert.equal(
        builtinPluginManagerPanelResult.uninstallSummary,
        '已完成 builtin.plugin-manager.package-target 的卸载。',
    );
    assert.equal(builtinPluginManagerPanelResult.uninstallInstalledSnapshot, null);
    assert.equal(builtinPluginManagerPanelResult.uninstallSelectedPluginId, 'builtin.plugin-manager.panel');
    assert.equal(builtinPluginManagerPanelResult.uninstallRuntimeVersion, '0.1.0');
    assert.equal(
        builtinPluginManagerPanelResult.uninstallRuntimePluginIds.includes('builtin.plugin-manager.package-target'),
        false,
    );
    assert.equal(builtinPluginManagerPanelResult.uninstallActionDisabled, true);
    assert.equal(
        builtinPluginManagerPanelResult.recentPackagePathsAfterRemount.includes('packages/builtin.plugin-manager.package-target-0.1.0.pcp'),
        true,
    );
    assert.equal(
        builtinPluginManagerPanelResult.recentPackagePathsAfterRemount.includes('packages/builtin.plugin-manager.package-target-0.2.0.pcp'),
        true,
    );
});

test('builtin plugin-manager panel should keep uninstall failure visible when teardown fails', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const deactivateFailureResult = await builtinPluginManagerPanelHarness.runPackageUninstallFailureFlow('deactivate');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const disposeFailureResult = await builtinPluginManagerPanelHarness.runPackageUninstallFailureFlow('dispose');

    assert.equal(deactivateFailureResult.status, 'error');
    assert.equal(deactivateFailureResult.lastError, 'hotplug_failure_deactivate_failed');
    assert.equal(deactivateFailureResult.selectedPluginId, 'builtin.plugin-manager.uninstall-failure-deactivate');
    assert.equal(deactivateFailureResult.selectedRuntimeState, 'failed');
    assert.equal(deactivateFailureResult.selectedIncidentPhase, 'deactivate');
    assert.equal(deactivateFailureResult.installedActiveVersion, '0.1.0');
    assert.equal(deactivateFailureResult.uninstallActionDisabled, false);

    assert.equal(disposeFailureResult.status, 'error');
    assert.equal(disposeFailureResult.lastError, 'hotplug_failure_dispose_failed');
    assert.equal(disposeFailureResult.selectedPluginId, 'builtin.plugin-manager.uninstall-failure-dispose');
    assert.equal(disposeFailureResult.selectedRuntimeState, 'failed');
    assert.equal(disposeFailureResult.selectedIncidentPhase, 'dispose');
    assert.equal(disposeFailureResult.installedActiveVersion, '0.1.0');
    assert.equal(disposeFailureResult.uninstallActionDisabled, false);
});

test('builtin plugin-manager panel should persist filter, sort, selected plugin, and selected package across remount', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelResult = await builtinPluginManagerPanelHarness.runPanelPreferencesPersistenceFlow();

    assert.equal(builtinPluginManagerPanelResult.locale, 'zh-CN');
    assert.equal(builtinPluginManagerPanelResult.packageFilter, 'installed');
    assert.equal(builtinPluginManagerPanelResult.packageCatalogSort, 'recent-first');
    assert.equal(builtinPluginManagerPanelResult.selectedPluginId, 'builtin.plugin-manager.preferences-target');
    assert.equal(
        builtinPluginManagerPanelResult.selectedPackagePath,
        'packages/builtin.plugin-manager.preferences-target-0.1.0.pcp',
    );
});

test('builtin plugin-manager settings should validate saves, notify the manager, and reject stale revisions', async (): Promise<void> => {
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    const builtinPluginManagerSettingsResult = await builtinPluginManagerPanelHarness.runSettingsUpdateFlow();

    assert.equal(builtinPluginManagerSettingsResult.initialRevision, 0);
    assert.equal(builtinPluginManagerSettingsResult.savedRevision, 1);
    assert.equal(builtinPluginManagerSettingsResult.locale, 'en-US');
    assert.equal(builtinPluginManagerSettingsResult.packageFilter, 'installed');
    assert.equal(builtinPluginManagerSettingsResult.packageCatalogSort, 'recent-first');
    assert.equal(builtinPluginManagerSettingsResult.notificationCount, 1);
    assert.equal(builtinPluginManagerSettingsResult.conflictRejected, true);
});

test('builtin plugin-manager panel should register and remove manual package sources persistently', async (): Promise<void> => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelHarness = new BuiltinPluginManagerPanelHarness('3.8.7');
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const builtinPluginManagerPanelResult = await builtinPluginManagerPanelHarness.runManualSourceRegistryFlow();

    assert.equal(builtinPluginManagerPanelResult.afterRegisterSourceKinds.includes('manual'), true);
    assert.equal(
        builtinPluginManagerPanelResult.afterRegisterPackagePaths.includes('packages/manual.registry.plugin-9.9.9.pcp'),
        true,
    );
    assert.equal(
        builtinPluginManagerPanelResult.afterRemovePackagePaths.includes('packages/manual.registry.plugin-9.9.9.pcp'),
        false,
    );
    assert.equal(
        builtinPluginManagerPanelResult.afterRemountPackagePaths.includes('packages/manual.registry.plugin-9.9.9.pcp'),
        false,
    );
});
