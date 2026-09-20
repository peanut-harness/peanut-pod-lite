import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { CoreCocosMcpToolDefinitionCatalog } from '../dist/index.js';

const fixtureUrl = new URL('./fixtures/legacy-editor-scene-prefab-contract.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const operationScope = /^(editor|scene|prefab)\./u;
const excludedControlProperties = new Set(['approvalId', 'execution', 'proPlan']);

function normalizeSchema(schema) {
    const normalized = { type: schema.type };
    if (schema.enum != null) {
        normalized.enum = [...schema.enum].sort();
    }
    if (schema.items != null) {
        normalized.items = normalizeSchema(schema.items);
    }
    if (schema.properties != null) {
        normalized.properties = Object.fromEntries(
            Object.entries(schema.properties)
                .filter(([name]) => !excludedControlProperties.has(name))
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([name, propertySchema]) => [name, normalizeSchema(propertySchema)]),
        );
    }
    if (schema.type === 'object') {
        normalized.required = [...(schema.required ?? [])].sort();
    }
    if (schema.additionalProperties != null) {
        normalized.additionalProperties = schema.additionalProperties;
    }
    return normalized;
}

function byOperation(left, right) {
    return left.operation.localeCompare(right.operation);
}

test('Editor/Scene/Prefab Lite definitions preserve the normalized legacy contract', () => {
    assert.equal(fixture.source, 'peanut-agents/products/cocos/editor/plugins/integrations/editor-mcp');
    assert.deepEqual(fixture.normalization, {
        ignoredSchemaFields: ['description'],
        excludedControlProperties: ['approvalId', 'execution', 'proPlan'],
    });

    const expected = [...fixture.definitions].sort(byOperation);
    assert.equal(expected.length, 21);
    assert.equal(new Set(expected.map(({ operation }) => operation)).size, expected.length);
    assert.ok(expected.every(({ operation }) => operationScope.test(operation)));

    const catalog = new CoreCocosMcpToolDefinitionCatalog();
    const actual = catalog
        .list()
        .filter(({ operation }) => operationScope.test(operation))
        .map(({ operation, inputSchema, readOnly, risk }) => ({
            operation,
            schema: normalizeSchema(inputSchema),
            readOnly,
            risk,
        }))
        .sort(byOperation);

    assert.deepEqual(actual, expected);
});

test('Pro preview capture and SnowB operations do not enter the Lite Core catalog', () => {
    const catalog = new CoreCocosMcpToolDefinitionCatalog();
    assert.equal(catalog.findByOperation('preview.capture'), null);
    assert.equal(catalog.findByOperation('snowb.bmfont.export'), null);
    assert.ok(fixture.definitions.every(({ operation }) => operation !== 'preview.capture' && !operation.startsWith('snowb.')));
});
