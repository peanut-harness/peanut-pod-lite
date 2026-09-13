import { TerrainBuffer } from './terrain-buffer';

/**
 * @description 引擎 `TERRAIN_BLOCK_TILE_COMPLEXITY`：每块 32 格。
 */
export const LUMEN_TERRAIN_BLOCK_TILE_COMPLEXITY = 32;

/**
 * @description 引擎 `TERRAIN_MAX_BLEND_LAYERS`。
 */
const TERRAIN_MAX_BLEND_LAYERS = 4;

/**
 * @description 高度编码原点（对应世界高度 0）。
 */
const TERRAIN_HEIGHT_BASE = 32768;

/**
 * @description VERSION8 高度缩放：世界米 = (code - BASE) * FACTORY。
 */
const TERRAIN_HEIGHT_FACTORY = 1 / 128;

/**
 * @description VERSION7 及更早高度缩放。
 */
const TERRAIN_HEIGHT_FACTORY_V7 = 1 / 512;

/**
 * @description 世界高度下限（米）。
 */
const TERRAIN_HEIGHT_FMIN = -TERRAIN_HEIGHT_BASE * TERRAIN_HEIGHT_FACTORY;

/**
 * @description 世界高度上限（米）。
 */
const TERRAIN_HEIGHT_FMAX = (65535 - TERRAIN_HEIGHT_BASE) * TERRAIN_HEIGHT_FACTORY;

/**
 * @description Creator 3.8 地形源格式 VERSION8。
 */
const TERRAIN_DATA_VERSION8 = 0x01010008;

/**
 * @description 空地形占位版本（仅 4 字节版本号）。
 */
const TERRAIN_DATA_VERSION_DEFAULT = 0x01010111;

/**
 * @description 可解码的历史版本。
 */
const TERRAIN_DATA_VERSIONS: readonly number[] = [
    0x01010001, 0x01010002, 0x01010003, 0x01010004, 0x01010005, 0x01010006, 0x01010007, TERRAIN_DATA_VERSION8,
];

/**
 * @description 单块轴向上限，避免误写出超大权重图。
 */
const MAX_BLOCK_COUNT = 16;

/**
 * @description 地形图层（原生缓冲中的 uuid 字符串）。
 */
export interface ILumenTerrainLayerNative {
    /** @description 槽位。 */
    readonly slot: number;
    /** @description 图层 tiling。 */
    readonly tileSize: number;
    /** @description 粗糙度。 */
    readonly roughness: number;
    /** @description 金属度。 */
    readonly metallic: number;
    /** @description 细节贴图 uuid。 */
    readonly detailMap: string | null;
    /** @description 法线贴图 uuid。 */
    readonly normalMap: string | null;
}

/**
 * @description 内存中的地形几何与图层（高度为 Uint16 编码）。
 */
export interface ILumenTerrainNativePayload {
    /** @description `_name` 或文件名。 */
    readonly name: string;
    /** @description 栅格边长（米）。 */
    readonly tileSize: number;
    /** @description 块数量 `[x, z]`。 */
    readonly blockCount: readonly [number, number];
    /** @description 权重图边长。 */
    readonly weightMapSize: number;
    /** @description 光照图边长。 */
    readonly lightMapSize: number;
    /** @description 行主序高度编码。 */
    readonly heightCodes: Uint16Array;
    /** @description 图层纹理引用。 */
    readonly layerInfos: readonly ILumenTerrainLayerNative[];
}


/**
 * @description Creator `.terrain` 原生缓冲编解码（对照 `TerrainAsset._exportNativeData`）。
 */
export class LumenTerrainNativeCodec {
    /**
     * @description 每块顶点数（格数 + 1）。
     * @param blockCount 块数量
     * @returns `[vx, vz]`
     */
    public static vertexCount(blockCount: readonly [number, number]): [number, number] {
        return [
            blockCount[0] * LUMEN_TERRAIN_BLOCK_TILE_COMPLEXITY + 1,
            blockCount[1] * LUMEN_TERRAIN_BLOCK_TILE_COMPLEXITY + 1,
        ];
    }

    /**
     * @description 世界尺寸（米）。
     * @param tileSize 栅格边长
     * @param blockCount 块数量
     * @returns `[width, depth]`
     */
    public static sizeMeters(tileSize: number, blockCount: readonly [number, number]): [number, number] {
        return [
            blockCount[0] * LUMEN_TERRAIN_BLOCK_TILE_COMPLEXITY * tileSize,
            blockCount[1] * LUMEN_TERRAIN_BLOCK_TILE_COMPLEXITY * tileSize,
        ];
    }

    /**
     * @description 世界高度编码为 Uint16。
     * @param meters 米
     * @returns 编码
     */
    public static encodeHeightMeters(meters: number): number {
        const clamped = Math.min(TERRAIN_HEIGHT_FMAX, Math.max(TERRAIN_HEIGHT_FMIN, meters));
        const codes = new Uint16Array(1);
        codes[0] = TERRAIN_HEIGHT_BASE + clamped / TERRAIN_HEIGHT_FACTORY;
        return codes[0];
    }

    /**
     * @description Uint16 高度解码为米。
     * @param code 编码
     * @returns 米
     */
    public static decodeHeightMeters(code: number): number {
        return (code - TERRAIN_HEIGHT_BASE) * TERRAIN_HEIGHT_FACTORY;
    }

    /**
     * @description 判断源文件是否为 Lumen 早期 JSON `.terrain`。
     * @param bytes 文件字节
     * @returns 是否 JSON 对象
     */
    public static looksLikeJson(bytes: Uint8Array): boolean {
        let index = 0;
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
            index = 3;
        }
        while (index < bytes.length) {
            const code = bytes[index];
            if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
                index += 1;
                continue;
            }
            return code === 0x7b;
        }
        return false;
    }

    /**
     * @description 创建平坦高度场。
     * @param name 名称
     * @param tileSize 栅格边长
     * @param blockCount 块数量
     * @param heightMeters 平坦高度
     * @param weightMapSize 权重图边长
     * @param lightMapSize 光照图边长
     * @returns 载荷
     */
    public static createFlat(
        name: string,
        tileSize: number,
        blockCount: readonly [number, number],
        heightMeters: number,
        weightMapSize: number = 128,
        lightMapSize: number = 128,
    ): ILumenTerrainNativePayload {
        LumenTerrainNativeCodec.assertBlockCount(blockCount);
        LumenTerrainNativeCodec.assertMapSize(weightMapSize, 'weightMapSize');
        LumenTerrainNativeCodec.assertMapSize(lightMapSize, 'lightMapSize');
        const [vertexX, vertexZ] = LumenTerrainNativeCodec.vertexCount(blockCount);
        const heightCodes = new Uint16Array(vertexX * vertexZ);
        const code = LumenTerrainNativeCodec.encodeHeightMeters(heightMeters);
        heightCodes.fill(code);
        return {
            name,
            tileSize,
            blockCount: [blockCount[0], blockCount[1]],
            weightMapSize,
            lightMapSize,
            heightCodes,
            layerInfos: [],
        };
    }

    /**
     * @description 块数变化时拷贝重叠高度，其余填 0。
     * @param payload 原载荷
     * @param nextBlockCount 新块数
     * @returns 新高度编码
     */
    public static resizeHeightCodes(
        payload: ILumenTerrainNativePayload,
        nextBlockCount: readonly [number, number],
    ): Uint16Array {
        LumenTerrainNativeCodec.assertBlockCount(nextBlockCount);
        const [oldX, oldZ] = LumenTerrainNativeCodec.vertexCount(payload.blockCount);
        const [nextX, nextZ] = LumenTerrainNativeCodec.vertexCount(nextBlockCount);
        const next = new Uint16Array(nextX * nextZ);
        next.fill(TERRAIN_HEIGHT_BASE);
        const copyX = Math.min(oldX, nextX);
        const copyZ = Math.min(oldZ, nextZ);
        for (let z = 0; z < copyZ; z += 1) {
            for (let x = 0; x < copyX; x += 1) {
                next[z * nextX + x] = payload.heightCodes[z * oldX + x];
            }
        }
        return next;
    }

    /**
     * @description 校验块数。
     * @param blockCount `[x, z]`
     */
    public static assertBlockCount(blockCount: readonly [number, number]): void {
        for (let axis = 0; axis < 2; axis += 1) {
            const value = blockCount[axis];
            if (!Number.isInteger(value) || value < 1 || value > MAX_BLOCK_COUNT) {
                throw new Error(`lumen_property_type:blockCount[${axis}]:int 1..${MAX_BLOCK_COUNT}`);
            }
        }
    }

    /**
     * @description 校验权重/光照图边长。
     * @param value 边长
     * @param apiName 字段名
     */
    public static assertMapSize(value: number, apiName: string): void {
        if (!Number.isInteger(value) || value < 8 || value > 512) {
            throw new Error(`lumen_property_type:${apiName}:int 8..512`);
        }
    }

    /**
     * @description 编码为 VERSION8 原生 `.terrain`。
     * @param payload 载荷
     * @returns 文件字节
     */
    public static encode(payload: ILumenTerrainNativePayload): Uint8Array {
        LumenTerrainNativeCodec.assertBlockCount(payload.blockCount);
        const [vertexX, vertexZ] = LumenTerrainNativeCodec.vertexCount(payload.blockCount);
        if (payload.heightCodes.length !== vertexX * vertexZ) {
            throw new Error(`lumen_terrain_height_count:${payload.heightCodes.length}:expected=${vertexX * vertexZ}`);
        }
        const stream = new TerrainBuffer();
        stream.writeInt32(TERRAIN_DATA_VERSION8);
        stream.writeDouble(payload.tileSize);
        stream.writeIntArray([payload.blockCount[0], payload.blockCount[1]]);
        stream.writeInt16(payload.weightMapSize);
        stream.writeInt16(payload.lightMapSize);

        stream.writeInt32(payload.heightCodes.length);
        for (let i = 0; i < payload.heightCodes.length; i += 1) {
            stream.writeInt16(payload.heightCodes[i]);
        }

        const normals = LumenTerrainNativeCodec._buildNormals(payload);
        stream.writeInt32(normals.length);
        for (let i = 0; i < normals.length; i += 1) {
            stream.writeFloat(normals[i]);
        }

        const weights = LumenTerrainNativeCodec._buildWeights(payload);
        stream.writeInt32(weights.length);
        for (let i = 0; i < weights.length; i += 1) {
            stream.writeInt8(weights[i]);
        }

        const layerBuffer = LumenTerrainNativeCodec._buildLayerBuffer(payload);
        stream.writeInt32(layerBuffer.length);
        for (let i = 0; i < layerBuffer.length; i += 1) {
            stream.writeInt16(layerBuffer[i]);
        }

        stream.writeInt32(payload.layerInfos.length);
        for (let i = 0; i < payload.layerInfos.length; i += 1) {
            const layer = payload.layerInfos[i];
            stream.writeInt32(layer.slot);
            stream.writeDouble(layer.tileSize);
            stream.writeString(layer.detailMap ?? '');
            stream.writeString(layer.normalMap ?? '');
            stream.writeDouble(layer.roughness);
            stream.writeDouble(layer.metallic);
        }

        return stream.buffer.slice(0, stream.length);
    }

    /**
     * @description 解码原生缓冲或 VERSION_DEFAULT 空占位。
     * @param bytes 文件字节
     * @param name 回退名称
     * @returns 载荷
     */
    public static decode(bytes: Uint8Array, name: string): ILumenTerrainNativePayload {
        if (bytes.length < 4) {
            throw new Error('lumen_terrain_corrupt:too_short');
        }
        const stream = new TerrainBuffer();
        stream.assign(bytes);
        let version = 0;
        try {
            version = stream.readInt();
        } catch {
            throw new Error('lumen_terrain_corrupt:version');
        }
        if (version === TERRAIN_DATA_VERSION_DEFAULT) {
            return LumenTerrainNativeCodec.createFlat(name, 1, [1, 1], 0);
        }
        if (!TERRAIN_DATA_VERSIONS.includes(version)) {
            throw new Error(`lumen_terrain_corrupt:version:${version}`);
        }
        try {
            return LumenTerrainNativeCodec._decodeBody(stream, version, name);
        } catch (error) {
            if (error instanceof Error && error.message.startsWith('lumen_')) {
                throw error;
            }
            throw new Error('lumen_terrain_corrupt:body');
        }
    }

    /**
     * @description 解码几何与图层。
     * @param stream 缓冲
     * @param version 版本
     * @param name 名称
     * @returns 载荷
     */
    private static _decodeBody(stream: TerrainBuffer, version: number, name: string): ILumenTerrainNativePayload {
        const version7 = 0x01010007;
        const version6 = 0x01010006;
        const version3 = 0x01010003;
        const version2 = 0x01010002;
        const version4 = 0x01010004;
        let tileSize = 1;
        if (version >= version7) {
            tileSize = stream.readDouble();
        } else {
            tileSize = stream.readFloat();
        }
        tileSize = Math.floor(tileSize * 100) / 100;
        const blockCountRaw = [1, 1];
        stream.readIntArray(blockCountRaw);
        const blockCount: [number, number] = [blockCountRaw[0], blockCountRaw[1]];
        LumenTerrainNativeCodec.assertBlockCount(blockCount);
        const weightMapSize = stream.readInt16();
        const lightMapSize = stream.readInt16();
        LumenTerrainNativeCodec.assertMapSize(weightMapSize, 'weightMapSize');
        LumenTerrainNativeCodec.assertMapSize(lightMapSize, 'lightMapSize');

        const heightBufferSize = stream.readInt();
        const [vertexX, vertexZ] = LumenTerrainNativeCodec.vertexCount(blockCount);
        const expectedHeights = vertexX * vertexZ;
        if (heightBufferSize !== expectedHeights) {
            throw new Error(`lumen_terrain_corrupt:height_count:${heightBufferSize}:expected=${expectedHeights}`);
        }
        const heightCodes = new Uint16Array(heightBufferSize);
        for (let i = 0; i < heightCodes.length; i += 1) {
            heightCodes[i] = stream.readInt16();
        }
        if (version < TERRAIN_DATA_VERSION8) {
            for (let i = 0; i < heightCodes.length; i += 1) {
                const meters = (heightCodes[i] - TERRAIN_HEIGHT_BASE) * TERRAIN_HEIGHT_FACTORY_V7;
                heightCodes[i] = TERRAIN_HEIGHT_BASE + meters / TERRAIN_HEIGHT_FACTORY;
            }
        }

        if (version >= version6) {
            const normalBufferSize = stream.readInt();
            for (let i = 0; i < normalBufferSize; i += 1) {
                stream.readFloat();
            }
        }

        const weightBufferSize = stream.readInt();
        for (let i = 0; i < weightBufferSize; i += 1) {
            stream.readInt8();
        }

        if (version >= version2) {
            const layerBufferSize = stream.readInt();
            for (let i = 0; i < layerBufferSize; i += 1) {
                stream.readInt16();
            }
        }

        const layerInfos: ILumenTerrainLayerNative[] = [];
        if (version >= version3) {
            const layerInfoSize = stream.readInt();
            for (let i = 0; i < layerInfoSize; i += 1) {
                const slot = stream.readInt();
                const layerTileSize = version >= version7 ? stream.readDouble() : stream.readFloat();
                const detailMapId = stream.readString();
                let normalMapId = '';
                let roughness = 1;
                let metallic = 0;
                if (version >= version4) {
                    normalMapId = stream.readString();
                    if (version >= version7) {
                        roughness = stream.readDouble();
                        metallic = stream.readDouble();
                    } else {
                        roughness = stream.readFloat();
                        metallic = stream.readFloat();
                    }
                }
                layerInfos.push({
                    slot,
                    tileSize: layerTileSize,
                    roughness,
                    metallic,
                    detailMap: detailMapId.length > 0 ? detailMapId : null,
                    normalMap: normalMapId.length > 0 ? normalMapId : null,
                });
            }
        }

        return {
            name,
            tileSize,
            blockCount,
            weightMapSize,
            lightMapSize,
            heightCodes,
            layerInfos,
        };
    }

    /**
     * @description 按邻格叉积重建法线。
     * @param payload 载荷
     * @returns `xyz` 交错
     */
    private static _buildNormals(payload: ILumenTerrainNativePayload): Float32Array {
        const [vertexX, vertexZ] = LumenTerrainNativeCodec.vertexCount(payload.blockCount);
        const normals = new Float32Array(vertexX * vertexZ * 3);
        const heightAt = (x: number, z: number): number => {
            return LumenTerrainNativeCodec.decodeHeightMeters(payload.heightCodes[z * vertexX + x]);
        };
        const position = (x: number, z: number): [number, number, number] => {
            return [x * payload.tileSize, heightAt(x, z), z * payload.tileSize];
        };
        let index = 0;
        for (let z = 0; z < vertexZ; z += 1) {
            for (let x = 0; x < vertexX; x += 1) {
                let flip = 1;
                const here = position(x, z);
                let right: [number, number, number];
                if (x < vertexX - 1) {
                    right = position(x + 1, z);
                } else {
                    flip *= -1;
                    right = position(x - 1, z);
                }
                let up: [number, number, number];
                if (z < vertexZ - 1) {
                    up = position(x, z + 1);
                } else {
                    flip *= -1;
                    up = position(x, z - 1);
                }
                const rx = right[0] - here[0];
                const ry = right[1] - here[1];
                const rz = right[2] - here[2];
                const ux = up[0] - here[0];
                const uy = up[1] - here[1];
                const uz = up[2] - here[2];
                let nx = (uy * rz - uz * ry) * flip;
                let ny = (uz * rx - ux * rz) * flip;
                let nz = (ux * ry - uy * rx) * flip;
                const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (length > 0) {
                    nx /= length;
                    ny /= length;
                    nz /= length;
                } else {
                    nx = 0;
                    ny = 1;
                    nz = 0;
                }
                normals[index * 3] = nx;
                normals[index * 3 + 1] = ny;
                normals[index * 3 + 2] = nz;
                index += 1;
            }
        }
        return normals;
    }

    /**
     * @description 默认权重：全部落到图层 0。
     * @param payload 载荷
     * @returns RGBA 字节
     */
    private static _buildWeights(payload: ILumenTerrainNativePayload): Uint8Array {
        const width = payload.weightMapSize * payload.blockCount[0];
        const height = payload.weightMapSize * payload.blockCount[1];
        const weights = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i += 1) {
            weights[i * 4] = 255;
            weights[i * 4 + 1] = 0;
            weights[i * 4 + 2] = 0;
            weights[i * 4 + 3] = 0;
        }
        return weights;
    }

    /**
     * @description 每块 4 个图层槽；有对应 slot 的图层则填槽位否则 -1。
     * @param payload 载荷
     * @returns 图层索引缓冲
     */
    private static _buildLayerBuffer(payload: ILumenTerrainNativePayload): number[] {
        const slots = new Set(payload.layerInfos.map((layer) => layer.slot));
        const blockTotal = payload.blockCount[0] * payload.blockCount[1];
        const buffer: number[] = [];
        for (let i = 0; i < blockTotal; i += 1) {
            for (let layer = 0; layer < TERRAIN_MAX_BLEND_LAYERS; layer += 1) {
                buffer.push(slots.has(layer) ? layer : -1);
            }
        }
        return buffer;
    }
}
