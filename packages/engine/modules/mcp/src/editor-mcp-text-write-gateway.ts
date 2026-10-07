import { AsyncLocalStorage } from 'node:async_hooks';
import type { IPluginTaskExecutorContext } from '@peanut/pod-sdk';
import type { EditorMcpTextWriteOutcome } from './editor-mcp-text-write-outcome.js';
import type { EditorMcpTextWriteSession } from './editor-mcp-text-write-session.js';
import { realpathSync } from 'node:fs';

import { TextFileIoGuard, type ITextFileIoPreparedWrite } from '@peanut/pod-engine/assets';
import { ExecutionRuntimeService } from '@peanut/pod-engine/runtime';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';
import type { ITextFileIoLimits, ITaskRequest } from '@peanut/pod-protocol';

/**
 * @description 仅内部规划阶段签发的调用局部标记；不进入业务 JSON、缓存或任务证据。
 */
const PREPARED_TEXT_WRITE = Symbol('editor-mcp-trusted-text-write');

/**
 * @description 随现有任务计划传递的不可变写入准备；不是外部可提供的业务输入。
 */
export interface IEditorMcpPreparedTextWrite {
    /**
     * @description 当前模块签发且 JSON 无法提供的内部标记。
     */
    readonly [PREPARED_TEXT_WRITE]: true;
    /**
     * @description 准备时核实的真实工程根。
     */
    readonly projectRoot: string;
    /**
     * @description 包含控制及被忽略字段的原始有限 JSON，检测排队期间输入改变。
     */
    readonly inputJson: string;
    /**
     * @description 原有目标、父级物理身份、源摘要及已校验内容。
     */
    readonly files: readonly ITextFileIoPreparedWrite[];
}

/**
 * @description 仅内部原始准备和调用账本，不进入业务JSON。
 */
export interface IEditorMcpTextWriteExecution {
    /**
     * @description 原始文件准备。
     */
    readonly files: readonly ITextFileIoPreparedWrite[];
    /**
     * @description 本任务阶段账本。
     */
    readonly outcome?: EditorMcpTextWriteOutcome;
    /**
     * @description 当前writer窗口的可证自变更。
     */
    readonly session?: EditorMcpTextWriteSession;
}

/**
 * @description 签发调用局部全批准备，在现有 writer 中重验，再复用静默 AssetDB 写入。
 */
export class EditorMcpTextWriteGateway {
    /**
     * @description Core 仅保存当前 plan 的 Host 函数引用，不保存证明或全局共享凭据。
     */
    private static readonly _hostPreparation = new AsyncLocalStorage<{
        prepare: NonNullable<IPluginTaskExecutorContext['prepareTextWrite']>; active: boolean;
        request: Readonly<ITaskRequest>; signal: AbortSignal;
    }>();

    /**
     * @description 在原异步 plan 中局部传递 Host 实际 Guard 端口，退出 plan 后立即失效。
     * @param prepare Host Kernel 注入的同步 Guard 端口，不接收原错误或自称可信标记。
     * @param request Core 得到的原 Runtime 请求，Host 再次检查同一引用。
     * @param signal Core 得到的原 Host-own signal，Host 再次检查同一引用。
     * @param plan 原 ResourceExecutor 的规划函数。
     * @returns 原 plan 返回值或原始异常。
     */
    public static async withHostTextWritePreparation<T>(
        prepare: NonNullable<IPluginTaskExecutorContext['prepareTextWrite']>, request: Readonly<ITaskRequest>,
        signal: AbortSignal, plan: () => Promise<T>,
    ): Promise<T> {
        const scope = { prepare, request, signal, active: true };
        return EditorMcpTextWriteGateway._hostPreparation.run(scope, async () => {
            try { return await plan(); } finally { scope.active = false; }
        });
    }

    /**
     * @description 原有静默 writer；在其实际资源锁内调用检查回调。
     */
    private readonly _write: (input: Readonly<Record<string, unknown>>, beforeWrite: () => void, execution?: IEditorMcpTextWriteExecution) => Promise<unknown>;
    /**
     * @description 产品统一容量来源，测试可以显式缩小。
     */
    private readonly _limits: ITextFileIoLimits;

    /**
     * @description 绑定原有写流程和统一容量，不取得新锁或建立缓存。
     * @param write 已有静默 AssetDB 写流程。
     * @param limits 公开容量配置。
     */
    public constructor(
        write: (input: Readonly<Record<string, unknown>>, beforeWrite: () => void, execution?: IEditorMcpTextWriteExecution) => Promise<unknown>,
        limits: ITextFileIoLimits = CoreTextFileIoContract.limits,
    ) {
        this._write = write;
        this._limits = limits;
    }

    /**
     * @description 在解码或剥离控制字段前计算完整 JSON；不访问业务文件。
     * @param input 原始请求或完整业务输入。
     * @returns 无返回值。
     */
    public assertInputBudget(input: unknown): void {
        new TextFileIoGuard('.', this._limits).assertInputBudget(input);
    }

    /**
     * @description 首次取得无副作用全批准备并冻结原始物理身份。
     * @param projectRoot 实际宿主工程路径。
     * @param input 未受信业务输入，保留 files 优先语义。
     * @returns 仅当前调用使用的内部计划载荷。
     */
    public prepare(projectRoot: string, input: unknown): IEditorMcpPreparedTextWrite {
        const scope = EditorMcpTextWriteGateway._hostPreparation.getStore();
        if (scope != null && !scope.active) throw new Error('text_file_io_host_preparation_expired');
        let files: readonly ITextFileIoPreparedWrite[];
        if (scope != null) {
            // Host 端口执行真正 Guard；Core 不签发或复制跨包拒绝证明。
            files = scope.prepare(scope.request, projectRoot, input, this._limits, scope.signal);
        } else {
            // 保留旧同包无端口 executor 兼容；独立 Host/Core 路径不使用此静态 Runtime 作为 authority。
            try { files = new TextFileIoGuard(projectRoot, this._limits).prepareWrite(input); }
            catch (error: unknown) {
                if (error instanceof Error && error.message === 'text_file_io_content_conflict') {
                    ExecutionRuntimeService.recordTextWritePreparationRefusal(error, input);
                }
                throw error;
            }
        }
        const prepared: IEditorMcpPreparedTextWrite = {
            [PREPARED_TEXT_WRITE]: true,
            projectRoot: realpathSync(projectRoot),
            inputJson: JSON.stringify(input),
            files,
        };
        return Object.freeze(prepared);
    }

    /**
     * @description 在已取得原有全资源锁后核对排队前原始身份和全部条件。
     * @param projectRoot 当前实际工程根。
     * @param input 本次任务的原始业务输入。
     * @param prepared 内部规划签发的载荷；缺失或伪造时拒绝。
     * @returns 无返回值。
     */
    public revalidate(projectRoot: string, input: unknown, prepared: IEditorMcpPreparedTextWrite | undefined, session?: EditorMcpTextWriteSession): void {
        if (prepared == null || Object.getOwnPropertyDescriptor(prepared, PREPARED_TEXT_WRITE)?.value !== true
            || !Object.isFrozen(prepared) || !Object.isFrozen(prepared.files)) {
            throw new Error('text_file_io_preparation_missing');
        }
        const guard = new TextFileIoGuard(projectRoot, this._limits);
        guard.assertInputBudget(input);
        if (realpathSync(projectRoot) !== prepared.projectRoot || JSON.stringify(input) !== prepared.inputJson) {
            throw new Error('text_file_io_snapshot_conflict');
        }
        guard.revalidateWrite(input, prepared.files, session);
    }

    /**
     * @description 复用原有静默 writer，在其第一项变化前最后重验整批。
     * @param projectRoot 实际工程路径。
     * @param input 原始业务输入。
     * @param prepared 原有执行器传递的调用局部计划。
     * @returns 原有字段及实际逐文件阶段；最终日志通过前不标已验收。
     */
    public async execute(
        projectRoot: string,
        input: unknown,
        prepared: IEditorMcpPreparedTextWrite | undefined,
        session?: EditorMcpTextWriteSession,
        outcome?: EditorMcpTextWriteOutcome,
    ): Promise<unknown> {
        this.revalidate(projectRoot, input, prepared, session);
        if (prepared == null) {
            throw new Error('text_file_io_preparation_missing');
        }
        return this._write({
            files: prepared.files.map((file) => ({
                path: file.path,
                content: file.content,
                ...(file.expectedSha256 == null ? {} : { expectedSha256: file.expectedSha256 }),
            })),
        }, () => this.revalidate(projectRoot, input, prepared, session), { files: prepared.files, session, outcome });
    }
}
