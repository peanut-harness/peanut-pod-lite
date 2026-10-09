import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { CpmSigningProtocol, SignedPluginCatalogVerifier, type ISignedPluginCatalogProduct } from '../src/index.js';

test('signed plugin catalog rejects tampered identity, version, channel, compatibility, URL, signature, and digest', (): void => {
    const pair = generateKeyPairSync('ed25519');
    const trustAnchor = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const product: ISignedPluginCatalogProduct = {
        productId: 'acme.tools', version: '1.2.3', channel: 'stable', creatorProfiles: ['3.8.3', '3.8.7'],
        url: 'https://releases.example/acme-tools-1.2.3.tar.gz', sha256: 'a'.repeat(64), packageDigest: 'b'.repeat(64),
    };
    const generatedAt = '2026-10-08T00:00:00.000Z';
    const fields = { channel: 'stable', generatedAt, catalogDigest: SignedPluginCatalogVerifier.digestProducts([product]) };
    const signature = sign(null, Buffer.from(CpmSigningProtocol.canonicalize('lite-plugin-catalog-v1', fields)), pair.privateKey).toString('base64');
    const catalog = { schemaVersion: 1, channel: 'stable', generatedAt, products: [product], signature } as const;
    const verifier = new SignedPluginCatalogVerifier(trustAnchor);

    assert.equal(verifier.verify(catalog).products[0]?.productId, 'acme.tools');
    assert.throws(() => verifier.verify({ ...catalog, products: [{ ...product, productId: 'acme.changed' }] }), /plugin_catalog_signature_invalid/u);
    assert.throws(() => verifier.verify({ ...catalog, products: [{ ...product, version: '2.0.0' }] }), /plugin_catalog_signature_invalid/u);
    assert.throws(() => verifier.verify({ ...catalog, channel: 'beta' }), /plugin_catalog_channel_mismatch/u);
    assert.throws(() => verifier.verify({ ...catalog, products: [{ ...product, creatorProfiles: ['3.9.0'] }] }), /plugin_catalog_product_invalid/u);
    assert.throws(() => verifier.verify({ ...catalog, products: [{ ...product, url: 'http://releases.example/package.tgz' }] }), /plugin_catalog_url_invalid/u);
    assert.throws(() => verifier.verify({ ...catalog, signature: 'AAAA' }), /plugin_catalog_signature_invalid/u);
    assert.throws(() => new SignedPluginCatalogVerifier('').verify(catalog), /plugin_catalog_trust_anchor_required/u);
});
