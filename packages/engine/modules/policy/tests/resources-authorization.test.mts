import assert from 'node:assert/strict';
import test from 'node:test';

import {
    McpApprovalLeaseStore,
    CoreCocosMcpExecutionDispatcher,
    normalizeResourceKey,
    normalizeResourceKeys,
    extractWriteResources,
    resolveAuthorizedResources,
} from '../dist/index.js';

test('normalizeResourceKey: assets ↔ db://assets, slash, trim', () => {
    assert.equal(normalizeResourceKey('  assets/ui/a.png  '), 'db://assets/ui/a.png');
    assert.equal(normalizeResourceKey('db://assets/ui/a.png'), 'db://assets/ui/a.png');
    assert.equal(normalizeResourceKey('assets\\ui\\a.png'), 'db://assets/ui/a.png');
    assert.equal(normalizeResourceKey('db://assets'), 'db://assets');
});

test('normalizeResourceKey: uuid kept (no resolver); resolver maps to db', () => {
    const uuid = 'A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
    assert.equal(normalizeResourceKey(uuid), uuid.toLowerCase());
    assert.equal(
        normalizeResourceKey(uuid, {
            resolveUuidToDbPath: () => 'assets/ui/Mapped.png',
        }),
        'db://assets/ui/Mapped.png',
    );
    assert.equal(normalizeResourceKey(`${uuid}@spriteFrame`), `${uuid.toLowerCase()}@spriteFrame`);
});

test('lease consume: assets/ and db://assets/ interop after normalize', () => {
    const store = new McpApprovalLeaseStore();
    const lease = store.issue({
        connectionId: 'c1',
        resources: ['assets/__t/child'],
        operations: ['asset.createFolder'],
    });
    assert.equal(
        store.consume(lease.token, {
            connectionId: 'c1',
            operation: 'asset.createFolder',
            resources: ['db://assets/__t/child'],
            risk: 'write',
        }),
        true,
    );
});

test('lease consume: parent prefix does NOT cover child (strategy A)', () => {
    const store = new McpApprovalLeaseStore();
    const lease = store.issue({
        connectionId: 'c1',
        resources: ['db://assets/__t'],
        operations: ['asset.createFolder'],
    });
    assert.equal(
        store.consume(lease.token, {
            connectionId: 'c1',
            operation: 'asset.createFolder',
            resources: ['db://assets/__t/child'],
            risk: 'write',
        }),
        false,
    );
});

test('extract: createFolder uses final path; replaceReferences takes uuids; no whole-tree fallback', () => {
    assert.deepEqual(
        extractWriteResources('asset.createFolder', { path: 'assets/__t/child' }),
        ['db://assets/__t/child'],
    );
    const from = '11111111-1111-1111-1111-111111111111';
    const to = '22222222-2222-2222-2222-222222222222';
    assert.deepEqual(
        extractWriteResources('asset.replaceReferences', { fromUuid: from, toUuid: to }),
        [from, to],
    );
    assert.deepEqual(extractWriteResources('asset.replaceReferences', {}), []);
    assert.deepEqual(extractWriteResources('asset.catalog.refresh', {}), ['db://assets']);
});

test('resolveAuthorizedResources: declared cannot replace derived (越权拒)', () => {
    const auth = resolveAuthorizedResources(
        'asset.createFolder',
        { path: 'assets/other/x', resources: ['db://assets/ui'] },
        null,
    );
    assert.ok(auth.includes('db://assets/other/x'));
    assert.ok(auth.includes('db://assets/ui'));
});

test('dispatcher: wrong bind / 越权 declared+path refused; normalized bind passes', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher(
        [{ operations: ['asset.createFolder'], execute: async () => ++calls }],
        leases,
    );

    // 租约仅 ui；context 含 other（推导）+ ui（声明）→ 拒
    const forged = leases.issue({
        connectionId: 'local-a',
        resources: ['db://assets/ui'],
        operations: ['asset.createFolder'],
    });
    const forgedCtx = {
        connectionId: 'local-a',
        resources: resolveAuthorizedResources('asset.createFolder', {
            path: 'assets/other/x',
            resources: ['db://assets/ui'],
        }),
    };
    await assert.rejects(
        dispatcher.execute(
            'asset.createFolder',
            { path: 'assets/other/x', resources: ['db://assets/ui'], approvalId: forged.token },
            forgedCtx,
        ),
        /approval_required/u,
    );
    assert.equal(calls, 0);

    // 错绑：lease 签 A，请求 B
    const wrong = leases.issue({
        connectionId: 'local-a',
        resources: ['db://assets/A'],
        operations: ['asset.createFolder'],
    });
    await assert.rejects(
        dispatcher.execute(
            'asset.createFolder',
            { path: 'assets/B', approvalId: wrong.token },
            { connectionId: 'local-a', resources: ['db://assets/B'] },
        ),
        /approval_required/u,
    );

    // 归一互通：lease 签 assets/...，context 用 db://...
    const ok = leases.issue({
        connectionId: 'local-a',
        resources: ['assets/__t/child'],
        operations: ['asset.createFolder'],
    });
    assert.equal(
        await dispatcher.execute(
            'asset.createFolder',
            { path: 'assets/__t/child', approvalId: ok.token },
            { connectionId: 'local-a', resources: ['db://assets/__t/child'] },
        ),
        1,
    );
    assert.equal(calls, 1);

});

test('dispatcher: replaceReferences uuid bind / wrong uuid refuse', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher(
        [{ operations: ['asset.replaceReferences'], execute: async () => ++calls }],
        leases,
    );
    const from = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const to = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
    const ctx = { connectionId: 'local-a', resources: normalizeResourceKeys([from, to]) };

    await assert.rejects(
        dispatcher.execute(
            'asset.replaceReferences',
            { fromUuid: from, toUuid: to, confirmDestructive: true },
            ctx,
        ),
        /approval_required/u,
    );

    const lease = leases.issue({
        connectionId: 'local-a',
        resources: [from, to],
        operations: ['asset.replaceReferences'],
        maxRisk: 'destructive',
    });
    assert.equal(
        await dispatcher.execute(
            'asset.replaceReferences',
            { fromUuid: from, toUuid: to, approvalId: lease.token, confirmDestructive: true },
            ctx,
        ),
        1,
    );

    const wrongLease = leases.issue({
        connectionId: 'local-a',
        resources: [from, 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'],
        operations: ['asset.replaceReferences'],
        maxRisk: 'destructive',
    });
    await assert.rejects(
        dispatcher.execute(
            'asset.replaceReferences',
            { fromUuid: from, toUuid: to, approvalId: wrongLease.token, confirmDestructive: true },
            ctx,
        ),
        /approval_required/u,
    );
    assert.equal(calls, 1);
});

test('empty authorized resources fail-closed at dispatcher', async () => {
    let calls = 0;
    const leases = new McpApprovalLeaseStore();
    const dispatcher = new CoreCocosMcpExecutionDispatcher(
        [{ operations: ['asset.replaceReferences'], execute: async () => ++calls }],
        leases,
    );
    const from = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const to = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';
    const lease = leases.issue({
        connectionId: 'local-a',
        resources: ['db://assets'],
        operations: ['asset.replaceReferences'],
        maxRisk: 'destructive',
    });
    // schema has from/to, but empty context.resources => fail-closed
    await assert.rejects(
        dispatcher.execute(
            'asset.replaceReferences',
            { fromUuid: from, toUuid: to, approvalId: lease.token, confirmDestructive: true },
            { connectionId: 'local-a', resources: [] },
        ),
        /approval_required/u,
    );
    assert.equal(calls, 0);
    assert.deepEqual(extractWriteResources('asset.replaceReferences', {}), []);
    assert.deepEqual(
        resolveAuthorizedResources('asset.replaceReferences', { fromUuid: from, toUuid: to }),
        [from, to],
    );
});
