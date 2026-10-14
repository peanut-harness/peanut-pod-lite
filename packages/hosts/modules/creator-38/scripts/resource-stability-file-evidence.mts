import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * @description 从一次隔离运行的原始文件恢复日志 bytes，拒绝相对路径逃逸与 symlink 外指。
 */
export class ResourceStabilityFileEvidenceReader {
    /**
     * @description 单段 raw 日志最大字节数；超限拒绝，不截断。
     */
    private readonly _maxSegmentBytes: number;
    /**
     * @description 一次运行最大累计原始 bytes；超限不能生成通过结论。
     */
    private readonly _maxRunBytes: number;
    /**
     * @description 已登记证据目录的真实根。
     */
    private readonly _root: string;

    /**
     * @description 容量由调用者明确注入，避免将过大的原始日志载入内存。
     * @param root 当前隔离运行的证据目录。
     * @param maxSegmentBytes 单段字节上限。
     * @param maxRunBytes 整次运行字节上限。
     */
    public constructor(root: string, maxSegmentBytes: number, maxRunBytes: number) {
        if (!Number.isSafeInteger(maxSegmentBytes) || maxSegmentBytes <= 0
            || !Number.isSafeInteger(maxRunBytes) || maxRunBytes < maxSegmentBytes) {
            throw new Error('resource_raw_budget_invalid');
        }
        this._root = realpathSync(root);
        if (!statSync(this._root).isDirectory()) throw new Error('resource_raw_root_not_directory');
        this._maxSegmentBytes = maxSegmentBytes;
        this._maxRunBytes = maxRunBytes;
    }

    /**
     * @description 读取有限 JSON envelope；body 中的 bytes 不可信，必须替换为原始文件片段。
     * @param reference evidence root 内相对引用。
     * @returns 可交给原始阶段校验器的未知输入。
     */
    public readLifecycle(reference: string): unknown {
        const bodyPath = this.path(reference);
        const fd = openSync(bodyPath, 'r');
        let parsed: unknown;
        try {
            const size = fstatSync(fd).size;
            if (size > 1024 * 1024) throw new Error('resource_raw_envelope_too_large');
            const body = Buffer.alloc(size);
            let read = 0;
            while (read < size) {
                const count = readSync(fd, body, read, size - read, read);
                if (count === 0) throw new Error('resource_raw_envelope_changed');
                read += count;
            }
            if (fstatSync(fd).size !== size) throw new Error('resource_raw_envelope_changed');
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        } finally { closeSync(fd); }
        if (!this.record(parsed) || !Array.isArray(parsed.stages)) throw new Error('resource_raw_envelope_invalid');
        let total = 0;
        const ends = new Map<string, number>();
        const stages = parsed.stages.map((stage: unknown) => {
            if (!this.record(stage) || !Array.isArray(stage.logs)) throw new Error('resource_raw_stage_invalid');
            const logs = stage.logs.map((log: unknown) => {
                if (!this.record(log) || typeof log.reference !== 'string' || typeof log.offsetStart !== 'number'
                    || typeof log.offsetEnd !== 'number' || !Number.isSafeInteger(log.offsetStart)
                    || !Number.isSafeInteger(log.offsetEnd) || log.offsetStart < 0 || log.offsetEnd < log.offsetStart) {
                    throw new Error('resource_raw_segment_invalid');
                }
                const length = log.offsetEnd - log.offsetStart;
                total += length;
                if (length > this._maxSegmentBytes || total > this._maxRunBytes) throw new Error('resource_raw_budget_exceeded');
                ends.set(log.reference, Math.max(ends.get(log.reference) ?? 0, log.offsetEnd));
                return { ...log, bytes: this.readSegment(log.reference, log.offsetStart, length) };
            });
            return { ...stage, logs };
        });
        for (const [reference, end] of ends) {
            if (statSync(this.path(reference)).size !== end) throw new Error('resource_raw_unattributed_trailing_bytes');
        }
        return { ...parsed, stages };
    }

    /**
     * @description 按源文件原始偏移读取，短读或源截断拒绝；不使用 envelope 内嵌字节。
     */
    private readSegment(reference: string, offset: number, length: number): Uint8Array {
        const fd = openSync(this.path(reference), 'r');
        try {
            if (offset + length > fstatSync(fd).size) throw new Error('resource_raw_source_truncated');
            const bytes = Buffer.alloc(length);
            let read = 0;
            while (read < length) {
                const count = readSync(fd, bytes, read, length - read, offset + read);
                if (count === 0) throw new Error('resource_raw_source_truncated');
                read += count;
            }
            return bytes;
        } finally { closeSync(fd); }
    }

    /**
     * @description 只接受证据根内的普通相对文件引用。
     */
    private path(reference: string): string {
        if (isAbsolute(reference) || reference.includes('\\') || reference.includes(':')
            || reference.split('/').some((p) => p === '.' || p === '..' || p === '')) {
            throw new Error('resource_raw_reference_invalid');
        }
        const actual = realpathSync(resolve(this._root, reference));
        if (!actual.startsWith(`${this._root}${sep}`)) throw new Error('resource_raw_reference_escape');
        if (!statSync(actual).isFile()) throw new Error('resource_raw_reference_not_file');
        return actual;
    }

    /**
     * @description JSON object 的保守检查。
     */
    private record(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }
}
