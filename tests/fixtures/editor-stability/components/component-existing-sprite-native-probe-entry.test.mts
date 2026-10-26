import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
    writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteNativeProbeEntry as Entry, load, unload } from './component-existing-sprite-native-probe-entry.ts';

const sceneUuid = '00000000-0000-4000-8000-000000000001';
const controlUuid = '00000000-0000-4000-8000-000000000002';
const frameUuid = '00000000-0000-4000-8000-000000000003';
const sceneUrl = 'db://assets/components/cc.Sprite.scene';
const frameUrl = 'db://assets/fixtures/media/assets/image/checker.png/spriteFrame';

function fixture(request?: (target: string, method: string, ...args: unknown[]) => Promise<unknown>) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-entry-')));
    const projectPath = join(root, 'synthetic-project'); mkdirSync(projectPath);
    const descriptorPath = join(root, 'fake-descriptor.json');
    const descriptor = {
        publish: (value: Record<string, unknown>) => writeFileSync(descriptorPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 }),
        clear: (generation: string) => {
            if (!existsSync(descriptorPath)) return;
            const current = JSON.parse(readFileSync(descriptorPath, 'utf8'));
            if (current.generation === generation) rmSync(descriptorPath);
        },
    };
    const calls: string[] = [];
    const message = { request: async (target: string, method: string, ...args: unknown[]) => {
        calls.push(`${target}:${method}`);
        if (request) return request(target, method, ...args);
        if (method === 'query-asset-info') return { url: args[0], uuid: args[0] === sceneUrl ? sceneUuid : controlUuid };
        if (method === 'query-assets') return [{ url: frameUrl, uuid: frameUuid,
            type: 'cc.SpriteFrame', imported: true, invalid: false }];
        if (method === 'execute-scene-script') return { sceneUuid, frameUuid,
            targetPath: '/Root/Canvas/Target', grayscale: true, opacity: 128,
            frameValid: true, frameType: 'cc.SpriteFrame' };
        throw new Error('unexpected_mock_call');
    } };
    const context = { projectPath, creatorVersion: '3.8.7' as const,
        owner: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', runId: 'sprite-entry-test',
        pid: 12345, timeoutMs: 20, descriptor, message };
    const input = { action: 'assetIdentity', projectPath, creatorVersion: context.creatorVersion,
        owner: context.owner, runId: context.runId, pid: context.pid };
    return { root, context, input, calls, descriptorPath,
        close: () => rmSync(root, { recursive: true, force: true }) };
}

async function post(port: number, body: unknown, token: string, options: { path?: string; method?: string;
    contentType?: string; origin?: string } = {}) {
    return fetch(`http://127.0.0.1:${port}${options.path ?? '/probe'}`, {
        method: options.method ?? 'POST', signal: AbortSignal.timeout(3000),
        headers: { 'content-type': options.contentType ?? 'application/json',
            'x-component-sprite-token': token, ...(options.origin ? { origin: options.origin } : {}) },
        body: JSON.stringify(body),
    });
}

test('owned loopback reads exact native identity and scene fields without returning secret', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    try {
        const endpoint = await entry.start();
        assert.equal(endpoint.address, '127.0.0.1');
        assert.equal(endpoint.port > 0, true);
        const descriptor = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        assert.equal(descriptor.generation, endpoint.generation);
        assert.equal(descriptor.projectPath, f.context.projectPath);
        const response = await post(endpoint.port, f.input, descriptor.token);
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.result.frameUuid, frameUuid);
        assert.equal(payload.result.nativeAccepted, false);
        const fields = await post(endpoint.port, { ...f.input, action: 'sceneFields',
            expectedSceneUuid: sceneUuid, expectedFrameUuid: frameUuid, expectOpacity: true }, descriptor.token);
        assert.equal(fields.status, 200);
        assert.equal((await fields.json()).result.opacity, 128);
        assert.deepEqual(f.calls, ['asset-db:query-asset-info', 'asset-db:query-asset-info',
            'asset-db:query-assets', 'scene:execute-scene-script']);
        assert.equal(JSON.stringify(payload).includes(descriptor.token), false);
    } finally { await entry.close(); f.close(); }
    assert.equal(existsSync(f.descriptorPath), false);
});

test('wrong token, route, method, origin, content type, action and identity reject before native calls', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    try {
        const endpoint = await entry.start();
        const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
        for (const [body, auth, options] of [
            [f.input, '0'.repeat(64), {}], [f.input, token, { path: '/other' }],
            [f.input, token, { method: 'PUT' }], [f.input, token, { origin: 'https://example.test' }],
            [f.input, token, { contentType: 'text/plain' }],
            [{ ...f.input, action: 'write' }, token, {}],
            [{ ...f.input, owner: 'other-owner' }, token, {}],
            [{ ...f.input, token: 'secret' }, token, {}],
        ] as const) {
            const response = await post(endpoint.port, body, auth, options);
            assert.equal(response.status, 400);
            const payload = await response.json();
            assert.equal(payload.ok, false);
            assert.equal(JSON.stringify(payload).includes(token), false);
        }
        assert.deepEqual(f.calls, []);
    } finally { await entry.close(); f.close(); }
});

test('body and native response bounds reject without a success fallback', async () => {
    const f = fixture(async () => ({ padding: 'x'.repeat(70000) })); const entry = new Entry(f.context);
    try {
        const endpoint = await entry.start();
        const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
        const oversized = await post(endpoint.port, { ...f.input, padding: 'x'.repeat(17000) }, token);
        assert.equal(oversized.status, 400);
        assert.equal((await oversized.json()).error, 'component_sprite_probe_entry_body_too_large');
        assert.deepEqual(f.calls, []);
        const native = await post(endpoint.port, f.input, token);
        assert.equal(native.status, 400);
        assert.equal((await native.json()).error, 'component_sprite_probe_response_too_large_or_invalid');
    } finally { await entry.close(); f.close(); }
});

test('native rejection, missing API and timeout remain explicit errors', async () => {
    for (const request of [async () => { throw new Error('private_native_failure'); },
        async () => new Promise<never>(() => {})]) {
        const f = fixture(request); const entry = new Entry(f.context);
        try {
            const endpoint = await entry.start();
            const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
            const response = await post(endpoint.port, f.input, token);
            assert.equal(response.status, 400);
            const payload = await response.json();
            assert.equal(payload.ok, false);
            assert.equal(payload.result, undefined);
            assert.equal(JSON.stringify(payload).includes('private_native_failure'), false);
        } finally { await entry.close(); f.close(); }
    }
    const absent = fixture();
    try {
        const entry = new Entry({ ...absent.context, message: {} as typeof absent.context.message });
        await assert.rejects(entry.start(), /context_invalid/);
        assert.equal(existsSync(absent.descriptorPath), false);
    } finally { absent.close(); }
});

test('close and reload retire the old token and generation without rewriting an owned descriptor', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    try {
        const first = await entry.start();
        const old = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        await assert.rejects(entry.start(), /already_started/);
        await entry.close(); await entry.close();
        assert.equal(existsSync(f.descriptorPath), false);
        await assert.rejects(post(first.port, f.input, old.token));
        const second = await entry.start();
        const current = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        assert.notEqual(current.generation, old.generation);
        assert.notEqual(current.token, old.token);
        const stale = await post(second.port, f.input, old.token);
        assert.equal(stale.status, 400);
        assert.equal((await stale.json()).ok, false);
        assert.equal((await post(second.port, f.input, current.token)).status, 200);
        f.context.descriptor.clear(old.generation);
        assert.equal(existsSync(f.descriptorPath), true);
    } finally { await entry.close(); f.close(); }
});

test('descriptor publish failure closes the listener and never admits a request', async () => {
    const f = fixture();
    try {
        const entry = new Entry({ ...f.context,
            descriptor: { publish: () => { throw new Error('synthetic_descriptor_failure'); }, clear: () => {} } });
        await assert.rejects(entry.start(), /synthetic_descriptor_failure/);
        await entry.close();
        assert.equal(existsSync(f.descriptorPath), false);
    } finally { f.close(); }
});

test('descriptor cleanup failure blocks reload until the same generation is cleared', async () => {
    const f = fixture(); let refuse = true;
    const descriptor = { publish: f.context.descriptor.publish,
        clear: (generation: string) => {
            if (refuse) throw new Error('synthetic_clear_failure');
            f.context.descriptor.clear(generation);
        } };
    const entry = new Entry({ ...f.context, descriptor });
    try {
        await entry.start();
        await assert.rejects(entry.close(), /synthetic_clear_failure/);
        assert.equal(existsSync(f.descriptorPath), true);
        await assert.rejects(entry.start(), /already_started/);
        refuse = false;
        await entry.close();
        assert.equal(existsSync(f.descriptorPath), false);
        await entry.start();
    } finally { refuse = false; await entry.close(); f.close(); }
});

test('bounded concurrency rejects a third request and close drains accepted timeouts', async () => {
    const f = fixture(async () => new Promise<never>(() => {}));
    const entry = new Entry({ ...f.context, timeoutMs: 40 });
    try {
        const endpoint = await entry.start();
        const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
        const first = post(endpoint.port, f.input, token).then(response => response.json()).catch(() => null);
        const second = post(endpoint.port, f.input, token).then(response => response.json()).catch(() => null);
        const until = Date.now() + 1000;
        while (f.calls.length < 2) {
            if (Date.now() > until) throw new Error('synthetic_requests_not_admitted');
            await new Promise(done => setTimeout(done, 1));
        }
        const third = await post(endpoint.port, f.input, token);
        assert.equal(third.status, 429);
        assert.equal((await third.json()).error, 'component_sprite_probe_entry_busy');
        await entry.close();
        const results = await Promise.all([first, second]);
        assert.equal(results.every(value => value === null || value.ok === false), true);
        assert.equal(existsSync(f.descriptorPath), false);
        assert.equal(f.calls.length, 2);
    } finally { await entry.close(); f.close(); }
});

test('invalid JSON is an explicit body failure before Editor access', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    try {
        const endpoint = await entry.start();
        const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
        const response = await fetch(`http://127.0.0.1:${endpoint.port}/probe`, {
            method: 'POST', headers: { 'content-type': 'application/json',
                'x-component-sprite-token': token }, body: '{invalid', signal: AbortSignal.timeout(3000),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'component_sprite_probe_entry_body_invalid');
        assert.deepEqual(f.calls, []);
    } finally { await entry.close(); f.close(); }
});

test('Creator exports remain deliberately offline only', async () => {
    assert.throws(load, /offline_only/);
    await unload();
});
