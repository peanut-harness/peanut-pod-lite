import { EditorMcpAssetDbTransaction } from '../src/editor-mcp-asset-db-transaction.js';
import { TimeoutAndCancelController } from '../../runtime/src/execution/timeout/timeout-and-cancel-controller.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { IGrantedRuntimeClientSet } from '@peanut/pod-sdk';
import { ResourceLockManager } from '@peanut/pod-engine/runtime';
import { TextFileIoGuard, type IAssetCatalogFastLookup } from '@peanut/pod-engine/assets';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { TextFileWriteResultProjection } from '@peanut/pod-protocol';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import type { EditorMcpLumenGateway } from '../src/editor-mcp-lumen-gateway.js';
import { ResourceOperationTaskExecutor } from '../src/resource-operation-task-executor.js';
import { EditorMcpTextWriteOutcome } from '../src/editor-mcp-text-write-outcome.js';
import { EditorMcpTextWriteSession } from '../src/editor-mcp-text-write-session.js';

/**
 * @description 对完整隔离工程进行目录、链接和原始字节摘要。
 * @param root 当前测试专用工程。
 * @returns 有序快照。
 */
function inventory(root: string): readonly string[] {
    const result: string[] = [];
    const walk = (directory: string): void => {
        for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, item.name);
            if (item.isDirectory()) {
                result.push('dir:' + relative(root, path));
                walk(path);
            } else if (item.isSymbolicLink()) {
                result.push('link:' + relative(root, path) + ':' + fs.readlinkSync(path));
            } else {
                result.push(relative(root, path) + ':' + createHash('sha256').update(fs.readFileSync(path)).digest('hex'));
            }
        }
    };
    walk(root);
    return result;
}

/**
 * @description 实际 Router、原联合锁和原 AssetDB 事务的离线隔离宿主。
 */
class OfflineTextHost {
    /**
     * @description 仅本测试拥有的顶层目录。
     */
    public readonly container = fs.mkdtempSync(join(tmpdir(), 'pod-text-outcome-'));
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
    public hook: (stage: string, phase: 'before' | 'after', path: string) => void | Promise<void> = () => {};
    /**
     * @description 最后统一 refresh 中的外部修改。
     */
    public refreshAction: () => void = () => {};
    /**
     * @description 刷新阶段实际返回的离线故障数据。
     */
    public refreshResult: Record<string, unknown> = { settled: true };
    /**
     * @description 收集实际 AssetDB 调用。
     */
    public readonly calls: string[] = [];
    /**
     * @description 生成有效独立 UUID。
     */
    private _sequence = 0;

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
                await this.hook(stage, 'before', url);
                let result: unknown = null;
                if (stage === 'query-ready') {
                    result = true;
                } else if (stage === 'query-asset-info') {
                    const file = join(this.project, url.slice('db://'.length));
                    if (fs.existsSync(file) && fs.lstatSync(file).isDirectory() && fs.existsSync(file + '.meta')) {
                        result = JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
                    } else {
                        const uuid = this.registrations.get(url);
                        const meta = uuid == null ? null : JSON.parse(fs.readFileSync(file + '.meta', 'utf8'));
                        result = uuid == null ? null : { uuid, importer: meta.importer, imported: true, invalid: false, subAssets: {} };
                    }
                } else if (stage === 'create-asset') {
                    const file = join(this.project, url.slice('db://'.length));
                    assert.equal(fs.existsSync(file), false);
                    fs.mkdirSync(dirname(file), { recursive: true });
                    fs.writeFileSync(file, String(content));
                    this._sequence += 1;
                    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-' + this._sequence.toString(16).padStart(12, '0');
                    fs.writeFileSync(file + '.meta', JSON.stringify({ uuid, importer: 'text' }));
                    this.registrations.set(url, uuid);
                    result = { uuid };
                } else if (stage === 'delete-asset') {
                    fs.rmSync(join(this.project, url.slice('db://'.length)), { force: true });
                    fs.rmSync(join(this.project, url.slice('db://'.length)) + '.meta', { force: true });
                    this.registrations.delete(url);
                    result = true;
                }
                await this.hook(stage, 'after', url);
                return result;
            } },
        } as unknown as IGrantedRuntimeClientSet;
        const lumen = { refreshForCommit: async (paths: readonly string[]) => {
            this.refreshes += 1;
            await this.hook('refresh', 'before', paths.join(','));
            this.refreshAction();
            await this.hook('refresh', 'after', paths.join(','));
            return { ...this.refreshResult, paths };
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
            context.diagnostic(JSON.stringify({ finalProjectInventory: inventory(this.project),
                outsideSentinelSha256: createHash('sha256').update(fs.readFileSync(this.sentinel)).digest('hex') }));
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

     * @description 用实际 Router 执行。 @param input 原始请求。

     */
    public write(input: Readonly<Record<string, unknown>>) {
        return this.router.execute({ operation: 'asset.writeText', input });
    }

    /**

     * @description 运行实际联合资源 executor。 @param inputs 原始任务输入。

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
     * @param importer 与原生登记一致的资源种类。
     * @returns 该文件的独立UUID。

     */
    public seed(path: string, content = 'original', importer = 'text'): string {
        const uuid = importer === 'text' ? 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
            : 'bbbbbbbb-cccc-dddd-eeee-' + (++this._sequence).toString(16).padStart(12, '0');
        fs.mkdirSync(dirname(join(this.project, path)), { recursive: true });
        fs.writeFileSync(join(this.project, path), content);
        fs.writeFileSync(join(this.project, path + '.meta'), JSON.stringify({ uuid, importer }));
        this.registrations.set('db://' + path, uuid);
        return uuid;
    }
}

test('actual Router publishes readback bytes, empty/BOM/CRLF/Unicode and existing UUID after one final refresh', async (context) => {
    const f = new OfflineTextHost(context);
    const uuid = f.seed('assets/existing.txt');
    const meta = fs.readFileSync(join(f.project, 'assets/existing.txt.meta'));
    const files = [{ path: 'assets/existing.txt', content: '\uFEFF雪\r\n' }, { path: 'assets/empty.txt', content: '' }];
    const result = await f.write({ files });
    const data = result.data as Record<string, unknown>;
    const projected = TextFileWriteResultProjection.project({ schemaVersion: data.schemaVersion, ok: data.ok, projectState: data.projectState, files: data.files },
        CoreTextFileIoContract.limits);
    assert.ok(projected?.ok);
    assert.equal(projected.files[0]?.uuid, uuid);
    assert.equal(projected.files[0]?.sha256, createHash('sha256').update(files[0]?.content ?? '').digest('hex'));
    assert.equal(projected.files[1]?.bytes, 0);
    assert.deepEqual(fs.readFileSync(join(f.project, 'assets/existing.txt.meta')), meta);
    assert.equal(f.refreshes, 1);
});

test('32 files verify; 33 and complete escaped 4 MiB request reject with whole-project zero mutations', async (context) => {
    const f = new OfflineTextHost(context);
    const files = Array.from({ length: 32 }, (_, index) => ({ path: 'assets/f-' + index + '.txt', content: '雪' + index }));
    const before = inventory(f.project);
    await assert.rejects(f.write({ files: [...files, { path: 'assets/extra.txt', content: '' }] }), /file_count/u);
    await assert.rejects(f.write({ files: files.slice(0, 5).map((file) => ({ ...file, content: '\u0001'.repeat(800_000) })) }), /json_bytes/u);
    assert.deepEqual(inventory(f.project), before);
    const result = await f.write({ files });
    assert.equal((result.data as Record<string, unknown>).ok, true);
    assert.equal(f.refreshes, 1);
});

test('100 files use separate 32/32/32/4 calls and each own final verification', async (context) => {
    const f = new OfflineTextHost(context);
    const files = Array.from({ length: 100 }, (_, index) => ({ path: 'assets/split-' + index + '.txt', content: String(index) }));
    for (let index = 0; index < files.length; index += 32) {
        const chunk = files.slice(index, index + 32);
        const result = await f.write({ files: chunk });
        assert.equal((result.data as Record<string, unknown>).ok, true);
        assert.equal(((result.data as Record<string, unknown>).files as unknown[]).length, chunk.length);
    }
    assert.equal(f.refreshes, 4);
});

for (const shared of [false, true]) {
    test('actual batch permits proven same-content duplicate/shared missing parent: ' + shared, async (context) => {
        const f = new OfflineTextHost(context);
        const result = await f.batch([{ path: 'assets/shared/a.txt', content: 'same' },
            { path: shared ? 'assets/shared/b.txt' : 'assets/shared/a.txt', content: 'same' }]);
        assert.equal(result.length, 2);
        assert.ok(result.every((item) => (item as { data: { ok: boolean } }).data.ok));
        assert.equal(f.refreshes, 1);
    });
}

for (const explicit of [false, true]) {
    test('actual batch demotes earlier text when later duplicate differs or explicit absent conflicts: ' + explicit, async (context) => {
        const f = new OfflineTextHost(context);
        await assert.rejects(f.batch([{ path: 'assets/a.txt', content: 'first' },
            { path: 'assets/a.txt', content: explicit ? 'first' : 'second', ...(explicit ? { expectedSha256: 'absent' } : {}) }]),
        (error: unknown) => {
            assert.ok(error instanceof Error);
            const failure = Reflect.get(error, 'mcpFailure') as { textFileWrite: { ok: boolean; files: { status: string }[] } };
            assert.equal(failure.textFileWrite.ok, false);
            assert.equal(failure.textFileWrite.files[0]?.status, 'written_unverified');
            return true;
        });
    });
}

for (const late of ['warning', 'error', 'missing-log', 'content', 'identity', 'uuid', 'meta', 'invalid-utf8', 'oversized']) {
    test('actual final verification rejects late ' + late + ' without a verified file', async (context) => {
        const f = new OfflineTextHost(context);
        const target = join(f.project, 'assets/a.txt');
        f.refreshAction = () => {
            if (late === 'warning' || late === 'error') fs.appendFileSync(join(f.project, 'temp/logs/project.log'), ' - ' + (late === 'warning' ? 'warn' : 'error') + ': injected\n');
            if (late === 'missing-log') fs.rmSync(join(f.project, 'temp/logs/project.log'));
            if (late === 'content') fs.writeFileSync(target, 'external');
            if (late === 'identity') { fs.renameSync(target, target + '.old'); fs.writeFileSync(target, 'new'); }
            if (late === 'uuid') fs.writeFileSync(target + '.meta', JSON.stringify({ uuid: 'cccccccc-dddd-eeee-ffff-000000000000', importer: 'text' }));
            if (late === 'meta') fs.rmSync(target + '.meta');
            if (late === 'invalid-utf8') fs.writeFileSync(target, Buffer.from([0xff]));
            if (late === 'oversized') fs.writeFileSync(target, 'x'.repeat(CoreTextFileIoContract.limits.maxFileBytes + 1));
        };
        await assert.rejects(f.write({ path: 'assets/a.txt', content: 'new' }), (error: unknown) => {
            const failure = error != null && typeof error === 'object' ? Reflect.get(error, 'mcpFailure') : null;
            assert.ok(failure != null);
            const result = (failure as { textFileWrite: unknown }).textFileWrite;
            const safe = TextFileWriteResultProjection.project(result, CoreTextFileIoContract.limits);
            assert.ok(safe && !safe.ok);
            assert.equal(safe.projectState, 'may_have_changed');
            assert.ok(safe.files.every((file) => file.status !== 'verified'));
            assert.equal(JSON.stringify(failure).includes(f.project), false);
            return true;
        });
    });
}

for (const stage of ['mkdirSync', 'writeFileSync', 'query-asset-info', 'create-asset', 'refresh']) {
    for (const nth of [1, 2, 3]) {
        for (const phase of ['before', 'after'] as const) {
            test('actual writer Nth fault ' + stage + '/' + nth + '/' + phase, async (context) => {
                const f = new OfflineTextHost(context);
                let calls = 0;
                let injected = false;
                let restore = () => {};
                const fault = (current: string, currentPhase: 'before' | 'after', path: string) => {
                    if (current !== stage || currentPhase !== phase) return;
                    if (current === 'query-asset-info' && !path.includes('assets/dir-')) return;
                    calls += 1;
                    if (calls === nth) { injected = true; throw new Error('injected_write_failure'); }
                };
                if (stage === 'mkdirSync' || stage === 'writeFileSync') {
                    const original: unknown = Reflect.get(fs, stage);
                    assert.equal(typeof original, 'function');
                    Reflect.set(fs, stage, (...args: unknown[]) => {
                        const path = String(args[0]);
                        const relevant = path.startsWith(f.project) && path.includes('/assets/dir-');
                        if (relevant) fault(stage, 'before', path);
                        const result: unknown = Reflect.apply(original as (...values: unknown[]) => unknown, fs, args);
                        if (relevant) fault(stage, 'after', path);
                        return result;
                    });
                    syncBuiltinESMExports();
                    restore = () => { Reflect.set(fs, stage, original); syncBuiltinESMExports(); };
                } else f.hook = fault;
                const files = [1, 2, 3].map((index) => ({ path: 'assets/dir-' + index + '/f.txt', content: 'new-' + index }));
                const before = inventory(f.project);
                try {
                    if (stage === 'refresh') {
                        for (let call = 1; call < nth; call += 1) {
                            const prior = await f.write({ files: files.map((file) => ({ ...file, path: file.path.replace('f.txt', 'prior-' + call + '.txt') })) });
                            assert.equal((prior.data as Record<string, unknown>).ok, true);
                        }
                    }
                    const promise = f.write({ files });
                    {
                        await assert.rejects(promise, (error: unknown) => {
                            const failure = error != null && typeof error === 'object' ? Reflect.get(error, 'mcpFailure') : null;
                            assert.ok(failure != null);
                            const safe = TextFileWriteResultProjection.project((failure as { textFileWrite: unknown }).textFileWrite, CoreTextFileIoContract.limits);
                            assert.ok(safe && !safe.ok);
                            assert.ok(safe.files.every((file) => file.status !== 'verified'));
                            const changed = JSON.stringify(before) !== JSON.stringify(inventory(f.project));
                            if (changed) assert.equal(safe.projectState, 'may_have_changed');
                            assert.equal(JSON.stringify(failure).includes(f.project), false);
                            return true;
                        });
                        assert.equal(injected, true);
                    }
                } finally { restore(); }
            });
        }
    }
}

test('untouched ledger fields remain nullable; earlier stages demote on final failure', (context) => {
    const f = new OfflineTextHost(context);
    const guard = new TextFileIoGuard(f.project, CoreTextFileIoContract.limits);
    const prepared = guard.prepareWrite({ path: 'assets/a.txt', content: 'a' });
    const transaction = Reflect.get(f.router, '_assetDbTransaction');
    const outcome = new EditorMcpTextWriteOutcome(f.project, prepared, transaction);
    assert.deepEqual(outcome.result(false).files[0], { path: 'assets/a.txt', status: 'not_started', bytes: null,
        beforeSha256: null, sha256: null, uuid: null, code: 'text_file_io_verification_failed' });
    const session = new EditorMcpTextWriteSession([{ taskId: 'fixture', outcome }]);
    assert.ok(session.failure(new Error('injected_write_failure')) instanceof Error);
    assert.throws(() => outcome.result(true), /incomplete/u);
});

test('valid historical orphan UUID refuses before any directory/meta/move and preserves original recovery input', async (context) => {
    const f = new OfflineTextHost(context);
    const uuid = f.seed('assets/orphan/a.txt');
    f.registrations.delete('db://assets/orphan/a.txt');
    const before = inventory(f.project);
    await assert.rejects(f.write({ path: 'assets/orphan/a.txt', content: 'new' }), /orphan_identity_unknown/u);
    assert.deepEqual(inventory(f.project), before);
    assert.equal(JSON.parse(fs.readFileSync(join(f.project, 'assets/orphan/a.txt.meta'), 'utf8')).uuid, uuid);
});

for (const late of ['directory', 'directory-meta', 'file-meta-same-uuid']) {
    test('actual final proof rejects same-name parent/meta replacement: ' + late, async (context) => {
        const f = new OfflineTextHost(context);
        f.refreshAction = () => {
            const directory = join(f.project, 'assets/new');
            if (late === 'directory') {
                fs.renameSync(directory, directory + '-old');
                fs.mkdirSync(directory);
                fs.renameSync(join(directory + '-old', 'a.txt'), join(directory, 'a.txt'));
                fs.renameSync(join(directory + '-old', 'a.txt.meta'), join(directory, 'a.txt.meta'));
            } else {
                const meta = late === 'directory-meta' ? directory + '.meta' : join(directory, 'a.txt.meta');
                const original = fs.readFileSync(meta);
                fs.renameSync(meta, meta + '.old');
                fs.writeFileSync(meta, original);
            }
        };
        await assert.rejects(f.write({ path: 'assets/new/a.txt', content: 'new' }), (error: unknown) => {
            assert.ok(error instanceof Error);
            const failure = Reflect.get(error, 'mcpFailure') as { textFileWrite: { files: { status: string }[] } };
            assert.equal(failure.textFileWrite.files[0]?.status, 'written_unverified');
            return true;
        });
    });
}

test('single hardlink to outside sentinel refuses whole request before writing either inode alias', async (context) => {
    const f = new OfflineTextHost(context);
    fs.linkSync(f.sentinel, join(f.project, 'assets/alias.txt'));
    const before = inventory(f.project);
    await assert.rejects(f.write({ path: 'assets/alias.txt', content: 'overwrite' }), /hardlink_refused/u);
    assert.deepEqual(inventory(f.project), before);
    assert.equal(fs.readFileSync(f.sentinel, 'utf8'), 'outside-unchanged');
});

for (const phase of ['before', 'after'] as const) {
    test('strict text registration probe deletion ' + phase + ' fault preserves uncertain material and never completes transaction', async (context) => {
        const f = new OfflineTextHost(context);
        const path = 'assets/copied/a.txt';
        fs.mkdirSync(dirname(join(f.project, path)), { recursive: true });
        const uuid = 'aaaaaaaa-bbbb-cccc-dddd-000000000111';
        fs.writeFileSync(join(f.project, path), 'a');
        fs.writeFileSync(join(f.project, path + '.meta'), JSON.stringify({ uuid, importer: 'text' }));
        const transaction = new EditorMcpAssetDbTransaction({
            requireProjectPath: async () => f.project,
            requireMessage: () => ({ request: async (_target, stage, dbPath): Promise<unknown> => {
                const url = String(dbPath);
                if (stage === 'query-asset-info') return f.registrations.has(url) ? { uuid, importer: 'text' } : null;
                const probe = join(f.project, url.slice('db://'.length));
                if (stage === 'create-asset') {
                    fs.writeFileSync(probe, '{}');
                    fs.writeFileSync(probe + '.meta', JSON.stringify({ uuid, importer: 'text' }));
                    f.registrations.set('db://' + path, uuid);
                    return { uuid };
                }
                if (stage === 'delete-asset') {
                    if (phase === 'before') throw new Error('injected_probe_delete');
                    fs.rmSync(probe); fs.rmSync(probe + '.meta');
                    throw new Error('injected_probe_delete');
                }
                return null;
            } }),
            refreshForCommit: async () => ({ settled: true }),
        });
        await assert.rejects(transaction.commit([path], { textVerification: true, timeoutMs: 100, pollIntervalMs: 20 }), /injected_probe_delete/u);
        const probes = fs.readdirSync(dirname(join(f.project, path))).filter((name) => name.includes('__peanut_assetdb_register_'));
        assert.equal(probes.length > 0, phase === 'before');
    });
}

test('whole-batch original recovery budget rejects later oversized backups before first worker changes anything', async (context) => {
    const f = new OfflineTextHost(context);
    const files = Array.from({ length: 5 }, (_, index) => ({ path: 'assets/orphan-' + index + '.txt', content: 'new' }));
    for (const file of files) fs.writeFileSync(join(f.project, file.path), 'x'.repeat(900_000));
    const before = inventory(f.project);
    await assert.rejects(f.batch([{ files: files.slice(0, 3) }, { files: files.slice(3) }]), /recovery_bytes_exceeded/u);
    assert.deepEqual(inventory(f.project), before);
    assert.equal(f.calls.some((call) => call.startsWith('create-asset:')), false);
    assert.equal(f.refreshes, 0);
});

test('mixed finalizer detects a later worker edit and demotes the earlier actual text write', async (context) => {
    const f = new OfflineTextHost(context);
    const input = { path: 'assets/a.txt', content: 'first' };
    const plan = await f.router.planManagedResourceOperation('asset.writeText', input);
    const batch = await f.router.beginManagedBatch([plan], []);
    const staged = await f.router.executeManagedResourceOperation('asset.writeText', input, f.context(), plan, batch);
    batch.textWrites.markOtherPossibleMutation();
    fs.writeFileSync(join(f.project, 'assets/a.txt'), 'later-worker');
    await assert.rejects(batch.finish([staged]), (error: unknown) => {
        const failure = batch.failure(error);
        const dto = Reflect.get(failure, 'mcpFailure').textFileWrite;
        assert.equal(dto.projectState, 'may_have_changed');
        assert.equal(dto.files[0].status, 'written_unverified');
        return true;
    });
});

test('mixed other-worker failure keeps untouched text nullable while declaring possible project changes', (context) => {
    const f = new OfflineTextHost(context);
    const guard = new TextFileIoGuard(f.project, CoreTextFileIoContract.limits);
    const outcome = new EditorMcpTextWriteOutcome(f.project, guard.prepareWrite({ path: 'assets/a.txt', content: 'a' }),
        Reflect.get(f.router, '_assetDbTransaction'));
    const session = new EditorMcpTextWriteSession([{ taskId: 'text-task', outcome }]);
    session.markOtherPossibleMutation();
    const failure = Reflect.get(session.failure(new Error('other_worker_failed')), 'mcpFailure').textFileWrite;
    assert.equal(failure.projectState, 'may_have_changed');
    assert.equal(failure.files[0].status, 'not_started');
    assert.equal(failure.files[0].bytes, null);
    assert.equal(failure.files[0].uuid, null);
});

for (const result of [{ settled: false }, { barrier: true, result: { settle: { ready: false, pending: 0, softFailCount: 0, overBudget: false } } },
    { barrier: true, result: { settle: { ready: true, pending: 0, softFailCount: 1, overBudget: false } } },
    { barrier: true, ok: false, result: { settle: { ready: true, pending: 0, softFailCount: 0, overBudget: false } } },
    { barrier: true, result: { error: 'refresh_failed', settle: { ready: true, pending: 0, softFailCount: 0, overBudget: false } } },
    { barrier: true, result: { errorCount: 1, settle: { ready: true, pending: 0, softFailCount: 0, overBudget: false } } },
    { barrier: true, result: { settle: { ready: true, pending: 0, softFailCount: 0, overBudget: false, errors: ['settle_failed'] } } },
    { barrier: true, result: { settle: { ready: true, pending: 0, softFailCount: 0, overBudget: true } } }]) {
    test('actual final text transaction refuses negative settle result: ' + JSON.stringify(result), async (context) => {
        const f = new OfflineTextHost(context);
        f.refreshResult = result;
        await assert.rejects(f.write({ path: 'assets/a.txt', content: 'new' }), (error: unknown) => {
            assert.ok(error instanceof Error);
            const failure = Reflect.get(error, 'mcpFailure').textFileWrite;
            assert.equal(failure.projectState, 'may_have_changed');
            assert.equal(failure.files[0].status, 'written_unverified');
            assert.equal(error.message, 'text_file_io_refresh_not_settled');
            return true;
        });
    });
}

test('undefined AssetDB registration is unknown and cannot authorize orphan recovery', async (context) => {
    const f = new OfflineTextHost(context);
    const file = 'assets/orphan.txt';
    fs.writeFileSync(join(f.project, file), 'original');
    const before = inventory(f.project);
    const transaction = Reflect.get(f.router, '_assetDbTransaction') as EditorMcpAssetDbTransaction;
    const host = Reflect.get(transaction, '_host');
    Reflect.set(host, 'requireMessage', () => ({ request: async () => undefined }));
    await assert.rejects(f.write({ path: file, content: 'new' }), /registration_invalid/u);
    assert.deepEqual(inventory(f.project), before);
    assert.equal(f.calls.some((call) => call.startsWith('create-asset:')), false);
});

for (const nth of [1, 2, 3]) {
    for (const phase of ['before', 'after'] as const) {
        test('actual first/second/last readback failure preserves ordered uncertainty: ' + nth + '/' + phase, async (context) => {
            const f = new OfflineTextHost(context);
            const original = EditorMcpTextWriteOutcome.prototype.readBack;
            let injected = false;
            EditorMcpTextWriteOutcome.prototype.readBack = async function (index, expectedUuid) {
                const target = index === nth - 1 && !injected;
                if (target && phase === 'before') {
                    injected = true;
                    throw new Error('injected_readback_failure');
                }
                const result = await original.call(this, index, expectedUuid);
                if (target && phase === 'after') {
                    injected = true;
                    throw new Error('injected_readback_failure');
                }
                return result;
            };
            const files = [1, 2, 3].map((index) => ({ path: 'assets/readback-' + index + '.txt', content: 'written-' + index }));
            try {
                await assert.rejects(f.write({ files }), (error: unknown) => {
                    const failure: unknown = error != null && typeof error === 'object' ? Reflect.get(error, 'mcpFailure') : null;
                    const result: unknown = failure != null && typeof failure === 'object' ? Reflect.get(failure, 'textFileWrite') : null;
                    const safe = TextFileWriteResultProjection.project(result, CoreTextFileIoContract.limits);
                    assert.ok(safe && !safe.ok);
                    assert.equal(safe.projectState, 'may_have_changed');
                    assert.deepEqual(safe.files.map((file) => file.path), files.map((file) => file.path));
                    assert.ok(safe.files.slice(0, nth).every((file) => file.status === 'written_unverified'));
                    assert.ok(safe.files.slice(nth).every((file) => file.status === 'not_started' && file.bytes === null && file.uuid === null));
                    return true;
                });
                assert.equal(injected, true);
            } finally {
                EditorMcpTextWriteOutcome.prototype.readBack = original;
            }
        });
    }
}


for (const [path, importer] of [['assets/existing.js', 'javascript'], ['assets/existing.ts', 'typescript']]) {
    test('existing code write waits for native importer freshness: ' + importer, async (context) => {
        const f = new OfflineTextHost(context);
        const uuid = f.seed(path, 'old-code', importer);
        const meta = fs.readFileSync(join(f.project, path + '.meta'));
        let compiled = 'old-code';
        f.hook = (stage, phase, url) => {
            if (stage === 'reimport-asset' && phase === 'before' && url === 'db://' + path) {
                assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), 'new-code');
                compiled = fs.readFileSync(join(f.project, path), 'utf8');
            }
        };
        const result = await f.write({ path, content: 'new-code' });
        assert.equal(compiled, 'new-code', 'successful source write must not leave the native importer at old code');
        assert.equal(f.calls.filter((call) => call === 'reimport-asset:db://' + path).length, 1);
        assert.ok(f.calls.findIndex((call) => call.startsWith('refresh:')) < f.calls.indexOf('reimport-asset:db://' + path));
        assert.deepEqual(fs.readFileSync(join(f.project, path + '.meta')), meta);
        const data = result.data;
        assert.ok(data != null && typeof data === 'object');
        const dto = TextFileWriteResultProjection.project({
            schemaVersion: Object.getOwnPropertyDescriptor(data, 'schemaVersion')?.value,
            ok: Object.getOwnPropertyDescriptor(data, 'ok')?.value,
            projectState: Object.getOwnPropertyDescriptor(data, 'projectState')?.value,
            files: Object.getOwnPropertyDescriptor(data, 'files')?.value,
        }, CoreTextFileIoContract.limits);
        assert.equal(dto?.ok, true);
        assert.equal(dto?.files[0]?.uuid, uuid);
    });
}

test('code native reimport is limited to existing code, never new code or plain text', async (context) => {
    const f = new OfflineTextHost(context);
    f.seed('assets/existing.txt');
    await f.write({ files: [{ path: 'assets/new.js', content: 'new-code' }, { path: 'assets/existing.txt', content: 'plain-text' }] });
    assert.equal(f.calls.filter((call) => call.startsWith('reimport-asset:')).length, 0);
});

for (const fault of ['native-refusal', 'source-drift', 'identity-drift']) {
    test('code native reimport failure keeps original cause and conservative written state: ' + fault, async (context) => {
        const f = new OfflineTextHost(context);
        const path = 'assets/existing.js';
        f.seed(path, 'old-code', 'javascript');
        const original = new Error('injected-native-code-reimport-refusal');
        f.hook = (stage, phase) => {
            if (stage !== 'reimport-asset' || phase !== 'before') return;
            if (fault === 'native-refusal') throw original;
            if (fault === 'source-drift') fs.writeFileSync(join(f.project, path), 'external-native-change');
            if (fault === 'identity-drift') fs.writeFileSync(join(f.project, path + '.meta'), JSON.stringify({
                uuid: 'aaaaaaaa-bbbb-cccc-dddd-000000000001', importer: 'javascript',
            }));
        };
        await assert.rejects(f.write({ path, content: 'new-code' }), (error: unknown) => {
            assert.ok(error instanceof Error);
            const data: unknown = Object.getOwnPropertyDescriptor(error, 'mcpFailure')?.value;
            const dto: unknown = data != null && typeof data === 'object'
                ? Object.getOwnPropertyDescriptor(data, 'textFileWrite')?.value : null;
            const safe = TextFileWriteResultProjection.project(dto, CoreTextFileIoContract.limits);
            assert.equal(safe?.ok, false);
            assert.equal(safe?.projectState, 'may_have_changed');
            assert.notEqual(safe?.files[0]?.status, 'verified');
            if (fault === 'native-refusal') assert.equal(Object.getOwnPropertyDescriptor(error, 'originalFailure')?.value, original);
            return true;
        });
        assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), fault === 'source-drift' ? 'external-native-change' : 'new-code');
    });
}

test('pending native code import holds the original shared writer until completion', { timeout: 5000 }, async (context) => {
    const f = new OfflineTextHost(context);
    const path = 'assets/existing.js';
    f.seed(path, 'old-code', 'javascript');
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let imports = 0;
    f.hook = async (stage, phase) => {
        if (stage !== 'reimport-asset' || phase !== 'before') return;
        imports += 1;
        if (imports !== 1) return;
        entered();
        await gate;
    };
    const first = f.write({ path, content: 'first-code' });
    await started;
    const second = f.write({ path, content: 'second-code' });
    try {
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), 'first-code');
        assert.equal(imports, 1);
    } finally { release(); }
    await first;
    await second;
    assert.equal(imports, 2);
    assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), 'second-code');
});

test('rejected code preconditions invoke neither writer nor native importer', async (context) => {
    const f = new OfflineTextHost(context);
    const path = 'assets/existing.js';
    f.seed(path, 'old-code', 'javascript');
    const before = inventory(f.project);
    await assert.rejects(f.write({ path, content: 'new-code', expectedSha256: 'f'.repeat(64) }), /content_conflict/u);
    assert.deepEqual(inventory(f.project), before);
    assert.equal(f.calls.filter((call) => call.startsWith('reimport-asset:')).length, 0);
});


test('second native code import failure preserves ordered uncertainty and the original native error', async (context) => {
    const f = new OfflineTextHost(context);
    const files = ['assets/first.js', 'assets/second.ts'];
    for (const path of files) f.seed(path, 'old-code', path.endsWith('.js') ? 'javascript' : 'typescript');
    const nativeError = new Error('second-native-import-failed');
    let imports = 0;
    f.hook = (stage, phase) => {
        if (stage !== 'reimport-asset' || phase !== 'before') return;
        imports += 1;
        if (imports === 2) throw nativeError;
    };
    await assert.rejects(f.write({ files: files.map((path) => ({ path, content: 'new-code' })) }), (error: unknown) => {
        assert.ok(error instanceof Error);
        const failure: unknown = Object.getOwnPropertyDescriptor(error, 'mcpFailure')?.value;
        const dto: unknown = failure != null && typeof failure === 'object'
            ? Object.getOwnPropertyDescriptor(failure, 'textFileWrite')?.value : null;
        const result = TextFileWriteResultProjection.project(dto, CoreTextFileIoContract.limits);
        assert.equal(result?.projectState, 'may_have_changed');
        assert.deepEqual(result?.files.map((file) => file.path), files);
        assert.ok(result?.files.every((file) => file.status === 'written_unverified'));
        assert.equal(Object.getOwnPropertyDescriptor(error, 'originalFailure')?.value, nativeError);
        return true;
    });
    assert.equal(imports, 2);
    for (const path of files) assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), 'new-code');
});

test('native code reimport remains inside the actual executor commit window and refuses late cancellation', async (context) => {
    const f = new OfflineTextHost(context);
    const path = 'assets/existing.js';
    f.seed(path, 'old-code', 'javascript');
    const controls = new TimeoutAndCancelController();
    const taskId = 'actual-code-import-window';
    controls.register(taskId);
    let observed = false;
    f.hook = (stage, phase) => {
        if (stage !== 'reimport-asset' || phase !== 'before') return;
        assert.equal(fs.readFileSync(join(f.project, path), 'utf8'), 'new-code');
        assert.equal(controls.get(taskId)?.inCommitWindow, true);
        assert.deepEqual(controls.cancel(taskId), { cancelled: false, reason: 'task_in_commit_window' });
        observed = true;
    };
    await f.executor.execute({ requestId: taskId, pluginId: 'fixture', kind: ResourceOperationTaskExecutor.KIND,
        scope: 'project', priority: 'normal', payload: { operation: 'asset.writeText', input: { path, content: 'new-code' } } },
    { ...f.context(), enterCommitWindow: () => controls.enterCommitWindow(taskId) });
    assert.equal(observed, true);
    assert.equal(controls.isCancelled(taskId), false);
    controls.finalize(taskId);
});
