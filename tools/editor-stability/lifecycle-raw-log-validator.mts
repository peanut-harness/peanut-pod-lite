import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

/**
 * @description Creator 生命周期日志可归属的来源通道。
 */
export type LifecycleLogChannel = 'stdout' | 'stderr' | 'project.log';

/**
 * @description Creator 一次生命周期验收必须记录的有序阶段。
 */
export type LifecycleLogStageName = 'startup' | 'operation' | 'cooldown' | 'exit' | 'delayed_diagnostics';

/**
 * @description 一段按原始字节保留并带有捕获位置、摘要和阶段时间的日志数据。
 * @property channel 日志来源通道。
 * @property reference 仓库相对或验收包相对的稳定文件标识。
 * @property offsetStart 该片段在通道完整原始字节流中的起始偏移。
 * @property offsetEnd 该片段在通道完整原始字节流中的结束偏移。
 * @property capturedAt 该片段完成捕获时的 RFC 3339 时间。
 * @property byteLength 原始字节长度。
 * @property sha256 原始字节的 SHA-256。
 * @property bytes 未解码、未规范化的原始日志字节。
 */
export interface ILifecycleRawLogSegment {
    /**
     * @description 日志来源通道。
     */
    readonly channel: LifecycleLogChannel;
    /**
     * @description 仓库相对或验收包相对的稳定文件标识。
     */
    readonly reference: string;
    /**
     * @description 该片段在通道完整原始字节流中的起始偏移。
     */
    readonly offsetStart: number;
    /**
     * @description 该片段在通道完整原始字节流中的结束偏移。
     */
    readonly offsetEnd: number;
    /**
     * @description 该片段完成捕获时的 RFC 3339 时间。
     */
    readonly capturedAt: string;
    /**
     * @description 原始字节长度。
     */
    readonly byteLength: number;
    /**
     * @description 原始字节的 SHA-256。
     */
    readonly sha256: string;
    /**
     * @description 未解码、未规范化的原始日志字节。
     */
    readonly bytes: Uint8Array;
}

/**
 * @description 一个生命周期阶段的时间区间和三路原始日志片段。
 * @property name 阶段名称。
 * @property startedAt 阶段开始的 RFC 3339 时间。
 * @property endedAt 阶段结束的 RFC 3339 时间。
 * @property logs stdout、stderr 和 project.log 的原始字节片段。
 */
export interface ILifecycleLogStageCapture {
    /**
     * @description 阶段名称。
     */
    readonly name: LifecycleLogStageName;
    /**
     * @description 阶段开始的 RFC 3339 时间。
     */
    readonly startedAt: string;
    /**
     * @description 阶段结束的 RFC 3339 时间。
     */
    readonly endedAt: string;
    /**
     * @description stdout、stderr 和 project.log 的原始字节片段。
     */
    readonly logs: readonly ILifecycleRawLogSegment[];
}

/**
 * @description 绑定当前 Creator 候选、有效隔离工程和完整生命周期日志的验收输入。
 * @property runId 单次验收运行的稳定标识。
 * @property projectName Creator 接受的隔离工程名。
 * @property hostSha256 被测 Host 制品摘要。
 * @property coreSha256 被测 Core 制品摘要。
 * @property stages 按生命周期顺序排列的阶段记录。
 */
export interface ILifecycleLogRunEvidence {
    /**
     * @description 单次验收运行的稳定标识。
     */
    readonly runId: string;
    /**
     * @description Creator 接受的隔离工程名。
     */
    readonly projectName: string;
    /**
     * @description 被测 Host 制品摘要。
     */
    readonly hostSha256: string;
    /**
     * @description 被测 Core 制品摘要。
     */
    readonly coreSha256: string;
    /**
     * @description 按生命周期顺序排列的阶段记录。
     */
    readonly stages: readonly ILifecycleLogStageCapture[];
}

/**
 * @description 原始日志中发现的一条 warning 或 error；不复制日志正文。
 * @property stage 诊断被归属的生命周期阶段。
 * @property channel 诊断来源通道。
 * @property line 通道完整文本流中的行号。
 * @property severity 诊断级别。
 * @property code 稳定诊断代码。
 * @property reference 原始日志引用。
 */
export interface ILifecycleLogDiagnostic {
    /**
     * @description 诊断归属的生命周期阶段。
     */
    readonly stage: LifecycleLogStageName;
    /**
     * @description 诊断来源通道。
     */
    readonly channel: LifecycleLogChannel;
    /**
     * @description 通道完整文本流中的行号。
     */
    readonly line: number;
    /**
     * @description 诊断级别。
     */
    readonly severity: 'warning' | 'error';
    /**
     * @description 稳定诊断代码。
     */
    readonly code: 'raw_warning' | 'raw_error';
    /**
     * @description 原始日志引用。
     */
    readonly reference: string;
}

/**
 * @description 单个生命周期阶段的原始日志完整性与诊断结果。
 * @property name 阶段名称。
 * @property ok 此阶段所有来源摘要有效且没有 warning/error 时为 true。
 * @property diagnostics 此阶段发现的原始诊断。
 */
export interface ILifecycleLogStageResult {
    /**
     * @description 阶段名称。
     */
    readonly name: LifecycleLogStageName;
    /**
     * @description 阶段数据完整且没有 warning/error 时为 true。
     */
    readonly ok: boolean;
    /**
     * @description 此阶段发现的原始诊断。
     */
    readonly diagnostics: readonly ILifecycleLogDiagnostic[];
}

/**
 * @description 单个完整原始日志通道的总字节数和 SHA-256。
 * @property channel 日志来源通道。
 * @property reference 完整原始日志引用。
 * @property byteLength 完整原始字节长度。
 * @property sha256 完整原始字节的 SHA-256。
 */
export interface ILifecycleLogSourceDigest {
    /**
     * @description 日志来源通道。
     */
    readonly channel: LifecycleLogChannel;
    /**
     * @description 完整原始日志引用。
     */
    readonly reference: string;
    /**
     * @description 完整原始字节长度。
     */
    readonly byteLength: number;
    /**
     * @description 完整原始字节的 SHA-256。
     */
    readonly sha256: string;
}

/**
 * @description 生命周期原始日志校验结果；输入日志始终只读。
 * @property ok 全部阶段、来源、身份与原始日志均有效且没有诊断时为 true。
 * @property runId 已校验的运行标识；无效输入时为 null。
 * @property projectName 已校验的工程名；无效输入时为 null。
 * @property stages 每个阶段的通过状态和可追溯诊断。
 * @property sources 完整 stdout、stderr 与 project.log 的字节摘要。
 * @property issues 失败关闭的结构或原始数据问题代码。
 */
export interface ILifecycleLogValidationResult {
    /**
     * @description 全部阶段、来源、身份与原始日志有效且没有诊断时为 true。
     */
    readonly ok: boolean;
    /**
     * @description 已校验的运行标识；输入形状无效时为 null。
     */
    readonly runId: string | null;
    /**
     * @description 已校验的工程名；输入形状无效时为 null。
     */
    readonly projectName: string | null;
    /**
     * @description 每个阶段的通过状态和可追溯诊断。
     */
    readonly stages: readonly ILifecycleLogStageResult[];
    /**
     * @description 完整 stdout、stderr 与 project.log 的字节摘要。
     */
    readonly sources: readonly ILifecycleLogSourceDigest[];
    /**
     * @description 失败关闭的结构或原始数据问题代码。
     */
    readonly issues: readonly string[];
}

interface IParsedRawSegment extends Omit<IParsedSegment, 'stageName'> {}

interface IParsedSegment {
    /**
     * @description 所属的有序生命周期阶段。
     */
    readonly stageName: LifecycleLogStageName;
    /**
     * @description 日志来源通道。
     */
    readonly channel: LifecycleLogChannel;
    /**
     * @description 稳定的相对日志引用。
     */
    readonly reference: string;
    /**
     * @description 通道中的起始字节偏移。
     */
    readonly offsetStart: number;
    /**
     * @description 通道中的结束字节偏移。
     */
    readonly offsetEnd: number;
    /**
     * @description 捕获时间的毫秒时间戳。
     */
    readonly capturedAt: number;
    /**
     * @description 原始片段字节数的声明值。
     */
    readonly byteLength: number;
    /**
     * @description 原始片段 SHA-256 的声明值。
     */
    readonly sha256: string;
    /**
     * @description 未规范化的日志字节。
     */
    readonly bytes: Uint8Array;
}

interface IParsedStage {
    /**
     * @description 阶段名称。
     */
    readonly name: LifecycleLogStageName;
    /**
     * @description 阶段开始的毫秒时间戳。
     */
    readonly startedAt: number;
    /**
     * @description 阶段结束的毫秒时间戳。
     */
    readonly endedAt: number;
    /**
     * @description 该阶段的原始日志片段。
     */
    readonly logs: readonly IParsedSegment[];
}

interface IParsedRun {
    /**
     * @description 单次验收运行标识。
     */
    readonly runId: string;
    /**
     * @description Creator 隔离工程名。
     */
    readonly projectName: string;
    /**
     * @description Host 制品 SHA-256。
     */
    readonly hostSha256: string;
    /**
     * @description Core 制品 SHA-256。
     */
    readonly coreSha256: string;
    /**
     * @description 生命周期阶段记录。
     */
    readonly stages: readonly IParsedStage[];
}

/**
 * @description 对 Creator 生命周期的原始日志按阶段校验，发现任一 warning/error 即失败。
 */
export class LifecycleRawLogValidator {
    /**
     * @description 生命周期中必须分别保留的原始日志来源。
     */
    private static readonly channels: readonly LifecycleLogChannel[] = ['stdout', 'stderr', 'project.log'];
    /**
     * @description 通过验收所需的完整、有序生命周期阶段。
     */
    private static readonly stageNames: readonly LifecycleLogStageName[] = [
        'startup', 'operation', 'cooldown', 'exit', 'delayed_diagnostics',
    ];

    /**
     * @description 校验阶段顺序、候选身份、原始字节摘要和所有来源中的 warning/error。
     * @param input 来自隔离验收器的未知证据输入。
     * @returns 可追溯的阶段结果、完整通道摘要与失败代码。
     */
    public static validate(input: unknown): ILifecycleLogValidationResult {
        const parsed = this.parseRun(input);
        if (parsed === null) return this.invalidResult(['lifecycle_evidence_shape_invalid']);

        const issues: string[] = [];
        if (!this.isIdentifier(parsed.runId)) issues.push('lifecycle_run_id_invalid');
        if (!this.isValidProjectName(parsed.projectName)) issues.push('lifecycle_project_name_invalid');
        if (!this.isSha256(parsed.hostSha256) || !this.isSha256(parsed.coreSha256)) {
            issues.push('lifecycle_candidate_identity_invalid');
        }
        if (parsed.stages.length !== this.stageNames.length) issues.push('lifecycle_stage_count_invalid');

        const stageResults: ILifecycleLogStageResult[] = [];
        const diagnostics: ILifecycleLogDiagnostic[] = [];
        const sourceSegments = new Map<LifecycleLogChannel, IParsedSegment[]>();
        const failedStages = new Set<LifecycleLogStageName>();
        let previousEnd = Number.NEGATIVE_INFINITY;

        for (let index = 0; index < parsed.stages.length; index += 1) {
            const stage = parsed.stages[index];
            const expectedName = this.stageNames[index];
            if (!stage || !expectedName) continue;

            if (stage.name !== expectedName) {
                issues.push(`lifecycle_stage_order_invalid:${expectedName}`);
                failedStages.add(stage.name);
            }
            if (stage.startedAt >= stage.endedAt || stage.startedAt < previousEnd) {
                issues.push(`lifecycle_stage_window_invalid:${stage.name}`);
                failedStages.add(stage.name);
            }
            previousEnd = stage.endedAt;

            const stageChannels = new Set<LifecycleLogChannel>();
            for (const log of stage.logs) {
                if (stageChannels.has(log.channel)) {
                    issues.push(`lifecycle_source_duplicate:${stage.name}:${log.channel}`);
                    failedStages.add(stage.name);
                }
                stageChannels.add(log.channel);
                if (log.capturedAt < stage.startedAt || log.capturedAt > stage.endedAt) {
                    issues.push(`lifecycle_capture_outside_stage:${stage.name}:${log.channel}`);
                    failedStages.add(stage.name);
                }

                const channelSegments = sourceSegments.get(log.channel) ?? [];
                channelSegments.push(log);
                sourceSegments.set(log.channel, channelSegments);
            }

            for (const channel of this.channels) {
                if (!stageChannels.has(channel)) {
                    issues.push(`lifecycle_source_missing:${stage.name}:${channel}`);
                    failedStages.add(stage.name);
                }
            }
        }

        const stageDiagnostics = new Map<LifecycleLogStageName, ILifecycleLogDiagnostic[]>();
        for (const stageName of this.stageNames) stageDiagnostics.set(stageName, []);
        const sources: ILifecycleLogSourceDigest[] = [];

        for (const channel of this.channels) {
            const segments = sourceSegments.get(channel) ?? [];
            let expectedOffset = 0;
            let reference: string | null = null;
            const rawChunks: Uint8Array[] = [];

            for (const segment of segments) {
                if (!this.isSafeReference(segment.reference)) {
                    issues.push(`lifecycle_source_reference_invalid:${channel}`);
                    failedStages.add(segment.stageName);
                }
                if (reference !== null && reference !== segment.reference) {
                    issues.push(`lifecycle_source_reference_changed:${channel}`);
                    failedStages.add(segment.stageName);
                }
                reference = segment.reference;
                if (segment.offsetStart !== expectedOffset || segment.offsetEnd - segment.offsetStart !== segment.bytes.byteLength) {
                    issues.push(`lifecycle_source_offsets_invalid:${channel}`);
                    failedStages.add(segment.stageName);
                }
                expectedOffset = segment.offsetEnd;
                const segmentSha256 = this.sha256(segment.bytes);
                if (segment.byteLength !== segment.bytes.byteLength || segment.sha256 !== segmentSha256) {
                    issues.push(`lifecycle_source_digest_mismatch:${channel}`);
                    failedStages.add(segment.stageName);
                }
                rawChunks.push(segment.bytes);
            }

            if (reference === null) continue;
            const combined = Buffer.concat(rawChunks.map((chunk) => Buffer.from(chunk)));
            const text = this.decodeUtf8(combined);
            if (text === null) {
                issues.push(`lifecycle_source_utf8_invalid:${channel}`);
                for (const segment of segments) failedStages.add(segment.stageName);
                continue;
            }

            sources.push({ channel, reference, byteLength: combined.byteLength, sha256: this.sha256(combined) });
            this.collectDiagnostics(channel, reference, text, segments, stageDiagnostics);
        }

        for (const stageName of this.stageNames) {
            const stageEntries = stageDiagnostics.get(stageName) ?? [];
            diagnostics.push(...stageEntries);
            stageResults.push({ name: stageName, ok: stageEntries.length === 0 && !failedStages.has(stageName), diagnostics: stageEntries });
        }

        return {
            ok: issues.length === 0 && diagnostics.length === 0 && stageResults.length === this.stageNames.length
                && sources.length === this.channels.length,
            runId: parsed.runId,
            projectName: parsed.projectName,
            stages: stageResults,
            sources,
            issues: [...issues, ...diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.stage}:${diagnostic.channel}:${diagnostic.line}`)],
        };
    }

    /**
     * @description 将未知输入缩窄为结构完整的生命周期运行记录。
     * @param value 未知验收数据。
     * @returns 可安全读取的运行记录；形状不完整时返回 null。
     */
    private static parseRun(value: unknown): IParsedRun | null {
        if (!this.isRecord(value) || typeof value.runId !== 'string' || typeof value.projectName !== 'string'
            || typeof value.hostSha256 !== 'string' || typeof value.coreSha256 !== 'string' || !Array.isArray(value.stages)) {
            return null;
        }

        const stages: IParsedStage[] = [];
        for (const rawStage of value.stages) {
            const parsedStage = this.parseStage(rawStage);
            if (parsedStage === null) return null;
            stages.push(parsedStage);
        }
        return {
            runId: value.runId,
            projectName: value.projectName,
            hostSha256: value.hostSha256,
            coreSha256: value.coreSha256,
            stages,
        };
    }

    /**
     * @description 校验单个阶段的时间区间与日志片段结构。
     * @param value 未知阶段记录。
     * @returns 可安全读取的阶段记录；字段错误时返回 null。
     */
    private static parseStage(value: unknown): IParsedStage | null {
        if (!this.isRecord(value) || !this.isStageName(value.name) || typeof value.startedAt !== 'string'
            || typeof value.endedAt !== 'string' || !Array.isArray(value.logs)) return null;
        const startedAt = Date.parse(value.startedAt);
        const endedAt = Date.parse(value.endedAt);
        if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;

        const logs: IParsedSegment[] = [];
        for (const rawLog of value.logs) {
            const parsedLog = this.parseSegment(rawLog);
            if (parsedLog === null) return null;
            logs.push({ ...parsedLog, stageName: value.name });
        }
        return { name: value.name, startedAt, endedAt, logs };
    }

    /**
     * @description 校验一段原始字节、相对引用、偏移、捕获时间和 SHA-256 声明。
     * @param value 未知日志片段。
     * @returns 可安全读取的日志片段；字段错误时返回 null。
     */
    private static parseSegment(value: unknown): IParsedRawSegment | null {
        if (!this.isRecord(value) || !this.isChannel(value.channel) || typeof value.reference !== 'string'
            || typeof value.offsetStart !== 'number' || typeof value.offsetEnd !== 'number'
            || typeof value.capturedAt !== 'string' || typeof value.byteLength !== 'number'
            || typeof value.sha256 !== 'string' || !(value.bytes instanceof Uint8Array)) return null;
        const capturedAt = Date.parse(value.capturedAt);
        if (!Number.isFinite(capturedAt) || !Number.isSafeInteger(value.offsetStart) || !Number.isSafeInteger(value.offsetEnd)
            || !Number.isSafeInteger(value.byteLength) || value.offsetStart < 0 || value.offsetEnd < value.offsetStart
            || value.byteLength < 0) return null;
        return {
            channel: value.channel,
            reference: value.reference,
            offsetStart: value.offsetStart,
            offsetEnd: value.offsetEnd,
            capturedAt,
            byteLength: value.byteLength,
            sha256: value.sha256,
            bytes: value.bytes,
        };
    }

    /**
     * @description 按完整通道字节偏移把每条诊断关联到其完成捕获时所在的阶段。
     * @param channel 原始日志通道。
     * @param reference 原始日志引用。
     * @param text 已严格解码的完整通道文本。
     * @param segments 按阶段顺序排列的原始片段。
     * @param output 按阶段收集的诊断映射。
     * @returns 无返回值；只写入新建的结果集合，不触碰输入字节。
     */
    private static collectDiagnostics(
        channel: LifecycleLogChannel,
        reference: string,
        text: string,
        segments: readonly IParsedSegment[],
        output: Map<LifecycleLogStageName, ILifecycleLogDiagnostic[]>,
    ): void {
        const lines = text.split('\n');
        let byteOffset = 0;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (line === undefined) continue;
            const newlineBytes = index < lines.length - 1 ? 1 : 0;
            const lineBytes = Buffer.byteLength(line, 'utf8') + newlineBytes;
            const eventOffset = Math.max(byteOffset, byteOffset + lineBytes - 1);
            const stage = segments.find((segment) => eventOffset >= segment.offsetStart && eventOffset < segment.offsetEnd);
            const severity = this.severity(line.replace(/\r$/u, ''));
            if (stage && severity) {
                const stageName = stage.stageName;
                const stageEntries = output.get(stageName);
                if (stageEntries) {
                    stageEntries.push({
                        stage: stageName,
                        channel,
                        line: index + 1,
                        severity,
                        code: severity === 'warning' ? 'raw_warning' : 'raw_error',
                        reference,
                    });
                }
            }
            byteOffset += lineBytes;
        }
    }

    /**
     * @description 识别未过滤的原始 warning、error、异常和销毁后访问诊断。
     * @param line 单行原始日志文本。
     * @returns 诊断级别；无诊断时返回 null。
     */
    private static severity(line: string): 'warning' | 'error' | null {
        if (/\b(?:error|exception|failed|failure|unhandled|uncaught)\b|object has been destroyed/iu.test(line)
            || /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|AssertionError)\b/u.test(line)) return 'error';
        if (/\bwarn(?:ing)?\b/iu.test(line)) return 'warning';
        return null;
    }

    /**
     * @description 判断值是否为非数组对象。
     * @param value 未知值。
     * @returns 值是否可按字段读取。
     */
    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /**
     * @description 判断字符串是否是受支持的生命周期阶段名。
     * @param value 未知阶段名。
     * @returns 是否为已登记阶段。
     */
    private static isStageName(value: unknown): value is LifecycleLogStageName {
        return typeof value === 'string' && (value === 'startup' || value === 'operation' || value === 'cooldown'
            || value === 'exit' || value === 'delayed_diagnostics');
    }

    /**
     * @description 判断字符串是否是受支持的原始日志通道。
     * @param value 未知通道名。
     * @returns 是否为已登记通道。
     */
    private static isChannel(value: unknown): value is LifecycleLogChannel {
        return typeof value === 'string' && (value === 'stdout' || value === 'stderr' || value === 'project.log');
    }

    /**
     * @description 校验 Creator 隔离工程名是否为无空格、小写安全 slug。
     * @param value 工程名。
     * @returns 工程名是否有效。
     */
    private static isValidProjectName(value: string): boolean {
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
    }

    /**
     * @description 校验用于证据关联的稳定运行标识。
     * @param value 运行标识。
     * @returns 标识是否仅含受控字母、数字、点、下划线和连字符。
     */
    private static isIdentifier(value: string): boolean {
        return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);
    }

    /**
     * @description 校验 SHA-256 的完整十六进制表示。
     * @param value 摘要字符串。
     * @returns 摘要格式是否有效。
     */
    private static isSha256(value: string): boolean {
        return /^[a-f0-9]{64}$/u.test(value);
    }

    /**
     * @description 拒绝绝对路径、反斜线、空段和路径穿越形式的原始日志引用。
     * @param value 日志引用。
     * @returns 引用是否为安全 POSIX 相对路径。
     */
    private static isSafeReference(value: string): boolean {
        const segments = value.split('/');
        return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,299}$/u.test(value)
            && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
    }

    /**
     * @description 计算原始字节的 SHA-256，不转换或规范化输入。
     * @param bytes 原始日志字节。
     * @returns 小写十六进制摘要。
     */
    private static sha256(bytes: Uint8Array): string {
        return createHash('sha256').update(bytes).digest('hex');
    }

    /**
     * @description 以严格 UTF-8 解码完整通道，拒绝替换字符掩盖的无效字节。
     * @param bytes 完整通道原始字节。
     * @returns 解码文本；无效 UTF-8 时返回 null。
     */
    private static decodeUtf8(bytes: Uint8Array): string | null {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
            return null;
        }
    }

    /**
     * @description 为输入结构无效的情况构造失败关闭结果。
     * @param issues 结构错误代码。
     * @returns 不包含日志正文的失败结果。
     */
    private static invalidResult(issues: readonly string[]): ILifecycleLogValidationResult {
        return { ok: false, runId: null, projectName: null, stages: [], sources: [], issues };
    }
}
