import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CompatibleUuid, type ITextFileIoPreparedWrite } from '@peanut/pod-engine/assets';
import { CoreTextFileIoContract } from '@peanut/pod-engine/policy';

/**
 * @description 原始孤立资源的有限恢复材料，未验证结束前不删除。
 */
export class EditorMcpTextWriteRecovery {
    /**
     * @description 本次唯一恢复目录。
     */
    private readonly _directory: string;
    /**
     * @description 原始文件和 meta 的物理身份及字节证明。
     */
    private readonly _copies: readonly { readonly original: string; readonly backup: string; readonly identity: string; readonly sha256: string; readonly bytes: number; readonly uuid: string | null; readonly importer: string | null }[];
    /**
     * @description 当前工程真实根。
     */
    private readonly _root: string;
    /**
     * @description 已完成的实际移动记录。
     */
    private readonly _moved = new Set<string>();

    /**
     * @description 在任何恢复写入前有限读取原始材料并核实单项上限。
     * @param projectRoot 真实工程。
     * @param file 原始文件准备。
     */
    public constructor(projectRoot: string, file: ITextFileIoPreparedWrite) {
        this._root = realpathSync(projectRoot);
        this._directory = join(this._root, 'temp', '.peanut-write-text-recovery', CompatibleUuid.create());
        this._copies = [file.absolutePath, file.absolutePath + '.meta'].flatMap((original) => {
            if (!existsSync(original)) {
                return [];
            }
            const proof = EditorMcpTextWriteRecovery._read(original);
            return [{ original, backup: join(this._directory, original.endsWith('.meta') ? 'asset.meta' : 'asset'), ...proof }];
        });
        if (this._copies.some((copy) => copy.original.endsWith('.meta') && copy.uuid != null)) {
            throw new Error('text_file_io_orphan_identity_unknown');
        }
    }

    /**
     * @description 原始材料实际字节，用于 writer 在首个恢复副作用前累加预算。
     */
    public get bytes(): number {
        return this._copies.reduce((sum, copy) => sum + copy.bytes, 0);
    }

    /**
     * @description 核实路径和原始材料后保存恢复副本，只移动当前调用明确绑定的文件。
     */
    public move(): void {
        if (this._copies.length === 0) {
            return;
        }
        for (const path of [join(this._root, 'temp'), join(this._root, 'temp', '.peanut-write-text-recovery')]) {
            if (existsSync(path) && (!lstatSync(path).isDirectory() || realpathSync(path) !== path)) {
                throw new Error('text_file_io_recovery_path_unsafe');
            }
        }
        for (const copy of this._copies) {
            this._assert(copy.original, copy);
        }
        mkdirSync(this._directory, { recursive: true });
        for (const copy of this._copies) {
            renameSync(copy.original, copy.backup);
            this._moved.add(copy.original);
            this._assert(copy.backup, copy);
        }
    }

    /**
     * @description 仅在调用方确认 AssetDB 仍明确未登记且目标均缺失时独立恢复并核实全部原始材料。
     * @returns 是否完成恢复证明；无法证明时保留材料。
     */
    public restore(): boolean {
        if (this._copies.some((copy) => this._moved.has(copy.original) && existsSync(copy.original))) {
            return false;
        }
        try {
            for (const copy of this._copies) {
                this._assert(this._moved.has(copy.original) ? copy.backup : copy.original, copy);
            }
            for (const copy of this._copies) {
                if (this._moved.has(copy.original)) {
                    renameSync(copy.backup, copy.original);
                    this._moved.delete(copy.original);
                }
            }
            for (const copy of this._copies) {
                this._assert(copy.original, copy);
            }
            if (existsSync(this._directory)) {
                rmdirSync(this._directory);
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @description 所有最终证据通过后，仅清理未发生外部改变的本次恢复材料。
     */
    public release(): void {
        for (const copy of this._copies) {
            if (this._moved.has(copy.original)) {
                this._assert(copy.backup, copy);
            }
        }
        if (existsSync(this._directory)) {
            const expected = this._copies.filter((copy) => this._moved.has(copy.original)).map((copy) => copy.backup).sort();
            const actual = readdirSync(this._directory).map((name) => join(this._directory, name)).sort();
            if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                throw new Error('text_file_io_recovery_material_changed');
            }
            rmSync(this._directory, { recursive: true });
        }
    }

    /**
     * @description 有限读取有效目录meta，用于物理基线和UUID核验。
     * @param path 本次已验证的真实meta位置。
     * @returns 实际有限证明。
     */
    public static metaProof(path: string): { readonly identity: string; readonly sha256: string; readonly uuid: string; readonly importer: string; readonly imported: boolean | null; readonly directoryFieldsSha256: string | null } {
        const proof = this._read(path);
        if (proof.uuid == null || proof.importer == null) {
            throw new Error('text_file_io_meta_invalid');
        }
        return { identity: proof.identity, sha256: proof.sha256, uuid: proof.uuid, importer: proof.importer,
            imported: proof.imported, directoryFieldsSha256: proof.directoryFieldsSha256 };
    }

    /**
     * @description 核实原材料的物理身份与字节。
     * @param path 当前实际材料位置。
     * @param expected 保存证明。
     */
    private _assert(path: string, expected: { readonly identity: string; readonly sha256: string; readonly bytes: number }): void {
        const actual = EditorMcpTextWriteRecovery._read(path);
        if (actual.identity !== expected.identity || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
            throw new Error('text_file_io_recovery_material_changed');
        }
    }

    /**
     * @description 有限无链接读取恢复材料，不加载无限 meta 或硬链接外部内容。
     * @param path 绑定的真实文件。
     * @returns 实际字节证明。
     */
    private static _read(path: string): { readonly identity: string; readonly sha256: string; readonly bytes: number; readonly uuid: string | null; readonly importer: string | null; readonly imported: boolean | null; readonly directoryFieldsSha256: string | null } {
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > CoreTextFileIoContract.limits.maxFileBytes
            || realpathSync(path) !== path) {
            throw new Error('text_file_io_recovery_material_unsafe');
        }
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
            const before = fstatSync(fd);
            if (before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size) {
                throw new Error('text_file_io_recovery_material_changed');
            }
            const buffer = Buffer.alloc(before.size + 1);
            let used = 0;
            while (used < buffer.length) {
                const count = readSync(fd, buffer, used, buffer.length - used, null);
                if (count === 0) {
                    break;
                }
                used += count;
            }
            const after = fstatSync(fd);
            const current = lstatSync(path);
            if (used !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
                || current.dev !== before.dev || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs) {
                throw new Error('text_file_io_recovery_material_changed');
            }
            let uuid: string | null = null;
            let importer: string | null = null;
            let imported: boolean | null = null;
            let directoryFieldsSha256: string | null = null;
            if (path.endsWith('.meta')) {
                try {
                    const raw: unknown = JSON.parse(buffer.subarray(0, used).toString('utf8'));
                    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
                        const candidate: unknown = Reflect.get(raw, 'uuid');
                        const kind: unknown = Reflect.get(raw, 'importer');
                        if (typeof candidate === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(candidate)) {
                            uuid = candidate;
                        }
                        if (typeof kind === 'string' && kind.length > 0) {
                            importer = kind;
                        }
                        const flag: unknown = Reflect.get(raw, 'imported');
                        if (kind === 'directory' && typeof flag === 'boolean') {
                            imported = flag;
                            directoryFieldsSha256 = createHash('sha256').update(this._canonical({ ...raw, imported: false })).digest('hex');
                        }
                    }
                } catch {
                    // 原始非法meta仍作为恢复字节保留，不冒充有效旧身份。
                }
            }
            return { identity: `${before.dev}:${before.ino}`, bytes: used, uuid, importer, imported, directoryFieldsSha256,
                sha256: createHash('sha256').update(buffer.subarray(0, used)).digest('hex') };
        } finally {
            closeSync(fd);
        }
    }

    /**
     * @description 对完整 JSON 字段排序；仅 imported 标志由调用方投影，未知字段仍参与比较。
     * @param value 实际有界解析值。
     * @returns 无字段丢弃的语义编码。
     */
    private static _canonical(value: unknown): string {
        if (Array.isArray(value)) {
            return '[' + value.map((entry) => this._canonical(entry)).join(',') + ']';
        }
        if (value != null && typeof value === 'object') {
            return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + this._canonical(Reflect.get(value, key))).join(',') + '}';
        }
        return JSON.stringify(value) ?? 'null';
    }
}
