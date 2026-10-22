interface ICreatorCameraNamespace {
    /**
     * @description 获取 Creator 编辑器相机管理器返回的数值快照。
     */
    getCurCameraInfo?: () => unknown;
}

interface ICreatorSceneNode {
    readonly uuid?: string;
    readonly name?: string;
    readonly active?: boolean;
    readonly activeInHierarchy?: boolean;
    readonly children?: readonly ICreatorSceneNode[];
}

interface ICreatorSceneNamespace {
    readonly director?: { getScene?: () => ICreatorSceneNode | null };
}

declare const require: (moduleName: 'cc') => ICreatorSceneNamespace;

declare global {
    var cce: { Camera?: ICreatorCameraNamespace } | undefined;
}

/**
 * @description 在 Creator 场景脚本上下文读取经过筛选的内部相机状态。
 */
class CreatorViewportCameraQuery {
    /**
     * @description 返回经过字段筛选的 Creator 内部相机状态，供视口验证读取。
     * @returns 仅含有限数字的 JSON 相机快照。
     */
    public execute(): Record<string, unknown> {
        const manager = globalThis.cce?.Camera;
        if (manager?.getCurCameraInfo == null) {
            throw new Error('creator_viewport_camera_unavailable');
        }
        const info = manager.getCurCameraInfo();
        if (info == null || typeof info !== 'object') {
            throw new Error('creator_viewport_camera_info_invalid');
        }
        const record = info as Record<string, unknown>;
        return {
            position: this._readVector(record.position, ['x', 'y', 'z']),
            rotation: this._readVector(record.rotation, ['x', 'y', 'z', 'w']),
            viewCenter: this._readVector(record.viewCenter, ['x', 'y', 'z']),
            contentRect: this._readRect(record.contentRect),
            scale: this._readNumber(record.scale),
        };
    }

    /**
     * @description 从 Creator 当前活动场景复制有界、JSON安全的节点路径快照。
     * @returns 当前场景的深度优先节点列表。
     */
    public queryHierarchy(): readonly Record<string, unknown>[] {
        const root = require('cc').director?.getScene?.();
        if (root == null) throw new Error('creator_viewport_scene_unavailable');
        const nodes: Record<string, unknown>[] = [];
        const visit = (node: ICreatorSceneNode, parentPath: string): void => {
            if (nodes.length >= 10000) throw new Error('creator_viewport_scene_too_large');
            const name = typeof node.name === 'string' ? node.name : '';
            const path = parentPath.length === 0 ? name : `${parentPath}/${name}`;
            if (typeof node.uuid === 'string' && node.uuid.length > 0) {
                nodes.push({ uuid: node.uuid, id: node.uuid, name, path, active: node.activeInHierarchy ?? node.active ?? true });
            }
            for (const child of node.children ?? []) visit(child, path);
        };
        visit(root, '');
        return nodes;
    }

    /**
     * @description 复制 Creator 向量字段并拒绝原生对象外溢。
     * @param value Creator 返回值。
     * @param fields 允许复制的坐标字段。
     * @returns 纯数字向量。
     */
    private _readVector(value: unknown, fields: readonly string[]): Record<string, number> {
        if (value == null || typeof value !== 'object') throw new Error('creator_viewport_vector_invalid');
        const record = value as Record<string, unknown>;
        return Object.fromEntries(fields.map((field) => [field, this._readNumber(record[field])]));
    }

    /**
     * @description 复制 Creator 矩形字段并拒绝原生对象外溢。
     * @param value Creator 返回值。
     * @returns 仅含有限数值的矩形。
     */
    private _readRect(value: unknown): Readonly<{ x: number; y: number; width: number; height: number }> {
        if (value == null || typeof value !== 'object') throw new Error('creator_viewport_rect_invalid');
        const record = value as Record<string, unknown>;
        return {
            x: this._readNumber(record.x),
            y: this._readNumber(record.y),
            width: this._readNumber(record.width),
            height: this._readNumber(record.height),
        };
    }

    /**
     * @description 校验有限数值。
     * @param value Creator 返回值。
     * @returns 有限数值。
     */
    private _readNumber(value: unknown): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('creator_viewport_number_invalid');
        return value;
    }
}

const viewportCameraQuery = new CreatorViewportCameraQuery();
export const methods = {
    queryViewportCamera: viewportCameraQuery.execute.bind(viewportCameraQuery),
    queryViewportHierarchy: viewportCameraQuery.queryHierarchy.bind(viewportCameraQuery),
};
