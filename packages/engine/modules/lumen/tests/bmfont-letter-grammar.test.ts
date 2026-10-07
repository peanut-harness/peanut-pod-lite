import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BitmapFontImportSource } from '../source/asset-import/bitmap-font-import-source.js';

const original = readFileSync('tests/fixtures/bmfont-proven-letter.fnt');
const header = 'info face="Probe" size=16\ncommon lineHeight=16 scaleW=32 scaleH=32 pages=1\npage id=0 file="Page.png"\nchars count=1\n';
const char = ' x=0 y=0 width=1 height=1 xoffset=0 yoffset=0 xadvance=1 page=0 chnl=15';

test('unchanged native-proven original 106-char FNT parses quote and backslash auxiliary letters', () => {
    const root = mkdtempSync(join(tmpdir(), 'fnt-letter-'));
    try {
        const file = join(root, 'Original.fnt'); writeFileSync(file, original);
        assert.equal(createHash('sha256').update(original).digest('hex'), 'e5c42ba8adb77a23f9b8a8e4be4823e0e0d050cb67666ff171c8b2f8c4dfd9b8');
        assert.deepEqual(BitmapFontImportSource.read(file), { image: join(root, 'peanut-rich-text-demo.png'), page: 'peanut-rich-text-demo.png' });
        assert.deepEqual(readFileSync(file), original);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const [id, letter] of [[32, '" "'], [34, '"""'], [92, '"\\\\"'], [128512, '"😀"']] as const) {
    test('single proven auxiliary Unicode letter matches char id ' + id, () => {
        const root = mkdtempSync(join(tmpdir(), 'fnt-letter-'));
        try { const file = join(root, 'Font.fnt'); const text = header + 'char id=' + id + char + ' letter=' + letter + '\n'; writeFileSync(file, text); assert.equal(BitmapFontImportSource.read(file).page, 'Page.png'); assert.equal(readFileSync(file, 'utf8'), text); }
        finally { rmSync(root, { recursive: true, force: true }); }
    });
}
for (const letter of ['"B"', '"AA"', '"A" file="Other.png"', '"A']) {
    test('reject malformed or shadowing auxiliary letter ' + letter, () => {
        const root = mkdtempSync(join(tmpdir(), 'fnt-letter-'));
        try { const file = join(root, 'Font.fnt'); writeFileSync(file, header + 'char id=65' + char + ' letter=' + letter + '\n'); assert.throws(() => BitmapFontImportSource.read(file), /asset_import_fnt_/u); }
        finally { rmSync(root, { recursive: true, force: true }); }
    });
}
