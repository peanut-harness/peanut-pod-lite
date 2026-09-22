import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { CpmSigningProtocol } from '../packages/engine/modules/installation/src/integrity/cpm-signing-protocol.ts';
import { readRootReleaseVersion } from './release-identity.mts';

const PRODUCT_ID = 'peanut.pod-lite';
const CREATOR_PROFILES = Object.freeze(['3.8.3', '3.8.7']);
const OPERATION_COUNTS = Object.freeze({ operationCount: 83, readOperationCount: 38, writeOperationCount: 45 });
// 与 cpm-install `dev-signing.mjs` 相同的公开种子：开发密钥人人可复现，仅在 CPM_DEV_KEYS=1 时被信任且永不用于 stable。
const LITE_PRODUCT_DEV_SEED = 'peanut-harness/lite-product-dev/v1';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** @description 内置 Lite 产品开发私钥（公开种子派生，仅用于开发测试）。 */
export function devProductPrivateKey() {
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, createHash('sha256').update(LITE_PRODUCT_DEV_SEED).digest()]), format: 'der', type: 'pkcs8' });
}

/**
 * @description 重新核对已打包的 Lite 候选：descriptor 身份、双 Creator 画像、archive SHA-256
 * 以及从 archive 字节重算的 Host/Core 目录包摘要。发布只消费通过本检查的 artifact。
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

/**
 * @description 由已核对 descriptor 生成 `lite-product-v1` 签名输入。
 * @param {object} descriptor {@link verifyReleaseCandidate} 返回值。
 * @param {{ baseUrl: string, channel: string }} options 不可变 HTTPS 目录与渠道。
 * @returns {object} 受签字段。
 */
export function createSigningInput(descriptor, options) {
    let base;
    try {
        base = new URL(`${options.baseUrl.replace(/\/+$/u, '')}/`);
    } catch {
        throw new Error('lite_release_base_url_invalid');
    }
    if (base.protocol !== 'https:' || base.username || base.password || base.hash || base.search) throw new Error('lite_release_base_url_invalid');
    if (!['beta', 'internal', 'stable'].includes(options.channel)) throw new Error('lite_release_channel_invalid');
    const fields = {
        id: descriptor.productId,
        version: descriptor.version,
        channel: options.channel,
        sourceCommit: descriptor.sourceCommit,
        hostUrl: new URL(descriptor.host.archive, base).href,
        hostSha256: descriptor.host.sha256,
        hostPackageDigest: descriptor.host.packageDigest,
        coreUrl: new URL(descriptor.core.archive, base).href,
        coreSha256: descriptor.core.sha256,
        corePackageDigest: descriptor.core.packageDigest,
        creatorProfiles: descriptor.creatorProfiles.map((profile) => profile.version),
    };
    CpmSigningProtocol.canonicalize('lite-product-v1', fields);
    return fields;
}

/**
 * @description 使用受控产品私钥签名；缺失私钥时失败关闭，dry-run 只输出规范化 payload；devKey 使用内置开发密钥（拒绝 stable）。
 * @returns {object} dry-run 为 `{ payload }`，否则为 `{ publicKey, product }`。
 */
export function signProductEntry(fields, options: { privateKeyPem?: string, devKey?: boolean, dryRun?: boolean } = {}) {
    const payload = CpmSigningProtocol.canonicalize('lite-product-v1', fields);
    if (options.dryRun === true) return { payload };
    let privateKey;
    if (options.devKey === true) {
        if (fields.channel === 'stable') throw new Error('lite_product_dev_key_stable_refused');
        privateKey = devProductPrivateKey();
    } else {
        if (typeof options.privateKeyPem !== 'string' || options.privateKeyPem.length === 0) throw new Error('lite_product_signing_key_missing');
        try {
            privateKey = createPrivateKey(options.privateKeyPem);
        } catch {
            throw new Error('lite_product_signing_key_invalid');
        }
    }
    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64');
    const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
    if (!CpmSigningProtocol.verify('lite-product-v1', fields, signature, publicKey)) throw new Error('lite_product_signature_invalid');
    return { publicKey, product: { ...fields, signature } };
}

/**
 * @description 从候选 HTTPS 地址回读 Host/Core archive 并核对受签摘要，不跟随重定向。
 * @returns {Promise<object>} 回读证据。
 */
export async function verifyCandidateReadback(fields, fetchImpl = globalThis.fetch) {
    const evidence = {};
    for (const kind of ['host', 'core']) {
        const url = fields[`${kind}Url`];
        const response = await fetchImpl(url, { redirect: 'error' });
        if (response.redirected) throw new Error('lite_release_readback_redirect_refused');
        if (!response.ok) throw new Error(`lite_release_readback_refused:${response.status}`);
        const digest = sha256(Buffer.from(await response.arrayBuffer()));
        if (digest !== fields[`${kind}Sha256`]) throw new Error(`lite_release_readback_mismatch:${kind}`);
        evidence[kind] = { url, sha256: digest };
    }
    return { schemaVersion: 1, id: fields.id, version: fields.version, ...evidence };
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
    const option = (name: string) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
    };
    const command = args[0];
    if (command === 'candidate') {
        const version = readRootReleaseVersion(repositoryRoot);
        const descriptor = verifyReleaseCandidate(join(repositoryRoot, 'release', `${PRODUCT_ID}-${version}`), { expectedVersion: version, expectedSourceCommit: cleanSourceCommit(repositoryRoot) });
        const fields = createSigningInput(descriptor, { baseUrl: option('--base-url') ?? '', channel: option('--channel') ?? 'beta' });
        const output = option('--out');
        if (output != null) writeFileSync(output, `${JSON.stringify(fields, null, 4)}\n`, { flag: 'wx' });
        return fields;
    }
    const fields = JSON.parse(readFileSync(option('--input') ?? '', 'utf8'));
    if (command === 'sign') {
        const devKey = args.includes('--dev-key');
        return signProductEntry(fields, { dryRun: args.includes('--dry-run'), devKey, privateKeyPem: devKey ? undefined : process.env.LITE_PRODUCT_SIGNING_KEY });
    }
    if (command === 'readback') return verifyCandidateReadback(fields);
    throw new Error('lite_release_cli_usage');
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'lite_release_failed'}\n`);
        process.exitCode = 1;
    }
}
