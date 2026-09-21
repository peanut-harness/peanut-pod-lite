import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import test from 'node:test';

import { CocosMcpHub } from '../src/mcp/cocos-mcp-hub';
import { PluginManagerApp } from '../src/app/plugin-manager-app';
import { MacOsKeychainPluginProtectedKeyProvider, type IMacOsKeychainCommandRunner } from '../src/shared/plugin-protected-key-api';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';

test('Cocos MCP Hub should publish a session-scoped dynamic connection descriptor and remove it on stop', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    const descriptorPath = join(projectPath, '.peanut-ai', 'cocos-mcp.json');

    try {
        await hub.start();
        assert.equal(existsSync(descriptorPath), true);
        const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as Record<string, unknown>;
        assert.equal(descriptor.endpoint, 'http://127.0.0.1');
        assert.equal(descriptor.port, hub.getPort());
        assert.equal(typeof descriptor.token, 'string');
        assert.equal(typeof descriptor.sessionId, 'string');

        const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
            body: JSON.stringify({ action: 'health' }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, result: { sessionId: descriptor.sessionId, revision: 0 } });

        await hub.stop();
        assert.equal(existsSync(descriptorPath), false);
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('macOS protected-key provider should isolate and cache non-extractable plugin HMAC keys', async (): Promise<void> => {
    const records = new Map<string, string>();
    const commandRunner: IMacOsKeychainCommandRunner = {
        async run(argumentsValue: readonly string[]): Promise<{ readonly exitCode: number; readonly stdout: string }> {
            const action = argumentsValue[0];
            const account = argumentsValue[argumentsValue.indexOf('-a') + 1];
            if (typeof account !== 'string') {
                throw new Error('test_keychain_account_missing');
            }
            if (action === 'find-generic-password') {
                const value = records.get(account);
                return value == null ? { exitCode: 44, stdout: '' } : { exitCode: 0, stdout: `${value}\n` };
            }
            if (action === 'add-generic-password') {
                const value = argumentsValue[argumentsValue.indexOf('-w') + 1];
                if (typeof value !== 'string') {
                    throw new Error('test_keychain_value_missing');
                }
                records.set(account, value);
                return { exitCode: 0, stdout: '' };
            }
            throw new Error(`test_keychain_action_unsupported:${action}`);
        },
    };
    const provider = new MacOsKeychainPluginProtectedKeyProvider(commandRunner);
    const first = await provider.forPlugin('peanut.cocos-mcp-pro').getOrCreateHmacSha256Key('mcp-plan-digest-v1');
    const second = await provider.forPlugin('peanut.cocos-mcp-pro').getOrCreateHmacSha256Key('mcp-plan-digest-v1');
    const otherPlugin = await provider.forPlugin('peanut.other').getOrCreateHmacSha256Key('mcp-plan-digest-v1');
    const message = new TextEncoder().encode('local-only').buffer;
    const firstDigest = await globalThis.crypto.subtle.sign('HMAC', first, message);
    const secondDigest = await globalThis.crypto.subtle.sign('HMAC', second, message);
    const otherDigest = await globalThis.crypto.subtle.sign('HMAC', otherPlugin, message);
    assert.equal(first.extractable, false);
    assert.deepEqual([...new Uint8Array(firstDigest)], [...new Uint8Array(secondDigest)]);
    assert.notDeepEqual([...new Uint8Array(firstDigest)], [...new Uint8Array(otherDigest)]);
});

test('Cocos MCP Hub should stream capability progress and pass the request cancellation signal', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-progress-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.inspect-progress',
            description: '读取场景并报告进度。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: true,
            risk: 'read',
        },
        async (_input, invocation): Promise<unknown> => {
            assert.equal(invocation.signal?.aborted, false);
            invocation.reportProgress?.({ progress: 1, total: 2, message: '读取场景' });
            return { sceneName: 'Main' };
        },
    );

    try {
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
            body: JSON.stringify({
                action: 'call',
                name: 'peanut.example.inspect-progress',
                input: {},
                connectionId: 'a'.repeat(32),
                stream: true,
            }),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
        assert.deepEqual(
            (await response.text())
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line)),
            [
                { type: 'progress', progress: 1, total: 2, message: '读取场景' },
                { type: 'result', ok: true, result: { sceneName: 'Main' } },
            ],
        );
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should return structured failure guidance for direct and streamed calls', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-failure-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.copy',
            description: '复制测试资源。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            outputSchema: {
                type: 'object',
                properties: { taskStatus: { type: 'string', enum: ['succeeded'] } },
                required: ['taskStatus'],
                additionalProperties: true,
            },
            readOnly: true,
            risk: 'read',
            aiHandling: {
                schemaVersion: 1,
                successSignals: ['response.ok=true'],
                failureField: 'failure',
                unknownStateAction: 'query_before_retry',
                blindRetryAllowed: false,
            },
        },
        async (): Promise<unknown> => {
            throw new Error('lumen_asset_db_registration_pending:db://assets/generated/Record.json');
        },
    );

    try {
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const request = async (stream: boolean): Promise<Response> => {
            return fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify({
                    action: 'call',
                    name: 'peanut.example.copy',
                    input: {},
                    connectionId: stream ? 'c'.repeat(32) : 'd'.repeat(32),
                    stream,
                }),
            });
        };

        const catalogResponse = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
            body: JSON.stringify({ action: 'catalog' }),
        });
        assert.equal(catalogResponse.status, 200);
        const catalogBody = (await catalogResponse.json()) as {
            result: { capabilities: Array<Record<string, unknown>> };
        };
        assert.deepEqual(catalogBody.result.capabilities[0]?.outputSchema, {
            type: 'object',
            properties: { taskStatus: { type: 'string', enum: ['succeeded'] } },
            required: ['taskStatus'],
            additionalProperties: true,
        });
        assert.deepEqual(catalogBody.result.capabilities[0]?.aiHandling, {
            schemaVersion: 1,
            successSignals: ['response.ok=true'],
            failureField: 'failure',
            unknownStateAction: 'query_before_retry',
            blindRetryAllowed: false,
        });

        const directResponse = await request(false);
        assert.equal(directResponse.status, 400);
        const directBody = (await directResponse.json()) as Record<string, unknown>;
        assert.equal(directBody.error, 'lumen_asset_db_registration_pending');
        assert.deepEqual(directBody.failure, {
            schemaVersion: 1,
            code: 'lumen_asset_db_registration_pending',
            category: 'assetdb_pending',
            reason: 'AssetDB did not confirm registration before the deadline; disk state may already have changed.',
            retryable: true,
            state: 'may_have_changed',
            recommendedAction: 'query_state_before_retry',
        });

        const streamedResponse = await request(true);
        assert.equal(streamedResponse.status, 200);
        const events = (await streamedResponse.text())
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.equal(events.length, 1);
        assert.equal(events[0]?.type, 'result');
        assert.equal(events[0]?.ok, false);
        assert.equal(events[0]?.error, 'lumen_asset_db_registration_pending');
        assert.deepEqual(events[0]?.failure, directBody.failure);
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should pass trusted risk and local resource context to capability handlers', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-admission-context-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.inspect-context',
            description: '读取受 Hub 上下文保护的资源。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: { target: { type: 'string' } },
                required: ['target'],
                additionalProperties: false,
            },
            readOnly: true,
            risk: 'read',
        },
        async (_input, invocation): Promise<unknown> => {
            assert.equal(invocation.risk, 'read');
            assert.deepEqual(invocation.resourceIds, ['db://assets/private.prefab']);
            assert.equal(invocation.hasLocalApproval, false);
            return { ok: true };
        },
    );

    try {
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
            body: JSON.stringify({
                action: 'call',
                name: 'peanut.example.inspect-context',
                input: { target: 'db://assets/private.prefab' },
                connectionId: 'b'.repeat(32),
            }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, result: { ok: true } });
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should persist the project enable setting and remove pending write plans when disabled', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-setting-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    const descriptorPath = join(projectPath, '.peanut-ai', 'cocos-mcp.json');
    const settingsPath = join(projectPath, '.peanut-ai', 'cocos-mcp-settings.json');

    try {
        await hub.start();
        const stickyPort = hub.getPort();
        assert.equal(typeof stickyPort, 'number');
        await hub.setEnabled(false);
        assert.equal(hub.getStatus().isEnabled, false);
        assert.equal(existsSync(descriptorPath), false);
        assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), {
            isEnabled: false,
            preferredPort: stickyPort,
            disabledPluginIds: [],
            writeEnabledPluginIds: [],
            directWriteEnabled: false,
        });

        const reloadedHub = new CocosMcpHub(() => pluginManager, { projectPath });
        await reloadedHub.start();
        assert.equal(reloadedHub.getStatus().isEnabled, false);
        assert.equal(reloadedHub.getPort(), null);

        await reloadedHub.setEnabled(true);
        assert.equal(reloadedHub.getStatus().isEnabled, true);
        assert.equal(existsSync(descriptorPath), true);
        assert.equal(reloadedHub.getPort(), stickyPort);
        await reloadedHub.stop();
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should persist plugin capability exposure settings without stopping the plugin runtime', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-plugin-setting-'));
    const settingsPath = join(projectPath, '.peanut-ai', 'cocos-mcp-settings.json');
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const registry = pluginManager.getMcpCapabilityRegistry();
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.inspect',
            description: '读取当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: true,
            risk: 'read',
        },
        async (): Promise<unknown> => ({ sceneName: 'Main' }),
    );
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.apply',
            description: '写入当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: false,
            risk: 'write',
        },
        async (): Promise<unknown> => ({ applied: true }),
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        assert.deepEqual(
            registry.getCatalog().capabilities.map((capability) => capability.name),
            ['peanut.example.inspect'],
        );
        await assert.rejects(registry.invoke('peanut.example.apply', {}, { connectionId: 'a'.repeat(32) }), /mcp_capability_unavailable/);

        await hub.setPluginExposure('peanut.example', 'all');
        assert.deepEqual(
            registry.getCatalog().capabilities.map((capability) => capability.name),
            ['peanut.example.apply', 'peanut.example.inspect'],
        );
        assert.deepEqual(hub.getStatus().writeEnabledPluginIds, ['peanut.example']);

        await hub.setPluginExposure('peanut.example', 'disabled');
        assert.deepEqual(registry.getCatalog().capabilities, []);
        await assert.rejects(registry.invoke('peanut.example.inspect', {}, { connectionId: 'a'.repeat(32) }), /mcp_capability_unavailable/);
        assert.deepEqual(hub.getStatus().disabledPluginIds, ['peanut.example']);
        assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), {
            isEnabled: true,
            preferredPort: null,
            disabledPluginIds: ['peanut.example'],
            writeEnabledPluginIds: [],
            directWriteEnabled: false,
        });

        const reloadedPluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
        const reloadedHub = new CocosMcpHub(() => reloadedPluginManager, { projectPath });
        reloadedHub.applyPluginExposureSettings(reloadedPluginManager);
        const reloadedRegistry = reloadedPluginManager.getMcpCapabilityRegistry();
        reloadedRegistry.register(
            'peanut.example',
            {
                name: 'peanut.example.inspect',
                description: '读取当前场景摘要。',
                category: 'cocos',
                inputSchema: { type: 'object', additionalProperties: false },
                readOnly: true,
                risk: 'read',
            },
            async (): Promise<unknown> => ({ sceneName: 'Main' }),
        );
        assert.deepEqual(reloadedRegistry.getCatalog().capabilities, []);

        await reloadedHub.setPluginExposure('peanut.example', 'read_only');
        assert.deepEqual(
            reloadedRegistry.getCatalog().capabilities.map((capability) => capability.name),
            ['peanut.example.inspect'],
        );
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should expose safe recent-call audit records for Cocos capabilities and workflows', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-audit-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });
    const registry = pluginManager.getMcpCapabilityRegistry();
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.inspect',
            description: '读取当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: true,
            risk: 'read',
        },
        async (): Promise<unknown> => ({ sceneName: 'Main' }),
    );
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.publish-workflow',
            description: '执行受审批的发布工作流。',
            category: 'workflow',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: false,
            risk: 'write',
        },
        async (): Promise<unknown> => ({ published: true }),
    );

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const request = async (payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify(payload),
            });
            assert.equal(response.status, 200);
            return (await response.json()) as Record<string, unknown>;
        };
        const connectionId = 'b'.repeat(32);
        assert.deepEqual(await request({ action: 'call', name: 'peanut.example.inspect', input: {}, connectionId }), {
            ok: true,
            result: { sceneName: 'Main' },
        });
        const planResponse = await request({ action: 'plan', name: 'peanut.example.publish-workflow', input: {}, connectionId });
        const planId = (planResponse.result as Record<string, unknown>).planId as string;
        assert.equal(hub.listRecentCalls()[0]?.status, 'pending_approval');
        assert.equal(hub.approvePlan(planId), true);
        const executeResponse = await request({ action: 'execute', planId, connectionId });
        assert.equal(executeResponse.ok, true);
        const executeResult = executeResponse.result as Record<string, unknown>;
        assert.equal(executeResult.published, true);
        const postflight = executeResult.postflight as Record<string, unknown>;
        assert.equal(postflight.logChecked, true);
        assert.equal(postflight.verified, true);

        assert.deepEqual(
            hub.listRecentCalls().map((call) => ({ name: call.name, category: call.category, risk: call.risk, status: call.status })),
            [
                { name: 'peanut.example.publish-workflow', category: 'workflow', risk: 'write', status: 'succeeded' },
                { name: 'peanut.example.inspect', category: 'cocos', risk: 'read', status: 'succeeded' },
            ],
        );
        assert.equal(
            hub.listRecentCalls().every((call) => call.errorCode == null && call.durationMs != null),
            true,
        );
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should apply setPluginExposure and reloadSettings private actions', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-exposure-action-'));
    const settingsPath = join(projectPath, '.peanut-ai', 'cocos-mcp-settings.json');
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const registry = pluginManager.getMcpCapabilityRegistry();
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.inspect',
            description: '读取当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: true,
            risk: 'read',
        },
        async (): Promise<unknown> => ({ sceneName: 'Main' }),
    );
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.apply',
            description: '写入当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: false,
            risk: 'write',
        },
        async (): Promise<unknown> => ({ applied: true }),
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const request = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify(body),
            });
            assert.equal(response.status, 200);
            return (await response.json()) as Record<string, unknown>;
        };

        const before = await request({ action: 'catalog' });
        assert.deepEqual(
            (before.result as { capabilities: { name: string }[] }).capabilities.map((capability) => capability.name),
            ['peanut.example.inspect'],
        );

        const exposure = await request({ action: 'setPluginExposure', pluginId: 'peanut.example', mode: 'all' });
        assert.equal((exposure.result as { mode: string }).mode, 'all');
        assert.deepEqual(
            (exposure.result as { catalog: { capabilities: { name: string }[] } }).catalog.capabilities
                .map((capability) => capability.name)
                .sort(),
            ['peanut.example.apply', 'peanut.example.inspect'],
        );
        assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')).writeEnabledPluginIds, ['peanut.example']);

        writeFileSync(
            settingsPath,
            JSON.stringify(
                {
                    isEnabled: true,
                    disabledPluginIds: [],
                    writeEnabledPluginIds: [],
                },
                null,
                2,
            ),
            'utf8',
        );
        const reloaded = await request({ action: 'reloadSettings' });
        assert.deepEqual((reloaded.result as { writeEnabledPluginIds: string[] }).writeEnabledPluginIds, []);
        const after = await request({ action: 'catalog' });
        assert.deepEqual(
            (after.result as { capabilities: { name: string }[] }).capabilities.map((capability) => capability.name),
            ['peanut.example.inspect'],
        );
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should execute write tools directly when directWriteEnabled is true', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-direct-write-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const registry = pluginManager.getMcpCapabilityRegistry();
    registry.register(
        'peanut.example',
        {
            name: 'peanut.example.apply',
            description: '写入当前场景摘要。',
            category: 'cocos',
            inputSchema: { type: 'object', additionalProperties: false },
            readOnly: false,
            risk: 'write',
        },
        async (): Promise<unknown> => ({ applied: true }),
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const revisionBeforeWrite = hub.getProjectRevisionSnapshot();
        assert.equal(revisionBeforeWrite.revision, 0);
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
            body: JSON.stringify({
                action: 'call',
                name: 'peanut.example.apply',
                input: {},
                connectionId: 'a'.repeat(32),
            }),
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.ok, true);
        const result = body.result as Record<string, unknown>;
        assert.equal(result.applied, true);
        const postflight = result.postflight as Record<string, unknown>;
        assert.equal(postflight.logChecked, true);
        assert.equal(postflight.verified, true);
        assert.equal(hub.getStatus().directWriteEnabled, true);
        assert.equal(hub.getProjectRevisionSnapshot().revision, 2);
        assert.equal(hub.getProjectRevisionSnapshot(revisionBeforeWrite.revision).stale, true);
        assert.equal(hub.notifyExternalProjectChange().revision, 3);
    } finally {
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should keep inline writes in FIFO slots with one Hub postflight each', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-inline-slot-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const startedIds: string[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let releaseFirstWrite: (() => void) | null = null;
    let markFirstStarted: (() => void) | null = null;
    const firstWriteGate = new Promise<void>((resolveGate) => {
        releaseFirstWrite = resolveGate;
    });
    const firstStarted = new Promise<void>((resolveStarted) => {
        markFirstStarted = resolveStarted;
    });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.inline-write',
            description: '执行兼容内联写入。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false,
            },
            readOnly: false,
            risk: 'write',
        },
        async (input): Promise<unknown> => {
            const id = input.id as string;
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            startedIds.push(id);
            if (id === 'first') {
                markFirstStarted?.();
                await firstWriteGate;
            }
            activeWrites -= 1;
            return { id };
        },
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath, maxConcurrentWrites: 1 });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const request = async (id: string, connectionId: string): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify({
                    action: 'call',
                    name: 'peanut.example.inline-write',
                    input: { id },
                    connectionId,
                }),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const firstResponsePromise = request('first', '1'.repeat(32));
        await firstStarted;
        const secondResponsePromise = request('second', '2'.repeat(32));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        assert.deepEqual(startedIds, ['first']);
        releaseFirstWrite?.();
        const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);
        const firstResult = firstResponse.result as Record<string, unknown>;
        const secondResult = secondResponse.result as Record<string, unknown>;

        assert.deepEqual(startedIds, ['first', 'second']);
        assert.equal(maxActiveWrites, 1);
        assert.equal((firstResult.postflight as Record<string, unknown>).verified, true);
        assert.equal((secondResult.postflight as Record<string, unknown>).verified, true);
        assert.equal('postflight' in ((firstResult.postflight as Record<string, unknown>) ?? {}), false);
        assert.equal('postflight' in ((secondResult.postflight as Record<string, unknown>) ?? {}), false);
    } finally {
        releaseFirstWrite?.();
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should bypass inline write slots and duplicate postflight for managed tasks', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-managed-task-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    let activeWrites = 0;
    let maxActiveWrites = 0;
    let releaseFirstWrite: (() => void) | null = null;
    let markFirstStarted: (() => void) | null = null;
    let markSecondStarted: (() => void) | null = null;
    const firstWriteGate = new Promise<void>((resolveGate) => {
        releaseFirstWrite = resolveGate;
    });
    const firstStarted = new Promise<void>((resolveStarted) => {
        markFirstStarted = resolveStarted;
    });
    const secondStarted = new Promise<void>((resolveStarted) => {
        markSecondStarted = resolveStarted;
    });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.managed-write',
            description: '执行受管写任务。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false,
            },
            readOnly: false,
            risk: 'write',
            executionModel: 'managed_task',
        },
        async (input): Promise<unknown> => {
            const id = input.id as string;
            activeWrites += 1;
            maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
            if (id === 'first') {
                markFirstStarted?.();
                await firstWriteGate;
            } else {
                markSecondStarted?.();
            }
            activeWrites -= 1;
            return {
                id,
                taskId: `task-${id}`,
                taskStatus: 'succeeded',
                postflight: { source: 'managed-task', verified: true },
            };
        },
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath, maxConcurrentWrites: 1 });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const request = async (id: string, connectionId: string): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify({
                    action: 'call',
                    name: 'peanut.example.managed-write',
                    input: { id },
                    connectionId,
                }),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const firstResponsePromise = request('first', '1'.repeat(32));
        await firstStarted;
        const secondResponsePromise = request('second', '2'.repeat(32));
        await secondStarted;
        releaseFirstWrite?.();
        const [firstResponse, secondResponse] = await Promise.all([firstResponsePromise, secondResponsePromise]);
        const firstResult = firstResponse.result as Record<string, unknown>;
        const secondResult = secondResponse.result as Record<string, unknown>;

        assert.equal(maxActiveWrites, 2);
        assert.deepEqual(firstResult.postflight, { source: 'managed-task', verified: true });
        assert.deepEqual(secondResult.postflight, { source: 'managed-task', verified: true });
        assert.equal('logChecked' in (firstResult.postflight as Record<string, unknown>), false);
        const recentCalls = hub.listRecentCalls();
        assert.deepEqual(recentCalls.map((call) => call.taskId).sort(), ['task-first', 'task-second']);
        assert.deepEqual(recentCalls.map((call) => call.taskStatus), ['succeeded', 'succeeded']);
        assert.deepEqual(recentCalls.map((call) => call.status), ['succeeded', 'succeeded']);
        assert.equal(recentCalls.every((call) => call.completedAt != null), true);
    } finally {
        releaseFirstWrite?.();
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub coalesces profiled reads after the prior writer barrier', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-read-barrier-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    let releaseWrite: (() => void) | null = null;
    let markWriteStarted: (() => void) | null = null;
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    let readExecutions = 0;
    const registry = pluginManager.getMcpCapabilityRegistry();
    registry.register('peanut.example', {
        name: 'peanut.example.barrier-write',
        description: '屏障写入。',
        category: 'cocos',
        inputSchema: { type: 'object', additionalProperties: false },
        readOnly: false,
        risk: 'write',
        throughput: { costClass: 'writer', prepareEligible: false, explicitBatchEligible: false, automaticBatchEligible: false },
    }, async (): Promise<unknown> => {
        markWriteStarted?.();
        await writeGate;
        return { applied: true };
    });
    registry.register('peanut.example', {
        name: 'peanut.example.barrier-read',
        description: '屏障读取。',
        category: 'cocos',
        inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
        readOnly: true,
        risk: 'read',
        throughput: {
            costClass: 'read_light',
            readCoalescing: 'project',
            readCache: 'none',
            readConsistency: 'writer_barrier',
        },
    }, async (): Promise<unknown> => ({ execution: ++readExecutions }));
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const invoke = async (name: string, input: Record<string, unknown>, connectionId: string): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify({ action: 'call', name, input, connectionId }),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const write = invoke('peanut.example.barrier-write', {}, '1'.repeat(32));
        await writeStarted;
        const readA = invoke('peanut.example.barrier-read', { key: 'same' }, '2'.repeat(32));
        const readB = invoke('peanut.example.barrier-read', { key: 'same' }, '3'.repeat(32));
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.equal(readExecutions, 0);
        releaseWrite?.();
        const [, resultA, resultB] = await Promise.all([write, readA, readB]);
        assert.equal(readExecutions, 1);
        assert.deepEqual(resultA.result, { execution: 1 });
        assert.deepEqual(resultB.result, { execution: 1 });
        assert.equal(hub.getThroughputHealthSnapshot().coalescedReads, 1);
    } finally {
        releaseWrite?.();
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub rejects overload before invoking capability work and returns retry guidance', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-overload-'));
    const pluginManager = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    let invocationCount = 0;
    let releaseFirst: (() => void) | null = null;
    let markFirstStarted: (() => void) | null = null;
    const firstGate = new Promise<void>((resolveGate) => {
        releaseFirst = resolveGate;
    });
    const firstStarted = new Promise<void>((resolveStarted) => {
        markFirstStarted = resolveStarted;
    });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.heavy-read',
            description: '执行受限重型读取。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false,
            },
            readOnly: true,
            risk: 'read',
            throughput: { costClass: 'read_heavy', readCoalescing: 'none', readCache: 'none', readConsistency: 'writer_barrier' },
        },
        async (input): Promise<unknown> => {
            invocationCount += 1;
            if (input.id === 'first') {
                markFirstStarted?.();
                await firstGate;
            }
            return { id: input.id };
        },
    );
    const hub = new CocosMcpHub(() => pluginManager, {
        projectPath,
        throughputAdmissionLimits: {
            maxConnectionInFlight: 1,
            maxConnectionQueued: 1,
            maxProjectQueued: 1,
            maxControlQueued: 1,
            concurrency: { control: 1, read_light: 1, read_heavy: 1, prepare: 1, writer: 1 },
        },
    });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const call = async (id: string): Promise<Record<string, unknown>> => {
            const response = await fetch(`http://127.0.0.1:${descriptor.port as number}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify({
                    action: 'call',
                    name: 'peanut.example.heavy-read',
                    input: { id },
                    connectionId: 'a'.repeat(32),
                }),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const first = call('first');
        await firstStarted;
        const second = call('second');
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        const rejected = await call('third');
        assert.equal(rejected.ok, false);
        const failure = rejected.failure as Record<string, unknown>;
        assert.equal(failure.code, 'throughput_overloaded');
        assert.equal(failure.category, 'overloaded');
        assert.equal(failure.state, 'not_started');
        assert.equal(failure.recommendedAction, 'retry_with_backoff');
        assert.equal(typeof failure.retryAfterMs, 'number');
        assert.deepEqual(failure.queue, { connectionInFlight: 1, connectionQueued: 1, saturated: true });
        assert.equal(invocationCount, 1);

        releaseFirst?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);
        assert.equal(firstResult.ok, true);
        assert.equal(secondResult.ok, true);
        assert.equal(invocationCount, 2);
    } finally {
        releaseFirst?.();
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub task controls should isolate owners, reject commit cancellation, and project safe evidence', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-task-control-'));
    const runtime = new RuntimeFacade('3.8.7');
    const pluginManager = new PluginManagerApp(runtime);
    let releaseCommit: (() => void) | null = null;
    let markCommitStarted: (() => void) | null = null;
    const commitGate = new Promise<void>((resolveGate) => {
        releaseCommit = resolveGate;
    });
    const commitStarted = new Promise<void>((resolveStarted) => {
        markCommitStarted = resolveStarted;
    });
    runtime.execution.registerExecutor('peanut.example', 'managed.control', {
        execute: async (task) => {
            runtime.execution.recordEvidence(task.taskId, {
                id: 'postflight',
                kind: 'postflight',
                status: 'completed',
                summary: 'Verified managed task output.',
                digest: 'sha256:safe',
                recordedAt: new Date().toISOString(),
                secretToken: 'must-not-leak',
                payload: { absolutePath: '/private/project/secret.prefab' },
            } as never);
            markCommitStarted?.();
            await commitGate;
            return { taskId: task.taskId, kind: task.request.kind, data: { ok: true }, changes: [] };
        },
    });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.controlled-write',
            description: '执行可查询的受管任务。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: { secret: { type: 'string' } },
                required: ['secret'],
                additionalProperties: false,
            },
            readOnly: false,
            risk: 'write',
            executionModel: 'managed_task',
        },
        async (input, invocation): Promise<unknown> => {
            const receipt = await runtime.execution.submitOwned({
                requestId: 'mcp-controlled-write',
                pluginId: 'peanut.example',
                scope: 'project',
                priority: 'normal',
                kind: 'managed.control',
                payload: { secret: input.secret },
                mergePolicy: 'none',
            }, {
                pluginId: 'peanut.example',
                connectionId: invocation.connectionId,
                projectKey: 'plugin:peanut.example',
                capability: 'peanut.example.controlled-write',
            });
            return { taskId: receipt.taskId, taskStatus: 'queued' };
        },
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const endpoint = `http://127.0.0.1:${descriptor.port as number}/mcp`;
        const request = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify(body),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const ownerConnectionId = 'a'.repeat(32);
        const otherConnectionId = 'b'.repeat(32);
        const callResponse = await request({
            action: 'call',
            name: 'peanut.example.controlled-write',
            input: { secret: 'raw-input-must-not-leak' },
            connectionId: ownerConnectionId,
        });
        const taskId = (callResponse.result as Record<string, unknown>).taskId as string;
        await commitStarted;

        const ownerStatus = await request({ action: 'task.status', taskId, connectionId: ownerConnectionId });
        assert.equal(ownerStatus.ok, true);
        assert.equal((ownerStatus.result as Record<string, unknown>).taskId, taskId);
        assert.equal(JSON.stringify(ownerStatus).includes('raw-input-must-not-leak'), false);
        const nonOwnerStatus = await request({ action: 'task.status', taskId, connectionId: otherConnectionId });
        const unknownStatus = await request({ action: 'task.status', taskId: 'unknown-task', connectionId: otherConnectionId });
        assert.equal(nonOwnerStatus.error, 'cocos_mcp_task_unavailable');
        assert.equal(unknownStatus.error, nonOwnerStatus.error);

        const nonOwnerCancel = await request({ action: 'task.cancel', taskId, connectionId: otherConnectionId });
        assert.equal(nonOwnerCancel.error, 'cocos_mcp_task_unavailable');
        const ownerCancel = await request({ action: 'task.cancel', taskId, connectionId: ownerConnectionId });
        assert.deepEqual(ownerCancel.result, { taskId, cancelled: false, reason: 'task_in_commit_window' });

        const evidenceResponse = await request({ action: 'task.evidence', taskId, connectionId: ownerConnectionId });
        const evidenceText = JSON.stringify(evidenceResponse);
        assert.equal(evidenceResponse.ok, true);
        assert.equal(evidenceText.includes('sha256:safe'), true);
        assert.equal(evidenceText.includes('must-not-leak'), false);
        assert.equal(evidenceText.includes('/private/project'), false);

        releaseCommit?.();
        let terminalStatus: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const response = await request({ action: 'task.status', taskId, connectionId: ownerConnectionId });
            terminalStatus = response.result as Record<string, unknown>;
            if (terminalStatus.status === 'succeeded') {
                break;
            }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
        }
        assert.equal(terminalStatus?.status, 'succeeded');
        assert.equal(hub.listRecentCalls()[0]?.taskStatus, 'succeeded');
        assert.equal(hub.listRecentCalls()[0]?.status, 'succeeded');
        assert.equal(hub.listRecentCalls()[0]?.completedAt != null, true);
    } finally {
        releaseCommit?.();
        await hub.stop();
        rmSync(projectPath, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should isolate preferred ports across parallel projects', async (): Promise<void> => {
    const projectPathA = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-iso-a-'));
    const projectPathB = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-iso-b-'));
    const pluginManagerA = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const pluginManagerB = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hubA = new CocosMcpHub(() => pluginManagerA, { projectPath: projectPathA });
    const hubB = new CocosMcpHub(() => pluginManagerB, { projectPath: projectPathB });

    try {
        await Promise.all([hubA.start(), hubB.start()]);
        const portA = hubA.getPort();
        const portB = hubB.getPort();
        assert.equal(typeof portA, 'number');
        assert.equal(typeof portB, 'number');
        assert.notEqual(portA, portB);
        assert.equal(hubA.getStatus().preferredPort, portA);
        assert.equal(hubB.getStatus().preferredPort, portB);
        assert.equal(
            (JSON.parse(readFileSync(join(projectPathA, '.peanut-ai', 'cocos-mcp-settings.json'), 'utf8')) as Record<string, unknown>)
                .preferredPort,
            portA,
        );
        assert.equal(
            (JSON.parse(readFileSync(join(projectPathB, '.peanut-ai', 'cocos-mcp-settings.json'), 'utf8')) as Record<string, unknown>)
                .preferredPort,
            portB,
        );
    } finally {
        await hubA.stop();
        await hubB.stop();
        rmSync(projectPathA, { recursive: true, force: true });
        rmSync(projectPathB, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub should fall back when preferred port is occupied by another project', async (): Promise<void> => {
    const projectPathA = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-conflict-a-'));
    const projectPathB = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-conflict-b-'));
    const pluginManagerA = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const pluginManagerB = new PluginManagerApp(new RuntimeFacade('3.8.7'));
    const hubA = new CocosMcpHub(() => pluginManagerA, { projectPath: projectPathA });
    const settingsPathB = join(projectPathB, '.peanut-ai', 'cocos-mcp-settings.json');

    try {
        await hubA.start();
        const occupiedPort = hubA.getPort();
        assert.equal(typeof occupiedPort, 'number');
        mkdirSync(join(projectPathB, '.peanut-ai'), { recursive: true });
        writeFileSync(
            settingsPathB,
            JSON.stringify(
                {
                    isEnabled: true,
                    preferredPort: occupiedPort,
                    disabledPluginIds: [],
                    writeEnabledPluginIds: [],
                    directWriteEnabled: false,
                },
                null,
                2,
            ),
            'utf8',
        );
        const hubB = new CocosMcpHub(() => pluginManagerB, { projectPath: projectPathB });
        await hubB.start();
        try {
            const portB = hubB.getPort();
            assert.equal(typeof portB, 'number');
            assert.notEqual(portB, occupiedPort);
            assert.equal(hubA.getPort(), occupiedPort);
            assert.equal(hubB.getStatus().preferredPort, portB);
            assert.equal(
                (JSON.parse(readFileSync(settingsPathB, 'utf8')) as Record<string, unknown>).preferredPort,
                portB,
            );
        } finally {
            await hubB.stop();
        }
    } finally {
        await hubA.stop();
        rmSync(projectPathA, { recursive: true, force: true });
        rmSync(projectPathB, { recursive: true, force: true });
    }
});

test('Cocos MCP Hub explicit batches preserve item task ids and isolate batch ownership', async (): Promise<void> => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-cocos-mcp-hub-batch-'));
    const runtime = new RuntimeFacade('3.8.7');
    const pluginManager = new PluginManagerApp(runtime, undefined, undefined, undefined, projectPath);
    pluginManager.createHostTaskApi('peanut.example', projectPath);
    let executionCount = 0;
    runtime.execution.registerExecutor('peanut.example', 'editor-mcp.resource-operation', {
        execute: async (task) => {
            executionCount += 1;
            return {
                taskId: task.taskId,
                kind: task.request.kind,
                data: { projectState: 'may_have_changed' },
                changes: [],
            };
        },
    });
    pluginManager.getMcpCapabilityRegistry().register(
        'peanut.example',
        {
            name: 'peanut.example.batch-write',
            description: '批次写入。',
            category: 'cocos',
            inputSchema: {
                type: 'object',
                properties: {
                    resources: { type: 'array', items: { type: 'string' }, minItems: 1 },
                    value: { type: 'string' },
                },
                required: ['resources', 'value'],
                additionalProperties: false,
            },
            readOnly: false,
            risk: 'write',
            executionModel: 'managed_task',
            throughput: {
                costClass: 'writer',
                operationId: 'lumen.compSet',
                prepareEligible: true,
                explicitBatchEligible: true,
                automaticBatchEligible: false,
            },
        },
        async (): Promise<unknown> => {
            throw new Error('batch_should_not_invoke_single_handler');
        },
    );
    const hub = new CocosMcpHub(() => pluginManager, { projectPath });

    try {
        await hub.setPluginExposure('peanut.example', 'all');
        await hub.setDirectWriteEnabled(true);
        await hub.start();
        const descriptor = JSON.parse(readFileSync(join(projectPath, '.peanut-ai', 'cocos-mcp.json'), 'utf8')) as Record<string, unknown>;
        const endpoint = `http://127.0.0.1:${descriptor.port as number}/mcp`;
        const request = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': descriptor.token as string },
                body: JSON.stringify(body),
            });
            return (await response.json()) as Record<string, unknown>;
        };
        const owner = 'a'.repeat(32);
        const other = 'b'.repeat(32);
        const revisionBefore = hub.getProjectRevisionSnapshot().revision;
        const submitted = await request({
            action: 'batch.submit',
            connectionId: owner,
            batch: {
                requestId: 'batch-request',
                items: [
                    {
                        itemId: 'first',
                        operation: 'peanut.example.batch-write',
                        input: { resources: ['db://assets/a'], value: 'a' },
                    },
                    {
                        itemId: 'second',
                        operation: 'peanut.example.batch-write',
                        input: { resources: ['db://assets/b'], value: 'b' },
                    },
                ],
            },
        });
        assert.equal(submitted.ok, true);
        const receipt = submitted.result as {
            batchId: string;
            items: Array<{ itemId: string; taskId: string }>;
        };
        assert.match(receipt.batchId, /^batch:/u);
        assert.deepEqual(receipt.items.map((item) => item.itemId), ['first', 'second']);
        assert.equal(new Set(receipt.items.map((item) => item.taskId)).size, 2);

        const nonOwner = await request({ action: 'batch.status', connectionId: other, batchId: receipt.batchId });
        assert.equal(nonOwner.error, 'cocos_mcp_batch_unavailable');
        let ownerStatus: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const response = await request({ action: 'batch.status', connectionId: owner, batchId: receipt.batchId });
            assert.equal(response.ok, true, JSON.stringify(response));
            ownerStatus = response.result as Record<string, unknown>;
            if (ownerStatus?.stage === 'terminal') {
                break;
            }
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        }
        assert.equal(ownerStatus?.stage, 'terminal');
        assert.equal(ownerStatus?.status, 'succeeded');
        assert.equal(ownerStatus?.completed, 2);
        assert.equal(executionCount, 2);
        const revisionAfter = hub.getProjectRevisionSnapshot().revision;
        assert.equal(revisionAfter > revisionBefore, true);

        for (const [expectedError, items] of [
            ['cocos_mcp_batch_dependency_cycle', [
                {
                    itemId: 'a',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/a'], value: 'a' },
                    dependsOn: ['b'],
                },
                {
                    itemId: 'b',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/b'], value: 'b' },
                    dependsOn: ['a'],
                },
            ]],
            ['task_idempotency_conflict', [
                {
                    itemId: 'a',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/a'], value: 'a' },
                    idempotencyKey: 'duplicate',
                },
                {
                    itemId: 'b',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/b'], value: 'b' },
                    idempotencyKey: 'duplicate',
                },
            ]],
            ['cocos_mcp_batch_resource_conflict:b', [
                {
                    itemId: 'a',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/shared'], value: 'a' },
                },
                {
                    itemId: 'b',
                    operation: 'peanut.example.batch-write',
                    input: { resources: ['db://assets/shared'], value: 'b' },
                },
            ]],
        ] as const) {
            const rejected = await request({
                action: 'batch.submit',
                connectionId: owner,
                batch: { requestId: `rejected-${expectedError}`, items },
            });
            assert.equal(rejected.error, expectedError);
            if (executionCount !== 2) {
                throw new Error(`batch_rejection_executed_work:${expectedError}:${executionCount}`);
            }
        }
        assert.equal(hub.getProjectRevisionSnapshot().revision >= revisionAfter, true);
    } finally {
        await hub.stop();
        runtime.execution.dispose();
        rmSync(projectPath, { recursive: true, force: true });
    }
});
