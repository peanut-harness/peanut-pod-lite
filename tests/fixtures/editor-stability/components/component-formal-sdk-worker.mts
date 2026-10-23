import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { verifyReleaseCandidate } from '../../../../tools/release-candidate.mts';

/**
 * @description 正式 Host worker 的已核验制品来源；不声明 worker 实际 installed 或 start 计数。
 */
export interface IComponentFormalSdkWorkerProof {
    readonly kind: 'formal-host-sdk-worker';
    readonly creatorVersion: '3.8.7';
    readonly sourceCommit: string;
    readonly hostSha256: string;
    readonly hostPackageDigest: string;
    readonly manifestSha256: string;
    readonly entry: 'direct-sdk-worker';
    readonly workerSha256: string;
    readonly sourceVerified: true;
}

/**
 * @description 组件夹具只消费已冻结正式 worker，拒绝与历史测试 patch 同时安装。
 */
export class ComponentFormalSdkWorker {
    /**
     * @description 校验候选 archive 后读取固定两个条目；3.8.3 不声称已安装 3.8.7 修复。
     * @param directory 已冻结候选目录。
     * @param sourceCommit 完整期望源码提交。
     * @param version 实际 Creator 版本。
     * @returns 正式来源证明，历史无 worker 候选返回 null。
     */
    public static source(directory: string, sourceCommit: string, version: string): IComponentFormalSdkWorkerProof | null {
        if (version !== '3.8.7') return null;
        const candidate = verifyReleaseCandidate(directory, { expectedSourceCommit: sourceCommit });
        const read = (file: string): Buffer => execFileSync('/usr/bin/tar', ['-xOf', join(directory, candidate.host.archive),
            `peanut-pod-lite-host-${candidate.version}/${file}`], { maxBuffer: 4 * 1024 * 1024 });
        const manifest = read('package.json'); const parsed = JSON.parse(manifest.toString('utf8'));
        if (parsed.contributions?.['asset-db'] === undefined) return null;
        return this.fromBytes(candidate, { manifest, worker: read('dist/sdk-startup-timer-worker.js') });
    }

    /**
     * @description 将已校验制品固定条目绑定到精确贡献和摘要；不把来源证明伪装成运行回执。
     * @param candidate 已通过完整 archive 验证的候选身份。
     * @param files 从相同 archive 读取的固定文件。
     * @returns 正式 worker 来源证明。
     */
    public static fromBytes(candidate: { sourceCommit: string; host: { sha256: string; packageDigest: string } },
        files: { manifest: Buffer; worker: Buffer }): IComponentFormalSdkWorkerProof {
        const manifest = JSON.parse(files.manifest.toString('utf8'));
        const expected = { script: './dist/sdk-startup-timer-worker.js', 'global-hook': ['beforePreStart'] };
        if (!/^[a-f0-9]{40}$/u.test(candidate.sourceCommit) || !/^[a-f0-9]{64}$/u.test(candidate.host.sha256)
            || !/^[a-f0-9]{64}$/u.test(candidate.host.packageDigest) || manifest.name !== 'peanut-pod-lite-host'
            || !isDeepStrictEqual(manifest.contributions?.['asset-db'], expected)
            || files.worker.length === 0
            || [files.manifest, files.worker].some(bytes => bytes.length > 4 * 1024 * 1024))
            throw new Error('component_formal_sdk_worker_source_invalid');
        return { kind: 'formal-host-sdk-worker', creatorVersion: '3.8.7', sourceCommit: candidate.sourceCommit,
            hostSha256: candidate.host.sha256, hostPackageDigest: candidate.host.packageDigest, manifestSha256: this.sha(files.manifest),
            entry: 'direct-sdk-worker', workerSha256: this.sha(files.worker), sourceVerified: true };
    }

    /**
     * @description 正式候选与旧测试 worker 互斥，避免两个修复改写同一个 SDK 方法。
     * @param version 精确 Creator 版本。
     * @param legacy 显式历史夹具模式。
     * @param formal 已核验正式来源。
     * @returns 是否使用正式来源作为 UI-ready 前置。
     */
    public static mode(version: string, legacy: boolean, formal: IComponentFormalSdkWorkerProof | null): boolean {
        if (formal && (version !== '3.8.7' || formal.creatorVersion !== version || legacy))
            throw new Error('component_formal_sdk_worker_legacy_conflict');
        return formal !== null;
    }

    /**
     * @description 核对当前工程实际安装文件与登记，不读取或伪造历史 starts/installed 回执。
     * @param project 当前已登记工程。
     * @param registration 当前候选登记。
     * @param proof 从当前已核验 archive 独立重算的来源。
     */
    public static assertInstalled(project: string, registration: Readonly<Record<string, unknown>>, proof: IComponentFormalSdkWorkerProof): void {
        if (registration.sdkStartupTimerCompat === true || registration.creatorVersion !== '3.8.7'
            || registration.candidateSourceCommit !== proof.sourceCommit || registration.hostSha256 !== proof.hostSha256
            || !isDeepStrictEqual(registration.formalSdkStartupTimer, proof)) throw new Error('component_formal_sdk_worker_registration_mismatch');
        const root = join(project, 'extensions/peanut-pod-lite-host');
        if (realpathSync(root) !== root || lstatSync(root).isSymbolicLink()) throw new Error('component_formal_sdk_worker_link_refused');
        for (const [file, expected] of [['package.json', proof.manifestSha256],
            ['dist/sdk-startup-timer-worker.js', proof.workerSha256]]) {
            const path = join(root, file);
            if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink() || this.sha(readFileSync(path)) !== expected)
                throw new Error('component_formal_sdk_worker_payload_mismatch');
        }
        if (existsSync(join(project, '../sdk-startup-timer-compat-state.json')))
            throw new Error('component_formal_sdk_worker_legacy_receipt_present');
    }

    /**
     * @description 固定条目的原始 SHA-256。
     */
    private static sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
