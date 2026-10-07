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
function fixture(version: string, componentType: string) {
    const root = mkdtempSync(join(tmpdir(), 'peanut-ui-intensity-router-'));
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'temp/logs'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ creator: { version } }));
    writeFileSync(join(root, 'temp/logs/project.log'), '');
    const path = 'assets/Fields.prefab';
    const seed = new LumenSession({ projectRoot: root, cocosVersion: version });
    seed.scaffoldPrefab({ prefabRelativePath: path, rootName: 'Fields', template: 'empty' });
    seed.attachComponent({ nodePath: '/Fields', builtinType: componentType });
    seed.save();
    const before = [path, path + '.meta'].map(p => readFileSync(join(root, p)));
    const runtime = new RuntimeFacade(version, { allowMemoryPanelWindowProviderFallback: true });
    const calls: string[] = [];
    const router = new EditorMcpActionRouter({
        version: runtime.version, designSources: [], native: {},
        projectRead: { getProjectPath: async () => root, getProjectName: async () => 'LightFieldsFixture' },
        message: {
            request: async <TData = unknown,>(_target: string, method: string): Promise<TData> => {
                calls.push(method);
                throw new Error('intensity-refusal-must-precede-native-message:' + method);
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
    for (const componentType of ['cc.DirectionalLight', 'cc.SphereLight', 'cc.SpotLight']) {
        for (const props of [{ intensity: 23456 }, { colorTemperature: 4200, intensity: 23456 }]) {
            test(version + ' ' + componentType + ' nonpersistent intensity refuses before save/commit: ' + JSON.stringify(props), async () => {
                const f = fixture(version, componentType);
                try {
                    await assert.rejects(f.router.execute({ operation: 'lumen.compSet', input: { prefabRelativePath: f.path, nodePath: '/Fields', componentType, props, autoCommit: true } }), (error: unknown) => {
                        assert.equal(error instanceof Error && Reflect.get(error, 'isMcpControlFlowRefusal'), true);
                        assert.equal(error instanceof Error ? error.message : null, 'lumen_property_not_persistent:' + componentType + '.intensity');
                        return true;
                    });
                    f.unchanged();
                } finally { f.clean(); }
            });
        }
        test(version + ' ' + componentType + ' caller cannot choose old Host to bypass intensity refusal', async () => {
            const f = fixture(version, componentType);
            try {
                await assert.rejects(f.router.execute({ operation: 'lumen.compSet', input: { prefabRelativePath: f.path, nodePath: '/Fields', componentType, props: { intensity: 23456 }, cocosVersion: '2.4.16', autoCommit: true } }), (error: unknown) => {
                    assert.equal(error instanceof Error && Reflect.get(error, 'isMcpControlFlowRefusal'), true);
                    assert.equal(error instanceof Error ? error.message : null, 'editor_mcp_lumen_host_version_mismatch:2.4.16:' + version);
                    return true;
                });
                f.unchanged();
            } finally { f.clean(); }
        });
    }
}
