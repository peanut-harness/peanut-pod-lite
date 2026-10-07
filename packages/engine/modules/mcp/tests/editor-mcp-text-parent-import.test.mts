import { EditorMcpAssetDbTransaction } from '../src/editor-mcp-asset-db-transaction.js';
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
class CreatorImportTextHost {
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
                } else if (stage === 'create-asset') {
                    const file = join(this.project, url.slice('db://'.length));
                    assert.equal(fs.existsSync(file), false);
                    fs.mkdirSync(dirname(file), { recursive: true });
                    fs.writeFileSync(file, String(content));
                    this._sequence += 1;
                    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-' + this._sequence.toString(16).padStart(12, '0');
                    fs.writeFileSync(file + '.meta', JSON.stringify({ uuid, importer: 'text' }));
                    this.registrations.set(url, uuid);
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
        const lumen = { refreshForCommit: async (paths: readonly string[]) => {
            this.refreshes += 1;
            this.hook('refresh', 'before', paths.join(','));
            this.refreshAction();
            this.hook('refresh', 'after', paths.join(','));
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

     * @description 初始登记实际文件与meta。 @param path 相对路径。 @param content 原字节。

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
 * @description 检查实际失败附件保持未知项目状态、逐文件未验证和安全 DTO。
 * @param promise 实际 Router 调用。
 * @param expectedCode 预期实际域错误。
 */
async function uncertain(promise: Promise<unknown>, expectedCode: RegExp): Promise<void> {
    await assert.rejects(promise, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, expectedCode);
        const failure = Reflect.get(error, 'mcpFailure') as { textFileWrite: unknown };
        const safe = TextFileWriteResultProjection.project(failure.textFileWrite, CoreTextFileIoContract.limits);
        assert.ok(safe && !safe.ok);
        assert.equal(safe.projectState, 'may_have_changed');
        assert.equal(safe.files[0]?.status, 'written_unverified');
        assert.ok(safe.files.every((file) => file.status !== 'verified'));
        return true;
    });
}

test('actual Gateway/Session/Outcome verifies nested imported parent inode replacements and 32 ordered files', async (context) => {
    const f = new CreatorImportTextHost(context);
    const files = Array.from({ length: 32 }, (_, index) => ({ path: 'assets/new/deep/f-' + index + '.txt', content: '雪\r\n' + index }));
    const result = await f.write({ files });
    const data = result.data as Record<string, unknown>;
    assert.equal(data.ok, true);
    assert.equal(TextFileWriteResultProjection.project(data, CoreTextFileIoContract.limits), null);
    const safe = TextFileWriteResultProjection.project({ schemaVersion: data.schemaVersion, ok: data.ok,
        projectState: data.projectState, files: data.files }, CoreTextFileIoContract.limits);
    assert.ok(safe?.ok);
    assert.deepEqual(safe.files.map((file) => file.path), files.map((file) => file.path));
    assert.equal(f.imports.length, 2);
    assert.ok(f.imports.every((proof) => proof.beforeInode !== proof.afterInode));
    for (const proof of f.imports) {
        assert.equal(JSON.parse(fs.readFileSync(proof.path, 'utf8')).uuid, proof.uuid);
        assert.equal(JSON.parse(fs.readFileSync(proof.path, 'utf8')).imported, true);
    }
    for (const [index, file] of safe.files.entries()) {
        const content = files[index]?.content ?? '';
        assert.equal(file.status, 'verified');
        assert.equal(file.sha256, createHash('sha256').update(content).digest('hex'));
        assert.equal(file.bytes, Buffer.byteLength(content));
        assert.equal(file.uuid, f.registrations.get('db://' + file.path));
    }
    assert.equal(f.refreshes, 1);
});

test('actual joint batch imports shared new parents once and preserves pre-existing parent UUID and bytes', async (context) => {
    const f = new CreatorImportTextHost(context);
    const before = f.seedDirectory('assets/existing');
    const identity = fs.lstatSync(join(f.project, 'assets/existing.meta')).ino;
    const batch = await f.batch([{ path: 'assets/existing/new/a.txt', content: 'one' }, { path: 'assets/existing/new/b.txt', content: 'two' }]);
    assert.equal(batch.length, 2);
    for (const result of batch) {
        const data = (result as { data: Record<string, unknown> }).data;
        assert.equal(data.ok, true);
        assert.equal(TextFileWriteResultProjection.project(data, CoreTextFileIoContract.limits), null);
        const safe = TextFileWriteResultProjection.project({ schemaVersion: data.schemaVersion, ok: data.ok,
            projectState: data.projectState, files: data.files }, CoreTextFileIoContract.limits);
        assert.ok(safe?.ok);
    }
    assert.equal(f.imports.length, 1);
    assert.deepEqual(fs.readFileSync(join(f.project, 'assets/existing.meta')), before);
    assert.equal(fs.lstatSync(join(f.project, 'assets/existing.meta')).ino, identity);
    assert.equal(f.refreshes, 1);
});

test('real registration may settle after null queries; metadata is never fabricated or refreshed by the adoption step', async (context) => {
    const f = new CreatorImportTextHost(context);
    f.directoryUnavailableReads = 2;
    const result = await f.write({ path: 'assets/new/a.txt', content: 'new' });
    assert.equal((result.data as Record<string, unknown>).ok, true);
    assert.ok(f.calls.filter((call) => call === 'query-asset-info:db://assets/new').length >= 3);
    assert.equal(f.refreshes, 1);
});

for (const mutation of ['user-data', 'unknown-field', 'uuid', 'same-bytes-replacement', 'directory-replacement', 'meta-symlink', 'meta-hardlink', 'unregistered', 'foreign-registration']) {
    test('actual writer rejects imported parent mutation: ' + mutation, async (context) => {
        const f = new CreatorImportTextHost(context);
        if (mutation === 'same-bytes-replacement') f.importDirectories = false;
        f.hook = (stage, phase) => {
            if (stage !== 'create-asset' || phase !== 'after') return;
            const parent = join(f.project, 'assets/new');
            const meta = parent + '.meta';
            const raw = JSON.parse(fs.readFileSync(meta, 'utf8')) as Record<string, unknown>;
            if (mutation === 'user-data' || mutation === 'unknown-field' || mutation === 'uuid') {
                if (mutation === 'user-data') raw.userData = { external: true };
                if (mutation === 'unknown-field') raw.external = true;
                if (mutation === 'uuid') raw.uuid = 'dddddddd-eeee-ffff-0000-000000000002';
                fs.writeFileSync(meta, JSON.stringify(raw));
            }
            if (mutation === 'same-bytes-replacement') {
                const bytes = fs.readFileSync(meta);
                fs.renameSync(meta, meta + '.old');
                fs.writeFileSync(meta, bytes);
            }
            if (mutation === 'directory-replacement') {
                fs.renameSync(parent, parent + '.old');
                fs.mkdirSync(parent);
                fs.renameSync(join(parent + '.old', 'a.txt'), join(parent, 'a.txt'));
                fs.renameSync(join(parent + '.old', 'a.txt.meta'), join(parent, 'a.txt.meta'));
            }
            if (mutation === 'meta-symlink' || mutation === 'meta-hardlink') {
                fs.renameSync(meta, meta + '.old');
                if (mutation === 'meta-symlink') fs.symlinkSync(meta + '.old', meta);
                else fs.linkSync(meta + '.old', meta);
            }
            if (mutation === 'unregistered') f.registrations.delete('db://assets/new');
            if (mutation === 'foreign-registration') f.registrations.set('db://assets/new', 'dddddddd-eeee-ffff-0000-000000000002');
        };
        await uncertain(f.write({ path: 'assets/new/a.txt', content: 'new' }), /text_file_io_(?:parent_meta_changed|snapshot_conflict|recovery_material_unsafe|parent_registration_unknown|uuid_conflict)/u);
        assert.equal(fs.readFileSync(join(f.project, 'assets/new/a.txt'), 'utf8'), 'new');
        assert.equal(f.refreshes, 0);
    });
}

test('pre-existing parent metadata cannot use the new-directory import exception', async (context) => {
    const f = new CreatorImportTextHost(context);
    f.seedDirectory('assets/existing');
    f.hook = (stage, phase) => {
        if (stage === 'create-asset' && phase === 'after') {
            const meta = join(f.project, 'assets/existing.meta');
            const raw = JSON.parse(fs.readFileSync(meta, 'utf8'));
            fs.writeFileSync(meta, JSON.stringify({ ...raw, userData: { external: true } }));
        }
    };
    await uncertain(f.write({ path: 'assets/existing/a.txt', content: 'new' }), /text_file_io_(?:parent_meta_changed|snapshot_conflict)/u);
});

test('actual parent registration query readback race refuses success and preserves partial state', async (context) => {
    const f = new CreatorImportTextHost(context);
    f.hook = (stage, phase, url) => {
        if (stage === 'query-asset-info' && phase === 'after' && url === 'db://assets/new') {
            const meta = join(f.project, 'assets/new.meta');
            const raw = JSON.parse(fs.readFileSync(meta, 'utf8'));
            fs.writeFileSync(meta, JSON.stringify({ ...raw, userData: { concurrent: true } }));
        }
    };
    await uncertain(f.write({ path: 'assets/new/a.txt', content: 'new' }), /text_file_io_parent_meta_changed/u);
    assert.equal(f.refreshes, 0);
});

test('pending parent native query times out without a verified DTO or automatic retry', async (context) => {
    const f = new CreatorImportTextHost(context);
    f.stallDirectoryQuery = true;
    const start = Date.now();
    await uncertain(f.write({ path: 'assets/new/a.txt', content: 'new' }), /text_file_io_parent_registration_unknown/u);
    assert.ok(Date.now() - start < 3_000);
    assert.equal(f.refreshes, 0);
    assert.equal(f.calls.filter((call) => call === 'create-asset:db://assets/new/a.txt').length, 1);
});

test('strict final proof still rejects parent replacement after accepted actual import', async (context) => {
    const f = new CreatorImportTextHost(context);
    f.refreshAction = () => {
        const meta = join(f.project, 'assets/new.meta');
        const bytes = fs.readFileSync(meta);
        fs.renameSync(meta, meta + '.old');
        fs.writeFileSync(meta, bytes);
    };
    await uncertain(f.write({ path: 'assets/new/a.txt', content: 'new' }), /text_file_io_parent_identity_conflict/u);
    assert.equal(f.refreshes, 1);
});
