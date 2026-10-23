/**
 * @description 日志诊断可用的读取方向。
 */
export type ProjectLogQueryMode = 'tail' | 'delta' | 'search';

/**
 * @description 当前工程的有界日志查询输入，不接受文件路径。
 */
export interface IProjectLogQuery {
    /**
     * @description 尾读、增量或顺序搜索。
     */
    readonly mode: ProjectLogQueryMode;
    /**
     * @description 上次返回的签名续读游标。
     */
    readonly cursor?: string;
    /**
     * @description 字面关键词，区分大小写。
     */
    readonly contains?: string;
    /**
     * @description 匹配项级别过滤；无法识别为unknown。
     */
    readonly levels?: readonly string[];
    /**
     * @description 返回匹配项数量，最大100。
     */
    readonly limit?: number;
    /**
     * @description 匹配前上下文数量，最大10。
     */
    readonly contextBefore?: number;
    /**
     * @description 匹配后上下文数量，最大10。
     */
    readonly contextAfter?: number;
}

/**
 * @description 带位置的原始日志片段。
 */
export interface IProjectLogLine {
    /**
     * @description 日志字节偏移。
     */
    readonly offset: number;
    /**
     * @description 保留原始换行与堆栈的文本。
     */
    readonly text: string;
    /**
     * @description 显式级别或unknown。
     */
    readonly level: string;
    /**
     * @description 是否因超长行或扫描边界仅返回片段。
     */
    readonly fragment: boolean;
}

/**
 * @description 一次关键词匹配及其原始上下文。
 */
export interface IProjectLogMatch {
    /**
     * @description 匹配行或有界片段。
     */
    readonly line: IProjectLogLine;
    /**
     * @description 原始前置上下文。
     */
    readonly before: readonly IProjectLogLine[];
    /**
     * @description 原始后置上下文。
     */
    readonly after: readonly IProjectLogLine[];
}

/**
 * @description 不含工程验收判定的日志观测结果。
 */
export interface IProjectLogQueryResult {
    /**
     * @description 是否成功读取一致快照。
     */
    readonly ok: boolean;
    /**
     * @description 固定来源。
     */
    readonly source: 'project_log';
    /**
     * @description 匹配项及上下文。
     */
    readonly matches: readonly IProjectLogMatch[];
    /**
     * @description 本查询是否覆盖剩余范围且无截断。
     */
    readonly complete: boolean;
    /**
     * @description 结果、扫描或片段是否被截断。
     */
    readonly truncated: boolean;
    /**
     * @description 游标身份是否失效，需重新查询。
     */
    readonly resetDetected: boolean;
    /**
     * @description 同模式下一页游标；无下一页时为null。
     */
    readonly nextCursor: string | null;
    /**
     * @description 已完成行之后的增量跟随游标。
     */
    readonly followCursor: string | null;
    /**
     * @description 本次扫描字节数。
     */
    readonly scannedBytes: number;
    /**
     * @description 尚未完成的尾行，后续增量仍可读取。
     */
    readonly pendingLine: boolean;
    /**
     * @description 可诊断失败代码；成功时为null。
     */
    readonly failureCode: string | null;
}

