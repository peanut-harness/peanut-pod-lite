import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HostPackageIdentity } from '../src/host-package-identity.ts';
import { readCreatedIdentity } from './managed-task-live-evidence.mts';

const ASSET_ROOT = /^assets\/_peanut-managed-task-live\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const ASSET_NAMES = ['Atomic.prefab', 'Atomic.scene', 'Race.prefab'] as const;
const FROZEN_HOST_DIGEST = '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438';
const FROZEN_CORE_DIGEST = 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f';

/**
 * @description 在独立 Creator 会话内核对受管创建结果；只读工程和 Bridge。
 */
export function verifyExistingProjectEditingReadback(input: {
    readonly projectPath: string;
    readonly creationReport: any;
    readonly releaseDescriptor: any;
    readonly hostStatus: any;
    readonly health: any;
    readonly assetInfos: Readonly<Record<string, unknown>>;
    readonly missingReferences: any;
    readonly referenceResolutions: Readonly<Record<string, unknown>>;
    readonly logDelta: string;
}): Record<string, unknown> {
    const projectPath = realpathSync(resolve(input.projectPath));
    const original = input.creationReport;
    assert.equal(original?.schema, 'peanut.creator38.managed-task-live.v2');
    assert.equal(original?.artifactAgreement, true);
    assert.equal(original?.saveReopenPerformed, false);
    assert.equal(original?.project?.name, basename(projectPath));
    assert.equal(original?.project?.pathDigest, createHash('sha256').update(projectPath).digest('hex'));
    assert.ok(['3.8.3', '3.8.7'].includes(original.project.creatorVersion), 'editing_creator_version_invalid');
    assert.equal(input.releaseDescriptor?.productId, 'peanut.pod-lite');
    assert.equal(input.releaseDescriptor?.version, '0.2.1');
    assert.equal(input.releaseDescriptor?.host?.packageDigest, FROZEN_HOST_DIGEST);
    assert.equal(input.releaseDescriptor?.core?.packageDigest, FROZEN_CORE_DIGEST);
    assert.equal(input.hostStatus?.ready, true);
    assert.equal(input.hostStatus?.creatorContext?.version?.raw, original.project.creatorVersion);
    assert.equal(input.hostStatus?.creatorContext?.projectVersion?.raw, original.project.creatorVersion);
    assert.deepEqual(input.hostStatus?.artifacts, original.artifacts);
    assert.deepEqual(HostPackageIdentity.compareReleaseIdentity(input.hostStatus.artifacts, input.releaseDescriptor), []);
    assert.equal(typeof original?.hub?.sessionId, 'string');
    assert.equal(typeof input.health?.sessionId, 'string');
    assert.notEqual(input.health.sessionId, original.hub.sessionId, 'creator_session_not_reopened');

    const assetRoot = original.assetRoot;
    assert.equal(typeof assetRoot, 'string');
    assert.match(assetRoot, ASSET_ROOT, 'editing_asset_root_invalid');
    const paths = ASSET_NAMES.map((name) => `${assetRoot}/${name}`);
    assert.deepEqual(original.createdPaths, paths);
    const atomic = original?.checks?.atomicCreation;
    const recorded = [atomic?.prefab?.identity, atomic?.scene?.identity, atomic?.sameTargetRace?.identity];
    const identities = paths.map((path, index) => {
        const expectedImporter = index === 1 ? 'scene' : 'prefab';
        const expected = recorded[index];
        assert.equal(expected?.relativePath, path);
        assert.equal(expected?.importer, expectedImporter);
        assert.match(expected?.uuid ?? '', /^[A-Za-z0-9_-]+$/u);
        assert.match(expected?.sourceDigest ?? '', /^[0-9a-f]{64}$/u);
        for (const suffix of ['', '.meta']) {
            const real = realpathSync(join(projectPath, `${path}${suffix}`));
            assert.ok(real.startsWith(`${projectPath}${sep}`), 'editing_asset_path_escape');
        }
        const current = readCreatedIdentity(projectPath, path, expectedImporter);
        assert.deepEqual(current, expected);
        const info = input.assetInfos[path] as any;
        const liveUuid = info?.uuid ?? info?.asset?.uuid;
        assert.equal(liveUuid, expected.uuid, `editing_assetdb_identity_mismatch:${path}`);
        assert.notEqual(info?.invalid, true, `editing_assetdb_invalid:${path}`);
        return current;
    });

    const missing = input.missingReferences;
    assert.equal(missing?.truncated, false);
    assert.ok(Number.isSafeInteger(missing?.total) && missing.total >= 0, 'editing_reference_scan_invalid');
    assert.equal(missing?.hits?.length, missing.total, 'editing_reference_scan_incomplete');
    const referenceResolutions = missing.hits.map((hit: any) => {
        assert.equal(typeof hit?.uuid, 'string');
        assert.ok(hit.referrerDbPath?.startsWith(`db://${assetRoot}/`), 'editing_reference_scope_invalid');
        const resolved = input.referenceResolutions[hit.uuid] as any;
        assert.equal(resolved?.uuid, hit.uuid, `editing_missing_references:${hit.uuid}`);
        assert.ok(typeof resolved.path === 'string' && resolved.path.startsWith('db://'),
            `editing_reference_path_invalid:${hit.uuid}`);
        return { uuid: hit.uuid, referrerDbPath: hit.referrerDbPath, resolvedPath: resolved.path };
    });
    assert.equal(/\s-\s(?:error|warn):/iu.test(input.logDelta), false, 'editing_new_project_log_error');
    assert.equal(/approvalToken|x-peanut-mcp-token|"token"\s*:/iu.test(JSON.stringify({ identities, referenceResolutions })), false);

    return {
        schema: 'peanut.pod.existing-project-editing-readback.v1',
        creatorVersion: original.project.creatorVersion,
        assetRoot,
        creationSessionId: original.hub.sessionId,
        reopenedSessionId: input.health.sessionId,
        identities,
        fileGraphScannerHits: missing.total,
        nativeResolvedScannerHits: referenceResolutions,
        unresolvedNativeReferences: 0,
        logDeltaBytes: Buffer.byteLength(input.logDelta),
        verified: true,
    };
}

async function main(): Promise<void> {
    const projectPath = resolve(argument('--project'));
    const creationReport = JSON.parse(readFileSync(resolve(argument('--creation-report')), 'utf8'));
    const releaseDescriptor = JSON.parse(readFileSync(resolve(argument('--release-descriptor')), 'utf8'));
    const hostStatus = JSON.parse(readFileSync(join(projectPath, 'peanut-plugins/runtime/host-status.json'), 'utf8'));
    const bridge = JSON.parse(readFileSync(join(projectPath, '.peanut-ai/cocos-mcp.json'), 'utf8'));
    const health = await request(bridge, { action: 'health' });
    const connectionId = randomBytes(16).toString('hex');
    const root = creationReport.assetRoot;
    assert.equal(typeof root, 'string');
    assert.match(root, ASSET_ROOT);
    const paths = ASSET_NAMES.map((name) => `${root}/${name}`);
    const assetInfos = Object.fromEntries(await Promise.all(paths.map(async (path) => [path,
        await request(bridge, { action: 'call', name: 'peanut.editor-mcp.asset-query-info',
            connectionId,
            input: { pathOrUuid: `db://${path}` } }),
    ])));
    const missingReferences = await request(bridge, { action: 'call',
        name: 'peanut.editor-mcp.asset-scan-missing-references',
        connectionId,
        input: { pathContains: root, refreshIndex: true, limit: 200 } });
    assert.equal(missingReferences?.truncated, false, 'editing_reference_scan_truncated');
    assert.ok(Array.isArray(missingReferences?.hits), 'editing_reference_scan_invalid');
    const referenceResolutions = Object.fromEntries(await Promise.all(missingReferences.hits.map(async (hit: any) => [
        hit.uuid,
        await request(bridge, { action: 'call', name: 'peanut.editor-mcp.asset-query-info',
            connectionId, input: { pathOrUuid: hit.uuid } }),
    ])));
    const logBytes = readFileSync(join(projectPath, 'temp/logs/project.log'));
    const endOffset = creationReport?.checks?.projectLog?.endOffset;
    assert.ok(Number.isSafeInteger(endOffset) && endOffset >= 0 && logBytes.length >= endOffset,
        'editing_log_rotation_or_offset_unverified');
    const logDelta = logBytes.subarray(endOffset).toString('utf8');
    const verified = verifyExistingProjectEditingReadback({ projectPath, creationReport, releaseDescriptor,
        hostStatus, health, assetInfos, missingReferences, referenceResolutions, logDelta });
    const report = { ...verified, verifiedAt: new Date().toISOString(),
        reportDigest: createHash('sha256').update(JSON.stringify(verified)).digest('hex') };
    writeFileSync(resolve(argument('--output')), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ output: resolve(argument('--output')), reportDigest: report.reportDigest,
        creatorVersion: report.creatorVersion, verified: true }));
}

async function request(bridge: any, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-peanut-mcp-token': bridge.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `hub_http_${response.status}`);
    return payload.result;
}

function argument(name: string): string {
    const index = process.argv.indexOf(name);
    if (index < 0 || process.argv[index + 1] == null) throw new Error(`missing_argument:${name}`);
    return process.argv[index + 1]!;
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
