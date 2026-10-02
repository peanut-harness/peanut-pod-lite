import { createHash } from 'crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from 'fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'path';
import { TextDecoder } from 'util';

/**
 * @description 由协议容量来源注入的限制；本模块不复制产品默认值。
 */
export interface ITextFileIoGuardLimits {
    /**
     * @description 最大文件数。
     */
    readonly maxFiles: number;
    /**
     * @description 单文件原始 UTF-8 字节上限。
     */
    readonly maxFileBytes: number;
    /**
     * @description 完整请求 JSON 字节上限。
     */
    readonly maxInputBytes: number;
    /**
     * @description 完整响应 JSON 字节上限。
     */
    readonly maxOutputBytes: number;
}

/**
 * @description 规范化后的物理目标，仅供本次调用内部使用，不进入共享指标。
 */
export interface ITextFileIoTarget {
    /**
     * @description 真实目标对应的规范 assets 路径。
     */
    readonly path: string;
    /**
     * @description 已确认在真实资产根内的本机路径。
     */
    readonly absolutePath: string;
    /**
     * @description 路径检查时是否存在。
     */
    readonly exists: boolean;
    /**
     * @description 存在文件的设备与 inode 标识；缺失时为空。
     */
    readonly identity: string | null;
}

/**
 * @description 经有限读回的源文件快照，不代表多文件一致性或 AssetDB 后验。
 */
export interface ITextFileIoSnapshot {
    /**
     * @description 规范目标路径。
     */
    readonly path: string;
    /**
     * @description 是否存在有效源文件。
     */
    readonly exists: boolean;
    /**
     * @description 原样解码内容；缺失文件为空。
     */
    readonly content: string | null;
    /**
     * @description 实际原始字节数。
     */
    readonly byteCount: number;
    /**
     * @description 实际源摘要；缺失时为 absent。
     */
    readonly sha256: string;
    /**
     * @description 实际源设备与 inode 标识。
     */
    readonly identity: string | null;
    /**
     * @description 文件修改时间；缺失时为空。
     */
    readonly mtimeMs: number | null;
    /**
     * @description 文件状态修改时间；缺失时为空。
     */
    readonly ctimeMs: number | null;
}

/**
 * @description 全批校验后的写入准备信息；它不会执行写入，也不能代替 writer 内重验。
 */
export interface ITextFileIoPreparedWrite extends ITextFileIoTarget {
    /**
     * @description 已验证可无损 UTF-8 编码的原样内容。
     */
    readonly content: string;
    /**
     * @description 输入内容实际字节数。
     */
    readonly byteCount: number;
    /**
     * @description 校验时真实源摘要；不是写入后证明。
     */
    readonly beforeSha256: string;
    /**
     * @description 可选预期源摘要或 absent。
     */
    readonly expectedSha256?: string;
}

/**
 * @description 对全批文本操作执行无副作用的路径、别名、编码、摘要和容量检查。
 */
export class TextFileIoGuard {
    /**
     * @description 当前工程根，本模块不创建或修改它。
     */
    private readonly _projectRoot: string;
    /**
     * @description 调用方注入且冻结的产品容量。
     */
    private readonly _limits: ITextFileIoGuardLimits;
    /**
     * @description 目标平台大小写规则，可由宿主明确注入。
     */
    private readonly _caseSensitive: boolean;

    /**
     * @description 记录工程与注入容量，尚不访问或改变业务文件。
     * @param projectRoot 当前工程路径。
     * @param limits 协议提供的容量。
     * @param caseSensitive 目标平台规则；Windows 和 macOS 默认忽略大小写。
     */
    public constructor(projectRoot: string, limits: ITextFileIoGuardLimits, caseSensitive = process.platform !== 'win32' && process.platform !== 'darwin') {
        if (typeof projectRoot !== 'string' || projectRoot.length === 0
            || [limits.maxFiles, limits.maxFileBytes, limits.maxInputBytes, limits.maxOutputBytes]
                .some((value) => !Number.isSafeInteger(value) || value < 1)) {
            throw new Error('text_file_io_configuration_invalid');
        }
        this._projectRoot = resolve(projectRoot);
        this._limits = Object.freeze({ ...limits });
        this._caseSensitive = caseSensitive;
    }

    /**
     * @description 校验单文件或多文件读路径，保留缺文件供执行器返回逐项失败。
     * @param input 未受信业务输入。
     * @param envelope 完整线缆请求；未提供时按业务输入计算。
     * @returns 按输入顺序的真实目标。
     */
    public prepareRead(input: unknown, envelope: unknown = input): readonly ITextFileIoTarget[] {
        this.assertInputBudget(envelope);
        if (envelope !== input) {
            this.assertInputBudget(input);
        }
        if (!this._record(input) || Object.keys(input).some((key) => key !== 'path' && key !== 'paths')
            || Object.prototype.hasOwnProperty.call(input, 'path') === Object.prototype.hasOwnProperty.call(input, 'paths')) {
            throw new Error('text_file_io_read_input_invalid');
        }
        const paths: readonly unknown[] = Object.prototype.hasOwnProperty.call(input, 'paths')
            ? Array.isArray(input.paths) ? input.paths : [input.paths] : [input.path];
        return this._targets(paths);
    }

    /**
     * @description 校验整批写入与源条件，保持 files 优先；全程不创建文件、目录或 meta。
     * @param input 未受信业务输入。
     * @param envelope 完整请求，用于把控制字段及忽略字段也计入预算。
     * @returns 有序准备信息，取得 writer 后必须重新调用以重验全批。
     */
    public prepareWrite(input: unknown, envelope: unknown = input): readonly ITextFileIoPreparedWrite[] {
        this.assertInputBudget(envelope);
        if (envelope !== input) {
            this.assertInputBudget(input);
        }
        if (!this._record(input)) {
            throw new Error('text_file_io_write_input_invalid');
        }
        const files: unknown = Object.prototype.hasOwnProperty.call(input, 'files') ? input.files : undefined;
        if (Object.prototype.hasOwnProperty.call(input, 'files') && !Array.isArray(files)) {
            throw new Error('text_file_io_write_input_invalid');
        }
        const entries: readonly unknown[] = Array.isArray(files) ? files : [input];
        if (entries.length < 1 || entries.length > this._limits.maxFiles) {
            throw new Error('text_file_io_file_count_exceeded');
        }
        const contents = entries.map((entry) => {
            if (!this._record(entry) || !Object.prototype.hasOwnProperty.call(entry, 'path')
                || !Object.prototype.hasOwnProperty.call(entry, 'content') || typeof entry.content !== 'string'
                || Array.isArray(files) && Object.keys(entry).some((key) => !['path', 'content', 'expectedSha256'].includes(key))
                || Object.prototype.hasOwnProperty.call(entry, 'expectedSha256') && (typeof entry.expectedSha256 !== 'string'
                    || !/^(?:[0-9a-fA-F]{64}|absent)(?![\s\S])/u.test(entry.expectedSha256))) {
                throw new Error('text_file_io_write_entry_invalid');
            }
            this._decode(Buffer.from(entry.content, 'utf8'), entry.content);
            return { path: entry.path, content: entry.content, expectedSha256: Object.prototype.hasOwnProperty.call(entry, 'expectedSha256')
                && typeof entry.expectedSha256 === 'string' ? entry.expectedSha256.toLowerCase() : undefined };
        });
        const targets = this._targets(contents.map((entry) => entry.path));
        return Object.freeze(targets.map((target, index) => {
            const entry = contents[index];
            if (entry == null) {
                throw new Error('text_file_io_write_entry_invalid');
            }
            const snapshot = this.readSnapshot(target);
            if (entry.expectedSha256 != null && entry.expectedSha256 !== snapshot.sha256) {
                throw new Error('text_file_io_content_conflict');
            }
            return Object.freeze({ ...target, content: entry.content, byteCount: Buffer.byteLength(entry.content, 'utf8'),
                beforeSha256: snapshot.sha256, ...(entry.expectedSha256 != null ? { expectedSha256: entry.expectedSha256 } : {}) });
        }));
    }

    /**
     * @description 重新确认目标后有限读取实际文件，拒绝编码、二进制及读取期间身份变化。
     * @param target 先前目标；不会信任调用方传入的绝对路径。
     * @returns 保留 BOM、换行、空文件和 Unicode 的单文件快照。
     */
    public readSnapshot(target: ITextFileIoTarget): ITextFileIoSnapshot {
        const observation = this.readObservation(target);
        if (observation.decodeError != null) {
            throw new Error(observation.decodeError);
        }
        return observation;
    }

    /**
     * @description 对有限原始字节形成独立摘要，非法文本只保留失败码和摘要供第二遍复核。
     * @param target 经路径守卫解析的目标。
     * @returns 实际源观察；身份变化仍拒绝，非法编码不公开内容。
     */
    public readObservation(target: ITextFileIoTarget): ITextFileIoSnapshot & {
        /**
         * @description 非法编码或二进制检查失败时的稳定码；内容为空。
         */
        readonly decodeError?: string;
    } {
        const current = this._targets([target.path])[0];
        if (current == null) {
            throw new Error('text_file_io_target_invalid');
        }
        if (current.path !== target.path || current.exists !== target.exists || current.identity !== target.identity) {
            throw new Error('text_file_io_snapshot_conflict');
        }
        if (!current.exists) {
            return { path: current.path, exists: false, content: null, byteCount: 0, sha256: 'absent', identity: null, mtimeMs: null, ctimeMs: null };
        }
        let fd: number;
        try {
            fd = openSync(current.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        } catch {
            throw new Error('text_file_io_snapshot_unavailable');
        }
        try {
            const before = fstatSync(fd);
            const actualPath = realpathSync(current.absolutePath);
            if (!this._inside(this._assetRoot(), actualPath) || this._identity(before) !== current.identity || !before.isFile()) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            this._fileBudget(before.size);
            const bytes = Buffer.alloc(before.size + 1);
            let used = 0;
            while (used < bytes.length) {
                const count = readSync(fd, bytes, used, bytes.length - used, null);
                if (count === 0) {
                    break;
                }
                used += count;
            }
            const after = fstatSync(fd);
            if (used !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            const stillTarget = this._targets([current.path])[0];
            if (stillTarget == null || stillTarget.path !== current.path || stillTarget.identity !== this._identity(after)) {
                throw new Error('text_file_io_snapshot_conflict');
            }
            const original = bytes.subarray(0, used);
            let content: string | null = null;
            let decodeError: string | undefined;
            try {
                content = this._decode(original);
            } catch (error: unknown) {
                if (!(error instanceof Error) || !error.message.startsWith('text_file_io_')) {
                    throw error;
                }
                decodeError = error.message;
            }
            return { path: current.path, exists: true, content, byteCount: used,
                sha256: createHash('sha256').update(original).digest('hex'), identity: this._identity(after),
                mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, ...(decodeError == null ? {} : { decodeError }) };
        } catch (error: unknown) {
            if (error instanceof Error && error.message.startsWith('text_file_io_')) {
                throw error;
            }
            throw new Error('text_file_io_snapshot_unavailable');
        } finally {
            closeSync(fd);
        }
    }

    /**
     * @description 计算完整编码请求的容量，拒绝非 JSON 或超限值。
     * @param envelope 完整线缆请求。
     * @returns 无返回值。
     */
    public assertInputBudget(envelope: unknown): void {
        this._jsonBudget(envelope, this._limits.maxInputBytes);
    }

    /**
     * @description 计算包含包装字段及转义的完整响应容量，禁止截断后宣称成功。
     * @param envelope 完整线缆响应。
     * @param trailingBytes NDJSON 换行等不属于 JSON 对象的额外编码字节。
     * @returns 无返回值。
     */
    public assertOutputBudget(envelope: unknown, trailingBytes = 0): void {
        if (!Number.isSafeInteger(trailingBytes) || trailingBytes < 0) {
            throw new Error('text_file_io_configuration_invalid');
        }
        this._jsonBudget(envelope, this._limits.maxOutputBytes - trailingBytes);
    }

    /**
     * @description 逐项解析实际目标，并同时拒绝规范路径、大小写和设备 inode 别名。
     * @param paths 未受信路径集合。
     * @returns 冻结的有序目标。
     */
    private _targets(paths: readonly unknown[]): readonly ITextFileIoTarget[] {
        if (paths.length < 1 || paths.length > this._limits.maxFiles) {
            throw new Error('text_file_io_file_count_exceeded');
        }
        const root = this._assetRoot();
        const names = new Set<string>();
        const identities = new Set<string>();
        return Object.freeze(paths.map((value) => {
            const path = this._normalizePath(value);
            const target = this._resolveTarget(root, path);
            const normalizedName = process.platform === 'darwin' || !this._caseSensitive
                ? target.absolutePath.normalize('NFC') : target.absolutePath;
            const key = this._caseSensitive ? normalizedName : normalizedName.toLowerCase();
            if (names.has(key) || target.identity != null && identities.has(target.identity)) {
                throw new Error('text_file_io_duplicate_target');
            }
            names.add(key);
            if (target.identity != null) {
                identities.add(target.identity);
            }
            return Object.freeze(target);
        }));
    }

    /**
     * @description 拒绝绝对路径、控制字符、穿越及禁止的源类型，保留旧 db:// 与反斜杠路径形式。
     * @param value 未受信路径。
     * @returns 规范 assets 相对路径。
     */
    private _normalizePath(value: unknown): string {
        if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)
            || Buffer.from(value, 'utf8').toString('utf8') !== value || Buffer.byteLength(value, 'utf8') > 4096) {
            throw new Error('text_file_io_path_invalid');
        }
        const stripped = value.trim().replace(/\\/gu, '/').replace(/^db:\/\//u, '');
        if (stripped.split('/').some((part) => Buffer.byteLength(part, 'utf8') > 255)) {
            throw new Error('text_file_io_path_invalid');
        }
        if (stripped.includes(':') || stripped.startsWith('/') || stripped.split('/').includes('..')) {
            throw new Error('text_file_io_path_escape');
        }
        const normalized = posix.normalize(stripped).replace(/^\.\//u, '');
        if (!normalized.startsWith('assets/') || !/\.(?:ts|mts|cts|js|mjs|cjs|json|md|txt|html|htm|css|scss|less|yaml|yml|xml|csv)$/iu.test(normalized)) {
            throw new Error('text_file_io_source_type_refused');
        }
        return normalized;
    }

    /**
     * @description 要求真实工程内存在常规 assets 根，拒绝整个资产根链接到其它位置。
     * @returns 当前真实资产根。
     */
    private _assetRoot(): string {
        try {
            const root = join(realpathSync(this._projectRoot), 'assets');
            if (!lstatSync(root).isDirectory()) {
                throw new Error('text_file_io_asset_root_invalid');
            }
            return realpathSync(root);
        } catch {
            throw new Error('text_file_io_asset_root_invalid');
        }
    }

    /**
     * @description 沿已有祖先逐段核实链接；新文件只推导路径，不创建任何祖先。
     * @param root 真实资产根。
     * @param path 规范逻辑路径。
     * @returns 真实目标与文件身份。
     */
    private _resolveTarget(root: string, path: string): ITextFileIoTarget {
        const parts = path.slice('assets/'.length).split('/');
        let absolute = root;
        let info: Stats | null = null;
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            if (part == null) {
                throw new Error('text_file_io_path_invalid');
            }
            const candidate = join(absolute, part);
            try {
                info = lstatSync(candidate);
            } catch (error: unknown) {
                if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ENOENT') {
                    throw new Error('text_file_io_path_unavailable');
                }
                absolute = join(absolute, ...parts.slice(index));
                info = null;
                break;
            }
            try {
                absolute = realpathSync(candidate);
            } catch {
                throw new Error('text_file_io_path_unavailable');
            }
            if (!this._inside(root, absolute)) {
                throw new Error('text_file_io_path_escape');
            }
            info = lstatSync(absolute);
            if (index < parts.length - 1 && !info.isDirectory()) {
                throw new Error('text_file_io_parent_not_directory');
            }
        }
        const canonical = this._normalizePath(`assets/${relative(root, absolute).split(sep).join('/')}`);
        if (info != null && !info.isFile()) {
            throw new Error('text_file_io_target_not_file');
        }
        if (info != null) {
            this._fileBudget(info.size);
        }
        return { path: canonical, absolutePath: absolute, exists: info != null, identity: info == null ? null : this._identity(info) };
    }

    /**
     * @description 使用分段路径关系判断真实根约束，避免同名前缀目录误判。
     * @param root 真实资产根。
     * @param target 真实候选。
     * @returns 是否仍在根内。
     */
    private _inside(root: string, target: string): boolean {
        const path = relative(root, target);
        return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    }

    /**
     * @description 构造硬链接与大小写别名的实际文件身份。
     * @param info 已取得的文件状态。
     * @returns 设备及 inode 标识。
     */
    private _identity(info: Stats): string {
        return `${info.dev}:${info.ino}`;
    }

    /**
     * @description 对原始内容执行容量、二进制、严格 UTF-8 及字符串无损编码检查。
     * @param bytes 实际原始字节。
     * @param expected 可选输入字符串，用于拒绝孤立代理项的替换编码。
     * @returns 保留 BOM 与换行的内容。
     */
    private _decode(bytes: Buffer, expected?: string): string {
        this._fileBudget(bytes.length);
        if (bytes.some((value) => value < 32 && value !== 9 && value !== 10 && value !== 13 || value === 127)) {
            throw new Error('text_file_io_binary_refused');
        }
        let content: string;
        try {
            content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
            throw new Error('text_file_io_utf8_invalid');
        }
        if (expected != null && content !== expected) {
            throw new Error('text_file_io_utf8_invalid');
        }
        return content;
    }

    /**
     * @description 拒绝单文件容量超限。
     * @param bytes 原始字节数。
     * @returns 无返回值。
     */
    private _fileBudget(bytes: number): void {
        if (bytes > this._limits.maxFileBytes) {
            throw new Error('text_file_io_file_bytes_exceeded');
        }
    }

    /**
     * @description 先检查有限纯 JSON，再核对包含全部包装和转义的编码字节。
     * @param value 完整请求或响应。
     * @param maximum 注入的字节预算。
     * @returns 无返回值。
     */
    private _jsonBudget(value: unknown, maximum: number): void {
        const budget = { remaining: 100_000, strings: maximum };
        if (!this._json(value, 0, budget)) {
            throw new Error(budget.strings < 0 ? 'text_file_io_json_bytes_exceeded' : 'text_file_io_json_invalid');
        }
        if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximum) {
            throw new Error('text_file_io_json_bytes_exceeded');
        }
    }

    /**
     * @description 对 JSON 结构设置节点、深度和字符串预算，不执行对象访问器。
     * @param value 当前值。
     * @param depth 当前深度。
     * @param budget 剩余节点和字符串下限字节预算。
     * @returns 是否为有限纯 JSON。
     */
    private _json(value: unknown, depth: number, budget: { remaining: number; strings: number }): boolean {
        if (depth > 64 || --budget.remaining < 0) {
            return false;
        }
        if (typeof value === 'string') {
            budget.strings -= value.length;
            return budget.strings >= 0;
        }
        if (value === null || typeof value === 'boolean') {
            return true;
        }
        if (typeof value === 'number') {
            return Number.isFinite(value);
        }
        if (typeof value === 'object' && value !== null && this._hasJsonSerializer(value)) {
            return false;
        }
        if (Array.isArray(value)) {
            if (Reflect.ownKeys(value).length !== value.length + 1 || value.length > budget.remaining) {
                return false;
            }
            for (let index = 0; index < value.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value, index);
                const child: unknown = descriptor?.value;
                if (descriptor == null || descriptor.enumerable !== true || descriptor.get != null || descriptor.set != null
                    || !this._json(child, depth + 1, budget)) {
                    return false;
                }
            }
            return true;
        }
        if (!this._record(value)) {
            return false;
        }
        return Reflect.ownKeys(value).every((key) => {
            if (typeof key !== 'string') {
                return false;
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            budget.strings -= key.length;
            const child: unknown = descriptor?.value;
            return budget.strings >= 0 && descriptor?.enumerable === true && descriptor.get == null && descriptor.set == null
                && this._json(child, depth + 1, budget);
        });
    }

    /**
     * @description 有界核对完整原型链的序列化钩子，不读取 getter 或执行函数。
     * @param value JSON 候选对象或数组。
     * @returns 是否存在钩子或无法在预算内确认安全。
     */
    private _hasJsonSerializer(value: object): boolean {
        let current: object | null = value;
        for (let depth = 0; current != null && depth <= 64; depth += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(current, 'toJSON');
            if (descriptor != null && (descriptor.get != null || descriptor.set != null || typeof descriptor.value === 'function')) {
                return true;
            }
            current = Object.getPrototypeOf(current);
        }
        return current != null;
    }

    /**
     * @description 收窄普通 JSON 对象。
     * @param value 未受信数据。
     * @returns 是否可作为业务字段记录。
     */
    private _record(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
            && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    }
}
