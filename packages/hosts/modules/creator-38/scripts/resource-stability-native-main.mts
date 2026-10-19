import { ResourceStabilityNativeAudioMeta } from './resource-stability-native-audio-meta.mts';
import { ResourceStabilityNativeSourceText } from './resource-stability-native-source-text.mts';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ResourceStabilityNativeSnapshot } from './resource-stability-native-snapshot.mts';
import { ResourceStabilityNativeInspector } from './resource-stability-native-inspector.mts';
import { ResourceOwnedCreatorQuit } from './resource-stability-owned-quit.mts';

interface EditorReadPort {
    App: { version: string; quit: () => unknown };
    Project: { path: string };
    Message: { request(channel: string, method: string, ...args: unknown[]): Promise<unknown> };
}
interface NativeIdentity { actualUuid: string; type: string; valid: boolean; dependencies: readonly string[]; semantic: Readonly<Record<string, unknown>> }

/**
 * @description 所属工程固定只读 HTTP 入口；写业务只能经独立公共 MCP 审批/原 writer。
 */
class ResourceStabilityNativeMain {
    private static server: Server | null = null;
    private static quitting = false;

    /**
     * @description 启动时核对登记和精确 SDK，端口与私有令牌独立于另一个 Creator 实例。
     */
    public static load(): void {
        const editor = Reflect.get(globalThis, 'Editor') as EditorReadPort;
        const project = realpathSync(editor.Project.path); const output = dirname(project);
        const registration = JSON.parse(readFileSync(join(output, 'project-ownership.json'), 'utf8')) as Record<string, unknown>;
        if (registration.task !== '4.3' || registration.creatorVersion !== '3.8.3' || registration.projectPath !== project
            || typeof registration.runId !== 'string' || typeof registration.owner !== 'string'
            || typeof registration.creatorApp !== 'string' || registration.namespace !== `assets/fixtures/resource-stability/${registration.runId}`) {
            throw new Error('resource_native_project_unregistered');
        }
        ResourceStabilityNativeInspector.assertSdk(join(registration.creatorApp, 'Contents/Resources/resources/3d/engine'));
        const identity = async (uuid: string): Promise<NativeIdentity> => {
            const value = await editor.Message.request('scene', 'execute-scene-script', {
                name: 'peanut-resource-probe', method: 'loadIdentity', args: [uuid],
            }) as NativeIdentity;
            if (!value || value.actualUuid !== uuid || value.valid !== true || !Array.isArray(value.dependencies)
                || value.dependencies.some((id) => typeof id !== 'string')) throw new Error('resource_native_loaded_identity_invalid');
            return value;
        };
        const inspector = new ResourceStabilityNativeInspector({ loadIdentity: identity,
            physicsMaterial: (uuid) => editor.Message.request('scene', 'query-physics-material', uuid),
            animationGraphVariant: (uuid) => editor.Message.request('scene', 'query-animation-graph-variant', uuid),
            renderPipeline: (uuid) => editor.Message.request('scene', 'query-render-pipeline', uuid),
            animationMask: (uuid) => editor.Message.request('scene', 'query-animation-mask', uuid) });
        const sourceBindings = ResourceStabilityNativeSourceText.bindings(JSON.parse(readFileSync(join(output, 'resource-native-staging.json'), 'utf8')));
        if (sourceBindings.size) ResourceStabilityNativeSourceText.assertSdk(join(registration.creatorApp, 'Contents/Resources/resources/3d/engine'), join(registration.creatorApp, 'Contents/Resources'));
        const sourceText = new ResourceStabilityNativeSourceText(project, String(registration.namespace), sourceBindings, {
            info: uuid => editor.Message.request('asset-db', 'query-asset-info', uuid, ['depends']),
            meta: uuid => editor.Message.request('asset-db', 'query-asset-meta', uuid),
            path: uuid => editor.Message.request('asset-db', 'query-path', uuid),
        });
        const audioBindings = ResourceStabilityNativeAudioMeta.bindings(JSON.parse(readFileSync(join(output, 'resource-native-staging.json'), 'utf8')));
        if (audioBindings.size) ResourceStabilityNativeAudioMeta.assertSdk(join(registration.creatorApp, 'Contents/Resources/resources/3d/engine'), join(registration.creatorApp, 'Contents/Resources'));
        const audioMeta = new ResourceStabilityNativeAudioMeta(project, String(registration.namespace), audioBindings, {
            info: uuid => editor.Message.request('asset-db', 'query-asset-info', uuid, ['depends']),
            meta: uuid => editor.Message.request('asset-db', 'query-asset-meta', uuid),
            path: uuid => editor.Message.request('asset-db', 'query-path', uuid),
        });
        const reader = new ResourceStabilityNativeSnapshot(project, String(registration.namespace), {
            audioMeta: (path, info, meta) => audioMeta.read(path, info, meta),
            sourceText: (path, info, meta) => sourceText.read(path, info, meta),
            assetInfo: (value) => editor.Message.request('asset-db', 'query-asset-info', value),
            dependencies: async (uuid) => (await identity(uuid)).dependencies,
            inspector: (uuid) => inspector.read(uuid),
        });
        const token = randomBytes(32).toString('hex');
        this.server = createServer((request, response) => {
            const chunks: Buffer[] = []; let length = 0;
            request.on('data', (chunk: Buffer) => { length += chunk.length;
                if (length > 4096) request.destroy(); else chunks.push(chunk); });
            request.on('end', async () => {
                response.setHeader('content-type', 'application/json');
                try {
                    if (request.method !== 'POST' || !['/snapshot', '/identity', '/owned-quit'].includes(request.url ?? '') || request.headers['x-resource-token'] !== token) {
                        throw new Error('resource_native_request_denied');
                    }
                    const lease = JSON.parse(readFileSync(join(output, 'creator-owned-start.json'), 'utf8')) as Record<string, unknown>;
                    if (lease.pid !== process.pid || lease.owner !== registration.owner || lease.runId !== registration.runId
                        || lease.project !== project) throw new Error('resource_native_process_identity_mismatch');
                    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (request.url === '/owned-quit') {
                        if (this.quitting) throw new Error('resource_owned_quit_already_requested');
                        const prepared = ResourceOwnedCreatorQuit.prepare(editor, registration, lease, body);
                        this.quitting = true; response.once('finish', () => setImmediate(prepared.run));
                        response.end(JSON.stringify({ ok: true, result: prepared.receipt })); return;
                    }
                    if (request.url === '/identity') {
                        if (!body || typeof body !== 'object' || Object.keys(body).length) throw new Error('resource_native_request_invalid');
                        response.end(JSON.stringify({ ok: true, result: { pid: process.pid, creatorVersion: editor.App.version,
                            host: await editor.Message.request('peanut-pod-lite-host', 'query-status') } })); return;
                    }
                    if (!body || typeof body !== 'object' || Object.keys(body).length !== 1
                        || typeof Reflect.get(body, 'path') !== 'string') throw new Error('resource_native_request_invalid');
                    response.end(JSON.stringify({ ok: true, result: await reader.read(String(Reflect.get(body, 'path'))) }));
                } catch (error) {
                    response.statusCode = 400;
                    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
                }
            });
        });
        this.server.listen(0, '127.0.0.1', () => {
            const address = this.server?.address();
            if (!address || typeof address === 'string') throw new Error('resource_native_socket_missing');
            mkdirSync(join(project, '.peanut-ai'), { recursive: true });
            writeFileSync(join(project, '.peanut-ai/resource-probe.json'), JSON.stringify({ schemaVersion: 1,
                port: address.port, token, pid: process.pid, projectPath: project, owner: registration.owner,
                runId: registration.runId, creatorVersion: registration.creatorVersion }), { mode: 0o600, flag: 'wx' });
        });
    }
    /**
     * @description 仅关闭自己创建的只读 socket，不操作其他应用或引擎进程。
     */
    public static unload(): void { this.server?.close(); this.server = null; }
}

export const load = (): void => ResourceStabilityNativeMain.load();
export const unload = (): void => ResourceStabilityNativeMain.unload();
