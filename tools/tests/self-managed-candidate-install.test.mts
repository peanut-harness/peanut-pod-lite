import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PackagingApp } from '../../packages/engine/modules/installation/src/app/packaging-app.ts';
import { ProjectPackageStore } from '../../packages/engine/modules/installation/src/persistence/project-package-store.ts';
import { HostPackageIdentity } from '../../packages/hosts/modules/creator-38/src/host-package-identity.ts';
import { buildReleaseArtifacts } from '../build-release-artifacts.mts';
import { verifyReleaseCandidate } from '../release-candidate.mts';

const PRODUCT_ID = 'peanut.pod-lite';
const PROFILES = ['3.8.3', '3.8.7'].map((version) => ({ version, operationCount: 88, readOperationCount: 41, writeOperationCount: 47 }));
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

test('Peanut Packaging installs Host/Core, upgrades, and recovers the last intact version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pod-self-managed-candidate-'));
    try {
        const project = join(root, 'project');
        mkdirSync(project);
        const first = await candidate(root, '0.2.0');
        const hostPath = join(project, 'extensions', 'peanut-pod-lite-host');
        cpSync(first.hostPath, hostPath, { recursive: true });
        const packaging = new PackagingApp({ projectPath: project });
        assert.equal((await packaging.validate(first.corePath)).ok, true);
        await packaging.planInstall(first.corePath);
        await packaging.install(first.corePath);
        const store = new ProjectPackageStore(project);
        const installed = store.resolveVerifiedActivePackage(PRODUCT_ID, true);
        assert.equal(installed.packageDigest, first.descriptor.core.packageDigest);
        assert.equal(HostPackageIdentity.hostPackageDigest(hostPath), first.descriptor.host.packageDigest);
        assert.deepEqual(HostPackageIdentity.compareReleaseIdentity({
            host: { id: 'peanut-pod-lite-host', version: first.descriptor.version, packageDigest: HostPackageIdentity.hostPackageDigest(hostPath) ?? '' },
            core: { id: installed.manifest.id, version: installed.manifest.version, packageDigest: installed.packageDigest },
        }, first.descriptor), []);
        const originalIndex = readFileSync(join(project, 'peanut-plugins', 'installed.json'));

        const next = await candidate(root, '0.2.1');
        const nextBundlePath = join(next.corePath, `${PRODUCT_ID}.bundle.js`);
        const nextBundle = readFileSync(nextBundlePath);
        writeFileSync(nextBundlePath, 'tampered');
        await assert.rejects(packaging.upgrade(next.corePath));
        assert.deepEqual(readFileSync(join(project, 'peanut-plugins', 'installed.json')), originalIndex);
        assert.equal(new ProjectPackageStore(project).resolveVerifiedActivePackage(PRODUCT_ID, true).packageDigest, first.descriptor.core.packageDigest);
        assert.deepEqual(new PackagingApp({ projectPath: project }).getInstalledPackageSnapshot(PRODUCT_ID)?.activeVersion, first.descriptor.version);
        writeFileSync(nextBundlePath, nextBundle);
        const upgraded = await packaging.upgrade(next.corePath);
        assert.equal(new ProjectPackageStore(project).resolveVerifiedActivePackage(PRODUCT_ID, true).packageDigest, next.descriptor.core.packageDigest);
        writeFileSync(join(upgraded.installPath, `${PRODUCT_ID}.bundle.js`), 'corrupted after upgrade');
        const recovered = new PackagingApp({ projectPath: project });
        assert.equal((await recovered.repair()).repaired, true);
        assert.equal(new ProjectPackageStore(project).resolveVerifiedActivePackage(PRODUCT_ID, true).packageDigest, first.descriptor.core.packageDigest);
        assert.equal(recovered.getInstalledPackageSnapshot(PRODUCT_ID)?.activeVersion, first.descriptor.version);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

async function candidate(root: string, version: string) {
    const source = join(root, `source-${version}`);
    const hostPath = join(source, `peanut-pod-lite-host-${version}`);
    const corePath = join(source, `${PRODUCT_ID}-${version}`);
    mkdirSync(join(hostPath, 'dist'), { recursive: true });
    mkdirSync(join(corePath, 'libs'), { recursive: true });
    writeFileSync(join(hostPath, 'package.json'), JSON.stringify({ name: 'peanut-pod-lite-host', version, main: './dist/main.js' }));
    writeFileSync(join(hostPath, 'dist/main.js'), 'module.exports = {};');
    const bundle = `module.exports = { version: '${version}' };`;
    const packageJson = JSON.stringify({ type: 'commonjs' });
    writeFileSync(join(corePath, `${PRODUCT_ID}.bundle.js`), bundle);
    writeFileSync(join(corePath, 'package.json'), packageJson);
    writeFileSync(join(corePath, 'libs/.keep'), '');
    const files = [
        { path: `${PRODUCT_ID}.bundle.js`, digest: hash(bundle) },
        { path: 'libs/.keep', digest: hash('') },
        { path: 'package.json', digest: hash(packageJson) },
    ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const packageDigest = hash(files.map(({ path, digest }) => `${path}:${digest}`).join('\n'));
    writeFileSync(join(corePath, `${PRODUCT_ID}.manifest.json`), JSON.stringify({
        id: PRODUCT_ID, version, kind: 'tooling-plugin', displayName: 'Peanut Pod Lite', main: `./${PRODUCT_ID}.bundle.js`,
        engines: { host: `^${version}` }, activation: { autoActivate: false, events: ['onStartup'] }, permissions: {}, contributions: {},
        package: { schemaVersion: 1, digest: packageDigest, files },
    }));
    const release = join(root, `release-${version}`);
    await buildReleaseArtifacts({
        identity: { productId: PRODUCT_ID, version, creatorProfiles: PROFILES }, sourceCommit: 'b'.repeat(40),
        hostDirectory: hostPath, coreDirectory: corePath, outputDirectory: release,
    });
    return { hostPath, corePath, descriptor: verifyReleaseCandidate(release) };
}
