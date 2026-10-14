import type { LumenPrefabDocument } from '../../../../packages/engine/modules/lumen/source/hierarchy/prefab-document.ts';

/**
 * @description 独立检查场景的双向节点/组件链接和所有序列化 id，避免保存重开掩盖断链。
 */
export class ComponentSceneIntegrity {
    /**
     * @description 检查实际条目图；允许外部资源 UUID，但不将它们视为原生登记证明。
     * @param document 已装配或重开的场景。
     */
    public static assert(document: LumenPrefabDocument): void {
        const entries = document.entries;
        const id = (value: unknown): number | undefined => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const found = (value as Record<string, unknown>).__id__;
                if (Number.isInteger(found) && typeof found === 'number') return found;
            }
            return undefined;
        };
        const walk = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(walk); return; }
            const record = value as Record<string, unknown>;
            if (Object.hasOwn(record, '__id__')) {
                const target = id(record);
                if (target === undefined || target < 0 || !entries[target]) throw new Error('component_scene_dangling_id');
            }
            Object.values(record).forEach(walk);
        };
        entries.forEach(walk);
        entries.forEach((entry, index) => {
            if (entry.__type__ !== 'cc.Node' && entry.__type__ !== 'cc.Scene') return;
            const children = Array.isArray(entry._children) ? entry._children : [];
            const components = Array.isArray(entry._components) ? entry._components : [];
            const childIds = children.map(id);
            const componentIds = components.map(id);
            if (new Set(childIds).size !== childIds.length || new Set(componentIds).size !== componentIds.length)
                throw new Error('component_scene_duplicate_link');
            for (const childId of childIds) {
                const child = childId === undefined ? undefined : entries[childId];
                if (child?.__type__ !== 'cc.Node' || id(child._parent) !== index) throw new Error('component_scene_child_link_mismatch');
            }
            for (const componentId of componentIds) {
                const component = componentId === undefined ? undefined : entries[componentId];
                if (!component || id(component.node) !== index) throw new Error('component_scene_component_link_mismatch');
            }
            if (entry.__type__ === 'cc.Node') {
                const parentId = id(entry._parent);
                const parent = parentId === undefined ? undefined : entries[parentId];
                if (!parent || !Array.isArray(parent._children) || !parent._children.some((ref) => id(ref) === index))
                    throw new Error('component_scene_parent_link_mismatch');
                const visited = new Set([index]);
                let ancestor: number | undefined = parentId;
                while (ancestor !== undefined) {
                    if (visited.has(ancestor)) throw new Error('component_scene_parent_cycle');
                    visited.add(ancestor); ancestor = id(entries[ancestor]?._parent);
                }
            }
        });
        entries.forEach((entry, index) => {
            if (!Object.hasOwn(entry, 'node')) return;
            const nodeId = id(entry.node);
            const node = nodeId === undefined ? undefined : entries[nodeId];
            if (!node || !Array.isArray(node._components) || !node._components.some((ref) => id(ref) === index))
                throw new Error('component_scene_orphan_component');
        });
    }
}
