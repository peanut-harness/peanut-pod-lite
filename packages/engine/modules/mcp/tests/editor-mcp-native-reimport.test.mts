import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { EditorMcpAssetReimport } from '../src/editor-mcp-asset-reimport.js';
import { EditorMcpAssetDbTransaction } from '../src/editor-mcp-asset-db-transaction.js';

for (const mode of ['success', 'refuse', 'identity', 'source', 'not-ready']) {
    test(`native reimport executes real messages and preserves identities: ${mode}`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'mcp-native-reimport-')); mkdirSync(join(root, 'assets'));
        const paths = ['assets/T.png', 'assets/A.wav']; const calls: string[] = []; let active = 0; let reimports = 0;
        const metas = new Map(paths.map((path, i) => [path, { uuid: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee${i}`,
            importer: i === 0 ? 'image' : 'audio-clip', imported: true, subMetas: {}, userData: {} }]));
        for (const path of paths) { writeFileSync(join(root, path), path); writeFileSync(join(root, `${path}.meta`), JSON.stringify(metas.get(path))); }
        const message = { request: async (_target: string, name: string, url: unknown): Promise<unknown> => {
            const path = String(url).slice(5); calls.push(name);
            if (name === 'query-asset-info') { return { ...metas.get(path), imported: mode !== 'not-ready' }; }
            if (name === 'reimport-asset') {
                assert.equal(active, 0); active += 1; await new Promise<void>((resolve) => setTimeout(resolve, 5)); active -= 1;
                reimports += 1;
                if (mode === 'refuse') { throw new Error('native-reimport-refused'); }
                if (mode === 'identity') { const meta = metas.get(path)!; meta.uuid = 'changed'; writeFileSync(join(root, `${path}.meta`), JSON.stringify(meta)); }
                if (mode === 'source') { writeFileSync(join(root, path), 'changed'); }
                return undefined;
            }
            if (name === 'query-ready') { return true; }
            throw new Error(`unexpected:${name}`);
        } };
        const transaction = new EditorMcpAssetDbTransaction({ requireProjectPath: async () => root,
            requireMessage: () => message, refreshForCommit: async () => { throw new Error('must not substitute refresh for reimport'); } });
        try {
            const invoke = EditorMcpAssetReimport.execute(root, paths, message, transaction);
            if (mode === 'success') {
                const result = await invoke as { via: string; triggered: boolean };
                assert.equal(result.via, 'assetdb_native_reimport'); assert.equal(result.triggered, true); assert.equal(reimports, 2);
                for (const path of paths) { assert.equal(readFileSync(join(root, path), 'utf8'), path); }
            } else { await assert.rejects(invoke, /native-reimport-refused|identity_or_ready_mismatch|source_changed/); }
            assert.ok(calls.includes('reimport-asset'));
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
