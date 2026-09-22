import { Buffer } from 'buffer';
import { createPublicKey, verify as verifySignature } from 'crypto';

export type CpmSigningKind = 'cpm-release-v1' | 'lite-product-v1';

const FIELD_ORDERS = {
    'cpm-release-v1': ['id', 'version', 'channel', 'url', 'sha256'],
    'lite-product-v1': [
        'id',
        'version',
        'channel',
        'sourceCommit',
        'hostUrl',
        'hostSha256',
        'hostPackageDigest',
        'coreUrl',
        'coreSha256',
        'corePackageDigest',
        'creatorProfiles',
    ],
} as const satisfies Readonly<Record<CpmSigningKind, readonly string[]>>;

/**
 * @description CPM 与产品发行共用的 v1 规范化签名协议。
 */
export class CpmSigningProtocol {
    /**
     * @description 按协议固定字段顺序生成 UTF-8 JSON payload。
     */
    public static canonicalize(kind: CpmSigningKind, fields: Readonly<Record<string, unknown>>): string {
        const order = FIELD_ORDERS[kind];
        if (!isRecord(fields)) {
            throw new Error('cpm_signing_payload_invalid');
        }
        const payload: Record<string, unknown> = { schemaVersion: 1, kind };
        for (const field of order) {
            const value = fields[field];
            if (field === 'creatorProfiles') {
                if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
                    throw new Error('cpm_signing_payload_invalid');
                }
                payload[field] = [...value];
            } else {
                if (typeof value !== 'string' || value.length === 0) {
                    throw new Error('cpm_signing_payload_invalid');
                }
                payload[field] = value;
            }
        }
        return JSON.stringify(payload);
    }

    /**
     * @description 使用 DER/SPKI Base64 Ed25519 公钥验证规范化 payload。
     */
    public static verify(kind: CpmSigningKind, fields: Readonly<Record<string, unknown>>, signature: string, publicKey: string): boolean {
        if (signature.length === 0 || publicKey.length === 0) {
            return false;
        }
        try {
            return verifySignature(
                null,
                Buffer.from(this.canonicalize(kind, fields), 'utf8'),
                createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }),
                Buffer.from(signature, 'base64'),
            );
        } catch {
            return false;
        }
    }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
