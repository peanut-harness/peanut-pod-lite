import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LumenAssetDbEditorRefreshAdapter } from '../source/io/asset-db-refresh.js';

for (const extension of ['prefab', 'scene', 'mtl', 'anim', 'pmtl', 'rt']) {
    test(`commit ${extension} imports the newly edited source before exposing ready`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'native-library-sync-'));
        const file = `assets/owned/Live.${extension}`;
        const library = join(root, 'library.json');
        mkdirSync(join(root, 'assets/owned'), { recursive: true });
        writeFileSync(join(root, file), JSON.stringify({ marker: 'new-content', revision: 2 }));
        writeFileSync(library, JSON.stringify({ marker: 'old-content', revision: 1 }));
        writeFileSync(join(root, file + '.meta'), JSON.stringify({ importer: extension, imported: true, uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
        const mutations: string[] = [];
        const adapter = new LumenAssetDbEditorRefreshAdapter({ request: async <TData = unknown>(_target: string, name: string, ...args: unknown[]): Promise<TData> => {
            if (name === 'query-ready') return true as TData;
            if (name === 'query-asset-info') return { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', imported: true } as TData;
            if (name === 'reimport-asset') {
                assert.equal(args[0], `db://${file}`);
                mutations.push(name);writeFileSync(library, readFileSync(join(root, file)));
                return true as TData;
            }
            throw new Error(`unexpected-native-operation:${name}`);
        } }, 0);
        try {
            await adapter.refreshBarrier(root, [file]);
            assert.equal(JSON.parse(readFileSync(library, 'utf8')).marker, 'new-content', 'ready must follow import of current bytes, not existing UUID alone');
            assert.deepEqual(mutations, ['reimport-asset']);
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}

test('native serialized import refusal prevents a successful commit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-import-refusal-'));
    mkdirSync(join(root, 'assets/owned'), { recursive: true });
    const file = 'assets/owned/Live.scene';
    writeFileSync(join(root, file), '[]');
    writeFileSync(join(root, file + '.meta'), JSON.stringify({ importer: 'scene', imported: true, uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
    const adapter = new LumenAssetDbEditorRefreshAdapter({ request: async <TData = unknown>(_target: string, name: string): Promise<TData> => {
        if (name === 'query-ready') return true as TData;
        if (name === 'query-asset-info') return { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', imported: true } as TData;
        if (name === 'reimport-asset') throw new Error('native-import-refused');
        throw new Error(`unexpected-native-operation:${name}`);
    } }, 0);
    try { await assert.rejects(adapter.refreshBarrier(root, [file]), /native-import-refused/); }
    finally { rmSync(root, { recursive: true, force: true }); }
});
