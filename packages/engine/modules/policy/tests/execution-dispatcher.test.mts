import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CoreCocosMcpExecutionDispatcher, McpApprovalLeaseStore } from '../dist/index.js';

test('write execution consumes a lease bound to connection, operation and resources', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['scene.save'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['scene:active'] };
    await assert.rejects(dispatcher.execute('scene.save', { approvalId: 'forged' }, context), /approval_required/u);
    const lease = leases.issue({ ...context, operations: ['scene.save'] });
    await assert.rejects(dispatcher.execute('scene.save', { approvalId: lease.token }), /approval_required/u);
    await assert.rejects(
        dispatcher.execute('scene.save', { approvalId: lease.token }, { ...context, connectionId: 'local-b' }),
        /approval_required/u,
    );
    await assert.rejects(
        dispatcher.execute('scene.save', { approvalId: lease.token }, { ...context, resources: ['scene:other'] }),
        /approval_required/u,
    );
    assert.equal(calls, 0);
    await assert.rejects(
        dispatcher.execute('scene.save', { approvalId: lease.token }, { ...context, resources: [' '] }),
        /approval_required/u,
    );
    assert.equal(await dispatcher.execute('scene.save', { approvalId: lease.token }, context), 1);
    leases.revoke(lease.token);
    await assert.rejects(dispatcher.execute('scene.save', { approvalId: lease.token }, context), /approval_required/u);
    assert.equal(calls, 1);
});

test('read execution needs no approval and malformed input never reaches the runtime', async () => {
    let calls = 0;
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['editor.queryVersion'], execute: async () => ++calls }]);
    await assert.rejects(dispatcher.execute('editor.queryVersion', { injected: true }), /schema_invalid/u);
    assert.equal(calls, 0);
    assert.equal(await dispatcher.execute('editor.queryVersion', {}), 1);
    await assert.rejects(dispatcher.execute('preview.capture', {}), /operation_not_public/u);
});


test('write execution accepts approvalId or approvalToken alias and prefers approvalId', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['scene.save'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['scene:active'] };

    await assert.rejects(dispatcher.execute('scene.save', {}, context), /approval_required/u);
    await assert.rejects(dispatcher.execute('scene.save', { approvalId: '   ', approvalToken: '   ' }, context), /approval_required/u);
    assert.equal(calls, 0);

    const leaseIdOnly = leases.issue({ ...context, operations: ['scene.save'] });
    assert.equal(await dispatcher.execute('scene.save', { approvalId: leaseIdOnly.token }, context), 1);

    const leaseTokenOnly = leases.issue({ ...context, operations: ['scene.save'] });
    assert.equal(await dispatcher.execute('scene.save', { approvalToken: leaseTokenOnly.token }, context), 2);

    const preferred = leases.issue({ ...context, operations: ['scene.save'] });
    const other = leases.issue({ ...context, operations: ['scene.save'] });
    // both present: prefer approvalId even when approvalToken is also valid
    assert.equal(
        await dispatcher.execute(
            'scene.save',
            { approvalId: preferred.token, approvalToken: other.token },
            context,
        ),
        3,
    );
    // forged approvalId must not fall through to a valid approvalToken
    await assert.rejects(
        dispatcher.execute(
            'scene.save',
            { approvalId: 'forged-prefer-id', approvalToken: other.token },
            context,
        ),
        /approval_required/u,
    );
    // valid approvalId + forged token still succeeds (id wins)
    assert.equal(
        await dispatcher.execute(
            'scene.save',
            { approvalId: preferred.token, approvalToken: 'forged-token' },
            context,
        ),
        4,
    );
    assert.equal(calls, 4);
});

test('write schema accepts approvalToken without schema_invalid', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['scene.createNode'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['scene:active'] };
    const lease = leases.issue({ ...context, operations: ['scene.createNode'] });
    assert.equal(
        await dispatcher.execute(
            'scene.createNode',
            { name: 'n', approvalToken: lease.token },
            context,
        ),
        1,
    );
    assert.equal(calls, 1);
});

test('a write lease cannot authorize destructive work', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['asset.delete'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['db://assets/test.txt'] };
    const lease = leases.issue({ ...context, operations: ['asset.delete'], maxRisk: 'write' });
    await assert.rejects(
        dispatcher.execute(
            'asset.delete',
            { approvalId: lease.token, paths: ['test.txt'], confirmDestructive: true },
            context,
        ),
        /approval_required/u,
    );
    assert.equal(calls, 0);
});

test('prefab detach and builder output replacement are destructive', async () => {
    const { CoreCocosMcpToolDefinitionCatalog } = await import('../dist/index.js');
    const catalog = new CoreCocosMcpToolDefinitionCatalog();
    for (const operation of ['prefab.unpack', 'prefab.unlink', 'builder.build']) {
        const definition = catalog.findByOperation(operation);
        assert.ok(definition);
        assert.equal(definition.risk, 'destructive');
    }
});


test('write schema accepts resources without schema_invalid', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['asset.catalog.refresh'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['db://assets/tmp'] };
    const lease = leases.issue({ ...context, operations: ['asset.catalog.refresh'], maxRisk: 'write' });
    assert.equal(
        await dispatcher.execute(
            'asset.catalog.refresh',
            {
                approvalToken: lease.token,
                resources: ['db://assets/tmp', 'db://assets'],
            },
            context,
        ),
        1,
    );
    assert.equal(calls, 1);
});

test('write schema accepts confirmDestructive without schema_invalid', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher([{ operations: ['lumen.nodeRm'], execute: async () => ++calls }], leases);
    const context = { connectionId: 'local-a', resources: ['db://assets/ui/Demo.prefab'] };
    const lease = leases.issue({ ...context, operations: ['lumen.nodeRm'], maxRisk: 'destructive' });
    assert.equal(
        await dispatcher.execute(
            'lumen.nodeRm',
            {
                prefabRelativePath: 'assets/ui/Demo.prefab',
                nodePath: '/Demo/Child',
                approvalToken: lease.token,
                confirmDestructive: true,
            },
            context,
        ),
        1,
    );
    assert.equal(calls, 1);
});


test('P2: importPlan/managedStatus are read-only (no lease); asset.open requires control()+lease', async () => {
    const { CoreCocosMcpToolDefinitionCatalog } = await import('../dist/index.js');
    const catalog = new CoreCocosMcpToolDefinitionCatalog();

    const importPlan = catalog.findByOperation('asset.importPlan');
    const managedStatus = catalog.findByOperation('asset.managedStatus');
    const open = catalog.findByOperation('asset.open');
    assert.ok(importPlan);
    assert.ok(managedStatus);
    assert.ok(open);
    assert.equal(importPlan.readOnly, true);
    assert.equal(importPlan.requiresLocalApproval, false);
    assert.equal(importPlan.risk, 'read');
    assert.equal(managedStatus.readOnly, true);
    assert.equal(managedStatus.requiresLocalApproval, false);
    assert.equal(managedStatus.risk, 'read');
    assert.equal(open.readOnly, false);
    assert.equal(open.requiresLocalApproval, true);
    assert.equal(open.risk, 'write');
    for (const key of ['approvalId', 'approvalToken', 'confirmDestructive', 'resources']) {
        assert.ok(open.inputSchema.properties?.[key], `asset.open schema missing ${key}`);
        assert.equal(importPlan.inputSchema.properties?.[key], undefined);
        assert.equal(managedStatus.inputSchema.properties?.[key], undefined);
    }

    let planCalls = 0;
    let statusCalls = 0;
    let openCalls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher(
        [
            {
                operations: ['asset.importPlan', 'asset.managedStatus', 'asset.open'],
                execute: async (request) => {
                    if (request.operation === 'asset.importPlan') {
                        return ++planCalls;
                    }
                    if (request.operation === 'asset.managedStatus') {
                        return ++statusCalls;
                    }
                    return ++openCalls;
                },
            },
        ],
        leases,
    );

    // read-only: no lease, no approval fields
    assert.equal(await dispatcher.execute('asset.importPlan', { sources: ['D:/tmp/a.png'] }), 1);
    assert.equal(await dispatcher.execute('asset.managedStatus', { targets: ['db://assets/a.png'] }), 1);
    // read-only must reject unexpected control fields (additionalProperties:false)
    await assert.rejects(
        dispatcher.execute('asset.importPlan', { sources: ['D:/tmp/a.png'], approvalToken: 'x' }),
        /schema_invalid/u,
    );

    const context = { connectionId: 'local-a', resources: ['db://assets/Main.scene'] };
    await assert.rejects(dispatcher.execute('asset.open', { path: 'db://assets/Main.scene' }, context), /approval_required/u);
    assert.equal(openCalls, 0);

    const lease = leases.issue({ ...context, operations: ['asset.open'], maxRisk: 'write' });
    assert.equal(
        await dispatcher.execute(
            'asset.open',
            {
                path: 'db://assets/Main.scene',
                approvalToken: lease.token,
                resources: ['db://assets/Main.scene'],
            },
            context,
        ),
        1,
    );
    assert.equal(openCalls, 1);
    assert.equal(planCalls, 1);
    assert.equal(statusCalls, 1);
});
