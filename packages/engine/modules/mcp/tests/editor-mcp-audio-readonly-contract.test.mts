import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RuntimeFacade } from '@peanut/pod-engine/runtime';
import { LumenSession } from '@peanut/pod-engine/lumen';
import { EditorMcpActionRouter } from '../src/editor-mcp-action-router.js';

/**
 * @description 真实 Lumen/Router 夹具；任何原生调用都令本用例失败，拒绝前必须完全不写盘。
 * @param version 受信 Host 与工程版本。
 * @returns Router、源/meta 原字节和清理入口。
 * @oopException 测试夹具。
 */
function fixture(version: string) {
    const root = mkdtempSync(join(tmpdir(), 'peanut-audio-readonly-'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'temp/logs'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
    writeFileSync(join(root, 'temp/logs/project.log'), '');
    const path = 'assets/Audio.wav';
    writeFileSync(join(root, path), 'RIFF-readonly-fixture');
    writeFileSync(join(root, path + '.meta'), JSON.stringify({
        ver: '1.0.0', importer: 'audio-clip', imported: true,
        uuid: '11111111-2222-4333-8444-555555555555', files: ['.wav'],
        subMetas: {}, userData: { downloadMode: 0, untouched: 'keep' },
    }));
    const before = [path, path + '.meta'].map(p => readFileSync(join(root, p)));
    const runtime = new RuntimeFacade(version, { allowMemoryPanelWindowProviderFallback: true });
    const calls: string[] = [];
    const router = new EditorMcpActionRouter({
        version: runtime.version, designSources: [], native: {},
        projectRead: { getProjectPath: async () => root, getProjectName: async () => 'AudioFixture' },
        message: {
            request: async <TData = unknown,>(_target: string, method: string): Promise<TData> => {
                calls.push(method);
                throw new Error('audio-refusal-must-precede-native-message:' + method);
            },
            send: async () => {}, broadcast: async () => {},
        },
    });
    return {
        root, path, calls, router,
        unchanged: () => {
            for (const [i, p] of [path, path + '.meta'].entries()) assert.deepEqual(readFileSync(join(root, p)), before[i]);
            assert.equal(readFileSync(join(root, 'temp/logs/project.log'), 'utf8'), '');
            assert.deepEqual(calls, []);
        },
        clean: () => { runtime.execution.dispose(); rmSync(root, { recursive: true, force: true }); },
    };
}

for (const version of ['3.8.3', '3.8.7']) {
    test(version + ' inspection discloses readonly downloadMode', async () => {
        const f = fixture(version);
        try {
            const result = await f.router.execute({ operation: 'lumen.inspect', input: { assetRelativePath: f.path } });
            assert.equal(Reflect.get(result.data as object, 'asset').downloadMode, 0);
            assert.equal(Reflect.get(result.data as object, 'asset').downloadModeWritable, false);
            f.unchanged();
        } finally { f.clean(); }
    });
    for (const value of [0, 1, 'DOM_AUDIO']) {
        test(version + ' readonly patch ' + value + ' refuses before save/commit', async () => {
            const f = fixture(version);
            try {
                await assert.rejects(f.router.execute({ operation: 'lumen.assetSet', input: {
                    assetRelativePath: f.path, props: { downloadMode: value }, autoCommit: true,
                } }), (error: unknown) => {
                    assert.equal(Reflect.get(error as object, 'isMcpControlFlowRefusal'), true, 'explicit pre-mutation refusal required; original error=' + String(error));
                    assert.equal(Reflect.get(error as object, 'message'), 'lumen_audio_property_not_editable:audio.downloadMode');
                    return true;
                });
                f.unchanged();
            } finally { f.clean(); }
        });
    }
    test(version + ' caller cannot select legacy Host bridge to write readonly audio', async () => {
        const f = fixture(version);
        try {
            await assert.rejects(f.router.execute({ operation: 'lumen.assetSet', input: {
                assetRelativePath: f.path, props: { downloadMode: 1 }, cocosVersion: '2.4.16', autoCommit: true,
            } }), (error: unknown) => {
                assert.equal(Reflect.get(error as object, 'isMcpControlFlowRefusal'), true, 'explicit pre-mutation refusal required; original error=' + String(error));
                assert.equal(Reflect.get(error as object, 'message'), 'editor_mcp_lumen_host_version_mismatch:2.4.16:' + version);
                return true;
            });
            f.unchanged();
        } finally { f.clean(); }
    });
    test(version + ' direct Lumen rejects readonly field and preserves original metadata', () => {
        const f = fixture(version);
        try {
            const session = new LumenSession({ projectRoot: f.root }); session.openPrefab(f.path);
            const modelBefore = session.getNativeMetaSnapshot();
            assert.throws(() => session.setAssetProperty({ patch: { downloadMode: 1 } }), /lumen_audio_property_not_editable:audio.downloadMode/);
            assert.deepEqual(session.getNativeMetaSnapshot(), modelBefore);
            assert.equal(session.inspectAsset().kind, 'audio');
            f.unchanged();
        } finally { f.clean(); }
    });
}
