import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { DirectoryPackageIntegrityProtocol } from '@peanut/pod-engine/installation';

/**
 * @description Host 与 Core 候选身份比较所需的目录摘要。
 */
export interface IHostArtifactIdentity {
    /**
     * @description Host 的包标识、版本和总摘要。
     */
    readonly host?: { readonly id?: string; readonly version?: string; readonly packageDigest?: string } | null;
    /**
     * @description Core 的包标识、版本和总摘要。
     */
    readonly core?: { readonly id?: string; readonly version?: string; readonly packageDigest?: string } | null;
}

/**
 * @description 当前 Lite 候选中用于比对 Host 与 Core 的固定身份字段。
 */
export interface IHostReleaseIdentity {
    /**
     * @description Lite 产品标识。
     */
    readonly productId?: string;
    /**
     * @description 候选版本。
     */
    readonly version?: string;
    /**
     * @description Host 目录包总摘要。
     */
    readonly host?: { readonly packageDigest?: string } | null;
    /**
     * @description Core 目录包总摘要。
     */
    readonly core?: { readonly packageDigest?: string } | null;
}

/**
 * @description 计算 Host 发行目录摘要并比较候选身份；摘要字节与已冻结向量一致。
 */
export class HostPackageIdentity {
    /**
     * @description 计算 Host 扩展目录的 SHA-256 汇总摘要，拒绝开发目录与链接。
     * @param root Host 扩展根目录。
     * @returns 发行目录摘要；不适合当作发行物时返回 `null`。
     */
    public static hostPackageDigest(root: string): string | null {
        const records: [string, string][] = [];
        const walk = (directory: string, prefix: string): void => {
            for (const entry of readdirSync(directory, { withFileTypes: true })) {
                if (entry.name === '.DS_Store') continue;
                const recordPath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
                if (entry.isDirectory()) {
                    if (recordPath === 'node_modules') throw new Error('development_checkout');
                    walk(join(directory, entry.name), recordPath);
                } else if (entry.isFile()) {
                    records.push([recordPath, DirectoryPackageIntegrityProtocol.sha256(readFileSync(join(directory, entry.name)))]);
                } else {
                    throw new Error('unsupported_entry');
                }
            }
        };
        try {
            walk(root, '');
        } catch {
            return null;
        }
        records.sort(([left], [right]) => DirectoryPackageIntegrityProtocol.comparePaths(left, right));
        return DirectoryPackageIntegrityProtocol.sha256(records.map(([path, digest]) => `${path}:${digest}`).join('\n'));
    }

    /**
     * @description 报告 Host/Core 活动包与候选身份的字段差异。
     * @param artifacts Host 报告的实际身份。
     * @param descriptor 候选发行身份。
     * @returns 不一致字段名称；空数组表示一致。
     */
    public static compareReleaseIdentity(artifacts: IHostArtifactIdentity | null | undefined,
        descriptor: IHostReleaseIdentity | null | undefined): string[] {
        const mismatches: string[] = [];
        const expect = (field: string, actual: string | undefined, expected: string | undefined): void => {
            if (actual !== expected) mismatches.push(field);
        };
        expect('host.id', artifacts?.host?.id, 'peanut-pod-lite-host');
        expect('host.version', artifacts?.host?.version, descriptor?.version);
        expect('host.packageDigest', artifacts?.host?.packageDigest, descriptor?.host?.packageDigest);
        expect('core.id', artifacts?.core?.id, descriptor?.productId);
        expect('core.version', artifacts?.core?.version, descriptor?.version);
        expect('core.packageDigest', artifacts?.core?.packageDigest, descriptor?.core?.packageDigest);
        return mismatches;
    }
}
