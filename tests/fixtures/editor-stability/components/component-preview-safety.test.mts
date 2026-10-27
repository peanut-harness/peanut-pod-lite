import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentPreviewSafety } from './component-preview-safety.mts';

test('existing project binds 0.2.1 while an incompatible historical descriptor is also present', () => {
    const root = mkdtempSync('/private/tmp/pod-preview-identity-');
    try {
        for (const [version, digit] of [['0.2.0', '0'], ['0.2.1', '1']]) {
            const directory = join(root, `release/peanut.pod-lite-${version}`); mkdirSync(directory, { recursive: true });
            writeFileSync(join(directory, 'lite-release-descriptor.json'), JSON.stringify({ version,
                host: { sha256: digit.repeat(64) }, core: { sha256: digit.repeat(64) } }));
        }
        const current = ComponentPreviewSafety.releaseIdentity(root, { kind: 'registered-existing-0.2.1-project',
            hostSha256: '1'.repeat(64), coreSha256: '1'.repeat(64) });
        assert.equal(current.version, '0.2.1'); assert.equal(current.hostSha256, '1'.repeat(64));
        const historical = ComponentPreviewSafety.releaseIdentity(root, { kind: 'worktree-local-validation-project',
            hostSha256: '0'.repeat(64), coreSha256: '0'.repeat(64) });
        assert.equal(historical.version, '0.2.0');
        for (const registration of [
            { kind: 'unknown', hostSha256: '1'.repeat(64), coreSha256: '1'.repeat(64) },
            { kind: 'registered-existing-0.2.1-project', hostSha256: '0'.repeat(64), coreSha256: '1'.repeat(64) },
            { kind: 'registered-existing-0.2.1-project', hostSha256: '1'.repeat(64), coreSha256: '0'.repeat(64) },
        ]) assert.throws(() => ComponentPreviewSafety.releaseIdentity(root, registration), /(?:project_kind_invalid|identity_mismatch)/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

const cleanPost = { verified: true, logChecked: true, newErrorCount: 0, newWarningCount: 0 };
const refreshed = (message: string) => ({ available: true, source: 'live', availability: 'live', taskStatus: 'succeeded',
    postflight: cleanPost, message });
const protectedRefusal = { available: false, source: 'live', availability: 'refused', taskStatus: 'succeeded',
    postflight: cleanPost, message: 'preview_refresh_unavailable:preview_disconnected_no_reopen' };

test('known no-reopen refusal remains unavailable and requires prior physical-window proof plus clean task completion', () => {
    const before = JSON.stringify(protectedRefusal);
    assert.equal(ComponentPreviewSafety.refreshOutcome(protectedRefusal, true), 'protective-refusal');
    assert.equal(protectedRefusal.available, false); assert.equal(JSON.stringify(protectedRefusal), before);
    for (const [result, proven] of [
        [protectedRefusal, false], [{ ...protectedRefusal, message: 'preview_refresh_unavailable:preview_state_unknown' }, true],
        [{ ...protectedRefusal, taskStatus: 'failed' }, true],
        [{ ...protectedRefusal, postflight: { ...cleanPost, newWarningCount: 1 } }, true],
        [{ ...protectedRefusal, postflight: { ...cleanPost, verified: false } }, true],
    ] as const) assert.throws(() => ComponentPreviewSafety.refreshOutcome(result, proven), /refresh_unverified/u);
});

test('recorded three-call recovery preserves original failure, counts two successes and one refusal without replay', () => {
    const identity = { projectPath: '/registered/project', owner: 'current-owner', pid: 1234, creatorVersion: '3.8.7',
        candidateSourceCommit: 'a'.repeat(40), hostSha256: 'b'.repeat(64), coreSha256: 'c'.repeat(64) };
    const receipt = { ...identity, verified: false, maxRefreshCalls: 3, steps: [
        { step: 'readonly-query-did-not-open', before: { matchingBrowserTabs: 0 }, after: { matchingBrowserTabs: 0 } },
        { step: 'bounded-refresh', index: 0, result: refreshed('preview_refresh_ok:open-requested-once') },
        { step: 'actual-window-count', index: 0, after: { matchingBrowserTabs: 1 } },
        { step: 'bounded-refresh', index: 1, result: refreshed('preview_refresh_ok:existing-preview+reload-terminal') },
        { step: 'actual-window-count', index: 1, after: { matchingBrowserTabs: 1 } },
        { step: 'bounded-refresh', index: 2, result: protectedRefusal },
        { step: 'safety-stopped', reason: 'preview_safety_refresh_unverified' },
    ] };
    const current = { ...identity, state: { platform: 'browser', matchingBrowserTabs: 1, connectedPreviewCount: 1 } };
    const before = JSON.stringify(receipt); const result = ComponentPreviewSafety.completeRecordedSafety(receipt, current);
    assert.equal(result.verified, true); assert.equal(result.successfulRefreshCalls, 2);
    assert.equal(result.protectiveRefusalCalls, 1); assert.equal(result.extraRefreshCalls, 0);
    assert.equal(receipt.verified, false); assert.equal(JSON.stringify(receipt), before);
    assert.throws(() => ComponentPreviewSafety.completeRecordedSafety(receipt, { ...current, pid: 5678 }), /identity_or_state_invalid/u);
    assert.throws(() => ComponentPreviewSafety.completeRecordedSafety(receipt, { ...current,
        state: { ...current.state, matchingBrowserTabs: 2 } }), /identity_or_state_invalid/u);
    assert.throws(() => ComponentPreviewSafety.completeRecordedSafety({ ...receipt, steps: [...receipt.steps, receipt.steps[5]] }, current), /history_invalid/u);
    assert.throws(() => ComponentPreviewSafety.completeRecordedSafety({ ...receipt, steps: [...receipt.steps].reverse() }, current), /history_invalid/u);
});
