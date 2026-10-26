import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { readRootReleaseVersion } from './release-identity.mts';

const PRODUCT_ID = 'peanut.pod-lite';
const CREATOR_PROFILES = Object.freeze(['3.8.3', '3.8.7']);
const OPERATION_COUNTS = Object.freeze({ operationCount: 88, readOperationCount: 41, writeOperationCount: 47 });
/**
 * @description 重新核对已打包的 Lite 候选：descriptor 身份、双 Creator 画像、archive SHA-256
 * 以及从 archive 字节重算的 Host/Core 目录包摘要。安装只消费通过本检查的候选。
 * @param {string} releaseDirectory `release/peanut.pod-lite-<version>` 目录。
 * @param {{ expectedVersion?: string, expectedSourceCommit?: string }} [options] 期望身份。
 * @returns {object} 已核对的 descriptor。
 */
export function verifyReleaseCandidate(releaseDirectory, options = {}) {
    const descriptor = JSON.parse(readFileSync(join(releaseDirectory, 'lite-release-descriptor.json'), 'utf8'));
    if (descriptor?.schemaVersion !== 1 || descriptor.productId !== PRODUCT_ID || typeof descriptor.version !== 'string' || !/^[a-f0-9]{40}$/u.test(descriptor.sourceCommit ?? '')) {
        throw new Error('lite_release_descriptor_invalid');
    }
    if (options.expectedVersion != null && descriptor.version !== options.expectedVersion) throw new Error('lite_release_version_mismatch');
    if (options.expectedSourceCommit != null && descriptor.sourceCommit !== options.expectedSourceCommit) throw new Error('lite_release_source_commit_mismatch');
    const profiles = Array.isArray(descriptor.creatorProfiles) ? descriptor.creatorProfiles : [];
    if (profiles.length !== CREATOR_PROFILES.length || profiles.some((profile, index) => profile?.version !== CREATOR_PROFILES[index]
        || profile.operationCount !== OPERATION_COUNTS.operationCount
        || profile.readOperationCount !== OPERATION_COUNTS.readOperationCount
        || profile.writeOperationCount !== OPERATION_COUNTS.writeOperationCount)) {
        throw new Error('lite_release_creator_profiles_invalid');
    }
    const host = readArchive(releaseDirectory, descriptor.host, 'host', `peanut-pod-lite-host-${descriptor.version}`);
    if (packageDigest(host) !== descriptor.host.packageDigest) throw new Error('lite_release_host_digest_mismatch');
    const core = readArchive(releaseDirectory, descriptor.core, 'core', `${PRODUCT_ID}-${descriptor.version}`);
    const manifestName = `${PRODUCT_ID}.manifest.json`;
    const manifest = JSON.parse(core.get(manifestName)?.toString('utf8') ?? 'null');
    if (manifest?.id !== PRODUCT_ID || manifest.version !== descriptor.version || manifest.package?.digest !== descriptor.core.packageDigest) {
        throw new Error('lite_release_core_manifest_mismatch');
    }
    const declared = new Map((manifest.package.files ?? []).map((record) => [record.path, record.digest]));
    const payload = [...core.keys()].filter((path) => path !== manifestName);
    if (payload.length !== declared.size || payload.some((path) => declared.get(path) !== sha256(core.get(path)))) throw new Error('lite_release_core_payload_mismatch');
    if (packageDigest(core, manifestName) !== descriptor.core.packageDigest) throw new Error('lite_release_core_digest_mismatch');
    return descriptor;
}

function readArchive(releaseDirectory, artifact, kind, rootName) {
    if (artifact?.kind !== kind || typeof artifact.archive !== 'string' || artifact.archive.includes('/')) throw new Error('lite_release_descriptor_invalid');
    const content = readFileSync(join(releaseDirectory, artifact.archive));
    if (sha256(content) !== artifact.sha256) throw new Error(`lite_release_archive_digest_mismatch:${kind}`);
    const tar = gunzipSync(content);
    const files = new Map<string, Buffer>();
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((value) => value === 0)) break;
        const name = readString(header, 0, 100);
        const prefix = readString(header, 345, 155);
        const path = (prefix.length === 0 ? name : `${prefix}/${name}`).replace(/\/$/u, '');
        const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8);
        const type = header[156];
        const segments = path.split('/');
        if (segments[0] !== rootName || segments.some((segment) => segment === '..' || segment === '')) throw new Error(`lite_release_archive_layout_invalid:${kind}`);
        if (type === 0x30 || type === 0) files.set(segments.slice(1).join('/'), Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
        else if (type !== 0x35) throw new Error(`lite_release_archive_layout_invalid:${kind}`);
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}

function packageDigest(files: Map<string, Buffer>, excluded?: string) {
    const records = [...files.entries()]
        .filter(([path]) => path !== excluded)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, content]) => `${path}:${sha256(content)}`);
    return sha256(records.join('\n'));
}

function readString(buffer: Buffer, offset: number, length: number) {
    const slice = buffer.subarray(offset, offset + length);
    const end = slice.indexOf(0);
    return slice.subarray(0, end < 0 ? slice.length : end).toString('utf8');
}

function sha256(content: Buffer | string) {
    return createHash('sha256').update(content).digest('hex');
}

function cleanSourceCommit(repositoryRoot: string) {
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0) throw new Error('lite_release_source_dirty');
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

async function main(args: string[]) {
    const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
    if (args[0] !== 'candidate' || args.length > 1) throw new Error('lite_release_cli_usage');
    const version = readRootReleaseVersion(repositoryRoot);
    return verifyReleaseCandidate(join(repositoryRoot, 'release', `${PRODUCT_ID}-${version}`),
        { expectedVersion: version, expectedSourceCommit: cleanSourceCommit(repositoryRoot) });
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'lite_release_failed'}\n`);
        process.exitCode = 1;
    }
}
