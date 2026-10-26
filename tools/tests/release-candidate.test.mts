import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildReleaseArtifacts } from '../build-release-artifacts.mts';
import { verifyReleaseCandidate } from '../release-candidate.mts';

const fixtureRoot = resolve(import.meta.dirname, '../../packages/hosts/modules/creator-38/.test-temp', `release-candidate-${process.pid}`);
const sourceCommit = 'b'.repeat(40);
const profiles = [
    { version: '3.8.3', operationCount: 88, readOperationCount: 41, writeOperationCount: 47 },
    { version: '3.8.7', operationCount: 88, readOperationCount: 41, writeOperationCount: 47 },
];

test.after(async () => rm(fixtureRoot, { recursive: true, force: true }));

async function buildFixture(name: string) {
    const root = resolve(fixtureRoot, name);
    const hostDirectory = resolve(root, 'sources/peanut-pod-lite-host-0.2.0');
    const coreDirectory = resolve(root, 'sources/peanut.pod-lite-0.2.0');
    await mkdir(resolve(hostDirectory, 'dist'), { recursive: true });
    await mkdir(resolve(coreDirectory, 'libs'), { recursive: true });
    await mkdir(resolve(coreDirectory, 'bundled/default_prefab_24'), { recursive: true });
    await mkdir(resolve(coreDirectory, 'bundled/default_prefab'), { recursive: true });
    await writeFile(resolve(hostDirectory, 'package.json'), '{"name":"peanut-pod-lite-host","version":"0.2.0"}\n');
    await writeFile(resolve(hostDirectory, 'dist/main.js'), 'module.exports = {};\n');
    await writeFile(resolve(hostDirectory, 'dist/main.js.meta'), 'meta');
    const payload = {
        'peanut.pod-lite.bundle.js': 'module.exports = {};\n',
        'package.json': '{"type":"commonjs"}',
        'libs/.keep': '',
        'bundled/default_prefab/2d.meta': 'meta',
        'bundled/default_prefab_24/2d-camera.prefab': 'camera',
        'bundled/default_prefab_24/2d-camera.prefab.meta': 'camera meta',
    };
    for (const [path, content] of Object.entries(payload)) await writeFile(resolve(coreDirectory, path), content);
    const files = Object.entries(payload)
        .map(([path, content]) => ({ path, digest: sha256(content) }))
        .sort((left, right) => (left.path < right.path ? -1 : 1));
    const digest = sha256(files.map((file) => `${file.path}:${file.digest}`).join('\n'));
    await writeFile(resolve(coreDirectory, 'peanut.pod-lite.manifest.json'), `${JSON.stringify({ id: 'peanut.pod-lite', version: '0.2.0', package: { schemaVersion: 1, digest, files } }, null, 4)}\n`);
    const outputDirectory = resolve(root, 'release');
    await buildReleaseArtifacts({ identity: { productId: 'peanut.pod-lite', version: '0.2.0', creatorProfiles: profiles }, sourceCommit, hostDirectory, coreDirectory, outputDirectory });
    return outputDirectory;
}

function sha256(content: string | Buffer) {
    return createHash('sha256').update(content).digest('hex');
}

test('verifies a packed candidate and rejects identity, profile, archive and payload drift', async () => {
    const release = await buildFixture('verify');
    const descriptor = verifyReleaseCandidate(release, { expectedVersion: '0.2.0', expectedSourceCommit: sourceCommit });
    assert.equal(descriptor.sourceCommit, sourceCommit);
    assert.throws(() => verifyReleaseCandidate(release, { expectedVersion: '0.3.0' }), /lite_release_version_mismatch/u);
    assert.throws(() => verifyReleaseCandidate(release, { expectedSourceCommit: 'c'.repeat(40) }), /lite_release_source_commit_mismatch/u);

    const descriptorPath = resolve(release, 'lite-release-descriptor.json');
    const original = await readFile(descriptorPath, 'utf8');
    const mutate = async (change: (value: any) => void, pattern: RegExp) => {
        const value = JSON.parse(original);
        change(value);
        await writeFile(descriptorPath, JSON.stringify(value));
        assert.throws(() => verifyReleaseCandidate(release), pattern);
        await writeFile(descriptorPath, original);
    };
    await mutate((value) => { value.creatorProfiles = value.creatorProfiles.slice(0, 1); }, /lite_release_creator_profiles_invalid/u);
    await mutate((value) => { value.creatorProfiles[1].writeOperationCount = 44; }, /lite_release_creator_profiles_invalid/u);
    await mutate((value) => { value.host.sha256 = '0'.repeat(64); }, /lite_release_archive_digest_mismatch:host/u);
    await mutate((value) => { value.host.packageDigest = '0'.repeat(64); }, /lite_release_host_digest_mismatch/u);
    await mutate((value) => { value.core.packageDigest = '0'.repeat(64); }, /lite_release_core_manifest_mismatch/u);
    await mutate((value) => { value.sourceCommit = 'short'; }, /lite_release_descriptor_invalid/u);
});
