import { createHash } from 'crypto';

/**
 * @description CPM 目录包中的单个普通文件摘要记录。
 */
export interface ICpmFileRecord {
    /**
     * @description 包根目录下使用 `/` 分隔的相对文件路径。
     */
    readonly path: string;
    /**
     * @description 文件内容的 SHA-256 十六进制摘要。
     */
    readonly digest: string;
}

/**
 * @description 提供与宿主无关的 CPM 文件路径和包摘要协议。
 */
export class CpmIntegrityProtocol {
    /**
     * @description 允许的 SHA-256 十六进制摘要格式。
     */
    private static readonly DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
    /**
     * @description 允许的包内相对路径格式。
     */
    private static readonly PATH_PATTERN = /^[A-Za-z0-9._\-\s]+(?:\/[A-Za-z0-9._\-\s]+)*$/u;

    /**
     * @description 计算文件内容的 SHA-256 摘要。
     * @param content 待摘要的文本或二进制内容。
     * @returns 小写十六进制摘要。
     */
    public static sha256(content: string | Uint8Array): string {
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * @description 校验并复制文件记录，按路径生成稳定顺序。
     * @param records 未受信的文件摘要记录。
     * @returns 校验后的排序记录；非法记录或重复路径会抛出诊断错误。
     */
    public static sortRecords(records: readonly ICpmFileRecord[]): ICpmFileRecord[] {
        const paths = new Set<string>();
        const validated = records.map((record) => {
            if (!this.isRecord(record) || !this.isSafePath(record.path) || !this.DIGEST_PATTERN.test(record.digest) || paths.has(record.path)) {
                throw new Error('cpm_file_record_invalid');
            }
            paths.add(record.path);
            return { path: record.path, digest: record.digest };
        });
        return validated.sort((left, right) => left.path.localeCompare(right.path));
    }

    /**
     * @description 按固定 `path:digest` 换行协议计算目录包总摘要。
     * @param records 已校验或可被校验的文件摘要记录。
     * @returns 小写十六进制包摘要。
     */
    public static digest(records: readonly ICpmFileRecord[]): string {
        return this.sha256(this.sortRecords(records).map((record) => `${record.path}:${record.digest}`).join('\n'));
    }

    /**
     * @description 判断路径是否为不含穿越、绝对路径或空段的包内路径。
     * @param path 待检查路径。
     * @returns 路径是否符合 CPM 包协议。
     */
    public static isSafePath(path: unknown): path is string {
        return typeof path === 'string' && this.PATH_PATTERN.test(path) && !path.split('/').some((segment) => segment === '.' || segment === '..');
    }

    /**
     * @description 判断输入是否为非数组对象。
     * @param value 待判断输入。
     * @returns 是否可作为文件记录读取。
     */
    private static isRecord(value: unknown): value is ICpmFileRecord {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
