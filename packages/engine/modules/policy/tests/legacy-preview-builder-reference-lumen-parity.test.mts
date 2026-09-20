import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
    CoreCocosMcpToolDefinitionCatalog,
    isProExclusiveCocosOperation,
    listLitePublicOperations,
} from '../dist/index.js';

const fixtureUrl = new URL(
    './fixtures/legacy-preview-builder-reference-lumen-contract.json',
    import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const operationScope = /^(preview|builder|reference|lumen)\./u;
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

test('Preview/Builder/Reference/Lumen Lite definitions preserve the normalized legacy contract', () => {
    assert.equal(
        fixture.source,
        'peanut-agents/products/cocos/editor/plugins/integrations/editor-mcp/src/editor-mcp-tool-catalog.ts',
    );
    assert.equal(
        fixture.metadataSource,
        'peanut-agents/products/cocos/editor/plugins/integrations/editor-mcp/src/editor-mcp-capability-catalog.ts',
    );
    assert.deepEqual(fixture.normalization, {
        ignoredSchemaFields: ['description'],
        excludedControlProperties: ['approvalId', 'execution', 'proPlan'],
    });

    const expected = [...fixture.definitions].sort(byOperation);
    assert.equal(expected.length, 35);
    assert.equal(new Set(expected.map(({ operation }) => operation)).size, expected.length);
    assert.ok(expected.every(({ operation }) => operationScope.test(operation)));
    assert.deepEqual(
        expected.filter(({ operation }) => operation.startsWith('preview.')).map(({ operation }) => operation),
        ['preview.query', 'preview.queryErrors', 'preview.refresh'],
    );

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

test('Lite 83 keeps preview capture and SnowB Pro-exclusive', () => {
    const operations = listLitePublicOperations();
    const catalog = new CoreCocosMcpToolDefinitionCatalog();

    assert.equal(operations.length, 83);
    assert.equal(operations.includes('preview.capture'), false);
    assert.equal(operations.includes('snowb.bmfont.export'), false);
    assert.equal(operations.some((operation) => operation.startsWith('snowb.')), false);
    assert.equal(catalog.findByOperation('preview.capture'), null);
    assert.equal(catalog.findByOperation('snowb.bmfont.export'), null);
    assert.equal(isProExclusiveCocosOperation('preview.capture'), true);
    assert.equal(isProExclusiveCocosOperation('snowb.bmfont.export'), true);
    assert.ok(
        fixture.definitions.every(
            ({ operation }) => operation !== 'preview.capture' && !operation.startsWith('snowb.'),
        ),
    );
});
