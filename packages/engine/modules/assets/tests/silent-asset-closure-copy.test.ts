import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CocosUuidCodec } from '../src/cocos-uuid-codec.ts';
import { FileAssetDependencyIndex } from '../src/file-asset-dependency-index.ts';
import { SilentAssetClosureCopy } from '../src/silent-asset-closure-copy.ts';

test('copy preparation includes directory descendants and refreshes changed dependencies without writing', () => {
    const root = mkdtempSync(join(tmpdir(), 'copy-preparation-'));
    try {
        writeImage(root, 'assets/local.png', '11111111-1111-4111-8111-111111111111');
        writeImage(root, 'assets/foreign.png', '22222222-2222-4222-8222-222222222222');
        const file = 'assets/seed/child.prefab'; const childUuid = '33333333-3333-4333-8333-333333333333';
        writePrefab(root, file, childUuid, '11111111-1111-4111-8111-111111111111');
        const request = { projectRoot: root, seedRelativePaths: ['assets/seed'], targetDirectoryRelative: 'assets/output' };
        const copier = new SilentAssetClosureCopy(); const first = copier.prepare(request);
        assert.ok(first.order.includes(file)); assert.ok(first.order.includes('assets/local.png'));
        assert.equal(existsSync(join(root, 'assets/output')), false);
        assert.equal(existsSync(join(root, 'assets/seed.meta')), false);
        writePrefab(root, file, childUuid, '22222222-2222-4222-8222-222222222222');
        const second = copier.prepare(request);
        assert.ok(second.order.includes('assets/foreign.png')); assert.notEqual(first.sourceDigest, second.sourceDigest);
        assert.throws(() => copier.copy(request, first), /silent_copy_preparation_changed/);
        assert.equal(existsSync(join(root, 'assets/output')), false);
        assert.equal(existsSync(join(root, 'assets/seed.meta')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

/**
 * @description 写入带引用的最小 prefab。
 * @param root 工程根。
 * @param relativePath 相对路径。
 * @param uuid prefab uuid。
 * @param spriteUuid 引用的 sprite uuid。
 * @returns 无。
 */
function writePrefab(root: string, relativePath: string, uuid: string, spriteUuid: string): void {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(
        absolute,
        `${JSON.stringify(
            [
                {
                    __type__: 'cc.Prefab',
                    _name: 'Panel',
                    data: { __id__: 1 },
                },
                {
                    __type__: 'cc.Sprite',
                    _spriteFrame: { __uuid__: spriteUuid },
                },
            ],
            null,
            2,
        )}\n`,
    );
    writeFileSync(
        `${absolute}.meta`,
        `${JSON.stringify(
            {
                ver: '1.1.50',
                importer: 'prefab',
                imported: true,
                uuid,
                files: ['.json'],
                subMetas: {},
                userData: {},
            },
            null,
            2,
        )}\n`,
    );
}

/**
 * @description 写入带 texture/spriteFrame 子资源的图片 meta。
 * @param root 工程根。
 * @param relativePath 相对路径。
 * @param uuid 主 uuid。
 * @returns 无。
 */
function writeImage(root: string, relativePath: string, uuid: string): void {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, 'png-bytes');
    writeFileSync(
        `${absolute}.meta`,
        `${JSON.stringify(
            {
                ver: '1.0.27',
                importer: 'image',
                imported: true,
                uuid,
                files: ['.json', '.png'],
                subMetas: {
                    '6c48a': {
                        importer: 'texture',
                        uuid: `${uuid}@6c48a`,
                        id: '6c48a',
                        name: 'texture',
                        userData: {},
                        ver: '1.0.22',
                        imported: true,
                        files: ['.json'],
                        subMetas: {},
                    },
                    f9941: {
                        importer: 'sprite-frame',
                        uuid: `${uuid}@f9941`,
                        id: 'f9941',
                        name: 'spriteFrame',
                        userData: {},
                        ver: '1.0.12',
                        imported: true,
                        files: ['.json'],
                        subMetas: {},
                    },
                },
                userData: {
                    type: 'sprite-frame',
                    redirect: `${uuid}@6c48a`,
                },
            },
            null,
            2,
        )}\n`,
    );
}

test('SilentAssetClosureCopy copies deps first and remaps nested uuids', (): void => {
    const root = mkdtempSync(join(tmpdir(), 'peanut-silent-copy-'));
    mkdirSync(join(root, 'assets'), { recursive: true });
    const imageUuid = '11111111-1111-4111-8111-111111111111';
    const prefabUuid = '22222222-2222-4222-8222-222222222222';
    const spriteUuid = `${imageUuid}@f9941`;
    writeImage(root, 'assets/ui/icon.png', imageUuid);
    writePrefab(root, 'assets/ui/Panel.prefab', prefabUuid, spriteUuid);

    FileAssetDependencyIndex.invalidate(root);
    const result = new SilentAssetClosureCopy().copy({
        projectRoot: root,
        seedRelativePaths: ['assets/ui/Panel.prefab'],
        targetDirectoryRelative: 'assets/ui-copy',
    });

    assert.deepEqual(result.order, ['assets/ui/icon.png', 'assets/ui/Panel.prefab']);
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0]?.fromPath, 'assets/ui/icon.png');
    assert.equal(result.items[0]?.toPath, 'assets/ui-copy/icon.png');
    assert.equal(result.items[1]?.toPath, 'assets/ui-copy/Panel.prefab');
    assert.notEqual(result.items[0]?.toUuid, imageUuid);
    assert.notEqual(result.items[1]?.toUuid, prefabUuid);

    const newImageMeta = JSON.parse(readFileSync(join(root, 'assets/ui-copy/icon.png.meta'), 'utf8')) as {
        uuid: string;
        userData: { redirect: string };
        subMetas: Record<string, { uuid: string }>;
    };
    assert.equal(newImageMeta.uuid, result.items[0]?.toUuid);
    assert.equal(newImageMeta.subMetas.f9941?.uuid, `${newImageMeta.uuid}@f9941`);
    assert.equal(newImageMeta.userData.redirect, `${newImageMeta.uuid}@6c48a`);

    const newPrefab = JSON.parse(readFileSync(join(root, 'assets/ui-copy/Panel.prefab'), 'utf8')) as Array<{
        _spriteFrame?: { __uuid__?: string };
    }>;
    const remappedSprite = newPrefab[1]?._spriteFrame?.__uuid__;
    assert.equal(remappedSprite, `${newImageMeta.uuid}@f9941`);
    assert.notEqual(remappedSprite, spriteUuid);

    const codec = new CocosUuidCodec();
    assert.equal(result.uuidMap[codec.compress(imageUuid)], codec.compress(newImageMeta.uuid));
});
