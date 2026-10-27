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
