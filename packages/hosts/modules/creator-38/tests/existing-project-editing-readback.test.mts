import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyExistingProjectEditingReadback } from '../scripts/verify-existing-project-editing-readback.mts';

function fixture() {
    const projectPath = realpathSync(mkdtempSync(join(tmpdir(), 'peanut-editing-readback-')));
    const root = 'assets/_peanut-managed-task-live/run-1';
    const paths = ['Atomic.prefab', 'Atomic.scene', 'Race.prefab'].map((name) => root + '/' + name);
    mkdirSync(join(projectPath, root), { recursive: true });
    const identities = paths.map((path, index) => {
        const importer = index === 1 ? 'scene' : 'prefab';
        const uuid = '11111111-2222-4333-8444-55555555555' + index;
        const content = '[{"__type__":"cc.' + (index === 1 ? 'Scene' : 'Prefab') + '"}]\n';
        writeFileSync(join(projectPath, path), content);
        writeFileSync(join(projectPath, path + '.meta'), JSON.stringify({ importer, uuid }));
        return { relativePath: path, importer, uuid, metaPresent: true,
            sourceDigest: createHash('sha256').update(content).digest('hex') };
    });
    const hostDigest = '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438';
    const coreDigest = 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f';
    const descriptor = { productId: 'peanut.pod-lite', version: '0.2.1',
        host: { packageDigest: hostDigest }, core: { packageDigest: coreDigest } };
    const artifacts = { host: { id: 'peanut-pod-lite-host', version: '0.2.1', packageDigest: hostDigest },
        core: { id: 'peanut.pod-lite', version: '0.2.1', packageDigest: coreDigest } };
    const original = { schema: 'peanut.creator38.managed-task-live.v2', artifactAgreement: true,
        saveReopenPerformed: false, project: { name: projectPath.split('/').at(-1),
            pathDigest: createHash('sha256').update(projectPath).digest('hex'), creatorVersion: '3.8.3' },
        artifacts, hub: { sessionId: 'first-session' }, assetRoot: root, createdPaths: paths,
        checks: { atomicCreation: { prefab: { identity: identities[0] }, scene: { identity: identities[1] },
            sameTargetRace: { identity: identities[2] } } } };
    const input = { projectPath, creationReport: original, releaseDescriptor: descriptor,
        hostStatus: { ready: true, creatorContext: { version: { raw: '3.8.3' },
            projectVersion: { raw: '3.8.3' } }, artifacts }, health: { sessionId: 'second-session' },
        assetInfos: Object.fromEntries(paths.map((path, index) => [path,
            { uuid: identities[index]!.uuid, path: 'db://' + path, invalid: false }])),
        missingReferences: { total: 0, hits: [], truncated: false },
        referenceResolutions: {}, logDelta: '12:00 - info: reopened\n' };
    return { projectPath, paths, input };
}

test('independent reopened session checks candidate, AssetDB and source bytes', () => {
    const { projectPath, input } = fixture();
    try {
        const report = verifyExistingProjectEditingReadback(input);
        assert.equal(report.verified, true);
        assert.equal(report.reopenedSessionId, 'second-session');
        assert.equal((report.identities as unknown[]).length, 3);
    } finally { rmSync(projectPath, { recursive: true, force: true }); }
});

test('readback refuses changed candidate and a session that was not reopened', () => {
    const { projectPath, input } = fixture();
    try {
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            releaseDescriptor: { ...input.releaseDescriptor, core: { packageDigest: 'c'.repeat(64) } } }));
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            health: { sessionId: 'first-session' } }), /creator_session_not_reopened/u);
    } finally { rmSync(projectPath, { recursive: true, force: true }); }
});

test('readback refuses escaped paths, missing meta and changed AssetDB UUID', () => {
    const { projectPath, paths, input } = fixture();
    try {
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            creationReport: { ...input.creationReport,
                assetRoot: 'assets/_peanut-managed-task-live/../elsewhere' } }), /editing_asset_root_invalid/u);
        unlinkSync(join(projectPath, paths[0] + '.meta'));
        assert.throws(() => verifyExistingProjectEditingReadback(input));
        writeFileSync(join(projectPath, paths[0] + '.meta'), JSON.stringify({ importer: 'prefab' }));
        assert.throws(() => verifyExistingProjectEditingReadback(input));
        writeFileSync(join(projectPath, paths[0] + '.meta'), JSON.stringify({
            importer: 'prefab', uuid: input.creationReport.checks.atomicCreation.prefab.identity.uuid }));
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            assetInfos: { ...input.assetInfos, [paths[0]!]: { uuid: 'wrong' } } }),
        /editing_assetdb_identity_mismatch/u);
    } finally { rmSync(projectPath, { recursive: true, force: true }); }
});

test('readback refuses unresolved references and new project errors', () => {
    const { projectPath, input } = fixture();
    try {
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            missingReferences: { total: 1, hits: [{ uuid: 'missing',
                referrerDbPath: 'db://assets/_peanut-managed-task-live/run-1/Atomic.scene' }], truncated: false } }),
        /editing_missing_references/u);
        const internal = 'builtin@skybox';
        const resolved = verifyExistingProjectEditingReadback({ ...input,
            missingReferences: { total: 1, hits: [{ uuid: internal,
                referrerDbPath: 'db://assets/_peanut-managed-task-live/run-1/Atomic.scene' }], truncated: false },
            referenceResolutions: { [internal]: { uuid: internal, path: 'db://internal/default_skybox/textureCube' } } });
        assert.equal(resolved.fileGraphScannerHits, 1);
        assert.equal(resolved.unresolvedNativeReferences, 0);
        assert.throws(() => verifyExistingProjectEditingReadback({ ...input,
            logDelta: '12:00 - error: asset missing\n' }), /editing_new_project_log_error/u);
    } finally { rmSync(projectPath, { recursive: true, force: true }); }
});
