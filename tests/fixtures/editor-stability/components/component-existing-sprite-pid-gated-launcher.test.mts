import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync,
    renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PID_GATE_SCRIPT, assertProduction383EvidencePaths, assertProduction383PermitIdentity,
    prepareProduction383PidGate, productionCreatorInvocation,
    prepareSyntheticPidGate } from './component-existing-sprite-pid-gated-launcher.mts';

const OWNER = '12345678-1234-1234-1234-123456789abc';
const HASH = 'a'.repeat(64);
function fixture(): { root: string; executable: string; marker: string; dispose(): void } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-activation-')));
    const executable = join(root, 'harmless-program');
    const marker = join(root, 'exec marker');
    writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$$" > "$1"\n');
    chmodSync(executable, 0o700);
    return { root, executable, marker, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
function options(f: ReturnType<typeof fixture>) {
    return { root: f.root, executable: f.executable, args: [f.marker],
        owner: OWNER, runId: 'synthetic-pid-gate', probeBundleSha256: HASH };
}

test('real shell blocks until complete lease, then exec keeps its PID', async () => {
    const f = fixture();
    try {
        const gate = await prepareSyntheticPidGate(options(f));
        try {
            assert.equal(existsSync(f.marker), false);
            const lease = JSON.parse(readFileSync(gate.leasePath, 'utf8'));
            assert.equal(lease.pid, gate.pid);
            assert.equal(lease.creatorExecutable, f.executable);
            assert.deepEqual(lease.permissions, ['existingAssetIdentity']);
            assert.equal(lstatSync(gate.leasePath).mode & 0o777, 0o600);
            assert.equal(lstatSync(gate.leasePath).nlink, 1);
            gate.go();
            assert.equal(await gate.wait(), 0);
            assert.equal(Number(readFileSync(f.marker, 'utf8').trim()), gate.pid);
        } finally { await gate.close(); }
        assert.equal(existsSync(gate.leasePath), false);
    } finally { f.dispose(); }
});

test('raw gate rejects wrong token and EOF without executing target', async () => {
    const f = fixture();
    try {
        for (const input of ['NO\n', '']) {
            const child = spawn('/bin/sh', ['-c', PID_GATE_SCRIPT, 'pid-gate', 'nonce', f.executable, f.marker],
                { cwd: f.root, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
            const status = new Promise<number | null>(done => child.once('exit', code => done(code)));
            child.stdin.end(input);
            assert.equal(await status, input ? 71 : 70);
            assert.equal(existsSync(f.marker), false);
        }
    } finally { f.dispose(); }
});

test('foreign lease blocks publication and remains unchanged', async () => {
    const f = fixture();
    const leasePath = join(f.root, 'sprite-runtime-lease-synthetic.json');
    try {
        writeFileSync(leasePath, 'foreign', { mode: 0o600 });
        await assert.rejects(prepareSyntheticPidGate(options(f)), /lease_occupied/u);
        assert.equal(readFileSync(leasePath, 'utf8'), 'foreign');
        assert.equal(existsSync(f.marker), false);
    } finally { f.dispose(); }
});

test('tampered lease refuses GO and is never removed as owned', async () => {
    const f = fixture();
    try {
        const gate = await prepareSyntheticPidGate(options(f));
        writeFileSync(gate.leasePath, 'foreign');
        assert.throws(() => gate.go(), /ownership_mismatch/u);
        await assert.rejects(gate.close(), /ownership_mismatch/u);
        assert.equal(readFileSync(gate.leasePath, 'utf8'), 'foreign');
        assert.equal(existsSync(f.marker), false);
    } finally { f.dispose(); }
});

test('synthetic path guard refuses targets outside its owned temporary root', async () => {
    const f = fixture();
    try {
        await assert.rejects(prepareSyntheticPidGate({ ...options(f), executable: '/bin/echo' }), /synthetic_input_invalid/u);
        assert.equal(existsSync(f.marker), false);
    } finally { f.dispose(); }
});

test('unreleased gate times out without executing and revokes only its own lease', async () => {
    const f = fixture();
    try {
        const gate = await prepareSyntheticPidGate(options(f));
        try {
            await assert.rejects(gate.wait(), /child_failed/u);
            assert.equal(existsSync(f.marker), false);
        } finally { await assert.rejects(gate.close(), /child_failed/u); }
        assert.equal(existsSync(gate.leasePath), false);
    } finally { f.dispose(); }
});

test('stdout and stderr retain full output larger than pipe buffers through exec', async () => {
    const f = fixture();
    try {
        writeFileSync(f.executable, '#!/bin/sh\n'
            + 'dd if=/dev/zero bs=1024 count=256 2>/dev/null\n'
            + 'dd if=/dev/zero bs=1024 count=256 1>&2 2>/dev/null\n'
            + 'printf "%s\\n" "$$" > "$1"\n');
        const gate = await prepareSyntheticPidGate(options(f));
        try {
            gate.go();
            assert.equal(await gate.wait(), 0);
            const stdout = readFileSync(gate.stdoutPath);
            const stderr = readFileSync(gate.stderrPath);
            assert.match(stdout.subarray(0, 50).toString('utf8'), /^READY:[0-9]+:[a-f0-9]{32}\n/u);
            assert.equal(stdout.length, stdout.indexOf(10) + 1 + 256 * 1024);
            assert.equal(stderr.length, 256 * 1024);
            assert.equal(stdout.subarray(stdout.indexOf(10) + 1).equals(Buffer.alloc(256 * 1024)), true);
            assert.equal(stderr.equals(Buffer.alloc(256 * 1024)), true);
            assert.equal(Number(readFileSync(f.marker, 'utf8').trim()), gate.pid);
        } finally { await gate.close(); }
    } finally { f.dispose(); }
});

test('replaced raw capture path refuses GO and preserves the foreign file', async () => {
    const f = fixture();
    try {
        const gate = await prepareSyntheticPidGate(options(f));
        renameSync(gate.stdoutPath, `${gate.stdoutPath}.owned`);
        writeFileSync(gate.stdoutPath, 'foreign', { mode: 0o600 });
        assert.throws(() => gate.go(), /raw_ownership_mismatch/u);
        await assert.rejects(gate.close(), /child_failed|raw_ownership_mismatch/u);
        assert.equal(readFileSync(gate.stdoutPath, 'utf8'), 'foreign');
        assert.equal(existsSync(f.marker), false);
        assert.equal(existsSync(gate.leasePath), false);
    } finally { f.dispose(); }
});

test('production adapter refuses missing stage permit and freeform caller targets without a real lease', async () => {
    const path = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-editor-operations-20261026/task-5.1/sprite-runtime-lease-383.json';
    assert.equal(existsSync(path), false);
    await assert.rejects(prepareProduction383PidGate({ owner: OWNER, runId: 'synthetic-pid-gate' }),
        /file_invalid|production_identity_invalid/u);
    await assert.rejects(prepareProduction383PidGate({ owner: OWNER, runId: 'synthetic-pid-gate',
        executable: '/bin/echo' } as never), /production_identity_invalid/u);
    assert.equal(existsSync(path), false);
});

test('production permit pins C5 run04 and rejects consumed or stale diagnostic identities', () => {
    const now = Date.now();
    const permit = { schema: 'peanut.pod.sprite-production-383-stage-permit.v1', status: 'active',
        owner: OWNER, runId: 'pod-51-probe-383-20261027-04',
        projectPath: '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3',
        creatorVersion: '3.8.3',
        creatorExecutable: '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/MacOS/CocosCreator',
        creatorExecutableSha256: '799386a840d319b7eb78a788a4919950d8537f41aeca2cb6ce85a0ee2c4a0330',
        candidateSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
        hostSha256: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
        coreSha256: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f',
        probeSourceCommit: 'd3aab51e70a9d3ff034f573cb8ad61281f65978c',
        probeBundleSha256: '301c82d3792a07ed1c7ea99283cda87becd9d9ce7085bd621a8ae2d9764cd22a',
        issuedAt: now, expiresAt: now + 600000,
        backupManifestPath: '/private/tmp/not-used-by-identity-check/manifest.json',
        backupManifestSha256: HASH, processSnapshotPath: '/private/tmp/not-used-by-identity-check/process-snapshot.txt',
        processSnapshotSha256: HASH };
    assert.doesNotThrow(() => assertProduction383PermitIdentity(permit, OWNER, permit.runId, now));
    for (const stale of [
        { probeSourceCommit: '61fcce7509044d4715b25462dde2849dc929c1a1' },
        { probeBundleSha256: '0add8b7a252e597d6b9972b21ef93f83bc9a9e544261f8d24565f66a5abcee1a' },
        { probeSourceCommit: 'aa4423bbb6371bfcf20a5d1e3ce2bf053f538995' },
        { probeBundleSha256: '98340a038a17de63a7fcff08cfc25bc321c026f8aa4acf7c09ea4c6e36c91a41' },
        { runId: 'pod-51-probe-383-20261027-02' },
        { runId: 'pod-51-probe-383-20261027-03' },
    ]) assert.throws(() => assertProduction383PermitIdentity({ ...permit, ...stale }, OWNER, permit.runId, now),
        /permit_identity_invalid/u);
});

test('production evidence path admits only one exact C5 backup leaf and matching snapshot', () => {
    const root = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-editor-operations-20261026/task-5.1';
    const directory = join(root, 'c5-383-preparation', '20261027T020000Z-abcdef12');
    const valid = { backupManifestPath: join(directory, 'manifest.json'),
        processSnapshotPath: join(directory, 'process-snapshot.txt') };
    assert.doesNotThrow(() => assertProduction383EvidencePaths(valid));
    for (const stale of [
        { backupManifestPath: valid.backupManifestPath.replace('c5-383-preparation', 'c0-383-preparation') },
        { backupManifestPath: valid.backupManifestPath.replace('c5-383-preparation', 'c3-383-preparation') },
        { backupManifestPath: valid.backupManifestPath.replace('c5-383-preparation', 'c4-383-preparation') },
        { backupManifestPath: valid.backupManifestPath.replace('c5-383-preparation', 'c5-383-preparation-old') },
        { backupManifestPath: valid.backupManifestPath.replace('20261027T020000Z-abcdef12', 'not-a-run') },
        { backupManifestPath: join(directory, 'nested', 'manifest.json') },
        { backupManifestPath: `${directory}/../20261027T020000Z-abcdef12/manifest.json` },
        { backupManifestPath: '/private/tmp/manifest.json' },
        { processSnapshotPath: join(directory, 'other.txt') },
        { processSnapshotPath: join(directory, 'nested', 'process-snapshot.txt') },
    ]) assert.throws(() => assertProduction383EvidencePaths({ ...valid, ...stale }),
        /permit_evidence_invalid/u);
});

test('production invocation passes only validated host context and fixed project flags to harmless executable', async () => {
    const f = fixture();
    try {
        const invocation = productionCreatorInvocation();
        assert.deepEqual(invocation.args, ['--project',
            '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3',
            '--nologin']);
        for (const key of ['NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])
            assert.equal(invocation.environment[key], undefined);
        writeFileSync(f.executable, '#!/bin/sh\n'
            + 'printf "%s\\n" "$HOME" "$USER" "$TMPDIR" "$LANG" "$PATH" "$2" "$3" "$4" > "$1"\n');
        const child = spawn(f.executable, [f.marker, ...invocation.args],
            { cwd: f.root, env: invocation.environment, stdio: 'ignore' });
        const code = await new Promise<number | null>(done => child.once('exit', value => done(value)));
        assert.equal(code, 0);
        const lines = readFileSync(f.marker, 'utf8').trimEnd().split('\n');
        assert.deepEqual(lines, [invocation.environment.HOME, invocation.environment.USER,
            invocation.environment.TMPDIR, invocation.environment.LANG, invocation.environment.PATH,
            ...invocation.args]);
    } finally { f.dispose(); }
});

test('production invocation refuses missing HOME without creating a lease', () => {
    const prior = process.env.HOME;
    try {
        delete process.env.HOME;
        assert.throws(() => productionCreatorInvocation(), /production_environment_invalid/u);
    } finally { process.env.HOME = prior; }
    assert.equal(existsSync('/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-editor-operations-20261026/task-5.1/sprite-runtime-lease-383.json'), false);
});
