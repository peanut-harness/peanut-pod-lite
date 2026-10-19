import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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


test('actual Creator launch requires the registered project npm creator hook with scripts enabled', () => {
    const project = '/isolated/lifecycle/project';
    const environment = { npm_lifecycle_event: 'creator', npm_package_json: join(project, 'package.json'),
        npm_config_ignore_scripts: 'false' };
    assert.doesNotThrow(() => LifecycleExitLiveBaseline.assertOuterNpm(project, project, environment));
    for (const rejected of [{ ...environment, npm_lifecycle_event: undefined },
        { ...environment, npm_lifecycle_event: 'precreator' }, { ...environment, npm_config_ignore_scripts: 'true' },
        { ...environment, npm_package_json: '/foreign/package.json' }]) {
        assert.throws(() => LifecycleExitLiveBaseline.assertOuterNpm(project, project, rejected), /outer_npm_required/u);
    }
    assert.throws(() => LifecycleExitLiveBaseline.assertOuterNpm(project, '/foreign', environment), /outer_npm_required/u);
});


test('macOS launch uses a distinct LaunchServices instance with separate application raw streams', () => {
    const app = '/Applications/Cocos Creator.app'; const project = '/isolated/project with spaces'; const output = '/isolated/logs';
    const command = LifecycleExitLiveBaseline.launchCommand(app, project, output, 'darwin');
    assert.equal(command.command, '/usr/bin/open');
    assert.deepEqual(command.args, ['-n', '-a', app, '-W', '--stdout', join(output, 'stdout.log'),
        '--stderr', join(output, 'stderr.log'), '--args', '--project', project, '--nologin']);
    assert.throws(() => LifecycleExitLiveBaseline.launchCommand(app, project, output, 'linux'), /macos_required/u);
});


test('candidate installed tree verification rejects payload changes, extra files and links', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-lifecycle-tree-'));
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const digest = sha(`entry.js:${sha('verified payload')}`);
    try {
        writeFileSync(join(root, 'entry.js'), 'verified payload');
        writeFileSync(join(root, 'peanut.pod-lite.manifest.json'), 'separate signed manifest');
        assert.doesNotThrow(() => LifecycleExitLiveBaseline.assertTreeDigest(root, digest, 'peanut.pod-lite.manifest.json'));
        writeFileSync(join(root, 'entry.js'), 'modified payload');
        assert.throws(() => LifecycleExitLiveBaseline.assertTreeDigest(root, digest, 'peanut.pod-lite.manifest.json'), /tree_digest_mismatch/u);
        writeFileSync(join(root, 'entry.js'), 'verified payload');
        writeFileSync(join(root, 'extra.js'), 'extra');
        assert.throws(() => LifecycleExitLiveBaseline.assertTreeDigest(root, digest, 'peanut.pod-lite.manifest.json'), /tree_digest_mismatch/u);
        rmSync(join(root, 'extra.js'));
        symlinkSync(join(root, 'entry.js'), join(root, 'linked.js'));
        assert.throws(() => LifecycleExitLiveBaseline.assertTreeDigest(root, digest, 'peanut.pod-lite.manifest.json'), /link_refused/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});


test('installed candidate digest uses file path ordering for asset and paired meta names', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-lifecycle-paired-meta-'));
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    try {
        writeFileSync(join(root, 'cube.prefab'), 'asset'); writeFileSync(join(root, 'cube.prefab.meta'), 'metadata');
        const expected = sha(`cube.prefab:${sha('asset')}\ncube.prefab.meta:${sha('metadata')}`);
        assert.doesNotThrow(() => LifecycleExitLiveBaseline.assertTreeDigest(root, expected));
    } finally { rmSync(root, { recursive: true, force: true }); }
});
