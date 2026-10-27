import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ComponentNativeClient } from './component-native-client.mts';

/**
 * @description 独立、有界的实际预览安全验收；只允许最多三次刷新，未知状态立即停止。
 */
export class ComponentPreviewSafety {
    /**
     * @description 核对当前实际工程类型的冻结候选，禁止现有0.2.1工程复用历史0.2.0身份。
     * @param root 当前工作树。
     * @param registration 已验证工程登记。
     * @returns 与登记完全匹配的候选摘要。
     */
    public static releaseIdentity(root: string, registration: Readonly<Record<string, unknown>>) {
        const kind = registration.kind;
        if (!['registered-existing-0.2.1-project', 'worktree-local-validation-project'].includes(String(kind)))
            throw new Error('preview_safety_project_kind_invalid');
        const version = kind === 'registered-existing-0.2.1-project' ? '0.2.1' : '0.2.0';
        const descriptor = this.record(JSON.parse(readFileSync(join(root, `release/peanut.pod-lite-${version}/lite-release-descriptor.json`), 'utf8')));
        const host = this.record(descriptor.host); const core = this.record(descriptor.core);
        if (descriptor.version !== version || typeof host.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(host.sha256)
            || typeof core.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(core.sha256)
            || host.sha256 !== registration.hostSha256 || core.sha256 !== registration.coreSha256)
            throw new Error('preview_safety_candidate_identity_mismatch');
        return { version, hostSha256: host.sha256, coreSha256: core.sha256 };
    }

    /**
     * @description 对未受信JSON记录执行显式收窄。
     * @param value 未受信记录。
     * @returns 已收窄记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('preview_safety_descriptor_invalid');
        return Object.fromEntries(Object.entries(value));
    }

    /**
     * @description 在实际刷新前冻结的候选身份。
     */
    private readonly candidate: ReturnType<typeof ComponentPreviewSafety.releaseIdentity>;
    /**
     * @description 实际执行的安全入口源码摘要。
     */
    private readonly runnerSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
    /**
     * @description 本任务实际工程与认证传输。
     */
    private readonly client: ComponentNativeClient;
    /**
     * @description 保存每次真实窗口计数与业务结果。
     */
    private readonly steps: Record<string, unknown>[] = [];

    /**
     * @description 拒绝重复运行同一工程安全测试，避免意外累计开窗。
     * @param project 新的本任务工程。
     */
    public constructor(project: string) {
        this.client = new ComponentNativeClient(project);
        this.candidate = ComponentPreviewSafety.releaseIdentity(this.client.root, this.client.registration);
        writeFileSync(join(this.client.output, 'preview-safety-start.json'), JSON.stringify({ startedAt: new Date().toISOString(),
            maxRefreshCalls: 3, candidateSourceCommit: this.client.registration.candidateSourceCommit }) + '\n', { flag: 'wx' });
    }

    /**
     * @description 先只读核对窗口，验证query不打开；不存在才允许单次打开，之后两次只能刷新已有窗口。
     */
    public async run(): Promise<void> {
        await this.client.health(); await this.client.attach(true);
        const scene = 'assets/components/cc.UIOpacity.scene'; const resources = [`db://${scene}`];
        try {
            const expectedSceneUuid = await this.client.sceneIdentity(scene);
            await this.client.write('scene-open', { path: `db://${scene}`, resources });
            const snapshot = this.client.record(await this.client.probe('scene-snapshot'));
            if (snapshot.sceneUuid !== expectedSceneUuid) throw new Error('preview_safety_native_scene_identity_mismatch');
            const before = await this.state(true); const initialTabs = this.tabs(before);
            await this.client.mcp({ action: 'call', name: 'peanut.editor-mcp.preview-query', input: {} });
            const queried = await this.state(true);
            if (this.tabs(queried) !== initialTabs) throw new Error('preview_safety_readonly_query_changed_windows');
            this.steps.push({ step: 'readonly-query-did-not-open', before, after: queried }); this.save(false);
            if (initialTabs > 0) await this.connected();
            const expectedTabs = initialTabs || 1;
            for (let index = 0; index < 3; index++) {
                const issued = this.client.record(await this.client.mcp({ action: 'issueApprovalToken',
                    operations: ['peanut.editor-mcp.preview-refresh'], resources, maxRisk: 'write' }));
                if (typeof issued.approvalToken !== 'string' || issued.liteMirrored !== true) throw new Error('preview_safety_approval_missing');
                const result = this.client.record(await this.client.mcp({ action: 'call', name: 'peanut.editor-mcp.preview-refresh',
                    input: { refreshAssets: false, resources, approvalToken: issued.approvalToken } }));
                this.steps.push({ step: 'bounded-refresh', index, result }); this.save(false);
                const postflight = this.client.record(result.postflight ?? result.taskPostflight);
                if (result.taskStatus !== 'succeeded' || postflight.verified !== true || result.available !== true)
                    throw new Error('preview_safety_refresh_unverified');
                await this.connected(); const after = await this.state(true);
                this.steps.push({ step: 'actual-window-count', index, after }); this.save(false);
                if (this.tabs(after) !== expectedTabs) throw new Error('preview_safety_refresh_changed_window_count');
                const message = String(result.message);
                if ((initialTabs > 0 || index > 0) && message.includes('open-requested')) throw new Error('preview_safety_existing_window_opened_again');
            }
            this.save(true);
        } catch (error) {
            this.steps.push({ step: 'safety-stopped', reason: error instanceof Error ? error.message : String(error) }); this.save(false); throw error;
        } finally { await this.client.attach(false); }
    }

    /**
     * @description 唯一允许的只读预览状态接口，不打开窗口。
     * @param inspectWindows 是否读取当前Creator对应的实际浏览器标签计数。
     * @returns 实际状态。
     */
    private async state(inspectWindows: boolean): Promise<Record<string, unknown>> {
        return this.client.record(await this.client.probe('preview-state', { inspectWindows }));
    }

    /**
     * @description 权限不足或不能读取窗口时停止，不能把未知当作零。
     * @param state 原生只读观测。
     * @returns 经过验证的计数。
     */
    private tabs(state: Record<string, unknown>): number {
        const value = state.matchingBrowserTabs;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('preview_safety_window_observation_unknown');
        return value;
    }

    /**
     * @description 有界等待已经发出的打开/刷新完成；仅轮询状态，绝不重放业务写入。
     */
    private async connected(): Promise<void> {
        const until = Date.now() + 30000;
        do {
            const state = await this.state(false);
            if (typeof state.connectedPreviewCount === 'number' && state.connectedPreviewCount > 0) return;
            if (Date.now() >= until) throw new Error('preview_safety_connection_not_ready');
            await new Promise(done => setTimeout(done, 500));
        } while (true);
    }

    /**
     * @description 单独登记安全结果，不提升组件矩阵或零诊断状态。
     * @param verified 所有实际窗口计数和业务后验是否通过。
     */
    private save(verified: boolean): void {
        if (createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex') !== this.runnerSha256)
            throw new Error('preview_safety_runner_changed');
        writeFileSync(join(this.client.output, 'preview-safety-receipt.json'), JSON.stringify({
            verified, creatorVersion: this.client.registration.creatorVersion, candidateSourceCommit: this.client.registration.candidateSourceCommit,
            hostSha256: this.candidate.hostSha256, coreSha256: this.candidate.coreSha256,
            runnerSha256: this.runnerSha256, maxRefreshCalls: 3,
            allEnabled: false, task51Complete: false, steps: this.steps }, null, 2) + '\n');
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const project = process.argv[process.argv.indexOf('--project') + 1];
    if (!project) throw new Error('preview_safety_project_required');
    await new ComponentPreviewSafety(project).run();
}
