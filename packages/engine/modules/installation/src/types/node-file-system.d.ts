declare module 'fs' {
    /** @description 文件系统目录项的最小声明，仅供 packaging Node 宿主实现使用。 */
    export interface Dirent {
        /** @description 当前目录项名称。 */
        readonly name: string;
        /** @description 当前目录项是否为目录。 */
        isDirectory(): boolean;
    }

    /** @description 文件状态的最小声明，仅供 packaging Node 宿主实现使用。 */
    export interface Stats {
        /** @description 当前路径是否为目录。 */
        isDirectory(): boolean;
        /** @description 当前路径是否为普通文件。 */
        isFile(): boolean;
        /** @description 当前路径是否为符号链接。 */
        isSymbolicLink(): boolean;
        /** @description 当前文件或目录占用的字节数。 */
        readonly size: number;
        /** @description 当前文件最后修改时间戳，单位为毫秒。 */
        readonly mtimeMs: number;
    }

    /** @description 递归复制时使用的选项。 */
    export interface ICpOptions {
        /** @description 是否递归复制目录内容。 */
        recursive?: boolean;
        /** @description 目标存在时是否允许覆盖。 */
        force?: boolean;
    }

    /** @description 递归删除时使用的选项。 */
    export interface IRmOptions {
        /** @description 是否递归删除目录内容。 */
        recursive?: boolean;
        /** @description 目标不存在时是否忽略。 */
        force?: boolean;
    }

    /** @description 读取目录时使用的选项。 */
    export interface IReaddirOptions {
        /** @description 是否返回目录项而不是字符串名称。 */
        withFileTypes: true;
    }

    /** @description 判断路径是否存在。 */
    export function existsSync(path: string): boolean;
    /** @description 读取路径状态。 */
    export function statSync(path: string): Stats;
    /** @description 读取路径自身的状态，不跟随符号链接。 */
    export function lstatSync(path: string): Stats;
    /** @description 创建目录及其父目录。 */
    export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
    /** @description 创建唯一临时目录。 */
    export function mkdtempSync(prefix: string): string;
    /** @description 读取 UTF-8 文本文件。 */
    export function readFileSync(path: string, encoding: 'utf8'): string;
    /** @description 读取二进制文件内容。 */
    export function readFileSync(path: string): Uint8Array;
    /** @description 写入 UTF-8 文本文件。 */
    export function writeFileSync(path: string, data: string, encoding: 'utf8'): void;
    /** @description 向已打开的文件描述符写入 UTF-8 文本。 */
    export function writeFileSync(file: number, data: string, encoding: 'utf8'): void;
    /** @description 写入二进制文件。 */
    export function writeFileSync(path: string, data: Uint8Array): void;
    /** @description 递归复制文件或目录。 */
    export function cpSync(source: string, destination: string, options?: ICpOptions): void;
    /** @description 原子移动同一文件系统内的路径。 */
    export function renameSync(source: string, destination: string): void;
    /** @description 以排他创建模式打开文件，返回文件描述符。 */
    export function openSync(path: string, flags: 'wx'): number;
    /** @description 关闭已打开的文件描述符。 */
    export function closeSync(file: number): void;
    /** @description 删除单个文件。 */
    export function unlinkSync(path: string): void;
    /** @description 删除文件或目录。 */
    export function rmSync(path: string, options?: IRmOptions): void;
    /** @description 读取目录中的目录项。 */
    export function readdirSync(path: string, options: IReaddirOptions): Dirent[];
    /** @description 读取目录中的文件名称。 */
    export function readdirSync(path: string): string[];
}

declare module 'crypto' {
    /** @description SHA-256 摘要计算器的最小声明，仅供 packaging Node 宿主实现使用。 */
    export interface IHash {
        /** @description 写入待计算摘要的二进制或文本数据。 */
        update(data: string | Uint8Array): IHash;
        /** @description 输出指定编码的摘要。 */
        digest(encoding: 'hex'): string;
    }

    /** @description 创建指定算法的摘要计算器。 */
    export function createHash(algorithm: 'sha256'): IHash;
    /** @description 从 DER/SPKI 字节创建 Ed25519 公钥句柄。 */
    export function createPublicKey(options: { readonly key: Uint8Array; readonly format: 'der'; readonly type: 'spki' }): unknown;
    /** @description 校验 Ed25519 签名。 */
    export function verify(algorithm: null, data: Uint8Array, key: unknown, signature: Uint8Array): boolean;
}

declare module 'buffer' {
    /** @description Node Buffer 的最小静态构造声明。 */
    export const Buffer: {
        from(value: string, encoding: 'utf8' | 'base64'): Uint8Array;
    };
}

declare module 'path' {
    /** @description 连接路径片段。 */
    export function join(...paths: string[]): string;
    /** @description 解析为绝对路径。 */
    export function resolve(...paths: string[]): string;
    /** @description 计算目标路径相对于起点的路径。 */
    export function relative(from: string, to: string): string;
}
