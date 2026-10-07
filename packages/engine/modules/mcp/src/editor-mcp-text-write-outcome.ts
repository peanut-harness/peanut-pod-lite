import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { TextFileIoGuard, type ITextFileIoPreparedWrite, type ITextFileIoSnapshot } from '@peanut/pod-engine/assets';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import type { ITextFileWriteOutcome, ITextFileWriteResult } from '@peanut/pod-protocol';
import type { EditorMcpAssetDbTransaction, IEditorMcpAssetDbRegistrationEvidence } from './editor-mcp-asset-db-transaction.js';
import type { EditorMcpTextWriteSession } from './editor-mcp-text-write-session.js';
import { EditorMcpTextWriteRecovery } from './editor-mcp-text-write-recovery.js';

/**
 * @description 当前调用中某个文件的阶段记录，内容及物理路径不进入公共结果。
 */
interface ITextWriteStage {
    /**
     * @description 原始不可变准备。
     */
    readonly prepared: ITextFileIoPreparedWrite;
    /**
     * @description 已尝试当前文件。
     */
    attempted: boolean;
    /**
     * @description 可能已改变文件、目录或 meta。
     */
    possibleMutation: boolean;
    /**
     * @description 首次提交前实际摘要。
     */
    beforeSha256: string | null;
    /**
     * @description 有限实际读回。
     */
    snapshot: ITextFileIoSnapshot | null;
    /**
     * @description 实际登记 UUID。
     */
    uuid: string | null;
    /**
     * @description 写入后立即保存的物理身份。
     */
    writeIdentity: string | null;
    /**
     * @description writer前已登记旧meta物理身份及字节。
     */
    metaIdentity: string | null;
    /**
     * @description 原有或首次create后实际meta摘要。
     */
    metaSha256: string | null;
    /**
     * @description 在本文件变化前记录的实际父目录及meta证明。
     */
    parents: readonly { readonly path: string; readonly identity: string; readonly meta: { readonly identity: string; readonly sha256: string; readonly uuid: string } }[];
}

/**
 * @description 单个不可变请求的调用局部阶段账本，最终日志验收前绝不标 verified。
 */
export class EditorMcpTextWriteOutcome {
    /**
     * @description 实际工程根。
     */
    private readonly _projectRoot: string;
    /**
     * @description 原始有序阶段。
     */
    private readonly _stages: ITextWriteStage[];
    /**
     * @description 原有 AssetDB 事务。
     */
    private readonly _transaction: EditorMcpAssetDbTransaction;
    /**
     * @description 当前调用释放恢复材料的回调，失败时保留。
     */
    private readonly _recoveryReleases: (() => void)[] = [];

    /**
     * @description 保存原始准备与原事务。
     * @param projectRoot 真实工程。
     * @param files 原始准备。
     * @param transaction 现有登记事务。
     */
    public constructor(projectRoot: string, files: readonly ITextFileIoPreparedWrite[], transaction: EditorMcpAssetDbTransaction) {
        this._projectRoot = projectRoot;
        this._transaction = transaction;
        this._stages = files.map((prepared) => ({ prepared, attempted: false, possibleMutation: false,
            beforeSha256: null, snapshot: null, uuid: null, writeIdentity: null, metaIdentity: null, metaSha256: null, parents: [] }));
    }

    /**
     * @description 在该文件实际提交前记录当前真实摘要。
     * @param index 输入索引。
     * @param snapshot 当前有限快照。
     */
    public attempt(index: number, snapshot: ITextFileIoSnapshot): void {
        const stage = this._stage(index);
        stage.attempted = true;
        stage.beforeSha256 = snapshot.sha256;
    }

    /**
     * @description 记录该项预读失败，未知摘要仍保持null。
     * @param index 已尝试输入索引。
     */
    public markAttemptFailure(index: number): void {
        this._stage(index).attempted = true;
    }

    /**
     * @description 在可能改变目录、meta、文件或探针前记录，不依赖成功回调。
     * @param index 受影响输入索引。
     */
    public markPossibleMutation(index: number): void {
        this._stage(index).possibleMutation = true;
    }

    /**
     * @description 保存writer前实际旧UUID和meta，文件写入不能授权替换meta。
     * @param index 输入索引。
     * @param registration 原登记证明。
     */
    public expectRegistration(index: number, registration: IEditorMcpAssetDbRegistrationEvidence): void {
        const stage = this._stage(index);
        if (stage.uuid != null && (stage.uuid !== registration.uuid || stage.metaIdentity !== registration.metaIdentity || stage.metaSha256 !== registration.metaSha256)) {
            throw new Error('text_file_io_meta_identity_conflict');
        }
        stage.uuid = registration.uuid;
        stage.metaIdentity = registration.metaIdentity ?? null;
        stage.metaSha256 = registration.metaSha256 ?? null;
    }

    /**
     * @description 在实际写入后保存物理身份，供最终读回排除同路径替换。
     * @param index 输入索引。
     */
    public rememberWrite(index: number, session?: EditorMcpTextWriteSession): void {
        const stage = this._stage(index);
        const guard = new TextFileIoGuard(this._projectRoot, CoreTextFileIoContract.limits);
        const target = guard.prepareRead({ path: stage.prepared.path })[0];
        if (target == null || !target.exists) {
            throw new Error('text_file_io_readback_missing');
        }
        if (lstatSync(target.absolutePath).nlink !== 1) {
            throw new Error('text_file_io_hardlink_refused');
        }
        stage.writeIdentity = target.identity;
        stage.parents = Object.keys(stage.prepared.parentDirectories).filter((path) => path !== join(realpathSync(this._projectRoot), 'assets')).map((path) => {
            const info = lstatSync(path);
            const identity = `${info.dev}:${info.ino}`;
            const meta = session?.metas.get(path) ?? EditorMcpTextWriteRecovery.metaProof(path + '.meta');
            const actual = EditorMcpTextWriteRecovery.metaProof(path + '.meta');
            if (meta.identity !== actual.identity || meta.sha256 !== actual.sha256) {
                throw new Error('text_file_io_parent_meta_changed');
            }
            return { path, identity, meta };
        });
    }

    /**
     * @description 在 refresh/settle 后以真实源读回、meta 和 AssetDB UUID 形成阶段证据。
     * @param index 输入索引。
     * @param expectedUuid 已登记旧 UUID；新文件可省略。
     * @returns 实际读回快照。
     */
    public async readBack(index: number, expectedUuid?: string): Promise<ITextFileIoSnapshot> {
        const stage = this._stage(index);
        const guard = new TextFileIoGuard(this._projectRoot, CoreTextFileIoContract.limits);
        const target = guard.prepareRead({ path: stage.prepared.path })[0];
        if (target == null || !target.exists || stage.writeIdentity == null || target.identity !== stage.writeIdentity) {
            throw new Error('text_file_io_readback_identity_conflict');
        }
        const before = guard.readSnapshot(target);
        stage.snapshot = before;
        const expected = createHash('sha256').update(stage.prepared.content, 'utf8').digest('hex');
        if (before.sha256 !== expected || before.byteCount !== stage.prepared.byteCount) {
            throw new Error('text_file_io_readback_content_conflict');
        }
        const registration = await this._transaction.queryTextRegistration(stage.prepared.path, expectedUuid ?? stage.uuid ?? undefined);
        if (registration == null) {
            throw new Error('text_file_io_registration_missing');
        }
        if (stage.metaIdentity != null && stage.metaIdentity !== registration.metaIdentity
            || stage.metaSha256 != null && stage.metaSha256 !== registration.metaSha256) {
            throw new Error('text_file_io_meta_identity_conflict');
        }
        stage.uuid = registration.uuid;
        stage.metaIdentity = registration.metaIdentity ?? null;
        stage.metaSha256 = registration.metaSha256 ?? null;
        const after = guard.readSnapshot(target);
        if (before.sha256 !== after.sha256 || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
            throw new Error('text_file_io_readback_changed');
        }
        stage.snapshot = after;
        return after;
    }

    /**
     * @description 最终混合批次结束后重新核实此前全部文本目标。
     */
    public async verifyFinal(): Promise<void> {
        for (const stage of this._stages) {
            for (const parent of stage.parents) {
                const info = lstatSync(parent.path);
                const relativePath = parent.path.slice(realpathSync(this._projectRoot).length + 1).replace(/\\/gu, '/');
                const registration = await this._transaction.queryTextRegistration(relativePath, parent.meta.uuid);
                const after = lstatSync(parent.path);
                if (info.dev !== after.dev || info.ino !== after.ino || !after.isDirectory()
                    || !info.isDirectory() || realpathSync(parent.path) !== parent.path
                    || `${info.dev}:${info.ino}` !== parent.identity || registration?.metaIdentity !== parent.meta.identity
                    || registration.metaSha256 !== parent.meta.sha256) {
                    throw new Error('text_file_io_parent_identity_conflict');
                }
            }
        }
        for (let index = 0; index < this._stages.length; index += 1) {
            await this.readBack(index);
        }
    }

    /**
     * @description 仅在统一内容、身份、日志均通过后清理本次明确恢复材料。
     */
    public releaseRecovery(): void {
        for (const release of this._recoveryReleases) {
            release();
        }
    }

    /**
     * @description 保存本次恢复材料的最终清理回调，不在 finally 执行。
     * @param release 已绑定的恢复目录清理。
     */
    public retainRecovery(release: () => void): void {
        this._recoveryReleases.push(release);
    }

    /**
     * @description 生成有序公开结果，失败时降级所有已完成阶段。
     * @param verified 是否已通过统一最终收口。
     * @param code 固定失败码。
     * @returns 无源码和物理路径的结果。
     */
    public result(verified: boolean, code = 'text_file_io_verification_failed'): ITextFileWriteResult {
        const changed = this._stages.some((stage) => stage.possibleMutation);
        const attempted = this._stages.some((stage) => stage.attempted);
        const files: ITextFileWriteOutcome[] = this._stages.map((stage) => ({
            path: stage.prepared.path,
            status: verified ? 'verified' : stage.possibleMutation ? 'written_unverified' : stage.attempted ? 'failed' : 'not_started',
            bytes: stage.snapshot?.byteCount ?? null, beforeSha256: stage.beforeSha256,
            sha256: stage.snapshot?.sha256 ?? null, uuid: stage.uuid,
            ...(verified ? {} : { code }),
        }));
        if (verified && this._stages.some((stage) => stage.snapshot == null || stage.uuid == null || stage.beforeSha256 == null)) {
            throw new Error('text_file_io_verification_incomplete');
        }
        return { schemaVersion: 1, ok: verified, projectState: verified ? 'verified' : changed ? 'may_have_changed' : attempted ? 'unchanged' : 'not_started', files };
    }

    /**
     * @description 保存实际读回后有限身份，供同一writer窗口后续原计划比对。
     * @param index 原始输入索引。
     * @returns 实际文件/meta/UUID证明。
     */
    public identityProof(index: number): { readonly uuid: string; readonly metaIdentity: string; readonly metaSha256: string } {
        const stage = this._stage(index);
        if (stage.uuid == null || stage.metaIdentity == null || stage.metaSha256 == null) {
            throw new Error('text_file_io_verification_incomplete');
        }
        return { uuid: stage.uuid, metaIdentity: stage.metaIdentity, metaSha256: stage.metaSha256 };
    }

    /**
     * @description 核实索引始终来自原始有序输入。
     * @param index 输入索引。
     * @returns 阶段。
     */
    private _stage(index: number): ITextWriteStage {
        const stage = this._stages[index];
        if (stage == null) {
            throw new Error('text_file_io_stage_index_invalid');
        }
        return stage;
    }
}
