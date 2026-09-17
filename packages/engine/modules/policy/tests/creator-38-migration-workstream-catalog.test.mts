import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CoreCocosMcpToolDefinitionCatalog,
    Creator38MigrationWorkstreamCatalog,
    type Creator38MigrationWorkstream,
} from '../dist/index.js';

test('Creator 3.8.7 workstreams partition all 83 Lite operations exactly once', () => {
    const definitions = new CoreCocosMcpToolDefinitionCatalog().list();
    const entries = new Creator38MigrationWorkstreamCatalog().list();
    const counts = new Map<Creator38MigrationWorkstream, number>();

    for (const entry of entries) {
        counts.set(entry.workstream, (counts.get(entry.workstream) ?? 0) + 1);
    }

    assert.equal(entries.length, 83);
    assert.equal(new Set(entries.map((entry) => entry.operation)).size, 83);
    assert.deepEqual(
        [...entries].map((entry) => entry.operation).sort(),
        [...definitions].map((definition) => definition.operation).sort(),
    );
    assert.deepEqual(Object.fromEntries(counts), {
        'editor-scene-prefab': 21,
        'asset-read': 15,
        'asset-write': 12,
        'preview-builder-reference': 9,
        lumen: 26,
    });
});

test('Creator 3.8.7 workstreams keep Pro and unknown operations outside Lite', () => {
    const catalog = new Creator38MigrationWorkstreamCatalog();

    assert.equal(catalog.find('preview.capture'), null);
    assert.equal(catalog.find('snowb.bmfont.export'), null);
    assert.equal(catalog.find('ui-prefab.generate'), null);
    assert.equal(catalog.find(''), null);
    assert.equal(catalog.find(null), null);
});
