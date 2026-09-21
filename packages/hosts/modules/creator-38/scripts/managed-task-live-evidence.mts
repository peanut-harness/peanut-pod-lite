import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**

 * @description 已创建资源的安全身份摘要。

 */
export interface IManagedTaskCreatedIdentity {
    readonly relativePath: string;
    readonly importer: string;
    readonly uuid: string;
    readonly metaPresent: true;
    readonly sourceDigest: string;
}

/**
 * @description 读取并校验实机创建资源的主文件与 `.meta` 身份。
 * @param projectPath Creator 工程根。
 * @param relativePath 工程相对路径。
 * @param expectedImporter 预期 importer。
 * @returns 安全身份摘要。
 */
export function readCreatedIdentity(
    projectPath: string,
    relativePath: string,
    expectedImporter: 'prefab' | 'scene',
): IManagedTaskCreatedIdentity {
    const absolutePath = join(projectPath, relativePath);
    const metaPath = `${absolutePath}.meta`;
    assert.equal(existsSync(absolutePath), true);
    assert.equal(existsSync(metaPath), true);
    const meta: unknown = JSON.parse(readFileSync(metaPath, 'utf8'));
    const metaRecord = requireRecord(meta, 'meta');
    assert.equal(metaRecord.importer, expectedImporter);
    assert.equal(typeof metaRecord.uuid, 'string');
    assert.ok(metaRecord.uuid.length > 0);
    return {
        relativePath,
        importer: metaRecord.importer,
        uuid: metaRecord.uuid,
        metaPresent: true,
        sourceDigest: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
    } as IManagedTaskCreatedIdentity;
}

/**
 * @description 对实机报告的原子创建、安全摘要和无 token 契约做最终断言。
 * @param report 报告。
 */
export function assertManagedTaskLiveReport(report: Record<string, unknown>): void {
    assert.equal(report.schema, 'peanut.creator38.managed-task-live.v2');
    assert.equal(report.artifactAgreement, true);
    const checks = requireRecord(report.checks, 'checks');
    const atomic = requireRecord(checks.atomicCreation, 'checks.atomicCreation');
    const prefab = requireRecord(atomic.prefab, 'checks.atomicCreation.prefab');
    const scene = requireRecord(atomic.scene, 'checks.atomicCreation.scene');
    assert.equal(requireRecord(prefab.task, 'prefab.task').status, 'succeeded');
    assert.equal(requireRecord(scene.task, 'scene.task').status, 'succeeded');
    assert.equal(requireRecord(prefab.identity, 'prefab.identity').metaPresent, true);
    assert.equal(requireRecord(scene.identity, 'scene.identity').metaPresent, true);
    assert.equal(requireRecord(atomic.sameTargetRace, 'sameTargetRace').noOverwrite, true);
    assert.equal(requireRecord(atomic.preCommitCancellation, 'preCommitCancellation').targetAbsent, true);
    const projectLog = requireRecord(checks.projectLog, 'checks.projectLog');
    assert.deepEqual(projectLog.unexpectedLines, []);
    const serialized = JSON.stringify(report);
    assert.equal(/approvalToken|x-peanut-mcp-token|"token"\s*:/iu.test(serialized), false);
}

/**

 * @description 收窄普通对象。

 */
function requireRecord(value: unknown, label: string): Record<string, any> {
    assert.equal(typeof value, 'object', `${label}:object_required`);
    assert.notEqual(value, null, `${label}:object_required`);
    assert.equal(Array.isArray(value), false, `${label}:object_required`);
    return value as Record<string, any>;
}
