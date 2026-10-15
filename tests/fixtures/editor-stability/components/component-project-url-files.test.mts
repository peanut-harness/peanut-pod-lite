import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { ComponentProjectUrlFiles } from './component-project-url-files.ts';
import { ComponentProjectUrlResolver } from './component-project-url-resolver.mts';

const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');
const create = () => {
    const project = mkdtempSync('/private/tmp/pod-project-url-');
    mkdirSync(join(project, 'extensions/peanut-component-probe'), { recursive: true });
    const identity = { projectPath: project, owner: 'test-owner', runId: 'test-run', candidateSourceCommit: 'offline-test' };
    ComponentProjectUrlFiles.stage(root, project, identity);
    return { project, identity, files: new ComponentProjectUrlFiles(project, identity),
        manifest: join(project, 'extensions/peanut-component-probe/project-url-files.json') };
};
const listen = async (handler: (request: IncomingMessage, response: ServerResponse) => void) => {
    const server = createServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert(address && typeof address !== 'string');
    return { server, port: address.port, close: () => new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())) };
};

test('fixed URL staging pins real fixture bytes and rejects altered identity, paths and replacement', () => {
    const fixture = create();
    try {
        assert.equal(fixture.files.rows.length, 2);
        for (const row of fixture.files.rows) {
            assert.deepEqual(readFileSync(join(fixture.project, row.relativePath)), readFileSync(join(root, row.sourcePath)));
            assert.equal(ComponentProjectUrlFiles.hash(readFileSync(join(root, row.sourcePath))), row.sha256);
        }
        assert.throws(() => new ComponentProjectUrlFiles(fixture.project, { ...fixture.identity, owner: 'other' }), /identity_invalid/);
        const manifest = readFileSync(fixture.manifest, 'utf8');
        for (const mutate of [
            (value: ReturnType<typeof JSON.parse>) => { value.rows[0].relativePath = '../../private-file'; },
            (value: ReturnType<typeof JSON.parse>) => { value.rows[0].sourcePath = 'tests/fixtures/private-file'; },
            (value: ReturnType<typeof JSON.parse>) => { value.rows.push(value.rows[0]); },
        ]) {
            const value = JSON.parse(manifest); mutate(value); writeFileSync(fixture.manifest, JSON.stringify(value));
            assert.throws(() => new ComponentProjectUrlFiles(fixture.project, fixture.identity), /manifest_(row|identity)_invalid/);
        }
        writeFileSync(fixture.manifest, manifest);
        const video = fixture.files.rows[0]; assert(video);
        writeFileSync(join(fixture.project, video.relativePath), 'changed');
        assert.throws(() => ComponentProjectUrlFiles.stage(root, fixture.project, fixture.identity), /staged_bytes_changed/);
        assert.throws(() => fixture.files.urls(1234), /bytes_changed/);
    } finally { rmSync(fixture.project, { recursive: true, force: true }); }
});

test('fixed URL HTTP serves exact GET, HEAD and video byte ranges without arbitrary paths or methods', async () => {
    const fixture = create();
    const endpoint = await listen((request, response) => { if (!fixture.files.serve(request, response)) { response.writeHead(403); response.end(); } });
    try {
        const urls = fixture.files.urls(endpoint.port); const video = urls[0]; const web = urls[1]; assert(video && web);
        const bytes = readFileSync(join(fixture.project, video.relativePath));
        const full = await fetch(video.url); assert.equal(full.status, 200);
        assert.equal(full.headers.get('content-type'), 'video/mp4');
        assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
        const head = await fetch(video.url, { method: 'HEAD' }); assert.equal(head.status, 200);
        assert.equal(head.headers.get('content-length'), String(bytes.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
        for (const [range, expected] of [['bytes=0-15', bytes.subarray(0, 16)], ['bytes=-8', bytes.subarray(-8)],
            [`bytes=${bytes.length - 8}-999999`, bytes.subarray(-8)]] as const) {
            const response = await fetch(video.url, { headers: { range } });
            assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
            assert.match(response.headers.get('content-range') ?? '', /^bytes \d+-\d+\/\d+$/u);
        }
        for (const range of ['bytes=999999-', 'bytes=9-1', 'bytes=-0', 'bytes=-99999999999999999999', 'bytes=0-1,3-4', 'bytes=-']) {
            const response = await fetch(video.url, { headers: { range } }); assert.equal(response.status, 416);
        }
        const html = await fetch(web.url); assert.equal(html.status, 200);
        assert.match(html.headers.get('content-security-policy') ?? '', /default-src 'none'/u);
        assert.equal(await html.text(), readFileSync(join(root, web.sourcePath), 'utf8'));
        for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await fetch(video.url, { method })).status, 405);
        assert.equal((await fetch(video.url + '?path=other')).status, 404);
        assert.equal((await fetch(`http://127.0.0.1:${endpoint.port}/task51-fixtures/unknown`)).status, 404);
        assert.equal((await fetch(`http://127.0.0.1:${endpoint.port}/probe`, { method: 'POST' })).status, 403);
    } finally { await endpoint.close(); rmSync(fixture.project, { recursive: true, force: true }); }
});

test('staging refuses linked ancestors before creating directories outside the project', () => {
    const fixture = create(); const outside = mkdtempSync('/private/tmp/pod-url-outside-');
    try {
        rmSync(join(fixture.project, 'assets'), { recursive: true });
        symlinkSync(outside, join(fixture.project, 'assets'));
        assert.throws(() => ComponentProjectUrlFiles.stage(root, fixture.project, fixture.identity), /destination_link/);
        assert.equal(existsSync(join(outside, 'fixtures')), false);
    } finally { rmSync(fixture.project, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('served fixture replacement or symlink is denied before returning bytes', async () => {
    const fixture = create();
    const endpoint = await listen((request, response) => { fixture.files.serve(request, response); });
    try {
        const row = fixture.files.urls(endpoint.port)[0]; assert(row); const absolute = join(fixture.project, row.relativePath);
        writeFileSync(absolute, 'changed'); assert.equal((await fetch(row.url)).status, 503);
        rmSync(absolute); symlinkSync(join(root, row.sourcePath), absolute);
        assert.equal((await fetch(row.url)).status, 503);
        assert.throws(() => new ComponentProjectUrlFiles(fixture.project, fixture.identity), /file_link/);
    } finally { await endpoint.close(); rmSync(fixture.project, { recursive: true, force: true }); }
});

test('URL resolver verifies bound socket, HTTP bytes and exact source hash before producing token resources', async () => {
    const fixture = create();
    let mode = 'normal';
    const endpoint = await listen((request, response) => {
        if (mode === 'redirect') { response.writeHead(302, { location: 'http://127.0.0.1:1/never-follow' }); response.end(); }
        else if (mode === 'changed') { response.writeHead(200, { 'content-type': 'video/mp4' }); response.end('changed'); }
        else fixture.files.serve(request, response);
    });
    try {
        const urls = fixture.files.urls(endpoint.port); const result = { ...fixture.identity, files: urls };
        const verified = await ComponentProjectUrlResolver.verify(fixture.project, fixture.identity, endpoint.port, result);
        const file = urls[0]; assert(file);
        assert.deepEqual(ComponentProjectUrlResolver.resolve(verified, { path: file.sourcePath, sha256: file.sha256 }),
            { input: file.url, expected: file.url, resources: [`db://${file.relativePath}`] });
        for (const source of [{ path: file.sourcePath, sha256: 'changed' }, { path: '../../private', sha256: file.sha256 }])
            assert.throws(() => ComponentProjectUrlResolver.resolve(verified, source), /recipe_not_verified/);
        await assert.rejects(() => ComponentProjectUrlResolver.verify(fixture.project, fixture.identity, endpoint.port,
            { ...result, runId: 'other' }), /endpoint_identity_invalid/);
        await assert.rejects(() => ComponentProjectUrlResolver.verify(fixture.project, fixture.identity, endpoint.port,
            { ...result, files: [{ ...file, url: 'https://external.invalid' }, urls[1]] }), /endpoint_identity_invalid/);
        mode = 'changed'; await assert.rejects(() => ComponentProjectUrlResolver.verify(fixture.project, fixture.identity, endpoint.port, result), /http_bytes_invalid/);
        mode = 'redirect'; await assert.rejects(() => ComponentProjectUrlResolver.verify(fixture.project, fixture.identity, endpoint.port, result));
    } finally { await endpoint.close(); rmSync(fixture.project, { recursive: true, force: true }); }
});
