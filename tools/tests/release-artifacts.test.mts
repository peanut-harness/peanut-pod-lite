import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildReleaseArtifacts } from '../build-release-artifacts.mts';

const fixtureRoot = resolve(
    import.meta.dirname,
    '../../packages/hosts/modules/creator-38/.test-temp',
    `release-artifacts-${process.pid}`,
);

function digestRecords(records) {
    return createHash('sha256')
        .update(records.map((record) => `${record.path}:${record.digest}`).join('\n'))
        .digest('hex');
}

async function sha256(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('same source and version produce identical descriptor, digests, archives, and file lists', async (context) => {
    context.after(async () => rm(fixtureRoot, { recursive: true, force: true }));
    const hostDirectory = resolve(fixtureRoot, 'sources/peanut-pod-lite-host-0.2.0');
    const coreDirectory = resolve(fixtureRoot, 'sources/peanut.pod-lite-0.2.0');
    await mkdir(resolve(hostDirectory, 'dist'), { recursive: true });
    await mkdir(resolve(coreDirectory, 'dist'), { recursive: true });
    await writeFile(resolve(hostDirectory, 'package.json'), '{"name":"host"}\n');
    await writeFile(resolve(hostDirectory, 'dist/main.js'), 'module.exports = {};\n');
    await writeFile(resolve(coreDirectory, 'dist/core.js'), 'module.exports = {};\n');
    const coreRecords = [{
        path: 'dist/core.js',
        digest: await sha256(resolve(coreDirectory, 'dist/core.js')),
    }];
    const coreDigest = digestRecords(coreRecords);
    await writeFile(
        resolve(coreDirectory, 'peanut.pod-lite.manifest.json'),
        `${JSON.stringify({ package: { digest: coreDigest, files: coreRecords } }, null, 4)}\n`,
    );
    const identity = {
        productId: 'peanut.pod-lite',
        version: '0.2.0',
        creatorProfiles: [
            { version: '3.8.3', operationCount: 83, readOperationCount: 38, writeOperationCount: 45 },
            { version: '3.8.7', operationCount: 83, readOperationCount: 38, writeOperationCount: 45 },
        ],
    };
    const shared = {
        identity,
        sourceCommit: 'a'.repeat(40),
        hostDirectory,
        coreDirectory,
    };
    const first = await buildReleaseArtifacts({
        ...shared,
        outputDirectory: resolve(fixtureRoot, 'first'),
    });

    const changedTime = new Date('2040-05-06T07:08:09.000Z');
    await utimes(resolve(hostDirectory, 'dist/main.js'), changedTime, changedTime);
    await utimes(resolve(coreDirectory, 'dist/core.js'), changedTime, changedTime);
    const second = await buildReleaseArtifacts({
        ...shared,
        outputDirectory: resolve(fixtureRoot, 'second'),
    });

    assert.deepEqual(second.descriptor, first.descriptor);
    assert.deepEqual(second.archiveFiles, first.archiveFiles);
    assert.equal(second.descriptor.host.packageDigest, first.descriptor.host.packageDigest);
    assert.equal(second.descriptor.core.packageDigest, first.descriptor.core.packageDigest);
    assert.equal(
        await sha256(resolve(second.outputDirectory, second.descriptor.host.archive)),
        await sha256(resolve(first.outputDirectory, first.descriptor.host.archive)),
    );
    assert.equal(
        await sha256(resolve(second.outputDirectory, second.descriptor.core.archive)),
        await sha256(resolve(first.outputDirectory, first.descriptor.core.archive)),
    );
    const descriptorText = await readFile(second.descriptorPath, 'utf8');
    assert.equal(descriptorText.includes(fixtureRoot), false);
    assert.equal(descriptorText.includes('2040-05-06'), false);
});
