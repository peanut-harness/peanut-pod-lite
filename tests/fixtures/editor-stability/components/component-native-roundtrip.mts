import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { McpScopedResourceBoundary } from '../../../../packages/engine/modules/kernel/src/mcp/mcp-scoped-resource-boundary.ts';

/**
 * @description 仅在本任务登记工程验证六项受管能力，令牌不进入输出或回执。
 */
class ComponentNativeRoundtrip {
    /**
     * @description 本任务实际工程。
     */
    private readonly project: string;
    /**
     * @description 新证据输出目录。
     */
    private readonly output: string;
    /**
     * @description 固定桥连接，使用实际协议要求的32位十六进制格式。
     */
    private readonly connectionId = randomUUID().replaceAll('-', '');
    /**
     * @description 不包含审批令牌的调用和读回证据。
     */
    private readonly events: unknown[] = [];
    /**
     * @description 原始启动与登记记录；每次网络请求重新核对。
     */
    private readonly lease: Record<string, unknown>;
    /**
     * @description 原工程归属。
     */
    private readonly registration: Record<string, unknown>;

    /**
     * @description 限定本工作树证据目录，并拒绝重用已运行的回执。
     * @param project 当前任务工程。
     */
    public constructor(project: string) {
        const root = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
        this.project = realpathSync(project); this.output = dirname(this.project);
        if (!this.project.startsWith(`${root}${sep}evidence${sep}task-5.1${sep}`) || this.project !== join(this.output, 'project'))
            throw new Error('component_roundtrip_project_out_of_scope');
        this.registration = this.record(JSON.parse(readFileSync(join(this.output, 'project-ownership.json'), 'utf8')));
        this.lease = this.record(JSON.parse(readFileSync(join(this.output, 'creator-owned-start.json'), 'utf8')));
        if (this.registration.task !== '5.1' || this.registration.owner !== '01a13478-7931-7e82-86a4-f4f2fcd47bb1'
            || this.registration.projectPath !== this.project || this.lease.owner !== this.registration.owner
            || this.lease.runId !== this.registration.runId || this.lease.project !== this.project) throw new Error('component_roundtrip_owner_invalid');
        writeFileSync(join(this.output, 'component-roundtrip-start.json'), JSON.stringify({ startedAt: new Date().toISOString(),
            pid: this.lease.pid, candidateSourceCommit: this.registration.candidateSourceCommit }, null, 2) + '\n', { flag: 'wx' });
    }

    /**
     * @description 添加和改写UIOpacity，绑定真实SpriteFrame，经commit与预览刷新后原生重开，再移除并再次重开。
     * @returns 实际字段、组件存在性及资源身份均核对时结束。
     */
    public async run(): Promise<void> {
        const health = this.record(await this.probe('health')); const host = this.record(health.host);
        if (health.creatorVersion !== this.registration.creatorVersion || health.pid !== this.lease.pid || host.ready !== true)
            throw new Error('component_roundtrip_native_health_invalid');
        const scene = 'assets/components/cc.Sprite.scene'; const control = 'assets/components/cc.UIOpacity.scene';
        const target = '/Root/Canvas/Target'; const resources = [`db://${scene}`];
        const original = this.hash(scene);
        const assets = await this.probe('assets'); if (!Array.isArray(assets)) throw new Error('component_roundtrip_assets_invalid');
        const frame = assets.map((entry) => this.record(entry)).filter((entry) => entry.url === 'db://assets/fixtures/media/assets/image/checker.png/spriteFrame'
            && entry.type === 'cc.SpriteFrame' && entry.imported === true && entry.invalid !== true);
        if (frame.length !== 1 || typeof frame[0]?.uuid !== 'string' || typeof frame[0].url !== 'string') throw new Error('component_roundtrip_source_frame_unavailable');
        const frameUuid = frame[0].uuid; const frameUrl = frame[0].url;
        const attachment = { projectPath: this.project, owner: this.registration.owner,
            capabilities: McpScopedResourceBoundary.names, resourceRoots: McpScopedResourceBoundary.roots };
        const attached = await this.mcp({ action: 'attachCapabilities', ...attachment }); this.events.push({ step: 'attach-six', result: attached });
        const catalog = this.record(await this.mcp({ action: 'catalog' }));
        if (!Array.isArray(catalog.capabilities) || catalog.capabilities.length !== 46) throw new Error('component_roundtrip_scoped_catalog_mismatch');
        const status = this.record(await this.mcp({ action: 'status' }));
        if (!Array.isArray(status.writeEnabledPluginIds) || status.writeEnabledPluginIds.length !== 0) throw new Error('component_roundtrip_all_exposure_detected');
        await this.write('lumen-comp-add', { prefabRelativePath: scene, nodePath: target, builtinType: 'cc.UIOpacity', resources });
        await this.write('lumen-comp-set', { prefabRelativePath: scene, nodePath: target, componentType: 'cc.UIOpacity', props: { opacity: 128 }, resources });
        await this.write('lumen-comp-set', { prefabRelativePath: scene, nodePath: target, componentType: 'cc.Sprite',
            props: { grayscale: true, spriteFrame: frameUuid }, resources: [...resources, frameUrl] });
        await this.commit(scene); const persisted = this.hash(scene);
        if (persisted === original) throw new Error('component_roundtrip_file_unchanged');
        await this.open(scene); const added = await this.observe(frameUuid, true); this.events.push({ step: 'native-added-bound-reopen', snapshot: added, sha256: persisted });
        if (this.hash(scene) !== persisted) throw new Error('component_roundtrip_open_wrote_scene');
        await this.write('lumen-comp-rm', { prefabRelativePath: scene, nodePath: target, componentType: 'cc.UIOpacity', confirmDestructive: true, resources });
        await this.commit(scene); const removed = this.hash(scene);
        if (removed === persisted) throw new Error('component_roundtrip_removal_not_persisted');
        await this.open(control); await this.open(scene);
        const reopened = await this.observe(frameUuid, false); this.events.push({ step: 'native-removed-reopen', snapshot: reopened, sha256: removed });
        if (this.hash(scene) !== removed) throw new Error('component_roundtrip_reopen_wrote_scene');
        const sceneAssets = await this.probe('assets', { scope: 'components' }); this.events.push({ step: 'assetdb-components-after', assets: sceneAssets });
        await this.mcp({ action: 'detachCapabilities', ...attachment });
        const after = this.record(await this.mcp({ action: 'catalog' }));
        if (!Array.isArray(after.capabilities) || after.capabilities.length !== 40) throw new Error('component_roundtrip_detach_failed');
        this.save();
        const receipt = { creatorVersion: this.registration.creatorVersion, candidateSourceCommit: this.registration.candidateSourceCommit,
            pid: this.lease.pid, components: ['cc.Sprite', 'cc.UIOpacity'], observedFields: ['cc.Sprite.grayscale', 'cc.Sprite.spriteFrame', 'cc.UIOpacity.opacity'],
            resourceUuid: frameUuid, sixCapabilityAttachmentVerified: true, allEnabled: false, ordinaryCatalogRestored: true,
            persistedAndNativeReopened: true, removalPersistedAndNativeReopened: true, originalSha256: original, addedSha256: persisted,
            removedSha256: removed, exhaustiveComponentMatrixComplete: false, zeroDiagnosticsClaimed: false };
        writeFileSync(join(this.output, 'component-roundtrip-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
        process.stdout.write(JSON.stringify(receipt) + '\n');
    }

    /**
     * @description 每次写单独签发完全匹配operation/resources/risk的令牌，禁止自动重试。
     * @param operation 已授权短名称。
     * @param input 精确写输入。
     * @returns 实际受管写入及postflight通过时结束。
     */
    private async write(operation: string, input: Record<string, unknown>): Promise<void> {
        const name = `peanut.editor-mcp.${operation}`;
        if (!McpScopedResourceBoundary.names.includes(name)) throw new Error('component_roundtrip_operation_out_of_scope');
        const issued = this.record(await this.mcp({ action: 'issueApprovalToken', operations: [name], resources: input.resources,
            maxRisk: operation === 'lumen-comp-rm' ? 'destructive' : 'write' }));
        if (typeof issued.approvalToken !== 'string') throw new Error('component_roundtrip_token_missing');
        const result = this.record(await this.mcp({ action: 'call', name, input: { ...input, approvalToken: issued.approvalToken } }));
        this.events.push({ step: operation, input, result }); this.save();
        const postflight = this.record(result.postflight ?? result.taskPostflight);
        if (result.taskStatus !== 'succeeded' || postflight.verified !== true || result.available === false)
            throw new Error(`component_roundtrip_write_unverified:${operation}`);
    }

    /**
     * @description 按明确文件提交后仅刷新预览，不执行全资产刷新。
     * @param scene 已写场景。
     * @returns 两个受管调用完成时结束。
     */
    private async commit(scene: string): Promise<void> {
        await this.write('lumen-commit', { paths: [scene], resources: [`db://${scene}`] });
        await this.write('preview-refresh', { refreshAssets: false, resources: [`db://${scene}`] });
    }

    /**
     * @description 持久化后呈现场景，不调用scene.save/reload。
     * @param scene 明确任务场景。
     * @returns 受管打开完成时结束。
     */
    private async open(scene: string): Promise<void> { await this.write('scene-open', { path: `db://${scene}`, resources: [`db://${scene}`] }); }

    /**
     * @description 有界等待实际节点和getter值；只重试读取，不重写失败操作。
     * @param frameUuid 实际已导入SpriteFrame身份。
     * @param hasOpacity 当前是否应存在UIOpacity。
     * @returns 实际快照。
     */
    private async observe(frameUuid: string, hasOpacity: boolean): Promise<unknown> {
        const until = Date.now() + 30000; let last: unknown = null;
        do {
            last = await this.probe('scene-snapshot'); const snapshot = this.record(last);
            if (!Array.isArray(snapshot.nodes)) throw new Error('component_roundtrip_snapshot_invalid');
            const nodes = snapshot.nodes.map((entry) => this.record(entry)).filter((entry) => typeof entry.path === 'string' && entry.path.endsWith('/Canvas/Target'));
            if (nodes.length === 1 && Array.isArray(nodes[0]?.components)) {
                const components = nodes[0].components.map((entry) => this.record(entry));
                const sprite = components.find((entry) => entry.type === 'cc.Sprite' && entry.valid === true);
                const opacity = components.find((entry) => entry.type === 'cc.UIOpacity' && entry.valid === true);
                if (sprite) {
                    const fields = this.record(sprite.observed); const frame = fields.spriteFrame;
                    const actual = frame != null && typeof frame === 'object' ? this.record(frame) : {};
                    if (fields.grayscale === true && actual.uuid === frameUuid && actual.type === 'cc.SpriteFrame' && actual.valid === true
                        && (hasOpacity ? opacity && this.record(opacity.observed).opacity === 128 : !opacity)) return last;
                }
            }
            if (Date.now() >= until) break;
            await new Promise((done) => setTimeout(done, 500));
        } while (true);
        this.events.push({ step: 'native-readback-failed', snapshot: last }); this.save(); throw new Error('component_roundtrip_native_readback_mismatch');
    }

    /**
     * @description 调用实际私有MCP端口，保持原结构化拒绝。
     * @param body 明确控制或业务请求。
     * @returns 原始业务结果。
     */
    private async mcp(body: Record<string, unknown>): Promise<unknown> {
        return this.request('cocos-mcp.json', '/mcp', 'x-peanut-mcp-token', { connectionId: this.connectionId, ...body });
    }

    /**
     * @description 只读调用实际场景观测入口。
     * @param action 观测动作。
     * @param input 有界参数。
     * @returns 原始只读结果。
     */
    private async probe(action: string, input: Record<string, unknown> = {}): Promise<unknown> {
        return this.request('component-probe.json', '/probe', 'x-component-token', { action, ...input });
    }

    /**
     * @description 每次重新读取认证描述符，验证原进程身份并保留安全失败证据。
     * @param file 私有描述符名。
     * @param route 固定端口路径。
     * @param header 私有认证头名。
     * @param body 请求。
     * @returns 仅原始result。
     */
    private async request(file: string, route: string, header: string, body: Record<string, unknown>): Promise<unknown> {
        const identity = execFileSync('/bin/ps', ['-p', String(this.lease.pid), '-o', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8' }).trim();
        if (typeof this.lease.identity !== 'string' || identity !== this.lease.identity.trim()) throw new Error('component_roundtrip_owned_identity_changed');
        const path = join(this.project, '.peanut-ai', file); if (realpathSync(path) !== path) throw new Error('component_roundtrip_descriptor_link');
        const descriptor = this.record(JSON.parse(readFileSync(path, 'utf8')));
        if (!Number.isInteger(descriptor.port) || typeof descriptor.token !== 'string') throw new Error('component_roundtrip_descriptor_invalid');
        if (file === 'component-probe.json' && (descriptor.pid !== this.lease.pid || descriptor.owner !== this.registration.owner
            || descriptor.projectPath !== this.project || descriptor.runId !== this.registration.runId)) throw new Error('component_roundtrip_probe_identity_invalid');
        const response = await fetch(`http://127.0.0.1:${descriptor.port}${route}`, { method: 'POST',
            headers: { 'content-type': 'application/json', [header]: descriptor.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        const payload = this.record(await response.json());
        if (!response.ok || payload.ok !== true) {
            this.events.push({ step: 'request-refused', action: body.action, name: body.name, result: payload }); this.save();
            throw new Error(typeof payload.error === 'string' ? payload.error : 'component_roundtrip_request_failed');
        }
        return payload.result;
    }

    /**
     * @description 核对场景保存与打开过程中的原文件摘要。
     * @param scene 本任务场景。
     * @returns 实际SHA。
     */
    private hash(scene: string): string { return createHash('sha256').update(readFileSync(join(this.project, scene))).digest('hex'); }

    /**
     * @description 每步保存不包含令牌的实际结果，失败不覆盖旧工程或回执。
     */
    private save(): void { writeFileSync(join(this.output, 'component-roundtrip-events.json'), JSON.stringify(this.events, null, 2) + '\n'); }

    /**
     * @description 缩窄实际网络与文件记录，不伪造缺失字段。
     * @param value 未受信值。
     * @returns 普通记录。
     */
    private record(value: unknown): Record<string, unknown> {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_roundtrip_record_missing');
        return Object.fromEntries(Object.entries(value));
    }
}

const project = process.argv[process.argv.indexOf('--project') + 1];
if (!project) throw new Error('component_roundtrip_project_required');
await new ComponentNativeRoundtrip(project).run();
