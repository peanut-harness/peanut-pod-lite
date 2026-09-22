import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createLiteReleaseDescriptor, synchronizeReleaseIdentity } from '../release-identity.mjs';

test('root version drives Host, Core, release directory, and descriptor identity', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    const identity = synchronizeReleaseIdentity(repositoryRoot, true);
    const hostPackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/hosts/modules/creator-38/package.json'), 'utf8'));
    const corePackage = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/engine/modules/creator-plugin/package.json'), 'utf8'));
    const coreManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/engine/modules/creator-plugin/peanut.pod-lite.manifest.json'), 'utf8'));
    assert.equal(hostPackage.version, identity.version);
    assert.equal(corePackage.version, identity.version);
    assert.equal(coreManifest.version, identity.version);
    assert.equal(coreManifest.engines.host, `^${identity.version}`);
    assert.deepEqual(identity.creatorProfiles, [
        { version: '3.8.3', operationCount: 83, readOperationCount: 38, writeOperationCount: 45 },
        { version: '3.8.7', operationCount: 83, readOperationCount: 38, writeOperationCount: 45 },
    ]);

    const artifact = { archive: 'artifact.tgz', sha256: 'a'.repeat(64), packageDigest: 'b'.repeat(64) };
    const descriptor = createLiteReleaseDescriptor(identity, 'c'.repeat(40), { kind: 'host', ...artifact }, { kind: 'core', ...artifact });
    assert.equal(descriptor.version, identity.version);
    assert.equal(descriptor.sourceCommit, 'c'.repeat(40));
});
