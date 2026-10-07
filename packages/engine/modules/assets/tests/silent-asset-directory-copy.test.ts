import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { SilentAssetClosureCopy } from '../src/silent-asset-closure-copy.ts';

/**
 * @description 只管理本测试创建的目录树及带身份的资源夹具。
 */
class DirectoryCopyFixture {
    /**
     * @description 本测试独占的临时工程根。
     */
    public readonly root = mkdtempSync(join(tmpdir(), 'peanut-directory-copy-'));

    /**
     * @description 创建资源根。
     */
    public constructor() {
        mkdirSync(join(this.root, 'assets'));
    }

    /**
     * @description 创建有主 UUID 的目录。
     * @param path 目录相对路径。
     * @param uuid 主 UUID。
     * @returns 无。
     */
    public directory(path: string, uuid: string): void {
        mkdirSync(join(this.root, path), { recursive: true });
        writeFileSync(join(this.root, `${path}.meta`), JSON.stringify({ importer: 'directory', uuid, subMetas: {} }));
    }

    /**
     * @description 创建普通资源及完整测试 meta。
     * @param path 文件相对路径。
     * @param bytes 原始字节。
     * @param meta 测试元数据。
     * @returns 无。
     */
    public file(path: string, bytes: string | Buffer, meta: Readonly<Record<string, unknown>>): void {
        mkdirSync(dirname(join(this.root, path)), { recursive: true });
        writeFileSync(join(this.root, path), bytes);
        writeFileSync(join(this.root, `${path}.meta`), JSON.stringify(meta));
    }

    /**
     * @description 释放本测试独占目录，不处理外部路径。
     * @returns 无。
     */
    public dispose(): void {
        rmSync(this.root, { recursive: true, force: true });
    }
}

test('directory copy includes nested files, empty directories, fresh UUIDs and forward meta references', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    const dirUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const pngUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const fontUuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const emptyUuid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    fixture.directory('assets/fonts', dirUuid);
    fixture.directory('assets/fonts/nested/empty', emptyUuid);
    fixture.file('assets/fonts/z-atlas.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), {
        importer: 'image', uuid: pngUuid,
        subMetas: { f9941: { importer: 'sprite-frame', uuid: `${pngUuid}@f9941` } },
    });
    const text = 'page id=0 file="z-atlas.png"\n';
    fixture.file('assets/fonts/a-font.fnt', text, {
        importer: 'bitmap-font', uuid: fontUuid, subMetas: {}, userData: { spriteFrameUuid: `${pngUuid}@f9941` },
    });
    const copy = new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/copies',
    });
    const font = copy.items.find((item) => item.fromPath.endsWith('.fnt'));
    const png = copy.items.find((item) => item.fromPath.endsWith('.png'));
    assert(font && png);
    assert.equal(font.toPath, 'assets/copies/fonts/a-font.fnt');
    assert.notEqual(font.toUuid, fontUuid);
    assert.notEqual(png.toUuid, pngUuid);
    assert.equal(copy.items.find((item) => item.fromPath === 'assets/fonts')?.toUuid, copy.uuidMap[dirUuid]);
    assert.notEqual(copy.uuidMap[emptyUuid], emptyUuid);
    assert(existsSync(join(fixture.root, 'assets/copies/fonts/nested/empty')));
    assert.equal(readFileSync(join(fixture.root, font.toPath), 'utf8'), text);
    assert.deepEqual(readFileSync(join(fixture.root, png.toPath)), readFileSync(join(fixture.root, png.fromPath)));
    const copiedMeta: unknown = JSON.parse(readFileSync(join(fixture.root, `${font.toPath}.meta`), 'utf8'));
    assert.deepEqual(copiedMeta, {
        importer: 'bitmap-font', uuid: font.toUuid, subMetas: {}, userData: { spriteFrameUuid: `${png.toUuid}@f9941` },
    });
    assert.equal(readFileSync(join(fixture.root, 'assets/fonts.meta'), 'utf8'), JSON.stringify({ importer: 'directory', uuid: dirUuid, subMetas: {} }));
});

test('directory copy refuses a target inside its source before creating anything', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    fixture.directory('assets/fonts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.throws(() => new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/fonts/copy',
    }), /silent_copy_target_inside_source/);
    assert.equal(existsSync(join(fixture.root, 'assets/fonts/copy')), false);
    assert.equal(existsSync(join(fixture.root, 'assets/fonts/copy.meta')), false);
});

test('directory copy refuses symbolic children before writing the target', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    fixture.directory('assets/fonts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    writeFileSync(join(fixture.root, 'outside.txt'), 'kept');
    symlinkSync(join(fixture.root, 'outside.txt'), join(fixture.root, 'assets/fonts/link.txt'));
    assert.throws(() => new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/copies',
    }), /silent_copy_source_not_regular/);
    assert.equal(existsSync(join(fixture.root, 'assets/copies')), false);
    assert.equal(readFileSync(join(fixture.root, 'outside.txt'), 'utf8'), 'kept');
});

test('directory copy preserves orphan target meta and refuses before publication', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    fixture.directory('assets/fonts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    mkdirSync(join(fixture.root, 'assets/copies'));
    writeFileSync(join(fixture.root, 'assets/copies/fonts.meta'), 'orphan-original');
    assert.throws(() => new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/copies',
    }), /silent_copy_target_exists/);
    assert.equal(readFileSync(join(fixture.root, 'assets/copies/fonts.meta'), 'utf8'), 'orphan-original');
    assert.equal(existsSync(join(fixture.root, 'assets/copies/fonts')), false);
});

test('directory copy refuses aliased destination ancestors and leaves external bytes unchanged', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    fixture.directory('assets/fonts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    mkdirSync(join(fixture.root, 'outside'));
    symlinkSync(join(fixture.root, 'outside'), join(fixture.root, 'assets/copies'));
    assert.throws(() => new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/copies',
    }), /silent_copy_target_alias/);
    assert.equal(existsSync(join(fixture.root, 'outside/fonts')), false);
    assert.equal(existsSync(join(fixture.root, 'outside/fonts.meta')), false);
});


test('directory copy refuses dangling source meta before target mutation', (t): void => {
    const fixture = new DirectoryCopyFixture();
    t.after(() => fixture.dispose());
    fixture.directory('assets/fonts', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    writeFileSync(join(fixture.root, 'assets/fonts/dangling.png'), 'source-kept');
    symlinkSync(join(fixture.root, 'missing.meta'), join(fixture.root, 'assets/fonts/dangling.png.meta'));
    assert.throws(() => new SilentAssetClosureCopy().copy({
        projectRoot: fixture.root, seedRelativePaths: ['assets/fonts'], targetDirectoryRelative: 'assets/copies',
    }), /silent_copy_source_not_regular/);
    assert.equal(existsSync(join(fixture.root, 'assets/copies')), false);
    assert.equal(readFileSync(join(fixture.root, 'assets/fonts/dangling.png'), 'utf8'), 'source-kept');
});
