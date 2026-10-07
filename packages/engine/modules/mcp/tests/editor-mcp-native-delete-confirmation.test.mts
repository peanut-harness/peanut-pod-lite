import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { EditorMcpSilentAssetGateway, type IEditorMcpSilentAssetHost } from '../src/editor-mcp-silent-asset-gateway.js';

for (const mode of ['leaf', 'directory', 'subasset', 'query-error']) {
    test(`native delete confirmation: ${mode}`, async (context) => {
        const root = mkdtempSync(join(tmpdir(), 'pod-native-delete-'));
        context.after(() => rmSync(root, { recursive: true, force: true }));
        const parent = 'assets/Generated', target = `${parent}/Delete${mode === 'directory' ? '' : '.rt'}`;
        mkdirSync(join(root, parent), { recursive: true });
        writeFileSync(join(root, parent + '.meta'), JSON.stringify({ uuid: 'parent' }));
        if (mode === 'directory') mkdirSync(join(root, target));
        else writeFileSync(join(root, target), '[]');
        writeFileSync(join(root, target + '.meta'), JSON.stringify({ uuid: 'main', subMetas: { frame: { uuid: 'main@frame' } } }));
        writeFileSync(join(root, parent, 'Keep.json'), '{}');
        let registered = true, refreshed = false;
        const originalError = new Error('actual_native_query_failed');
        const host = {
            requireProjectPath: async () => root,
            isRecord: (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value),
            runtime: { message: { request: async (_target: string, message: string, key: unknown): Promise<unknown> => {
                if (message === 'query-ready') return true;
                if (message === 'query-asset-info') {
                    if (mode === 'query-error') throw originalError;
                    if (key === `db://${parent}`) return { uuid: 'parent' };
                    if (key === `db://${target}` || key === 'main' || key === 'main@frame') return registered ? { uuid: key === 'main@frame' ? 'main@frame' : 'main' } : null;
                    return null;
                }
                if (message === 'refresh-asset') {
                    assert.equal(key, `db://${parent}`, 'refresh only the surviving parent');
                    assert.equal(existsSync(join(root, target)), false);
                    refreshed = true; registered = false; return null;
                }
                throw new Error(`unexpected_message:${message}`);
            } } },
        } as unknown as IEditorMcpSilentAssetHost;
        const gateway = new EditorMcpSilentAssetGateway(host);
        if (mode === 'query-error') {
            await assert.rejects(gateway._executeAssetDelete({ paths: [target] }), (error) => error === originalError);
            assert.equal(existsSync(join(root, target)), true, 'query failure before delete leaves the file intact');
        } else {
            await gateway._executeAssetDelete({ paths: [target] });
            assert.equal(registered, false, 'success requires both native URL and old UUID absent');
            assert.equal(refreshed, true);
            assert.equal(readFileSync(join(root, parent, 'Keep.json'), 'utf8'), '{}');
            assert.equal(existsSync(join(root, target + '.meta')), false);
        }
    });
}
