import { lstatSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import type { EditorMcpAssetDbTransaction } from './editor-mcp-asset-db-transaction.js';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import type { ITextFileIoPreparedWrite, ITextFileIoSnapshot } from '@peanut/pod-engine/assets';
import type { ITaskRequest } from '@peanut/pod-protocol';
import { EditorMcpTextWriteFailure } from './editor-mcp-text-write-failure.js';
import { EditorMcpTextWriteRecovery } from './editor-mcp-text-write-recovery.js';
import type { EditorMcpTextWriteOutcome } from './editor-mcp-text-write-outcome.js';

/**
 * @description 单 writer 窗口中的有限自变更证据，不缓存到业务输入或跨调用状态。
 */
export class EditorMcpTextWriteSession {
    /**
     * @description 已读回的文件物理身份及摘要。
     */
    public readonly files = new Map<string, { readonly identity: string | null; readonly sha256: string; readonly uuid: string; readonly metaIdentity: string; readonly metaSha256: string }>();
    /**
     * @description 本批次同步创建的目录物理身份。
     */
    public readonly directories = new Map<string, string>();
    /**
     * @description 实际原有及本批补齐的目录meta基线，不允许未知替换成为自变更。
     */
    public readonly metas = new Map<string, ReturnType<typeof EditorMcpTextWriteRecovery.metaProof>>();
    /**
     * @description 仅本调用原计划缺失且刚生成 meta 的目录，允许一次经实际登记验证的导入标志变化。
     */
    private readonly _pendingDirectoryImports = new Set<string>();
    /**
     * @description 调用内父目录登记等待策略；构造入口校验后冻结，毫秒单位。
     */
    private readonly _directoryImportPolicy: { readonly timeoutMs: number; readonly pollIntervalMs: number };
    /**
     * @description 当前writer窗口已预留的原始恢复材料字节。
     */
    private _recoveryBytes = 0;
    /**
     * @description 首个worker前预读的有界原始恢复材料，局限于本调用原计划对象。
     */
    private readonly _recoveries = new Map<ITextFileIoPreparedWrite, EditorMcpTextWriteRecovery>();
    /**
     * @description 重复同一物理路径的恢复预算只计算一次。
     */
    private readonly _recoveryPaths = new Set<string>();
    /**
     * @description 混合批次其它资源worker已经可能变化。
     */
    private _otherPossibleMutation = false;
    /**
     * @description 与请求顺序绑定的逐任务账本。
     */
    public readonly outcomes: readonly { readonly taskId: string; readonly request?: Readonly<ITaskRequest>; readonly outcome: EditorMcpTextWriteOutcome | null }[];

    /**
     * @description 绑定原始任务账本；不创建 writer 或日志监视器。
     * @param outcomes 有序请求与账本。
     * @param directoryImportPolicy 内部可注入有界登记等待策略。
     */
    public constructor(outcomes: readonly { readonly taskId: string; readonly request?: Readonly<ITaskRequest>; readonly outcome: EditorMcpTextWriteOutcome | null }[],
        directoryImportPolicy: { readonly timeoutMs: number; readonly pollIntervalMs: number } = { timeoutMs: 1_000, pollIntervalMs: 25 }) {
        if (!Number.isSafeInteger(directoryImportPolicy.timeoutMs) || directoryImportPolicy.timeoutMs < 100 || directoryImportPolicy.timeoutMs > 8_000
            || !Number.isSafeInteger(directoryImportPolicy.pollIntervalMs) || directoryImportPolicy.pollIntervalMs < 1
            || directoryImportPolicy.pollIntervalMs > directoryImportPolicy.timeoutMs) {
            throw new Error('text_file_io_parent_import_policy_invalid');
        }
        this._directoryImportPolicy = Object.freeze({ ...directoryImportPolicy });
        this.outcomes = outcomes;
    }

    /**
     * @description 首个worker前有界预读原始恢复材料并复用原计划证明。
     * @param projectRoot 当前工程。
     * @param file 原始不可变准备。
     * @returns 有界原始恢复记录。
     */
    public prepareRecovery(projectRoot: string, file: ITextFileIoPreparedWrite): EditorMcpTextWriteRecovery {
        const old = this._recoveries.get(file);
        if (old != null) {
            return old;
        }
        const recovery = new EditorMcpTextWriteRecovery(projectRoot, file);
        if (!this._recoveryPaths.has(file.absolutePath)) {
            this.reserveRecoveryBytes(recovery.bytes);
            this._recoveryPaths.add(file.absolutePath);
        }
        this._recoveries.set(file, recovery);
        return recovery;
    }

    /**
     * @description 在混合批次其它worker开始前保守记录潜在项目变化。
     */
    public markOtherPossibleMutation(): void {
        this._otherPossibleMutation = true;
    }

    /**
     * @description 恢复副作用前累加整个调用的有限材料预算。
     * @param bytes 当前请求已实际核实的材料字节。
     */
    public reserveRecoveryBytes(bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0 || this._recoveryBytes + bytes > CoreTextFileIoContract.limits.maxInputBytes) {
            throw new Error('text_file_io_recovery_bytes_exceeded');
        }
        this._recoveryBytes += bytes;
    }

    /**
     * @description 保存原本缺失、同步创建后核实的目录，拒绝替换原有父级。
     * @param file 原始准备。
     * @param createdMetaPaths 当前 ensure 刚创建 meta 的绝对目录集合。
     */
    public rememberDirectories(file: ITextFileIoPreparedWrite, createdMetaPaths: readonly string[] = []): void {
        const assetRoot = Object.keys(file.parentDirectories).sort((a, b) => a.length - b.length)[0];
        for (const [path, identity] of Object.entries(file.parentDirectories)) {
            const info = lstatSync(path);
            if (!info.isDirectory() || realpathSync(path) !== path) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            const current = `${info.dev}:${info.ino}`;
            if (identity != null && current !== identity || identity == null && this.directories.has(path) && this.directories.get(path) !== current) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            if (identity == null) {
                this.directories.set(path, current);
            }
            if (path !== assetRoot) {
                const meta = EditorMcpTextWriteRecovery.metaProof(path + '.meta');
                const old = this.metas.get(path);
                if (old != null && (meta.identity !== old.identity || meta.sha256 !== old.sha256)) {
                    throw new Error('text_file_io_parent_meta_changed');
                }
                if (old == null) {
                    this.metas.set(path, meta);
                    if (identity == null && createdMetaPaths.includes(path) && meta.importer === 'directory'
                        && meta.imported === false && meta.directoryFieldsSha256 != null) {
                        this._pendingDirectoryImports.add(path);
                    }
                }
            }
        }
    }

    /**
     * @description 仅接纳本调用新目录的一次真实导入；原有 meta、其它字段及最终读回仍按原证明核验。
     * @param file 原始准备。
     * @param transaction 原有严格登记查询。
     * @param projectRoot 当前工程真实根。
     * @returns 原有目录证明或唯一已核验的实际导入证明。
     */
    public async rememberImportedDirectories(file: ITextFileIoPreparedWrite, transaction: EditorMcpAssetDbTransaction, projectRoot: string): Promise<void> {
        const deadline = Date.now() + this._directoryImportPolicy.timeoutMs;
        for (const path of Object.keys(file.parentDirectories)) {
            const old = this.metas.get(path);
            if (old == null) {
                continue;
            }
            const meta = EditorMcpTextWriteRecovery.metaProof(path + '.meta');
            if (old.identity === meta.identity && old.sha256 === meta.sha256) {
                continue;
            }
            if (!this._pendingDirectoryImports.has(path) || file.parentDirectories[path] !== null
                || old.importer !== 'directory' || meta.importer !== 'directory' || old.imported !== false || meta.imported !== true
                || old.uuid !== meta.uuid || old.directoryFieldsSha256 == null || old.directoryFieldsSha256 !== meta.directoryFieldsSha256) {
                throw new Error('text_file_io_parent_meta_changed');
            }
            const info = lstatSync(path);
            if (!info.isDirectory() || realpathSync(path) !== path || `${info.dev}:${info.ino}` !== this.directories.get(path)) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            const dbPath = relative(projectRoot, path).replace(/\\/gu, '/');
            let registered = false;
            while (Date.now() < deadline) {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    const proof = await Promise.race([
                        transaction.queryTextRegistration(dbPath, old.uuid),
                        new Promise<never>((_resolve, reject) => {
                            timer = setTimeout(() => reject(new Error('text_file_io_parent_registration_unknown')), Math.max(1, deadline - Date.now()));
                        }),
                    ]);
                    if (proof != null) {
                        if (proof.dbPath !== 'db://' + dbPath || proof.importer !== 'directory'
                            || proof.metaIdentity !== meta.identity || proof.metaSha256 !== meta.sha256) {
                            throw new Error('text_file_io_parent_meta_changed');
                        }
                        registered = true;
                        break;
                    }
                } finally {
                    if (timer != null) {
                        clearTimeout(timer);
                    }
                }
                await new Promise<void>((resolve) => setTimeout(resolve, Math.min(this._directoryImportPolicy.pollIntervalMs, Math.max(1, deadline - Date.now()))));
            }
            if (!registered) {
                throw new Error('text_file_io_parent_registration_unknown');
            }
            const finalMeta = EditorMcpTextWriteRecovery.metaProof(path + '.meta');
            const finalDirectory = lstatSync(path);
            if (!finalDirectory.isDirectory() || realpathSync(path) !== path
                || `${finalDirectory.dev}:${finalDirectory.ino}` !== this.directories.get(path)
                || finalMeta.identity !== meta.identity || finalMeta.sha256 !== meta.sha256) {
                throw new Error('text_file_io_parent_meta_changed');
            }
            this.metas.set(path, finalMeta);
            this._pendingDirectoryImports.delete(path);
        }
        this.rememberDirectories(file);
    }

    /**
     * @description 仅保存已实际读回且核实登记的文件变化。
     * @param file 原始准备。
     * @param snapshot 实际快照。
     */
    public rememberFile(file: ITextFileIoPreparedWrite, snapshot: ITextFileIoSnapshot, proof: { readonly uuid: string; readonly metaIdentity: string; readonly metaSha256: string }): void {
        this.files.set(file.absolutePath, { identity: snapshot.identity, sha256: snapshot.sha256, ...proof });
    }

    /**
     * @description 生成每个任务独立附件，不将一个任务的文件复制给其它任务。
     * @param error 原始失败。
     * @returns 保留原始原因及有序安全附件的异常。
     */
    public failure(error: unknown): Error {
        const code = error instanceof Error && /^[a-z][a-z0-9_]{0,127}$/u.test(error.message)
            ? error.message : 'text_file_io_verification_failed';
        const failures = this.outcomes.flatMap((entry) => entry.outcome == null ? [] : [{
            request: entry.request, textFileWrite: {
                ...entry.outcome.result(false, code),
                ...(this._otherPossibleMutation ? { projectState: 'may_have_changed' as const } : {}),
            },
        }]);
        const first = failures[0];
        if (first == null) {
            return error instanceof Error ? error : new Error(code);
        }
        const aggregateChanged = failures.some((entry) => entry.textFileWrite.projectState === 'may_have_changed');
        const result = aggregateChanged ? { ...first.textFileWrite, projectState: 'may_have_changed' as const } : first.textFileWrite;
        return new EditorMcpTextWriteFailure(code, result, error, failures);
    }
}
