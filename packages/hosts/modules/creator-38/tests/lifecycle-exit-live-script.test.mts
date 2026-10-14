import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LifecycleExitLiveBaseline } from '../scripts/verify-lifecycle-exit-live.mts';

test('process ownership distinguishes the main editor from its GPU, renderer and asset helpers', () => {
    const app = '/Applications/Cocos/Creator/3.8.7/CocosCreator.app';
    assert.equal(LifecycleExitLiveBaseline.isEditorRoot(`${app}/Contents/MacOS/CocosCreator --project /isolated --nologin`), true);
    for (const name of ['Helper', 'Helper (GPU)', 'Helper (Renderer)', 'Helper (Assets)']) {
        assert.equal(LifecycleExitLiveBaseline.isEditorRoot(`${app}/Contents/Frameworks/CocosCreator ${name}.app/Contents/MacOS/CocosCreator ${name} --type=renderer`), false);
    }
});

test('baseline raw assessment preserves every warning/error, counts beyond display limit and does not rewrite bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-baseline-raw-'));
    try {
        const bytes = Buffer.from('startup ready\r\n' + 'Warning: synthetic delayed diagnostic\r\n'.repeat(101) + 'Error: Object has been destroyed\n');
        const file = join(root, 'stderr.log'); writeFileSync(file, bytes);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const checked = LifecycleExitLiveBaseline.assessRaw(root, [{ channel: 'stderr', reference: 'stderr.log', exists: true }]);
        assert.equal(checked.issueCount, 102); assert.equal(checked.locations.length, 100);
        assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), digest);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('missing channels and invalid UTF-8 fail rather than becoming a clean baseline', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-baseline-raw-'));
    try {
        writeFileSync(join(root, 'stdout.log'), Buffer.from([0xc3, 0x28]));
        const checked = LifecycleExitLiveBaseline.assessRaw(root, [
            { channel: 'stdout', reference: 'stdout.log', exists: true },
            { channel: 'project.log', reference: 'missing.log', exists: false },
        ]);
        assert.equal(checked.issueCount, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('baseline preflight refuses a target outside its registered worktree before querying or starting Creator', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-baseline-outside-'));
    try {
        await assert.rejects(LifecycleExitLiveBaseline.run(root, root, '/missing/Creator.app', 'unit-owner', true), /out_of_scope/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
