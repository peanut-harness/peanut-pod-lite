import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
    assertManagedTaskLiveReport,
    readCreatedIdentity,
} from '../scripts/managed-task-live-evidence.mts';

test('managed task live evidence validates atomic creation fixture without secrets', () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'peanut-managed-live-fixture-'));
    try {
        mkdirSync(join(projectPath, 'assets/qa'), { recursive: true });
        writeFileSync(join(projectPath, 'assets/qa/Atomic.prefab'), '[{"__type__":"cc.Prefab"}]\n');
        writeFileSync(join(projectPath, 'assets/qa/Atomic.prefab.meta'), JSON.stringify({
            importer: 'prefab',
            uuid: '11111111-2222-4333-8444-555555555555',
        }));
        const identity = readCreatedIdentity(projectPath, 'assets/qa/Atomic.prefab', 'prefab');
        assert.equal(identity.metaPresent, true);
        assert.equal(identity.sourceDigest.length, 64);
        const report = {
            schema: 'peanut.creator38.managed-task-live.v2',
            artifactAgreement: true,
            checks: {
                atomicCreation: {
                    prefab: { task: { status: 'succeeded' }, identity },
                    scene: { task: { status: 'succeeded' }, identity: { ...identity, importer: 'scene' } },
                    sameTargetRace: { noOverwrite: true },
                    preCommitCancellation: { targetAbsent: true },
                },
                projectLog: { unexpectedLines: [] },
            },
        };
        assert.doesNotThrow(() => assertManagedTaskLiveReport(report));
        assert.throws(
            () => assertManagedTaskLiveReport({ ...report, token: 'must-not-leak' }),
            /false/u,
        );
    } finally {
        rmSync(projectPath, { recursive: true, force: true });
    }
});
