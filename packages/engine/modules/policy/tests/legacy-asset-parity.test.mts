import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    CoreCocosMcpExecutionDispatcher,
    CoreCocosMcpToolDefinitionCatalog,
    McpApprovalLeaseStore,
    resolveAuthorizedResources,
} from '../dist/index.js';

const contract = readFixture('legacy-asset-contract.json');
const security = readFixture('legacy-asset-security-cases.json');
const catalog = new CoreCocosMcpToolDefinitionCatalog();

function readFixture(name) {
    return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

function schemaValue(schema) {
    if (schema.type === 'array') {
        const item = schemaValue(schema.items);
        return typeof item === 'string' ? `${item}[]` : { type: 'array', items: item };
    }
    if (schema.type === 'object') {
        if (schema.additionalProperties === true && schema.properties == null) {
            return 'object:*';
        }
        return {
            type: 'object',
            required: [...(schema.required ?? [])],
            additionalProperties: schema.additionalProperties,
            properties: Object.fromEntries(
                Object.entries(schema.properties ?? {}).map(([name, child]) => [name, schemaValue(child)]),
            ),
        };
    }
    if (schema.enum != null) {
        return { type: schema.type, enum: [...schema.enum] };
    }
    return schema.type;
}

function schemaContract(schema) {
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    return {
        required: [...(schema.required ?? [])],
        properties: Object.fromEntries(
            Object.entries(schema.properties ?? {}).map(([name, child]) => [name, schemaValue(child)]),
        ),
    };
}

test('legacy AssetDB operation set is split into 15 reads and 12 locally approved writes', () => {
    const readOperations = Object.keys(contract.readOperations);
    const writeOperations = Object.keys(contract.writeOperations);
    assert.equal(readOperations.length, 15);
    assert.equal(writeOperations.length, 12);
    assert.equal(readOperations.some((operation) => writeOperations.includes(operation)), false);

    const actual = catalog.list().filter((definition) => definition.operation.startsWith('asset.'));
    assert.deepEqual(
        new Set(actual.map((definition) => definition.operation)),
        new Set([...readOperations, ...writeOperations]),
    );
});

test('legacy AssetDB business schemas and the Lite approval overlay stay frozen', () => {
    for (const [operation, expected] of Object.entries(contract.readOperations)) {
        const definition = catalog.findByOperation(operation);
        assert.ok(definition, operation);
        assert.equal(definition.readOnly, true, operation);
        assert.equal(definition.risk, 'read', operation);
        assert.equal(definition.requiresLocalApproval, false, operation);
        assert.deepEqual(schemaContract(definition.inputSchema), expected, operation);
    }

    for (const [operation, expected] of Object.entries(contract.writeOperations)) {
        const definition = catalog.findByOperation(operation);
        assert.ok(definition, operation);
        assert.equal(definition.readOnly, false, operation);
        assert.equal(definition.risk, expected.liteRisk, operation);
        assert.equal(definition.requiresLocalApproval, true, operation);
        assert.deepEqual(
            schemaContract(definition.inputSchema),
            {
                required: expected.required,
                properties: { ...expected.properties, ...contract.writeControlProperties },
            },
            operation,
        );
    }
});

test('Lite preserves legacy AssetDB risk groups with one explicit safety escalation', () => {
    const escalations = [];
    for (const [operation, expected] of Object.entries(contract.writeOperations)) {
        if (expected.legacyRisk !== expected.liteRisk) {
            escalations.push({ operation, legacyRisk: expected.legacyRisk, liteRisk: expected.liteRisk });
        }
    }
    assert.deepEqual(escalations, [
        { operation: 'asset.replaceReferences', legacyRisk: 'write', liteRisk: 'destructive' },
    ]);
});

test('AssetDB reads execute without approval while every write requires and consumes a scoped lease', async () => {
    for (const [operation, input] of Object.entries(security.readInputs)) {
        let calls = 0;
        const dispatcher = new CoreCocosMcpExecutionDispatcher([
            { operations: [operation], execute: async () => ++calls },
        ]);
        assert.equal(await dispatcher.execute(operation, input), 1, operation);
        assert.equal(calls, 1, operation);
    }

    for (const [operation, input] of Object.entries(security.writeInputs)) {
        let calls = 0;
        const leases = new McpApprovalLeaseStore();
        const dispatcher = new CoreCocosMcpExecutionDispatcher(
            [{ operations: [operation], execute: async () => ++calls }],
            leases,
        );
        const resources = resolveAuthorizedResources(operation, input);
        const context = { connectionId: 'assetdb-parity', resources };
        await assert.rejects(dispatcher.execute(operation, input, context), /approval_required/u, operation);
        assert.equal(calls, 0, operation);

        const definition = catalog.findByOperation(operation);
        assert.ok(definition, operation);
        const lease = leases.issue({
            ...context,
            operations: [operation],
            maxRisk: definition.risk === 'destructive' ? 'destructive' : 'write',
        });
        assert.equal(
            await dispatcher.execute(operation, { ...input, approvalId: lease.token }, context),
            1,
            operation,
        );
        assert.equal(calls, 1, operation);
    }
});

test('a scoped asset lease refuses legacy path-escape inputs before an adapter runs', async () => {
    for (const { operation, input, leaseResources } of security.pathTraversalCases) {
        let calls = 0;
        const leases = new McpApprovalLeaseStore();
        const dispatcher = new CoreCocosMcpExecutionDispatcher(
            [{ operations: [operation], execute: async () => ++calls }],
            leases,
        );
        const lease = leases.issue({
            connectionId: 'assetdb-path-guard',
            resources: leaseResources,
            operations: [operation],
            maxRisk: 'destructive',
        });
        const context = {
            connectionId: 'assetdb-path-guard',
            resources: resolveAuthorizedResources(operation, input),
        };
        await assert.rejects(
            dispatcher.execute(operation, { ...input, approvalId: lease.token }, context),
            /resource_path_invalid/u,
            operation,
        );
        assert.equal(calls, 0, operation);
    }
});

test(
    'policy refuses a path escape even when a caller mistakenly obtains a lease for the escaped resource',
    async () => {
        const operation = 'asset.writeText';
        const input = { path: 'assets/../../package.json', content: '{}' };
        const resources = resolveAuthorizedResources(operation, input);
        let calls = 0;
        const leases = new McpApprovalLeaseStore();
        const dispatcher = new CoreCocosMcpExecutionDispatcher(
            [{ operations: [operation], execute: async () => ++calls }],
            leases,
        );
        const context = { connectionId: 'assetdb-escaped-lease', resources };
        const lease = leases.issue({ ...context, operations: [operation] });
        await assert.rejects(
            dispatcher.execute(operation, { ...input, approvalId: lease.token }, context),
            /path|schema_invalid|approval_required/u,
        );
        assert.equal(calls, 0);
    },
);

test(
    'asset.import overwrite/override upgrades to destructive authorization as in legacy planning',
    async () => {
        const operation = 'asset.import';
        const input = { sources: ['/tmp/source.png'], target: 'assets/imported', overwrite: true };
        const resources = resolveAuthorizedResources(operation, input);
        let calls = 0;
        const leases = new McpApprovalLeaseStore();
        const dispatcher = new CoreCocosMcpExecutionDispatcher(
            [{ operations: [operation], execute: async () => ++calls }],
            leases,
        );
        const context = { connectionId: 'assetdb-import-overwrite', resources };
        const lease = leases.issue({ ...context, operations: [operation], maxRisk: 'write' });
        await assert.rejects(
            dispatcher.execute(operation, { ...input, approvalId: lease.token, confirmDestructive: true }, context),
            /approval_required/u,
        );
        assert.equal(calls, 0);
    },
);

test(
    'destructive AssetDB operations require confirmDestructive in addition to a destructive lease',
    async () => {
        const operation = 'asset.delete';
        const input = { paths: ['assets/ui/obsolete.prefab'] };
        const resources = resolveAuthorizedResources(operation, input);
        let calls = 0;
        const leases = new McpApprovalLeaseStore();
        const dispatcher = new CoreCocosMcpExecutionDispatcher(
            [{ operations: [operation], execute: async () => ++calls }],
            leases,
        );
        const context = { connectionId: 'assetdb-destructive-confirm', resources };
        const lease = leases.issue({ ...context, operations: [operation], maxRisk: 'destructive' });
        await assert.rejects(
            dispatcher.execute(operation, { ...input, approvalId: lease.token }, context),
            /confirmation|required/u,
        );
        assert.equal(calls, 0);
    },
);
