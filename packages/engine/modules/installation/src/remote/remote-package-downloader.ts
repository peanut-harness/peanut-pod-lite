import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import type { ISignedPluginCatalogProduct } from '../integrity/signed-plugin-catalog.js';
import { SignedPluginCatalogVerifier, type ISignedPluginCatalog } from '../integrity/signed-plugin-catalog.js';

interface IRemoteResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly redirected: boolean;
    readonly headers: { get(name: string): string | null };
    readonly body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> } } | null;
}

export type RemoteFetch = (url: string, init: { readonly redirect: 'error'; readonly signal?: unknown }) => Promise<IRemoteResponse>;

export interface IRemotePackageDownload {
    readonly archivePath: string;
    readonly bytes: number;
    dispose(): void;
}

export interface IRemotePackageDownloaderOptions {
    readonly stagingDirectory: string;
    readonly fetch?: RemoteFetch;
    readonly maxBytes?: number;
}

/**
 * Downloads only authenticated catalog records into a bounded, disposable staging directory.
 */
export class RemotePackageDownloader {
    private readonly _stagingDirectory: string;
    private readonly _fetch: RemoteFetch;
    private readonly _maxBytes: number;

    public constructor(options: IRemotePackageDownloaderOptions) {
        if (options.stagingDirectory.trim().length === 0) throw new Error('plugin_download_staging_directory_required');
        this._stagingDirectory = resolve(options.stagingDirectory);
        this._fetch = options.fetch ?? (globalThis.fetch as unknown as RemoteFetch);
        this._maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
        if (!Number.isSafeInteger(this._maxBytes) || this._maxBytes < 1 || this._maxBytes > 512 * 1024 * 1024) {
            throw new Error('plugin_download_max_bytes_invalid');
        }
    }

    public async download(product: ISignedPluginCatalogProduct, signal?: unknown): Promise<IRemotePackageDownload> {
        let url: URL;
        try {
            url = new URL(product.url);
        } catch {
            throw new Error('plugin_download_url_invalid');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/u.test(product.sha256)) {
            throw new Error('plugin_download_product_invalid');
        }
        mkdirSync(this._stagingDirectory, { recursive: true });
        const temporaryDirectory = mkdtempSync(join(this._stagingDirectory, 'download-'));
        try {
            const response = await this._fetch(url.href, { redirect: 'error', signal });
            if (!response.ok || response.redirected) throw new Error(`plugin_download_http_refused:${response.status}`);
            const contentLengthHeader = response.headers.get('content-length');
            if (contentLengthHeader != null) {
                const contentLength = Number(contentLengthHeader);
                if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > this._maxBytes) throw new Error('plugin_download_size_refused');
            }
            if (response.body == null) throw new Error('plugin_download_body_missing');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let byteCount = 0;
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                if (!(part.value instanceof Uint8Array) || part.value.length === 0) throw new Error('plugin_download_chunk_invalid');
                byteCount += part.value.length;
                if (byteCount > this._maxBytes) {
                    await reader.cancel();
                    throw new Error('plugin_download_size_refused');
                }
                chunks.push(part.value);
            }
            if (byteCount === 0) throw new Error('plugin_download_body_missing');
            if (contentLengthHeader != null && byteCount !== Number(contentLengthHeader)) throw new Error('plugin_download_incomplete');
            const bytes = new Uint8Array(byteCount);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            const digest = createHash('sha256').update(bytes).digest('hex');
            if (digest !== product.sha256) throw new Error('plugin_download_digest_mismatch');
            const archivePath = join(temporaryDirectory, `${product.productId}-${product.version}.archive`);
            writeFileSync(archivePath, bytes);
            let disposed = false;
            return Object.freeze({
                archivePath,
                bytes: byteCount,
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    rmSync(temporaryDirectory, { recursive: true, force: true });
                },
            });
        } catch (error) {
            rmSync(temporaryDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    public async fetchCatalog(urlValue: string, verifier: SignedPluginCatalogVerifier, signal?: unknown): Promise<ISignedPluginCatalog> {
        let url: URL;
        try {
            url = new URL(urlValue);
        } catch {
            throw new Error('plugin_catalog_url_invalid');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('plugin_catalog_url_invalid');
        const response = await this._fetch(url.href, { redirect: 'error', signal });
        if (!response.ok || response.redirected) throw new Error(`plugin_catalog_http_refused:${response.status}`);
        const maxCatalogBytes = 1024 * 1024;
        const contentLengthHeader = response.headers.get('content-length');
        if (contentLengthHeader != null) {
            const contentLength = Number(contentLengthHeader);
            if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maxCatalogBytes) throw new Error('plugin_catalog_size_refused');
        }
        if (response.body == null) throw new Error('plugin_catalog_body_missing');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let byteCount = 0;
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            if (!(part.value instanceof Uint8Array) || part.value.length === 0) throw new Error('plugin_catalog_chunk_invalid');
            byteCount += part.value.length;
            if (byteCount > maxCatalogBytes) {
                await reader.cancel();
                throw new Error('plugin_catalog_size_refused');
            }
            chunks.push(part.value);
        }
        if (byteCount === 0) throw new Error('plugin_catalog_body_missing');
        if (contentLengthHeader != null && byteCount !== Number(contentLengthHeader)) throw new Error('plugin_catalog_incomplete');
        const bytes = new Uint8Array(byteCount);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let parsed: unknown;
        try {
            parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
            throw new Error('plugin_catalog_json_invalid');
        }
        return verifier.verify(parsed);
    }
}
