import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import { LumenJsonAssetIo } from '../io/json-asset';
import { LumenCocosVersion } from '../schema/cocos-version';
import {
    LumenTerrainGrid,
    LUMEN_TERRAIN_MAX_WINDOW_SAMPLES,
    type ILumenTerrainLayoutInspect,
    type ILumenTerrainPeakInspect,
    type ILumenTerrainRegionBox,
} from './terrain-grid';
import {
    LumenTerrainNativeCodec,
    type ILumenTerrainLayerNative,
    type ILumenTerrainNativePayload,
} from './terrain-native-codec';

/**
 * @description 地形图层 Inspector 快照。
 */
export type ILumenTerrainLayerInspect = ILumenTerrainLayerNative;

/**
 * @description Terrain 资产 Inspector 快照（含高度场，不含笔刷）。
 */
export interface ILumenTerrainInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'terrain';
    /** @description 显示名。 */
    readonly name: string;
    /** @description 栅格边长（米）。 */
    readonly tileSize: number;
    /** @description 块数量 `[x, z]`。 */
    readonly blockCount: readonly [number, number];
    /** @description 顶点数量 `[x, z]`。 */
    readonly vertexCount: readonly [number, number];
    /** @description 世界尺寸 `[width, depth]`（米）。 */
    readonly size: readonly [number, number];
    /** @description 权重图边长。 */
    readonly weightMapSize: number;
    /** @description 光照图边长。 */
    readonly lightMapSize: number;
    /** @description 行主序世界高度（米）；超预算或未请求全图时为空。 */
    readonly heights: readonly number[];
    /** @description 全图高度因超过窗口预算被省略。 */
    readonly heightsOmitted: boolean;
    /** @description inspect 域内最低高度。 */
    readonly heightMin: number;
    /** @description inspect 域内最高高度。 */
    readonly heightMax: number;
    /** @description `x = i * tileSize`，`index = j * vertexCount[0] + i`。 */
    readonly layout: ILumenTerrainLayoutInspect;
    /** @description 当前域解析后的顶点盒；全图 inspect 为整幅网格。 */
    readonly region: ILumenTerrainRegionBox;
    /** @description 域内局部峰值，供「指定那座山」对齐。 */
    readonly peaks: readonly ILumenTerrainPeakInspect[];
    /** @description `_layerInfos` 纹理引用。 */
    readonly layerInfos: readonly ILumenTerrainLayerInspect[];
}

const PATCH_KEYS = new Set([
    'name',
    'tileSize',
    'blockCount',
    'weightMapSize',
    'lightMapSize',
    'layerInfos',
    'heights',
    'flatHeight',
    'ramp',
    'region',
    'samples',
]);

/**
 * @description `.terrain` 文档：读写 Creator VERSION8 原生高度场与图层引用（不做笔刷 UI）。
 */
export class LumenTerrainDocument {
    /** @description 读写 JSON 图层与 meta。 */
    private readonly _io = new LumenJsonAssetIo();

    /** @description 项目相对路径。 */
    private readonly _relativePath: string;

    /** @description 当前原生载荷。 */
    private _payload: ILumenTerrainNativePayload;

    /**
     * @description 从原生载荷创建文档。
     * @param relativePath 相对路径
     * @param payload 地形载荷
     */
    public constructor(relativePath: string, payload: ILumenTerrainNativePayload) {
        this._relativePath = relativePath;
        this._payload = payload;
    }

    /**
     * @description 相对项目根路径。
     * @returns 路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 资产种类。
     * @returns `terrain`
     */
    public get kind(): 'terrain' {
        return 'terrain';
    }

    /**
     * @description 创建 1×1 平坦地形（VERSION8 原生源）。
     * @param relativePath 相对路径
     * @param name 名称
     * @param template 仅 `empty`
     * @returns 文档
     */
    public static createEmpty(relativePath: string, name: string, template: string = 'empty'): LumenTerrainDocument {
        if (template !== 'empty') {
            throw new Error(`lumen_terrain_template_unknown:${template}`);
        }
        return new LumenTerrainDocument(
            relativePath,
            LumenTerrainNativeCodec.createFlat(name.trim(), 1, [1, 1], 0),
        );
    }

    /**
     * @description 从磁盘打开 `.terrain`（原生二进制或早期 JSON）。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): LumenTerrainDocument {
        const absolutePath = join(projectRoot, relativePath);
        if (!existsSync(absolutePath)) {
            throw new Error(`lumen_terrain_missing:${relativePath}`);
        }
        const bytes = new Uint8Array(readFileSync(absolutePath));
        const fallbackName = LumenTerrainDocument._nameFromPath(relativePath);
        if (LumenTerrainNativeCodec.looksLikeJson(bytes)) {
            return new LumenTerrainDocument(relativePath, LumenTerrainDocument._fromJsonBytes(bytes, fallbackName));
        }
        return new LumenTerrainDocument(relativePath, LumenTerrainNativeCodec.decode(bytes, fallbackName));
    }

    /**
     * @description 检视公开字段；`query.region` 只返回该窗高度。
     * @param query 可选 `{ region }`
     * @returns 快照
     */
    public inspect(query?: Readonly<Record<string, unknown>>): ILumenTerrainInspect {
        if (query != null) {
            for (const key of Object.keys(query)) {
                if (key !== 'region') {
                    throw new Error(`lumen_asset_query_unsupported:terrain:${key}`);
                }
            }
        }
        const box =
            query != null && query.region !== undefined
                ? LumenTerrainGrid.parseRegion(query.region, this._payload)
                : LumenTerrainGrid.fullBox(this._payload);
        if (query != null && query.region !== undefined) {
            LumenTerrainGrid.assertWindowBudget(box);
        }
        const sampleCount = LumenTerrainGrid.sampleCount(box);
        const omitHeights = query == null || query.region === undefined ? sampleCount > LUMEN_TERRAIN_MAX_WINDOW_SAMPLES : false;
        const heights = omitHeights ? [] : LumenTerrainGrid.readWindow(this._payload, box);
        const [heightMin, heightMax] = omitHeights
            ? this._scanMinMax(box)
            : LumenTerrainGrid.minMax(heights);
        const vertexCount = LumenTerrainNativeCodec.vertexCount(this._payload.blockCount);
        return {
            path: this._relativePath,
            kind: 'terrain',
            name: this._payload.name,
            tileSize: this._payload.tileSize,
            blockCount: [this._payload.blockCount[0], this._payload.blockCount[1]],
            vertexCount,
            size: LumenTerrainNativeCodec.sizeMeters(this._payload.tileSize, this._payload.blockCount),
            weightMapSize: this._payload.weightMapSize,
            lightMapSize: this._payload.lightMapSize,
            heights,
            heightsOmitted: omitHeights,
            heightMin,
            heightMax,
            layout: LumenTerrainGrid.layout(),
            region: box,
            peaks: LumenTerrainGrid.findPeaks(this._payload, box),
            layerInfos: this._payload.layerInfos.map((layer) => ({
                slot: layer.slot,
                tileSize: layer.tileSize,
                roughness: layer.roughness,
                metallic: layer.metallic,
                detailMap: layer.detailMap,
                normalMap: layer.normalMap,
            })),
        };
    }

    /**
     * @description 写入 Inspector 公开补丁。
     * @param patch `name` / `tileSize` / `blockCount` / `layerInfos` / 全图高度源 / `region`+`heights` / `samples`
     */
    public applyPatch(patch: Readonly<Record<string, unknown>>): void {
        for (const key of Object.keys(patch)) {
            if (!PATCH_KEYS.has(key)) {
                throw new Error(
                    `lumen_terrain_property_not_editable:${key}:allowed=${[...PATCH_KEYS].join(',')}`,
                );
            }
        }
        const fullHeightKeys = ['flatHeight', 'ramp'].filter((key) => patch[key] !== undefined);
        if (patch.heights !== undefined && patch.region === undefined) {
            fullHeightKeys.push('heights');
        }
        if (fullHeightKeys.length > 1) {
            throw new Error(`lumen_terrain_height_source_conflict:${fullHeightKeys.join(',')}`);
        }
        if (patch.region !== undefined && patch.heights === undefined) {
            throw new Error('lumen_terrain_region_needs_heights');
        }
        let next: ILumenTerrainNativePayload = {
            name: this._payload.name,
            tileSize: this._payload.tileSize,
            blockCount: [this._payload.blockCount[0], this._payload.blockCount[1]],
            weightMapSize: this._payload.weightMapSize,
            lightMapSize: this._payload.lightMapSize,
            heightCodes: new Uint16Array(this._payload.heightCodes),
            layerInfos: [...this._payload.layerInfos],
        };
        if (patch.name !== undefined) {
            if (typeof patch.name !== 'string') {
                throw new Error('lumen_property_type:name:string');
            }
            next = { ...next, name: patch.name };
        }
        if (patch.tileSize !== undefined) {
            if (typeof patch.tileSize !== 'number' || !Number.isFinite(patch.tileSize) || patch.tileSize <= 0) {
                throw new Error('lumen_property_type:tileSize:number>0');
            }
            next = { ...next, tileSize: Math.floor(patch.tileSize * 100) / 100 };
        }
        if (patch.weightMapSize !== undefined) {
            if (typeof patch.weightMapSize !== 'number') {
                throw new Error('lumen_property_type:weightMapSize:number');
            }
            LumenTerrainNativeCodec.assertMapSize(patch.weightMapSize, 'weightMapSize');
            next = { ...next, weightMapSize: patch.weightMapSize };
        }
        if (patch.lightMapSize !== undefined) {
            if (typeof patch.lightMapSize !== 'number') {
                throw new Error('lumen_property_type:lightMapSize:number');
            }
            LumenTerrainNativeCodec.assertMapSize(patch.lightMapSize, 'lightMapSize');
            next = { ...next, lightMapSize: patch.lightMapSize };
        }
        if (patch.blockCount !== undefined) {
            const blockCount = LumenTerrainDocument._readBlockCount(patch.blockCount);
            const heightCodes = LumenTerrainNativeCodec.resizeHeightCodes(next, blockCount);
            next = { ...next, blockCount, heightCodes };
        }
        if (patch.layerInfos !== undefined) {
            next = { ...next, layerInfos: this._encodeLayers(patch.layerInfos) };
        }
        if (patch.flatHeight !== undefined) {
            next = { ...next, heightCodes: this._fillHeight(next, this._requireNumber(patch.flatHeight, 'flatHeight')) };
        }
        if (patch.heights !== undefined && patch.region === undefined) {
            next = { ...next, heightCodes: this._replaceHeights(next, patch.heights) };
        }
        if (patch.ramp !== undefined) {
            next = { ...next, heightCodes: this._fillRamp(next, patch.ramp) };
        }
        if (patch.region !== undefined) {
            const box = LumenTerrainGrid.parseRegion(patch.region, next);
            if (!Array.isArray(patch.heights)) {
                throw new Error('lumen_property_type:heights:array');
            }
            next = { ...next, heightCodes: LumenTerrainGrid.writeWindow(next, box, patch.heights) };
        }
        if (patch.samples !== undefined) {
            next = { ...next, heightCodes: LumenTerrainGrid.writeSamples(next, patch.samples) };
        }
        this._payload = next;
    }

    /**
     * @description 序列化真实VERSION8二进制，由SDK create-asset分配原生meta。
     * @returns 原始二进制Buffer，不转文本。
     */
    public serializeNativeSource(): Buffer {
        return Buffer.from(LumenTerrainNativeCodec.encode(this._payload));
    }

    /**
     * @description 写回 VERSION8 原生 `.terrain` 与最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        const absolutePath = join(projectRoot, this._relativePath);
        LumenAtomicFileWriter.writeBuffer(absolutePath, LumenTerrainNativeCodec.encode(this._payload));
        if (writeMetaIfMissing) {
            this._io.writeMetaIfMissing(projectRoot, this._relativePath, 'terrain', cocosVersion);
        }
    }

    /**
     * @description 扫描域内高度极值（不分配全图数组）。
     * @param box 顶点盒
     * @returns `[min, max]`
     */
    private _scanMinMax(box: ILumenTerrainRegionBox): [number, number] {
        const [vertexX] = LumenTerrainNativeCodec.vertexCount(this._payload.blockCount);
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let j = box.jMin; j <= box.jMax; j += 1) {
            for (let i = box.iMin; i <= box.iMax; i += 1) {
                const height = LumenTerrainNativeCodec.decodeHeightMeters(this._payload.heightCodes[j * vertexX + i]);
                if (height < min) {
                    min = height;
                }
                if (height > max) {
                    max = height;
                }
            }
        }
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
            return [0, 0];
        }
        return [min, max];
    }

    /**
     * @description 从相对路径取无扩展名文件名。
     * @param relativePath 相对路径
     * @returns 名称
     */
    private static _nameFromPath(relativePath: string): string {
        const slash = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'));
        const base = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
        return base.replace(/\.terrain$/i, '');
    }

    /**
     * @description 解析早期 JSON `.terrain`。
     * @param bytes 文件字节
     * @param fallbackName 回退名
     * @returns 载荷
     */
    private static _fromJsonBytes(bytes: Uint8Array, fallbackName: string): ILumenTerrainNativePayload {
        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
        } catch {
            throw new Error('lumen_terrain_corrupt:json');
        }
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('lumen_terrain_corrupt:json');
        }
        const record = parsed as Record<string, unknown>;
        if (record.__type__ !== 'cc.TerrainAsset') {
            throw new Error('lumen_terrain_corrupt:type');
        }
        const io = new LumenJsonAssetIo();
        const name = typeof record._name === 'string' && record._name.trim().length > 0 ? record._name : fallbackName;
        const payload = LumenTerrainNativeCodec.createFlat(name, 1, [1, 1], 0);
        return {
            ...payload,
            layerInfos: LumenTerrainDocument._readJsonLayers(io, record._layerInfos),
        };
    }

    /**
     * @description 读取 JSON `_layerInfos`。
     * @param io uuid 辅助
     * @param raw `_layerInfos`
     * @returns 图层
     */
    private static _readJsonLayers(io: LumenJsonAssetIo, raw: unknown): ILumenTerrainLayerNative[] {
        if (!Array.isArray(raw)) {
            return [];
        }
        const layers: ILumenTerrainLayerNative[] = [];
        for (const item of raw) {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            layers.push({
                slot: typeof record.slot === 'number' ? record.slot : 0,
                tileSize: typeof record.tileSize === 'number' ? record.tileSize : 1,
                roughness: typeof record.roughness === 'number' ? record.roughness : 1,
                metallic: typeof record.metallic === 'number' ? record.metallic : 0,
                detailMap: io.readUuid(record.detailMap),
                normalMap: io.readUuid(record.normalMap),
            });
        }
        return layers;
    }

    /**
     * @description 解析 `blockCount`。
     * @param value 输入
     * @returns `[x, z]`
     */
    private static _readBlockCount(value: unknown): [number, number] {
        if (!Array.isArray(value) || value.length !== 2) {
            throw new Error('lumen_property_type:blockCount:[int,int]');
        }
        const x = value[0];
        const z = value[1];
        if (typeof x !== 'number' || typeof z !== 'number') {
            throw new Error('lumen_property_type:blockCount:[int,int]');
        }
        const blockCount: [number, number] = [x, z];
        LumenTerrainNativeCodec.assertBlockCount(blockCount);
        return blockCount;
    }

    /**
     * @description 编码图层列表。
     * @param value 公开图层
     * @returns 图层
     */
    private _encodeLayers(value: unknown): ILumenTerrainLayerNative[] {
        if (!Array.isArray(value)) {
            throw new Error('lumen_property_type:layerInfos:array');
        }
        return value.map((item, index) => {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error(`lumen_property_type:layerInfos[${index}]:object`);
            }
            const record = item as Record<string, unknown>;
            const slot = record.slot === undefined ? index : record.slot;
            if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
                throw new Error(`lumen_property_type:layerInfos[${index}].slot:int>=0`);
            }
            return {
                slot,
                tileSize: this._optionalNumber(record.tileSize, 1, `layerInfos[${index}].tileSize`),
                roughness: this._optionalNumber(record.roughness, 1, `layerInfos[${index}].roughness`),
                metallic: this._optionalNumber(record.metallic, 0, `layerInfos[${index}].metallic`),
                detailMap: this._optionalUuid(record.detailMap, `layerInfos[${index}].detailMap`),
                normalMap: this._optionalUuid(record.normalMap, `layerInfos[${index}].normalMap`),
            };
        });
    }

    /**
     * @description 平坦填充。
     * @param payload 当前载荷
     * @param meters 高度
     * @returns 编码
     */
    private _fillHeight(payload: ILumenTerrainNativePayload, meters: number): Uint16Array {
        const codes = new Uint16Array(payload.heightCodes.length);
        codes.fill(LumenTerrainNativeCodec.encodeHeightMeters(meters));
        return codes;
    }

    /**
     * @description 用世界高度数组替换。
     * @param payload 当前载荷
     * @param value 高度数组
     * @returns 编码
     */
    private _replaceHeights(payload: ILumenTerrainNativePayload, value: unknown): Uint16Array {
        if (!Array.isArray(value)) {
            throw new Error('lumen_property_type:heights:array');
        }
        if (value.length !== payload.heightCodes.length) {
            throw new Error(`lumen_terrain_height_count:${value.length}:expected=${payload.heightCodes.length}`);
        }
        const codes = new Uint16Array(value.length);
        for (let i = 0; i < value.length; i += 1) {
            const meters = value[i];
            if (typeof meters !== 'number' || !Number.isFinite(meters)) {
                throw new Error(`lumen_property_type:heights[${i}]:number`);
            }
            codes[i] = LumenTerrainNativeCodec.encodeHeightMeters(meters);
        }
        return codes;
    }

    /**
     * @description 沿 x 或 z 线性坡。
     * @param payload 当前载荷
     * @param value `{ axis, start, end }`
     * @returns 编码
     */
    private _fillRamp(payload: ILumenTerrainNativePayload, value: unknown): Uint16Array {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('lumen_property_type:ramp:object');
        }
        const record = value as Record<string, unknown>;
        const axis = record.axis;
        if (axis !== 'x' && axis !== 'z') {
            throw new Error('lumen_property_type:ramp.axis:x|z');
        }
        const start = this._requireNumber(record.start, 'ramp.start');
        const end = this._requireNumber(record.end, 'ramp.end');
        const [vertexX, vertexZ] = LumenTerrainNativeCodec.vertexCount(payload.blockCount);
        const codes = new Uint16Array(vertexX * vertexZ);
        const lastX = Math.max(vertexX - 1, 1);
        const lastZ = Math.max(vertexZ - 1, 1);
        for (let z = 0; z < vertexZ; z += 1) {
            for (let x = 0; x < vertexX; x += 1) {
                const t = axis === 'x' ? x / lastX : z / lastZ;
                codes[z * vertexX + x] = LumenTerrainNativeCodec.encodeHeightMeters(start + (end - start) * t);
            }
        }
        return codes;
    }

    /**
     * @description 可选数字，缺省回退。
     * @param value 值
     * @param fallback 回退
     * @param apiName 字段名
     * @returns 数字
     */
    private _optionalNumber(value: unknown, fallback: number, apiName: string): number {
        if (value === undefined) {
            return fallback;
        }
        return this._requireNumber(value, apiName);
    }

    /**
     * @description 必填有限数字。
     * @param value 值
     * @param apiName 字段名
     * @returns 数字
     */
    private _requireNumber(value: unknown, apiName: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`lumen_property_type:${apiName}:number`);
        }
        return value;
    }

    /**
     * @description 可选贴图 uuid。
     * @param value uuid 或 `null`
     * @param apiName 字段名
     * @returns uuid 或 `null`
     */
    private _optionalUuid(value: unknown, apiName: string): string | null {
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`lumen_property_type:${apiName}:uuid`);
        }
        return value.trim();
    }
}
