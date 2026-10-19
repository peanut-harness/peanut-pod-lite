import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentFormalSdkWorker } from './component-formal-sdk-worker.mts';

const candidate = { sourceCommit: 'a'.repeat(40), host: { sha256: 'b'.repeat(64), packageDigest: 'c'.repeat(64) } };
const manifest = { name: 'peanut-pod-lite-host', contributions: { 'asset-db': {
    script: './dist/sdk-startup-timer-bootstrap.js', 'global-hook': ['beforePreStart'] } } };
const files = { manifest: Buffer.from(JSON.stringify(manifest)), bootstrap: Buffer.from('formal bootstrap bytes'), worker: Buffer.from('formal worker bytes') };

test('formal source and historical startup patch modes are mutually exclusive without synthetic runtime counters', () => {
    const proof = ComponentFormalSdkWorker.fromBytes(candidate, files);
    assert.equal(ComponentFormalSdkWorker.mode('3.8.7', false, proof), true);
    assert.equal(ComponentFormalSdkWorker.mode('3.8.7', true, null), false);
    assert.equal(ComponentFormalSdkWorker.mode('3.8.3', false, null), false);
    assert.throws(() => ComponentFormalSdkWorker.mode('3.8.7', true, proof), /legacy_conflict/u);
    assert.throws(() => ComponentFormalSdkWorker.mode('3.8.3', false, proof), /legacy_conflict/u);
    assert.equal(ComponentFormalSdkWorker.source('/not-read-for-383', 'a'.repeat(40), '3.8.3'), null);
    assert.equal(proof.sourceVerified, true); assert.equal(Object.hasOwn(proof, 'installed'), false); assert.equal(Object.hasOwn(proof, 'starts'), false);
});

test('formal worker source requires the exact contribution and complete fixed payload', () => {
    for (const assetDb of [{ script: './foreign.js', 'global-hook': ['beforePreStart'] },
        { script: './dist/sdk-startup-timer-bootstrap.js', 'global-hook': ['beforeReady'] }, undefined]) {
        assert.throws(() => ComponentFormalSdkWorker.fromBytes(candidate, { ...files,
            manifest: Buffer.from(JSON.stringify({ ...manifest, contributions: { 'asset-db': assetDb } })) }), /source_invalid/u);
    }
    assert.throws(() => ComponentFormalSdkWorker.fromBytes(candidate, { ...files, worker: Buffer.alloc(0) }), /source_invalid/u);
    assert.throws(() => ComponentFormalSdkWorker.fromBytes({ ...candidate, sourceCommit: 'old-version-label' }, files), /source_invalid/u);
});

test('installed formal worker must match candidate registration and all three bytes; old patch receipts remain distinct', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'formal-sdk-worker-'))); const project = join(root, 'project');
    const host = join(project, 'extensions/peanut-pod-lite-host'); mkdirSync(join(host, 'dist'), { recursive: true });
    writeFileSync(join(host, 'package.json'), files.manifest); writeFileSync(join(host, 'dist/sdk-startup-timer-bootstrap.js'), files.bootstrap);
    writeFileSync(join(host, 'dist/sdk-startup-timer-worker.js'), files.worker);
    const proof = ComponentFormalSdkWorker.fromBytes(candidate, files);
    const registration = { creatorVersion: '3.8.7', candidateSourceCommit: candidate.sourceCommit, hostSha256: candidate.host.sha256,
        formalSdkStartupTimer: proof, sdkStartupTimerCompat: false };
    try {
        assert.doesNotThrow(() => ComponentFormalSdkWorker.assertInstalled(project, registration, proof));
        assert.throws(() => ComponentFormalSdkWorker.assertInstalled(project, { ...registration, sdkStartupTimerCompat: true }, proof), /registration_mismatch/u);
        assert.throws(() => ComponentFormalSdkWorker.assertInstalled(project, { ...registration, formalSdkStartupTimer: { ...proof, workerSha256: 'd'.repeat(64) } }, proof), /registration_mismatch/u);
        writeFileSync(join(host, 'dist/sdk-startup-timer-worker.js'), 'changed');
        assert.throws(() => ComponentFormalSdkWorker.assertInstalled(project, registration, proof), /payload_mismatch/u);
        writeFileSync(join(host, 'dist/sdk-startup-timer-worker.js'), files.worker);
        writeFileSync(join(root, 'sdk-startup-timer-compat-state.json'), JSON.stringify({ installed: true, starts: [] }));
        assert.throws(() => ComponentFormalSdkWorker.assertInstalled(project, registration, proof), /legacy_receipt_present/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
