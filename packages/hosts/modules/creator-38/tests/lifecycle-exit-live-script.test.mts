import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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


test('plain SDK missing-start timer diagnostics fail while generic expected business refusal text is not reclassified', () => {
    const root = mkdtempSync(join(tmpdir(), 'lite-lifecycle-sdk-timer-'));
    try {
        const file = join(root, 'stdout.log');
        const raw = Buffer.from('expected operation failed validation and was refused\n'
            + 'trackTimeEnd failed! Can not find the track time asset-db:worker-startup-database[internal] start\n'
            + 'trackTimeEnd failed! Can not find the track time asset-db:worker-startup-database[assets] start\n');
        writeFileSync(file, raw);
        const result = LifecycleExitLiveBaseline.assessRaw(root, [{ channel: 'stdout', reference: 'stdout.log', exists: true }]);
        assert.equal(result.issueCount, 2);
        assert.deepEqual(result.locations, [{ channel: 'stdout', line: 2 }, { channel: 'stdout', line: 3 }]);
        assert.deepEqual(readFileSync(file), raw);
    } finally { rmSync(root, { recursive: true, force: true }); }
});


test('common SDK environment admits only exact fixed helper bytes and refuses additional main-process or business code', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'lite-lifecycle-fixed-helper-')));
    try {
        const worker = 'module.exports={load(){},unload(){}};'; const digest = createHash('sha256').update(worker).digest('hex');
        const manifest = { package_version: 2, name: 'peanut-sdk-startup-timer-helper', version: '0.1.0', private: true,
            main: './main.js', editor: '3.8.7', contributions: { 'asset-db': { script: './worker.js', 'global-hook': ['beforePreStart'] } } };
        writeFileSync(join(root, 'worker.js'), worker); writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
        writeFileSync(join(root, 'main.js'), "'use strict';\nmodule.exports = {};\n");
        assert.doesNotThrow(() => LifecycleExitLiveBaseline.assertSdkHelper(root, digest));
        writeFileSync(join(root, 'main.js'), 'module.exports={load(){}};');
        assert.throws(() => LifecycleExitLiveBaseline.assertSdkHelper(root, digest), /payload_mismatch/u);
        writeFileSync(join(root, 'main.js'), "'use strict';\nmodule.exports = {};\n");
        writeFileSync(join(root, 'worker.js'), worker + '// changed');
        assert.throws(() => LifecycleExitLiveBaseline.assertSdkHelper(root, digest), /payload_mismatch/u);
        writeFileSync(join(root, 'worker.js'), worker); writeFileSync(join(root, 'extra.js'), 'business');
        assert.throws(() => LifecycleExitLiveBaseline.assertSdkHelper(root, digest), /file_set_invalid/u);
        rmSync(join(root, 'extra.js'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, messages: { execute: {} } }));
        assert.throws(() => LifecycleExitLiveBaseline.assertSdkHelper(root, digest), /payload_mismatch/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
});


test('formal SDK environment requires the exact direct worker contribution rather than an indirect bootstrap', () => {
    const direct = { contributions: { 'asset-db': { script: './dist/sdk-startup-timer-worker.js', 'global-hook': ['beforePreStart'] } } };
    assert.doesNotThrow(() => LifecycleExitLiveBaseline.assertSdkWorkerContribution(direct));
    for (const value of [null, {}, { contributions: { 'asset-db': { ...direct.contributions['asset-db'], script: './dist/sdk-startup-timer-bootstrap.js' } } },
        { contributions: { 'asset-db': { ...direct.contributions['asset-db'], 'global-hook': ['beforeReady'] } } }]) {
        assert.throws(() => LifecycleExitLiveBaseline.assertSdkWorkerContribution(value), /contribution_invalid/u);
    }
});

test('quiet native logs cannot replace completed same-run Host smoke with the actual candidate main digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'lifecycle-host-smoke-'));
    const runtime = join(root, 'peanut-plugins/runtime'); const main = join(root, 'extensions/peanut-pod-lite-host/dist/main.js');
    mkdirSync(runtime, { recursive: true }); mkdirSync(dirname(main), { recursive: true }); writeFileSync(main, 'actual candidate main');
    const started = '2026-10-19T00:00:00.000Z'; const ended = '2026-10-19T00:01:00.000Z';
    const report = { startedAt: started, writtenAt: '2026-10-19T00:00:10.000Z', ready: true, failed: 0, passed: 1, skipped: 0,
        results: [{ ok: true }], artifacts: { host: { mainDigest: createHash('sha256').update(readFileSync(main)).digest('hex') } } };
    const stage = (state: string, result: unknown) => { writeFileSync(join(runtime, 'smoke-results.json'), JSON.stringify(result));
        writeFileSync(join(runtime, 'startup-diagnostics.json'), JSON.stringify({ state, writtenAt: report.writtenAt, detail: result })); };
    try {
        assert.equal(LifecycleExitLiveBaseline.assessHostSmoke(root, started, ended).ok, false);
        stage('waiting-for-enable', report); assert.equal(LifecycleExitLiveBaseline.assessHostSmoke(root, started, ended).ok, false);
        stage('complete', report); assert.equal(LifecycleExitLiveBaseline.assessHostSmoke(root, started, ended).ok, true);
        stage('complete', { ...report, skipped: 1, results: [{ ok: true }, { ok: false, skipped: true }] });
        assert.equal(LifecycleExitLiveBaseline.assessHostSmoke(root, started, ended).ok, true);
        for (const value of [{ ...report, failed: 1 }, { ...report, results: [{ ok: false }] },
            { ...report, skipped: 1, results: [{ ok: false, skipped: true }] },
            { ...report, passed: 0, skipped: 1, results: [{ ok: false, skipped: true }] },
            { ...report, passed: 2 }, { ...report, skipped: 1 },
            { ...report, results: [null] }, { ...report, results: ['not-a-record'] }, { ...report, results: [[]] },
            { ...report, results: [{ ok: true, skipped: true }] },
            { ...report, startedAt: '2026-10-18T00:00:00.000Z' }, { ...report, artifacts: { host: { mainDigest: 'foreign' } } }]) {
            stage('complete', value); assert.equal(LifecycleExitLiveBaseline.assessHostSmoke(root, started, ended).ok, false);
        }
    } finally { rmSync(root, { recursive: true, force: true }); }
});
