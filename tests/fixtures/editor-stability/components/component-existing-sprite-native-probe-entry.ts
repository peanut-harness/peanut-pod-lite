import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComponentExistingSpriteNativeProbeMain } from './component-existing-sprite-native-probe-main.ts';

type Identity = { projectPath: string; creatorVersion: '3.8.3' | '3.8.7'; owner: string;
    runId: string; pid: number };
type Descriptor = Identity & { port: number; token: string; generation: string };
type Context = Identity & { timeoutMs?: number;
    message: { request(target: string, method: string, ...args: unknown[]): Promise<unknown> };
    descriptor: { publish(value: Descriptor): void | Promise<void>;
        clear(generation: string): void | Promise<void> } };

const MAX_BODY = 16384;
const MAX_RESPONSE = 65536;
const MAX_ACTIVE = 2;
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
 * Offline transport candidate. Creator load remains disabled until real project registration.
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
            const task = this.handle(request, response, probe, generation, token);
            this.pending.add(task);
            void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
        });
        server.requestTimeout = 6000;
        server.headersTimeout = 6000;
        server.timeout = 6000;
        server.maxRequestsPerSocket = 16;
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
            if (!this.accepting || generation !== this.generation) {
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
        this.server = null;
        this.generation = ''; this.token = '';
        if (server) {
            server.closeAllConnections();
            await new Promise<void>(done => server.close(() => done()));
        }
        await Promise.allSettled([...this.pending]);
        if (this.publishedGeneration) {
            await this.context.descriptor.clear(this.publishedGeneration);
            this.publishedGeneration = '';
        }
    }
}

export function load(): never { throw new Error('component_sprite_probe_entry_offline_only'); }
export async function unload(): Promise<void> { /* no actual Creator entry has been admitted */ }
