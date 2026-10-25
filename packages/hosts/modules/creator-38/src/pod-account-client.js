'use strict';

const https = require('https');

const MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * @description 校验账户服务的 HTTPS 根地址，并生成唯一的来源表示。
 * @param endpoint 用户配置的服务地址。
 * @returns 规范的 HTTPS 根地址。
 */
function normalizePodEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > 2048 || /[\r\n\\]/u.test(endpoint)) {
        throw new Error('peanut_account_endpoint_invalid');
    }
    let root;
    try {
        root = new URL(endpoint.trim());
    } catch {
        throw new Error('peanut_account_endpoint_invalid');
    }
    if (root.protocol !== 'https:' || root.username || root.password || root.search || root.hash || root.pathname !== '/') {
        throw new Error('peanut_account_endpoint_invalid');
    }
    return `${root.origin}/`;
}

function createPodAccountClient({ endpoint, accessToken, transport, timeoutMs }) {
    const root = new URL(normalizePodEndpoint(endpoint));
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new Error('peanut_account_token_missing');
    }
    const timeout = timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) {
        throw new Error('peanut_account_timeout_invalid');
    }
    const fetchImpl = transport ?? (typeof globalThis.fetch === 'function'
        && typeof globalThis.AbortController === 'function' ? globalThis.fetch : null);
    return Object.freeze({
        async subscription() {
            return request(fetchImpl, new URL('/v1/account/subscription', root), accessToken, timeout);
        },
        async checkout(productCode) {
            return request(fetchImpl, new URL('/v1/account/checkout', root), accessToken, timeout, {
                method: 'POST',
                body: JSON.stringify({ productCode }),
            });
        },
    });
}

async function request(fetchImpl, url, accessToken, timeoutMs, init = {}) {
    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    const lifecycle = { cancel: () => controller?.abort() };
    let timer;
    try {
        const options = {
            method: init.method ?? 'GET',
            headers: Object.freeze({
                authorization: `Bearer ${accessToken}`,
                accept: 'application/json',
                ...(init.body == null ? {} : { 'content-type': 'application/json' }),
            }),
            body: init.body,
            redirect: 'error',
            ...(controller == null ? {} : { signal: controller.signal }),
        };
        const operation = fetchImpl == null
            ? requestNativeJson(url, options, lifecycle)
            : requestFetchJson(fetchImpl, url, options, lifecycle);
        const deadline = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                reject(new Error('peanut_account_request_failed'));
                lifecycle.cancel();
            }, timeoutMs);
        });
        return await Promise.race([operation, deadline]);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('peanut_account_request_refused:')) {
            throw error;
        }
        throw new Error('peanut_account_request_failed');
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @description 使用 Node 14 原生 HTTPS 读取受限 JSON，不跟随重定向。
 * @param url 已验证的目标 URL。
 * @param options 固定账户请求选项。
 * @param lifecycle 请求取消句柄的所有者。
 * @returns 完整响应体解析结果。
 */
function requestNativeJson(url, options, lifecycle) {
    return new Promise((resolve, reject) => {
        const pending = https.request(url, { method: options.method, headers: options.headers }, (response) => {
            response.on('error', reject);
            response.on('aborted', () => reject(new Error('peanut_account_request_failed')));
            const status = response.statusCode ?? 0;
            if (status < 200 || status >= 300) {
                reject(new Error(`peanut_account_request_refused:${status}`));
                response.destroy();
                return;
            }
            const chunks = [];
            let bytes = 0;
            response.on('data', (chunk) => {
                bytes += chunk.length;
                if (bytes > MAX_RESPONSE_BYTES) {
                    reject(new Error('peanut_account_request_failed'));
                    response.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                } catch {
                    reject(new Error('peanut_account_request_failed'));
                }
            });
        });
        lifecycle.cancel = () => pending.destroy(new Error('peanut_account_request_failed'));
        pending.on('error', reject);
        pending.end(options.body);
    });
}

/**
 * @description 保留注入传输协议，并将完整响应读取纳入同一请求期限。
 * @param fetchImpl 注入或运行时提供的传输。
 * @param url 已验证的目标 URL。
 * @param options 固定账户请求选项。
 * @param lifecycle 请求取消句柄的所有者。
 * @returns 完整响应体解析结果。
 */
async function requestFetchJson(fetchImpl, url, options, lifecycle) {
    const response = await fetchImpl(url, options);
    if (!response.ok) {
        await response.body?.cancel?.();
        throw new Error(`peanut_account_request_refused:${response.status}`);
    }
    if (typeof response.body?.getReader !== 'function') {
        const result = await response.json();
        if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES) {
            throw new Error('peanut_account_request_failed');
        }
        return result;
    }
    const reader = response.body.getReader();
    const abort = lifecycle.cancel;
    lifecycle.cancel = () => {
        abort();
        void reader.cancel().catch(() => {});
    };
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const next = await reader.read();
            if (next.done) {
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            bytes += next.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error('peanut_account_request_failed');
            }
            chunks.push(Buffer.from(next.value));
        }
    } finally {
        reader.releaseLock();
    }
}

module.exports = { createPodAccountClient, normalizePodEndpoint };
