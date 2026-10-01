import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    EditorMcpGatewayAdapter,
    isProExclusiveCocosOperation,
    listLitePublicOperations,
} from '../dist/index.js';

test('Lite public catalog is 84 operations and excludes Pro capture/snowb', () => {
    const operations = listLitePublicOperations();
    assert.equal(operations.length, 84);
    assert.equal(operations.includes('preview.capture'), false);
    assert.equal(operations.some((operation) => operation.includes('snowb')), false);
    assert.equal(isProExclusiveCocosOperation('preview.capture'), true);
    assert.equal(isProExclusiveCocosOperation('snowb.export'), true);
    assert.equal(isProExclusiveCocosOperation('editor.queryVersion'), false);
});

test('gateway adapter forwards all 84 ids through the injected router port', async () => {
    const seen: string[] = [];
    const adapter = new EditorMcpGatewayAdapter(async (operation, input) => {
        seen.push(operation);
        return { operation, echoed: input };
    });
    assert.equal(adapter.operations.length, 84);
    assert.equal(adapter.operations.includes('preview.capture'), false);
    const result = await adapter.execute({ operation: 'scene.save', input: { path: 'db://assets/main.scene' } });
    assert.deepEqual(result, { operation: 'scene.save', echoed: { path: 'db://assets/main.scene' } });
    assert.deepEqual(seen, ['scene.save']);
    for (const operation of adapter.operations) {
        await adapter.execute({ operation, input: {} });
    }
    assert.equal(seen.length, 85);
});
