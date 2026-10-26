import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ComponentNativeLogGuard } from '../../../../../tests/fixtures/editor-stability/components/component-native-log-guard.mts';
import { ComponentNativeRawLogs } from '../../../../../tests/fixtures/editor-stability/components/component-native-raw-logs.mts';
import { ComponentTaskOwnership } from '../../../../../tests/fixtures/editor-stability/components/component-task-ownership.mts';
import type { IResourceManagedConnection } from './resource-stability-managed-port.mts';
import type { IResourceCaseObservation, IResourceSessionIdentity, IResourceSnapshot } from './resource-stability-contracts.mts';
import { ResourceStabilityPreparationRefusal } from './resource-stability-preparation-refusal.mts';
import { ResourceStabilitySafeFailure } from './resource-stability-safe-failure.mts';
import { HostPackageIdentity } from '../src/host-package-identity.ts';

/**
 * @description 4.3 所属工程的认证连接；每个请求重新读取 descriptor、token、端口及原始进程身份。
 */
export class ResourceStabilityNativeClient implements IResourceManagedConnection {
    public readonly root = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));
    public readonly project: string;
    public readonly output: string;
    public readonly registration: Record<string, unknown>;
    private readonly lease: Record<string, unknown>;
    private readonly connectionId = randomUUID().replaceAll('-', '');

    public constructor(project: string) {
        this.project = realpathSync(project); this.output = dirname(this.project);
        this.registration = this.record(JSON.parse(readFileSync(join(this.output, 'project-ownership.json'), 'utf8')));
        this.lease = this.record(JSON.parse(readFileSync(join(this.output, 'creator-owned-start.json'), 'utf8')));
        if (this.registration.task !== '4.3' || this.registration.owner !== ComponentTaskOwnership.current(this.root)
            || this.registration.creatorVersion !== '3.8.3' || this.registration.projectPath !== this.project
            || this.project !== join(this.root, 'evidence/task-4.3', String(this.registration.runId), 'project')
            || this.lease.owner !== this.registration.owner || this.lease.runId !== this.registration.runId || this.lease.project !== this.project) {
            throw new Error('resource_native_client_identity_invalid');
        }
    }

    /**
     * @description 检查启动以来五源原始日志，不能从动作游标跳过启动错误。
     */
    public assertWholeLogs(): void {
        const result = ComponentNativeRawLogs.readAll(this.project);
        this.event({ step: 'whole-raw-log-check', result });
        if (result.newErrors.length || result.newWarnings.length) throw new Error('resource_native_whole_logs_failed');
    }

    /**
     * @description actual Host/Core 发布身份通过既有比较器独立核对，不能仅相信登记表。
     */
    public async identity(): Promise<IResourceSessionIdentity> {
        const current = this.record(await this.request('resource-probe.json', '/identity', 'x-resource-token', {}));
        const host = this.record(current.host);
        const descriptor = JSON.parse(readFileSync(join(this.root, 'release/peanut.pod-lite-0.2.0/lite-release-descriptor.json'), 'utf8')) as unknown;
        if (host.ready !== true || current.pid !== this.lease.pid || current.creatorVersion !== '3.8.3'
            || HostPackageIdentity.compareReleaseIdentity(host.artifacts, descriptor).length) throw new Error('resource_native_candidate_mismatch');
        return { creatorVersion: '3.8.3', projectPath: this.project, projectName: String(JSON.parse(readFileSync(join(this.project, 'package.json'), 'utf8')).name),
            owner: String(this.registration.owner), change: String(this.registration.change), runId: String(this.registration.runId),
            creatorPid: Number(this.lease.pid), creatorStartedAt: String(this.lease.startedAt), hostSha256: String(this.registration.hostSha256),
            coreSha256: String(this.registration.coreSha256), sourceCommit: String(this.registration.candidateSourceCommit) };
    }

    /**
     * @description 公共 MCP 操作的原始日志后验复用五源严格分类器，不省略普通输出诊断。
     */
    public async mcp(body: Readonly<Record<string, unknown>>): Promise<unknown> {
        const execute = () => this.request('cocos-mcp.json', '/mcp', 'x-peanut-mcp-token', { connectionId: this.connectionId, ...body });
        if (body.action !== 'call') return execute();
        return ComponentNativeLogGuard.run(this.project, `resource-mcp:${String(body.name)}`, execute, (event) => this.event(event));
    }

    /**
     * @description 固定只读入口的响应同样受原始日志验收；不重写 origin 或语义。
     */
    public async nativeSnapshot(path: string): Promise<IResourceSnapshot> {
        return ComponentNativeLogGuard.run(this.project, 'resource-native-snapshot', async () =>
            await this.request('resource-probe.json', '/snapshot', 'x-resource-token', { path }) as IResourceSnapshot,
        (event) => this.event(event));
    }

    /**
     * @description 本项目私有输入每次重读；不接受原工程、外盘和链接。
     */
    public async fixtureSourceSha256(path: string): Promise<string> {
        const inputRoot = join(this.project, '.peanut-ai/resource-stability-inputs', String(this.registration.runId));
        if (!path.startsWith(`${inputRoot}/`) || realpathSync(path) !== path || !statSync(path).isFile()) {
            throw new Error('resource_native_fixture_out_of_scope');
        }
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    /**
     * @description 固定源及其 metadata bytes，目录递归时保留名称、缺失状态和全部后代。
     */
    public async sourceHashes(path: string): Promise<string> {
        const namespace = String(this.registration.namespace);
        if (!path.startsWith(`${namespace}/`) || path.split('/').some((item) => !item || item === '.' || item === '..') || /[\\%]/u.test(path)) {
            throw new Error('resource_native_hash_path_out_of_scope');
        }
        const hash = createHash('sha256'); let count = 0; let size = 0;
        const visit = (absolute: string): void => {
            hash.update(absolute.slice(this.project.length));
            if (!existsSync(absolute)) { hash.update('missing'); return; }
            if (lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error('resource_native_hash_link');
            if (++count > 4096) throw new Error('resource_native_hash_budget_exceeded');
            if (statSync(absolute).isDirectory()) { for (const item of readdirSync(absolute).sort()) visit(join(absolute, item)); return; }
            const bytes = readFileSync(absolute); size += bytes.length;
            if (size > 32 * 1024 * 1024) throw new Error('resource_native_hash_budget_exceeded');
            hash.update(bytes);
        };
        visit(join(this.project, path)); visit(join(this.project, `${path}.meta`)); return hash.digest('hex');
    }
    /**
     * @description 仅namespace内真实普通源文件的原始字节，不含文件名和meta，不执行SDK。
     */
    public async sourceContentSha256(path: string): Promise<string> {
        const absolute = join(this.project, path);
        if (!path.startsWith(`${String(this.registration.namespace)}/`) || path.split('/').some(item => !item || item === '.' || item === '..')
            || /[\\%]/u.test(path) || !existsSync(absolute) || lstatSync(absolute).isSymbolicLink()
            || realpathSync(absolute) !== absolute || !statSync(absolute).isFile() || statSync(absolute).size > 32 * 1024 * 1024) {
            throw new Error('resource_native_source_content_out_of_scope');
        }
        return createHash('sha256').update(readFileSync(absolute)).digest('hex');
    }
    /**
     * @description 观察追加保存；一次性令牌及请求输入不进入证据。
     */
    public async recordObservation(observation: IResourceCaseObservation): Promise<void> { this.event({ step: 'observation', observation }); }
    /**
     * @description 不确定写入保留失败，不自动重放。
     */
    public async recordFailure(caseId: string, code: string): Promise<void> { this.event({ step: 'failure', caseId, code }); }
    /**
     * @description 仅已核验的当前所属 SDK 公开正常关闭；不接收任意 PID。
     */
    public ownedQuit(): Promise<unknown> {
        return this.request('resource-probe.json', '/owned-quit', 'x-resource-token', { pid: this.lease.pid,
            projectPath: this.project, owner: this.registration.owner, runId: this.registration.runId });
    }
    private async request(file: string, route: string, header: string, body: Readonly<Record<string, unknown>>): Promise<unknown> {
        const identity = execFileSync('/bin/ps', ['-p', String(this.lease.pid), '-o', 'pid=,ppid=,lstart=,args=', '-ww'], { encoding: 'utf8' }).trim();
        if (identity !== String(this.lease.identity).trim()) throw new Error('resource_native_owned_process_changed');
        const path = join(this.project, '.peanut-ai', file);
        if (realpathSync(path) !== path) throw new Error('resource_native_descriptor_link');
        const descriptor = this.record(JSON.parse(readFileSync(path, 'utf8')));
        if (!Number.isInteger(descriptor.port) || Number(descriptor.port) <= 0 || Number(descriptor.port) > 65535
            || typeof descriptor.token !== 'string' || !descriptor.token) throw new Error('resource_native_descriptor_invalid');
        if (file === 'resource-probe.json' && (descriptor.pid !== this.lease.pid || descriptor.owner !== this.registration.owner
            || descriptor.projectPath !== this.project || descriptor.runId !== this.registration.runId)) throw new Error('resource_native_descriptor_identity_mismatch');
        const response = await fetch(`http://127.0.0.1:${descriptor.port}${route}`, { method: 'POST',
            headers: { 'content-type': 'application/json', [header]: descriptor.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
        const payload = this.record(await response.json());
        if (!response.ok || payload.ok !== true) {
            const summary = ResourceStabilitySafeFailure.http(response.status, route, payload);
            this.event(summary);
            const refusal = response.status === 400 && route === '/mcp' && body.action === 'call'
                ? ResourceStabilityPreparationRefusal.fromResponse(payload, body.name) : null;
            if (refusal) { this.event({ step: 'asset-field-prepare-failed-before-writer', failure: refusal.failure }); throw refusal; }
            throw new Error(summary.code);
        }
        return payload.result;
    }
    private event(value: Readonly<Record<string, unknown>>): void {
        appendFileSync(join(this.output, 'resource-native-events.ndjson'), `${JSON.stringify(value)}\n`);
    }
    private record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resource_native_response_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
