import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
 * @description 受限制的输入文件及显式来源引用读取器。
 */
export class PodCoverageInputReader {
    /**
     * @description 已校验的根目录。
     */
    private readonly roots: ReadonlyMap<string, string>;

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
        const checked = new Map<string, string>();
        for (const root of roots) {
            const id = PodCoverageContracts.identifier(root.id);
            if (checked.has(id) || !isAbsolute(root.path)) throw new Error('pod_coverage_root_invalid');
            const path = resolve(root.path);
            if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory()) throw new Error('pod_coverage_root_invalid');
            checked.set(id, realpathSync(path));
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
        const path = this.resolveReference(root, reference);
        const bytes = this.readBounded(path);
        if (PodCoverageContracts.sha256(bytes) !== reference.sha256) throw new Error('pod_coverage_reference_content_changed');
        return bytes;
    }

    /**
     * @description 在读取前拒绝路径逃逸及路径中的符号链接。
     * @param root 已验证的根目录。
     * @param reference 规范化引用。
     * @returns 根目录内的真实文件路径。
     */
    private resolveReference(root: string, reference: IPodCoverageReference): string {
        let path = root;
        for (const part of reference.path.split('/')) {
            path = join(path, part);
            if (lstatSync(path).isSymbolicLink()) throw new Error('pod_coverage_reference_symlink_forbidden');
        }
        const actual = realpathSync(path);
        const within = relative(root, actual);
        if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
            throw new Error('pod_coverage_reference_path_invalid');
        }
        return actual;
    }

    /**
     * @description 对单文件和整次调用使用相同的有界读取规则。
     * @param path 待读取的本地文件。
     * @returns 文件原始字节。
     */
    private readBounded(path: string): Uint8Array {
        const before = lstatSync(path);
        if (before.isSymbolicLink() || !before.isFile()) throw new Error('pod_coverage_file_invalid');
        if (before.size > PodCoverageContracts.maxFileBytes || this.bytesRead + before.size > PodCoverageContracts.maxTotalBytes) {
            throw new Error('pod_coverage_file_too_large');
        }
        const bytes = readFileSync(path);
        const after = lstatSync(path);
        if (!after.isFile() || after.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size
            || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
            throw new Error('pod_coverage_file_changed_during_read');
        }
        this.bytesRead += bytes.byteLength;
        return bytes;
    }
}
