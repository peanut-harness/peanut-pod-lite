import assert from 'assert/strict';
import test from 'node:test';

import type {
    ICleanupStepResult,
    ICreatorVersionInfo,
    IMcpCapabilityDefinition,
    IMcpFailureDetails,
    IPanelBridgeRequest,
    IPluginFailureExport,
    IPluginInstallPlan,
    IPluginManifest,
    PluginPackageOperationMode,
    ITaskRequest,
    ITaskResult,
} from '../src/index';

test('contracts root exports should compose MCP failure and AI handling guidance', (): void => {
    const failure: IMcpFailureDetails = {
        schemaVersion: 1,
        code: 'lumen_asset_db_registration_pending',
        category: 'assetdb_pending',
        reason: 'AssetDB registration is pending.',
        retryable: true,
        state: 'may_have_changed',
        recommendedAction: 'query_state_before_retry',
        taskId: 'contracts-task-failure',
        taskStatus: 'failed',
        operation: 'asset.copy',
    };
    const definition: IMcpCapabilityDefinition = {
        name: 'peanut.editor-mcp.asset-copy',
        description: 'Copy an asset.',
        category: 'cocos',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: false,
        risk: 'write',
        aiHandling: {
            schemaVersion: 1,
            successSignals: ['response.ok=true', 'result.taskStatus=succeeded'],
            failureField: 'failure',
            unknownStateAction: 'query_before_retry',
            blindRetryAllowed: false,
        },
    };

    assert.equal(failure.recommendedAction, 'query_state_before_retry');
    assert.equal(definition.aiHandling?.blindRetryAllowed, false);
});

test('contracts root exports should support composing manifest, task, panel, and install DTOs', (): void => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginManifest: IPluginManifest = {
        id: 'contracts.smoke.plugin',
        version: '0.1.0',
        kind: 'panel-plugin',
        displayName: 'Contracts Smoke Plugin',
        description: { 'en-US': 'Contract composition smoke plugin.', 'zh-CN': '契约组合冒烟测试插件。' },
        main: './index.js',
        engines: {
            host: '^0.1.0',
        },
        activation: {
            autoActivate: true,
            events: ['onStartup'],
        },
        permissions: {
            editorMessages: ['contracts:ping'],
            assetDb: {
                read: true,
                write: false,
                delete: false,
            },
        },
        contributions: {
            panels: [
                {
                    id: 'contracts.panel',
                    title: 'Contracts Panel',
                    entry: 'panels/contracts/index.html',
                    placement: 'utility',
                    singleton: true,
                    activationPolicy: 'manual',
                    sessionPolicy: 'restore_layout',
                    permissions: {
                        allowSelectionRead: true,
                    },
                },
            ],
        },
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ taskRequest: ITaskRequest = {
        requestId: 'contracts-request',
        pluginId: pluginManifest.id,
        scope: 'asset',
        priority: 'normal',
        kind: 'asset.query',
        payload: {
            pathOrUuid: 'assets/contracts.prefab',
        },
        mergePolicy: 'dedupe',
        idempotencyKey: 'asset.query:assets/contracts.prefab',
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ panelBridgeRequest: IPanelBridgeRequest<{ includeSelection: boolean }> = {
        id: 'contracts-panel-request',
        event: 'contracts.getState',
        expectsResponse: true,
        payload: {
            includeSelection: true,
        },
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginInstallPlan: IPluginInstallPlan = {
        operation: 'install',
        pluginId: pluginManifest.id,
        version: pluginManifest.version,
        packagePath: 'packages/contracts.smoke.plugin-0.1.0.pcp',
        stagedPath: 'staging/contracts.smoke.plugin/0.1.0',
        previousVersion: null,
        steps: [
            {
                id: 'contracts.smoke.plugin:validate',
                kind: 'validate',
                title: 'Validate package',
                description: { 'en-US': 'Validate manifest and package metadata.', 'zh-CN': '校验 manifest 和包元数据。' },
            },
        ],
        warnings: ['package_signature_missing'],
    };

    assert.equal(pluginManifest.contributions?.panels?.[0]?.permissions?.allowSelectionRead, true);
    assert.deepEqual(pluginManifest.description, { 'en-US': 'Contract composition smoke plugin.', 'zh-CN': '契约组合冒烟测试插件。' });
    assert.equal(taskRequest.mergePolicy, 'dedupe');
    assert.equal(panelBridgeRequest.expectsResponse, true);
    assert.equal(pluginInstallPlan.steps[0]?.kind, 'validate');
});

test('contracts root exports should support stable version and result snapshots', (): void => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ packageOperationMode: PluginPackageOperationMode = 'upgrade';
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ creatorVersionInfo: ICreatorVersionInfo = {
        raw: '3.8.7',
        major: 3,
        minor: 8,
        patch: 7,
        phase: 'editor_api_stable',
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    /** @description 定义调用方可传递或读取的契约字段，保持模块边界的数据一致性。 */
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ taskResult: ITaskResult<{ echoedKind: string }> = {
        taskId: 'contracts-task-1',
        ok: true,
        status: 'succeeded',
        data: {
            echoedKind: 'asset.query',
        },
        changes: [
            {
                kind: 'asset',
                target: 'assets/contracts.prefab',
                operation: 'query',
                summary: 'Read the contract smoke asset.',
            },
        ],
        trace: {
            traceId: 'contracts-task-1:trace',
            taskId: 'contracts-task-1',
            kind: 'asset.query',
            startedAt: '2026-07-09T00:00:00.000Z',
            finishedAt: '2026-07-09T00:00:01.000Z',
            steps: [
                {
                    id: 'planning',
                    title: 'Plan task',
                    status: 'planned',
                    detail: 'Generated plan.',
                },
                {
                    id: 'commit',
                    title: 'Commit task',
                    status: 'completed',
                    detail: 'Committed task.',
                },
            ],
        },
    };

    assert.equal(creatorVersionInfo.phase, 'editor_api_stable');
    assert.equal(packageOperationMode, 'upgrade');
    assert.equal(taskResult.trace.steps.length, 2);
    assert.equal(taskResult.data?.echoedKind, 'asset.query');
});

test('contracts root exports should support failure incident snapshots', (): void => {
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ cleanupStepResult: ICleanupStepResult = {
        stepId: 'contracts.smoke.plugin:lease:1',
        phase: 'cleanup',
        targetType: 'lease',
        targetId: 'contracts.smoke.plugin:lease:1',
        ok: false,
        summary: 'Lease cleanup failed.',
        errorMessage: 'lease_cleanup_failed',
    };
    // 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。
    const /* 保存当前执行步骤的中间结果，仅在本作用域内参与后续处理。 */ pluginFailureExport: IPluginFailureExport = {
        pluginId: 'contracts.smoke.plugin',
        exportedAt: '2026-07-09T00:00:02.000Z',
        incident: {
            pluginId: 'contracts.smoke.plugin',
            phase: 'activate',
            previousState: 'registered',
            failedAt: '2026-07-09T00:00:01.000Z',
            installPreserved: true,
            errorMessage: 'contracts_activate_failed',
            errorStack: 'Error: contracts_activate_failed',
            cleanupSteps: [cleanupStepResult],
        },
        serializedIncident: '{"pluginId":"contracts.smoke.plugin"}',
    };

    assert.equal(pluginFailureExport.incident.phase, 'activate');
    assert.equal(pluginFailureExport.incident.cleanupSteps[0]?.ok, false);
    assert.equal(pluginFailureExport.serializedIncident.includes('contracts.smoke.plugin'), true);
});
