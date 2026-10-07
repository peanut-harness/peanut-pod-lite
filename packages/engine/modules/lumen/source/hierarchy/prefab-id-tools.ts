import { CompatibleUuid } from '@peanut/pod-engine/assets';
import { LumenDeepClone } from './deep-clone';

import type { PrefabEntry } from '../types';

/**
 * @description Prefab 序列化数组中 `__id__` 重映射与本地 fileId 生成工具。
 */
export class LumenPrefabIdTools {
    /**
     * @description 按原全局引用扫描清理未引用ClickEvent条目，保持原压缩与重映射语义。
     * @param entries 当前条目数组。
     * @returns 原数组或完成原引用重映射后的数组。
     */
    public static removeUnusedClickEvents(entries: PrefabEntry[]): PrefabEntry[] {
        const referencedClickEventIds = new Set<number>();
        for (const entry of entries) {
            for (const eventRef of Array.isArray(entry.clickEvents) ? entry.clickEvents : []) {
                if (eventRef == null || typeof eventRef !== 'object' || Array.isArray(eventRef)) {
                    continue;
                }
                const id = (eventRef as { __id__?: unknown }).__id__;
                if (typeof id === 'number') {
                    referencedClickEventIds.add(id);
                }
            }
        }
        const staleIds = new Set(
            entries.flatMap((entry, index) => {
                if (entry.__type__ !== 'cc.ClickEvent' || referencedClickEventIds.has(index)) {
                    return [];
                }
                return [index];
            }),
        );
        if (staleIds.size > 0) {
            return this.compactEntries(entries, staleIds).entries;
        }
        return entries;
    }

    /**
     * @description 生成 Prefab 本地 fileId（22 位）。
     * @returns fileId 字符串
     */
    public static createFileId(): string {
        return CompatibleUuid.create().replace(/-/g, '').slice(0, 22);
    }

    /**
     * @description 深拷贝条目并用映射表重写所有 `__id__`。
     * @param entry 原始条目
     * @param idMap 旧下标 → 新下标
     * @returns 重映射后的条目
     */
    public static remapEntry(entry: PrefabEntry, idMap: ReadonlyMap<number, number>): PrefabEntry {
        return this._remapValue(LumenDeepClone.clone(entry), idMap) as PrefabEntry;
    }

    /**
     * @description 批量重映射条目数组中的全部 `__id__` 引用。
     * @param entries 条目列表（原地修改）
     * @param idMap 旧下标 → 新下标
     */
    public static remapEntriesInPlace(entries: PrefabEntry[], idMap: ReadonlyMap<number, number>): void {
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            if (entry == null) {
                continue;
            }
            entries[index] = this.remapEntry(entry, idMap);
        }
    }

    /**
     * @description 从模板条目中剥离 `cc.Prefab` 头，生成可挂到目标文档的子树。
     * @param templateEntries 模板完整数组
     * @param baseIndex 目标文档追加起始下标
     * @returns 重映射后的子树条目与新根下标
     */
    public static cloneSubtreeForEmbed(
        templateEntries: readonly PrefabEntry[],
        baseIndex: number,
    ): { readonly entries: PrefabEntry[]; readonly rootIndex: number } {
        if (templateEntries.length < 2) {
            throw new Error('lumen_template_too_short');
        }
        const hasPrefabHeader = templateEntries[0]?.__type__ === 'cc.Prefab';
        const sourceStart = hasPrefabHeader ? 1 : 0;
        const sourceSlice = templateEntries.slice(sourceStart).map((entry) => LumenDeepClone.clone(entry));
        const idMap = new Map<number, number>();
        idMap.set(0, 0);
        for (let offset = 0; offset < sourceSlice.length; offset += 1) {
            idMap.set(sourceStart + offset, baseIndex + offset);
        }
        const remapped = sourceSlice.map((entry) => this.remapEntry(entry, idMap));
        this.regenerateLocalFileIds(remapped);
        return { entries: remapped, rootIndex: baseIndex };
    }

    /**
     * @description 将嵌入子树解包为普通节点：去掉 Prefab/CompPrefab 实例元数据。
     *
     * 模板里的 `PrefabInfo.asset = { __id__: 0 }` 在挂进 `.scene` 后会错指 `SceneAsset`，
     * 导致编辑器渲染异常（易被当成「雾」）；工程内手工场景节点 `_prefab` 应为 `null`。
     *
     * @param entries 文档全量条目（原地清理引用后可能整体压缩）
     * @param startIndex 本次嵌入起始下标（含）
     * @returns 压缩后的条目数组
     */
    public static unpackEmbeddedPrefabInstances(
        entries: PrefabEntry[],
        startIndex: number,
    ): PrefabEntry[] {
        if (startIndex < 0 || startIndex > entries.length) {
            throw new Error(`lumen_embed_range_invalid:${startIndex}`);
        }
        const remove = new Set<number>();
        for (let index = startIndex; index < entries.length; index += 1) {
            const entry = entries[index];
            if (entry == null || typeof entry !== 'object') {
                continue;
            }
            const typeName = entry.__type__;
            if (typeName === 'cc.PrefabInfo' || typeName === 'cc.CompPrefabInfo') {
                remove.add(index);
                continue;
            }
            if (typeName === 'cc.Node') {
                entry._prefab = null;
            }
            if (Object.prototype.hasOwnProperty.call(entry, '__prefab')) {
                delete entry.__prefab;
            }
        }
        if (remove.size === 0) {
            return entries;
        }
        return this.compactEntries(entries, remove).entries;
    }

    /**
     * @description 为条目树中所有 `fileId` 重新生成唯一本地 id（避免多实例撞号）。
     * @param entries 条目数组（原地修改）
     */
    public static regenerateLocalFileIds(entries: PrefabEntry[]): void {
        const used = new Set<string>();
        for (const entry of entries) {
            if (entry == null || typeof entry !== 'object') {
                continue;
            }
            if (typeof entry.fileId === 'string' && entry.fileId.length > 0) {
                let next = this.createFileId();
                while (used.has(next)) {
                    next = this.createFileId();
                }
                used.add(next);
                entry.fileId = next;
            }
        }
    }

    /**
     * @description 递归收集节点及其后代、组件、CompPrefabInfo、PrefabInfo 下标。
     * @param entries 文档条目
     * @param nodeIndex 起始节点下标
     * @returns 待删除下标集合
     */
    public static collectNodeClosure(entries: readonly PrefabEntry[], nodeIndex: number): Set<number> {
        const collected = new Set<number>();
        this._collectNode(entries, nodeIndex, collected);
        return collected;
    }

    /**
     * @description 删除指定下标后重建连续数组与 id 映射。
     * @param entries 原条目
     * @param removeSet 待删下标
     * @returns 新条目与旧→新映射
     */
    public static compactEntries(
        entries: readonly PrefabEntry[],
        removeSet: ReadonlySet<number>,
    ): { readonly entries: PrefabEntry[]; readonly idMap: Map<number, number> } {
        const idMap = new Map<number, number>();
        const next: PrefabEntry[] = [];
        for (let oldIndex = 0; oldIndex < entries.length; oldIndex += 1) {
            if (removeSet.has(oldIndex)) {
                continue;
            }
            const entry = entries[oldIndex];
            if (entry == null) {
                continue;
            }
            idMap.set(oldIndex, next.length);
            next.push(LumenDeepClone.clone(entry));
        }
        this.remapEntriesInPlace(next, idMap);
        return { entries: next, idMap };
    }

    /**
     * @description 递归重映射任意 JSON 值中的 `__id__`。
     * @param value 任意值
     * @param idMap 映射表
     * @returns 重映射后的值
     */
    private static _remapValue(value: unknown, idMap: ReadonlyMap<number, number>): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this._remapValue(item, idMap));
        }
        if (value == null || typeof value !== 'object') {
            return value;
        }
        const record = value as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(record)) {
            if (key === '__id__' && typeof child === 'number') {
                const mapped = idMap.get(child);
                next[key] = mapped ?? child;
            } else {
                next[key] = this._remapValue(child, idMap);
            }
        }
        return next;
    }

    /**
     * @description 收集单节点闭包。
     * @param entries 条目
     * @param nodeIndex 节点下标
     * @param collected 累加集合
     */
    private static _collectNode(entries: readonly PrefabEntry[], nodeIndex: number, collected: Set<number>): void {
        if (collected.has(nodeIndex)) {
            return;
        }
        const node = entries[nodeIndex];
        if (node == null || node.__type__ !== 'cc.Node') {
            throw new Error(`lumen_not_a_node:${nodeIndex}`);
        }
        collected.add(nodeIndex);
        const prefabRef = node._prefab;
        if (prefabRef != null && typeof prefabRef === 'object') {
            const prefabId = (prefabRef as { __id__?: number }).__id__;
            if (typeof prefabId === 'number') {
                collected.add(prefabId);
            }
        }
        const components = node._components;
        if (Array.isArray(components)) {
            for (const componentRef of components) {
                if (componentRef == null || typeof componentRef !== 'object') {
                    continue;
                }
                const componentId = (componentRef as { __id__?: number }).__id__;
                if (typeof componentId !== 'number') {
                    continue;
                }
                collected.add(componentId);
                const component = entries[componentId];
                const infoRef = component?.__prefab;
                if (infoRef != null && typeof infoRef === 'object') {
                    const infoId = (infoRef as { __id__?: number }).__id__;
                    if (typeof infoId === 'number') {
                        collected.add(infoId);
                    }
                }
            }
        }
        const children = node._children;
        if (Array.isArray(children)) {
            for (const childRef of children) {
                if (childRef == null || typeof childRef !== 'object') {
                    continue;
                }
                const childId = (childRef as { __id__?: number }).__id__;
                if (typeof childId === 'number') {
                    this._collectNode(entries, childId, collected);
                }
            }
        }
    }
}
