import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { ComponentExistingSpriteNativeProbeMain } from './component-existing-sprite-native-probe-main.ts';
import { ComponentExistingSpriteProbeDescriptorOwner } from './component-existing-sprite-probe-descriptor.ts';

type Identity = { projectPath: string; creatorVersion: '3.8.3' | '3.8.7'; owner: string;
    runId: string; pid: number };
type Descriptor = Identity & { port: number; token: string; generation: string };
type Context = Identity & { timeoutMs?: number; expiresAt?: number;
    allowedActions?: readonly ('assetIdentity' | 'sceneFields' | 'existingAssetIdentity')[];
    message: { request(target: string, method: string, ...args: unknown[]): Promise<unknown> };
    descriptor: { publish(value: Descriptor): void | Promise<void>;
        clear(generation: string): void | Promise<void> } };

const MAX_BODY = 16384;
const MAX_RESPONSE = 65536;
const MAX_ACTIVE = 2;
const MAX_REQUESTS_PER_SOCKET = 16;
const LOOPBACK = '127.0.0.1';

function equalToken(received: unknown, expected: string): boolean {
    const supplied = typeof received === 'string' && /^[a-f0-9]{64}$/iu.test(received) ? received : '0'.repeat(64);
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
        && typeof received === 'string' && supplied === received;
}
function errorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    return /^component_sprite_(?:probe|scene_probe)_[a-z0-9_]+$/u.test(message)
        ? message : 'component_sprite_probe_native_failure';
}

/**
 * Bounded transport. Real load requires a separately registered diagnostic stage.
 */
export class ComponentExistingSpriteNativeProbeEntry {
    private readonly context: Context;
    private readonly project: string;
    private server: Server | null = null;
    private generation = '';
    private token = '';
    private accepting = false;
    private active = 0;
    private publishedGeneration = '';
    private readonly pending = new Set<Promise<void>>();
    private readonly sockets = new Set<Socket>();
    private readonly requestsPerSocket = new WeakMap<Socket, number>();
    private closing: Promise<void> | null = null;

    public constructor(context: Context) {
        this.project = realpathSync(context.projectPath);
        if (this.project !== resolve(context.projectPath) || typeof context.descriptor?.publish !== 'function'
            || typeof context.descriptor?.clear !== 'function')
            throw new Error('component_sprite_probe_entry_context_invalid');
        this.context = context;
    }

    public async start(): Promise<{ address: string; port: number; generation: string }> {
        if (this.server || this.generation || this.publishedGeneration || this.closing)
            throw new Error('component_sprite_probe_entry_already_started');
        const token = randomBytes(32).toString('hex');
        const generation = randomBytes(16).toString('hex');
        const probe = new ComponentExistingSpriteNativeProbeMain({ ...this.context,
            projectPath: this.project, token, timeoutMs: this.context.timeoutMs ?? 5000 });
        const server = createServer((request, response) => {
            const socket = request.socket;
            const count = (this.requestsPerSocket.get(socket) ?? 0) + 1;
            this.requestsPerSocket.set(socket, count);
            if (count >= MAX_REQUESTS_PER_SOCKET) response.setHeader('connection', 'close');
            if (count > MAX_REQUESTS_PER_SOCKET) {
                response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                response.end('{"ok":false,"error":"component_sprite_probe_entry_socket_limit"}');
                return;
            }
            const task = this.handle(request, response, probe, generation, token);
            this.pending.add(task);
            void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
        });
        server.on('connection', (socket: Socket) => {
            this.sockets.add(socket);
            socket.once('close', () => { this.sockets.delete(socket); this.requestsPerSocket.delete(socket); });
        });
        server.requestTimeout = 6000;
        server.headersTimeout = 6000;
        server.timeout = 6000;
        this.server = server; this.generation = generation; this.token = token;
        try {
            await new Promise<void>((done, reject) => {
                server.once('error', reject);
                server.listen(0, LOOPBACK, () => { server.off('error', reject); done(); });
            });
            const address = server.address();
            if (!address || typeof address === 'string' || address.address !== LOOPBACK)
                throw new Error('component_sprite_probe_entry_address_invalid');
            await this.context.descriptor.publish({ projectPath: this.project,
                creatorVersion: this.context.creatorVersion, owner: this.context.owner,
                runId: this.context.runId, pid: this.context.pid, port: address.port, token, generation });
            this.publishedGeneration = generation; this.accepting = true;
            return { address: LOOPBACK, port: address.port, generation };
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    private async handle(request: IncomingMessage, response: ServerResponse,
        probe: ComponentExistingSpriteNativeProbeMain, generation: string, token: string): Promise<void> {
        const send = (status: number, value: unknown): void => {
            if (response.destroyed || response.writableEnded) return;
            const bytes = Buffer.from(JSON.stringify(value));
            if (bytes.length > MAX_RESPONSE) {
                response.writeHead(502, { 'content-type': 'application/json' });
                response.end('{"ok":false,"error":"component_sprite_probe_response_too_large"}'); return;
            }
            response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            response.end(bytes);
        };
        if (!this.accepting || generation !== this.generation) {
            send(503, { ok: false, error: 'component_sprite_probe_entry_closed' }); return;
        }
        if (this.active >= MAX_ACTIVE) {
            send(429, { ok: false, error: 'component_sprite_probe_entry_busy' }); return;
        }
        this.active += 1;
        try {
            if (this.context.expiresAt !== undefined && Date.now() >= this.context.expiresAt)
                throw new Error('component_sprite_probe_lease_expired');
            if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
                || request.method !== 'POST' || request.url !== '/probe'
                || request.headers['content-type'] !== 'application/json'
                || request.headers.origin !== undefined
                || !equalToken(request.headers['x-component-sprite-token'], token))
                throw new Error('component_sprite_probe_entry_request_denied');
            const chunks: Buffer[] = []; let count = 0;
            for await (const chunk of request) {
                if (!Buffer.isBuffer(chunk)) throw new Error('component_sprite_probe_entry_body_invalid');
                count += chunk.length;
                if (count > MAX_BODY) throw new Error('component_sprite_probe_entry_body_too_large');
                chunks.push(chunk);
            }
            let value: unknown;
            try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { throw new Error('component_sprite_probe_entry_body_invalid'); }
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('component_sprite_probe_entry_body_invalid');
            const input = value as Record<string, unknown>;
            if (input.token !== undefined) throw new Error('component_sprite_probe_entry_body_invalid');
            const result = await probe.dispatch({ ...input, token });
            if (!this.accepting || generation !== this.generation
                || (this.context.expiresAt !== undefined && Date.now() >= this.context.expiresAt)) {
                send(503, { ok: false, error: 'component_sprite_probe_entry_closed' }); return;
            }
            send(200, { ok: true, result });
        } catch (error) {
            send(400, { ok: false, error: errorCode(error) });
        } finally { this.active -= 1; }
    }

    public async close(): Promise<void> {
        if (this.closing) return this.closing;
        this.closing = this.closeOwned();
        try { await this.closing; }
        finally { this.closing = null; }
    }

    private async closeOwned(): Promise<void> {
        this.accepting = false;
        const server = this.server;
        this.generation = ''; this.token = '';
        if (server) {
            const closed = server.listening
                ? new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
                : Promise.resolve();
            for (const socket of this.sockets) socket.destroy();
            let closeError: unknown;
            try { await closed; } catch (error) { closeError = error; }
            await Promise.allSettled([...this.pending]);
            if (closeError) throw closeError;
            this.server = null;
        }
        if (this.publishedGeneration) {
            await this.context.descriptor.clear(this.publishedGeneration);
            this.publishedGeneration = '';
        }
    }
}

type EditorApi = { Project: { path: string }; App: { version: string };
    Message: { request(target: string, method: string, ...args: unknown[]): Promise<unknown> } };
type Lease = Identity & { schema: string; status: string; candidateSourceCommit: string;
    hostSha256: string; coreSha256: string; probeSourceCommit: string; probeBundleSha256: string;
    issuedAt: number; expiresAt: number; permissions: string[]; creatorExecutable: string;
    purpose?: string; creatorExecutableSha256?: string };
type Version = Identity['creatorVersion'];
type Mode = 'offline-synthetic' | 'diagnostic-383';
const PRIVATE = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-editor-operations-20261026/task-5.1';
const PRODUCT = { candidateSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
    hostSha256: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
    coreSha256: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f' };
const REAL = {
    '3.8.3': { project: '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3',
        lease: join(PRIVATE, 'sprite-runtime-lease-383.json'),
        binary: '/Applications/Cocos/Creator/3.8.3/CocosCreator.app/Contents/MacOS/CocosCreator',
        binarySha256: '799386a840d319b7eb78a788a4919950d8537f41aeca2cb6ce85a0ee2c4a0330' },
    '3.8.7': { project: '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.7',
        lease: join(PRIVATE, 'sprite-runtime-lease-387.json'),
        binary: '/Applications/Cocos/Creator/3.8.7/CocosCreator.app/Contents/MacOS/CocosCreator' },
} as const;
const SHA = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

function readOwnedJson(path: string): Record<string, unknown> {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
        || realpathSync(path) !== path) throw new Error('component_sprite_probe_lease_file_invalid');
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype)
        throw new Error('component_sprite_probe_lease_shape_invalid');
    return value as Record<string, unknown>;
}
function readLease(path: string, project: string, version: Version, binary: string,
    mode: Mode, binarySha256?: string): Lease {
    const value = readOwnedJson(path) as Lease;
    const now = Date.now();
    if (Object.keys(value).length !== (mode === 'diagnostic-383' ? 18 : 16)
        || value.schema !== 'peanut.pod.sprite-runtime-lease.v1'
        || value.status !== 'active' || value.projectPath !== project || value.creatorVersion !== version
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value.owner)
        || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(value.runId)
        || value.pid !== process.pid || value.creatorExecutable !== binary
        || value.candidateSourceCommit !== PRODUCT.candidateSourceCommit
        || value.hostSha256 !== PRODUCT.hostSha256 || value.coreSha256 !== PRODUCT.coreSha256
        || !COMMIT.test(value.probeSourceCommit) || !SHA.test(value.probeBundleSha256)
        || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)
        || value.issuedAt > now || value.expiresAt <= now
        || value.expiresAt - value.issuedAt > 600000
        || !Array.isArray(value.permissions)
        || (mode === 'diagnostic-383'
            ? (version !== '3.8.3' || value.purpose !== 'existing-asset-compatibility'
                || value.creatorExecutableSha256 !== binarySha256
                || !binarySha256 || createHash('sha256').update(readFileSync(binary)).digest('hex') !== binarySha256
                || value.permissions.length !== 1 || value.permissions[0] !== 'existingAssetIdentity')
            : (value.permissions.length !== 2 || value.permissions[0] !== 'assetIdentity'
                || value.permissions[1] !== 'sceneFields')))
        throw new Error('component_sprite_probe_lease_identity_invalid');
    return value;
}
function checkBundle(project: string, lease: Lease, mode: Mode): void {
    const extension = join(project, 'extensions/peanut-component-sprite-probe');
    const manifestPath = join(extension, 'package.json');
    const bundlePath = join(extension, 'main.js');
    const scenePath = join(extension, 'scene.js');
    for (const path of [manifestPath, bundlePath, scenePath]) {
        const stat = lstatSync(path, { throwIfNoEntry: false });
        if (!stat?.isFile() || stat.nlink !== 1 || realpathSync(path) !== path)
            throw new Error('component_sprite_probe_bundle_file_invalid');
    }
    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const main = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    const scene = createHash('sha256').update(readFileSync(scenePath)).digest('hex');
    const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
    const packageDigest = createHash('sha256').update(JSON.stringify({ main, scene, manifest: manifestSha })).digest('hex');
    if (manifest?.name !== 'peanut-component-sprite-probe'
        || manifest.probeSourceCommit !== lease.probeSourceCommit
        || manifest.bundleDigests?.['main.js'] !== main
        || manifest.bundleDigests?.['scene.js'] !== scene
        || lease.probeBundleSha256 !== packageDigest
        || (mode === 'diagnostic-383'
            ? (manifest.private !== true || manifest.peanutOfflineOnly !== false
                || manifest.peanutDiagnosticOnly !== true || manifest.nativeCompatible !== null
                || manifest.diagnosticTargetVersion !== '3.8.3'
                || manifest.diagnosticAction !== 'existingAssetIdentity')
            : manifest.peanutOfflineOnly !== true))
        throw new Error('component_sprite_probe_bundle_identity_invalid');
}

function lifecycle(config: { path: string; lease: string; binary: string; version: Version; synthetic: boolean;
    mode: Mode; binarySha256?: string;
    editor(): unknown }): { load(): Promise<void>; unload(): Promise<void> } {
    let active: ComponentExistingSpriteNativeProbeEntry | null = null;
    return {
        async load(): Promise<void> {
            if (active) throw new Error('component_sprite_probe_creator_already_loaded');
            const editor = config.editor() as EditorApi;
            if (!editor || typeof editor.Project?.path !== 'string'
                || typeof editor.App?.version !== 'string'
                || typeof editor.Message?.request !== 'function')
                throw new Error('component_sprite_probe_creator_api_unavailable');
            const project = realpathSync(editor.Project.path);
            if (project !== editor.Project.path || project !== config.path
                || editor.App.version !== config.version
                || (!config.synthetic && realpathSync(process.execPath) !== config.binary))
                throw new Error('component_sprite_probe_creator_identity_invalid');
            const version = editor.App.version as Version;
            const lease = readLease(config.lease, project, version, config.binary,
                config.mode, config.binarySha256);
            checkBundle(project, lease, config.mode);
            const descriptor = new ComponentExistingSpriteProbeDescriptorOwner(project);
            const entry = new ComponentExistingSpriteNativeProbeEntry({
                projectPath: project, creatorVersion: version, owner: lease.owner,
                runId: lease.runId, pid: process.pid, expiresAt: lease.expiresAt,
                allowedActions: config.mode === 'diagnostic-383' ? ['existingAssetIdentity'] : undefined,
                message: { request: (target, method, ...args) => editor.Message.request(target, method, ...args) },
                descriptor: {
                    publish: value => descriptor.publish({ schemaVersion: 1, ...value,
                        candidateSourceCommit: lease.candidateSourceCommit,
                        hostSha256: lease.hostSha256, coreSha256: lease.coreSha256,
                        probeSourceCommit: lease.probeSourceCommit,
                        probeBundleSha256: lease.probeBundleSha256 }),
                    clear: generation => descriptor.clear(generation),
                },
            });
            active = entry;
            try { await entry.start(); }
            catch (error) {
                try { await entry.close(); active = null; }
                catch (cleanup) { throw new AggregateError([error, cleanup], 'component_sprite_probe_creator_cleanup_failed'); }
                throw error;
            }
        },
        async unload(): Promise<void> {
            if (!active) return;
            await active.close();
            active = null;
        },
    };
}

let productionLifecycle: ReturnType<typeof lifecycle> | null = null;

export function createSyntheticCreatorEntry(project: string, editor: EditorApi,
    mode: Mode = 'offline-synthetic') {
    const root = dirname(project);
    if (project !== resolve(project) || basename(project) !== 'synthetic-project'
        || !basename(root).startsWith('component-sprite-activation-')
        || !root.startsWith(`${realpathSync(tmpdir())}${sep}`) || realpathSync(root) !== root)
        throw new Error('component_sprite_probe_synthetic_project_invalid');
    if (editor.App.version !== '3.8.3' && editor.App.version !== '3.8.7')
        throw new Error('component_sprite_probe_synthetic_version_invalid');
    if (mode !== 'offline-synthetic' && mode !== 'diagnostic-383')
        throw new Error('component_sprite_probe_synthetic_mode_invalid');
    return lifecycle({ path: project, lease: join(root, 'lease.json'), version: editor.App.version,
        binary: process.execPath, synthetic: true, mode,
        binarySha256: mode === 'diagnostic-383'
            ? createHash('sha256').update(readFileSync(process.execPath)).digest('hex') : undefined,
        editor: () => editor });
}

export async function load(): Promise<void> {
    if (productionLifecycle) throw new Error('component_sprite_probe_creator_already_loaded');
    const editor = Reflect.get(globalThis, 'Editor') as EditorApi | undefined;
    const version = editor?.App?.version;
    if (version !== '3.8.3' && version !== '3.8.7')
        throw new Error('component_sprite_probe_creator_version_unregistered');
    const current = lifecycle({ path: REAL[version].project, lease: REAL[version].lease,
        binary: REAL[version].binary, version, synthetic: false,
        mode: 'diagnostic-383', binarySha256: version === '3.8.3' ? REAL['3.8.3'].binarySha256 : undefined,
        editor: () => Reflect.get(globalThis, 'Editor') });
    productionLifecycle = current;
    try { await current.load(); }
    catch (error) {
        try { await current.unload(); productionLifecycle = null; }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'component_sprite_probe_creator_cleanup_failed'); }
        throw error;
    }
}
export async function unload(): Promise<void> {
    if (!productionLifecycle) return;
    await productionLifecycle.unload();
    productionLifecycle = null;
}
