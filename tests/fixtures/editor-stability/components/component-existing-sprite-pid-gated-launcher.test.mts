import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PID_GATE_SCRIPT, prepareProduction383PidGate,
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
        } finally { await gate.close(); }
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
