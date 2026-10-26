import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { closeSync, createWriteStream, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
    realpathSync, unlinkSync, writeSync, type Stats } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { finished } from 'node:stream/promises';

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
type GateSession = { pid: number; leasePath: string; stdoutPath: string; stderrPath: string;
    go(): void; wait(): Promise<number>; close(): Promise<void> };

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
function checkRaw(path: string, fd: number): void {
    const owned = fstatSync(fd); const current = statFile(path);
    if (owned.dev !== current.dev || owned.ino !== current.ino || current.nlink !== 1
        || (current.mode & 0o777) !== 0o600)
        throw new Error('component_sprite_pid_gate_raw_ownership_mismatch');
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
    environment: NodeJS.ProcessEnv;
    rawRoot: string;
    lease(pid: number, now: number, generation: string): GateLease }): Promise<GateSession> {
    const { cwd, executable, args, leasePath } = config;
    if (lstatSync(leasePath, { throwIfNoEntry: false }))
        throw new Error('component_sprite_pid_gate_lease_occupied');
    if (realpathSync(config.rawRoot) !== config.rawRoot || !lstatSync(config.rawRoot).isDirectory()
        || (lstatSync(config.rawRoot).mode & 0o077) !== 0)
        throw new Error('component_sprite_pid_gate_raw_root_invalid');
    const generation = randomBytes(16).toString('hex');
    const stdoutPath = join(config.rawRoot, `sprite-runtime-${generation}.stdout.raw`);
    const stderrPath = join(config.rawRoot, `sprite-runtime-${generation}.stderr.raw`);
    const stdoutFd = openSync(stdoutPath, 'wx', 0o600);
    let stderrFd: number;
    try { stderrFd = openSync(stderrPath, 'wx', 0o600); }
    catch (error) { closeSync(stdoutFd); throw error; }
    try { checkRaw(stdoutPath, stdoutFd); checkRaw(stderrPath, stderrFd); }
    catch (error) { closeSync(stdoutFd); closeSync(stderrFd); throw error; }
    const nonce = randomBytes(16).toString('hex');
    const child = spawn('/bin/sh', ['-c', PID_GATE_SCRIPT, 'pid-gate', nonce, executable, ...args],
        { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: config.environment });
    const stdout = createWriteStream(stdoutPath, { fd: stdoutFd, autoClose: false });
    const stderr = createWriteStream(stderrPath, { fd: stderrFd, autoClose: false });
    let captureError: Error | null = null;
    const failedCapture = (error: Error): void => {
        captureError ??= error;
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    };
    stdout.on('error', failedCapture); stderr.on('error', failedCapture);
    const captured = Promise.all([finished(stdout), finished(stderr)]);
    void captured.catch(() => undefined);
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
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
    let final: Promise<number> | null = null;
    const finalize = (): Promise<number> => {
        final ??= (async () => {
            let code: number | null = null; const failures: unknown[] = [];
            try { code = await exited; } catch (error) { failures.push(error); }
            try { await captured; } catch (error) { failures.push(error); }
            try { fsyncSync(stdoutFd); fsyncSync(stderrFd);
                checkRaw(stdoutPath, stdoutFd); checkRaw(stderrPath, stderrFd); }
            catch (error) { failures.push(error); }
            for (const fd of [stdoutFd, stderrFd]) {
                try { closeSync(fd); } catch (error) { failures.push(error); }
            }
            if (captureError && !failures.includes(captureError)) failures.push(captureError);
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1)
                throw new AggregateError(failures, 'component_sprite_pid_gate_raw_or_child_failed');
            return code!;
        })();
        return final;
    };
    const close = async (): Promise<void> => {
        if (gateTimer) clearTimeout(gateTimer);
        if (exitCode === null && child.exitCode === null && child.signalCode === null)
            child.kill('SIGTERM');
        child.stdin.end();
        let failure: unknown = null;
        try { await finalize(); } catch (error) { failure = error; }
        if (lease) { checkOwned(lease); unlinkSync(lease.path); lease = null; }
        if (failure) throw failure;
    };
    try {
        await waitReady(child, nonce);
        if (!Number.isSafeInteger(child.pid) || child.pid! <= 0 || child.exitCode !== null
            || child.signalCode !== null || captureError)
            throw new Error('component_sprite_pid_gate_child_identity_invalid');
        const now = Date.now();
        lease = publish(leasePath, config.lease(child.pid!, now, generation), generation);
        gateTimer = setTimeout(() => { if (!released && child.exitCode === null) child.kill('SIGTERM'); }, MAX_GATE_MS);
        return { pid: child.pid!, leasePath, stdoutPath, stderrPath,
            go(): void {
                if (released || !lease || child.exitCode !== null || child.signalCode !== null || captureError)
                    throw new Error('component_sprite_pid_gate_not_ready');
                checkRaw(stdoutPath, stdoutFd); checkRaw(stderrPath, stderrFd);
                checkOwned(lease);
                const value = JSON.parse(readFileSync(lease.path, 'utf8')) as GateLease;
                if (value.pid !== child.pid || ('generation' in value && value.generation !== lease.generation)
                    || value.status !== 'active' || Date.now() >= value.expiresAt)
                    throw new Error('component_sprite_pid_gate_lease_invalid');
                released = true;
                child.stdin.end('GO\n');
            },
            wait: finalize,
            close };
    } catch (error) { await close().catch(() => undefined); throw error; }
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
    return prepareGate({ cwd: root, executable, args: input.args ?? [], leasePath: join(root, LEASE_NAME), rawRoot: root,
        environment: { PATH: '/usr/bin:/bin' },
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
 * Fixed Creator invocation and bounded inherited host context. No caller supplied environment.
 */
export function productionCreatorInvocation(): { executable: string; args: readonly string[];
    environment: NodeJS.ProcessEnv } {
    const account = userInfo();
    const home = process.env.HOME; const user = process.env.USER;
    const login = process.env.LOGNAME; const temporary = process.env.TMPDIR;
    const locale = process.env.LANG;
    if (!home || realpathSync(home) !== home || home !== account.homedir
        || !user || user !== account.username || !login || login !== account.username
        || !temporary || !realpathSync(temporary).startsWith('/private/var/folders/')
        || !locale || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(locale))
        throw new Error('component_sprite_pid_gate_production_environment_invalid');
    const tempPath = realpathSync(temporary); const tempStat = lstatSync(tempPath);
    if (!tempStat.isDirectory() || (tempStat.mode & 0o077) !== 0
        || (typeof process.getuid === 'function' && tempStat.uid !== process.getuid()))
        throw new Error('component_sprite_pid_gate_production_environment_invalid');
    const environment: NodeJS.ProcessEnv = { HOME: home, USER: user, LOGNAME: login,
        TMPDIR: tempPath, LANG: locale, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
    for (const key of ['LC_ALL', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING', 'DISPLAY'] as const) {
        const value = process.env[key];
        if (value === undefined) continue;
        if (!/^[A-Za-z0-9_.@:\/-]{1,128}$/u.test(value))
            throw new Error('component_sprite_pid_gate_production_environment_invalid');
        environment[key] = value;
    }
    return { executable: PRODUCTION.binary,
        args: ['--project', PRODUCTION.project, '--nologin'], environment };
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
    const invocation = productionCreatorInvocation();
    return prepareGate({ cwd: PRODUCTION.project, executable: invocation.executable,
        args: [...invocation.args], environment: invocation.environment, leasePath: PRODUCTION.lease,
        rawRoot: join(PRIVATE, 'sprite-creator-wrapper'),
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
