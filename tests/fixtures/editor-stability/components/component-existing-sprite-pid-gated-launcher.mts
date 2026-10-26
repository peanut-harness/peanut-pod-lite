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
const PRIVATE = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-editor-operations-20261026/task-5.1';
const PRODUCTION = Object.freeze({
    project: '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3',
    binary: '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/MacOS/CocosCreator',
    binarySha256: '799386a840d319b7eb78a788a4919950d8537f41aeca2cb6ce85a0ee2c4a0330',
    lease: join(PRIVATE, 'sprite-runtime-lease-383.json'),
    permit: join(PRIVATE, 'sprite-production-383-stage-permit.json'),
    candidateSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
    hostSha256: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
    coreSha256: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f',
    probeSourceCommit: '61fcce7509044d4715b25462dde2849dc929c1a1',
    probeBundleSha256: '0add8b7a252e597d6b9972b21ef93f83bc9a9e544261f8d24565f66a5abcee1a',
});

type OwnedLease = { path: string; dev: number; ino: number; digest: string; generation: string };
type SyntheticLease = {
    schema: 'peanut.pod.sprite-pid-gate-synthetic.v1'; status: 'active';
    projectPath: string; creatorVersion: 'synthetic'; creatorExecutable: string;
    creatorExecutableSha256: string; owner: string; runId: string; pid: number;
    issuedAt: number; expiresAt: number; probeBundleSha256: string; generation: string;
    permissions: ['existingAssetIdentity'];
};
type RuntimeLease = {
    schema: 'peanut.pod.sprite-runtime-lease.v1'; status: 'active';
    projectPath: string; creatorVersion: '3.8.3'; creatorExecutable: string;
    creatorExecutableSha256: string; purpose: 'existing-asset-compatibility';
    owner: string; runId: string; pid: number; issuedAt: number; expiresAt: number;
    candidateSourceCommit: string; hostSha256: string; coreSha256: string;
    probeSourceCommit: string; probeBundleSha256: string; permissions: ['existingAssetIdentity'];
};
type GateLease = SyntheticLease | RuntimeLease;
type GateSession = { pid: number; leasePath: string; go(): void; wait(): Promise<number>; close(): Promise<void> };

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
function publish(path: string, value: GateLease, generation: string): OwnedLease {
    if (lstatSync(path, { throwIfNoEntry: false }))
        throw new Error('component_sprite_pid_gate_lease_occupied');
    const temporary = join(dirname(path), `sprite-runtime-lease.${generation}.tmp`);
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
        return { path, ...own, digest: sha(bytes), generation };
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

async function prepareGate(config: { cwd: string; executable: string; args: string[]; leasePath: string;
    lease(pid: number, now: number, generation: string): GateLease }): Promise<GateSession> {
    const { cwd, executable, args, leasePath } = config;
    if (lstatSync(leasePath, { throwIfNoEntry: false }))
        throw new Error('component_sprite_pid_gate_lease_occupied');
    const nonce = randomBytes(16).toString('hex');
    const child = spawn('/bin/sh', ['-c', PID_GATE_SCRIPT, 'pid-gate', nonce, executable, ...args],
        { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
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
        lease = publish(leasePath, config.lease(child.pid!, now, generation), generation);
        gateTimer = setTimeout(() => { if (!released && child.exitCode === null) child.kill('SIGTERM'); }, MAX_GATE_MS);
        return { pid: child.pid!, leasePath,
            go(): void {
                if (released || !lease || child.exitCode !== null || child.signalCode !== null)
                    throw new Error('component_sprite_pid_gate_not_ready');
                checkOwned(lease);
                const value = JSON.parse(readFileSync(lease.path, 'utf8')) as GateLease;
                if (value.pid !== child.pid || ('generation' in value && value.generation !== lease.generation)
                    || value.status !== 'active' || Date.now() >= value.expiresAt)
                    throw new Error('component_sprite_pid_gate_lease_invalid');
                released = true;
                child.stdin.end('GO\n');
            },
            wait: () => exited,
            close };
    } catch (error) { await close(); throw error; }
}

/**
 * Actual shell/exec proof in an owned temporary fixture only.
 */
export async function prepareSyntheticPidGate(input: {
    root: string; executable: string; args?: string[]; owner: string; runId: string;
    probeBundleSha256: string;
}): Promise<GateSession> {
    const root = syntheticRoot(input.root);
    const executable = realpathSync(input.executable);
    if (executable !== resolve(input.executable) || !executable.startsWith(root + sep)
        || (statFile(executable).mode & 0o111) === 0
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(input.owner)
        || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(input.runId)
        || !/^[a-f0-9]{64}$/u.test(input.probeBundleSha256)
        || !Array.isArray(input.args ?? []) || (input.args ?? []).some(arg => typeof arg !== 'string' || arg.includes('\0')))
        throw new Error('component_sprite_pid_gate_synthetic_input_invalid');
    return prepareGate({ cwd: root, executable, args: input.args ?? [], leasePath: join(root, LEASE_NAME),
        lease: (pid, now, generation): SyntheticLease => ({ schema: 'peanut.pod.sprite-pid-gate-synthetic.v1',
            status: 'active', projectPath: root, creatorVersion: 'synthetic',
            creatorExecutable: executable, creatorExecutableSha256: sha(readFileSync(executable)),
            owner: input.owner, runId: input.runId, pid, issuedAt: now,
            expiresAt: now + MAX_GATE_MS, probeBundleSha256: input.probeBundleSha256,
            generation, permissions: ['existingAssetIdentity'] }) });
}

type ProductionPermit = {
    schema: 'peanut.pod.sprite-production-383-stage-permit.v1'; status: 'active';
    owner: string; runId: string; projectPath: string; creatorVersion: '3.8.3';
    creatorExecutable: string; creatorExecutableSha256: string;
    candidateSourceCommit: string; hostSha256: string; coreSha256: string;
    probeSourceCommit: string; probeBundleSha256: string;
    issuedAt: number; expiresAt: number;
    backupManifestPath: string; backupManifestSha256: string;
    processSnapshotPath: string; processSnapshotSha256: string;
};

function productionPermit(owner: string, runId: string): ProductionPermit {
    const path = PRODUCTION.permit;
    const stat = statFile(path);
    if ((stat.mode & 0o777) !== 0o600)
        throw new Error('component_sprite_pid_gate_permit_file_invalid');
    const value = JSON.parse(readFileSync(path, 'utf8')) as ProductionPermit;
    const now = Date.now();
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 19
        || value.schema !== 'peanut.pod.sprite-production-383-stage-permit.v1'
        || value.status !== 'active' || value.owner !== owner || value.runId !== runId
        || value.projectPath !== PRODUCTION.project || value.creatorVersion !== '3.8.3'
        || value.creatorExecutable !== PRODUCTION.binary
        || value.creatorExecutableSha256 !== PRODUCTION.binarySha256
        || value.candidateSourceCommit !== PRODUCTION.candidateSourceCommit
        || value.hostSha256 !== PRODUCTION.hostSha256 || value.coreSha256 !== PRODUCTION.coreSha256
        || value.probeSourceCommit !== PRODUCTION.probeSourceCommit
        || value.probeBundleSha256 !== PRODUCTION.probeBundleSha256
        || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
        || value.issuedAt > now || value.expiresAt <= now
        || value.expiresAt - value.issuedAt > 600000
        || !/^[a-f0-9]{64}$/u.test(value.backupManifestSha256)
        || !/^[a-f0-9]{64}$/u.test(value.processSnapshotSha256))
        throw new Error('component_sprite_pid_gate_permit_identity_invalid');
    const prefix = join(PRIVATE, 'c0-383-preparation') + sep;
    if (!value.backupManifestPath.startsWith(prefix)
        || basename(value.backupManifestPath) !== 'manifest.json'
        || value.processSnapshotPath !== join(dirname(value.backupManifestPath), 'process-snapshot.txt')
        || realpathSync(value.backupManifestPath) !== value.backupManifestPath
        || realpathSync(value.processSnapshotPath) !== value.processSnapshotPath
        || sha(readFileSync(value.backupManifestPath)) !== value.backupManifestSha256
        || sha(readFileSync(value.processSnapshotPath)) !== value.processSnapshotSha256)
        throw new Error('component_sprite_pid_gate_permit_evidence_invalid');
    const backup = JSON.parse(readFileSync(value.backupManifestPath, 'utf8'));
    if (backup?.schema !== 'peanut.pod.c0-full-byte-backup.v1'
        || backup.source !== PRODUCTION.project || backup.sourceBeforeAfterEqual !== true
        || backup.copyReadbackEqual !== true)
        throw new Error('component_sprite_pid_gate_permit_backup_invalid');
    return value;
}

/**
 * Production target is fixed. The separately registered stage permit is absent until phase C.
 */
export async function prepareProduction383PidGate(input: { owner: string; runId: string }): Promise<GateSession> {
    if (!input || typeof input !== 'object' || Object.keys(input).length !== 2
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(input.owner)
        || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(input.runId)
        || realpathSync(PRODUCTION.project) !== PRODUCTION.project
        || realpathSync(PRODUCTION.binary) !== PRODUCTION.binary
        || (statFile(PRODUCTION.binary).mode & 0o111) === 0
        || sha(readFileSync(PRODUCTION.binary)) !== PRODUCTION.binarySha256
        || realpathSync(PRIVATE) !== PRIVATE)
        throw new Error('component_sprite_pid_gate_production_identity_invalid');
    const permit = productionPermit(input.owner, input.runId);
    return prepareGate({ cwd: PRODUCTION.project, executable: PRODUCTION.binary,
        args: ['--project', PRODUCTION.project], leasePath: PRODUCTION.lease,
        lease: (pid, now): RuntimeLease => ({
            schema: 'peanut.pod.sprite-runtime-lease.v1', status: 'active',
            projectPath: PRODUCTION.project, creatorVersion: '3.8.3',
            owner: input.owner, runId: input.runId, pid,
            candidateSourceCommit: PRODUCTION.candidateSourceCommit,
            hostSha256: PRODUCTION.hostSha256, coreSha256: PRODUCTION.coreSha256,
            probeSourceCommit: PRODUCTION.probeSourceCommit,
            probeBundleSha256: PRODUCTION.probeBundleSha256,
            issuedAt: now, expiresAt: Math.min(now + 120000, permit.expiresAt),
            permissions: ['existingAssetIdentity'], creatorExecutable: PRODUCTION.binary,
            purpose: 'existing-asset-compatibility',
            creatorExecutableSha256: PRODUCTION.binarySha256,
        }) });
}
