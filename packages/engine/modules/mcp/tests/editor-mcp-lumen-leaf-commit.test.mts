import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenAssetDbEditorRefreshAdapter } from '@peanut/pod-engine/lumen';
import { EditorMcpLumenGateway } from '../src/editor-mcp-lumen-gateway.js';

for (const extension of ['prefab', 'scene']) {
    test(`auto-commit repeated ${extension} edits do not force-refresh the parent Assets tree`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'leaf-commit-'));
        const file = `assets/owned/Live.${extension}`;
        mkdirSync(join(root, 'assets/owned'), { recursive: true });
        writeFileSync(join(root, file), '[]');
        writeFileSync(join(root, file + '.meta'), JSON.stringify({ importer: extension, imported: true, uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
        const calls: string[] = [];
        const adapter = new LumenAssetDbEditorRefreshAdapter({ request: async <TData = unknown,>(_target: string, name: string, ...args: unknown[]): Promise<TData> => {
            calls.push(`${name}:${String(args[0] ?? '')}`);
            if (name === 'query-ready') return true as TData;
            if (name === 'query-asset-info') return { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', imported: true } as TData;
            return null as TData;
        } }, 0);
        try {
            for (let edit = 0; edit < 3; edit += 1) {
                writeFileSync(join(root, file), JSON.stringify([{ edit }]));
                await adapter.refreshBarrier(root, EditorMcpLumenGateway.readCommitPaths({ prefab: file }));
            }
            assert.equal(calls.some(call => call.startsWith('refresh-asset:')), false, 'leaf edits must not trigger parent changed messages');
            assert(calls.some(call => call.startsWith('query-asset-info:db://assets/owned')), 'ancestor registration still checked');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}

test('explicit directory commit remains explicit and refreshes the registered directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'explicit-directory-commit-'));
    mkdirSync(join(root, 'assets/owned'), { recursive: true });
    const calls: string[] = [];
    const adapter = new LumenAssetDbEditorRefreshAdapter({ request: async <TData = unknown,>(_target: string, name: string, ...args: unknown[]): Promise<TData> => {
        calls.push(`${name}:${String(args[0] ?? '')}`);
        if (name === 'query-ready') return true as TData;
        if (name === 'query-asset-info') return { uuid: 'parent', imported: true } as TData;
        return null as TData;
    } }, 0);
    try {
        assert.deepEqual(EditorMcpLumenGateway.readCommitPaths({ prefab: 'assets/owned' }), ['assets/owned']);
        await adapter.refresh(root, EditorMcpLumenGateway.readCommitPaths({ prefab: 'assets/owned' }));
        assert(calls.includes('refresh-asset:db://assets/owned/'));
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recommended commit paths preserve multiple changed leaves without expanding their parent', () => {
    assert.deepEqual(EditorMcpLumenGateway.readCommitPaths({ recommendedNext: { input: { paths: ['assets/owned/a.prefab', 'assets/owned/b.scene', 'assets/owned/a.prefab'] } } }), ['assets/owned/a.prefab', 'assets/owned/b.scene']);
});
