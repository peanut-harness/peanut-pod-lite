import type { LumenComponentPropertySchema } from '../schema/component-property';
import type { LumenPrefabDocument } from './prefab-document';

/**
 * @description Mask 图片属性由原生同节点 Sprite 持久化；不把 Mask 的影子字段当成运行时绑定。
 */
export class LumenMaskSpriteFrameBinding {
    /**
     * @description 在已验证版本中先校验整个补丁和所有权，再写入原生 Sprite 载体。
     * @param document 当前内存文档。
     * @param nodePath 节点路径。
     * @param componentType 组件类型。
     * @param patch 完整公开补丁。
     * @param schema 当前版本属性表。
     * @returns 是否已处理该 Mask 补丁；其他组件仍走原流程。
     */
    public static apply(
        document: LumenPrefabDocument,
        nodePath: string,
        componentType: string,
        patch: Readonly<Record<string, unknown>>,
        schema: LumenComponentPropertySchema,
    ): boolean {
        if (componentType !== 'cc.Mask' || !['3.8.3', '3.8.7'].includes(schema.version.toString()) ||
            !Object.prototype.hasOwnProperty.call(patch, 'spriteFrame')) {
            return false;
        }
        const nodeIndex = document.findNodeIndex(nodePath);
        const mask = document.entries[document.findComponentIndex(nodeIndex, componentType)];
        if (mask == null) {
            throw new Error('lumen_mask_sprite_owner_missing');
        }
        const encoded = schema.encodeComponentPatch(componentType, patch, mask);
        let sprite = this._sprite(mask, index => document.entries[index] ?? null);
        const { _spriteFrame: frame, ...maskFields } = encoded;
        if (sprite == null && frame != null) {
            document.attachBuiltinComponent(nodePath, 'cc.Sprite');
            sprite = this._sprite(mask, index => document.entries[index] ?? null);
            if (sprite == null) {
                throw new Error('lumen_mask_sprite_owner_missing');
            }
        }
        if (sprite != null) {
            sprite._spriteFrame = frame;
        }
        Object.assign(mask, maskFields);
        delete mask._spriteFrame;
        return true;
    }

    /**
     * @description 检视沿原生 getter 读取自有 Sprite 字段，其他字段保持原解码来源。
     * @param componentType 组件类型。
     * @param component 当前组件条目。
     * @param field 序列化字段名。
     * @param version 实际属性表版本；未验证版本不外推此持久化映射。
     * @param resolveEntry 文档引用解析器；纯字段 codec 无宿主时保持原行为。
     * @returns 实际载体字段或原字段。
     */
    public static readField(
        componentType: string,
        component: Readonly<Record<string, unknown>>,
        field: string,
        version: string,
        resolveEntry?: (index: number) => Record<string, unknown> | null,
    ): unknown {
        if (componentType !== 'cc.Mask' || field !== '_spriteFrame' || resolveEntry == null ||
            !['3.8.3', '3.8.7'].includes(version)) {
            return component[field];
        }
        return this._sprite(component, resolveEntry)?._spriteFrame ?? null;
    }

    /**
     * @description 仅选择节点组件列表中唯一且 node 引用一致的 Sprite，拒绝外部所有者与歧义。
     * @param mask Mask 条目。
     * @param resolveEntry 文档引用解析器。
     * @returns 唯一自有 Sprite；尚不存在时为 null。
     */
    private static _sprite(
        mask: Readonly<Record<string, unknown>>,
        resolveEntry: (index: number) => Record<string, unknown> | null,
    ): Record<string, unknown> | null {
        const nodeIndex = this._index(mask.node);
        const node = nodeIndex == null ? null : resolveEntry(nodeIndex);
        if (nodeIndex == null || node?.__type__ !== 'cc.Node' || !Array.isArray(node._components)) {
            throw new Error('lumen_mask_sprite_owner_node_invalid');
        }
        const refs = node._components;
        if (!refs.some(ref => {
            const id = this._index(ref);
            return id != null && resolveEntry(id) === mask;
        })) {
            throw new Error('lumen_mask_sprite_owner_mask_unlinked');
        }
        let sprite: Record<string, unknown> | null = null;
        for (const ref of refs) {
            const index = this._index(ref);
            const entry = index == null ? null : resolveEntry(index);
            if (entry?.__type__ !== 'cc.Sprite') {
                continue;
            }
            if (this._index(entry.node) !== nodeIndex) {
                throw new Error('lumen_mask_sprite_owner_foreign');
            }
            if (sprite != null) {
                throw new Error('lumen_mask_sprite_owner_ambiguous');
            }
            sprite = entry;
        }
        return sprite;
    }

    /**
     * @description 读取合法条目索引，不将未知引用形状强转为成功。
     * @param value 原始引用。
     * @returns 非负整数索引或 null。
     */
    private static _index(value: unknown): number | null {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const index = (value as Readonly<Record<string, unknown>>).__id__;
        return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : null;
    }
}
