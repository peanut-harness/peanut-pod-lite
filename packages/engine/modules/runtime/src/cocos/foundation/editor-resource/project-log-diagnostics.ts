import { createHash, createHmac, randomBytes } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import type { IProjectLogQuery, IProjectLogQueryResult, IProjectLogLine, IProjectLogMatch, ProjectLogQueryMode } from '@peanut/pod-protocol';

import { ProjectLogDiagnosticsPolicy } from './project-log-diagnostics-policy.js';
import { ProjectLogPostflightMonitor } from './project-log-postflight-monitor.js';

/**
 * @description 经签名的文件身份与续读位置。
 */
interface ILogCursor {
    /**
     * @description 工程、inode和创建时间绑定摘要。
     */
    readonly identity: string;
    /**
     * @description 同模式读取位置。
     */
    readonly offset: number;
    /**
     * @description 游标之前最多64字节的摘要。
     */
    readonly anchor: string;
    /**
     * @description 游标用途，阻止误用尾读边界。
     */
    readonly mode: ProjectLogQueryMode;
    /**
     * @description 游标建立时冻结的日志长度。
     */
    readonly size: number;
    /**
     * @description 建立时的修改时间，用于识别原位等长改写。
     */
    readonly modified: number;
    /**
     * @description 前缀指纹的冻结长度。
     */
    readonly headLength: number;
    /**
     * @description 前缀内容指纹。
     */
    readonly head: string;
}

/**
 * @description 复用工程日志定位，以有界文件读取实现诊断，不改变postflight规则。
 */
export class ProjectLogDiagnostics {
    /**
     * @description 同宿主内跨router共享的游标密钥，进程重启后旧游标失效。
     */
    private static readonly _cursorKey = randomBytes(32);
    /**
     * @description 既有工程日志定位器。
     */
    private readonly _monitor = new ProjectLogPostflightMonitor();
    /**
     * @description 本次同步查询的实际读取字节数。
     */
    private _bytesRead = 0;

    /**
     * @description 验证输入后读取当前工程日志；所有句柄在成功或失败时关闭。
     * @param projectRoot 当前绑定工程根。
     * @param input 不包含任意路径的查询。
     * @returns 容量受限的观测或结构化失败。
     */
    public query(projectRoot: string, input: IProjectLogQuery): IProjectLogQueryResult {
        this.validate(input);
        this._bytesRead = 0;
        let fd: number | undefined;
        try {
            const root = realpathSync(projectRoot);
            const file = realpathSync(this._monitor.resolveLogPath(root));
            const location = relative(root, file);
            if (location === '..' || location.startsWith(`..${sep}`) || resolve(root, location) !== file) {
                return this._failure('log_path_escape');
            }
            fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
            const stat = fstatSync(fd);
            if (!stat.isFile()) return this._failure('log_not_regular_file');
            const identity = this._hash(`${root}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`);
            const cursor = input.cursor == null ? null : this._decodeCursor(input.cursor);
            if (cursor != null && (cursor.identity !== identity || cursor.mode !== input.mode || cursor.offset > stat.size
                || stat.size < cursor.size || stat.size === cursor.size && stat.mtimeMs !== cursor.modified
                || cursor.head !== this._anchor(fd, cursor.headLength)
                || cursor.anchor !== this._anchor(fd, cursor.offset))) return this._failure('log_cursor_reset', true);
            const result = this._read(fd, stat.size, identity, input, cursor);
            const after = fstatSync(fd);
            const current = realpathSync(this._monitor.resolveLogPath(root));
            const currentStat = statSync(current);
            if (currentStat.ino !== stat.ino || currentStat.dev !== stat.dev || after.ino !== stat.ino || after.size < stat.size || after.mtimeMs !== stat.mtimeMs || current !== file) {
                return this._failure('log_changed_during_read', true);
            }
            return result;
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? Reflect.get(error, 'code') : undefined;
            if (code === 'ENOENT') return this._failure('log_missing');
            if (code === 'EACCES' || code === 'EPERM') return this._failure('log_unreadable');
            return this._failure(error instanceof Error && error.message.startsWith('log_cursor_') ? error.message : 'log_read_failed');
        } finally {
            if (fd != null) closeSync(fd);
        }
    }

    /**
     * @description 独立校验在执行前和直调路径均生效。
     * @param input 不可信的协议对象。
     * @returns 校验成功无返回值。
     */
    public validate(input: unknown): asserts input is IProjectLogQuery {
        if (!this._isRecord(input)) throw new Error('log_query_invalid');
        const known = new Set(['mode', 'cursor', 'contains', 'levels', 'limit', 'contextBefore', 'contextAfter']);
        if (Object.keys(input).some((key) => !known.has(key))) throw new Error('log_query_unknown_field');
        if (typeof input.mode !== 'string' || !['tail', 'delta', 'search'].includes(input.mode)) throw new Error('log_query_mode_invalid');
        if (input.cursor != null && (typeof input.cursor !== 'string' || input.cursor.length > 2048)) throw new Error('log_cursor_invalid');
        if (input.contains != null && (typeof input.contains !== 'string' || Buffer.byteLength(input.contains) > 1024)) throw new Error('log_query_contains_invalid');
        if (input.levels != null && (!Array.isArray(input.levels) || input.levels.length > 6
            || input.levels.some((level: unknown) => typeof level !== 'string' || !['error', 'warn', 'info', 'debug', 'trace', 'unknown'].includes(level)))) throw new Error('log_query_levels_invalid');
        for (const [name, value, max, min] of [
            ['limit', input.limit, ProjectLogDiagnosticsPolicy.matches, 1],
            ['contextBefore', input.contextBefore, ProjectLogDiagnosticsPolicy.context, 0],
            ['contextAfter', input.contextAfter, ProjectLogDiagnosticsPolicy.context, 0],
        ] as const) {
            if (value != null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)) throw new Error(`log_query_${name}_invalid`);
        }
    }

    /**
     * @description 从公开边界解析输入，保留未知字段拒绝语义。
     * @param input 外部参数。
     * @returns 已验证的日志查询。
     */
    public readInput(input: unknown): IProjectLogQuery {
        this.validate(input);
        return input;
    }

    /**
     * @description 缩窄外部对象而不绕过类型检查。
     * @param value 待验证值。
     * @returns 是否为参数记录。
     */
    private _isRecord(value: unknown): value is Record<string, unknown> {
        return value != null && typeof value === 'object' && !Array.isArray(value);
    }

    /**
     * @description 扫描一个固定字节窗口并组装按方向分页的结果。
     * @param fd 已验证文件句柄。
     * @param size 冻结文件大小。
     * @param identity 当前日志身份。
     * @param input 已验证查询。
     * @param cursor 已验证续读位置。
     * @returns 不超预算的结果。
     */
    private _read(fd: number, size: number, identity: string, input: IProjectLogQuery, cursor: ILogCursor | null): IProjectLogQueryResult {
        const backwards = input.mode === 'tail';
        const boundary = cursor?.offset ?? (backwards ? size : 0);
        const overlap = ProjectLogDiagnosticsPolicy.context * ProjectLogDiagnosticsPolicy.fragmentBytes;
        const budget = ProjectLogDiagnosticsPolicy.scanBytes - 6 * ProjectLogDiagnosticsPolicy.anchorBytes - 2 * overlap;
        const start = backwards ? Math.max(0, boundary - budget) : boundary;
        const end = backwards ? boundary : Math.min(size, start + budget);
        const readStart = Math.max(0, start - overlap);
        const readEnd = Math.min(size, end + overlap);
        const bytes = Buffer.alloc(readEnd - readStart);
        const scanned = readSync(fd, bytes, 0, bytes.length, readStart);
        this._bytesRead += scanned;
        const active = this._lines(bytes.subarray(start - readStart, end - readStart), start, end < size, backwards && start > 0);
        const lines = [
            ...this._lines(bytes.subarray(0, start - readStart), readStart, true, readStart > 0),
            ...active,
            ...this._lines(bytes.subarray(end - readStart, scanned), end, readEnd < size, true),
        ];
        const limit = input.limit ?? ProjectLogDiagnosticsPolicy.matches;
        const before = input.contextBefore ?? ProjectLogDiagnosticsPolicy.defaultContext;
        const after = input.contextAfter ?? ProjectLogDiagnosticsPolicy.defaultContext;
        const matches: IProjectLogMatch[] = [];
        const indexes = lines.map((_, index) => index).filter((index) => lines[index].offset >= start && lines[index].offset < end);
        if (backwards) indexes.reverse();
        let position = backwards ? (active[0]?.offset ?? start) : end;
        let cut = false;
        for (const index of indexes) {
            const line = lines[index];
            const lineEnd = line.offset + Buffer.byteLength(line.text);
            if (input.contains != null && !line.text.includes(input.contains)
                || input.levels != null && !input.levels.includes(line.level)) continue;
            const item = { line, before: lines.slice(Math.max(0, index - before), index), after: lines.slice(index + 1, index + 1 + after) };
            if (matches.length >= limit || Buffer.byteLength(JSON.stringify([...matches, item])) > ProjectLogDiagnosticsPolicy.responseBytes - 4096) {
                position = backwards ? lineEnd : line.offset;
                cut = true;
                break;
            }
            matches.push(item);
        }
        if (backwards) matches.reverse();
        const last = active[active.length - 1];
        const consumed = last == null ? start : last.offset + Buffer.byteLength(last.text);
        const pendingLine = end === size && consumed < end;
        if (!cut && !backwards) position = consumed;
        const more = cut || (backwards ? start > 0 : end < size);
        const fragment = matches.some((item) => item.line.fragment);
        const result: IProjectLogQueryResult = {
            ok: true, source: 'project_log', matches, complete: !more && !fragment && !pendingLine,
            truncated: more || fragment, resetDetected: false,
            nextCursor: more ? this._encodeCursor(fd, identity, position, input.mode) : null,
            followCursor: this._encodeCursor(fd, identity, backwards ? consumed : position, 'delta'),
            scannedBytes: this._bytesRead,
            pendingLine, failureCode: null,
        };
        if (Buffer.byteLength(JSON.stringify(result)) > ProjectLogDiagnosticsPolicy.responseBytes) throw new Error('log_response_budget');
        return result;
    }

    /**
     * @description 在字节边界保留完整UTF-8，并切分带偏移的行或超长行片段。
     * @param bytes 固定窗口。
     * @param start 窗口起点。
     * @param hasFollowing 后续是否还有窗口。
     * @param partialStart 是否从行中间开始。
     * @returns 完整行及显式片段，保留末尾未完成行。
     */
    private _lines(bytes: Buffer, start: number, hasFollowing: boolean, partialStart: boolean): IProjectLogLine[] {
        const lines: IProjectLogLine[] = [];
        let index = 0;
        while (index < bytes.length && (bytes[index] & 0xc0) === 0x80) index += 1;
        while (index < bytes.length) {
            const newline = bytes.indexOf(10, index);
            const lineEnd = newline < 0 ? bytes.length : newline + 1;
            if (newline < 0 && !hasFollowing && lineEnd - index <= ProjectLogDiagnosticsPolicy.fragmentBytes) break;
            let end = Math.min(lineEnd, index + ProjectLogDiagnosticsPolicy.fragmentBytes);
            while (end > index && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
            if (end === bytes.length && newline < 0) {
                let lead = end - 1;
                while (lead > index && (bytes[lead] & 0xc0) === 0x80) lead -= 1;
                const first = bytes[lead];
                const width = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
                if (end - lead < width) end = lead;
            }
            if (end === index) break;
            const text = bytes.subarray(index, end).toString('utf8');
            const level = /(?: - |\[)(error|warn|info|debug|trace)(?:\]|:)/iu.exec(text)?.[1].toLowerCase() ?? 'unknown';
            lines.push({ offset: start + index, text, level, fragment: partialStart || end < lineEnd || newline < 0 });
            partialStart = end < lineEnd;
            index = end;
        }
        return lines;
    }

    /**
     * @description 为日志位置计算小范围内容指纹。
     * @param fd 当前日志句柄。
     * @param offset 位置。
     * @returns 锚点摘要。
     */
    private _anchor(fd: number, offset: number): string {
        const bytes = Buffer.alloc(Math.min(offset, ProjectLogDiagnosticsPolicy.anchorBytes));
        const count = readSync(fd, bytes, 0, bytes.length, offset - bytes.length);
        this._bytesRead += count;
        return this._hash(bytes.subarray(0, count));
    }

    /**
     * @description 签名当前工程日志游标，不暴露工程绝对路径。
     * @param fd 当前句柄。
     * @param identity 文件身份。
     * @param offset 续读偏移。
     * @param mode 读取方向。
     * @returns 签名游标。
     */
    private _encodeCursor(fd: number, identity: string, offset: number, mode: ProjectLogQueryMode): string {
        const stat = fstatSync(fd);
        const headLength = Math.min(stat.size, ProjectLogDiagnosticsPolicy.anchorBytes);
        const payload = Buffer.from(JSON.stringify({ identity, offset, anchor: this._anchor(fd, offset), mode,
            size: stat.size, modified: stat.mtimeMs, headLength, head: this._anchor(fd, headLength) })).toString('base64');
        return `${payload}.${this._signature(payload)}`;
    }

    /**
     * @description 拒绝伪造、跨用途或无效位置的游标。
     * @param value 外部游标。
     * @returns 已验证的内部位置。
     */
    private _decodeCursor(value: string): ILogCursor {
        const [payload, signature, extra] = value.split('.');
        if (extra != null || this._signature(payload) !== signature) throw new Error('log_cursor_invalid');
        const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        if (parsed == null || typeof parsed !== 'object') throw new Error('log_cursor_invalid');
        const identity = Reflect.get(parsed, 'identity');
        const offset = Reflect.get(parsed, 'offset');
        const anchor = Reflect.get(parsed, 'anchor');
        const mode = Reflect.get(parsed, 'mode');
        const size: unknown = Reflect.get(parsed, 'size');
        const modified: unknown = Reflect.get(parsed, 'modified');
        const headLength: unknown = Reflect.get(parsed, 'headLength');
        const head: unknown = Reflect.get(parsed, 'head');
        if (typeof identity !== 'string' || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
            || typeof anchor !== 'string' || !['tail', 'delta', 'search'].includes(mode)) throw new Error('log_cursor_invalid');
        if (mode !== 'tail' && mode !== 'delta' && mode !== 'search') throw new Error('log_cursor_invalid');
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < offset
            || typeof modified !== 'number' || !Number.isFinite(modified)
            || typeof headLength !== 'number' || !Number.isSafeInteger(headLength) || headLength < 0
            || headLength > ProjectLogDiagnosticsPolicy.anchorBytes || typeof head !== 'string') throw new Error('log_cursor_invalid');
        return { identity, offset, anchor, mode, size, modified, headLength, head };
    }

    /**
     * @description 为游标提供宿主内完整性保护。
     * @param value 待签名内容。
     * @returns HMAC摘要。
     */
    private _signature(value: string): string {
        return createHmac('sha256', ProjectLogDiagnostics._cursorKey).update(value).digest('hex');
    }

    /**
     * @description 计算不含原文的内容摘要。
     * @param value 字节或文本。
     * @returns SHA256摘要。
     */
    private _hash(value: string | Buffer): string {
        return createHash('sha256').update(value).digest('hex');
    }

    /**
     * @description 返回明确失败，不将不可读日志当空日志。
     * @param failureCode 稳定原因。
     * @param resetDetected 是否需要重置游标。
     * @returns 无成功验收信号的失败对象。
     */
    private _failure(failureCode: string, resetDetected = false): IProjectLogQueryResult {
        return { ok: false, source: 'project_log', matches: [], complete: false, truncated: false,
            resetDetected, nextCursor: null, followCursor: null, scannedBytes: 0, pendingLine: false, failureCode };
    }
}
