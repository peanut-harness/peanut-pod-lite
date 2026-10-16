import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ComponentOwnedCreatorQuit } from './component-owned-creator-quit';
import { EditorMcpPreviewWindowInspector } from '../../../../packages/engine/modules/mcp/src/editor-mcp-preview-window-inspector';
import { ComponentNativeAssetLoader } from './component-native-asset-loader';
import { ComponentProjectUrlFiles } from './component-project-url-files';
import { ComponentSdkDiagnostics } from './component-sdk-diagnostics';
import { ComponentSdkWindowDiagnostics } from './component-sdk-window-diagnostics';
import { ComponentSdkSceneCacheSources } from './component-sdk-scene-cache-sources';

/**
 * @description 隔离工程内的有界原生观测及所属进程退出入口；不提供任意消息或代码执行接口。
 */
class ComponentNativeMain {
    private static server: http.Server | null = null;
    private static token = '';
    private static project = '';
    private static registration: Record<string, unknown> = {};
    /**
     * @description 与认证probe共享回环socket的两份固定静态夹具。
     */
    private static quitRequested = false;

    private static fixtures: ComponentProjectUrlFiles | null = null;

    /**
     * @description 在 Creator 的实际扩展加载入口创建仅本机的窄接口。
     */
    public static load(): void {
        Reflect.set(process, 'traceProcessWarnings', true);
        const editor = Reflect.get(globalThis, 'Editor');
        this.project = fs.realpathSync(editor.Project.path);
        this.registration = JSON.parse(fs.readFileSync(path.join(this.project, '..', 'project-ownership.json'), 'utf8'));
        if (this.registration.projectPath !== this.project || this.registration.task !== '5.1') throw new Error('component_native_project_unregistered');
        fs.appendFileSync(path.join(this.project, '..', 'sdk-metrics-at-probe-load.ndjson'),
            JSON.stringify({ ...ComponentSdkDiagnostics.metrics(editor.Metrics) as object,
                adapters: ComponentSdkDiagnostics.adapters(createRequire(path.join(this.project, 'package.json')).cache) }) + '\n');
        this.fixtures = new ComponentProjectUrlFiles(this.project, this.registration);
        this.token = crypto.randomBytes(32).toString('hex');
        this.server = http.createServer((request, response) => {
            if (this.fixtures?.serve(request, response)) return;
            const chunks: Buffer[] = []; let bytes = 0;
            request.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) request.destroy(); else chunks.push(chunk); });
            request.on('end', async () => {
                response.setHeader('content-type', 'application/json');
                try {
                    if (request.method !== 'POST' || !['/probe', '/owned-quit'].includes(request.url ?? '') || request.headers['x-component-token'] !== this.token)
                        throw new Error('component_native_request_denied');
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (request.url === '/owned-quit') {
                        if (this.quitRequested) throw new Error('component_owned_quit_already_requested');
                        const lease = JSON.parse(fs.readFileSync(path.join(this.project, '..', 'creator-owned-start.json'), 'utf8'));
                        const editor = Reflect.get(globalThis, 'Editor');
                        const prepared = ComponentOwnedCreatorQuit.prepare(editor, this.registration, lease, body);
                        this.quitRequested = true;
                        response.once('finish', () => setImmediate(prepared.run));
                        response.end(JSON.stringify({ ok: true, result: prepared.receipt })); return;
                    }
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
        this.server?.close(); this.server = null; this.fixtures = null;
    }

    /**
     * @description 仅允许实际工程的健康信息、资源查询与已登记场景观测。
     */
    private static async call(body: { action: string; uuid?: string; scope?: string; nodeSuffix?: string; componentType?: string; expectedSceneUuid?: string; inspectWindows?: boolean }): Promise<unknown> {
        const editor = Reflect.get(globalThis, 'Editor');
        if (typeof editor?.Message?.request !== 'function') throw new Error('component_native_message_api_missing');
        const request = editor.Message.request.bind(editor.Message);
        if (body.action === 'sdk-cube-importer-contract') {
            if (this.registration.sdkSceneCacheCompat !== true || editor.App.version !== '3.8.3')
                throw new Error('component_cube_importer_sources_not_registered');
            return { creatorVersion: editor.App.version, importers: await request('asset-db', 'query-all-importer'),
                createList: await request('asset-db', 'query-create-list') };
        }
        if (body.action === 'sdk-window-ready-sources') {
            if (this.registration.sdkSceneCacheCompat !== true || editor.App.version !== '3.8.3' || !process.versions.electron)
                throw new Error('component_sdk_window_ready_sources_not_registered');
            return ComponentSdkWindowDiagnostics.read(createRequire(path.join(this.project, 'package.json'))('electron'),
                String(this.registration.creatorApp), editor.App.version);
        }
        if (body.action === 'sdk-scene-cache-compat-status') {
            if (this.registration.sdkSceneCacheCompat !== true || editor.App.version !== '3.8.3') throw new Error('component_sdk_cache_compat_not_registered');
            const marker: unknown = Reflect.get(globalThis, Symbol.for('peanut.component.sdk-scene-cache-compat'));
            const status: unknown = marker && typeof marker === 'object' ? Reflect.get(marker, 'status') : null;
            if (typeof status !== 'function') throw new Error('component_matrix_probe_not_ready');
            return Reflect.apply(status, marker, []);
        }
        if (body.action === 'sdk-scene-cache-diagnostics') {
            if (editor.App.version !== '3.8.3') throw new Error('component_sdk_cache_source_version_unverified');
            return ComponentSdkSceneCacheSources.read(createRequire(path.join(this.project, 'package.json')).cache);
        }
        if (body.action === 'sdk-metrics-diagnostics') {
            const runtime = createRequire(path.join(this.project, 'package.json'));
            return { ...ComponentSdkDiagnostics.metrics(editor.Metrics) as object,
                adapters: ComponentSdkDiagnostics.adapters(runtime.cache),
                timerRoutes: ComponentSdkDiagnostics.timerRoutes(runtime.cache, process.versions.electron ? runtime('electron').ipcMain : null) };
        }
        if (body.action === 'sdk-window-timer-diagnostics') {
            if (this.registration.sdkTimerTrace !== true || !process.versions.electron) throw new Error('component_sdk_window_diagnostics_not_registered');
            const runtime = createRequire(path.join(this.project, 'package.json'));
            return ComponentSdkWindowDiagnostics.read(runtime('electron'), String(this.registration.creatorApp), editor.App.version);
        }
        if (body.action === 'sdk-ui-ready-compat-status') {
            if (this.registration.sdkUiReadyCompat !== true || !process.versions.electron) throw new Error('component_sdk_ui_ready_not_registered');
            const runtime = createRequire(path.join(this.project, 'package.json'));
            const contents = ComponentSdkWindowDiagnostics.mainContents(runtime('electron'), String(this.registration.creatorApp), editor.App.version);
            if (!contents) throw new Error('component_matrix_probe_not_ready');
            const script = fs.realpathSync(path.join(this.project, 'extensions/peanut-component-sdk-compat/ui-ready.js'));
            return contents.executeJavaScript('require(' + JSON.stringify(script) + ').status()', false);
        }
        if (body.action === 'sdk-lifecycle-diagnostics') return request('scene', 'execute-scene-script', {
            name: 'peanut-component-probe', method: 'sdkLifecycleDiagnostics', args: [],
        });
        if (body.action === 'sdk-listener-compat-status') {
            if (this.registration.sdkListenerCompat !== true) throw new Error('component_sdk_listener_not_registered');
            return request('scene', 'execute-scene-script', { name: 'peanut-component-sdk-compat', method: 'status', args: [] });
        }
        if (body.action === 'fixture-urls') {
            const address = this.server?.address();
            if (!address || typeof address === 'string' || !this.fixtures) throw new Error('component_native_endpoint_missing');
            return { projectPath: this.project, owner: this.registration.owner, runId: this.registration.runId,
                candidateSourceCommit: this.registration.candidateSourceCommit, files: this.fixtures.urls(address.port) };
        }
        if (body.action === 'health') {
            const host = await request('peanut-pod-lite-host', 'query-status');
            return { projectPath: this.project, creatorVersion: editor.App.version, pid: process.pid,
                nodeVersion: process.versions.node, electronVersion: process.versions.electron,
                sceneReady: await request('scene', 'query-is-ready'),
                warningStacksEnabled: Reflect.get(process, 'traceProcessWarnings') === true,
                effectiveEngineProfile: await editor.Profile.getConfig('engine'),
                ownedQuitSdkSource: this.registration.sdkOwnedQuit === true ? ComponentOwnedCreatorQuit.inspect(editor) : null,
                engineModulesProfile: await editor.Profile.getProject('engine', 'modules'),
                engineMacroProfile: await editor.Profile.getProject('engine', 'macroConfig'),
                serviceConfigProfile: {
                    game: await editor.Profile.getProject('cocos-service', 'game'),
                    configs: await editor.Profile.getProject('cocos-service', 'configs'),
                    appConfigMaps: await editor.Profile.getProject('cocos-service', 'appConfigMaps'),
                    cscv: await editor.Profile.getProject('cocos-service', 'cscv'),
                },
                sceneStartupProfile: editor.App.version === '3.8.3' ? { currentScene: await editor.Profile.getProject('scene', 'current-scene') } : null,
                host, localProfiles: {
                    project: await editor.Profile.getConfig('project', undefined, 'local'),
                    engine: await editor.Profile.getConfig('engine', undefined, 'local'),
                } };
        }
        if (body.action === 'scene-readiness') return request('scene', 'query-is-ready');
        if (body.action === 'assets') {
            if (body.scope !== undefined && body.scope !== 'components') throw new Error('component_native_asset_scope_invalid');
            return request('asset-db', 'query-assets', { pattern: body.scope === 'components' ? 'db://assets/components/**' : 'db://assets/fixtures/**' });
        }
        if (body.action === 'preview-state') {
            const inspector = new EditorMcpPreviewWindowInspector({
                request: async (target, message, ...args) => request(target, message, ...args),
            });
            return { connectedPreviewCount: await request('preview', 'query-connect-num'),
                previewUrl: await request('preview', 'query-preview-url'),
                platform: await editor.Profile.getConfig('preview', 'preview.current.platform'),
                browserConfig: await editor.Profile.getConfig('program', 'browserV2'),
                matchingBrowserTabs: body.inspectWindows === true ? await inspector.countMatchingTabs() : null };
        }
        if (body.action === 'load-asset') {
            if (typeof body.uuid !== 'string') throw new Error('component_native_uuid_missing');
            const info = await request('asset-db', 'query-asset-info', body.uuid);
            if (!info?.url?.startsWith('db://assets/fixtures/')) throw new Error('component_native_asset_out_of_scope');
            const dependencies = await ComponentNativeAssetLoader.dependencies(info,
                (message, uuid) => request('asset-db', message, uuid));
            return { info, native: await request('scene', 'execute-scene-script', {
                name: 'peanut-component-probe', method: 'loadAsset', args: [body.uuid, dependencies],
            }) };
        }
        if (body.action === 'scene-snapshot') return request('scene', 'execute-scene-script', {
            name: 'peanut-component-probe', method: 'snapshot', args: [],
        });
        if (body.action === 'component-fields') {
            if (typeof body.nodeSuffix !== 'string' || body.nodeSuffix.length > 256 || typeof body.componentType !== 'string'
                || !/^[a-zA-Z0-9_.]{1,100}$/u.test(body.componentType) || typeof body.expectedSceneUuid !== 'string'
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(body.expectedSceneUuid)) throw new Error('component_native_field_input_invalid');
            return request('scene', 'execute-scene-script', { name: 'peanut-component-probe', method: 'fields',
                args: [body.nodeSuffix, body.componentType, body.expectedSceneUuid] });
        }
        throw new Error('component_native_action_not_allowed');
    }
}

export const load = (): void => ComponentNativeMain.load();
export const unload = (): void => ComponentNativeMain.unload();
