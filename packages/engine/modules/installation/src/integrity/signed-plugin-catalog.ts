import { createHash } from 'crypto';

import { CpmSigningProtocol } from './cpm-signing-protocol.js';

export interface ISignedPluginCatalogProduct {
    readonly productId: string;
    readonly version: string;
    readonly channel: 'stable' | 'beta';
    readonly creatorProfiles: readonly string[];
    readonly url: string;
    readonly sha256: string;
    readonly packageDigest: string;
}

export interface ISignedPluginCatalog {
    readonly schemaVersion: 1;
    readonly channel: 'stable' | 'beta';
    readonly generatedAt: string;
    readonly products: readonly ISignedPluginCatalogProduct[];
    readonly signature: string;
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const PROFILE_PATTERN = /^3\.8\.\d+$/u;

/**
 * Validates the complete catalog envelope against a dedicated pinned Ed25519 trust anchor.
 */
export class SignedPluginCatalogVerifier {
    private readonly _trustAnchor: string;

    public constructor(trustAnchor: string) {
        if (typeof trustAnchor !== 'string' || trustAnchor.trim().length === 0) throw new Error('plugin_catalog_trust_anchor_required');
        this._trustAnchor = trustAnchor;
    }

    public verify(value: unknown): ISignedPluginCatalog {
        if (!isRecord(value)
            || Object.keys(value).sort().join(',') !== 'channel,generatedAt,products,schemaVersion,signature'
            || value.schemaVersion !== 1 || !isChannel(value.channel)
            || typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))
            || new Date(value.generatedAt).toISOString() !== value.generatedAt
            || !Array.isArray(value.products) || typeof value.signature !== 'string' || value.signature.length === 0) {
            throw new Error('plugin_catalog_envelope_invalid');
        }
        const products = value.products.map(validateProduct);
        const identities = products.map((product) => `${product.productId}@${product.version}`);
        if (new Set(identities).size !== identities.length) throw new Error('plugin_catalog_duplicate_product');
        if (products.some((product) => product.channel !== value.channel)) throw new Error('plugin_catalog_channel_mismatch');
        const fields = {
            channel: value.channel,
            generatedAt: value.generatedAt,
            catalogDigest: SignedPluginCatalogVerifier.digestProducts(products),
        };
        if (!CpmSigningProtocol.verify('lite-plugin-catalog-v1', fields, value.signature, this._trustAnchor)) {
            throw new Error('plugin_catalog_signature_invalid');
        }
        return Object.freeze({
            schemaVersion: 1,
            channel: value.channel,
            generatedAt: value.generatedAt,
            products: Object.freeze(products),
            signature: value.signature,
        });
    }

    public static digestProducts(products: readonly ISignedPluginCatalogProduct[]): string {
        const canonical = [...products]
            .sort((left, right) => left.productId.localeCompare(right.productId) || left.version.localeCompare(right.version))
            .map((product) => ({
                productId: product.productId,
                version: product.version,
                channel: product.channel,
                creatorProfiles: [...product.creatorProfiles].sort(),
                url: product.url,
                sha256: product.sha256,
                packageDigest: product.packageDigest,
            }));
        return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    }
}

function validateProduct(value: unknown): ISignedPluginCatalogProduct {
    if (!isRecord(value)
        || Object.keys(value).sort().join(',') !== 'channel,creatorProfiles,packageDigest,productId,sha256,url,version'
        || typeof value.productId !== 'string' || !ID_PATTERN.test(value.productId)
        || typeof value.version !== 'string' || !VERSION_PATTERN.test(value.version)
        || !isChannel(value.channel)
        || !Array.isArray(value.creatorProfiles) || value.creatorProfiles.length === 0
        || value.creatorProfiles.some((profile) => typeof profile !== 'string' || !PROFILE_PATTERN.test(profile))
        || new Set(value.creatorProfiles).size !== value.creatorProfiles.length
        || typeof value.url !== 'string'
        || typeof value.sha256 !== 'string' || !DIGEST_PATTERN.test(value.sha256)
        || typeof value.packageDigest !== 'string' || !DIGEST_PATTERN.test(value.packageDigest)) {
        throw new Error('plugin_catalog_product_invalid');
    }
    let url: URL;
    try {
        url = new URL(value.url as string);
    } catch {
        throw new Error('plugin_catalog_url_invalid');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('plugin_catalog_url_invalid');
    return Object.freeze({
        productId: value.productId,
        version: value.version,
        channel: value.channel,
        creatorProfiles: Object.freeze([...value.creatorProfiles] as string[]),
        url: url.href,
        sha256: value.sha256,
        packageDigest: value.packageDigest,
    });
}

function isChannel(value: unknown): value is 'stable' | 'beta' {
    return value === 'stable' || value === 'beta';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
