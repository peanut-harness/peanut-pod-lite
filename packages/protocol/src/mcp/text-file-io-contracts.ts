import type { IMcpExecutionControl } from './mcp-capability-contracts.js';

/**
 * @description 文本批量读写的注入容量；字节预算针对完整 UTF-8 JSON 请求及响应。
 */
export interface ITextFileIoLimits {
    /**
     * @description 单次调用允许的最大文件数。
     */
    readonly maxFiles: number;
    /**
     * @description 单文件原始 UTF-8 内容的最大字节数。
     */
    readonly maxFileBytes: number;
    /**
     * @description 编码后完整请求的最大字节数。
     */
    readonly maxInputBytes: number;
    /**
     * @description 编码后完整响应的最大字节数。
     */
    readonly maxOutputBytes: number;
}

/**
 * @description 文本读取只接受单路径或路径列表之一；路径必须位于工程真实 assets 根内。
 */
export type TextFileReadInput =
    | {
        /**
         * @description 单文件路径。
         */
        readonly path: string;
        /**
         * @description 单文件形式禁止批量路径。
         */
        readonly paths?: never;
    }
    | {
        /**
         * @description 批量形式禁止单路径。
         */
        readonly path?: never;
        /**
         * @description 按输入顺序处理的有界路径列表。
         */
        readonly paths: readonly string[];
    };

/**
 * @description 写入前内容条件；有效值为 64 位十六进制 SHA-256 或表示不存在的 absent。
 */
export type TextFileExpectedSha256 = string;

/**
 * @description 一项完整的 UTF-8 文本写入；省略哈希条件时保持旧行为。
 */
export interface ITextFileWriteEntry {
    /**
     * @description 工程 assets 内的目标路径。
     */
    readonly path: string;
    /**
     * @description 原样保存的文本，保留 BOM、换行和 Unicode。
     */
    readonly content: string;
    /**
     * @description 首次写入前必须再次满足的内容条件。
     */
    readonly expectedSha256?: TextFileExpectedSha256;
}

/**
 * @description 兼容原有单文件和 files 优先形式的文本写入输入；审批与执行控制不授予额外权限。
 */
export interface ITextFileWriteInput {
    /**
     * @description 单文件路径；提供 files 时忽略。
     */
    readonly path?: string;
    /**
     * @description 单文件内容；提供 files 时忽略。
     */
    readonly content?: string;
    /**
     * @description 单文件哈希条件；提供 files 时忽略。
     */
    readonly expectedSha256?: TextFileExpectedSha256;
    /**
     * @description 有界批量写入列表；存在时优先于所有单文件字段。
     */
    readonly files?: readonly ITextFileWriteEntry[];
    /**
     * @description 已有本地审批租约标识。
     */
    readonly approvalId?: string;
    /**
     * @description 已有审批租约的兼容别名。
     */
    readonly approvalToken?: string;
    /**
     * @description 已有破坏性操作确认字段。
     */
    readonly confirmDestructive?: boolean;
    /**
     * @description 已有声明资源字段；授权仍包含全部推导资源。
     */
    readonly resources?: readonly string[];
    /**
     * @description 原有同步、异步、幂等和超时控制。
     */
    readonly execution?: IMcpExecutionControl;
}

/**
 * @description 同一工程 revision 内成功读取的一项内容。
 */
export interface ITextFileReadSuccess {
    /**
     * @description 归一化工程路径。
     */
    readonly path: string;
    /**
     * @description 成功读取状态。
     */
    readonly status: 'read';
    /**
     * @description 原样解码且通过 UTF-8 校验的内容。
     */
    readonly content: string;
    /**
     * @description 原始内容字节数。
     */
    readonly byteCount: number;
    /**
     * @description 原始内容 SHA-256。
     */
    readonly sha256: string;
    /**
     * @description 本次稳定快照的工程 revision。
     */
    readonly revision: number;
}

/**
 * @description 单文件读取失败；不得用空内容冒充成功。
 */
export interface ITextFileReadFailure {
    /**
     * @description 对应输入路径。
     */
    readonly path: string;
    /**
     * @description 明确的失败状态。
     */
    readonly status: 'failed';
    /**
     * @description 无原始内容的稳定失败码。
     */
    readonly code: string;
}

/**
 * @description 逐文件读取结果；只有全部成功且一致时才允许整体成功。
 */
export type TextFileReadOutcome = ITextFileReadSuccess | ITextFileReadFailure;

/**
 * @description 保持输入顺序的读取业务结果，外层 MCP 失败规则仍然适用。
 */
export interface ITextFileReadResult {
    /**
     * @description 文本读写契约版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description 全部文件均读取成功且快照一致。
     */
    readonly ok: boolean;
    /**
     * @description 是否通过 writer 屏障和外部文件变化复核。
     */
    readonly consistent: boolean;
    /**
     * @description 稳定工程 revision；未取得稳定快照时为空。
     */
    readonly revision: number | null;
    /**
     * @description 与输入顺序一致的逐文件结果。
     */
    readonly files: readonly TextFileReadOutcome[];
}

/**
 * @description 逐文件写入结果；written_unverified 表示已写入但未完成验收。
 */
export type TextFileWriteStatus = 'verified' | 'written_unverified' | 'failed' | 'not_started';

/**
 * @description 写入后内容和 AssetDB 身份证据；未知值为空，不能伪造已验收状态。
 */
export interface ITextFileWriteOutcome {
    /**
     * @description 归一化工程路径。
     */
    readonly path: string;
    /**
     * @description 本文件实际完成状态。
     */
    readonly status: TextFileWriteStatus;
    /**
     * @description 复核得到的内容字节数；未复核时为空。
     */
    readonly bytes: number | null;
    /**
     * @description writer 首次变化前复核的真实内容摘要；目标不存在时为 absent，未取得证据时为空。
     */
    readonly beforeSha256: TextFileExpectedSha256 | null;
    /**
     * @description 写入后复核得到的内容哈希；未复核时为空，不能以预期内容摘要代替。
     */
    readonly sha256: string | null;
    /**
     * @description 已核实的 AssetDB UUID；未知时为空。
     */
    readonly uuid: string | null;
    /**
     * @description 失败或未验收的稳定原因码。
     */
    readonly code?: string;
}

/**
 * @description 按输入顺序返回写入业务结果；受管任务回执和 postflight 保持原协议。
 */
export interface ITextFileWriteResult {
    /**
     * @description 文本读写契约版本。
     */
    readonly schemaVersion: 1;
    /**
     * @description 全部文件内容、身份及统一 postflight 均已验收。
     */
    readonly ok: boolean;
    /**
     * @description 整体项目状态；部分写入失败时必须保守标为 may_have_changed。
     */
    readonly projectState: 'not_started' | 'unchanged' | 'may_have_changed' | 'verified';
    /**
     * @description 与输入顺序一致的逐文件写入证据。
     */
    readonly files: readonly ITextFileWriteOutcome[];
}

/**
 * @description 失败结果投影的调用方容量和任务路径边界。
 */
export interface ITextFileWriteProjectionLimits {
    /**
     * @description 调用方实际允许的文件数量。
     */
    readonly maxFiles: number;
    /**
     * @description 单文件实际字节上限。
     */
    readonly maxFileBytes: number;
    /**
     * @description 整个投影的 UTF-8 JSON 字节上限。
     */
    readonly maxOutputBytes: number;
    /**
     * @description 原始受理任务的有序路径；提供后必须逐项匹配。
     */
    readonly paths?: readonly string[];
}

/**
 * @description 共享纯投影器，只公开有限逐文件证据，不执行访问器或拷贝源码。
 */
export class TextFileWriteResultProjection {
    /**
     * @description 校验并重建有限公共 DTO，未知结构失败关闭。
     * @param value 未受信附件。
     * @param limits 当前任务或公开传输容量。
     * @returns 独立安全投影；无效数据返回 null。
     */
    public static project(value: unknown, limits: ITextFileWriteProjectionLimits): ITextFileWriteResult | null {
        try {
            if (![limits.maxFiles, limits.maxFileBytes, limits.maxOutputBytes].every((n) => Number.isSafeInteger(n) && n > 0)
                || !this._record(value, ['schemaVersion', 'ok', 'projectState', 'files'])
                || value.schemaVersion !== 1 || typeof value.ok !== 'boolean'
                || typeof value.projectState !== 'string' || !['not_started', 'unchanged', 'may_have_changed', 'verified'].includes(value.projectState)
                || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > limits.maxFiles
                || Reflect.ownKeys(value.files).length !== value.files.length + 1
                || limits.paths != null && limits.paths.length !== value.files.length) {
                return null;
            }
            const files: ITextFileWriteOutcome[] = [];
            for (let index = 0; index < value.files.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value.files, index);
                const file: unknown = descriptor?.value;
                if (descriptor?.get != null || descriptor?.set != null
                    || !this._record(file, ['path', 'status', 'bytes', 'beforeSha256', 'sha256', 'uuid', 'code'])
                    || typeof file.path !== 'string' || file.path.length > 4096 || !file.path.startsWith('assets/')
                    || file.path.split('/').some((part) => part === '' || part === '.' || part === '..')
                    || /[\\\u0000-\u001f]/u.test(file.path) || file.path.endsWith('.meta')
                    || limits.paths != null && limits.paths[index] !== file.path
                    || typeof file.status !== 'string' || !['verified', 'written_unverified', 'failed', 'not_started'].includes(file.status)
                    || file.bytes !== null && (!Number.isSafeInteger(file.bytes) || typeof file.bytes !== 'number' || file.bytes < 0 || file.bytes > limits.maxFileBytes)
                    || !this._hash(file.beforeSha256, true) || !this._hash(file.sha256, false)
                    || file.uuid !== null && (typeof file.uuid !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(file.uuid))
                    || file.code !== undefined && (typeof file.code !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/u.test(file.code))) {
                    return null;
                }
                if (file.status === 'verified' && (file.bytes === null || file.beforeSha256 === null || file.sha256 === null || file.uuid === null)
                    || file.status === 'not_started' && (file.bytes !== null || file.sha256 !== null || file.uuid !== null)) {
                    return null;
                }
                files.push({ path: file.path, status: file.status as TextFileWriteStatus, bytes: file.bytes as number | null,
                    beforeSha256: file.beforeSha256 as string | null, sha256: file.sha256 as string | null,
                    uuid: file.uuid as string | null, ...(typeof file.code === 'string' ? { code: file.code } : {}) });
            }
            const allVerified = files.every((file) => file.status === 'verified');
            if (value.ok !== allVerified || value.ok !== (value.projectState === 'verified')
                || !value.ok && files.some((file) => file.status === 'verified')
                || value.projectState === 'not_started' && files.some((file) => file.status !== 'not_started')
                || value.projectState === 'unchanged' && files.some((file) => file.status === 'written_unverified')) {
                return null;
            }
            const result: ITextFileWriteResult = { schemaVersion: 1, ok: value.ok,
                projectState: value.projectState as ITextFileWriteResult['projectState'], files };
            const json = JSON.stringify(result);
            let bytes = 0;
            for (const char of json) {
                const point = char.codePointAt(0) ?? 0;
                bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
                if (bytes > limits.maxOutputBytes) {
                    return null;
                }
            }
            return result;
        } catch {
            return null;
        }
    }

    /**
     * @description 校验纯数据对象及有限允许字段，不读取访问器。
     * @param value 候选对象。
     * @param keys 允许的公共键。
     * @returns 是否为安全记录。
     */
    private static _record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
        if (value === null || typeof value !== 'object' || Array.isArray(value)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
            return false;
        }
        return Reflect.ownKeys(value).every((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return typeof key === 'string' && keys.includes(key) && descriptor?.enumerable === true
                && descriptor.get == null && descriptor.set == null;
        });
    }

    /**
     * @description 校验真实摘要及明确不存在标记。
     * @param value 候选摘要。
     * @param absent 是否允许不存在。
     * @returns 是否有效。
     */
    private static _hash(value: unknown, absent: boolean): boolean {
        return value === null || typeof value === 'string' && (/^[0-9a-f]{64}$/u.test(value) || absent && value === 'absent');
    }
}
