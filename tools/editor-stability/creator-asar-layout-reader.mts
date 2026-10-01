import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/**
 * @description ASAR importer 布局的只读快照；编译模块内容不执行也不尝试解码。
 */
export interface ICreatorAsarLayout {
    /**
     * @description 整个头部目录 JSON 的摘要。
     */
    readonly headerSha256: string;
    /**
     * @description 所有 importer 模块的规范相对路径，包含辅助模块而不冒充注册目录。
     */
    readonly importerModules: readonly string[];
}

/**
 * @description 读取安装包的公开 ASAR 目录布局，限制头部容量并保留版本比较所需的全部模块。
 */
export class CreatorAsarLayoutReader {
    /**
     * @description 读取有限 ASAR 头部，不读取或执行模块正文。
     * @param archivePath 调用方提供的安装包路径，仅供本地读取。
     * @returns 可移植的模块布局和摘要。
     */
    public static read(archivePath: string): ICreatorAsarLayout {
        const fd = openSync(archivePath, 'r');
        try {
            const prefix = Buffer.alloc(16);
            if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) {
                throw new Error('coverage_asar_header_truncated');
            }
            const headerSize = prefix.readUInt32LE(4);
            const jsonSize = prefix.readUInt32LE(12);
            if (prefix.readUInt32LE(0) !== 4 || headerSize > 32 * 1024 * 1024 || jsonSize < 2
                || headerSize < jsonSize + 8 || prefix.readUInt32LE(8) !== headerSize - 4
                || headerSize + 8 > fstatSync(fd).size) {
                throw new Error('coverage_asar_header_invalid');
            }
            const buffer = Buffer.alloc(jsonSize);
            if (readSync(fd, buffer, 0, jsonSize, 16) !== jsonSize) {
                throw new Error('coverage_asar_header_truncated');
            }
            const header: unknown = JSON.parse(buffer.toString('utf8'));
            if (!this.record(header) || !this.record(header.files)) {
                throw new Error('coverage_asar_directory_invalid');
            }
            const modules: string[] = [];
            this.walk(header.files, '', 0, { remaining: 1_000_000 }, modules);
            return {
                headerSha256: createHash('sha256').update(buffer).digest('hex'),
                importerModules: modules.sort(),
            };
        } finally {
            closeSync(fd);
        }
    }

    /**
     * @description 遍历目录元数据，保留辅助、迁移和实现模块以避免把布局裁成假注册分母。
     * @param entries 当前目录条目。
     * @param prefix 当前相对路径。
     * @param depth 当前目录深度。
     * @param budget 剩余条目预算。
     * @param modules 输出模块列表。
     * @returns 无返回值。
     */
    private static walk(entries: Record<string, unknown>, prefix: string, depth: number,
        budget: { remaining: number }, modules: string[]): void {
        if (depth > 64) {
            throw new Error('coverage_asar_directory_budget_exceeded');
        }
        for (const [name, entry] of Object.entries(entries)) {
            if (--budget.remaining < 0 || name.length === 0 || name.includes('/') || name.includes('\\')
                || name === '..' || name === '.' || !this.record(entry)) {
                throw new Error('coverage_asar_directory_invalid');
            }
            const relative = `${prefix}${name}`;
            if ('files' in entry && !this.record(entry.files)) {
                throw new Error('coverage_asar_directory_invalid');
            }
            if (this.record(entry.files)) {
                this.walk(entry.files, `${relative}/`, depth + 1, budget, modules);
            } else if (relative.includes('/importer/importers/')) {
                modules.push(relative);
            }
        }
    }

    /**
     * @description 收窄目录 JSON 中的对象。
     * @param value 未知条目。
     * @returns 是否为非数组对象。
     */
    private static record(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
