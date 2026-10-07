import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';
import type { ITaskRequest, ITaskEvidenceEntry } from '@peanut/pod-protocol';
import type { IAssetCatalogFastLookup } from '@peanut/pod-engine/assets';
import { ResourceLockManager } from '@peanut/pod-engine/runtime';
import { ExecutionRuntimeService, TaskIngress, TaskLedger, TaskScheduler, TaskMerger, WorkerPool,
    TracePipeline, TaskExecutorRegistry } from '@peanut/pod-engine/runtime';
import { TimeoutAndCancelController } from '../../runtime/dist/execution/timeout/timeout-and-cancel-controller.js';
import { BatchCommitCoordinator } from '../../runtime/dist/execution/commit/batch-commit-coordinator.js';
import { RuntimeTaskCommitDispatcher } from '../../runtime/dist/execution/commit/runtime-task-commit-dispatcher.js';
import type { IAcceptedTask } from '../../runtime/src/execution/ingress/task-ingress.js';
import type { IPluginTaskExecutorContext } from '@peanut/pod-sdk';
import { McpCapabilityRegistry } from '../../kernel/src/mcp/mcp-capability-registry.js';
import { McpFailurePresenter } from '../../kernel/src/mcp/mcp-failure-presenter.js';
import { PluginDiagnosticReporter } from '../../kernel/src/diagnostics/plugin-diagnostic-reporter.js';
import { LumenAssetDbEditorRefreshAdapter } from '../../lumen/source/io/asset-db-refresh.js';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import type { EditorMcpLumenGateway } from '../src/editor-mcp-lumen-gateway.js';
import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';
import { EditorMcpTextWriteGateway } from '../src/editor-mcp-text-write-gateway.js';
import { EditorMcpTextWriteFailure } from '../src/editor-mcp-text-write-failure.js';

/**
 * @description 离线模型只替换外部 Editor 消息和事件；使用实际 Guard/Router/Executor/Transaction/Lumen/Runtime/HostRegistry。
 * added/change 分开派发与原生 package.json 映射相符；编译面板函数不可读，因此该模型是对抗时序而非实际 Creator 实现证明。
 */
class CreatorTextEventHost {
    /**
     * @description 仅本测试拥有的顶层目录。
     */
    public readonly container = fs.mkdtempSync(join(tmpdir(), 'pod-parent-import-'));
    /**
     * @description 模拟项目。
     */
    public readonly project = join(this.container, 'project');
    /**
     * @description 项目外哨兵。
     */
    public readonly sentinel = join(this.container, 'outside.txt');
    /**
     * @description 实际 Router。
     */
    public readonly router: EditorMcpActionRouter;
    /**
     * @description 实际 executor。
     */
    public readonly executor: ResourceOperationTaskExecutor;
    /**
     * @description 双实例的登记权威，仅用于离线测试。
     */
    public readonly registrations = new Map<string, string>();
    /**
     * @description 真实 refresh 调用数。
     */
    public refreshes = 0;
    /**
     * @description 精确故障注入。
     */
    public hook: (stage: string, phase: 'before' | 'after', path: string) => void = () => {};
    /**
     * @description 最后统一 refresh 中的外部修改。
     */
    public refreshAction: () => void = () => {};
    /**
     * @description 收集实际 AssetDB 调用。
     */
    public readonly calls: string[] = [];
    /**
     * @description 生成有效独立 UUID。
     */
    private _sequence = 0;
    /**
     * @description 外部 Editor 事件模型中的面板状态，独立于 AssetDB 登记。
     */
    public readonly assetsTree = new Set<string>();
    /**
     * @description 已发出但尚未由面板消费的 added 事件。
     */
    public readonly pendingAdds = new Set<string>();
    /**
     * @description 外部 Editor 事件先后记录，不当作真实 Creator ACK。
     */
    public readonly events: string[] = [];
    /**
     * @description 真实文本 batch 交给真实 Lumen 的刷新路径。
     */
    public readonly refreshPaths: string[][] = [];
    /**
     * @description 显式推进外部模拟面板事件，不能由 AssetDB UUID 伪造面板已就绪。
     * @returns 无返回值。
     */
    public consumePanelAdds(): void {
        for (const url of this.pendingAdds) {
            this.assetsTree.add(url);
            this.events.push('panel-added:' + url);
        }
        this.pendingAdds.clear();
    }
    /**
     * @description 可控离线导入行为，不从当前磁盘自动构造登记权威。
     */
    public importDirectories = true;
    /**
     * @description 模拟目录导入完成后登记尚未可见的有界等待。
     */
    public directoryUnavailableReads = 0;
    /**
     * @description 注入原生查询持续 pending，验证整体等待上限。
     */
    public stallDirectoryQuery = false;
    /**
     * @description 独立记录 Creator 风格 false->true 原子替换。
     */
    public readonly imports: { path: string; beforeInode: number; afterInode: number; uuid: string }[] = [];

    /**
     * @description 注入最小授权 runtime，全部写入保持实际产品流程。
     * @param context 测试资源生命周期。
     */
    public constructor(context: TestContext) {
        fs.mkdirSync(join(this.project, 'assets'), { recursive: true });
        fs.mkdirSync(join(this.project, 'temp/logs'), { recursive: true });
        fs.writeFileSync(join(this.project, 'temp/logs/project.log'), '');
        fs.writeFileSync(this.sentinel, 'outside-unchanged');
        const runtime = {
            version: { getCurrentVersion: () => ({ raw: '3.8.7', phase: 'editor_api_stable' }) },
            projectRead: { getProjectPath: async () => this.project, getProjectName: async () => 'OfflineText' },
            message: { request: async (_target: string, stage: string, path?: unknown, content?: unknown): Promise<unknown> => {
                const url = typeof path === 'string' ? path : '';
                this.calls.push(stage + ':' + url);
                this.hook(stage, 'before', url);
                let result: unknown = null;
                if (stage === 'query-ready') {
                    result = true;
                } else if (stage === 'query-asset-info') {
                    const file = join(this.project, url.slice('db://'.length));
                    if (fs.existsSync(file) && fs.lstatSync(file).isDirectory() && fs.existsSync(file + '.meta')) {
                        if (this.stallDirectoryQuery) {
                            return await new Promise<unknown>(() => {});
                        }
                        if (this.directoryUnavailableReads > 0) {
                            this.directoryUnavailableReads -= 1;
                            result = null;
                        } else {
                            const uuid = this.registrations.get(url);
                            result = uuid == null ? null : { uuid, importer: 'directory', subAssets: {} };
                        }
                    } else {
                        const uuid = this.registrations.get(url);
                        result = uuid == null ? null : { uuid, importer: 'text', subAssets: {} };
                    }
                } else if (stage === 'refresh-asset') {
                    for (const child of this.registrations.keys()) {
                        if (child.startsWith(url.replace(/\/+$/, '') + '/') && !this.assetsTree.has(child)) {
                            this.events.push('changed-before-added:' + child);
                            fs.appendFileSync(join(this.project, 'temp/logs/project.log'),
                                '10-5-2026 05:47:49 - error: [Window] Can not change the asset "' + child + '", because the original asset is not exist.\n');
                        }
                    }
                    result = true;
                } else if (stage === 'create-asset') {
                    const file = join(this.project, url.slice('db://'.length));
                    assert.equal(fs.existsSync(file), false);
                    fs.mkdirSync(dirname(file), { recursive: true });
                    fs.writeFileSync(file, String(content));
                    this._sequence += 1;
                    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-' + this._sequence.toString(16).padStart(12, '0');
                    fs.writeFileSync(file + '.meta', JSON.stringify({ uuid, importer: 'text' }));
                    this.registrations.set(url, uuid);
                    this.events.push('assetdb-registered:' + url);
                    this.pendingAdds.add(url);
                    if (this.importDirectories) {
                        this.importParents(dirname(file));
                    }
                    result = { uuid };
                } else if (stage === 'delete-asset') {
                    fs.rmSync(join(this.project, url.slice('db://'.length)), { force: true });
                    fs.rmSync(join(this.project, url.slice('db://'.length)) + '.meta', { force: true });
                    this.registrations.delete(url);
                    result = true;
                }
                this.hook(stage, 'after', url);
                return result;
            } },
        } as unknown as IGrantedRuntimeClientSet;
        assert.ok(runtime.message);
        const adapter = new LumenAssetDbEditorRefreshAdapter(runtime.message, 0);
        // 仅连接真实 Lumen 屏障；没有替换 refresh / transaction / writer 算法。
        const lumen = { refreshForCommit: async (paths: readonly string[]) => {
            this.refreshes += 1;
            this.refreshPaths.push([...paths]);
            this.refreshAction();
            return { phase: 'editor_refreshed', barrier: true,
                result: await adapter.refreshBarrier(this.project, paths) };
        } } as unknown as EditorMcpLumenGateway;
        this.router = new EditorMcpActionRouter(runtime, { lookup: () => ({ count: 0, hits: [] }) } as unknown as IAssetCatalogFastLookup,
            lumen, new ResourceLockManager());
        this.executor = new ResourceOperationTaskExecutor({
            lockManager: this.router.getResourceLockManager(),
            plan: (operation, input) => this.router.planManagedResourceOperation(operation as 'asset.writeText', input),
            revalidate: (operation, input, plan) => this.router.revalidateManagedResourceOperation(operation as 'asset.writeText', input, plan),
            beginBatch: (plans, requests) => this.router.beginManagedBatch(plans, requests),
            execute: (operation, input, workerContext, plan, batch) => this.router.executeManagedResourceOperation(
                operation as 'asset.writeText', input, workerContext, plan, batch),
        });
        context.after(() => {
            assert.equal(fs.readFileSync(this.sentinel, 'utf8'), 'outside-unchanged');
            fs.rmSync(this.container, { recursive: true, force: true });
        });
    }

    /**
     * @description 原有 worker 提交上下文。
     */
    public context() {
        return { owner: { pluginId: 'fixture', connectionId: 'fixture', projectKey: this.project, capability: 'asset.writeText' },
            signal: new AbortController().signal, enterCommitWindow: () => true, recordEvidence: () => {} };
    }

    /**
     * @description 用实际 Router 执行。
     * @param input 原始请求。
     * @returns 实际 Router 结果。
     */
    public write(input: Readonly<Record<string, unknown>>) {
        return this.router.execute({ operation: 'asset.writeText', input });
    }

    /**
     * @description 运行实际联合资源 executor。
     * @param inputs 原始任务输入。
     * @returns 实际联合锁批次结果。
     */
    public batch(inputs: readonly Readonly<Record<string, unknown>>[]) {
        const requests = inputs.map((input, index) => ({ requestId: 'request-' + index, pluginId: 'fixture', kind: ResourceOperationTaskExecutor.KIND,
            scope: 'project' as const, priority: 'normal' as const, payload: { operation: 'asset.writeText', input } }));
        return this.executor.executeBatch(requests, requests.map(() => this.context()), 'owned-batch');
    }

    /**
     * @description 初始登记实际文件与meta。
     * @param path 相对路径。
     * @param content 原字节。
     * @returns 外部 Editor 登记 UUID。
     */
    public seed(path: string, content = 'original'): string {
        const uuid = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
        fs.mkdirSync(dirname(join(this.project, path)), { recursive: true });
        fs.writeFileSync(join(this.project, path), content);
        fs.writeFileSync(join(this.project, path + '.meta'), JSON.stringify({ uuid, importer: 'text' }));
        this.registrations.set('db://' + path, uuid);
        return uuid;
    }

    /**
     * @description 独立的 Creator 模拟器，仅改变 imported 标志并保留 UUID/其它字段，以原子替换改变 inode。
     * @param directory 实际创建叶文件的目录。
     */
    public importParents(directory: string): void {
        const assets = join(this.project, 'assets');
        while (directory !== assets) {
            const path = directory + '.meta';
            const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, unknown>;
            if (raw.importer === 'directory' && raw.imported === false) {
                const beforeInode = fs.lstatSync(path).ino;
                fs.writeFileSync(path + '.native', JSON.stringify({ ...raw, imported: true }, null, 2) + '\n');
                fs.renameSync(path + '.native', path);
                const uuid = String(raw.uuid);
                this.registrations.set('db://' + relative(this.project, directory).replace(/\\/gu, '/'), uuid);
                this.imports.push({ path, beforeInode, afterInode: fs.lstatSync(path).ino, uuid });
            }
            directory = dirname(directory);
        }
    }

    /**
     * @description 登记原有真实目录，写入 Creator 已导入完整字段；创建它不属于当前 writer。
     * @param path 项目相对目录。
     * @returns 实际 meta 原字节。
     */
    public seedDirectory(path: string): Buffer {
        const absolute = join(this.project, path);
        fs.mkdirSync(absolute, { recursive: true });
        const uuid = 'cccccccc-dddd-eeee-ffff-000000000001';
        fs.writeFileSync(absolute + '.meta', JSON.stringify({ ver: '1.2.0', importer: 'directory', imported: true,
            uuid, files: [], subMetas: {}, userData: {} }, null, 2) + '\n');
        this.registrations.set('db://' + path, uuid);
        return fs.readFileSync(absolute + '.meta');
    }
}


/**
 * @description 用原公开 Runtime 装配和真实账本/调度/失败投影，不复制原失败传递算法。
 */
class ActualTaskRuntime {
    /**
     * @description 当前测试唯一服务实例。
     */
    public readonly service: ExecutionRuntimeService;
    /**
     * @description 当前测试固定插件身份。
     */
    private readonly _pluginId = 'peanut.event-test';
    /**
     * @description 撤销精确 executor。
     */
    private readonly _revoke: () => void;
    /**
     * @description 原请求有界序号。
     */
    private _sequence = 0;
    /**
     * @description 注入实际领域执行或正对照故障，不替换 Runtime 失败传递与分类。
     * @param context 测试清理生命周期。
     * @param work 实际工作或显式故障注入。
     */
    public constructor(context: TestContext, work: (request: Readonly<ITaskRequest>, service: ExecutionRuntimeService, taskId: string) => Promise<unknown>) {
        const ledger = new TaskLedger();
        const registry = new TaskExecutorRegistry();
        this._revoke = registry.register(this._pluginId, ResourceOperationTaskExecutor.KIND, {
            concurrency: 'executor_managed', execute: async (accepted) => ({ taskId: accepted.taskId,
                kind: accepted.request.kind, changes: [], data: { value: await work(accepted.request, this.service, accepted.taskId) } }),
        });
        this.service = new ExecutionRuntimeService(new TaskIngress(), new TaskScheduler(ledger), ledger,
            new WorkerPool(), new TaskMerger(), new ResourceLockManager(),
            new BatchCommitCoordinator(new RuntimeTaskCommitDispatcher(registry, this._pluginId)),
            new TracePipeline(), new TimeoutAndCancelController(), registry);
        context.after(() => { this._revoke(); this.service.dispose(); });
    }
    /**
     * @description 等待真实受理任务终态，始终保存实际 failed 及其 data，不重建成功。
     * @param input 原业务输入。
     * @param operation 精确受理操作，默认文本写。
     * @returns 实际任务结果。
     */
    public async submit(input: Readonly<Record<string, unknown>>, operation = 'asset.writeText') {
        const receipt = await this.service.submit({ pluginId: this._pluginId, requestId: 'event-' + (++this._sequence),
            kind: ResourceOperationTaskExecutor.KIND, scope: 'project', priority: 'normal', mergePolicy: 'none',
            payload: { operation, input } });
        const result = await this.service.getResult(receipt.taskId);
        assert.ok(result);
        return result;
    }
}

/**
 * @description 经实际 Host Registry 和 Reporter 验证错误仍返回失败，并记录是否存在真实错误日志。
 * @param context 测试日志复原生命周期。
 * @param error 当前实际失败适配后的异常。
 * @param shouldReport 是否应保留诊断。
 * @returns 公开安全失败详情。
 * @oopException 测试断言的无状态生命周期封装，不成为产品服务或公开 API。
 */
async function assertHostFailure(context: TestContext, error: Error, shouldReport: boolean) {
    const reporter = new PluginDiagnosticReporter();
    const registry = new McpCapabilityRegistry((pluginId, failure) => reporter.record({
        pluginId, source: 'mcp_capability', error: failure,
    }));
    const original = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]): void => { calls.push(args); };
    context.after(() => { console.error = original; });
    registry.register('peanut.event-test', { name: 'peanut.event-test.write', description: 'Fixture text failure.',
        category: 'cocos', risk: 'write', readOnly: false, inputSchema: { type: 'object' } }, async () => { throw error; });
    registry.setPluginExposure('peanut.event-test', 'all');
    try {
        await assert.rejects(registry.invoke('peanut.event-test.write', {}, { connectionId: 'a'.repeat(32) }),
            (observed: unknown) => { assert.equal(observed, error); return true; });
        assert.equal(calls.length, shouldReport ? 1 : 0);
        assert.equal(reporter.list().length, shouldReport ? 1 : 0);
        return McpFailurePresenter.present(error);
    } finally {
        console.error = original;
    }
}

/**
 * @description 原真机 Presenter 完整失败字段；来源是冻结 N9 receipt，不能用提案结果自生成预期。
 */
const LEGACY_CONTENT_CONFLICT_FAILURE = Object.freeze({ schemaVersion: 1, code: 'text_file_io_content_conflict',
    category: 'execution_failed', reason: 'The operation failed without a safely confirmed final project state.',
    retryable: false, state: 'unknown', recommendedAction: 'stop' });

/**
 * @description 真正单项/联合 ResourceExecutor 经公开 Runtime registry/dispatcher/ledger 运行；只映射已有宿主上下文。
 */
class ActualResourceTaskRuntime {
    /**
     * @description 当前测试唯一 Runtime。
     */
    public readonly service: ExecutionRuntimeService;
    /**
     * @description 实际受理回执，不能从输入猜测 taskId。
     */
    public lastTaskIds: string[] = [];
    /**
     * @description 实际单项派发计数。
     */
    public singles = 0;
    /**
     * @description 实际联合派发计数。
     */
    public batches = 0;
    /**
     * @description 原请求序号。
     */
    private _sequence = 0;
    /**
     * @description 固定插件授权身份。
     */
    private readonly _pluginId = 'peanut.event-test';
    /**
     * @description 注入外部 Editor fixture；领域 executor 和 Runtime 算法保持实际产品代码。
     * @param context 测试清理生命周期。
     * @param host 外部 Editor 端口。
     * @param core 实际 executor，可在领域 callback 边界注入明确故障。
     * @param foreignSignal 仅负对照提供另一信号，验证 Runtime 自有信号绑定。
     */
    public constructor(context: TestContext, host: CreatorTextEventHost,
        core: ResourceOperationTaskExecutor = host.executor, foreignSignal?: AbortSignal) {
        const ledger = new TaskLedger();
        const registry = new TaskExecutorRegistry();
        const worker = (task: IAcceptedTask): IPluginTaskExecutorContext => ({ ...host.context(),
            signal: foreignSignal ?? this.service.getTaskAbortSignal(task.taskId),
            enterCommitWindow: () => this.service.enterTaskCommitWindow(task.taskId),
            recordEvidence: (entry) => this.service.recordEvidence(task.taskId, entry) });
        const wrap = (task: IAcceptedTask, value: unknown) => ({ taskId: task.taskId, kind: task.request.kind,
            changes: [], data: { value } });
        const revoke = registry.register(this._pluginId, ResourceOperationTaskExecutor.KIND, {
            concurrency: 'executor_managed', execute: async (task) => {
                this.singles += 1;
                return wrap(task, await core.execute(task.request, worker(task)));
            }, executeBatch: async (tasks, batchId) => {
                this.batches += 1;
                const values = await core.executeBatch(tasks.map((task) => task.request), tasks.map(worker), batchId);
                return tasks.map((task, index) => wrap(task, values[index]));
            },
        });
        this.service = new ExecutionRuntimeService(new TaskIngress(), new TaskScheduler(ledger), ledger,
            new WorkerPool(), new TaskMerger(), new ResourceLockManager(),
            new BatchCommitCoordinator(new RuntimeTaskCommitDispatcher(registry, this._pluginId)),
            new TracePipeline(), new TimeoutAndCancelController(), registry);
        context.after(() => { revoke(); this.service.dispose(); });
    }
    /**
     * @description 生成原始明确请求，身份仅由 Runtime 受理回执产生。
     * @param input 原业务输入。
     * @returns 原 Runtime 请求。
     */
    public request(input: Readonly<Record<string, unknown>>): ITaskRequest {
        return { pluginId: this._pluginId, requestId: 'actual-resource-' + (++this._sequence),
            kind: ResourceOperationTaskExecutor.KIND, scope: 'project', priority: 'normal', mergePolicy: 'batch_commit',
            payload: { operation: 'asset.writeText', input } };
    }
    /**
     * @description 真正同步受理单项任务并取实际终态。
     * @param input 原业务输入。
     * @returns 实际 Runtime 终态。
     */
    public async submit(input: Readonly<Record<string, unknown>>) {
        const receipt = await this.service.submit({ ...this.request(input), mergePolicy: 'none' });
        this.lastTaskIds = [receipt.taskId];
        const result = await this.service.getResult(receipt.taskId);
        assert.ok(result);
        return result;
    }
    /**
     * @description 真正联合受理，保留每项 Runtime taskId 和实际失败成员。
     * @param requests 原请求序列。
     * @returns 实际逐任务结果。
     */
    public async group(requests: readonly ITaskRequest[]) {
        const receipt = await this.service.submitBatch(requests);
        this.lastTaskIds = receipt.receipts.map((item) => item.taskId);
        return Promise.all(this.lastTaskIds.map(async (id) => {
            const result = await this.service.getResult(id);
            assert.ok(result);
            return result;
        }));
    }
}

/**
 * @description 故障控制只包裹原 Router 回调，始终执行实际 plan/writer；不改 ResourceExecutor 算法。
 * @param host 外部 Editor fixture。
 * @param afterPlan 原准备异常的观察/故障注入。
 * @returns 实际领域 executor。
 * @oopException 测试局部依赖装配，无公开 API 或产品服务。
 */
function observedResourceExecutor(host: CreatorTextEventHost,
    afterPlan: (input: Readonly<Record<string, unknown>>, failure?: unknown) => void): ResourceOperationTaskExecutor {
    return new ResourceOperationTaskExecutor({ lockManager: host.router.getResourceLockManager(),
        plan: async (operation, input) => {
            try {
                const plan = await host.router.planManagedResourceOperation(operation as 'asset.writeText', input);
                afterPlan(input);
                return plan;
            } catch (error: unknown) { afterPlan(input, error); throw error; }
        },
        revalidate: (operation, input, plan) => host.router.revalidateManagedResourceOperation(operation as 'asset.writeText', input, plan),
        beginBatch: (plans, requests) => host.router.beginManagedBatch(plans, requests),
        execute: (operation, input, worker, plan, batch) => host.router.executeManagedResourceOperation(
            operation as 'asset.writeText', input, worker, plan, batch),
    });
}

test('real Runtime carries only actual pre-write staleSHA refusal; Host returns failed without error noise', async (context) => {
    const f = new CreatorTextEventHost(context);
    f.seed('assets/existing.txt', 'original');
    const before = fs.readFileSync(join(f.project, 'assets/existing.txt.meta'));
    const runtime = new ActualResourceTaskRuntime(context, f);
    const result = await runtime.submit({ path: 'assets/existing.txt', content: 'forbidden', expectedSha256: '0'.repeat(64) });
    assert.equal(runtime.singles, 1, 'must actually exercise single ResourceExecutor.execute');
    assert.equal(result.status, 'failed');
    assert.equal(result.ok, false);
    assert.equal(result.data?.projectState, 'unchanged');
    assert.equal(result.error?.code, 'text_file_io_content_conflict');
    assert.equal(f.calls.filter((call) => call.startsWith('create-asset:') || call.startsWith('save-asset:')).length, 0);
    assert.equal(fs.readFileSync(join(f.project, 'assets/existing.txt'), 'utf8'), 'original');
    assert.deepEqual(fs.readFileSync(join(f.project, 'assets/existing.txt.meta')), before);
    const failure = EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing');
    const dto = await assertHostFailure(context, failure, false);
    assert.equal(dto.code, result.error?.code);
    assert.deepEqual(dto, LEGACY_CONTENT_CONFLICT_FAILURE);
    assert.equal(result.data?.textWritePreparationRefusal != null, true);
    assert.equal(Reflect.get(failure, 'projectState'), 'unchanged');
    assert.equal(result.taskId, runtime.lastTaskIds[0]);
    assert.equal(Reflect.get(dto, 'textFileWrite'), undefined, 'no fabricated per-file outcome before full preparation');
});

for (const variant of ['plain-same-code', 'same-code-unchanged-no-marker', 'after-mutation', 'may-have-changed',
    'lookalike-code', 'marker-wrong-phase', 'marker-unfrozen', 'marker-extra-field', 'marker-accessor', 'wrong-operation']) {
    test('actual Runtime and Host preserve genuine/unknown failure: ' + variant, async (context) => {
        const f = new CreatorTextEventHost(context);
        f.seed('assets/existing.txt', 'original');
        let getterCalls = 0;
        const runtime = new ActualTaskRuntime(context, async () => {
            const error = new Error(variant === 'lookalike-code' ? 'text_file_io_content_conflict:unexpected' : 'text_file_io_content_conflict');
            if (variant === 'after-mutation') fs.writeFileSync(join(f.project, 'assets/existing.txt'), 'actually changed');
            if (variant === 'may-have-changed' || variant === 'after-mutation') Object.assign(error, { projectState: 'may_have_changed' });
            if (variant === 'same-code-unchanged-no-marker') Object.assign(error, { projectState: 'unchanged' });
            if (variant.startsWith('marker-') || variant === 'wrong-operation') {
                const marker: Record<string, unknown> = { schemaVersion: 1, code: 'text_file_io_content_conflict',
                    phase: variant === 'marker-wrong-phase' ? 'writer' : 'prepare_before_writer', projectState: 'unchanged' };
                if (variant === 'marker-extra-field') marker.extra = true;
                if (variant === 'marker-accessor') Object.defineProperty(marker, 'code', { get: () => { getterCalls += 1; return 'text_file_io_content_conflict'; }, enumerable: true });
                if (variant !== 'marker-unfrozen') Object.freeze(marker);
                Object.assign(error, { projectState: 'unchanged', textWritePreparationRefusal: marker });
            }
            throw error;
        });
        const result = await runtime.submit({ path: 'assets/existing.txt', content: 'new' }, variant === 'wrong-operation' ? 'asset.copy' : 'asset.writeText');
        assert.equal(result.status, 'failed');
        assert.equal(result.data?.textWritePreparationRefusal, undefined);
        assert.equal(getterCalls, 0);
        if (variant === 'after-mutation') assert.equal(fs.readFileSync(join(f.project, 'assets/existing.txt'), 'utf8'), 'actually changed');
        const code = result.error?.code ?? 'missing';
        const adapted = EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, code);
        const dto = await assertHostFailure(context, adapted, true);
        assert.equal(dto.code, code);
        assert.equal(dto.state, 'unknown', 'unproven ordinary failure remains conservative, never safe refusal');
    });
}

test('real Router plus Lumen avoids parent changed before separate Assets added; two sequential updates keep UUID', async (context) => {
    const f = new CreatorTextEventHost(context);
    const path = 'assets/new/queued.txt';
    await f.batch([{ path, content: 'seed', expectedSha256: 'absent' }]);
    const uuid = f.registrations.get('db://' + path);
    assert.ok(uuid);
    assert.equal(f.assetsTree.has('db://' + path), false, 'DB registration does not fabricate a panel ACK');
    const runtime = new ActualTaskRuntime(context, async (request, service, taskId) => f.executor.execute(request, {
        ...f.context(), signal: service.getTaskAbortSignal(taskId),
        enterCommitWindow: () => service.enterTaskCommitWindow(taskId),
        recordEvidence: (entry: ITaskEvidenceEntry) => service.recordEvidence(taskId, entry),
    }));
    for (const content of ['queue1\n', 'queue2\n']) {
        const expectedSha256 = createHash('sha256').update(fs.readFileSync(join(f.project, path))).digest('hex');
        const result = await runtime.submit({ path, content, expectedSha256 });
        assert.equal(result.status, 'succeeded');
        assert.equal(result.ok, true);
        assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), content);
        assert.equal(f.registrations.get('db://' + path), uuid);
    }
    assert.equal(f.calls.some((call) => call.startsWith('refresh-asset:') || call.startsWith('save-asset:')), false);
    assert.ok(f.refreshPaths.every((paths) => paths.length === 1 && paths[0] === path));
    assert.equal(f.events.some((event) => event.startsWith('changed-before-added:')), false);
    f.consumePanelAdds();
    assert.equal(f.assetsTree.has('db://' + path), true);
    assert.equal(fs.readFileSync(join(f.project, 'temp/logs/project.log'), 'utf8'), '');
});

test('real batch of 32 files still refreshes actual files once and keeps parent final verification', async (context) => {
    const f = new CreatorTextEventHost(context);
    const files = Array.from({ length: 32 }, (_, index) => ({ path: 'assets/nested/sub/' + index + '.txt', content: '雪' + index, expectedSha256: 'absent' }));
    const result = await f.batch([{ files }]);
    assert.equal(result.length, 1);
    assert.equal(f.refreshes, 1);
    assert.deepEqual([...f.refreshPaths[0] ?? []].sort(), files.map((file) => file.path).sort());
    assert.equal(f.calls.some((call) => call.startsWith('refresh-asset:')), false);
    for (const file of files) assert.equal(fs.readFileSync(join(f.project, file.path), 'utf8'), file.content);
    f.consumePanelAdds();
    assert.equal(f.assetsTree.size, 32);
    assert.equal(fs.readFileSync(join(f.project, 'temp/logs/project.log'), 'utf8'), '');
});

test('real postflight still rejects genuine Window error after a write; disk change is not relabeled verified', async (context) => {
    const f = new CreatorTextEventHost(context);
    await f.batch([{ path: 'assets/new/a.txt', content: 'original', expectedSha256: 'absent' }]);
    let injected = false;
    f.hook = (stage) => {
        if (stage === 'query-ready' && !injected) {
            injected = true;
            fs.appendFileSync(join(f.project, 'temp/logs/project.log'), '10-5-2026 05:47:49 - error: [Window] genuine injected missing original\n');
        }
    };
    await assert.rejects(f.batch([{ path: 'assets/new/a.txt', content: 'changed' }]), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'editor_mcp_project_log_postflight_failed');
        assert.equal(Reflect.get(error, 'projectState'), 'may_have_changed');
        return true;
    });
    assert.equal(fs.readFileSync(join(f.project, 'assets/new/a.txt'), 'utf8'), 'changed');
    assert.equal(injected, true);
});

test('parent metadata replacement remains fatal without explicit parent refresh', async (context) => {
    const f = new CreatorTextEventHost(context);
    await f.batch([{ path: 'assets/new/a.txt', content: 'original', expectedSha256: 'absent' }]);
    f.refreshAction = () => {
        const path = join(f.project, 'assets/new.meta');
        fs.renameSync(path, path + '.kept');
        fs.writeFileSync(path, fs.readFileSync(path + '.kept'));
    };
    await assert.rejects(f.batch([{ path: 'assets/new/a.txt', content: 'changed' }]), /text_file_io_parent_identity_conflict/u);
    assert.equal(f.calls.some((call) => call.startsWith('refresh-asset:')), false);
});

test('actual ResourceExecutor group failure marks only originating accepted request and keeps both files unchanged', async (context) => {
    const f = new CreatorTextEventHost(context);
    f.seed('assets/a.txt', 'original'); f.seed('assets/b.txt', 'other');
    const runtime = new ActualResourceTaskRuntime(context, f);
    const results = await runtime.group([
        runtime.request({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) }),
        runtime.request({ path: 'assets/b.txt', content: 'new', expectedSha256: createHash('sha256').update('other').digest('hex') }),
    ]);
    assert.equal(runtime.batches, 1, 'must actually exercise combined execution');
    assert.equal(results.length, 2);
    for (const result of results) { assert.equal(result.status, 'failed'); assert.equal(result.ok, false); }
    const origin = results[0]; const sibling = results[1]; assert.ok(origin && sibling);
    assert.equal(origin.data?.textWritePreparationRefusal != null, true);
    assert.equal(sibling.data?.textWritePreparationRefusal, undefined);
    assert.equal(origin.data?.projectState, 'unchanged');
    await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(origin, origin.taskId, origin.error?.code ?? 'missing'), false);
    await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(sibling, sibling.taskId, sibling.error?.code ?? 'missing'), true);
    assert.equal(fs.readFileSync(join(f.project, 'assets/a.txt'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(join(f.project, 'assets/b.txt'), 'utf8'), 'other');
    assert.equal(f.calls.some((call) => call.startsWith('create-asset:') || call.startsWith('save-asset:')), false);
});

test('same original request reused for two accepted tasks cannot prove unique origin', async (context) => {
    const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
    const runtime = new ActualResourceTaskRuntime(context, f);
    const request = runtime.request({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) });
    const results = await runtime.group([request, request]);
    assert.equal(runtime.batches, 1); assert.equal(results.length, 2);
    assert.notEqual(results[0]?.taskId, results[1]?.taskId);
    for (const result of results) {
        assert.equal(result.status, 'failed'); assert.equal(result.data?.textWritePreparationRefusal, undefined);
        await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing'), true);
    }
});

for (const variant of ['different-task-argument', 'marker-task-id', 'inherited-marker', 'marker-accessor']) {
    test('actual preparation result rejects adapter proof mismatch: ' + variant, async (context) => {
        const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
        const runtime = new ActualResourceTaskRuntime(context, f);
        const result = await runtime.submit({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) });
        assert.ok(result.data?.textWritePreparationRefusal);
        let getterCalls = 0;
        const original = result.data.textWritePreparationRefusal as Readonly<Record<string, unknown>>;
        const marker = variant === 'marker-task-id' ? { ...original, taskId: 'another-task' } : original;
        const data: Record<string, unknown> = variant === 'inherited-marker'
            ? Object.assign(Object.create({ textWritePreparationRefusal: marker }) as Record<string, unknown>, { projectState: 'unchanged' })
            : { ...result.data, textWritePreparationRefusal: marker };
        if (variant === 'marker-accessor') Object.defineProperty(data, 'textWritePreparationRefusal', {
            get: () => { getterCalls += 1; return marker; }, enumerable: true });
        const failure = EditorMcpTextWriteFailure.fromTaskResult({ ...result, data },
            variant === 'different-task-argument' ? 'another-task' : result.taskId, result.error?.code ?? 'missing');
        const dto = await assertHostFailure(context, failure, true);
        assert.deepEqual(dto, LEGACY_CONTENT_CONFLICT_FAILURE); assert.equal(getterCalls, 0);
    });
}

test('actual Gateway prepare outside original resource plan scope cannot mint trusted refusal', async (context) => {
    const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
    const gateway = new EditorMcpTextWriteGateway(async () => ({}));
    let observed: unknown;
    try { gateway.prepare(f.project, { path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) }); }
    catch (error: unknown) { observed = error; }
    assert.ok(observed instanceof Error);
    const core = observedResourceExecutor(f, () => { throw observed; });
    const runtime = new ActualResourceTaskRuntime(context, f, core);
    const result = await runtime.submit({ path: 'assets/a.txt', content: 'valid' });
    assert.equal(result.status, 'failed'); assert.equal(result.data?.textWritePreparationRefusal, undefined);
    await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing'), true);
});

test('actual prepare proof with foreign executor AbortSignal remains ordinary diagnostic', async (context) => {
    const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
    const runtime = new ActualResourceTaskRuntime(context, f, f.executor, new AbortController().signal);
    const result = await runtime.submit({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) });
    assert.equal(result.status, 'failed'); assert.equal(result.data?.textWritePreparationRefusal, undefined);
    await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing'), true);
});

for (const variant of ['content', 'expected-digest', 'path', 'input-reference', 'request-id', 'plugin-id', 'payload-operation']) {
    test('real prepare error cannot cross changed accepted input: ' + variant, async (context) => {
        const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
        let request: ITaskRequest | undefined;
        const core = observedResourceExecutor(f, (input, error) => {
            if (error == null) return;
            if (variant === 'input-reference') {
                assert.ok(request);
                (request.payload as Record<string, unknown>).input = { ...input };
            } else if (variant === 'request-id' || variant === 'plugin-id') {
                assert.ok(request);
                (request as unknown as Record<string, unknown>)[variant === 'request-id' ? 'requestId' : 'pluginId'] = 'changed';
            } else if (variant === 'payload-operation') {
                assert.ok(request); (request.payload as Record<string, unknown>).operation = 'asset.copy';
            } else (input as Record<string, unknown>)[variant === 'expected-digest' ? 'expectedSha256' : variant] = 'changed';
        });
        const runtime = new ActualResourceTaskRuntime(context, f, core);
        request = runtime.request({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) });
        const [result] = await runtime.group([request]); assert.ok(result);
        assert.equal(result.status, 'failed'); assert.equal(result.data?.textWritePreparationRefusal, undefined);
        await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing'), true);
        assert.equal(fs.readFileSync(join(f.project, 'assets/a.txt'), 'utf8'), 'original');
    });
}

test('same genuine Error replayed in another actual resource plan cannot reuse consumed origin proof', async (context) => {
    const f = new CreatorTextEventHost(context); f.seed('assets/a.txt', 'original');
    let captured: unknown; let replay = false;
    const core = observedResourceExecutor(f, (_input, failure) => {
        if (failure != null) captured = failure;
        else if (replay) throw captured;
    });
    const runtime = new ActualResourceTaskRuntime(context, f, core);
    const first = await runtime.submit({ path: 'assets/a.txt', content: 'bad', expectedSha256: '0'.repeat(64) });
    assert.ok(first.data?.textWritePreparationRefusal); replay = true;
    const second = await runtime.submit({ path: 'assets/a.txt', content: 'valid' });
    assert.equal(second.status, 'failed'); assert.equal(second.data?.textWritePreparationRefusal, undefined);
    await assertHostFailure(context, EditorMcpTextWriteFailure.fromTaskResult(second, second.taskId, second.error?.code ?? 'missing'), true);
    assert.equal(fs.readFileSync(join(f.project, 'assets/a.txt'), 'utf8'), 'original');
});

for (const variant of ['unchanged-shape-spoof', 'may-have-changed-shape-spoof']) {
    test('frozen correct-looking marker after actual text create remains failed and preserves genuine project error: ' + variant, async (context) => {
        const f = new CreatorTextEventHost(context);
        let observedActualWrittenBytes: string | null = null;
        f.hook = (stage, phase) => {
            if (stage !== 'create-asset' || phase !== 'after') return;
            observedActualWrittenBytes = fs.readFileSync(join(f.project, 'assets/new/a.txt'), 'utf8');
            fs.appendFileSync(join(f.project, 'temp/logs/project.log'), '10-5-2026 05:47:49 - error: [Window] actual after-write fault\n');
            throw Object.assign(new Error('text_file_io_content_conflict'), {
                projectState: variant === 'unchanged-shape-spoof' ? 'unchanged' : 'may_have_changed',
                textWritePreparationRefusal: Object.freeze({ schemaVersion: 1, code: 'text_file_io_content_conflict',
                    phase: 'prepare_before_writer', projectState: 'unchanged' }),
            });
        };
        const runtime = new ActualResourceTaskRuntime(context, f);
        const result = await runtime.submit({ path: 'assets/new/a.txt', content: 'actually changed', expectedSha256: 'absent' });
        assert.equal(result.status, 'failed'); assert.equal(result.ok, false);
        assert.equal(result.data?.textWritePreparationRefusal, undefined);
        assert.equal(observedActualWrittenBytes, 'actually changed', 'real physical mutation occurred before fault, independent of possible original recovery');
        assert.match(fs.readFileSync(join(f.project, 'temp/logs/project.log'), 'utf8'), /actual after-write fault/u);
        const failure = EditorMcpTextWriteFailure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing');
        assert.notEqual(Reflect.get(failure, 'isMcpControlFlowRefusal'), true);
        const dto = McpFailurePresenter.present(failure);
        assert.notEqual(dto.state, 'unchanged');
        assert.equal(dto.retryable, false);
        // 原有合法逐文件结构化失败可避免重复 Reporter；原真实 Window error 与失败状态均不得清除。
    });
}
