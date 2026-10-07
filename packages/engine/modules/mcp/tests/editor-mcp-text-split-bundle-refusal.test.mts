import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createContext, Script } from 'node:vm';
import { types as nodeTypes } from 'node:util';
import { buildSync } from 'esbuild';
import type { ITaskRequest, ITaskResult } from '@peanut/pod-protocol';
import type { IPluginTaskExecutorContext } from '@peanut/pod-sdk';
import type { RuntimeFacade, ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import type { PluginTaskApi } from '../../kernel/src/shared/plugin-task-api.js';
import type { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';
import type { EditorMcpTextWriteFailure } from '../src/editor-mcp-text-write-failure.js';
import type { McpFailurePresenter } from '../../kernel/src/mcp/mcp-failure-presenter.js';
import type { McpCapabilityRegistry } from '../../kernel/src/mcp/mcp-capability-registry.js';
import type { PluginDiagnosticReporter } from '../../kernel/src/diagnostics/plugin-diagnostic-reporter.js';

/**
 * @description 来自冻结 N9 实际 receipt 的完整公开失败，独立于本测试产生的输出。
 */
const LEGACY = Object.freeze({ schemaVersion: 1, code: 'text_file_io_content_conflict',
    category: 'execution_failed', reason: 'The operation failed without a safely confirmed final project state.',
    retryable: false, state: 'unknown', recommendedAction: 'stop' });

/**
 * @description 实际 Host 独立程序集的有限测试入口；不重写 Runtime 或 Kernel 算法。
 */
interface IHostAssembly {
    /**
     * @description 此 Host 程序集中实际打包的 Runtime 类。
     */
    runtimeClass: typeof ExecutionRuntimeService;
    /**
     * @description 此 VM 的实际 Error 构造器。
     */
    errorCtor: typeof Error;
    /**
     * @description 实际 Presenter、Registry 和 Reporter。
     */
    presenter: typeof McpFailurePresenter;
    /**
     * @description 实际能力注册表。
     */
    registry: typeof McpCapabilityRegistry;
    /**
     * @description 实际日志报告器。
     */
    reporter: typeof PluginDiagnosticReporter;
    /**
     * @description 装配实际 RuntimeFacade 和 PluginTaskApi，只配置隔离项目的外部工程服务。
     * @param project 隔离项目。
     * @returns 实际产品实例。
     */
    create(project: string): Promise<{ runtime: RuntimeFacade; api: PluginTaskApi }>;
    /**
     * @description 在真实 Host VM 内解析已由固定 fixture 自有数据编码的 JSON；不传递外层对象原型。
     * @param encoded 固定请求的纯 JSON 字符串，反例 getter/proxy 在受理后才由原测试注入。
     * @returns Host VM 原生普通对象，交原 Runtime 与 Guard 核验。
     */
    decodeFixtureRequest(encoded: string): Readonly<ITaskRequest>;
}

/**
 * @description 独立 Core 程序集的有限入口；正例使用实际 Gateway Guard 路径。
 */
interface ICoreAssembly {
    /**
     * @description 此 Core 程序集中实际打包的另一个 Runtime 类。
     */
    runtimeClass: typeof ExecutionRuntimeService;
    /**
     * @description 此 VM 的实际 Error 构造器。
     */
    errorCtor: typeof Error;
    /**
     * @description 原冻结产品失败适配器。
     */
    failure: typeof EditorMcpTextWriteFailure;
    /**
     * @description 实际 Core executor；故障只注入 plan 外部回调边界。
     * @param project 隔离真实工程。
     * @param mode 精确外部故障变体。
     * @param replay 保留的原错误，用于重复消费负对照。
     * @returns 实际 ResourceOperationTaskExecutor。
     */
    create(project: string, mode: string, replay: unknown, prepareGate?: () => Promise<void>): ResourceOperationTaskExecutor;
}

/**
 * @description 分别打包 Host/Core 的实际产品模块，再在两个 VM 实例中加载；不共享私有 Runtime 类。
 */
class SplitAssembly {
    /**
     * @description 只缓存独立完整编译字节，每个测试仍创建新的 VM、ALS、WeakMap 和 Runtime。
     */
    private static _compiled: { host: string; core: string } | null = null;
    /**
     * @description 原 Host 的实际模块入口。
     */
    public readonly host: IHostAssembly;
    /**
     * @description 原 Core 的实际模块入口。
     */
    public readonly core: ICoreAssembly;

    /**
     * @description 构建两个真正独立 bundle；完整字节只保存到随后精确登记的私有证据目录。
     * @param context 测试生命周期。
     * @param distinctError 是否使用两个 VM 自带且不共享的 Error 构造器。
     */
    public constructor(context: TestContext, distinctError: boolean, coreAggregateErrorUnavailable = false) {
        const repo = resolve(dirname(new URL(import.meta.url).pathname), '../../../../..');
        const artifactRoot = process.env.PEANUT_SPLIT_BUNDLE_EVIDENCE_ROOT;
        assert.equal(artifactRoot, join(dirname(tmpdir()), 'split-bundle-assemblies'), 'artifact root must be explicitly owned');
        assert.ok(artifactRoot);
        fs.mkdirSync(artifactRoot, { recursive: true });
        if (SplitAssembly._compiled == null) {
            const modulePath = (path: string): string => JSON.stringify(join(repo, path));
            const hostEntry = `
                import type { ITaskRequest } from ${modulePath('packages/protocol/src/index.ts')};
                import { RuntimeFacade, ExecutionRuntimeService } from ${modulePath('packages/engine/modules/runtime/src/index.ts')};
                import { PluginTaskApi } from ${modulePath('packages/engine/modules/kernel/src/shared/plugin-task-api.ts')};
                import { McpCapabilityRegistry } from ${modulePath('packages/engine/modules/kernel/src/mcp/mcp-capability-registry.ts')};
                import { PluginDiagnosticReporter } from ${modulePath('packages/engine/modules/kernel/src/diagnostics/plugin-diagnostic-reporter.ts')};
                import { McpFailurePresenter } from ${modulePath('packages/engine/modules/kernel/src/mcp/mcp-failure-presenter.ts')};
                export const runtimeClass = ExecutionRuntimeService;
                export const errorCtor = Error;
                export const presenter = McpFailurePresenter;
                export const registry = McpCapabilityRegistry;
                export const reporter = PluginDiagnosticReporter;
                export function decodeFixtureRequest(encoded: string): Readonly<ITaskRequest> {
                    if (typeof encoded !== 'string') throw new Error('fixture_json_transport_string_required');
                    return JSON.parse(encoded);
                }
                export async function create(project: string) {
                    const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
                    await runtime.project.configure(project, 'split-bundle-fixture');
                    return { runtime, api: new PluginTaskApi('peanut.editor-mcp', runtime, project) };
                }
            `;
            const coreEntry = `
                import { ExecutionRuntimeService } from ${modulePath('packages/engine/modules/runtime/src/index.ts')};
                import { ResourceOperationTaskExecutor } from ${modulePath('packages/engine/modules/mcp/src/resource-operation-task-executor.ts')};
                import { EditorMcpTextWriteGateway } from ${modulePath('packages/engine/modules/mcp/src/editor-mcp-text-write-gateway.ts')};
                import { EditorMcpTextWriteFailure } from ${modulePath('packages/engine/modules/mcp/src/editor-mcp-text-write-failure.ts')};
                import { writeFileSync } from 'node:fs';
                import { join } from 'node:path';
                export const runtimeClass = ExecutionRuntimeService;
                export const errorCtor = Error;
                export const failure = EditorMcpTextWriteFailure;
                export function create(project: string, mode: string, replay: unknown, prepareGate?: () => Promise<void>) {
                    const gateway = new EditorMcpTextWriteGateway(async () => { throw new Error('unexpected_writer'); });
                    return new ResourceOperationTaskExecutor({
                        plan: async (operation, input) => {
                            await Promise.resolve();
                            if (mode === 'paused') { if (prepareGate == null) throw new Error('prepare_gate_missing'); await prepareGate(); }
                            if (mode === 'generic') throw new Error('text_file_io_content_conflict');
                            if (mode === 'mixed-real' && input.path === 'assets/b.txt') throw new Error('genuine_sibling_preparation_failed');
                            if (mode === 'spoof-native') throw Object.assign(Object.create(Error.prototype), { message: 'text_file_io_content_conflict' });
                            if (mode === 'replay') throw replay;
                            if (mode === 'after-write') {
                                writeFileSync(join(project, 'assets/a.txt'), 'actually changed');
                                throw Object.assign(new Error('text_file_io_content_conflict'), { projectState: 'may_have_changed' });
                            }
                            if (mode === 'lookalike') throw Object.assign(new Error('text_file_io_content_conflict'), {
                                projectState: 'unchanged', textWritePreparationRefusal: Object.freeze({ schemaVersion: 1,
                                    code: 'text_file_io_content_conflict', phase: 'prepare_before_writer', projectState: 'unchanged' }) });
                            const preparedTextWrite = gateway.prepare(project, input);
                            return { projectKey: project, operation, resourceKeys: ['path:' + input.path],
                                requiresProjectWriter: true, preparedTextWrite };
                        },
                        execute: async () => { throw new Error('unexpected_writer'); },
                    });
                }
            `;
            const aliases = Object.fromEntries(['runtime', 'assets', 'policy'].map((name) =>
                ['@peanut/pod-engine/' + name, join(repo, 'packages/engine/modules/' + name + '/src/index.ts')]));
            aliases['@peanut/pod-protocol'] = join(repo, 'packages/protocol/src/index.ts');
            const compile = (contents: string, name: string): string => {
                const result = buildSync({ stdin: { contents, resolveDir: repo, loader: 'ts', sourcefile: name + '.mts' },
                    absWorkingDir: repo, alias: aliases, bundle: true, platform: 'node', format: 'cjs', target: 'es2022', write: false });
                assert.equal(result.errors.length, 0);
                assert.ok(result.outputFiles);
                assert.equal(result.outputFiles.length, 1);
                const text = result.outputFiles[0]?.text;
                assert.equal(typeof text, 'string');
                assert.ok(text);
                fs.writeFileSync(join(artifactRoot, name + '.entry.mts'), contents);
                fs.writeFileSync(join(artifactRoot, name + '.cjs'), text);
                return text;
            };
            SplitAssembly._compiled = { host: compile(hostEntry, 'actual-independent-host'), core: compile(coreEntry, 'actual-independent-core') };
        }
        this.host = this._load(SplitAssembly._compiled.host, distinctError, (value): value is IHostAssembly =>
            this._record(value) && ['runtimeClass', 'errorCtor', 'presenter', 'registry', 'reporter', 'create', 'decodeFixtureRequest']
                .every((key) => typeof Reflect.get(value, key) === 'function'));
        this.core = this._load(SplitAssembly._compiled.core, distinctError, (value): value is ICoreAssembly =>
            this._record(value) && ['runtimeClass', 'errorCtor', 'failure', 'create']
                .every((key) => typeof Reflect.get(value, key) === 'function'), coreAggregateErrorUnavailable);
        assert.notEqual(this.host.runtimeClass, this.core.runtimeClass, 'independent actual Runtime classes required');
        assert.equal(this.host.errorCtor === this.core.errorCtor, !distinctError, 'real Error constructor topology required');
        if (distinctError) assert.notEqual(this.host.errorCtor, Error);
        context.diagnostic(distinctError ? 'two independently bundled VMs and distinct native Error brands' : 'two independently bundled VMs with explicitly shared global Error only');
    }

    /**
     * @description 仅检查受本测试固定入口生成的模块形状，不将任意外部 JSON 视为模块。
     * @param value 实际 VM module.exports。
     * @returns 是否对象。
     */
    private _record(value: unknown): value is object {
        return value != null && typeof value === 'object';
    }

    /**
     * @description 用真实 require 加载固定 Node 内置模块；仅执行新登记后实际打包的测试程序集。
     * @param code 独立完整产品 bundle 字节。
     * @param distinctError 是否保留此 VM 的原生 Error。
     * @param shape 固定入口形状检查。
     * @returns 已核实的实际模块。
     */
    private _load<T>(code: string, distinctError: boolean, shape: (value: unknown) => value is T, aggregateErrorUnavailable = false): T {
        const module = { exports: {} as unknown };
        const sandbox = createContext({ module, exports: module.exports, require: createRequire(import.meta.url),
            process, console, Buffer, AbortController, AbortSignal, setTimeout, clearTimeout, setInterval,
            clearInterval, setImmediate, clearImmediate, TextDecoder, TextEncoder,
            ...(distinctError ? {} : { Error, AggregateError }),
            ...(aggregateErrorUnavailable ? { AggregateError: undefined } : {}) });
        if (aggregateErrorUnavailable) assert.equal(new Script('typeof AggregateError').runInContext(sandbox), 'undefined');
        new Script(code, { filename: 'actual-independent-bundle.cjs' }).runInContext(sandbox);
        assert.ok(shape(module.exports));
        return module.exports;
    }
}

/**
 * @description 顺序等待本 fixture 自有清理步骤；某步骤失败仍尝试后续步骤，保存所有原清理错误。
 * @param steps 固定 fixture 的释放屏障、撤销、deactivate、execution.dispose 和物理根清理。
 * @returns 所有步骤已尝试；清理错误由独立 after hook 报告，不捕获或替换原业务断言。
 */
async function settleFixtureCleanup(steps: readonly (() => void | Promise<void>)[]): Promise<void> {
    const failures: unknown[] = [];
    try {
        for (const step of steps) {
            try { await step(); }
            catch (error: unknown) { failures.push(error); }
        }
    } finally {
        if (failures.length > 0) {
            const failure = new Error('split_bundle_fixture_cleanup_failed');
            Object.defineProperty(failure, 'errors', { value: Object.freeze([...failures]),
                enumerable: false, writable: false, configurable: false });
            throw failure;
        }
    }
}

/**
 * @description 实际 Host API、Core executor 和物理文件闭环；只注入明确外部反例，不复制证明算法。
 */
class SplitTaskFixture {
    /**
     * @description 当前测试独占临时根。
     */
    public readonly container = fs.mkdtempSync(join(tmpdir(), 'split-bundle-task-'));
    /**
     * @description 唯一项目根。
     */
    public readonly project = join(this.container, 'project');
    /**
     * @description 原 Error 引用，不能从输出 DTO 重建。
     */
    public lastOriginalError: unknown = null;
    /**
     * @description getter/proxy/callback 是否被调用。
     */
    public trapCalls = 0;
    /**
     * @description 实际原 Host 上下文，供后续任务重用负对照。
     */
    public savedContext: IPluginTaskExecutorContext | null = null;
    /**
     * @description 原序号。
     */
    private _sequence = 0;
    /**
     * @description 实际产品实例；创建后由测试生命周期释放。
     */
    private _host: { runtime: RuntimeFacade; api: PluginTaskApi } | null = null;
    /**
     * @description 当前注册的撤销函数。
     */
    private _revoke: (() => void) | null = null;
    /**
     * @description 取消反例的明确原 plan 已开始屏障。
     */
    private _planStarted: Promise<void> | null = null;
    /**
     * @description 无论断言结果如何都释放本测试自己的等待。
     */
    private _resumePlan: (() => void) | null = null;

    /**
     * @description 创建合成物理文件；所有写入只位于私有 fixture。
     * @param context 测试清理生命周期。
     * @param assembly 真正独立产品程序集。
     */
    public constructor(private readonly _context: TestContext, public readonly assembly: SplitAssembly) {
        fs.mkdirSync(join(this.project, 'assets'), { recursive: true });
        fs.writeFileSync(join(this.project, 'assets/a.txt'), 'original');
        fs.writeFileSync(join(this.project, 'assets/b.txt'), 'sibling original');
        this._context.after(async () => {
            await settleFixtureCleanup([
                () => { this._resumePlan?.(); },
                () => { this._revoke?.(); },
                async () => { await this._host?.api.deactivate(); },
                () => { this._host?.runtime.execution.dispose(); },
                () => { fs.rmSync(this.container, { recursive: true, force: true }); },
            ]);
        });
    }

    /**
     * @description 使用真实 Host Kernel managed executor 装配；反例只包裹实际外部调用。
     * @param mode 精确计划或上下文反例。
     * @returns 初始化完成。
     */
    public async start(mode: string): Promise<void> {
        this._host ??= await this.assembly.host.create(this.project);
        this._revoke?.();
        const coreMode = ['generic', 'lookalike', 'after-write', 'spoof-native', 'replay', 'mixed-real', 'paused'].includes(mode) ? mode : 'normal';
        let markStarted: (() => void) | null = null;
        if (mode === 'paused') this._planStarted = new Promise<void>((resolveStarted) => { markStarted = resolveStarted; });
        const gate = mode !== 'paused' ? undefined : async (): Promise<void> => {
            markStarted?.();
            await new Promise<void>((resume) => { this._resumePlan = resume; });
        };
        const core = this.assembly.core.create(this.project, coreMode, this.lastOriginalError, gate);
        const apply = (request: Readonly<ITaskRequest>, original: IPluginTaskExecutorContext): IPluginTaskExecutorContext => {
            let context = original;
            if (mode === 'foreign-signal') context = { ...original, signal: new AbortController().signal };
            if (mode === 'borrowed-context') { assert.ok(this.savedContext); context = this.savedContext; }
            this.savedContext ??= original;
            if (mode === 'counterfeit-port') context = { ...original, prepareTextWrite: () => { throw new this.assembly.core.errorCtor('text_file_io_content_conflict'); } };
            if (mode === 'getter-port') {
                context = { ...original };
                Object.defineProperty(context, 'prepareTextWrite', { get: () => { this.trapCalls += 1; return original.prepareTextWrite; } });
            }
            if (mode === 'proxy-context') context = new Proxy(original, { get: (target, key) => { this.trapCalls += 1; return Reflect.get(target, key); } });
            if (mode === 'changed-request') Object.defineProperty(request, 'requestId', { value: 'changed-after-host-bind', configurable: true });
            if (mode === 'changed-input') {
                const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
                assert.ok(payload != null && typeof payload === 'object');
                const input: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
                assert.ok(input != null && typeof input === 'object');
                Object.defineProperty(input, 'content', { value: 'changed-after-host-bind', configurable: true });
            }
            if (mode === 'changed-public-resources') {
                const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
                assert.ok(payload != null && typeof payload === 'object');
                const input: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
                assert.ok(input != null && typeof input === 'object');
                const resources: unknown = Object.getOwnPropertyDescriptor(input, 'resources')?.value;
                assert.ok(Array.isArray(resources));
                resources[0] = 'assets/changed-after-host-bind.txt';
            }
            if (mode === 'input-getter' || mode === 'input-proxy') {
                const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
                assert.ok(payload != null && typeof payload === 'object');
                const input: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
                assert.ok(input != null && typeof input === 'object');
                if (mode === 'input-getter') Object.defineProperty(input, 'content', {
                    get: () => { this.trapCalls += 1; return 'unexpected accessor'; }, configurable: true,
                });
                else Object.defineProperty(payload, 'input', { value: new Proxy(input, {
                    get: (target, key) => { this.trapCalls += 1; return Reflect.get(target, key); },
                }), configurable: true });
            }
            if (mode === 'commit-before-guard') assert.equal(context.enterCommitWindow(), true);
            if (mode === 'callback-to-port') {
                assert.ok(context.prepareTextWrite);
                Reflect.apply(context.prepareTextWrite, undefined, [() => { this.trapCalls += 1; return []; }, this.project, {}, {}, context.signal]);
            }
            return context;
        };
        const run = async (request: Readonly<ITaskRequest>, context: IPluginTaskExecutorContext): Promise<unknown> => {
            const provided = apply(request, context);
            try { return await core.execute(mode === 'copied-request' ? { ...request } : request, provided); }
            catch (error: unknown) {
                this.lastOriginalError = error;
                if (mode === 'error-state') Object.assign(Object(error), { projectState: 'may_have_changed' });
                if (mode === 'task-failures') Object.assign(Object(error), { taskFailures: [] });
                if (mode === 'error-input-mutation') {
                    const payload: unknown = Object.getOwnPropertyDescriptor(request, 'payload')?.value;
                    assert.ok(payload != null && typeof payload === 'object');
                    const input: unknown = Object.getOwnPropertyDescriptor(payload, 'input')?.value;
                    assert.ok(input != null && typeof input === 'object');
                    Object.defineProperty(input, 'content', { value: 'after-proof', configurable: true });
                }
                throw error;
            }
        };
        this._revoke = this._host.api.managed.registerExecutor('editor-mcp.resource-operation', run, {
            concurrency: 'executor_managed', executeBatch: async (requests, contexts, batchId) => {
                return core.executeBatch(requests, contexts.map((context, index) => {
                    const request = requests[index]; assert.ok(request); return apply(request, context);
                }), batchId);
            },
        });
    }

    /**
     * @description 创建真实受理输入，不推测 Runtime taskId。
     * @param path 指定 a 或 b。
     * @param conflict 是否与真实物理摘要冲突。
     * @param group 是否进入真实批组。
     * @returns 原明确请求。
     */
    public request(path = 'a', conflict = true, group = false) {
        const wire = { requestId: 'split-' + (++this._sequence), kind: 'editor-mcp.resource-operation', scope: 'project',
            priority: 'normal', mergePolicy: group ? 'batch_commit' : 'none',
            payload: { operation: 'asset.writeText', input: { path: 'assets/' + path + '.txt', content: 'new',
                ...(conflict ? { expectedSha256: '0'.repeat(64) } : {}) } } } as const;
        return this.assembly.host.decodeFixtureRequest(JSON.stringify(wire));
    }

    /**
     * @description 经实际 Host enqueue/wait 得到原失败任务。
     * @returns 实际终态。
     */
    public async single(publicShape?: 'single' | 'files'): Promise<ITaskResult> {
        assert.ok(this._host);
        let request = this.request();
        if (publicShape != null) {
            const wire = JSON.parse(JSON.stringify(request));
            wire.payload.input.resources = ['assets/a.txt'];
            wire.payload.input.approvalToken = 'fixture-original-public-control-token';
            wire.payload.input.confirmDestructive = false;
            if (publicShape === 'files') {
                wire.payload.input.files = [{ path: wire.payload.input.path, content: wire.payload.input.content,
                    expectedSha256: wire.payload.input.expectedSha256 }];
                delete wire.payload.input.path;
                delete wire.payload.input.content;
                delete wire.payload.input.expectedSha256;
            }
            request = this.assembly.host.decodeFixtureRequest(JSON.stringify(wire));
        }
        const receipt = await this._host.api.managed.enqueue(request);
        const result = await this._host.api.managed.wait(receipt.taskId);
        assert.ok(result); return result;
    }

    /**
     * @description 真正受理两个不同输入的批组，验证来源仅属于原任务。
     * @param bothConflict 是否两个真实 Guard 都冲突。
     * @returns 实际逐任务终态。
     */
    public async group(bothConflict: boolean): Promise<readonly ITaskResult[]> {
        assert.ok(this._host);
        const receipt = await this._host.api.managed.enqueueBatch([this.request('a', true, true), this.request('b', bothConflict, true)]);
        return Promise.all(receipt.receipts.map(async (item) => {
            const result = await this._host?.api.managed.wait(item.taskId); assert.ok(result); return result;
        }));
    }

    /**
     * @description 经实际取消控制面停止原受理任务；不伪造 signal 或终态。
     * @returns 实际取消结果。
     */
    public async cancelled(): Promise<ITaskResult> {
        assert.ok(this._host);
        const receipt = await this._host.api.managed.enqueue(this.request());
        assert.ok(this._planStarted);
        await Promise.race([this._planStarted, this._host.api.managed.wait(receipt.taskId).then(() => {
            throw new Error('task_ended_before_actual_prepare_barrier');
        })]);
        await this._host.api.cancel(receipt.taskId);
        this._resumePlan?.();
        const result = await this._host.api.managed.wait(receipt.taskId); assert.ok(result); return result;
    }

    /**
     * @description 验证真实跨包失败适配、Host Registry/Reporter 和 Host Presenter 完整公开字段。
     * @param result 原 Runtime 结果。
     * @param safe 是否唯一真实无写入准备拒绝。
     * @returns 所有真实断言完成。
     */
    public async publicFailure(result: ITaskResult, safe: boolean): Promise<void> {
        assert.equal(result.ok, false); assert.equal(result.status, 'failed');
        const marker = result.data != null && typeof result.data === 'object' ? Reflect.get(result.data, 'textWritePreparationRefusal') : undefined;
        assert.equal(marker != null, safe);
        const error = this.assembly.core.failure.fromTaskResult(result, result.taskId, result.error?.code ?? 'missing');
        const reporter = new this.assembly.host.reporter();
        const registry = new this.assembly.host.registry((pluginId, failure) => reporter.record({ pluginId, source: 'mcp_capability', error: failure }));
        registry.register('peanut.editor-mcp', { name: 'peanut.editor-mcp.split-fixture', description: 'Isolated split fixture',
            category: 'cocos', risk: 'write', readOnly: false, inputSchema: { type: 'object' } }, async () => { throw error; });
        registry.setPluginExposure('peanut.editor-mcp', 'all');
        const original = console.error; const calls: unknown[][] = []; console.error = (...args) => { calls.push(args); };
        try {
            await assert.rejects(registry.invoke('peanut.editor-mcp.split-fixture', {}, { connectionId: 'a'.repeat(32) }),
                (observed: unknown) => { assert.equal(observed, error); return true; });
            assert.equal(calls.length, safe ? 0 : 1); assert.equal(reporter.list().length, safe ? 0 : 1);
            const dto = this.assembly.host.presenter.present(error);
            if (safe) assert.deepEqual(JSON.parse(JSON.stringify(dto)), LEGACY, 'complete frozen legacy DTO across real native Error VM');
            else { assert.equal(dto.category, 'execution_failed'); assert.equal(dto.state, 'unknown'); }
            this._context.diagnostic(JSON.stringify({ taskId: result.taskId, status: result.status, safe,
                hostNativeError: nodeTypes.isNativeError(this.lastOriginalError), noFabricatedSuccess: true }));
        } finally { console.error = original; }
    }
}

for (const distinct of [false, true]) {
    test('actual independent Host/Core Guard refusal keeps full legacy DTO: ' + (distinct ? 'distinct native VM Errors' : 'shared global Error'), async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, distinct));
        await fixture.start('normal'); const result = await fixture.single();
        assert.ok(nodeTypes.isNativeError(fixture.lastOriginalError));
        assert.equal(fixture.lastOriginalError instanceof fixture.assembly.core.errorCtor, !distinct);
        await fixture.publicFailure(result, true);
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
    });
}

for (const mode of ['generic', 'lookalike', 'spoof-native', 'counterfeit-port', 'getter-port', 'proxy-context',
    'foreign-signal', 'changed-request', 'changed-input', 'input-getter', 'input-proxy', 'copied-request', 'callback-to-port', 'commit-before-guard',
    'error-state', 'task-failures', 'error-input-mutation', 'after-write']) {
    test('actual distinct VM original task refuses false safe provenance: ' + mode, async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, true));
        await fixture.start(mode); const result = await fixture.single(); await fixture.publicFailure(result, false);
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), mode === 'after-write' ? 'actually changed' : 'original');
        if (['getter-port', 'proxy-context', 'callback-to-port', 'input-getter', 'input-proxy'].includes(mode)) assert.equal(fixture.trapCalls, 0);
    });
}

test('actual mixed group with an origin Guard conflict and a genuine sibling error never inherits safe refusal', async (context) => {
    const fixture = new SplitTaskFixture(context, new SplitAssembly(context, true));
    await fixture.start('mixed-real'); const results = await fixture.group(false);
    for (const result of results) await fixture.publicFailure(result, false);
    assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(join(fixture.project, 'assets/b.txt'), 'utf8'), 'sibling original');
});

test('actual cancellation terminates accepted task without a safe preparation proof', async (context) => {
    const fixture = new SplitTaskFixture(context, new SplitAssembly(context, true));
    await fixture.start('paused'); const result = await fixture.cancelled();
    assert.equal(result.status, 'cancelled');
    assert.equal(result.data != null && typeof result.data === 'object' ? Reflect.get(result.data, 'textWritePreparationRefusal') : undefined, undefined);
    assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
});

for (const mode of ['replay', 'borrowed-context']) {
    test('actual consumed Error or Host context cannot bless next request: ' + mode, async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, true));
        await fixture.start('normal'); await fixture.publicFailure(await fixture.single(), true);
        await fixture.start(mode); await fixture.publicFailure(await fixture.single(), false);
    });
}

for (const bothConflict of [false, true]) {
    test('actual independent multi-request group origin remains isolated: ' + (bothConflict ? 'two real Guard failures' : 'one origin and unchanged sibling'), async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, true));
        await fixture.start('normal'); const results = await fixture.group(bothConflict); assert.equal(results.length, 2);
        for (const [index, result] of results.entries()) await fixture.publicFailure(result, !bothConflict && index === 0);
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/b.txt'), 'utf8'), 'sibling original');
    });
}

test('actual public Presenter rejects native message accessor and prototype spoof without trusting either', (context) => {
    const assembly = new SplitAssembly(context, true);
    let calls = 0;
    const native = new assembly.core.errorCtor();
    Object.defineProperty(native, 'message', { get: () => { calls += 1; return 'text_file_io_content_conflict'; } });
    const spoof = Object.assign(Object.create(assembly.core.errorCtor.prototype), { message: 'text_file_io_content_conflict' });
    for (const value of [native, spoof]) assert.equal(assembly.host.presenter.present(value).code, 'mcp_capability_execution_failed');
    assert.equal(calls, 0);
    assert.equal(assembly.host.presenter.present('text_file_io_content_conflict').code, LEGACY.code, 'primitive-string compatibility');
});

test('native Proxy is rejected only by actual _safeCode extraction; embedded-failure traversal remains separately scoped', (context) => {
    const assembly = new SplitAssembly(context, true);
    let traps = 0;
    const error = new Proxy(new assembly.core.errorCtor('text_file_io_content_conflict'), {
        get: () => { traps += 1; return undefined; }, getOwnPropertyDescriptor: () => { traps += 1; return undefined; },
    });
    const actual: unknown = Reflect.get(assembly.host.presenter, '_safeCode'); assert.equal(typeof actual, 'function');
    assert.ok(typeof actual === 'function');
    assert.equal(Reflect.apply(actual, assembly.host.presenter, [error]), 'mcp_capability_execution_failed'); assert.equal(traps, 0);
    context.diagnostic('This assertion covers the actual extractor only; it does not promise entire Presenter Proxy/getter hardening.');
});

/**
 * @description 新反例仅在实际外部 plan 回调边界观察原异常；不复制 Runtime、Guard 或批组算法。
 * @param context 当前测试生命周期。
 * @param distinct Host/Core 是否保留不同 VM 原生 Error。
 * @param mode 两个真实 Host Guard 错误或 Host Guard 与实际 Core 普通错误。
 */
async function verifyNoAggregateErrorMultipleFailures(context: TestContext, distinct: boolean, mode: 'normal' | 'mixed-real'): Promise<void> {
    const assembly = new SplitAssembly(context, distinct, true);
    const container = fs.mkdtempSync(join(tmpdir(), 'no-aggregate-error-'));
    const project = join(container, 'project');
    fs.mkdirSync(join(project, 'assets'), { recursive: true });
    fs.writeFileSync(join(project, 'assets/a.txt'), 'original');
    fs.writeFileSync(join(project, 'assets/b.txt'), 'sibling original');
    const host = await assembly.host.create(project);
    let releaseSecond!: () => void;
    const secondBarrier = new Promise<void>((resolveBarrier) => { releaseSecond = resolveBarrier; });
    let firstFailed!: () => void;
    const firstFailure = new Promise<void>((resolveFirst) => { firstFailed = resolveFirst; });
    let secondStarted!: () => void;
    const secondStart = new Promise<void>((resolveSecond) => { secondStarted = resolveSecond; });
    let revoke: (() => void) | undefined;
    context.after(async () => {
        await settleFixtureCleanup([
            () => { releaseSecond(); },
            () => { revoke?.(); },
            async () => { await host.api.deactivate(); },
            () => { host.runtime.execution.dispose(); },
            () => { fs.rmSync(container, { recursive: true, force: true }); },
        ]);
    });
    const core = assembly.core.create(project, mode, null);
    const options: unknown = Reflect.get(core, '_options');
    assert.ok(options != null && typeof options === 'object', 'actual Core option boundary exists');
    const originalPlan: unknown = Reflect.get(options, 'plan');
    assert.equal(typeof originalPlan, 'function');
    assert.ok(typeof originalPlan === 'function');
    const originals: unknown[] = new Array(2);
    const settled = [false, false];
    let batchFailure: unknown = null;
    let completionBeforeRelease = false;
    let released = false;
    // Forward the exact actual callback and original request input. The second request stays pending.
    assert.equal(Reflect.set(options, 'plan', async (operation: string, input: Readonly<Record<string, unknown>>) => {
        const index = input.path === 'assets/a.txt' ? 0 : input.path === 'assets/b.txt' ? 1 : -1;
        assert.notEqual(index, -1, 'only the two actual accepted inputs reach this callback');
        if (index === 1) { secondStarted(); await secondBarrier; }
        try { return await Reflect.apply(originalPlan, options, [operation, input]); }
        catch (error: unknown) {
            originals[index] = error; settled[index] = true;
            if (index === 0) firstFailed();
            throw error;
        }
    }), true);
    revoke = host.api.managed.registerExecutor('editor-mcp.resource-operation', (request, taskContext) => core.execute(request, taskContext), {
        concurrency: 'executor_managed',
        executeBatch: async (requests, contexts, batchId) => {
            try { return await core.executeBatch(requests, contexts, batchId); }
            catch (error: unknown) {
                batchFailure = error; completionBeforeRelease = !released;
                assert.deepEqual(settled, [true, true], 'actual allSettled drain precedes the batch outcome');
                throw error;
            }
        },
    });
    const requests = ['a', 'b'].map((name) => assembly.host.decodeFixtureRequest(JSON.stringify({ requestId: 'no-aggregate-' + name,
        kind: 'editor-mcp.resource-operation', scope: 'project', priority: 'normal', mergePolicy: 'batch_commit',
        payload: { operation: 'asset.writeText', input: { path: 'assets/' + name + '.txt', content: 'new', expectedSha256: '0'.repeat(64) } } } as const)));
    const receipt = await host.api.managed.enqueueBatch(requests);
    assert.equal(receipt.receipts.length, 2);
    const resultsPromise = Promise.all(receipt.receipts.map(async (item) => {
        const result = await host.api.managed.wait(item.taskId); assert.ok(result); return result;
    }));
    let barrierTimer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([Promise.all([firstFailure, secondStart]), new Promise<never>((_, reject) => {
            barrierTimer = setTimeout(() => reject(new Error('no_AggregateError_fixture_barrier_not_reached')), 3000);
        })]);
    } finally { if (barrierTimer != null) clearTimeout(barrierTimer); }
    await new Promise<void>((resolveTick) => setImmediate(resolveTick));
    assert.deepEqual(settled, [true, false], 'second actual plan remains pending');
    assert.equal(batchFailure, null, 'first error must not escape while a sibling plan remains pending');
    released = true; releaseSecond();
    const results = await resultsPromise;
    assert.equal(completionBeforeRelease, false);
    assert.deepEqual(settled, [true, true]);
    assert.ok(nodeTypes.isNativeError(originals[0]));
    assert.ok(originals[0] instanceof assembly.host.errorCtor, 'first is the original actual Host Guard Error');
    assert.ok(nodeTypes.isNativeError(originals[1]));
    assert.ok(originals[1] instanceof (mode === 'normal' ? assembly.host.errorCtor : assembly.core.errorCtor),
        'second is the original actual Host Guard or actual Core callback Error');
    assert.notEqual(originals[0], originals[1]);
    assert.equal(Object.getOwnPropertyDescriptor(originals[0], 'message')?.value, 'text_file_io_content_conflict');
    assert.equal(Object.getOwnPropertyDescriptor(originals[1], 'message')?.value,
        mode === 'normal' ? 'text_file_io_content_conflict' : 'genuine_sibling_preparation_failed');
    assert.ok(batchFailure != null && typeof batchFailure === 'object');
    assert.ok(nodeTypes.isNativeError(batchFailure));
    assert.equal(fs.readFileSync(join(project, 'assets/a.txt'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(join(project, 'assets/b.txt'), 'utf8'), 'sibling original');
    const message: unknown = Object.getOwnPropertyDescriptor(batchFailure, 'message')?.value;
    const topology = distinct ? 'distinct' : 'shared';
    const readiness = { schemaVersion: 1, kind: 'no_AggregateError_actual_multiple_failure_ready', topology, mode,
        originalCount: originals.length, twoOriginalNativeErrors: originals.every((error) => nodeTypes.isNativeError(error)),
        originalMessages: originals.map((error) => error != null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message')?.value : null),
        actualHostFirstError: originals[0] instanceof assembly.host.errorCtor,
        actualSecondError: originals[1] instanceof (mode === 'normal' ? assembly.host.errorCtor : assembly.core.errorCtor),
        allOriginalsSettled: settled.every(Boolean), firstOutcomeHeldForSecond: !completionBeforeRelease,
        coreGlobalAggregateErrorUndefined: true, bothPhysicalInputsUnchanged: true, carrierMessage: message };
    const artifactRoot = process.env.PEANUT_SPLIT_BUNDLE_EVIDENCE_ROOT; assert.ok(artifactRoot);
    fs.writeFileSync(join(artifactRoot, 'no-AggregateError-readiness-' + topology + '-' + mode + '.json'), JSON.stringify(readiness, null, 2) + '\n');
    context.diagnostic(JSON.stringify(readiness));
    assert.equal(message, 'editor_mcp_batch_preparation_multiple_failures', 'N21_NO_AGGREGATE_ERROR_REQUIRED_MULTIPLE_FAILURE_CARRIER');
    assert.equal(Object.getOwnPropertyDescriptor(batchFailure, 'projectState')?.value, 'may_have_changed');
    const errors = Object.getOwnPropertyDescriptor(batchFailure, 'errors');
    assert.ok(errors && 'value' in errors && Array.isArray(errors.value));
    assert.equal(errors.enumerable, false); assert.equal(errors.writable, false); assert.equal(errors.configurable, false);
    assert.equal(Object.isFrozen(errors.value), true);
    assert.equal(errors.value.length, 2);
    assert.equal(errors.value[0], originals[0]); assert.equal(errors.value[1], originals[1]);
    assert.equal(Reflect.set(batchFailure, 'errors', []), false);
    assert.equal(Reflect.deleteProperty(batchFailure, 'errors'), false);
    assert.equal(Reflect.set(errors.value, '0', new Error('replacement')), false);
    assert.equal(errors.value[0], originals[0]); assert.equal(errors.value[1], originals[1]);
    const expectedCode = distinct ? 'unknown_execution_error' : 'editor_mcp_batch_preparation_multiple_failures';
    for (const result of results) {
        assert.equal(result.ok, false); assert.equal(result.status, 'failed');
        assert.ok(result.error); assert.ok(result.data);
        assert.deepEqual(Reflect.ownKeys(result.error).sort(), ['code', 'message']);
        assert.deepEqual(Reflect.ownKeys(result.data).sort(), ['projectState']);
        assert.deepEqual(JSON.parse(JSON.stringify(result.error)), { code: expectedCode, message: expectedCode });
        assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { projectState: 'may_have_changed' });
        assert.equal(Array.isArray(result.changes), true); assert.equal(result.changes.length, 0);
        const publicError = assembly.core.failure.fromTaskResult(result, result.taskId, expectedCode);
        assert.equal(Object.getOwnPropertyDescriptor(publicError, 'isMcpControlFlowRefusal'), undefined);
        assert.deepEqual(JSON.parse(JSON.stringify(assembly.host.presenter.present(publicError))), { ...LEGACY, code: expectedCode },
            'full original conservative public DTO; distinct VM legacy unknown code remains unchanged');
        const reporter = new assembly.host.reporter();
        const registry = new assembly.host.registry((pluginId, failure) => reporter.record({ pluginId, source: 'mcp_capability', error: failure }));
        registry.register('peanut.editor-mcp', { name: 'peanut.editor-mcp.no-aggregate', description: 'Actual multi failure fixture',
            category: 'cocos', risk: 'write', readOnly: false, inputSchema: { type: 'object' } }, async () => { throw publicError; });
        registry.setPluginExposure('peanut.editor-mcp', 'all');
        const priorConsoleError = console.error; const calls: unknown[][] = []; console.error = (...args) => { calls.push(args); };
        try {
            await assert.rejects(registry.invoke('peanut.editor-mcp.no-aggregate', {}, { connectionId: 'b'.repeat(32) }),
                (observed: unknown) => { assert.equal(observed, publicError); return true; });
            assert.equal(calls.length, 1, 'real multiple failure must still be logged');
            assert.equal(reporter.list().length, 1, 'real multiple failure never becomes a safe refusal');
        } finally { console.error = priorConsoleError; }
    }
}

for (const distinct of [false, true]) {
    for (const mode of ['normal', 'mixed-real'] as const) {
        test('N21 no AggregateError multiple failures: ' + (distinct ? 'distinct' : 'shared') + ' ' + mode, async (context) => {
            await verifyNoAggregateErrorMultipleFailures(context, distinct, mode);
        });
    }
    test('N21 no AggregateError single original Host Guard refusal: ' + (distinct ? 'distinct' : 'shared'), async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, distinct, true));
        await fixture.start('normal'); const result = await fixture.single();
        assert.ok(nodeTypes.isNativeError(fixture.lastOriginalError));
        assert.ok(fixture.lastOriginalError instanceof fixture.assembly.host.errorCtor);
        assert.equal(Object.getOwnPropertyDescriptor(fixture.lastOriginalError, 'errors'), undefined);
        await fixture.publicFailure(result, true);
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
    });
}

for (const distinct of [false, true]) {
    for (const shape of ['single', 'files'] as const) {
        test('actual public resources array remains bound through Host Guard: ' + shape + '/' + (distinct ? 'distinct' : 'shared'), async (context) => {
            const fixture = new SplitTaskFixture(context, new SplitAssembly(context, distinct));
            await fixture.start('normal');
            const result = await fixture.single(shape);
            assert.equal(result.error?.code, 'text_file_io_content_conflict', 'real Guard must receive legal public controls');
            assert.ok(nodeTypes.isNativeError(fixture.lastOriginalError), 'original real Host Guard Error exists');
            await fixture.publicFailure(result, true);
            assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
        });
    }
}

for (const distinct of [false, true]) {
    test('actual nested public resource mutation never retains safe proof: ' + (distinct ? 'distinct' : 'shared'), async (context) => {
        const fixture = new SplitTaskFixture(context, new SplitAssembly(context, distinct));
        await fixture.start('changed-public-resources');
        const result = await fixture.single('single');
        await fixture.publicFailure(result, false);
        assert.equal(fs.readFileSync(join(fixture.project, 'assets/a.txt'), 'utf8'), 'original');
    });
}
