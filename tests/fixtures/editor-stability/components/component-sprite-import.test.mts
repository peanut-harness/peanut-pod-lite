import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ComponentSpriteImport } from './component-sprite-import.mts';

test('particle companion receives SpriteFrame import configuration before first import without fabricating sub-assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'particle-sprite-import-'));
    try {
        const template = 'editor/assets/default_ui/default_sprite.png.meta';
        mkdirSync(dirname(join(root, template)), { recursive: true });
        writeFileSync(join(root, template), JSON.stringify({ ver: '1.0.27', importer: 'image',
            uuid: 'builtin-image', userData: { type: 'sprite-frame' }, subMetas: { f9941: { uuid: 'builtin-image@f9941' } } }));
        const paths = ['assets/fixtures/media/assets/image/checker.png', 'assets/fixtures/media/supplemental/particle/checker.png'];
        for (const path of paths) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), 'source-bytes'); }
        const rows = ComponentSpriteImport.stage(root, root);
        assert.equal(rows.length, 2);
        const ids: string[] = [];
        for (const path of paths) {
            assert.equal(readFileSync(join(root, path), 'utf8'), 'source-bytes');
            const meta = JSON.parse(readFileSync(join(root, path + '.meta'), 'utf8'));
            assert.deepEqual(meta.userData, { type: 'sprite-frame' });
            assert.equal(meta.ver, '1.0.27'); assert.equal(meta.importer, 'image'); assert.equal(meta.imported, false);
            assert.deepEqual(meta.subMetas, {}); assert.deepEqual(meta.files, []);
            assert.match(meta.uuid, /^[0-9a-f-]{36}$/u); ids.push(meta.uuid);
        }
        assert.notEqual(ids[0], ids[1]);
        const before = paths.map(path => readFileSync(join(root, path + '.meta')));
        assert.throws(() => ComponentSpriteImport.stage(root, root), /sprite_meta_exists/);
        assert.deepEqual(paths.map(path => readFileSync(join(root, path + '.meta'))), before);
        writeFileSync(join(root, template), JSON.stringify({ importer: 'image', ver: '1', userData: { type: 'texture' } }));
        assert.throws(() => ComponentSpriteImport.stage(root, root), /import_template_invalid/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
