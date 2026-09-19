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
    } finally {
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
