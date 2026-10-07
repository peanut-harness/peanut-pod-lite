import { createHash } from 'crypto';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { basename, join, resolve } from 'path';

import type { IAssetImportItemResult, IAssetImportMessagePort } from './asset-import-batch-executor';
import type { IAssetImportPlan, IAssetImportPlanItem } from './asset-import-planner';
import { BitmapFontImportSource } from './bitmap-font-import-source';
import { NativeImportSpriteFrame } from './native-import-sprite-frame';
import { SpriteFrameMetaBuilder } from './sprite-frame-meta-builder';

/**
 * @description 在原 writer/提交窗口内准备单页 FNT 的真实图片帧，并在字体导入后验证原生 library 引用。
 */
export class BitmapFontImportFrames {
    /**
     * @description 原端口，只调用受支持消息。
     */
    private readonly _message: IAssetImportMessagePort;
    /**
     * @description 与 TMX 共用的原生图片帧核验职责。
     */
    private readonly _imageFrames: NativeImportSpriteFrame;
    /**
     * @description 全批写前冻结的字体与图片源摘要。
     */
    private readonly _fonts = new Map<string, { readonly sha256: string; readonly image: string; readonly imageSha256: string; readonly page: string }>();
    /**
     * @description 原生已登记帧，不以 meta 声明代替查询。
     */
    private readonly _frames = new Map<string, string>();
    /**
     * @description 已有目标字体主 UUID。
     */
    private readonly _existingFontUuids = new Map<string, string>();
    /**
     * @description 接受原执行器依赖，不新增 writer 或资源锁。
     * @param message 原消息端口。
     * @param timeoutMs 原就绪预算。
     */
    public constructor(message: IAssetImportMessagePort, timeoutMs: number) {
        this._message = message;
        this._imageFrames = new NativeImportSpriteFrame(message, timeoutMs, 'asset_import_fnt');
    }
    /**
     * @description 当前层是否需要严格原生刷新。
     * @param layer 原计划层。
     * @returns 是否含 FNT 或其必需 PNG。
     */
    public appliesTo(layer: readonly IAssetImportPlanItem[]): boolean {
        return layer.some(item => this._fonts.has(item.source) || [...this._fonts.values()].some(font => font.image === item.source));
    }
    /**
     * @description 必需刷新不吞错或重放。
     * @param target 原存活父目录。
     * @returns 无。
     */
    public async refresh(target: string): Promise<void> { await this._imageFrames.refresh(target); }
    /**
     * @description 在首次原生操作前验证完整批次与普通文件；allowMissing 不使必需页变为可忽略。
     * @param plan 全部计划。
     * @param projectRoot 当前工程根。
     * @param target 目标目录。
     * @returns 无。
     */
    public validate(plan: IAssetImportPlan, projectRoot: string | undefined, target: string): void {
        for (const item of plan.layers.flat()) {
            if (!item.source.toLowerCase().endsWith('.fnt')) { continue; }
            if (!projectRoot || realpathSync(projectRoot) !== resolve(projectRoot)) { throw new Error('asset_import_fnt_project_root_required'); }
            const font = BitmapFontImportSource.read(item.source);
            BitmapFontImportSource.regularFile(font.image);
            if (!plan.expandedSources.includes(font.image)) { throw new Error('asset_import_fnt_image_not_planned'); }
            this._fonts.set(item.source, { sha256: this._hash(readFileSync(item.source)), image: font.image, imageSha256: this._hash(readFileSync(font.image)), page: font.page });
            const file = this._projectFile(projectRoot, `${target}/${basename(item.source)}`);
            if (!existsSync(file) && !existsSync(file + '.meta')) { continue; }
            BitmapFontImportSource.regularFile(file); BitmapFontImportSource.regularFile(file + '.meta');
            const meta: unknown = JSON.parse(readFileSync(file + '.meta', 'utf8'));
            if (!SpriteFrameMetaBuilder.isRecord(meta) || typeof meta.uuid !== 'string' || !meta.uuid || meta.uuid.includes('@')) { throw new Error('asset_import_fnt_existing_meta_invalid'); }
            this._existingFontUuids.set(`${target}/${basename(item.source)}`, meta.uuid);
        }
    }
    /**
     * @description 字体层前核验源未漂移、PNG 目标未被改名，再准备并查询真正帧。
     * @param layer 当前层。
     * @param imported 先前已完成结果。
     * @param projectRoot 原工程根。
     * @param target 原目标目录。
     * @returns 无。
     */
    public async beforeLayer(layer: readonly IAssetImportPlanItem[], imported: readonly IAssetImportItemResult[], projectRoot: string | undefined, target: string): Promise<void> {
        for (const item of layer) {
            const font = this._fonts.get(item.source);
            if (font == null) { continue; }
            if (!projectRoot) { throw new Error('asset_import_fnt_project_root_required'); }
            if (this._hash(readFileSync(item.source)) !== font.sha256 || this._hash(readFileSync(font.image)) !== font.imageSha256) { throw new Error('asset_import_fnt_source_changed'); }
            const row = imported.find(value => value.source === font.image);
            if (row == null || row.targetDbPath !== `${target}/${font.page}`) { throw new Error('asset_import_fnt_image_target_changed'); }
            const imageFile = this._projectFile(projectRoot, row.targetDbPath);
            BitmapFontImportSource.regularFile(imageFile);
            if (this._hash(readFileSync(imageFile)) !== font.imageSha256) { throw new Error('asset_import_fnt_image_source_changed'); }
            this._frames.set(font.image, await this._imageFrames.prepare(projectRoot, row.targetDbPath, target));
        }
    }
    /**
     * @description 字体真正导入后核对主身份、原源字节与 library 帧引用，才允许整批成功。
     * @param layer 完成层。
     * @param imported 已完成结果。
     * @param projectRoot 原工程根。
     * @returns 无。
     */
    public async afterLayer(layer: readonly IAssetImportPlanItem[], imported: readonly IAssetImportItemResult[], projectRoot: string | undefined): Promise<void> {
        for (const item of layer) {
            const font = this._fonts.get(item.source);
            if (font == null) { continue; }
            const row = imported.find(value => value.source === item.source);
            if (!row || !projectRoot) { throw new Error('asset_import_fnt_result_missing'); }
            const file = this._projectFile(projectRoot, row.targetDbPath);
            BitmapFontImportSource.regularFile(file); BitmapFontImportSource.regularFile(file + '.meta');
            if (this._hash(readFileSync(file)) !== font.sha256) { throw new Error('asset_import_fnt_font_source_changed'); }
            const meta: unknown = JSON.parse(readFileSync(file + '.meta', 'utf8'));
            const info = await this._message.request('asset-db', 'query-asset-info', row.targetDbPath);
            if (!SpriteFrameMetaBuilder.isRecord(meta) || !SpriteFrameMetaBuilder.isRecord(info) ||
                typeof meta.uuid !== 'string' || !meta.uuid || meta.uuid.includes('@') || info.uuid !== meta.uuid || info.url !== row.targetDbPath ||
                (this._existingFontUuids.has(row.targetDbPath) && info.uuid !== this._existingFontUuids.get(row.targetDbPath)) ||
                info.importer !== 'bitmap-font' || info.type !== 'cc.BitmapFont' || info.imported !== true || info.invalid === true ||
                !SpriteFrameMetaBuilder.isRecord(info.library) || typeof info.library['.json'] !== 'string') { throw new Error('asset_import_fnt_font_registration_invalid'); }
            const library = info.library['.json'];
            BitmapFontImportSource.regularFile(library);
            if (!realpathSync(library).startsWith(`${resolve(projectRoot)}/library/`)) { throw new Error('asset_import_fnt_library_owner_invalid'); }
            const doc: unknown = JSON.parse(readFileSync(library, 'utf8'));
            if (!SpriteFrameMetaBuilder.isRecord(doc) || doc.__type__ !== 'cc.BitmapFont' ||
                !SpriteFrameMetaBuilder.isRecord(doc.spriteFrame) || doc.spriteFrame.__uuid__ !== this._frames.get(font.image) ||
                !SpriteFrameMetaBuilder.isRecord(doc.fntConfig) || doc.fntConfig.atlasName !== font.page) { throw new Error('asset_import_fnt_library_frame_invalid'); }
            const frame = this._frames.get(font.image);
            if (frame == null) { throw new Error('asset_import_fnt_frame_missing'); }
            await this._imageFrames.verify(projectRoot, row.targetDbPath.replace(/[^/]+$/u, font.page), frame);
        }
    }
    /**
     * @description 精确解析当前工程内 assets 路径，拒绝 db URI 越界或祖先别名。
     * @param projectRoot 原工程根。
     * @param url 结果 db 路径。
     * @returns 当前普通资源期望盘路径。
     */
    private _projectFile(projectRoot: string, url: string): string {
        const root = resolve(projectRoot);
        const file = resolve(join(root, SpriteFrameMetaBuilder.toProjectRelative(url)));
        if (!url.startsWith('db://assets/') || !file.startsWith(`${root}/assets/`)) { throw new Error('asset_import_fnt_target_invalid'); }
        return file;
    }
    /**
     * @description 为原始字节生成冻结摘要。
     * @param bytes 原始字节。
     * @returns SHA-256。
     */
    private _hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
}
