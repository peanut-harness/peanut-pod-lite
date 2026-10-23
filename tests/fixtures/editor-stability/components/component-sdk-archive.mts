import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

type ArchiveFs = Pick<typeof import('node:fs'), 'openSync' | 'readSync' | 'fstatSync' | 'closeSync'>;

/**
 * @description 仅读SDK归档中四个固定生命周期/配置契约文件，不载入、求值或执行SDK模块。
 */
export class ComponentSdkArchive {
    /**
     * @description 有界解析ASAR头及固定叶文件，拒绝链接、解包重定向和截断。
     */
    public static read(resources: string, kind: 'scene-profile' | 'service-config' | 'engine-profile' | 'app-lifecycle',
        io: ArchiveFs = { openSync, readSync, fstatSync, closeSync }): Buffer {
        const target = kind === 'scene-profile' ? ['builtin', 'scene', 'package.json']
            : kind === 'service-config' ? ['extension', 'cocos-service', 'utils', 'config.js']
            : kind === 'engine-profile' ? ['builtin', 'engine', 'package.json']
            : kind === 'app-lifecycle' ? ['node_modules', '@editor', 'creator', 'dist', 'app', 'index.ccc'] : null;
        if (!target) throw new Error('component_sdk_archive_kind_invalid');
        const fd = io.openSync(join(resources, 'app.asar'), 'r');
        try {
            const first = this.bytes(fd, 8, 0, io); const length = first.readUInt32LE(4);
            if (first.readUInt32LE(0) !== 4 || length < 8 || length > 32 * 1024 * 1024) throw new Error('component_sdk_archive_header_invalid');
            const header = this.bytes(fd, length, 8, io); const jsonLength = header.readUInt32LE(4);
            if (jsonLength < 2 || jsonLength > header.length - 8) throw new Error('component_sdk_archive_json_invalid');
            let entry = this.record(JSON.parse(header.subarray(8, 8 + jsonLength).toString('utf8')));
            for (const part of target) entry = this.record(this.record(entry.files)[part]);
            if (entry.unpacked || entry.link || typeof entry.offset !== 'string' || !/^\d+$/u.test(entry.offset)
                || typeof entry.size !== 'number' || !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > 1024 * 1024)
                throw new Error('component_sdk_archive_entry_invalid');
            const offset = 8 + length + Number(entry.offset);
            if (!Number.isSafeInteger(offset) || offset < 8 + length || offset + entry.size > io.fstatSync(fd).size)
                throw new Error('component_sdk_archive_offset_invalid');
            return this.bytes(fd, entry.size, offset, io);
        } finally { io.closeSync(fd); }
    }

    /**
     * @description 固定偏移读满有界片段，不访问归档外文件。
     */
    private static bytes(fd: number, length: number, offset: number, io: ArchiveFs): Buffer {
        const bytes = Buffer.alloc(length); let read = 0;
        while (read < length) { const count = io.readSync(fd, bytes, read, length - read, offset + read);
            if (!count) throw new Error('component_sdk_archive_truncated'); read += count; }
        return bytes;
    }

    /**
     * @description 外部JSON必须是记录。
     */
    private static record(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('component_sdk_archive_record_invalid');
        return Object.fromEntries(Object.entries(value));
    }
}
