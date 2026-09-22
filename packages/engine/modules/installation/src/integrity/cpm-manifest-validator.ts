import { CpmIntegrityProtocol, type ICpmFileRecord } from './cpm-integrity-protocol.js';

/**
 * @description CPM 目录包完整性元数据的最小结构。
 */
export interface ICpmPackageManifestInput {
    /**
     * @description 插件稳定标识。
     */
    readonly id: string;
    /**
     * @description 插件语义化版本。
     */
    readonly version: string;
    /**
     * @description 插件类型。
     */
    readonly kind: string;
    /**
     * @description 统一目录包入口。
     */
    readonly main: string;
    /**
     * @description 完整性元数据。
     */
    readonly package: {
        readonly schemaVersion: 1;
        readonly digest: string;
        readonly files: readonly ICpmFileRecord[];
    };
}

/**
 * @description CPM manifest 校验结果。
 */
export interface ICpmManifestValidationResult {
    /**
     * @description 是否满足目录包协议。
     */
    readonly ok: boolean;
    /**
     * @description 可供安装器展示的稳定问题代码。
     */
    readonly issues: readonly string[];
    /**
     * @description 校验成功后的最小 manifest。
     */
    readonly manifest: ICpmPackageManifestInput | null;
}

/**
 * @description 校验与 Creator 无关的 CPM 目录包 manifest 协议。
 */
export class CpmManifestValidator {
    /**
     * @description 插件标识格式。
     */
    private static readonly ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
    /**
     * @description 三段式语义化版本格式。
     */
    private static readonly VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

    /**
     * @description 校验外部 JSON 值并检查 manifest 声明的总摘要。
     * @param value 未受信的 JSON 值。
     * @returns 包含问题列表和已收窄 manifest 的校验结果。
     */
    public static validate(value: unknown): ICpmManifestValidationResult {
        const issues: string[] = [];
        if (!this.isRecord(value)) {
            return { ok: false, issues: ['cpm_manifest_invalid'], manifest: null };
        }
        const id = value.id;
        const version = value.version;
        const kind = value.kind;
        const main = value.main;
        const metadata = value.package;
        if (typeof id !== 'string' || !this.ID_PATTERN.test(id)) {
            issues.push('cpm_manifest_id_invalid');
        }
        if (typeof version !== 'string' || !this.VERSION_PATTERN.test(version)) {
            issues.push('cpm_manifest_version_invalid');
        }
        if (typeof kind !== 'string' || kind.length === 0) {
            issues.push('cpm_manifest_kind_invalid');
        }
        if (typeof id !== 'string' || typeof main !== 'string' || main !== `./${id}.bundle.js`) {
            issues.push('cpm_manifest_main_invalid');
        }
        if (!this.isRecord(metadata) || metadata.schemaVersion !== 1 || typeof metadata.digest !== 'string' || !Array.isArray(metadata.files)) {
            issues.push('cpm_package_metadata_invalid');
        }
        if (issues.length > 0 || !this.isRecord(metadata) || !Array.isArray(metadata.files) || typeof metadata.digest !== 'string') {
            return { ok: false, issues, manifest: null };
        }
        let files: ICpmFileRecord[];
        try {
            files = CpmIntegrityProtocol.sortRecords(metadata.files);
        } catch {
            issues.push('cpm_file_record_invalid');
            return { ok: false, issues, manifest: null };
        }
        if (files.length === 0) {
            issues.push('cpm_package_files_missing');
        }
        if (!CpmIntegrityProtocol.matchesDigest(files, metadata.digest)) {
            issues.push('cpm_package_digest_mismatch');
        }
        const manifest: ICpmPackageManifestInput = {
            id: id as string,
            version: version as string,
            kind: kind as string,
            main: main as string,
            package: { schemaVersion: 1, digest: metadata.digest, files },
        };
        return { ok: issues.length === 0, issues, manifest: issues.length === 0 ? manifest : null };
    }

    /**
     * @description 判断输入是否为非数组对象。
     * @param value 待判断输入。
     * @returns 是否可以按键读取。
     */
    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
