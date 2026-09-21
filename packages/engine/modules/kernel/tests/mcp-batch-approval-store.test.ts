import assert from 'assert/strict';
import test from 'node:test';

import { McpBatchApprovalStore } from '../src/mcp/mcp-batch-approval-store.js';
import { ProjectMcpAgentConfig } from '../src/mcp/project-mcp-agent-config.js';

test('McpBatchApprovalStore sessionBound uses longer idle lease', (): void => {
    const store = new McpBatchApprovalStore();
    const issued = store.issue({
        connectionId: 'b'.repeat(32),
        resources: ['db://assets/ui'],
        sessionBound: true,
    });
    assert.equal(issued.idleLeaseMs, McpBatchApprovalStore.sessionIdleLeaseMs);
    assert.equal(issued.maxHoldMs, McpBatchApprovalStore.sessionMaxHoldMs);
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'b'.repeat(32),
            operation: 'peanut.editor-mcp.lumen-comp-set',
            resources: ['db://assets/ui'],
            risk: 'write',
        }),
        true,
    );
});

test('McpBatchApprovalStore leases resources for idle window', (): void => {
    const store = new McpBatchApprovalStore();
    const issued = store.issue({
        connectionId: 'a'.repeat(32),
        resources: ['db://assets/ui'],
        operations: ['peanut.editor-mcp.asset-import'],
        idleLeaseMs: 10_000,
    });
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'a'.repeat(32),
            operation: 'peanut.editor-mcp.asset-import',
            resources: ['db://assets/ui'],
            risk: 'write',
        }),
        true,
    );
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'a'.repeat(32),
            operation: 'peanut.editor-mcp.asset-import',
            resources: ['db://assets/other'],
            risk: 'write',
        }),
        false,
    );
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'a'.repeat(32),
            operation: 'peanut.editor-mcp.asset-import',
            resources: ['db://assets/ui'],
            risk: 'destructive',
        }),
        false,
    );
});

test('ProjectMcpAgentConfig recommends Codex auto after server gates', (): void => {
    const toml = ProjectMcpAgentConfig.buildCodexToml({
        mcpUrl: 'http://127.0.0.1:9/mcp',
    });
    assert.match(toml, /default_tools_approval_mode = "auto"/);
    assert.match(toml, /url = "http:\/\/127\.0\.0\.1:9\/mcp"/);
});


test('McpBatchApprovalStore empty resources fail-closed on write', (): void => {
    const store = new McpBatchApprovalStore();
    const issued = store.issue({
        connectionId: 'conn-1',
        resources: ['db://assets/ui'],
        operations: ['asset.createFolder'],
        maxRisk: 'write',
    });
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'conn-1',
            operation: 'asset.createFolder',
            resources: [],
            risk: 'write',
        }),
        false,
    );
});

test('McpBatchApprovalStore assets/ and db://assets/ interop', (): void => {
    const store = new McpBatchApprovalStore();
    const issued = store.issue({
        connectionId: 'conn-1',
        resources: ['assets/ui/x'],
        operations: ['asset.createFolder'],
        maxRisk: 'write',
    });
    assert.equal(
        store.tryConsume(issued.token, {
            connectionId: 'conn-1',
            operation: 'asset.createFolder',
            resources: ['db://assets/ui/x'],
            risk: 'write',
        }),
        true,
    );
});

test('McpBatchApprovalStore validates a batch atomically before renewing leases', (): void => {
    const store = new McpBatchApprovalStore();
    const valid = store.issue({
        connectionId: 'conn-1',
        resources: ['assets/a'],
        operations: ['asset.writeText'],
        maxRisk: 'write',
    });
    const invalid = store.issue({
        connectionId: 'conn-1',
        resources: ['assets/b'],
        operations: ['asset.writeText'],
        maxRisk: 'write',
    });
    assert.equal(store.tryConsumeAll([
        {
            token: valid.token,
            request: {
                connectionId: 'conn-1',
                operation: 'asset.writeText',
                resources: ['assets/a'],
                risk: 'write',
            },
        },
        {
            token: invalid.token,
            request: {
                connectionId: 'conn-1',
                operation: 'asset.writeText',
                resources: ['assets/not-b'],
                risk: 'write',
            },
        },
    ]), false);
});
