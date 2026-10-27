import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
    symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentExistingSpriteNativeProbeEntry as Entry, createSyntheticCreatorEntry,
    load, unload } from './component-existing-sprite-native-probe-entry.ts';

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

test('close destroys only its owned idle socket and releases the listener', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    let socket: ReturnType<typeof connect> | null = null;
    try {
        const endpoint = await entry.start();
        socket = connect(endpoint.port, '127.0.0.1');
        await once(socket, 'connect');
        const socketClosed = new Promise<void>(done => {
            socket!.on('error', () => {});
            socket!.once('close', () => done());
        });
        const closing = entry.close();
        await Promise.race([closing, new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('synthetic_owned_socket_close_timeout')), 1000))]);
        await socketClosed;
        assert.equal(socket.destroyed, true);
        assert.equal(existsSync(f.descriptorPath), false);
        await assert.rejects(post(endpoint.port, f.input, '0'.repeat(64)));
        await entry.close();
    } finally { socket?.destroy(); await entry.close(); f.close(); }
});

test('the sixteenth socket request closes and later requests cannot reach native dispatch', async () => {
    const f = fixture(); const entry = new Entry(f.context);
    let socket: ReturnType<typeof connect> | null = null;
    try {
        const endpoint = await entry.start();
        socket = connect(endpoint.port, '127.0.0.1');
        await once(socket, 'connect');
        let received = '';
        const closed = new Promise<void>(done => {
            socket!.on('data', chunk => { received += chunk.toString('utf8'); });
            socket!.on('error', () => {});
            socket!.once('close', () => done());
        });
        const request = 'POST /wrong HTTP/1.1\r\nHost: 127.0.0.1\r\n'
            + 'Content-Type: application/json\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}';
        socket.write(request.repeat(17));
        await Promise.race([closed, new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('synthetic_socket_limit_timeout')), 2000))]);
        const statuses = [...received.matchAll(/HTTP\/1\.1 (\d{3})/gu)].map(match => Number(match[1]));
        assert.equal(statuses.length, 16);
        assert.equal(statuses.slice(0, 16).every(status => status === 400 || status === 429), true);
        assert.equal(f.calls.length, 0);
        const server = Reflect.get(entry, 'server') as { maxRequestsPerSocket: number };
        server.maxRequestsPerSocket = 0;
        const overloaded = connect(endpoint.port, '127.0.0.1');
        overloaded.on('error', () => {});
        await once(overloaded, 'connect');
        const sockets = Reflect.get(entry, 'sockets') as Set<Socket>;
        const deadline = Date.now() + 1000;
        while (sockets.size !== 1) {
            if (Date.now() > deadline) throw new Error('synthetic_owned_socket_missing');
            await new Promise(done => setTimeout(done, 1));
        }
        const owned = [...sockets][0];
        (Reflect.get(entry, 'requestsPerSocket') as WeakMap<Socket, number>).set(owned, 16);
        let overloadedResponse = '';
        const overloadedClosed = new Promise<void>(done => {
            overloaded.on('data', chunk => { overloadedResponse += chunk.toString('utf8'); });
            overloaded.once('close', () => done());
        });
        overloaded.write(request);
        await overloadedClosed;
        assert.match(overloadedResponse, /^HTTP\/1\.1 503 /u);
        assert.equal(f.calls.length, 0);
        const token = JSON.parse(readFileSync(f.descriptorPath, 'utf8')).token;
        assert.equal((await post(endpoint.port, f.input, token)).status, 200);
    } finally { socket?.destroy(); await entry.close(); f.close(); }
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

function activationFixture(diagnostic = false) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'component-sprite-activation-')));
    const project = join(root, 'synthetic-project');
    const extension = join(project, 'extensions/peanut-component-sprite-probe');
    mkdirSync(join(project, '.peanut-ai'), { recursive: true }); mkdirSync(extension, { recursive: true });
    const bundle = Buffer.from('synthetic-only-bundle');
    const bundleSha = createHash('sha256').update(bundle).digest('hex');
    writeFileSync(join(extension, 'main.js'), bundle);
    const sceneBytes = Buffer.from('synthetic-only-scene');
    const sceneSha = createHash('sha256').update(sceneBytes).digest('hex');
    writeFileSync(join(extension, 'scene.js'), sceneBytes);
    const sourceCommit = 'd'.repeat(40);
    const manifestBytes = Buffer.from(JSON.stringify({
        name: 'peanut-component-sprite-probe', probeSourceCommit: sourceCommit,
        bundleDigests: { 'main.js': bundleSha, 'scene.js': sceneSha },
        private: true, peanutOfflineOnly: !diagnostic,
        ...(diagnostic ? { peanutDiagnosticOnly: true, nativeCompatible: null,
            diagnosticTargetVersion: '3.8.3', diagnosticAction: 'existingAssetIdentity' } : {}),
    }));
    writeFileSync(join(extension, 'package.json'), manifestBytes);
    const manifestSha = createHash('sha256').update(manifestBytes).digest('hex');
    const packageSha = createHash('sha256').update(JSON.stringify({
        main: bundleSha, scene: sceneSha, manifest: manifestSha,
    })).digest('hex');
    const lease = { schema: 'peanut.pod.sprite-runtime-lease.v1', status: 'active',
        projectPath: project, creatorVersion: '3.8.3',
        owner: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', runId: 'sprite-activation',
        pid: process.pid, candidateSourceCommit: '660226aa28d0d96fc4766c81c3b58af71cd1a8f0',
        hostSha256: '3954bec522639354ce249f594055e7a543854ee721c645994051cd094f534438',
        coreSha256: 'ef38d9ac7f12a6face2e353cbb02c538ce0546520d1cb3941a903c8a376d794f',
        probeSourceCommit: sourceCommit, probeBundleSha256: packageSha,
        issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60000,
        permissions: diagnostic ? ['existingAssetIdentity'] : ['assetIdentity', 'sceneFields'],
        creatorExecutable: process.execPath,
        ...(diagnostic ? { purpose: 'existing-asset-compatibility',
            creatorExecutableSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex') } : {}) };
    const leasePath = join(root, 'lease.json');
    const editor = { Project: { path: project }, App: { version: '3.8.3' },
        Message: { request: async (_target: string, method: string, ...args: unknown[]) => {
            if (method === 'query-asset-info' && args[0] === 'db://assets/peanut-pod-upgrade-0-2-1/probe.json')
                return { url: args[0], uuid: '83213e97-04f5-48f9-9d1c-a4af0ba54c1d', type: 'cc.JsonAsset' };
            if (method === 'query-asset-info') return { url: args[0],
                uuid: args[0] === sceneUrl ? sceneUuid : controlUuid };
            if (method === 'query-assets') return [{ url: frameUrl, uuid: frameUuid,
                type: 'cc.SpriteFrame', imported: true }];
            throw new Error('unexpected_mock_call');
        } } };
    return { root, project, lease, leasePath, editor,
        descriptorPath: join(project, '.peanut-ai/component-sprite-probe.json'),
        writeLease: (value: unknown = lease) => writeFileSync(leasePath, JSON.stringify(value), { mode: 0o600 }),
        close: () => rmSync(root, { recursive: true, force: true }) };
}

test('synthetic Creator load uses a fixed lease, owned descriptor and only read-only native requests', async () => {
    const f = activationFixture(); f.writeLease();
    const relative = 'assets/peanut-pod-upgrade-0-2-1/probe.json';
    const actual = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3';
    mkdirSync(dirname(join(f.project, relative)), { recursive: true });
    for (const name of [relative, `${relative}.meta`])
        writeFileSync(join(f.project, name), readFileSync(join(actual, name)));
    const creator = createSyntheticCreatorEntry(f.project, f.editor);
    try {
        await creator.load();
        const descriptor = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        assert.equal(descriptor.projectPath, f.project);
        assert.equal(descriptor.pid, process.pid);
        assert.equal(descriptor.probeSourceCommit, f.lease.probeSourceCommit);
        const response = await post(descriptor.port, { action: 'assetIdentity', projectPath: f.project,
            creatorVersion: '3.8.3', owner: f.lease.owner, runId: f.lease.runId, pid: process.pid }, descriptor.token);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.frameUuid, frameUuid);
        const existing = await post(descriptor.port, { action: 'existingAssetIdentity', projectPath: f.project,
            creatorVersion: '3.8.3', owner: f.lease.owner, runId: f.lease.runId, pid: process.pid }, descriptor.token);
        assert.equal(existing.status, 200);
        assert.equal((await existing.json()).result.uuid, '83213e97-04f5-48f9-9d1c-a4af0ba54c1d');
        await assert.rejects(creator.load(), /already_loaded/);
    } finally { await creator.unload(); f.close(); }
    assert.equal(existsSync(f.descriptorPath), false);
});

test('diagnostic lease admits only fixed 3.8.3 existing asset readback', async () => {
    const f = activationFixture(true); f.writeLease();
    const relative = 'assets/peanut-pod-upgrade-0-2-1/probe.json';
    const actual = '/Users/alex/workspaces/peanut-workspace/.peanut-ai/pod-lifecycle-acceptance-2026-10-09/creator-3.8.3';
    mkdirSync(dirname(join(f.project, relative)), { recursive: true });
    for (const name of [relative, `${relative}.meta`])
        writeFileSync(join(f.project, name), readFileSync(join(actual, name)));
    const creator = createSyntheticCreatorEntry(f.project, f.editor, 'diagnostic-383');
    try {
        await creator.load();
        const descriptor = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        const request = { projectPath: f.project, creatorVersion: '3.8.3',
            owner: f.lease.owner, runId: f.lease.runId, pid: process.pid };
        for (const action of ['assetIdentity', 'sceneFields', 'write']) {
            const response = await post(descriptor.port, { ...request, action }, descriptor.token);
            assert.equal(response.status, 400);
        }
        const response = await post(descriptor.port, { ...request, action: 'existingAssetIdentity' }, descriptor.token);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.nativeAccepted, false);
    } finally { await creator.unload(); f.close(); }
});

test('diagnostic entry rejects offline package and widened or wrong-purpose leases', async () => {
    for (const variant of ['offline', 'permission', 'purpose', 'binary'] as const) {
        const f = activationFixture(variant !== 'offline');
        try {
            const lease = { ...f.lease };
            if (variant === 'permission') lease.permissions = ['assetIdentity', 'sceneFields'];
            if (variant === 'purpose') lease.purpose = 'sprite-native-probe';
            if (variant === 'binary') lease.creatorExecutableSha256 = '0'.repeat(64);
            f.writeLease(lease);
            const creator = createSyntheticCreatorEntry(f.project, f.editor, 'diagnostic-383');
            await assert.rejects(creator.load(), /lease_identity_invalid|bundle_identity_invalid/u);
            assert.equal(existsSync(f.descriptorPath), false);
            await creator.unload();
        } finally { f.close(); }
    }
});

test('missing, expired, mismatched and malformed fixed lease refuse before descriptor or listener', async () => {
    for (const change of [null, { expiresAt: Date.now() - 1 }, { pid: -1 },
        { owner: 'other' }, { candidateSourceCommit: 'b'.repeat(40) },
        { probeBundleSha256: '0'.repeat(64) }, { permissions: ['assetIdentity', 'write'] },
        { unexpected: true }]) {
        const f = activationFixture();
        try {
            if (change !== null) f.writeLease({ ...f.lease, ...change });
            const creator = createSyntheticCreatorEntry(f.project, f.editor);
            await assert.rejects(creator.load(), /lease|bundle/);
            assert.equal(existsSync(f.descriptorPath), false);
            await creator.unload();
        } finally { f.close(); }
    }
});

test('production load cannot be enabled by a synthetic Editor context or caller flag', async () => {
    const f = activationFixture(); f.writeLease();
    const prior = Reflect.get(globalThis, 'Editor');
    Reflect.set(globalThis, 'Editor', f.editor);
    try {
        await assert.rejects(load(), /creator_identity_invalid/);
        assert.equal(existsSync(f.descriptorPath), false);
        await unload();
        assert.throws(() => createSyntheticCreatorEntry('/tmp/unregistered-project', f.editor), /synthetic_project_invalid/);
    } finally {
        if (prior === undefined) Reflect.deleteProperty(globalThis, 'Editor');
        else Reflect.set(globalThis, 'Editor', prior);
        f.close();
    }
});

test('linked lease, changed scene bundle and occupied descriptor fail before a native call', async () => {
    for (const kind of ['link', 'scene', 'occupied'] as const) {
        const f = activationFixture(); f.writeLease();
        try {
            if (kind === 'link') {
                const foreign = join(f.root, 'foreign-lease');
                writeFileSync(foreign, readFileSync(f.leasePath));
                rmSync(f.leasePath); symlinkSync(foreign, f.leasePath);
            }
            if (kind === 'scene') writeFileSync(join(f.project,
                'extensions/peanut-component-sprite-probe/scene.js'), 'tampered');
            if (kind === 'occupied') writeFileSync(f.descriptorPath, 'foreign');
            const creator = createSyntheticCreatorEntry(f.project, f.editor);
            await assert.rejects(creator.load(), /lease_file_invalid|bundle_identity_invalid|descriptor_occupied/);
            assert.equal(existsSync(f.descriptorPath), kind === 'occupied');
            if (kind === 'occupied') assert.equal(readFileSync(f.descriptorPath, 'utf8'), 'foreign');
            await creator.unload();
        } finally { f.close(); }
    }
});

test('an admitted synthetic session refuses native calls once its lease expires', async () => {
    const f = activationFixture(); f.writeLease({ ...f.lease, expiresAt: Date.now() + 200 });
    const creator = createSyntheticCreatorEntry(f.project, f.editor);
    try {
        await creator.load();
        const descriptor = JSON.parse(readFileSync(f.descriptorPath, 'utf8'));
        await new Promise(done => setTimeout(done, 220));
        const response = await post(descriptor.port, { action: 'assetIdentity', projectPath: f.project,
            creatorVersion: '3.8.3', owner: f.lease.owner, runId: f.lease.runId, pid: process.pid }, descriptor.token);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'component_sprite_probe_lease_expired');
    } finally { await creator.unload(); f.close(); }
});
