import fs, { closeSync, constants, fstatSync, lstatSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { PodCoverageContracts, type IPodCoverageInput, type IPodCoverageReference } from './contracts.mjs';

/**
 * @description 一次离线输入读取所使用的显式根目录。
 */
export interface IPodCoverageRoot {
    /**
     * @description 输入引用的根目录标识。
     */
    readonly id: string;
    /**
     * @description 调用方提供的真实绝对目录。
     */
    readonly path: string;
}

/**
 * @description 显式根和引用路径逐级取得的文件系统身份。
 */
interface IPodCoveragePathSnapshot {
    readonly path: string;
    readonly stats: Stats;
}

/**
 * @description 已解析引用及从根到叶子的身份链。
 */
interface IPodCoverageResolvedReference {
    readonly path: string;
    readonly chain: readonly IPodCoveragePathSnapshot[];
}

/**
 * @description 受限制的输入文件及显式来源引用读取器。
 */
export class PodCoverageInputReader {
    /**
     * @description 已校验的根目录。
     */
    private readonly roots: ReadonlyMap<string, IPodCoveragePathSnapshot>;

    /**
     * @description 当前实例累计读取的字节数。
     */
    private bytesRead = 0;

    /**
     * @description 当前实例累计读取的引用数量。
     */
    private referencesRead = 0;

    /**
     * @description 建立只读的显式根目录集合。
     * @param roots 调用方提供的来源及证据目录。
     */
    public constructor(roots: readonly IPodCoverageRoot[]) {
        const checked = new Map<string, IPodCoveragePathSnapshot>();
        for (const root of roots) {
            const id = PodCoverageContracts.identifier(root.id);
            if (checked.has(id) || !isAbsolute(root.path)) throw new Error('pod_coverage_root_invalid');
            const path = resolve(root.path);
            const before = lstatSync(path);
            if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('pod_coverage_root_invalid');
            const actual = realpathSync(path);
            const after = lstatSync(path);
            const resolved = lstatSync(actual);
            if (!this.sameFile(before, after) || !this.sameFile(before, resolved)
                || after.isSymbolicLink() || !resolved.isDirectory()) throw new Error('pod_coverage_root_changed');
            checked.set(id, { path: actual, stats: resolved });
        }
        this.roots = checked;
    }

    /**
     * @description 读取并校验一个输入文件；不会根据用例生成结果。
     * @param inputPath 用户显式指定的 JSON 文件。
     * @returns 结构有效的输入与原始字节摘要。
     */
    public readInput(inputPath: string): { readonly input: IPodCoverageInput; readonly sha256: string } {
        if (!isAbsolute(inputPath)) throw new Error('pod_coverage_input_path_invalid');
        const bytes = this.readBounded(resolve(inputPath));
        let parsed: unknown;
        try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
            throw new Error('pod_coverage_input_json_invalid');
        }
        PodCoverageContracts.assertJsonBounds(parsed);
        return { input: PodCoverageContracts.validateInput(parsed), sha256: PodCoverageContracts.sha256(bytes) };
    }

    /**
     * @description 从允许根内读取并核对一个不可变引用。
     * @param value 未受信的摘要引用。
     * @returns 与声明摘要一致的文件字节。
     */
    public readReference(value: unknown): Uint8Array {
        const reference = PodCoverageContracts.reference(value);
        const root = this.roots.get(reference.rootId);
        if (root === undefined) throw new Error('pod_coverage_reference_root_missing');
        if (++this.referencesRead > PodCoverageContracts.maxReferences) throw new Error('pod_coverage_reference_count_exceeded');
        const resolved = this.resolveReference(root, reference);
        const bytes = this.readBounded(resolved.path, resolved.chain);
        if (PodCoverageContracts.sha256(bytes) !== reference.sha256) throw new Error('pod_coverage_reference_content_changed');
        return bytes;
    }

    /**
     * @description 在读取前拒绝路径逃逸及路径中的符号链接。
     * @param root 已验证的根目录及其初始身份。
     * @param reference 规范化引用。
     * @returns 根目录内的真实路径及逐级身份链。
     */
    private resolveReference(root: IPodCoveragePathSnapshot, reference: IPodCoverageReference): IPodCoverageResolvedReference {
        let path = root.path;
        const chain: IPodCoveragePathSnapshot[] = [root];
        const parts = reference.path.split('/');
        for (const [index, part] of parts.entries()) {
            path = join(path, part);
            const stats = lstatSync(path);
            if (stats.isSymbolicLink()) throw new Error('pod_coverage_reference_symlink_forbidden');
            if (index < parts.length - 1 && !stats.isDirectory()) throw new Error('pod_coverage_reference_path_invalid');
            chain.push({ path, stats });
        }
        const actual = fs.realpathSync(path);
        const within = relative(root.path, actual);
        if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
            throw new Error('pod_coverage_reference_path_invalid');
        }
        return { path: actual, chain };
    }

    /**
     * @description 对单文件和整次调用使用相同的有界读取规则。
     * @param path 待读取的本地文件。
     * @param chain 引用从显式根到文件的固定身份；直接输入没有此约束。
     * @returns 文件原始字节。
     */
    private readBounded(path: string, chain?: readonly IPodCoveragePathSnapshot[]): Uint8Array {
        if (chain) this.verifyChain(chain);
        const before = lstatSync(path);
        if (chain && !this.sameFile(chain[chain.length - 1]!.stats, before)) {
            throw new Error('pod_coverage_reference_changed_during_read');
        }
        if (before.isSymbolicLink() || !before.isFile()) throw new Error('pod_coverage_file_invalid');
        if (before.size > PodCoverageContracts.maxFileBytes || this.bytesRead + before.size > PodCoverageContracts.maxTotalBytes) {
            throw new Error('pod_coverage_file_too_large');
        }
        if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') {
            throw new Error('pod_coverage_secure_open_unavailable');
        }
        let handle: number;
        try {
            handle = fs.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        } catch {
            throw new Error('pod_coverage_file_changed_during_read');
        }
        try {
            const opened = fstatSync(handle);
            if (!opened.isFile() || !this.sameFile(before, opened)) throw new Error('pod_coverage_file_changed_during_read');
            const chunks: Buffer[] = [];
            const buffer = Buffer.allocUnsafe(64 * 1024);
            let length = 0;
            while (true) {
                const available = Math.min(PodCoverageContracts.maxFileBytes - length,
                    PodCoverageContracts.maxTotalBytes - this.bytesRead - length);
                const count = fs.readSync(handle, buffer, 0, Math.min(buffer.length, available + 1), null);
                if (count === 0) break;
                if (count > available) throw new Error('pod_coverage_file_too_large');
                chunks.push(Buffer.from(buffer.subarray(0, count)));
                length += count;
            }
            const afterHandle = fstatSync(handle);
            const afterPath = lstatSync(path);
            if (chain) this.verifyChain(chain);
            if (!this.sameFile(before, afterHandle) || !this.sameFile(before, afterPath)
                || afterPath.isSymbolicLink() || length !== before.size) {
                throw new Error('pod_coverage_file_changed_during_read');
            }
            this.bytesRead += length;
            return Buffer.concat(chunks, length);
        } finally {
            closeSync(handle);
        }
    }

    /**
     * @description 读取前后核对根、每级目录和叶子的原始身份，拒绝祖先替换。
     * @param chain 解析引用时固定的路径身份链。
     * @returns 无返回值。
     */
    private verifyChain(chain: readonly IPodCoveragePathSnapshot[]): void {
        for (const [index, entry] of chain.entries()) {
            let current: Stats;
            try {
                current = lstatSync(entry.path);
            } catch {
                throw new Error('pod_coverage_reference_changed_during_read');
            }
            if (current.isSymbolicLink() || !this.sameFile(entry.stats, current)
                || index < chain.length - 1 && !current.isDirectory()) {
                throw new Error('pod_coverage_reference_changed_during_read');
            }
        }
    }

    /**
     * @description 对比读取前、固定句柄和读取后路径的同一文件身份及内容时间。
     * @param left 读取前文件状态。
     * @param right 待比对文件状态。
     * @returns 身份与大小、时间是否一致。
     */
    private sameFile(left: Stats, right: Stats): boolean {
        return left.dev === right.dev && left.ino === right.ino && left.size === right.size
            && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
    }
}
