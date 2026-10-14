import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * @description 隔离工程内的有界原生观测入口；不提供任意消息或代码执行接口。
 */
class ComponentNativeMain {
    private static server: http.Server | null = null;
    private static token = '';
    private static project = '';
    private static registration: Record<string, unknown> = {};

    /**
     * @description 在 Creator 的实际扩展加载入口创建仅本机的窄接口。
     */
    public static load(): void {
        const editor = Reflect.get(globalThis, 'Editor');
        this.project = fs.realpathSync(editor.Project.path);
        this.registration = JSON.parse(fs.readFileSync(path.join(this.project, '..', 'project-ownership.json'), 'utf8'));
        if (this.registration.projectPath !== this.project || this.registration.task !== '5.1') throw new Error('component_native_project_unregistered');
        this.token = crypto.randomBytes(32).toString('hex');
        this.server = http.createServer((request, response) => {
            const chunks: Buffer[] = []; let bytes = 0;
            request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) request.destroy(); else chunks.push(chunk); });
            request.on('end', async () => {
                response.setHeader('content-type', 'application/json');
                try {
                    if (request.method !== 'POST' || request.url !== '/probe' || request.headers['x-component-token'] !== this.token)
                        throw new Error('component_native_request_denied');
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    const result = await this.call(body);
                    response.end(JSON.stringify({ ok: true, result }));
                } catch (error) {
                    response.statusCode = 400;
                    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
                }
            });
        });
        this.server.listen(0, '127.0.0.1', () => {
            const address = this.server?.address();
            if (!address || typeof address === 'string') throw new Error('component_native_endpoint_missing');
            const directory = path.join(this.project, '.peanut-ai'); fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, 'component-probe.json'), JSON.stringify({
                schemaVersion: 1, port: address.port, token: this.token, pid: process.pid,
                projectPath: this.project, runId: this.registration.runId, owner: this.registration.owner,
            }), { mode: 0o600 });
        });
    }

    /**
     * @description 扩展卸载时正常释放本入口。
     */
    public static unload(): void {
        this.server?.close(); this.server = null;
    }

    /**
     * @description 仅允许实际工程的健康信息、资源查询与已登记场景观测。
     */
    private static async call(body: { action: string; uuid?: string; scope?: string }): Promise<unknown> {
        const editor = Reflect.get(globalThis, 'Editor');
        if (typeof editor?.Message?.request !== 'function') throw new Error('component_native_message_api_missing');
        const request = editor.Message.request.bind(editor.Message);
        if (body.action === 'health') {
            const host = await request('peanut-pod-lite-host', 'query-status');
            return { projectPath: this.project, creatorVersion: editor.App.version, pid: process.pid,
                nodeVersion: process.versions.node, electronVersion: process.versions.electron,
                host, localProfiles: {
                    project: await editor.Profile.getConfig('project', undefined, 'local'),
                    engine: await editor.Profile.getConfig('engine', undefined, 'local'),
                } };
        }
        if (body.action === 'assets') {
            if (body.scope !== undefined && body.scope !== 'components') throw new Error('component_native_asset_scope_invalid');
            return request('asset-db', 'query-assets', { pattern: body.scope === 'components' ? 'db://assets/components/**' : 'db://assets/fixtures/**' });
        }
        if (body.action === 'load-asset') {
            if (typeof body.uuid !== 'string') throw new Error('component_native_uuid_missing');
            const info = await request('asset-db', 'query-asset-info', body.uuid);
            if (!info?.url?.startsWith('db://assets/fixtures/')) throw new Error('component_native_asset_out_of_scope');
            return { info, native: await request('scene', 'execute-scene-script', {
                name: 'peanut-component-probe', method: 'loadAsset', args: [body.uuid],
            }) };
        }
        if (body.action === 'scene-snapshot') return request('scene', 'execute-scene-script', {
            name: 'peanut-component-probe', method: 'snapshot', args: [],
        });
        throw new Error('component_native_action_not_allowed');
    }
}

export const load = (): void => ComponentNativeMain.load();
export const unload = (): void => ComponentNativeMain.unload();
