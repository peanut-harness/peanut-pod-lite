import { existsSync, realpathSync, statSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { TextFileIoGuard, type ITextFileIoTarget } from '@peanut/pod-engine/assets';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import { McpControlFlowRefusal } from '@peanut/pod-engine/kernel';
import { ResourceLockManager } from '@peanut/pod-engine/runtime';
import type { ITextFileIoLimits, ITextFileReadResult, TextFileReadOutcome } from '@peanut/pod-protocol';
import type { IMcpCapabilityInvocation } from '@peanut/pod-sdk';

/**
 * @description 使用真实宿主版本与 writer 共享锁取得整批文本快照，不缓存内容。
 */
export class EditorMcpTextReadGateway {
    /**
     * @description writer 和 reader 使用的同一个原子锁实例。
     */
    private readonly _locks: ResourceLockManager;
    /**
     * @description 协议注入容量；测试可缩小而不复制产品默认值。
     */
    private readonly _limits: ITextFileIoLimits;

    /**
     * @description 绑定共享锁及公开容量来源。
     * @param locks writer 使用的实际锁实例。
     * @param limits 完整编码容量。
     */
    public constructor(locks: ResourceLockManager, limits: ITextFileIoLimits = CoreTextFileIoContract.limits) {
        this._locks = locks;
        this._limits = limits;
    }

    /**
     * @description 为既有 writer 闭包补充真实路径与 inode 键，保留原资源键及原业务校验语义。
     * @param projectRoot writer 已归一化的工程根。
     * @param resourceKeys 原子 writer 规划的原资源闭包。
     * @returns 同一资源的路径、硬链接及符号链接可共用的完整键集合。
     */
    public writerKeys(projectRoot: string, resourceKeys: readonly string[]): readonly string[] {
        const keys = new Set(resourceKeys);
        for (const key of resourceKeys) {
            if (!key.startsWith('resource:db://assets/')) {
                continue;
            }
            try {
                const root = realpathSync(join(projectRoot, 'assets'));
                let candidate = resolve(projectRoot, key.slice('resource:db://'.length));
                const suffix: string[] = [];
                while (!existsSync(candidate)) {
                    const parent = dirname(candidate);
                    if (parent === candidate) {
                        throw new Error('text_file_io_snapshot_unavailable');
                    }
                    suffix.unshift(basename(candidate));
                    candidate = parent;
                }
                const physical = join(realpathSync(candidate), ...suffix);
                const child = relative(root, physical);
                if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`) || resolve(root, child) !== physical) {
                    continue;
                }
                keys.add(`physical:${physical}`);
                if (suffix.length === 0) {
                    const info = statSync(physical);
                    if (info.isFile()) {
                        keys.add(`inode:${info.dev}:${info.ino}`);
                    }
                }
            } catch {
                // 原 writer 的失败边界保持不变；这里仅补充可以安全解析的互斥键。
            }
        }
        return Object.freeze([...keys].sort());
    }

    /**
     * @description 原子锁定整批，独立复核实际源，并对版本冲突最多读取两次。
     * @param projectRoot 当前 runtime 提供的工程路径。
     * @param input 原始业务输入。
     * @param invocation 由 Hub 或 Creator 直连入口签发的可信上下文。
     * @returns 有序逐项结果；未取得稳定快照时不返回任何内容。
     */
    public async read(projectRoot: string, input: unknown, invocation?: IMcpCapabilityInvocation): Promise<ITextFileReadResult> {
        let projectKey: string;
        try {
            projectKey = realpathSync(projectRoot);
        } catch (error: unknown) {
            McpControlFlowRefusal.reject(this._code(error));
        }
        const guard = new TextFileIoGuard(projectKey, this._limits);
        let targets: readonly ITextFileIoTarget[];
        try {
            targets = guard.prepareRead(input);
        } catch (error: unknown) {
            McpControlFlowRefusal.reject(this._code(error));
        }
        const consistency = invocation?.textReadConsistency;
        let matchesProject = false;
        try {
            matchesProject = consistency != null && realpathSync(consistency.projectKey) === projectKey;
        } catch {
            matchesProject = false;
        }
        if (consistency == null || !matchesProject) {
            return this._budget(guard, this._failed(targets, 'text_file_io_consistency_unavailable'));
        }
        let code = 'text_file_io_snapshot_conflict';
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                await this._wait(consistency.waitForPriorWriters(), invocation?.signal);
                targets = guard.prepareRead(input);
                const lease = await this._locks.acquireSet({
                    projectKey,
                    resourceKeys: targets.flatMap((target) => [
                        `resource:db://${target.path}`,
                        `physical:${target.absolutePath}`,
                        ...(target.identity == null ? [] : [`inode:${target.identity}`]),
                    ]),
                    requiresProjectWriter: false,
                }, { timeoutMs: 10000, signal: invocation?.signal });
                try {
                    const revision = consistency.getRevision();
                    if (!Number.isSafeInteger(revision) || revision < 0) {
                        throw new Error('text_file_io_consistency_unavailable');
                    }
                    const observations: ReturnType<TextFileIoGuard['readObservation']>[] = [];
                    for (const target of targets) {
                        this._assertActive(invocation?.signal);
                        observations.push(guard.readObservation(target));
                        await new Promise<void>((resolve) => setImmediate(resolve));
                    }
                    for (let index = targets.length - 1; index >= 0; index -= 1) {
                        this._assertActive(invocation?.signal);
                        const target = targets[index];
                        const before = observations[index];
                        if (target == null || before == null) {
                            throw new Error('text_file_io_snapshot_conflict');
                        }
                        const after = guard.readObservation(target);
                        if (before.exists !== after.exists || before.identity !== after.identity
                            || before.sha256 !== after.sha256 || before.byteCount !== after.byteCount
                            || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
                            || before.decodeError !== after.decodeError) {
                            throw new Error('text_file_io_snapshot_conflict');
                        }
                    }
                    if (consistency.getRevision() !== revision) {
                        throw new Error('text_file_io_snapshot_conflict');
                    }
                    const files = observations.map((observation): TextFileReadOutcome => {
                        if (!observation.exists || observation.decodeError != null || observation.content == null) {
                            return { path: observation.path, status: 'failed',
                                code: observation.decodeError ?? 'text_file_io_not_found' };
                        }
                        return { path: observation.path, status: 'read', content: observation.content,
                            byteCount: observation.byteCount, sha256: observation.sha256, revision };
                    });
                    return this._budget(guard, { schemaVersion: 1, ok: files.every((file) => file.status === 'read'),
                        consistent: true, revision, files });
                } finally {
                    lease.release();
                }
            } catch (error: unknown) {
                code = invocation?.signal?.aborted === true ? 'text_file_io_cancelled' : this._code(error);
                if (code !== 'text_file_io_snapshot_conflict') {
                    break;
                }
            }
        }
        return this._budget(guard, this._failed(targets, code));
    }

    /**
     * @description 对所有条目保守失败，不保留此前尝试读取的任何内容。
     * @param targets 有序目标。
     * @param code 安全失败码。
     * @returns 未取得稳定版本的结果。
     */
    private _failed(targets: readonly ITextFileIoTarget[], code: string): ITextFileReadResult {
        return { schemaVersion: 1, ok: false, consistent: false, revision: null,
            files: targets.map((target) => ({ path: target.path, status: 'failed', code })) };
    }

    /**
     * @description 同时覆盖 Hub 完整结果和 MCP 文本再编码包装；超限不截断内容。
     * @param guard 当前容量守卫。
     * @param result 待返回结果。
     * @returns 原结果或无内容的容量失败结果。
     */
    private _budget(guard: TextFileIoGuard, result: ITextFileReadResult): ITextFileReadResult {
        try {
            guard.assertOutputBudget({ type: 'result', ok: true, result }, 1);
            guard.assertOutputBudget({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER,
                result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
            return result;
        } catch (error: unknown) {
            const failed: ITextFileReadResult = { schemaVersion: 1, ok: false, consistent: false, revision: null,
                files: result.files.map((file) => ({ path: file.path, status: 'failed', code: this._code(error) })) };
            guard.assertOutputBudget({ type: 'result', ok: true, result: failed }, 1);
            guard.assertOutputBudget({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER,
                result: { content: [{ type: 'text', text: JSON.stringify(failed) }] } });
            return failed;
        }
    }

    /**
     * @description 把异常收成稳定码，避免路径及原始系统异常进入结果。
     * @param error 捕获的异常。
     * @returns 安全失败码。
     */
    private _code(error: unknown): string {
        return error instanceof Error && /^text_file_io_[a-z_]+$/.test(error.message)
            ? error.message : 'text_file_io_snapshot_unavailable';
    }

    /**
     * @description 有限等待 writer，并及时释放取消监听和计时器。
     * @param waiting 宿主此前 writer 屏障。
     * @param signal 调用取消信号。
     * @returns 屏障完成后结束。
     */
    private async _wait(waiting: Promise<void>, signal?: AbortSignal): Promise<void> {
        this._assertActive(signal);
        await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error): void => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                error == null ? resolve() : reject(error);
            };
            const abort = (): void => finish(new Error('text_file_io_cancelled'));
            const timer = setTimeout(() => finish(new Error('text_file_io_writer_timeout')), 10000);
            signal?.addEventListener('abort', abort, { once: true });
            void waiting.then(() => finish(), (error: unknown) => finish(new Error(this._code(error))));
        });
    }

    /**
     * @description 每次实际访问前检查当前调用取消。
     * @param signal 调用取消信号。
     * @returns 无返回值。
     */
    private _assertActive(signal?: AbortSignal): void {
        if (signal?.aborted === true) {
            throw new Error('text_file_io_cancelled');
        }
    }
}
