import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
    realpathSync, unlinkSync, writeSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const PID_GATE_SCRIPT = 'printf "READY:%s:%s\\n" "$$" "$1"; shift; IFS= read -r gate || exit 70; [ "$gate" = "GO" ] || exit 71; exec "$@"';
const LEASE_NAME = 'sprite-runtime-lease-synthetic.json';
const MAX_READY_MS = 2000;
const MAX_GATE_MS = 5000;

type OwnedLease = { path: string; dev: number; ino: number; digest: string; generation: string };
type SyntheticLease = {
    schema: 'peanut.pod.sprite-pid-gate-synthetic.v1'; status: 'active';
    projectPath: string; creatorVersion: 'synthetic'; creatorExecutable: string;
    creatorExecutableSha256: string; owner: string; runId: string; pid: number;
    issuedAt: number; expiresAt: number; probeBundleSha256: string; generation: string;
    permissions: ['existingAssetIdentity'];
};

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function statFile(path: string): Stats {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1 || realpathSync(path) !== path)
        throw new Error('component_sprite_pid_gate_file_invalid');
    return stat;
}
function syntheticRoot(path: string): string {
    const root = realpathSync(path);
    if (root !== resolve(path) || dirname(root) !== realpathSync(tmpdir())
        || !basename(root).startsWith('component-sprite-activation-')
        || !lstatSync(root).isDirectory())
        throw new Error('component_sprite_pid_gate_synthetic_root_invalid');
    return root;
}
function publish(path: string, value: SyntheticLease): OwnedLease {
    if (lstatSync(path, { throwIfNoEntry: false }))
        throw new Error('component_sprite_pid_gate_lease_occupied');
    const temporary = join(dirname(path), `sprite-runtime-lease.${value.generation}.tmp`);
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    let fd: number | null = null;
    let own: { dev: number; ino: number } | null = null;
    let linked = false;
    try {
        fd = openSync(temporary, 'wx', 0o600);
        const stat = fstatSync(fd); own = { dev: stat.dev, ino: stat.ino };
        let offset = 0;
        while (offset < bytes.length) {
            const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
            if (written <= 0) throw new Error('component_sprite_pid_gate_lease_write_failed');
            offset += written;
        }
        fsyncSync(fd); closeSync(fd); fd = null;
        linkSync(temporary, path); linked = true;
        unlinkSync(temporary);
        const final = statFile(path);
        if (final.dev !== own.dev || final.ino !== own.ino || final.nlink !== 1
            || (final.mode & 0o777) !== 0o600 || sha(readFileSync(path)) !== sha(bytes))
            throw new Error('component_sprite_pid_gate_lease_publish_mismatch');
        return { path, ...own, digest: sha(bytes), generation: value.generation };
    } catch (error) {
        if (fd !== null) closeSync(fd);
        for (const candidate of [linked ? path : '', temporary]) {
            if (!candidate || !own) continue;
            const current = lstatSync(candidate, { throwIfNoEntry: false });
            if (current?.dev === own.dev && current.ino === own.ino) unlinkSync(candidate);
        }
        throw error;
    }
}
function checkOwned(lease: OwnedLease): void {
    const stat = statFile(lease.path);
    if (stat.dev !== lease.dev || stat.ino !== lease.ino || stat.nlink !== 1
        || (stat.mode & 0o777) !== 0o600 || sha(readFileSync(lease.path)) !== lease.digest)
        throw new Error('component_sprite_pid_gate_lease_ownership_mismatch');
}
function waitReady(child: ChildProcessWithoutNullStreams, nonce: string): Promise<void> {
    return new Promise((done, reject) => {
        let pending = '';
        const timer = setTimeout(() => finish(new Error('component_sprite_pid_gate_ready_timeout')), MAX_READY_MS);
        const finish = (error?: Error): void => {
            clearTimeout(timer); child.stdout.off('data', data); child.off('error', failed);
            child.off('exit', exited);
            if (error) reject(error); else done();
        };
        const failed = (error: Error): void => finish(error);
        const exited = (): void => finish(new Error('component_sprite_pid_gate_early_exit'));
        const data = (chunk: Buffer): void => {
            pending += chunk.toString('utf8');
            if (pending.length > 128) { finish(new Error('component_sprite_pid_gate_ready_invalid')); return; }
            const newline = pending.indexOf('\n');
            if (newline < 0) return;
            if (pending !== `READY:${child.pid}:${nonce}\n`)
                finish(new Error('component_sprite_pid_gate_ready_invalid'));
            else finish();
        };
        child.stdout.on('data', data); child.once('error', failed); child.once('exit', exited);
    });
}

/**
 * Synthetic proof only. A real Creator launch requires a separate registered stage.
 */
export async function prepareSyntheticPidGate(input: {
    root: string; executable: string; args?: string[]; owner: string; runId: string;
    probeBundleSha256: string;
}): Promise<{
    pid: number; leasePath: string; go(): void; wait(): Promise<number>; close(): Promise<void>;
}> {
    const root = syntheticRoot(input.root);
    const executable = realpathSync(input.executable);
    if (executable !== resolve(input.executable) || !executable.startsWith(root + sep)
        || (statFile(executable).mode & 0o111) === 0
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(input.owner)
        || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(input.runId)
        || !/^[a-f0-9]{64}$/u.test(input.probeBundleSha256)
        || !Array.isArray(input.args ?? []) || (input.args ?? []).some(arg => typeof arg !== 'string' || arg.includes('\0')))
        throw new Error('component_sprite_pid_gate_synthetic_input_invalid');
    const leasePath = join(root, LEASE_NAME);
    if (lstatSync(leasePath, { throwIfNoEntry: false }))
        throw new Error('component_sprite_pid_gate_lease_occupied');
    const nonce = randomBytes(16).toString('hex');
    const child = spawn('/bin/sh', ['-c', PID_GATE_SCRIPT, 'pid-gate', nonce, executable, ...(input.args ?? [])],
        { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
    let lease: OwnedLease | null = null;
    let released = false;
    let gateTimer: ReturnType<typeof setTimeout> | null = null;
    let exitCode: number | null = null;
    const exited = new Promise<number>((done, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            exitCode = code;
            if (gateTimer) clearTimeout(gateTimer);
            if (signal || code === null) reject(new Error('component_sprite_pid_gate_child_failed'));
            else done(code);
        });
    });
    // A failed launch is always observed by wait()/close(), including failures before READY.
    void exited.catch(() => undefined);
    const close = async (): Promise<void> => {
        if (gateTimer) clearTimeout(gateTimer);
        if (exitCode === null && child.exitCode === null && child.signalCode === null)
            child.kill('SIGTERM');
        child.stdin.end();
        await exited.catch(() => undefined);
        if (lease) { checkOwned(lease); unlinkSync(lease.path); lease = null; }
    };
    try {
        await waitReady(child, nonce);
        if (!Number.isSafeInteger(child.pid) || child.pid! <= 0 || child.exitCode !== null
            || child.signalCode !== null)
            throw new Error('component_sprite_pid_gate_child_identity_invalid');
        const now = Date.now();
        const generation = randomBytes(16).toString('hex');
        lease = publish(leasePath, { schema: 'peanut.pod.sprite-pid-gate-synthetic.v1',
            status: 'active', projectPath: root, creatorVersion: 'synthetic',
            creatorExecutable: executable, creatorExecutableSha256: sha(readFileSync(executable)),
            owner: input.owner, runId: input.runId, pid: child.pid!, issuedAt: now,
            expiresAt: now + MAX_GATE_MS, probeBundleSha256: input.probeBundleSha256,
            generation, permissions: ['existingAssetIdentity'] });
        gateTimer = setTimeout(() => { if (!released && child.exitCode === null) child.kill('SIGTERM'); }, MAX_GATE_MS);
        return { pid: child.pid!, leasePath,
            go(): void {
                if (released || !lease || child.exitCode !== null || child.signalCode !== null)
                    throw new Error('component_sprite_pid_gate_not_ready');
                checkOwned(lease);
                const value = JSON.parse(readFileSync(lease.path, 'utf8')) as SyntheticLease;
                if (value.pid !== child.pid || value.generation !== lease.generation
                    || value.status !== 'active' || Date.now() >= value.expiresAt)
                    throw new Error('component_sprite_pid_gate_lease_invalid');
                released = true;
                child.stdin.end('GO\n');
            },
            wait: () => exited,
            close };
    } catch (error) { await close(); throw error; }
}
