import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @description 在首次导入前声明真实图片的SpriteFrame选项，子资源交由SDK生成。
 */
export class ComponentSpriteImport {
    /**
     * @description 主图片和粒子相邻纹理共用精确SDK配置；不覆盖已有meta或改写源字节。
     * @param project 尚未启动的新隔离工程。
     * @param engine 对应版本实际内置SDK。
     * @returns 每个派生meta的来源、摘要及导入前状态。
     */
    public static stage(project: string, engine: string) {
        const source = join(engine, 'editor/assets/default_ui/default_sprite.png.meta');
        const bytes = readFileSync(source); const template = JSON.parse(bytes.toString('utf8'));
        if (template.importer !== 'image' || template.userData?.type !== 'sprite-frame'
            || typeof template.ver !== 'string' || !template.ver) throw new Error('component_native_image_import_template_invalid');
        const images = ['assets/fixtures/media/assets/image/checker.png',
            'assets/fixtures/media/supplemental/particle/checker.png'].filter(path => existsSync(join(project, path)));
        if (!images.length) throw new Error('component_native_sprite_images_missing');
        for (const image of images) if (existsSync(join(project, image + '.meta'))) throw new Error('component_native_sprite_meta_exists');
        return images.map(image => {
            const relativePath = image + '.meta';
            const meta = { ver: template.ver, importer: template.importer, imported: false, uuid: randomUUID(),
                files: [], subMetas: {}, userData: { type: template.userData.type } };
            const authored = Buffer.from(JSON.stringify(meta, null, 2) + '\n');
            writeFileSync(join(project, relativePath), authored, { flag: 'wx' });
            return { source, sourceSha256: createHash('sha256').update(bytes).digest('hex'), relativePath,
                sha256: createHash('sha256').update(authored).digest('hex'),
                derivation: '精确SDK提供image版本和sprite-frame选项；只创作图片身份，SpriteFrame子资源由实际importer生成' };
        });
    }
}
