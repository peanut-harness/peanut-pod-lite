import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenSession, type ILumenMessagePort } from '@peanut/pod-engine/lumen';
import { EditorMcpLumenMetaSave } from '../src/editor-mcp-lumen-meta-save.js';

/**
 * @description 用实际 Lumen 音频文档与模拟缓存的原生端口复现 meta 被旧缓存覆盖。
 * @param mode 原生端口的故障模式。
 * @returns 隔离会话、保存、原生记录及清理入口。
 * @oopException 测试夹具。
 */
function fixture(mode = 'success') {
    const root = mkdtempSync(join(tmpdir(), 'peanut-meta-native-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'package.json'), '{"creator":{"version":"3.8.7"}}');
    const path = 'assets/Probe.png'; const absolute = join(root, path);
    writeFileSync(absolute, 'PNG-native-source');
    const before = { ver: '1.0.0', importer: 'image', imported: true,
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', files: ['.json', '.png'],
        subMetas: { child: { importer: 'texture', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@child', userData: { wrapModeS: 'repeat', wrapModeT: 'repeat', minfilter: 'linear', magfilter: 'linear', mipfilter: 'none', anisotropy: 0 } } },
        userData: { type: 'texture', flipVertical: false, hasAlpha: false, fixAlphaTransparencyArtifacts: false, bakeOfflineMipmaps: false, isRGBE: false, flipGreenChannel: false, untouched: 'keep' } };
    writeFileSync(`${absolute}.meta`, JSON.stringify(before));
    let live = structuredClone(before); const calls: string[] = []; let reads = 0;
    const request = async (_target: string, name: string, _url: unknown, content: unknown): Promise<unknown> => {
        calls.push(name);
        if (name === 'query-asset-info') {
            if (mode === 'no-disk-first') {
                assert.equal(JSON.parse(readFileSync(`${absolute}.meta`, 'utf8')).userData.flipVertical, false);
            }
            // The watcher rewrites an old cached meta between disk save and native acceptance.
            writeFileSync(`${absolute}.meta`, JSON.stringify(live));
            return { uuid: mode === 'identity' ? 'another-asset' : before.uuid, importer: before.importer };
        }
        if (name === 'save-asset-meta') {
            if (mode === 'reject') { throw new Error('native-save-refused'); }
            if (mode !== 'false-ack') {
                live = JSON.parse(String(content));
                if (mode === 'subasset') { live.subMetas.child.uuid = 'replaced-child'; }
                writeFileSync(`${absolute}.meta`, JSON.stringify(live));
                if (mode === 'source') { writeFileSync(absolute, 'corrupted-source'); }
            }
            return { uuid: before.uuid };
        }
        if (name === 'query-asset-meta') {
            reads += 1;
            if (mode === 'late-overwrite' && reads === 2) {
                live = structuredClone(before);
                writeFileSync(`${absolute}.meta`, JSON.stringify(live));
            }
            return structuredClone(live);
        }
        throw new Error(`unexpected-message:${name}`);
    };
    const message: ILumenMessagePort = { request: async <TData = unknown,>(target: string, name: string, ...args: unknown[]): Promise<TData> =>
        await request(target, name, args[0], args[1]) as TData };
    const session = new LumenSession({ projectRoot: root }); session.openPrefab(path);
    return { root, session, path, absolute, message, calls,
        clean: () => rmSync(root, { recursive: true, force: true }) };
}

test('actual image patch survives stale native cache and retains source and child identities', async () => {
    const f = fixture();
    try {
        f.session.setAssetProperty({ patch: { image: { flipVertical: true } } });
        await EditorMcpLumenMetaSave.save(f.session, f.path, f.message, 20);
        assert.equal(JSON.parse(readFileSync(`${f.absolute}.meta`, 'utf8')).userData.flipVertical, true);
        assert.equal(readFileSync(f.absolute, 'utf8'), 'PNG-native-source');
        assert.equal(JSON.parse(readFileSync(`${f.absolute}.meta`, 'utf8')).userData.untouched, 'keep');
        assert.deepEqual(f.calls.slice(0, 2), ['query-asset-info', 'save-asset-meta']);
        assert.ok(f.calls.slice(2).length >= 2);
        assert.ok(f.calls.slice(2).every((name) => name === 'query-asset-meta'));
    } finally { f.clean(); }
});

for (const [mode, error] of [
    ['false-ack', 'meta_readback_mismatch'], ['identity', 'meta_identity_unproven'],
    ['subasset', 'meta_readback_mismatch'], ['source', 'meta_source_changed'], ['reject', 'native-save-refused'],
]) {
    test(`native ${mode} cannot produce successful metadata save`, async () => {
        const f = fixture(mode);
        try {
            f.session.setAssetProperty({ patch: { image: { flipVertical: true } } });
            await assert.rejects(EditorMcpLumenMetaSave.save(f.session, f.path, f.message, 20), new RegExp(error));
            if (mode === 'identity') { assert.equal(f.calls.includes('save-asset-meta'), false); }
        } finally { f.clean(); }
    });
}

test('unchanged sidecar uses no mutating native message', async () => {
    const f = fixture();
    try {
        f.session.setAssetProperty({ patch: { image: { flipVertical: false } } });
        await EditorMcpLumenMetaSave.save(f.session, f.path, f.message, 20);
        assert.deepEqual(f.calls, []);
    } finally { f.clean(); }
});

for (const mode of ['success', 'false-ack']) {
    test(`actual Router forwards Host message grant without a global Editor: ${mode}`, async () => {
        const f = fixture(mode);
        const runtime = new RuntimeFacade('3.8.7', { allowMemoryPanelWindowProviderFallback: true });
        try {
            assert.equal(Reflect.get(globalThis, 'Editor'), undefined);
            mkdirSync(join(f.root, 'temp/logs'), { recursive: true });
            writeFileSync(join(f.root, 'temp/logs/project.log'), '');
            const router = new EditorMcpActionRouter({
                version: runtime.version, designSources: [], native: {},
                projectRead: { getProjectPath: async () => f.root, getProjectName: async () => 'MetaFixture' },
                message: { request: f.message.request, send: async () => {}, broadcast: async () => {} },
            });
            const invoke = router.execute({ operation: 'lumen.assetSet', input: {
                assetRelativePath: f.path, props: { image: { flipVertical: true } }, autoCommit: false,
            } });
            if (mode === 'success') {
                await invoke;
                assert.equal(JSON.parse(readFileSync(`${f.absolute}.meta`, 'utf8')).userData.flipVertical, true);
            } else {
                await assert.rejects(invoke, /meta_readback_mismatch/);
            }
            assert.ok(f.calls.includes('save-asset-meta'));
        } finally { runtime.execution.dispose(); f.clean(); }
    });
}


test('native metadata is still original on disk until the official AssetDB write', async () => {
    const f = fixture('no-disk-first');
    try {
        f.session.setAssetProperty({ patch: { image: { flipVertical: true } } });
        const snapshot = f.session.getNativeMetaSnapshot()!;
        assert.equal((snapshot.userData as { flipVertical: boolean }).flipVertical, true);
        (snapshot.userData as { flipVertical: boolean }).flipVertical = false;
        assert.equal((f.session.getNativeMetaSnapshot()!.userData as { flipVertical: boolean }).flipVertical, true);
        await EditorMcpLumenMetaSave.save(f.session, f.path, f.message, 100);
        assert.equal(JSON.parse(readFileSync(`${f.absolute}.meta`, 'utf8')).userData.flipVertical, true);
    } finally { f.clean(); }
});

test('a first matching native readback followed by cached overwrite cannot acknowledge success', async () => {
    const f = fixture('late-overwrite');
    try {
        f.session.setAssetProperty({ patch: { image: { flipVertical: true } } });
        await assert.rejects(EditorMcpLumenMetaSave.save(f.session, f.path, f.message, 150), /meta_readback_mismatch/);
        assert.ok(f.calls.filter((name) => name === 'query-asset-meta').length >= 2);
    } finally { f.clean(); }
});
