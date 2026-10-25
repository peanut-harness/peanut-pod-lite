import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LiteAccountController } = require('../src/account-controller.js');
const { createPodAccountClient } = require('../src/pod-account-client.js');

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'pod-account-session-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const requests = [];
    const controller = new LiteAccountController({
        projectPath: root,
        safeStorageProvider: () => ({
            encryptString: (value) => Buffer.from(value),
            decryptString: (value) => value.toString(),
        }),
        transport: (url, init) => new Promise((resolve, reject) => {
            requests.push({ url, init, resolve: (body) => resolve({ ok: true, json: async () => body }), reject });
        }),
    });
    controller.setEndpoint('https://first.example/');
    controller.store.writeAccessToken('synthetic-token');
    return { controller, requests, root };
}

function snapshot(subjectId = 'user-a') {
    return { tenantId: 'tenant-a', subjectId, deviceId: 'device-a', status: 'none', entitlements: [] };
}

test('logout keeps signed_out after a pending refresh succeeds or fails', async (t) => {
    for (const success of [true, false]) {
        const { controller, requests } = fixture(t);
        const pending = controller.refresh();
        controller.clear();
        if (success) requests[0].resolve(snapshot());
        else requests[0].reject(new Error('synthetic failure'));
        assert.equal((await pending).state, 'signed_out');
        assert.equal(controller.status().state, 'signed_out');
    }
});

test('replacing the token prevents an old login from replacing the new subject', async (t) => {
    const { controller, requests } = fixture(t);
    const first = controller.refresh();
    const second = controller.setAccessToken('synthetic-new-token');
    requests[1].resolve(snapshot('new-user'));
    await second;
    requests[0].resolve(snapshot('old-user'));
    await first;
    assert.equal(controller.status().subjectId, 'new-user');
});

test('newest refresh wins even when an older response arrives last', async (t) => {
    const { controller, requests } = fixture(t);
    const first = controller.refresh();
    const second = controller.refresh();
    requests[1].resolve(snapshot('newest-user'));
    await second;
    requests[0].reject(new Error('old request failed'));
    await first;
    assert.equal(controller.status().subjectId, 'newest-user');
});

test('checkout and entitlement results cannot authorize a signed-out session', async (t) => {
    const { controller, requests } = fixture(t);
    const checkout = controller.startCheckout();
    controller.clear();
    requests[0].resolve({ checkoutUrl: 'https://pay.example/' });
    await assert.rejects(checkout, /peanut_account_session_changed/u);
    controller.store.writeAccessToken('synthetic-token');
    const entitlement = controller.requireProEntitlement();
    controller.clear();
    requests[1].resolve({ status: 'active' });
    await assert.rejects(entitlement, /peanut_account_session_changed/u);
    assert.equal(controller.status().state, 'signed_out');
});

test('changing the endpoint clears the prior token and invalidates pending refresh', async (t) => {
    const { controller, requests } = fixture(t);
    const pending = controller.refresh();
    controller.setEndpoint('https://second.example/');
    assert.equal(controller.store.read().accessToken, null);
    assert.equal(controller.status().state, 'signed_out');
    requests[0].resolve(snapshot());
    await pending;
    assert.equal(controller.status().state, 'signed_out');
    await controller.refresh();
    assert.equal(requests.length, 1);
    assert.equal(controller.status().error, 'peanut_account_token_missing');
});

test('equivalent and invalid endpoints preserve the original credential', async (t) => {
    const { controller } = fixture(t);
    controller.setEndpoint('https://FIRST.example:443');
    assert.equal(controller.store.read().accessToken, 'synthetic-token');
    for (const endpoint of ['http://other.example', 'https://user:pass@other.example', 'https://other.example/path', 'not a url']) {
        assert.throws(() => controller.setEndpoint(endpoint), /peanut_account_endpoint_invalid/u);
        assert.equal(controller.store.read().endpoint, 'https://first.example/');
        assert.equal(controller.store.read().accessToken, 'synthetic-token');
    }
});

test('total deadline includes a stalled JSON response body', async () => {
    const client = createPodAccountClient({ endpoint: 'https://pod.example/', accessToken: 'synthetic', timeoutMs: 15,
        transport: async () => ({ ok: true, json: () => new Promise(() => {}) }),
    });
    await assert.rejects(client.subscription(), /peanut_account_request_failed/u);
});

test('account transport rejects redirects and excessive response bodies', async () => {
    for (const response of [new Response('', { status: 302 }), new Response('x'.repeat(1024 * 1024 + 1))]) {
        const client = createPodAccountClient({ endpoint: 'https://pod.example/', accessToken: 'synthetic',
            transport: async () => response,
        });
        await assert.rejects(client.subscription(), /peanut_account_request_(?:failed|refused:302)/u);
    }
});

test('Node HTTPS fallback works without global fetch or AbortController', async (t) => {
    const https = require('node:https');
    const { EventEmitter } = require('node:events');
    const { PassThrough } = require('node:stream');
    const original = { fetch: globalThis.fetch, abort: globalThis.AbortController, request: https.request };
    t.after(() => { globalThis.fetch = original.fetch; globalThis.AbortController = original.abort; https.request = original.request; });
    globalThis.fetch = undefined;
    globalThis.AbortController = undefined;
    const seen = [];
    https.request = (url, options, callback) => {
        const pending = new EventEmitter();
        pending.destroy = (error) => pending.emit('error', error);
        pending.end = (body) => {
            seen.push({ origin: url.origin, path: url.pathname, method: options.method, body, headers: options.headers });
            const response = new PassThrough();
            response.statusCode = 200;
            callback(response);
            response.end(JSON.stringify(snapshot()));
        };
        return pending;
    };
    const client = createPodAccountClient({ endpoint: 'https://pod.example/', accessToken: 'synthetic' });
    assert.equal((await client.subscription()).subjectId, 'user-a');
    await client.checkout('peanut.cocos-mcp-pro');
    assert.equal(seen.length, 2);
    assert.equal(seen[0].headers.authorization, 'Bearer synthetic');
    assert.equal(seen[1].method, 'POST');
    assert.equal(seen[1].body, JSON.stringify({ productCode: 'peanut.cocos-mcp-pro' }));
});

test('Node HTTPS fallback destroys stalled requests at the total deadline', async (t) => {
    const https = require('node:https');
    const { EventEmitter } = require('node:events');
    const { PassThrough } = require('node:stream');
    const original = { fetch: globalThis.fetch, abort: globalThis.AbortController, request: https.request };
    t.after(() => { globalThis.fetch = original.fetch; globalThis.AbortController = original.abort; https.request = original.request; });
    globalThis.fetch = undefined;
    globalThis.AbortController = undefined;
    let destroyed = 0;
    https.request = (_url, _options, callback) => {
        const pending = new EventEmitter();
        const response = new PassThrough();
        pending.destroy = (error) => { destroyed += 1; response.destroy(); pending.emit('error', error); };
        pending.end = () => { response.statusCode = 200; callback(response); response.write('{'); };
        return pending;
    };
    const client = createPodAccountClient({ endpoint: 'https://pod.example/', accessToken: 'synthetic', timeoutMs: 15 });
    await assert.rejects(client.subscription(), /peanut_account_request_failed/u);
    assert.equal(destroyed, 1);
});

test('account panel clears the token before a failing login and consumes async errors', async () => {
    const { readFileSync } = require('node:fs');
    const { fileURLToPath } = require('node:url');
    const vm = require('node:vm');
    const panelRoot = fileURLToPath(new URL('../panel/account/', import.meta.url));
    const exports = {};
    const elements = {};
    for (const id of ['endpoint', 'token', 'saveEndpoint', 'signIn', 'signOut', 'refresh', 'upgrade', 'refreshPro', 'status']) {
        elements[id] = { value: '', innerText: '', click: null, addEventListener: (_event, handler) => { elements[id].click = handler; } };
    }
    const Editor = { Message: { request: async (_extension, event) => {
        if (event === 'set-access-token') {
            assert.equal(elements.token.value, '');
            throw new Error('synthetic secret-bearing transport detail');
        }
        return { ready: true, account: { state: 'signed_out' } };
    } } };
    vm.runInNewContext(readFileSync(join(panelRoot, 'index.js'), 'utf8'), { require, exports, __dirname: panelRoot, Editor });
    exports.ready.call({ $: elements });
    await new Promise((resolve) => setImmediate(resolve));
    elements.token.value = 'synthetic-token';
    await elements.signIn.click();
    assert.equal(elements.token.value, '');
    assert.match(elements.status.innerText, /账户操作失败/u);
    assert.equal(elements.status.innerText.includes('secret'), false);
});
