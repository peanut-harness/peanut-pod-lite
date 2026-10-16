import { appendFileSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { McpScopedResourceBoundary } from '../../../../packages/engine/modules/kernel/src/mcp/mcp-scoped-resource-boundary.ts';
import { ComponentEngineProfile } from './component-engine-profile.mts';
import { ComponentEngineModules } from './component-engine-modules.mts';
import { ComponentServiceProfile } from './component-service-profile.mts';
import { ComponentNativeLogGuard } from './component-native-log-guard.mts';
import { ComponentProjectUrlResolver } from './component-project-url-resolver.mts';
import { ComponentTaskOwnership } from './component-task-ownership.mts';

/**
 * @description 矩阵验证的实际认证传输；只允许精确六项写及只读观测，令牌不进入证据。
 */
export class ComponentNativeClient {
    /**
     * @description 固定产品工作树根，拒绝其它工程。
     */
    public readonly root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
    /**
     * @description 已登记的实际隔离工程。
     */
    public readonly project: string;
    /**
     * @description 保留该工程所有原始证据的目录。
     */
    public readonly output: string;
    /**
     * @description 本任务owner及候选身份登记。
     */
    public readonly registration: Record<string, unknown>;
    /**
     * @description 原始启动进程身份，每次请求重新核对。
     */
    private readonly lease: Record<string, unknown>;
    /**
     * @description 矩阵专属MCP连接身份。
     */
    private readonly connectionId = randomUUID().replaceAll('-', '');
    /**
     * @description 不含审批令牌的步骤证据。
     */
    public readonly events: Record<string, unknown>[] = [];
    /**
     * @description 已落盘的事件游标，避免每次重写整个原始报告。
     */
    private savedEvents = 0;

    /**
     * @description 将传输绑定到任务5.1的新工程和原始实际Creator启动身份。
     * @param project 已登记工程。
     * @param ownership 当前归属读取器；离线测试可注入隔离登记边界。
     */
    public constructor(project: string, ownership: Pick<typeof ComponentTaskOwnership, 'current'> = ComponentTaskOwnership) {
        this.project = realpathSync(project); this.output = dirname(this.project);
        if (!this.project.startsWith(`${this.root}${sep}evidence${sep}task-5.1${sep}`) || this.project !== join(this.output, 'project'))
            throw new Error('component_matrix_project_out_of_scope');
        this.registration = JSON.parse(readFileSync(join(this.output, 'project-ownership.json'), 'utf8'));
        this.lease = JSON.parse(readFileSync(join(this.output, 'creator-owned-start.json'), 'utf8'));
        if (this.registration.task !== '5.1' || this.registration.owner !== ownership.current(this.root)
            || this.registration.projectPath !== this.project || this.lease.owner !== this.registration.owner
            || this.lease.runId !== this.registration.runId || this.lease.project !== this.project) throw new Error('component_matrix_owner_invalid');
    }

    /**
     * @description 有界等待宿主注册；验证实际版本、PID和官方Host/Core摘要。
     * @returns 实际健康快照。
     */
    public async health(): Promise<Record<string, unknown>> {
        const until = Date.now() + 120000;
        do {
            try {
                const health = this.record(await this.probe('health')); const host = this.record(health.host);
                if (host.ready === true && health.sceneReady === true) {
                    if (this.registration.sdkListenerCompat === true) {
                        const compatibility = this.record(await this.probe('sdk-listener-compat-status'));
                        if (compatibility.installed !== true || compatibility.creatorVersion !== this.registration.creatorVersion
                            || compatibility.maximum !== 10) throw new Error('component_sdk_listener_compat_unverified');
                        this.events.push({ step: 'sdk-listener-compat-observed', result: compatibility }); this.save();
                        if (this.registration.sdkRendererTimerTrace === true && this.record(compatibility.rendererTimerTrace).installed !== true)
                            throw new Error('component_matrix_probe_not_ready');
                    }
                    if (this.registration.sdkRendererTimerTrace === true) {
                        const path = join(this.output, 'sdk-window-renderer-trace-state.json');
                        const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
                        if (state?.failed === true) throw new Error('component_sdk_renderer_trace_install_failed:' + state.error);
                        if (state?.installed !== true) throw new Error('component_matrix_probe_not_ready');
                        if (state.scope !== this.project || state.creatorVersion !== this.registration.creatorVersion)
                            throw new Error('component_sdk_renderer_trace_identity_mismatch');
                    }
                    if (this.registration.sdkStartupTimerCompat === true) {
                        const compatibility = JSON.parse(readFileSync(join(this.output, 'sdk-startup-timer-compat-state.json'), 'utf8'));
                        if (compatibility.installed !== true || compatibility.creatorVersion !== this.registration.creatorVersion
                            || !Number.isSafeInteger(compatibility.workerPid) || !Array.isArray(compatibility.starts)
                            || !['internal', 'assets'].every(name => compatibility.starts.some((item: any) => item.database === name)))
                            throw new Error('component_sdk_startup_timer_compat_unverified');
                        this.events.push({ step: 'sdk-startup-timer-compat-observed', result: compatibility }); this.save();
                    }
                    if (this.registration.sdkUiReadyCompat === true) {
                        const path = join(this.output, 'sdk-ui-ready-compat-state.json');
                        const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
                        if (state?.failed === true) throw new Error('component_sdk_ui_ready_install_failed:' + state.error);
                        if (state?.installed !== true) throw new Error('component_matrix_probe_not_ready');
                        const compatibility = this.record(await this.probe('sdk-ui-ready-compat-status'));
                        if (compatibility.installed !== true || compatibility.startupMarkerConsumed !== true
                            || compatibility.scope !== this.project || compatibility.creatorVersion !== this.registration.creatorVersion)
                            throw new Error('component_sdk_ui_ready_identity_mismatch');
                        this.events.push({ step: 'sdk-ui-ready-compat-observed', result: compatibility }); this.save();
                    }
                    ComponentEngineProfile.assertBuiltin(health.effectiveEngineProfile, String(this.registration.creatorVersion));
                    if (this.registration.sdkSceneCacheCompat === true) {
                        const compatibility = this.record(await this.probe('sdk-scene-cache-compat-status'));
                        if (compatibility.installed !== true || compatibility.managerHookVerified !== true || compatibility.creatorVersion !== '3.8.3'
                            || compatibility.projectPath !== this.project || compatibility.pid !== this.lease.pid) throw new Error('component_sdk_cache_compat_identity_mismatch');
                        this.events.push({ step: 'sdk-scene-cache-compat-observed', result: compatibility }); this.save();
                    }
                    if (this.registration.startupSceneProfile === true) {
                        const startup = this.record(JSON.parse(readFileSync(join(this.output, 'startup-scene-staging.json'), 'utf8')));
                        if (startup.creatorVersion !== '3.8.3' || typeof startup.uuid !== 'string'
                            || this.record(health.sceneStartupProfile).currentScene !== startup.uuid) throw new Error('component_native_startup_scene_profile_mismatch');
                    }
                    if (existsSync(join(this.output, 'component-matrix-staging.json'))) {
                        this.events.push({ step: 'health-engine-modules-observed', creatorVersion: health.creatorVersion,
                            engineModulesProfile: health.engineModulesProfile ?? null }); this.save();
                        const context = ComponentEngineModules.context(this.registration.engineModulesContext);
                        ComponentEngineModules.assertProject(this.project, String(this.registration.creatorVersion), context);
                        ComponentEngineModules.assertActive(health.engineModulesProfile, String(this.registration.creatorVersion), context);
                        ComponentEngineModules.assertActiveMacros(health.engineMacroProfile, String(this.registration.creatorVersion), context);
                    }
                    if (this.registration.offlineServiceProfile === true) ComponentServiceProfile.assertActive(health.serviceConfigProfile, String(this.registration.creatorVersion));
                    const { CpmPackageStore } = createRequire(import.meta.url)('../../../../packages/hosts/modules/creator-38/src/cpm-package-store.js');
                    const descriptor = JSON.parse(readFileSync(join(this.root, 'release/peanut.pod-lite-0.2.0/lite-release-descriptor.json'), 'utf8'));
                    if (health.creatorVersion !== this.registration.creatorVersion || health.pid !== this.lease.pid
                        || CpmPackageStore.compareReleaseIdentity(host.artifacts, descriptor).length) throw new Error('component_matrix_candidate_mismatch');
                    this.events.push({ step: 'health', result: health }); this.save(); return health;
                }
            } catch (error) {
                if (!(error instanceof Error) || !['Message does not exist: peanut-pod-lite-host - query-status', 'component_matrix_probe_not_ready'].includes(error.message)) throw error;
            }
            if (Date.now() >= until) throw new Error('component_matrix_host_not_ready');
            await new Promise((done) => setTimeout(done, 1000));
        } while (true);
    }

    /**
     * @description 控制独立的精确挂接名单并核对catalog，不改变现有公开档位。
     * @param enabled 挂接或撤销本阶段精确六项。
     */
    public async attach(enabled: boolean): Promise<void> {
        await this.mcp({ action: enabled ? 'attachCapabilities' : 'detachCapabilities', projectPath: this.project,
            owner: this.registration.owner, capabilities: McpScopedResourceBoundary.names, resourceRoots: McpScopedResourceBoundary.roots });
        const catalog = this.record(await this.mcp({ action: 'catalog' })); const status = this.record(await this.mcp({ action: 'status' }));
        if (!Array.isArray(catalog.capabilities) || catalog.capabilities.length !== (enabled ? 46 : 40)
            || !Array.isArray(status.writeEnabledPluginIds) || status.writeEnabledPluginIds.length) throw new Error('component_matrix_exposure_mismatch');
        this.events.push({ step: enabled ? 'attach-six' : 'detach-six', catalogCount: catalog.capabilities.length, allEnabled: false }); this.save();
    }

    /**
     * @description 单笔写签发全资源精确匹配的一次性令牌；失败不重放。
     * @param operation 六项之一。
     * @param input 明确业务输入。
     * @returns 实际成功且postflight verified的结果。
     */
    public async write(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (operation === 'preview-refresh') throw new Error('component_matrix_preview_refresh_paused_by_user');
        const name = `peanut.editor-mcp.${operation}`;
        if (!McpScopedResourceBoundary.names.includes(name)) throw new Error('component_matrix_write_out_of_scope');
        const issued = this.record(await this.mcp({ action: 'issueApprovalToken', operations: [name], resources: input.resources,
            maxRisk: operation === 'lumen-comp-rm' ? 'destructive' : 'write' }));
        if (typeof issued.approvalToken !== 'string' || issued.liteMirrored !== true) throw new Error('component_matrix_approval_mirror_missing');
        const result = this.record(await this.mcp({ action: 'call', name, input: { ...input, approvalToken: issued.approvalToken } }));
        this.events.push({ step: operation, input, result }); this.save();
        const postflight = this.record(result.postflight ?? result.taskPostflight);
        if (result.taskStatus !== 'succeeded' || postflight.verified !== true || result.available === false)
            throw new Error(`component_matrix_write_unverified:${operation}`);
        return result;
    }

    /**
     * @description 独立的所属进程生命周期入口；不扩展六项业务能力，不接受脚本或其它应用目标。
     */
    public async ownedQuit(): Promise<unknown> {
        if (this.registration.sdkOwnedQuit !== true || this.registration.creatorVersion !== '3.8.3')
            throw new Error('component_owned_quit_not_registered');
        return this.request('component-probe.json', '/owned-quit', 'x-component-token', {
            pid: this.lease.pid, owner: this.registration.owner, runId: this.registration.runId, projectPath: this.project,
        });
    }

    /**
     * @description 只读真实原生观测入口，每次重新读取描述符。
     * @param action 固定窄观测动作。
     * @param input 有界只读参数。
     * @returns 原始result。
     */
    public async probe(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
        const execute = (): Promise<unknown> => this.request('component-probe.json', '/probe', 'x-component-token', { action, ...input });
        if (!['component-fields', 'scene-snapshot', 'scene-readiness', 'sdk-metrics-diagnostics', 'sdk-window-timer-diagnostics', 'sdk-ui-ready-compat-status', 'sdk-lifecycle-diagnostics', 'sdk-listener-compat-status', 'sdk-scene-cache-diagnostics', 'sdk-scene-cache-compat-status', 'sdk-window-ready-sources', 'load-asset', 'assets'].includes(action)) { return execute(); }
        return ComponentNativeLogGuard.run(this.project, action, execute, event => { this.events.push(event); this.save(); });
    }

    /**
     * @description 经过逐次进程与认证检查取得夹具URL，并独立校验实际HTTP字节。
     * @returns 当前原生socket的有限URL清单。
     */
    public async fixtureUrls() {
        const result = await this.probe('fixture-urls');
        const descriptor = this.record(JSON.parse(readFileSync(join(this.project, '.peanut-ai/component-probe.json'), 'utf8')));
        if (descriptor.pid !== this.lease.pid || descriptor.projectPath !== this.project || descriptor.owner !== this.registration.owner ||
            descriptor.runId !== this.registration.runId || typeof descriptor.port !== 'number') throw new Error('component_matrix_probe_identity_invalid');
        const files = await ComponentProjectUrlResolver.verify(this.project, this.registration, descriptor.port, result);
        this.events.push({ step: 'fixture-urls-byte-verified', files }); this.save(); return files;
    }

    /**
     * @description 宿主ready不等于场景已导入；只读等待AssetDB与落盘meta报告同一UUID后才能打开。
     * @param scene 本任务展示或独立生命周期场景。
     * @returns 当前实际登记UUID；超时或元数据损坏时拒绝，不触发导入和打开。
     */
    public async sceneIdentity(scene: string): Promise<string> {
        if (!/^assets\/components\/(?:_lifecycle\/)?(?:cc(?:\.[a-zA-Z0-9_]+)+|(?:sp|dragonBones)\.[a-zA-Z0-9_]+)\.scene$/u.test(scene)) {
            throw new Error('component_matrix_scene_path_invalid');
        }
        const until = Date.now() + 60000;
        do {
            const assets = await this.probe('assets', { scope: 'components' });
            const asset = Array.isArray(assets) ? assets.map(row => this.record(row)).find(row => row.url === `db://${scene}`) : null;
            if (asset && typeof asset.uuid === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(asset.uuid)) {
                try {
                    const meta = this.record(JSON.parse(readFileSync(join(this.project, scene + '.meta'), 'utf8')));
                    if (meta.uuid === asset.uuid) return asset.uuid;
                } catch (error) {
                    if (this.record(error).code !== 'ENOENT') throw error;
                }
            }
            if (Date.now() >= until) throw new Error('component_matrix_scene_registration_timeout');
            await new Promise(done => setTimeout(done, 500));
        } while (true);
    }

    /**
     * @description 仅发送真实MCP协议，不提供内部消息写入旁路。
     * @param body 明确控制或业务请求。
     * @returns 原始result。
     */
    public async mcp(body: Record<string, unknown>): Promise<unknown> {
        const execute = async (): Promise<unknown> => {
            const value = await this.request('cocos-mcp.json', '/mcp', 'x-peanut-mcp-token', { connectionId: this.connectionId, ...body });
            if (body.action === 'call') {
                const result = this.record(value); const post = this.record(result.postflight ?? result.taskPostflight);
                this.events.push({ step: 'mcp-call-returned-before-raw-postflight', name: body.name,
                    taskId: result.taskId, taskStatus: result.taskStatus, available: result.available,
                    productPostflightVerified: post.verified === true }); this.save();
            }
            return value;
        };
        if (body.action !== 'call') return execute();
        return ComponentNativeLogGuard.run(this.project, 'mcp:' + String(body.name), execute, event => { this.events.push(event); this.save(); });
    }

    /**
     * @description 原进程身份与认证端点都逐次重验，保存失败而不保存认证头或令牌。
     * @param file 描述符文件。
     * @param route 固定路由。
     * @param header 认证头名。
     * @param body 明确请求。
     * @returns 成功结果。
     */
    private async request(file: string, route: string, header: string, body: Record<string, unknown>): Promise<unknown> {
        const identity = execFileSync('/bin/ps', ['-p', String(this.lease.pid), '-o', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8' }).trim();
        if (identity !== String(this.lease.identity).trim()) throw new Error('component_matrix_owned_identity_changed');
        const path = join(this.project, '.peanut-ai', file);
        let descriptor: Record<string, unknown>;
        try {
            if (realpathSync(path) !== path) throw new Error('component_matrix_descriptor_link');
            descriptor = this.record(JSON.parse(readFileSync(path, 'utf8')));
        } catch (error) {
            if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') throw new Error('component_matrix_probe_not_ready');
            throw error;
        }
        if (!Number.isInteger(descriptor.port) || typeof descriptor.token !== 'string') throw new Error('component_matrix_descriptor_invalid');
        if (file === 'component-probe.json' && (descriptor.pid !== this.lease.pid || descriptor.owner !== this.registration.owner
            || descriptor.projectPath !== this.project || descriptor.runId !== this.registration.runId)) throw new Error('component_matrix_probe_identity_invalid');
        const response = await fetch(`http://127.0.0.1:${descriptor.port}${route}`, { method: 'POST',
            headers: { 'content-type': 'application/json', [header]: descriptor.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        const payload = this.record(await response.json());
        if (!response.ok || payload.ok !== true) {
            this.events.push({ step: 'request-refused', action: body.action, name: body.name, result: payload }); this.save();
            throw new Error(typeof payload.error === 'string' ? payload.error : 'component_matrix_request_failed');
        }
        return payload.result;
    }

    /**
     * @description 在传输边界验证JSON对象。
     * @param value 未知结果。
     * @returns 已验证对象或空记录。
     */
    public record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

    /**
     * @description 保存不含令牌的原始步骤证据。
     */
    public save(): void {
        const pending = this.events.slice(this.savedEvents);
        if (pending.length) appendFileSync(join(this.output, 'component-matrix-events.ndjson'), pending.map((event) => JSON.stringify(event)).join('\n') + '\n');
        this.savedEvents = this.events.length;
    }
}
