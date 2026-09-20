import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { IAssetBridge } from '../core/creator-adapter.js';
import type { IEditorApiAssetBridgeProvider } from '../core/editor-api-asset-bridge-provider.js';

interface ICocosEditorAssetDbApi {
    request?(target: string, message: string, ...args: unknown[]): Promise<unknown>;
}

interface ICocosEditorSelectionApi {
    select?(type: string, ...ids: string[]): void | Promise<void>;
}

interface ICocosEditorAssetDbGlobal extends Record<string, unknown> {
    readonly Editor?: {
        readonly Message?: ICocosEditorAssetDbApi;
        readonly Project?: {
            readonly path?: string;
        };
        readonly Selection?: ICocosEditorSelectionApi;
    };
}

const SPRITE_FRAME_READY_ATTEMPTS = 40;
const SPRITE_FRAME_READY_DELAY_MS = 250;

/** @description 通过 Creator 3.8 `Editor.Message` 与 `Editor.Selection` 执行真实 Prefab 导出。 */
export class EditorApiHostAssetBridgeProvider implements IEditorApiAssetBridgeProvider {
    /** @description Creator 主进程全局对象。 */
    private readonly _hostGlobal: ICocosEditorAssetDbGlobal;

    /** @description 创建真实 Creator AssetDB provider。 */
    public constructor(hostGlobal?: ICocosEditorAssetDbGlobal) {
        this._hostGlobal = hostGlobal ?? (globalThis as ICocosEditorAssetDbGlobal);
    }

    /** @inheritdoc */
    public isAvailable(): boolean {
        return typeof this._hostGlobal.Editor?.Message?.request === 'function';
    }

    /** @inheritdoc */
    public async queryAsset(pathOrUuid: string): Promise<unknown | null> {
        const request = this._hostGlobal.Editor?.Message?.request;
        if (request == null) {
            return null;
        }
        const dbUrl = toAssetDbUrlOrUuid(pathOrUuid);
        return dbUrl == null ? null : await queryAssetInfo(request, dbUrl);
    }

    /** @inheritdoc */
    public async refreshAsset(pathOrUuid: string): Promise<unknown | null> {
        const request = this._hostGlobal.Editor?.Message?.request;
        if (request == null) {
            return null;
        }
        const dbUrl = toAssetDbUrlOrUuid(pathOrUuid);
        if (dbUrl == null) {
            return null;
        }
        const existingAsset = await queryAssetInfo(request, dbUrl);
        if (existingAsset == null) {
            return null;
        }
        try {
            await request('asset-db', 'refresh-asset', dbUrl);
        } catch {
            return null;
        }
        return await queryAssetInfo(request, dbUrl);
    }

    /** @inheritdoc */
    public async queryAssets(options?: { readonly pattern?: string; readonly importer?: string | readonly string[] }): Promise<readonly unknown[]> {
        const request = this._hostGlobal.Editor?.Message?.request;
        if (request == null) {
            return [];
        }
        try {
            const raw = await request('asset-db', 'query-assets', {
                pattern: options?.pattern ?? 'db://assets/**/*',
                importer: options?.importer,
            });
            if (!Array.isArray(raw)) {
                return [];
            }
            return raw.map((item) => readAssetSnapshot(item));
        } catch {
            return [];
        }
    }

    /** @inheritdoc */
    public async writePrefab(relativePath: string, prefab: readonly Record<string, unknown>[]): Promise<unknown> {
        const dbUrl = toAssetDbUrl(relativePath);
        const request = this._hostGlobal.Editor?.Message?.request;
        if (request == null) {
            throw new Error('cocos_editor_asset_db_api_unavailable');
        }
        const content = JSON.stringify(prefab, null, 4);
        const existingAsset = await queryAssetInfo(request, dbUrl);
        const createdAsset = existingAsset == null
            ? await this._createAssetWithoutOverwritePrompt(request, dbUrl, content)
            : await request('asset-db', 'save-asset', dbUrl, content);
        const refreshedAsset = await request('asset-db', 'refresh-asset', dbUrl);
        const queriedAsset = await queryAssetInfo(request, dbUrl);
        const asset = queriedAsset ?? refreshedAsset ?? createdAsset;
        const uuid = readAssetUuid(asset) ?? readAssetUuid(createdAsset);
        if (uuid != null) {
            await this._hostGlobal.Editor?.Selection?.select?.('asset', uuid);
        }
        return {
            path: relativePath,
            dbUrl,
            asset,
            uuid,
            selected: uuid != null,
        };
    }

    /** @inheritdoc */
    public async writeBinary(relativePath: string, content: Uint8Array, mediaType: 'image/png' | 'image/svg+xml' | 'application/json' | 'font/ttf' | 'font/otf'): Promise<unknown> {
        if (
            (mediaType === 'image/png' && !relativePath.endsWith('.png'))
            || (mediaType === 'image/svg+xml' && !relativePath.endsWith('.svg'))
            || (mediaType === 'application/json' && !relativePath.endsWith('.json'))
            || (mediaType === 'font/ttf' && !relativePath.endsWith('.ttf'))
            || (mediaType === 'font/otf' && !relativePath.endsWith('.otf'))
        ) throw new Error('cocos_binary_media_path_invalid');
        const dbUrl = toAssetDbUrl(relativePath); const request = this._hostGlobal.Editor?.Message?.request; if (request == null) throw new Error('cocos_editor_asset_db_api_unavailable');
        const existingAsset = await queryAssetInfo(request, dbUrl);
        const createdAsset = existingAsset == null
            ? await this._createAssetWithoutOverwritePrompt(request, dbUrl, content)
            : await request('asset-db', 'save-asset', dbUrl, content);
        await request('asset-db', 'refresh-asset', dbUrl);
        let queriedAsset = await queryAssetInfo(request, dbUrl);
        if (mediaType === 'image/png' && readSpriteFrameUuid(queriedAsset) == null) {
            const repaired = await ensureSpriteFrameMeta(request, dbUrl, content, queriedAsset ?? createdAsset);
            if (repaired) {
                await request('asset-db', 'refresh-asset', dbUrl);
            }
            queriedAsset = await waitForSpriteFrameAsset(request, dbUrl);
        }
        const asset = queriedAsset ?? createdAsset;
        return {
            path: relativePath,
            dbUrl,
            asset,
            mediaType,
            byteLength: content.byteLength,
            uuid: readAssetUuid(asset) ?? readAssetUuid(createdAsset),
            spriteFrameUuid: mediaType === 'image/png' ? readSpriteFrameUuid(asset) : null,
        };
    }

    /** @inheritdoc */
    public async deleteAsset(relativePath: string): Promise<void> {
        const dbUrl = toAssetDbUrl(relativePath);
        const request = this._hostGlobal.Editor?.Message?.request;
        if (request == null) {
            throw new Error('cocos_editor_asset_db_api_unavailable');
        }
        await request('asset-db', 'delete-asset', dbUrl);
    }

    /**
     * @description 在 AssetDB 创建前临时移走未登记的磁盘文件与 sidecar，杜绝 Creator 覆盖确认弹窗。
     * @param request Creator AssetDB 消息请求函数。
     * @param dbUrl 已验证的目标 AssetDB URL。
     * @param content 待写入的文本或二进制内容。
     * @returns Creator 的创建结果。
     */
    private async _createAssetWithoutOverwritePrompt(
        request: NonNullable<ICocosEditorAssetDbApi['request']>,
        dbUrl: string,
        content: string | Uint8Array,
    ): Promise<unknown> {
        const projectPath = this._hostGlobal.Editor?.Project?.path;
        if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
            return request('asset-db', 'create-asset', dbUrl, content);
        }
        if (!dbUrl.startsWith('db://assets/')) {
            throw new Error('cocos_editor_asset_path_invalid');
        }
        const segments = dbUrl.slice('db://'.length).split('/');
        if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
            throw new Error('cocos_editor_asset_path_invalid');
        }
        const absolutePath = join(projectPath, ...segments);
        const recoveryDirectory = join(
            projectPath,
            'temp',
            '.@peanut/pod-engine/runtime-asset-recovery',
            randomBytes(16).toString('hex'),
        );
        const orphanPaths = [absolutePath, `${absolutePath}.meta`].filter((candidate) => existsSync(candidate));
        const backups = orphanPaths.map((orphanPath) => ({
            originalPath: orphanPath,
            backupPath: join(recoveryDirectory, orphanPath.endsWith('.meta') ? 'asset.meta' : 'asset'),
        }));
        try {
            if (backups.length > 0) {
                mkdirSync(recoveryDirectory, { recursive: true });
                for (const backup of backups) {
                    renameSync(backup.originalPath, backup.backupPath);
                }
            }
            const result = await request('asset-db', 'create-asset', dbUrl, content);
            rmSync(recoveryDirectory, { recursive: true, force: true });
            return result;
        } catch (error) {
            for (const backup of backups) {
                if (existsSync(backup.backupPath) && !existsSync(backup.originalPath)) {
                    renameSync(backup.backupPath, backup.originalPath);
                }
            }
            rmSync(recoveryDirectory, { recursive: true, force: true });
            throw error;
        }
    }
}

/**
 * @description 等待 Cocos 为 PNG 建立 SpriteFrame 子资源，避免 refresh 后立即查询到半成品元数据。
 * @param request Creator AssetDB 消息请求函数。
 * @param dbUrl 已验证的 AssetDB URL。
 * @returns 包含 SpriteFrame 子资源的资源快照；超时后返回最后一次快照。
 */
async function waitForSpriteFrameAsset(request: NonNullable<ICocosEditorAssetDbApi['request']>, dbUrl: string): Promise<unknown | null> {
    let lastAsset: unknown | null = null;
    for (let attempt = 0; attempt < SPRITE_FRAME_READY_ATTEMPTS; attempt += 1) {
        lastAsset = await queryAssetInfo(request, dbUrl);
        if (readSpriteFrameUuid(lastAsset) != null) {
            return lastAsset;
        }
        if (attempt < SPRITE_FRAME_READY_ATTEMPTS - 1) {
            await delay(SPRITE_FRAME_READY_DELAY_MS);
        }
    }
    return lastAsset;
}

/**
 * @description 等待 AssetDB 异步导入完成。
 * @param milliseconds 等待时长。
 * @returns 等待完成后的 Promise。
 */
function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @description 将已校验的项目资源相对路径转换为 Cocos AssetDB URL。 */
function toAssetDbUrl(relativePath: string): string {
    const normalizedPath = relativePath.trim().replace(/\\/g, '/');
    if (!normalizedPath.startsWith('assets/') || normalizedPath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error('cocos_prefab_path_not_assets_relative');
    }
    return `db://${normalizedPath}`;
}

/**
 * @description 把插件侧的 `pathOrUuid` 归一为 AssetDB 可识别的 db URL 或 UUID 串。
 *
 * `assetRead.query` 既可能传入 `assets/...` 相对路径，也可能传入已解析的子资源 UUID（如 `xxx@f9941`）。
 * 前者校验为 `db://` URL；后者原样透传给 `query-asset-info`，由 Creator 自行解析。
 * @param pathOrUuid 资源相对路径或 UUID。
 * @returns db URL、UUID 或 null（输入不合法时）。
 */
function toAssetDbUrlOrUuid(pathOrUuid: string): string | null {
    const normalized = pathOrUuid.trim();
    if (normalized.length === 0) {
        return null;
    }
    if (normalized.startsWith('assets/')) {
        try {
            return toAssetDbUrl(normalized);
        } catch {
            return null;
        }
    }
    return normalized;
}

/** @description 查询资源信息；旧宿主不支持时不影响已完成的写入和刷新。 */
async function queryAssetInfo(request: NonNullable<ICocosEditorAssetDbApi['request']>, dbUrl: string): Promise<unknown | null> {
    try {
        return await request('asset-db', 'query-asset-info', dbUrl);
    } catch {
        return null;
    }
}

/**
 * @description 查询 PNG 元数据，供缺失 SpriteFrame 子资源时修复。
 * @param request Creator AssetDB 消息请求函数。
 * @param dbUrl 已验证的 AssetDB URL。
 * @returns 资源元数据；旧版宿主不支持时返回 null。
 */
async function queryAssetMeta(request: NonNullable<ICocosEditorAssetDbApi['request']>, dbUrl: string): Promise<Record<string, unknown> | null> {
    try {
        const value = await request('asset-db', 'query-asset-meta', dbUrl);
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * @description 为缺少 SpriteFrame 子资源的 PNG 写入 Cocos 兼容元数据并交由 AssetDB 重建。
 * @param request Creator AssetDB 消息请求函数。
 * @param dbUrl 已验证的 AssetDB URL。
 * @param content 已验证的 PNG 内容。
 * @param asset 已查询的资源快照。
 * @returns 已写入修复元数据时返回 true；缺少可信 image 元数据时返回 false。
 */
async function ensureSpriteFrameMeta(
    request: NonNullable<ICocosEditorAssetDbApi['request']>,
    dbUrl: string,
    content: Uint8Array,
    asset: unknown,
): Promise<boolean> {
    const meta = await queryAssetMeta(request, dbUrl);
    if (readSpriteFrameUuid(meta) != null || readSpriteFrameUuid(asset) != null) {
        return false;
    }
    if (meta == null || meta.importer !== 'image') {
        return false;
    }
    const { width, height } = readPngDimensions(content);
    const imageUuid = readAssetUuid(meta) ?? readAssetUuid(asset) ?? createAssetUuid();
    const imageSubUuid = `${imageUuid}@6c48a`;
    const spriteFrameUuid = `${imageUuid}@f9941`;
    const displayName = dbUrl.slice(dbUrl.lastIndexOf('/') + 1, -'.png'.length);
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const subMetas = meta != null && isRecord(meta.subMetas) ? meta.subMetas : {};
    const userData = meta != null && isRecord(meta.userData) ? meta.userData : {};
    const nextMeta: Record<string, unknown> = {
        ...(meta ?? {}),
        importer: 'image',
        imported: true,
        uuid: imageUuid,
        files: ['.json', '.png'],
        subMetas: {
            ...subMetas,
            f9941: {
                importer: 'sprite-frame',
                uuid: spriteFrameUuid,
                displayName,
                id: 'f9941',
                name: 'spriteFrame',
                userData: {
                    trimType: 'auto', trimThreshold: 1, rotated: false, offsetX: 0, offsetY: 0, trimX: 0, trimY: 0,
                    width, height, rawWidth: width, rawHeight: height, borderTop: 0, borderBottom: 0, borderLeft: 0, borderRight: 0,
                    packable: true, pixelsToUnit: 100, pivotX: 0.5, pivotY: 0.5, meshType: 0,
                    vertices: {
                        rawPosition: [-halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0, -halfWidth, halfHeight, 0, halfWidth, halfHeight, 0],
                        indexes: [0, 1, 2, 2, 1, 3], uv: [0, height, width, height, 0, 0, width, 0], nuv: [0, 0, 1, 0, 0, 1, 1, 1],
                        minPos: [-halfWidth, -halfHeight, 0], maxPos: [halfWidth, halfHeight, 0],
                    },
                    isUuid: true, imageUuidOrDatabaseUri: imageSubUuid, atlasUuid: '',
                },
                ver: '1.0.12',
                imported: true,
                files: ['.json'],
                subMetas: {},
            },
        },
        userData: { ...userData, type: 'sprite-frame', redirect: imageSubUuid },
    };
    await request('asset-db', 'save-asset-meta', dbUrl, JSON.stringify(nextMeta, null, 4));
    return true;
}

/**
 * @description 读取 PNG IHDR 中的像素尺寸，拒绝不完整或非 PNG 的输入。
 * @param content 已验证的 PNG 二进制内容。
 * @returns 图片宽高。
 */
function readPngDimensions(content: Uint8Array): Readonly<{ width: number; height: number }> {
    if (content.byteLength < 24 || content[0] !== 137 || content[1] !== 80 || content[2] !== 78 || content[3] !== 71) {
        throw new Error('cocos_sprite_frame_png_invalid');
    }
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0) {
        throw new Error('cocos_sprite_frame_png_invalid');
    }
    return { width, height };
}

/**
 * @description 创建仅用于缺失 AssetDB 元数据修复的标准 UUID；正常路径始终复用 Creator 已分配 UUID。
 * @returns 可由 Cocos 元数据识别的 UUID 文本。
 */
function createAssetUuid(): string {
    const randomHex = (length: number): string => Math.floor(Math.random() * (16 ** Math.min(length, 8))).toString(16).padStart(length, '0').slice(-length);
    return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-8${randomHex(3)}-${randomHex(8)}${randomHex(4)}`;
}

/** @description 从 Creator AssetDB 响应中提取可选 uuid。 */
function readAssetUuid(value: unknown): string | null {
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.uuid === 'string' && record.uuid.length > 0) {
        return record.uuid;
    }
    return readAssetUuid(record.asset);
}

/** @description Cocos SpriteFrame 子资源的稳定 class id；子资源 UUID 形如 `<imageUuid>@f9941`。 */
const SPRITE_FRAME_SUB_ASSET_CLASS_ID = 'f9941';

/** @description 从 AssetDB PNG 资源信息中提取自动生成的 SpriteFrame 子资源 UUID。 */
function readSpriteFrameUuid(value: unknown): string | null {
    if (typeof value !== 'object' || value == null || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.spriteFrameUuid === 'string' && record.spriteFrameUuid.length > 0) {
        return record.spriteFrameUuid;
    }
    for (const collectionKey of ['subMetas', 'subAssets']) {
        const collection = record[collectionKey];
        if (typeof collection !== 'object' || collection == null || Array.isArray(collection)) {
            continue;
        }
        for (const [key, item] of Object.entries(collection as Record<string, unknown>)) {
            // Creator 的 query-asset-info / 资源 meta 以子资源 class id（如 `f9941`）作为键，
            // 人类可读名放在条目的 `name`/`displayName` 字段；旧版也可能直接以 `spriteFrame` 为键。
            // 三者任一命中即视为 SpriteFrame 子资源，避免只按键名匹配而漏掉 `f9941` 键。
            const uuid = readAssetUuid(item);
            if (uuid != null && uuid.endsWith(`@${SPRITE_FRAME_SUB_ASSET_CLASS_ID}`)) {
                return uuid;
            }
            if (key.toLowerCase().includes('spriteframe') || subAssetDisplayNameContainsSpriteFrame(item)) {
                const resolved = readAssetUuid(item);
                if (resolved != null) {
                    return resolved;
                }
            }
        }
    }
    return readSpriteFrameUuid(record.asset);
}

/**
 * @description 判断子资源条目的人类可读名是否指示 SpriteFrame。
 * @param item AssetDB 子资源条目。
 * @returns `name`/`displayName` 含 spriteframe 时为 true。
 */
function subAssetDisplayNameContainsSpriteFrame(item: unknown): boolean {
    if (!isRecord(item)) {
        return false;
    }
    const name = typeof item.name === 'string' ? item.name : '';
    const displayName = typeof item.displayName === 'string' ? item.displayName : '';
    return name.toLowerCase().includes('spriteframe') || displayName.toLowerCase().includes('spriteframe');
}

/**
 * @description 判断未知值是否为普通记录。
 * @param value 未经信任的输入。
 * @returns 可读取字符串键时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value != null && !Array.isArray(value);
}

/**
 * @description 把 `query-assets` 的原始项归一为 `IAssetReadAssetSnapshot` 形状（含 subAssets 的 uuid/name）。
 * @param value 原始资源项。
 * @returns 归一后的快照；缺 uuid/path 时回退为仅含 uuid 的最小快照。
 */
function readAssetSnapshot(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        return { uuid: '', path: '', importer: '', name: '' };
    }
    const uuid = typeof value.uuid === 'string' ? value.uuid : '';
    const importer = typeof value.importer === 'string' ? value.importer : '';
    const name = typeof value.name === 'string' && value.name.length > 0
        ? value.name
        : typeof value.displayName === 'string'
            ? value.displayName
            : uuid;
    const rawUrl = typeof value.url === 'string' && value.url.length > 0
        ? value.url
        : typeof value.source === 'string'
            ? value.source
            : typeof value.path === 'string'
                ? value.path
                : '';
    const path = rawUrl.startsWith('db://') ? rawUrl.slice('db://'.length) : rawUrl;
    const subAssetsRaw = value.subAssets;
    const subAssets: Record<string, { uuid: string; importer: string; name: string }> = {};
    if (isRecord(subAssetsRaw)) {
        for (const [key, child] of Object.entries(subAssetsRaw)) {
            if (!isRecord(child)) {
                continue;
            }
            subAssets[key] = {
                uuid: typeof child.uuid === 'string' ? child.uuid : '',
                importer: typeof child.importer === 'string' ? child.importer : '',
                name: typeof child.name === 'string' ? child.name : typeof child.displayName === 'string' ? child.displayName : key,
            };
        }
    }
    return {
        uuid,
        path,
        importer,
        name,
        ...(Object.keys(subAssets).length > 0 ? { subAssets } : {}),
    };
}

export type { IAssetBridge };
