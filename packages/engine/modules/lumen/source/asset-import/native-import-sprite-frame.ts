import { lstatSync, readFileSync, realpathSync } from 'fs';
import { resolve, join } from 'path';
import { isDeepStrictEqual } from 'util';

import type { IAssetImportMessagePort } from './asset-import-batch-executor';
import { SpriteFrameMetaBuilder } from './sprite-frame-meta-builder';

/**
 * @description 冻结已导入 PNG 的源文件与主身份；meta 修改只接受原生操作并保持既有子 UUID。
 */
interface IImportedImageSnapshot {
    /**
     * @description 原生 db 路径。
     */
    readonly url: string;
    /**
     * @description 当前工程内的普通源文件。
     */
    readonly file: string;
    /**
     * @description 原生主 UUID。
     */
    readonly uuid: string;
    /**
     * @description 冻结文件字节。
     */
    readonly bytes: Buffer;
    /**
     * @description 冻结设备和 inode。
     */
    readonly physicalIdentity: string;
    /**
     * @description 冻结原生与磁盘一致的 meta。
     */
    readonly meta: Record<string, unknown>;
    /**
     * @description 磁盘完整 meta，包含原生查询可能隐藏的既有 Texture 子资源设置。
     */
    readonly diskMeta: Record<string, unknown>;
}

/**
 * @description 在原导入写窗口核验并准备已登记图片的真实 SpriteFrame；TMX/FNT 共用原生身份与错误传播契约。
 */
export class NativeImportSpriteFrame {
    /**
     * @description 原宿主消息端口。
     */
    private readonly _message: IAssetImportMessagePort;
    /**
     * @description 原执行器传入的等待预算。
     */
    private readonly _timeoutMs: number;
    /**
     * @description 已登记消费者及公开提升服务的稳定错误命名空间。
     */
    private readonly _prefix: 'asset_import_tmx' | 'asset_import_fnt' | 'lumen_sprite_frame';
    /**
     * @description 帧准备完成时冻结的图片身份，供消费者导入后的纯后验使用。
     */
    private readonly _preparedImages = new Map<string, IImportedImageSnapshot>();
    /**
     * @description 接受原端口和预算，不增加锁或重新调度原生请求。
     * @param message 原消息端口。
     * @param timeoutMs 原就绪预算。
     * @param prefix 当前消费者的稳定错误前缀。
     */
    public constructor(message: IAssetImportMessagePort, timeoutMs: number, prefix: 'asset_import_tmx' | 'asset_import_fnt' | 'lumen_sprite_frame') {
        this._message = message;
        this._timeoutMs = timeoutMs;
        this._prefix = prefix;
    }
    /**
     * @description 必需存活父目录刷新及就绪；失败直接传播，不尝试旧消息重放。
     * @param target 已登记存活父目录。
     * @returns 无。
     */
    public async refresh(target: string): Promise<void> {
        await this._message.request('asset-db', 'refresh-asset', target.endsWith('/') ? target : `${target}/`);
        await this.ready();
    }
    /**
     * @description 使用公开 meta 保存、存活父目录刷新及新帧原生重导入规范化，再核验实际主子登记和文件身份。
     * @param projectRoot 原工程根。
     * @param url 已导入 PNG。
     * @param target 存活目标目录。
     * @returns 已核验原生 SpriteFrame UUID。
     */
    public async prepare(projectRoot: string, url: string, target: string): Promise<string> {
        await this.ready();
        const before = await this._snapshot(projectRoot, url);
        let frame = SpriteFrameMetaBuilder.readSpriteFrameUuid(before.meta);
        if (frame != null && frame !== `${before.uuid}@f9941`) { throw new Error(this._prefix + '_frame_owner_invalid'); }
        if (frame == null) {
            const meta = SpriteFrameMetaBuilder.buildNextMeta(before.diskMeta, url, before.bytes);
            frame = SpriteFrameMetaBuilder.readSpriteFrameUuid(meta);
            if (frame == null) { throw new Error(this._prefix + '_frame_meta_invalid'); }
            await this._message.request('asset-db', 'save-asset-meta', url, JSON.stringify(meta, null, 4));
            await this._message.request('asset-db', 'refresh-asset', target.endsWith('/') ? target : `${target}/`);
            await this.ready();
            await this.canonicalizeNewFrame(projectRoot, url, frame);
        }
        await this.ready();
        await this._registeredFrame(frame);
        const after = await this._snapshot(projectRoot, url);
        if (before.uuid !== after.uuid || before.physicalIdentity !== after.physicalIdentity || !before.bytes.equals(after.bytes)) {
            throw new Error(this._prefix + '_image_identity_changed');
        }
        const oldSubs = before.diskMeta.subMetas;
        const newSubs = after.diskMeta.subMetas;
        if (SpriteFrameMetaBuilder.isRecord(oldSubs) && SpriteFrameMetaBuilder.isRecord(newSubs)) {
            for (const [key, old] of Object.entries(oldSubs)) {
                const next = newSubs[key];
                if (!SpriteFrameMetaBuilder.isRecord(old) || !SpriteFrameMetaBuilder.isRecord(next) || old.uuid !== next.uuid) {
                    throw new Error(this._prefix + '_subasset_identity_changed');
                }
            }
        }
        this._preparedImages.set(url, after);
        return frame;
    }

    /**
     * @description 对已保存并就绪的新帧执行一次原生规范化；源身份、完整 meta 语义与真实登记必须保持。
     * @param projectRoot 原工程根。
     * @param url 已保存的新帧图片路径。
     * @param frame 本次保存的精确帧 UUID。
     * @returns 无；必需原生查询与重导入错误直接传播。
     */
    public async canonicalizeNewFrame(projectRoot: string, url: string, frame: string): Promise<void> {
        const pending = await this._snapshot(projectRoot, url);
        if (frame !== `${pending.uuid}@f9941` || SpriteFrameMetaBuilder.readSpriteFrameUuid(pending.meta) !== frame) {
            throw new Error(this._prefix + '_frame_owner_invalid');
        }
        await this._registeredFrame(frame);
        await this._message.request('asset-db', 'reimport-asset', url);
        await this.ready();
        const normalized = await this._snapshot(projectRoot, url);
        if (!isDeepStrictEqual(pending.diskMeta, normalized.diskMeta)) {
            throw new Error(this._prefix + '_native_meta_values_changed');
        }
        if (pending.uuid !== normalized.uuid || pending.physicalIdentity !== normalized.physicalIdentity || !pending.bytes.equals(normalized.bytes)) {
            throw new Error(this._prefix + '_image_identity_changed');
        }
        await this._registeredFrame(frame);
    }

    /**
     * @description 消费者导入后只查询/读盘复核帧与原图片身份，不再保存 meta 或刷新补救。
     * @param projectRoot 原工程根。
     * @param url 已准备图片路径。
     * @param frame 原已核验帧 UUID。
     * @returns 无。
     */
    public async verify(projectRoot: string, url: string, frame: string): Promise<void> {
        const before = this._preparedImages.get(url);
        if (before == null) { throw new Error(this._prefix + '_image_snapshot_missing'); }
        const after = await this._snapshot(projectRoot, url);
        if (before.uuid !== after.uuid || before.physicalIdentity !== after.physicalIdentity || !before.bytes.equals(after.bytes)) {
            throw new Error(this._prefix + '_image_identity_changed');
        }
        const oldSubs = before.diskMeta.subMetas;
        const newSubs = after.diskMeta.subMetas;
        if (!SpriteFrameMetaBuilder.isRecord(oldSubs) || !SpriteFrameMetaBuilder.isRecord(newSubs)) {
            throw new Error(this._prefix + '_subasset_meta_invalid');
        }
        for (const [key, old] of Object.entries(oldSubs)) {
            const next = newSubs[key];
            if (!SpriteFrameMetaBuilder.isRecord(old) || !SpriteFrameMetaBuilder.isRecord(next) || old.uuid !== next.uuid) {
                throw new Error(this._prefix + '_subasset_identity_changed');
            }
        }
        if (SpriteFrameMetaBuilder.readSpriteFrameUuid(after.meta) !== frame) { throw new Error(this._prefix + '_frame_identity_changed'); }
        await this._registeredFrame(frame);
    }

    /**
     * @description 查询真实 PNG 主身份和 meta，冻结普通源文件，不信任 caller UUID。
     * @param projectRoot 工程根。
     * @param url 精确 db 路径。
     * @returns 冻结快照。
     */
    private async _snapshot(projectRoot: string, url: string): Promise<IImportedImageSnapshot> {
        const root = resolve(projectRoot);
        const relative = SpriteFrameMetaBuilder.toProjectRelative(url);
        const file = resolve(join(root, relative));
        if (!file.startsWith(`${root}/assets/`) || realpathSync(root) !== root) { throw new Error(this._prefix + '_project_path_invalid'); }
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== file) {
            throw new Error(this._prefix + '_image_physical_invalid');
        }
        const metaPath = file + '.meta';
        const metaStat = lstatSync(metaPath);
        if (!metaStat.isFile() || metaStat.isSymbolicLink() || metaStat.nlink !== 1 || realpathSync(metaPath) !== metaPath) {
            throw new Error(this._prefix + '_meta_physical_invalid');
        }
        const info = await this._message.request('asset-db', 'query-asset-info', url);
        const meta = await this._message.request('asset-db', 'query-asset-meta', url);
        const diskMeta: unknown = JSON.parse(readFileSync(file + '.meta', 'utf8'));
        if (!SpriteFrameMetaBuilder.isRecord(info) || !SpriteFrameMetaBuilder.isRecord(meta) ||
            !SpriteFrameMetaBuilder.isRecord(diskMeta) || typeof info.uuid !== 'string' || !info.uuid ||
            info.uuid.includes('@') || info.imported !== true || info.invalid === true ||
            info.type !== 'cc.ImageAsset' || meta.importer !== 'image' ||
            info.uuid !== meta.uuid || info.uuid !== diskMeta.uuid || info.url !== url) {
            throw new Error(this._prefix + '_image_registration_invalid');
        }
        this._metaOwners(meta, diskMeta, info.uuid);
        return { url, file, uuid: info.uuid, bytes: readFileSync(file), physicalIdentity: `${stat.dev}:${stat.ino}:${stat.mode}`, meta, diskMeta };
    }

    /**
     * @description 原生与磁盘子资源必须同属主图片，已有子 UUID 不得跨 owner 或相互漂移。
     * @param meta 原生 meta。
     * @param diskMeta 实际磁盘 meta。
     * @param uuid 主 UUID。
     * @returns 无。
     */
    private _metaOwners(meta: Record<string, unknown>, diskMeta: Record<string, unknown>, uuid: string): void {
        if (!SpriteFrameMetaBuilder.isRecord(meta.subMetas) || !SpriteFrameMetaBuilder.isRecord(diskMeta.subMetas)) {
            throw new Error(this._prefix + '_subasset_meta_invalid');
        }
        for (const value of Object.values(diskMeta.subMetas)) {
            if (!SpriteFrameMetaBuilder.isRecord(value) || typeof value.uuid !== 'string' || !value.uuid.startsWith(`${uuid}@`)) {
                throw new Error(this._prefix + '_subasset_owner_invalid');
            }
        }
        for (const [key, value] of Object.entries(meta.subMetas)) {
            const disk = diskMeta.subMetas[key];
            if (!SpriteFrameMetaBuilder.isRecord(value) || !SpriteFrameMetaBuilder.isRecord(disk) ||
                typeof value.uuid !== 'string' || !value.uuid.startsWith(`${uuid}@`) || value.uuid !== disk.uuid) {
                throw new Error(this._prefix + '_subasset_owner_invalid');
            }
        }
    }

    /**
     * @description 只接受真实 SpriteFrame 子 UUID 的正常登记，查询原错误不吞掉。
     * @param uuid 声明的原生子 UUID。
     * @returns 无。
     */
    private async _registeredFrame(uuid: string): Promise<void> {
        const deadline = Date.now() + this._timeoutMs;
        do {
            const info = await this._message.request('asset-db', 'query-asset-info', uuid);
            if (SpriteFrameMetaBuilder.isRecord(info)) {
                if (info.uuid !== uuid || info.type !== 'cc.SpriteFrame' || info.invalid === true) {
                    throw new Error(this._prefix + '_frame_registration_invalid');
                }
                if (info.imported === true) { return; }
            } else if (info !== null) { throw new Error(this._prefix + '_frame_response_invalid'); }
            if (Date.now() < deadline) { await this._delay(); }
        } while (Date.now() < deadline);
        throw new Error(this._prefix + '_frame_not_ready');
    }

    /**
     * @description 必需准备路径只接受明确原生 ready，原查询异常直接传播。
     * @returns 无。
     */
    public async ready(): Promise<void> {
        const deadline = Date.now() + this._timeoutMs;
        do {
            const ready = await this._message.request('asset-db', 'query-ready');
            if (ready === true) { return; }
            if (ready !== false) { throw new Error(this._prefix + '_ready_response_invalid'); }
            if (Date.now() < deadline) { await this._delay(); }
        } while (Date.now() < deadline);
        throw new Error(this._prefix + '_ready_timeout');
    }

    /**
     * @description 在原预算内等待一轮公开登记；固定轮询粒度沿原执行器使用 100ms。
     * @returns 无。
     */
    private async _delay(): Promise<void> {
        await new Promise<void>(complete => { setTimeout(complete, 100); });
    }

}
