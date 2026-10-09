import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CpmSigningProtocol, RemotePackageDownloader, SignedPluginCatalogVerifier, type ISignedPluginCatalogProduct, type RemoteFetch } from '../src/index.js';

const body = new TextEncoder().encode('verified archive bytes');
const product: ISignedPluginCatalogProduct = {
    productId: 'acme.tools', version: '1.0.0', channel: 'stable', creatorProfiles: ['3.8.7'],
    url: 'https://releases.example/acme-tools-1.0.0.tar.gz',
    sha256: createHash('sha256').update(body).digest('hex'), packageDigest: 'b'.repeat(64),
};

test('remote downloader verifies the stream digest and removes staged data on dispose', async (): Promise<void> => {
    const staging = mkdtempSync(join(tmpdir(), 'peanut-download-'));
    try {
        const downloader = new RemotePackageDownloader({ stagingDirectory: staging, fetch: response(body, String(body.length)) });
        const result = await downloader.download(product);
        assert.equal(existsSync(result.archivePath), true);
        assert.equal(result.bytes, body.length);
        result.dispose();
        assert.deepEqual(readdirSync(staging), []);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
});

test('remote downloader refuses digest mismatch, redirects, oversized and incomplete payloads without residue', async (): Promise<void> => {
    const staging = mkdtempSync(join(tmpdir(), 'peanut-download-'));
    const downloader = new RemotePackageDownloader({ stagingDirectory: staging, maxBytes: 64, fetch: response(body, String(body.length)) });
    try {
        await assert.rejects(downloader.download({ ...product, sha256: 'c'.repeat(64) }), /plugin_download_digest_mismatch/u);
        await assert.rejects(new RemotePackageDownloader({ stagingDirectory: staging, fetch: async () => ({ ...makeResponse(body), redirected: true }) }).download(product), /plugin_download_http_refused/u);
        await assert.rejects(new RemotePackageDownloader({ stagingDirectory: staging, maxBytes: 4, fetch: response(body, String(body.length)) }).download(product), /plugin_download_size_refused/u);
        await assert.rejects(new RemotePackageDownloader({ stagingDirectory: staging, fetch: response(body, String(body.length + 1)) }).download(product), /plugin_download_incomplete/u);
        assert.deepEqual(readdirSync(staging), []);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
});

test('remote downloader removes staging after cancellation', async (): Promise<void> => {
    const staging = mkdtempSync(join(tmpdir(), 'peanut-download-'));
    const controller = new AbortController();
    const fetch: RemoteFetch = async (_url, init) => new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    try {
        const pending = new RemotePackageDownloader({ stagingDirectory: staging, fetch }).download(product, controller.signal);
        controller.abort();
        await assert.rejects(pending, /cancelled/u);
        assert.deepEqual(readdirSync(staging), []);
    } finally {
        rmSync(staging, { recursive: true, force: true });
    }
});

test('remote downloader bounds and verifies a signed catalog before returning it', async (): Promise<void> => {
    const pair = generateKeyPairSync('ed25519');
    const trustAnchor = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const generatedAt = '2026-10-08T00:00:00.000Z';
    const catalogFields = { channel: 'stable', generatedAt, catalogDigest: SignedPluginCatalogVerifier.digestProducts([product]) };
    const signature = sign(null, Buffer.from(CpmSigningProtocol.canonicalize('lite-plugin-catalog-v1', catalogFields)), pair.privateKey).toString('base64');
    const catalog = { schemaVersion: 1, channel: 'stable', generatedAt, products: [product], signature };
    const bytes = new TextEncoder().encode(JSON.stringify(catalog));
    const downloader = new RemotePackageDownloader({ stagingDirectory: '/tmp/peanut-catalog-test', fetch: response(bytes, String(bytes.length)) });
    const verified = await downloader.fetchCatalog('https://catalog.example/plugins.json', new SignedPluginCatalogVerifier(trustAnchor));
    assert.equal(verified.products[0]?.productId, product.productId);
    await assert.rejects(downloader.fetchCatalog('http://catalog.example/plugins.json', new SignedPluginCatalogVerifier(trustAnchor)), /plugin_catalog_url_invalid/u);
    await assert.rejects(new RemotePackageDownloader({ stagingDirectory: '/tmp/peanut-catalog-test', fetch: response(bytes, String(bytes.length)) }).fetchCatalog(
        'https://catalog.example/plugins.json', new SignedPluginCatalogVerifier('not-a-key'),
    ), /plugin_catalog_signature_invalid/u);
});

function response(bytes: Uint8Array, length: string): RemoteFetch {
    return async () => makeResponse(bytes, length);
}

function makeResponse(bytes: Uint8Array, length = String(bytes.length)) {
    let read = false;
    return {
        ok: true,
        status: 200,
        redirected: false,
        headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? length : null },
        body: {
            getReader: () => ({
                read: async () => {
                    if (read) return { done: true };
                    read = true;
                    return { done: false, value: bytes };
                },
                cancel: async () => undefined,
            }),
        },
    };
}
