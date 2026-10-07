import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import test from 'node:test';
import { LumenAssetDbEditorRefreshAdapter } from '../source/io/asset-db-refresh';

for (const shape of ['array', 'dictionary', 'delayed']) {
    test(`declared texture-only image UUIDs settle without requiring SpriteFrame: ${shape}`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'lumen-declared-subasset-'));
        try {
            mkdirSync(join(root, 'assets')); writeFileSync(join(root, 'assets/T.png'), 'image');
            const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; const child = `${uuid}@6c48a`;
            writeFileSync(join(root, 'assets/T.png.meta'), JSON.stringify({ uuid, importer: 'image', imported: true,
                subMetas: { texture: { uuid: child, importer: 'texture' } } }));
            let queries = 0;
            const adapter = new LumenAssetDbEditorRefreshAdapter({ request: async (_target, name, url) => {
                if (name === 'query-ready') { return true; }
                if (name === 'query-asset-info') {
                    if (String(url).includes('T.png')) {
                        queries += 1;
                        return { uuid, url: 'db://assets/T.png', subAssets: shape === 'dictionary'
                            ? { texture: { uuid: child } } : shape === 'delayed' && queries < 3 ? [] : [{ uuid: child, type: 'texture' }] };
                    }
                    return { uuid: 'assets', isDirectory: true };
                }
                throw new Error(`unexpected-mutating-message:${name}`);
            } }, 0);
            await adapter.refresh(root, ['assets/T.png']);
            assert.ok(queries < 10, 'must finish on declared Texture identity, not time out waiting for SpriteFrame');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
}
