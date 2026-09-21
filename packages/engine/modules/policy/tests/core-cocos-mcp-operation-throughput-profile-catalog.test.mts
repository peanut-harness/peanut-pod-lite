import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CoreCocosMcpOperationThroughputProfileCatalog,
    CoreCocosMcpToolDefinitionCatalog,
} from '../dist/index.js';

test('throughput profiles cover the Lite 83 exactly and preserve 38 read / 45 write classification', () => {
    const profiles = new CoreCocosMcpOperationThroughputProfileCatalog().list();
    const definitions = new CoreCocosMcpToolDefinitionCatalog().list();

    assert.equal(profiles.length, 83);
    assert.equal(new Set(profiles.map((profile) => profile.operation)).size, 83);
    assert.equal(profiles.filter((profile) => profile.readOnly).length, 38);
    assert.equal(profiles.filter((profile) => !profile.readOnly).length, 45);
    assert.deepEqual(
        profiles.map((profile) => profile.operation).sort(),
        definitions.map((definition) => definition.operation).sort(),
    );
    for (const profile of profiles) {
        const definition = definitions.find((item) => item.operation === profile.operation);
        assert.ok(definition);
        assert.equal(profile.readOnly, definition.readOnly);
        assert.equal(profile.risk, definition.risk);
        assert.equal(profile.readOnly ? profile.write : profile.read, null);
    }
});

test('profiles expose conservative read consistency and strict batch allow-lists', () => {
    const catalog = new CoreCocosMcpOperationThroughputProfileCatalog();

    assert.deepEqual(catalog.find('editor.queryVersion'), {
        operation: 'editor.queryVersion',
        readOnly: true,
        risk: 'read',
        costClass: 'read_light',
        read: { coalescing: 'project', cache: 'revision_lru', consistency: 'revision_validated' },
        write: null,
    });
    assert.equal(catalog.find('scene.getHierarchy')?.costClass, 'read_heavy');
    assert.equal(catalog.find('scene.getHierarchy')?.read?.consistency, 'writer_barrier');
    assert.equal(catalog.find('lumen.compileRecipe')?.costClass, 'prepare');
    assert.equal(catalog.find('builder.build')?.costClass, 'writer');
    assert.equal(catalog.find('builder.build')?.write?.explicitBatchEligible, false);
    assert.equal(catalog.find('lumen.compSet')?.write?.explicitBatchEligible, true);
    assert.equal(catalog.find('lumen.compSet')?.write?.automaticBatchEligible, true);
    assert.equal(catalog.find('lumen.nodeRm')?.write?.automaticBatchEligible, false);
    assert.equal(catalog.find('preview.capture'), null);
});

test('profile validation rejects missing, duplicate and wrong read/write classification', () => {
    const profiles = new CoreCocosMcpOperationThroughputProfileCatalog().list();
    const first = profiles[0];
    assert.ok(first);

    assert.throws(
        () => CoreCocosMcpOperationThroughputProfileCatalog.validate(profiles.slice(1)),
        /core_cocos_mcp_throughput_profile_missing:/u,
    );
    assert.throws(
        () => CoreCocosMcpOperationThroughputProfileCatalog.validate([...profiles, first]),
        /core_cocos_mcp_throughput_profile_duplicate:/u,
    );
    assert.throws(
        () => CoreCocosMcpOperationThroughputProfileCatalog.validate([
            { ...first, readOnly: false },
            ...profiles.slice(1),
        ]),
        /core_cocos_mcp_throughput_profile_classification_mismatch:/u,
    );
});

test('profile validation rejects unsafe cache and automatic batch shapes', () => {
    const profiles = new CoreCocosMcpOperationThroughputProfileCatalog().list();
    const versionIndex = profiles.findIndex((profile) => profile.operation === 'editor.queryVersion');
    const compSetIndex = profiles.findIndex((profile) => profile.operation === 'lumen.compSet');
    assert.notEqual(versionIndex, -1);
    assert.notEqual(compSetIndex, -1);

    const unsafeCache = [...profiles];
    const version = unsafeCache[versionIndex];
    assert.ok(version?.read);
    unsafeCache[versionIndex] = { ...version, read: { ...version.read, coalescing: 'none' } };
    assert.throws(
        () => CoreCocosMcpOperationThroughputProfileCatalog.validate(unsafeCache),
        /core_cocos_mcp_throughput_profile_cache_without_coalescing:editor\.queryVersion/u,
    );

    const unsafeBatch = [...profiles];
    const compSet = unsafeBatch[compSetIndex];
    assert.ok(compSet?.write);
    unsafeBatch[compSetIndex] = {
        ...compSet,
        write: { ...compSet.write, explicitBatchEligible: false, automaticBatchEligible: true },
    };
    assert.throws(
        () => CoreCocosMcpOperationThroughputProfileCatalog.validate(unsafeBatch),
        /core_cocos_mcp_throughput_profile_auto_batch_without_explicit:lumen\.compSet/u,
    );
});
