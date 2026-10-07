import { createHash } from 'crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'fs';
import { basename, join, resolve } from 'path';

import type { IAssetImportItemResult, IAssetImportMessagePort } from './asset-import-batch-executor';
import type { IAssetImportPlan, IAssetImportPlanItem } from './asset-import-planner';
import { SpriteFrameMetaBuilder } from './sprite-frame-meta-builder';
import { NativeImportSpriteFrame } from './native-import-sprite-frame';
import { TiledMapImportSource } from './tiled-map-import-source';

/**
 * @description 在原导入写窗口内准备 TMX 必需的真实 PNG 子资源；不加锁、不改变公开 DTO、不回放失败。
 */
export class TiledMapImportImages {
    /**
     * @description 原宿主消息端口。
     */
    private readonly _message: IAssetImportMessagePort;
    /**
     * @description 复用原执行器注入的就绪超时。
     */
    private readonly _imageFrames: NativeImportSpriteFrame;
    /**
     * @description 每个 TMX 的冻结内容与依赖。
     */
    private readonly _maps = new Map<string, { readonly sha256: string; readonly images: readonly string[] }>();
    /**
     * @description 已存在目标地图的原主 UUID。
     */
    private readonly _existingMapUuids = new Map<string, string>();
    /**
     * @description 已核验源 PNG 到原生帧身份的映射。
     */
    private readonly _frames = new Map<string, string>();

    /**
     * @description 当前层是否包含 TMX 或其必需 PNG，决定仅此路径使用严格原生刷新。
     * @param layer 原导入层。
     * @returns 是否含必需依赖。
     */
    public appliesTo(layer: readonly IAssetImportPlanItem[]): boolean {
        return layer.some(item => this._maps.has(item.source) || [...this._maps.values()].some(map => map.images.includes(item.source)));
    }

    /**
     * @description 必需导入层刷新失败直接传播，不重放或吞掉原 Error。
     * @param target 原目标目录。
     * @returns 无。
     */
    public async refresh(target: string): Promise<void> {
        await this._imageFrames.refresh(target);
    }

    /**
     * @description 创建必需子资源准备器。
     * @param message 原宿主端口。
     * @param timeoutMs 原导入执行器就绪预算。
     */
    public constructor(message: IAssetImportMessagePort, timeoutMs: number) {
        this._message = message;
        this._imageFrames = new NativeImportSpriteFrame(message, timeoutMs, 'asset_import_tmx');
    }

    /**
     * @description 在任何原生操作前冻结全部受支持地图及本地依赖。
     * @param plan 完整原计划。
     * @param projectRoot 当前工程根；仅 TMX 导入必需。
     * @param target 原目标目录。
     * @returns 无。
     */
    public validate(plan: IAssetImportPlan, projectRoot: string | undefined, target: string): void {
        for (const item of plan.layers.flat()) {
            if (!item.source.toLowerCase().endsWith('.tmx')) { continue; }
            if (!projectRoot) { throw new Error('asset_import_tmx_project_root_required'); }
            if (realpathSync(projectRoot) !== resolve(projectRoot)) { throw new Error('asset_import_tmx_project_path_invalid'); }
            const images = TiledMapImportSource.images(item.source);
            for (const image of images) {
                if (!plan.expandedSources.includes(image)) { throw new Error('asset_import_tmx_image_not_planned'); }
            }
            this._maps.set(item.source, { images, sha256: this._hash(readFileSync(item.source)) });
            this._freezeExistingMap(projectRoot, target, item.source);
        }
    }

    /**
     * @description 在 TMX 层之前准备其已导入 PNG；原生失败保持原对象并直接向上传播。
     * @param layer 当前导入层。
     * @param imported 已完成层的原结果。
     * @param projectRoot 原工程根。
     * @param target 原目标目录。
     * @returns 无。
     */
    public async beforeLayer(layer: readonly IAssetImportPlanItem[], imported: readonly IAssetImportItemResult[], projectRoot: string | undefined, target: string): Promise<void> {
        for (const item of layer) {
            const map = this._maps.get(item.source);
            if (map == null) { continue; }
            if (this._hash(readFileSync(item.source)) !== map.sha256) { throw new Error('asset_import_tmx_source_changed'); }
            if (!projectRoot) { throw new Error('asset_import_tmx_project_root_required'); }
            for (const source of map.images) {
                const row = imported.find(value => value.source === source);
                if (row == null || row.targetDbPath !== `${target}/${basename(source)}`) {
                    throw new Error('asset_import_tmx_image_target_changed');
                }
                this._frames.set(source, await this._imageFrames.prepare(projectRoot, row.targetDbPath, target));
            }
        }
    }

    /**
     * @description 导入后核验实际 TMX 主身份、源字节及 library 内每个 PNG 帧引用。
     * @param layer 完成的原导入层。
     * @param imported 原结果集。
     * @param projectRoot 原工程根。
     * @returns 无。
     */
    public async afterLayer(layer: readonly IAssetImportPlanItem[], imported: readonly IAssetImportItemResult[], projectRoot: string | undefined): Promise<void> {
        for (const item of layer) {
            const map = this._maps.get(item.source);
            if (map == null) { continue; }
            const row = imported.find(value => value.source === item.source);
            if (row == null || !projectRoot) { throw new Error('asset_import_tmx_result_missing'); }
            const root = resolve(projectRoot);
            const file = resolve(join(root, SpriteFrameMetaBuilder.toProjectRelative(row.targetDbPath)));
            if (!file.startsWith(`${root}/assets/`) || realpathSync(file) !== file ||
                this._hash(readFileSync(file)) !== map.sha256) { throw new Error('asset_import_tmx_map_source_changed'); }
            const meta: unknown = JSON.parse(readFileSync(file + '.meta', 'utf8'));
            const info = await this._message.request('asset-db', 'query-asset-info', row.targetDbPath);
            if (!SpriteFrameMetaBuilder.isRecord(meta) || !SpriteFrameMetaBuilder.isRecord(info) ||
                info.uuid !== meta.uuid || (this._existingMapUuids.has(row.targetDbPath) && info.uuid !== this._existingMapUuids.get(row.targetDbPath)) || info.importer !== 'tiled-map' || info.type !== 'cc.TiledMapAsset' ||
                info.imported !== true || info.invalid === true || !SpriteFrameMetaBuilder.isRecord(info.library) ||
                typeof info.library['.json'] !== 'string') { throw new Error('asset_import_tmx_map_registration_invalid'); }
            const library = realpathSync(info.library['.json']);
            if (!library.startsWith(`${root}/library/`)) { throw new Error('asset_import_tmx_library_owner_invalid'); }
            const doc: unknown = JSON.parse(readFileSync(library, 'utf8'));
            this._mapReferences(doc, map.images, readFileSync(file, 'utf8'));
        }
    }

    /**
     * @description 在首次原生写入前冻结已有目标地图主身份，拒绝未登记或别名目标。
     * @param projectRoot 当前工程根。
     * @param target 原目标目录。
     * @param source 当前地图源。
     * @returns 无。
     */
    private _freezeExistingMap(projectRoot: string, target: string, source: string): void {
        const url = `${target}/${basename(source)}`;
        const root = resolve(projectRoot);
        const file = resolve(join(root, SpriteFrameMetaBuilder.toProjectRelative(url)));
        if (!file.startsWith(`${root}/assets/`)) { throw new Error('asset_import_tmx_target_invalid'); }
        if (!existsSync(file) && !existsSync(file + '.meta')) { return; }
        for (const path of [file, file + '.meta']) {
            const stat = lstatSync(path);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) {
                throw new Error('asset_import_tmx_existing_target_identity_invalid');
            }
        }
        const meta: unknown = JSON.parse(readFileSync(file + '.meta', 'utf8'));
        if (!SpriteFrameMetaBuilder.isRecord(meta) || typeof meta.uuid !== 'string' || !meta.uuid || meta.uuid.includes('@')) {
            throw new Error('asset_import_tmx_existing_target_meta_invalid');
        }
        this._existingMapUuids.set(url, meta.uuid);
    }

    /**
     * @description 校验原生文档中的所有实际 SpriteFrame 槽，不以声明 UUID 或保存回执代替登记。
     * @param doc 原生 library JSON。
     * @param images 原冻结源 PNG 集合。
     * @param xml 实际 TMX 全文。
     * @returns 无。
     */
    private _mapReferences(doc: unknown, images: readonly string[], xml: string): void {
        if (!SpriteFrameMetaBuilder.isRecord(doc) || doc.__type__ !== 'cc.TiledMapAsset' || doc.tmxXmlStr !== xml ||
            !Array.isArray(doc.spriteFrameNames) || !Array.isArray(doc.spriteFrames) ||
            doc.spriteFrameNames.length !== doc.spriteFrames.length || doc.spriteFrameNames.length === 0) {
            throw new Error('asset_import_tmx_library_invalid');
        }
        const known = new Map(images.map(source => [basename(source), this._frames.get(source)]));
        const seen = new Set<string>();
        for (let i = 0; i < doc.spriteFrameNames.length; i += 1) {
            const name: unknown = doc.spriteFrameNames[i];
            const ref: unknown = doc.spriteFrames[i];
            if (typeof name !== 'string' || !known.has(name) || !SpriteFrameMetaBuilder.isRecord(ref) ||
                ref.__uuid__ !== known.get(name)) { throw new Error('asset_import_tmx_library_frame_mismatch'); }
            seen.add(name);
        }
        if (seen.size !== known.size) { throw new Error('asset_import_tmx_library_image_missing'); }
    }

    /**
     * @description 为冻结源生成内容摘要。
     * @param bytes 源文件完整字节。
     * @returns SHA256。
     */
    private _hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
