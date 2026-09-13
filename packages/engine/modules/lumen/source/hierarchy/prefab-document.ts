import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import { CompatibleUuid, SilentAssetCreateFolder } from '@peanut/pod-engine/assets';
import { LumenDeepClone } from './deep-clone';
import { LumenAtomicFileWriter } from '../io/atomic-file-writer';
import {
    LumenComponentPropertySchema,
    type ILumenEmbeddedEntryHost,
} from '../schema/component-property';
import { LumenCocosVersion } from '../schema/cocos-version';
import { LumenMetaImporterVersions } from '../schema/meta-importer-versions';
import { LumenHierarchyEntry, type LumenAssetKind } from './entry';
import { LumenNodeConventions, LumenNodeLayer } from '../schema/node-conventions';
import { LumenPrefabIdTools } from './prefab-id-tools';
import { LumenPrefabDocumentSource } from './prefab-document-source';
import type { ILumenNodeRecipe, ILumenNodeSpec, PrefabEntry } from '../types';

export type { PrefabEntry } from '../types';

/**
 * @description 内存中的 Prefab / Scene 文档，负责结构脚手架、节点/组件 CRUD 与引用写入。
 */
export class LumenPrefabDocument {
    /**
     * @description 文档初始条目与模板文件来源。
     */
    private static readonly _source = new LumenPrefabDocumentSource();

    /** @description 序列化条目数组。 */
    private _entries: PrefabEntry[];

    /** @description 相对项目根的 prefab 路径。 */
    private readonly _relativePath: string;

    /** @description 按 Creator 版本门控的属性表。 */
    private _propertySchema: LumenComponentPropertySchema;

    /**
     * @description 从已有条目创建文档。
     * @param relativePath 相对项目根路径
     * @param entries prefab 数组
     * @param propertySchema 可选属性表；缺省按默认 Creator 版本
     */
    public constructor(
        relativePath: string,
        entries: PrefabEntry[],
        propertySchema: LumenComponentPropertySchema = new LumenComponentPropertySchema(),
    ) {
        this._relativePath = relativePath;
        this._entries = entries;
        this._propertySchema = propertySchema;
    }

    /**
     * @description 绑定会话级属性表（按项目 Cocos 版本）。
     * @param propertySchema 属性表
     */
    public setPropertySchema(propertySchema: LumenComponentPropertySchema): void {
        this._propertySchema = propertySchema;
    }

    /**
     * @description 相对项目根路径。
     * @returns 路径字符串
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 当前打开文档是 Prefab 还是 Scene。
     * @returns `prefab` 或 `scene`
     */
    public get assetKind(): LumenAssetKind {
        return LumenHierarchyEntry.assetKindFromHeader(this._entries[0]);
    }

    /**
     * @description 当前条目快照。
     * @returns 只读条目列表
     */
    public get entries(): readonly PrefabEntry[] {
        return this._entries;
    }

    /**
     * @description 创建仅含根节点与 UITransform 的空壳 prefab。
     * @param relativePath 相对路径
     * @param rootName 根节点名
     * @returns 文档实例
     */
    public static createEmpty(relativePath: string, rootName: string): LumenPrefabDocument {
        return new LumenPrefabDocument(relativePath, LumenPrefabDocument._source.createEmptyPrefabEntries(rootName));
    }

    /**
     * @description 创建仅含场景根与默认 SceneGlobals 的空 `.scene`。
     * @param relativePath 相对路径（应 `.scene`）
     * @param rootName 场景根名
     * @returns 文档实例
     */
    public static createEmptyScene(relativePath: string, rootName: string): LumenPrefabDocument {
        return new LumenPrefabDocument(relativePath, LumenPrefabDocument._source.createEmptySceneEntries(rootName));
    }

    /**
     * @description 从磁盘模板克隆（如 default_prefab/ui/Label.prefab）。
     * @param relativePath 目标相对路径
     * @param templateAbsolutePath 模板绝对路径
     * @param rootName 可选重命名根节点
     * @returns 文档实例
     */
    public static cloneFromTemplate(
        relativePath: string,
        templateAbsolutePath: string,
        rootName?: string,
    ): LumenPrefabDocument {
        return new LumenPrefabDocument(
            relativePath,
            LumenPrefabDocument._source.cloneTemplateEntries(templateAbsolutePath, rootName),
        );
    }

    /**
     * @description 从项目磁盘打开 prefab 或 scene。
     * @param projectRoot 项目根
     * @param relativePath 相对路径
     * @returns 文档实例
     */
    public static open(projectRoot: string, relativePath: string): LumenPrefabDocument {
        return new LumenPrefabDocument(relativePath, LumenPrefabDocument._source.readEntries(projectRoot, relativePath));
    }

    /**
     * @description 按路径查找节点条目下标（`/` 分段，首段可省略）。
     * @param nodePath 如 `/Demo/Button` 或 `Demo/Button`
     * @returns 节点在 entries 中的下标
     */
    public findNodeIndex(nodePath: string): number {
        const parts = nodePath.split('/').filter((part) => part.length > 0);
        if (parts.length === 0) {
            throw new Error('lumen_node_path_empty');
        }
        let currentIndex = LumenHierarchyEntry.rootIndex(this._entries);
        const root = this._entries[currentIndex];
        if (!LumenHierarchyEntry.isNodeOrScene(root)) {
            throw new Error('lumen_root_node_missing');
        }
        // Agent 常把文件名/脚手架名当路径首段；与真实根名不一致时按真实根名重映射。
        // 但若首段已是根下真实子节点（常见：Scene 根名被 scaffold 成 Canvas，
        // 配方却写 /CompositeProbe/pager），绝不能把 CompositeProbe 改写成 Canvas，
        // 否则会变成 Canvas/pager → lumen_child_missing。
        // 保留真实子节点作首段时，遍历必须从 depth 0 开始走进该子节点。
        let startDepth = 1;
        if (root._name !== parts[0]) {
            const realChild = this._findDirectChildIndex(currentIndex, parts[0]);
            if (realChild == null) {
                parts[0] = String(root._name);
            } else {
                startDepth = 0;
            }
        }
        for (let depth = startDepth; depth < parts.length; depth += 1) {
            const node = this._entries[currentIndex];
            if (!LumenHierarchyEntry.isNodeOrScene(node)) {
                throw new Error(`lumen_node_missing:${parts.slice(0, depth).join('/')}`);
            }
            const children = node._children;
            if (!Array.isArray(children)) {
                throw new Error(`lumen_children_missing:${parts.slice(0, depth).join('/')}`);
            }
            const childName = parts[depth];
            const nextIndex = this._findDirectChildIndex(currentIndex, childName);
            if (nextIndex == null) {
                throw new Error(`lumen_child_missing:${parts.slice(0, depth + 1).join('/')}`);
            }
            currentIndex = nextIndex;
        }
        return currentIndex;
    }

    /**
     * @description 在父节点直接子级中按名查找节点下标。
     * @param parentIndex 父节点下标
     * @param childName 子节点名
     * @returns 子节点下标；未找到返回 null
     */
    private _findDirectChildIndex(parentIndex: number, childName: string): number | null {
        const node = this._entries[parentIndex];
        if (!LumenHierarchyEntry.isNodeOrScene(node)) {
            return null;
        }
        const children = node._children;
        if (!Array.isArray(children)) {
            return null;
        }
        for (const childRef of children) {
            if (childRef == null || typeof childRef !== 'object') {
                continue;
            }
            const childId = (childRef as { __id__?: number }).__id__;
            if (typeof childId !== 'number') {
                continue;
            }
            const childNode = this._entries[childId];
            if (LumenHierarchyEntry.isNode(childNode) && childNode._name === childName) {
                return childId;
            }
        }
        return null;
    }

    /**
     * @description 在指定节点上查找组件下标。
     * @param nodeIndex 节点下标
     * @param componentType 组件 `__type__`
     * @returns 组件下标
     */
    public findComponentIndex(nodeIndex: number, componentType: string): number {
        const node = this._entries[nodeIndex];
        if (node == null || node.__type__ !== 'cc.Node') {
            throw new Error(`lumen_not_a_node:${nodeIndex}`);
        }
        const components = node._components;
        if (!Array.isArray(components)) {
            throw new Error(`lumen_components_missing:${nodeIndex}`);
        }
        for (const componentRef of components) {
            if (componentRef == null || typeof componentRef !== 'object') {
                continue;
            }
            const componentId = (componentRef as { __id__?: number }).__id__;
            if (typeof componentId !== 'number') {
                continue;
            }
            const component = this._entries[componentId];
            if (component?.__type__ === componentType) {
                return componentId;
            }
        }
        throw new Error(`lumen_component_missing:${componentType}:node=${nodeIndex}`);
    }

    /**
     * @description 从模板克隆子树并挂到父节点下。
     * @param parentPath 父节点路径
     * @param templateAbsolutePath 模板绝对路径
     * @param childName 可选重命名子根
     * @returns 新子节点路径
     */
    public addChildFromTemplate(parentPath: string, templateAbsolutePath: string, childName?: string): string {
        const parentIndex = this.findNodeIndex(parentPath);
        const parsed = LumenPrefabDocument._source.readTemplateEntries(templateAbsolutePath);
        const embedAt = this._entries.length;
        const { entries: subtree } = LumenPrefabIdTools.cloneSubtreeForEmbed(parsed, embedAt);
        this._entries.push(...subtree);
        // 解包 Prefab 实例元数据：避免 PrefabInfo.asset.__id__=0 错绑 SceneAsset / Prefab 头。
        this._entries = LumenPrefabIdTools.unpackEmbeddedPrefabInstances(this._entries, embedAt);
        return this._finishEmbedChild(parentIndex, parentPath, embedAt, childName);
    }

    /**
     * @description 完成嵌入：挂父、改名、约定层。
     * @param parentIndex 父下标
     * @param parentPath 父路径
     * @param rootIndex 子根下标
     * @param childName 可选名
     * @returns 子路径
     */
    private _finishEmbedChild(
        parentIndex: number,
        parentPath: string,
        rootIndex: number,
        childName?: string,
    ): string {
        const root = this._entries[rootIndex];
        if (root == null || root.__type__ !== 'cc.Node') {
            throw new Error('lumen_template_root_missing');
        }
        if (childName != null && childName.length > 0) {
            root._name = childName;
        }
        root._parent = { __id__: parentIndex };
        const parent = this._entries[parentIndex];
        if (parent == null) {
            throw new Error('lumen_parent_missing');
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        children.push({ __id__: rootIndex });
        parent._children = children;
        this._applyConventionsToNode(rootIndex);
        const name = typeof root._name === 'string' ? root._name : 'Node';
        return `${this._normalizePath(parentPath)}/${name}`;
    }

    /**
     * @description 按节点规格在父节点下创建子树。
     * @param parentPath 父节点路径
     * @param spec 节点规格
     * @returns 新子节点路径
     */
    public addChildFromSpec(parentPath: string, spec: ILumenNodeSpec): string {
        const parentIndex = this.findNodeIndex(parentPath);
        const childIndex = this._appendNodeFromSpec(spec, parentIndex);
        const parent = this._entries[parentIndex];
        if (parent == null) {
            throw new Error('lumen_parent_missing');
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        children.push({ __id__: childIndex });
        parent._children = children;
        return `${this._normalizePath(parentPath)}/${spec.name}`;
    }

    /**
     * @description 按配方树在父节点下批量创建子树（内存操作，不落盘）。
     * @param parentPath 父节点路径
     * @param recipe 单节点或同级多根配方
     * @param resolveTemplateAbsolutePath 将 `template` id 解析为绝对 `.prefab` 路径；配方含 template 时必填
     * @returns 本层创建的节点路径
     */
    public buildFromRecipe(
        parentPath: string,
        recipe: ILumenNodeRecipe | readonly ILumenNodeRecipe[],
        resolveTemplateAbsolutePath?: (template: string) => string,
    ): readonly string[] {
        const recipes = Array.isArray(recipe) ? recipe : [recipe];
        const created: string[] = [];
        for (const item of recipes) {
            created.push(this._buildRecipeNode(parentPath, item, resolveTemplateAbsolutePath));
        }
        return created;
    }

    /**
     * @description 用配方重建 Prefab 根节点（含其组件与子树），替换 `createEmpty` 的默认根。
     *
     * 用于单根设计文档等场景：避免在外层再包一层与文件同名的根节点，防止导出后出现两层同名节点。
     * 仅支持 `components` 形态的根配方；若配方声明 `template`，请改用 `cloneFromTemplate`。
     * @param recipe 根节点配方
     * @param resolveTemplateAbsolutePath 将 `template` id 解析为绝对 `.prefab` 路径（根配方含 template 时必填，但根不支持 template）
     * @returns 根节点路径
     */
    public buildRootFromRecipe(
        recipe: ILumenNodeRecipe,
        resolveTemplateAbsolutePath?: (template: string) => string,
    ): string {
        if (recipe.name.trim().length === 0) {
            throw new Error('lumen_recipe_name_empty');
        }
        if (recipe.template != null && recipe.template.length > 0 && recipe.template !== 'empty') {
            throw new Error(
                'lumen_root_template_unsupported:replaceRoot_requires_components_not_template',
            );
        }
        const header = this._entries[0];
        if (header == null || header.__type__ !== 'cc.Prefab') {
            throw new Error('lumen_root_header_missing');
        }
        this._entries.length = 1;
        header._name = recipe.name;
        header.data = { __id__: 1 };
        const components = recipe.components ?? ['cc.UITransform'];
        for (const componentType of components) {
            this._propertySchema.assertBuiltinAttachAllowed(componentType);
        }
        LumenNodeConventions.assertRendererCompatibleAmong(components);
        const preferredLayer = LumenNodeConventions.preferredLayerForComponents(components);
        const rootIndex = this._entries.length;
        this._entries.push({
            __type__: 'cc.Node',
            _name: recipe.name,
            _objFlags: 0,
            _parent: null,
            _children: [],
            _active: true,
            _components: [],
            _prefab: null,
            _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _layer: preferredLayer,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: '',
        });
        for (const componentType of components) {
            this._attachComponent(rootIndex, this._createBuiltinComponent(componentType, rootIndex));
        }
        const prefabInfoIndex = this._entries.length;
        this._entries.push({
            __type__: 'cc.PrefabInfo',
            root: { __id__: rootIndex },
            asset: { __id__: 0 },
            fileId: LumenPrefabIdTools.createFileId(),
        });
        const rootNode = this._entries[rootIndex];
        if (rootNode == null) {
            throw new Error('lumen_root_build_failed');
        }
        rootNode._prefab = { __id__: prefabInfoIndex };
        const rootPath = `/${recipe.name}`;
        const childRecipes = recipe.children ?? [];
        if (childRecipes.length > 0) {
            this.buildFromRecipe(rootPath, childRecipes, resolveTemplateAbsolutePath);
        }
        if (recipe.nodeProps != null) {
            this.setNodeProperty(rootPath, recipe.nodeProps);
        }
        for (const [componentType, patch] of this._collectRecipeComponentPatches(recipe, rootPath)) {
            this.setComponentProperty(rootPath, componentType, patch);
        }
        return rootPath;
    }

    /**
     * @description 删除节点及其闭包（禁止删根）。
     * @param nodePath 节点路径
     */
    public removeNode(nodePath: string): void {
        this.removeNodeByIndex(this.findNodeIndex(nodePath));
    }

    /**
     * @description 按序列化下标删除损坏或无名节点及其闭包（禁止删根）。
     * @param nodeIndex 节点在 entries 中的下标
     */
    public removeNodeByIndex(nodeIndex: number): void {
        if (
            !Number.isInteger(nodeIndex) ||
            nodeIndex < 0 ||
            !LumenHierarchyEntry.isNodeOrScene(this._entries[nodeIndex])
        ) {
            throw new Error(`lumen_node_index_invalid:${nodeIndex}`);
        }
        if (nodeIndex === LumenHierarchyEntry.rootIndex(this._entries)) {
            throw new Error('lumen_cannot_remove_root');
        }
        if (!LumenHierarchyEntry.isNode(this._entries[nodeIndex])) {
            throw new Error(`lumen_node_index_invalid:${nodeIndex}`);
        }
        const node = this._entries[nodeIndex];
        const parentRef = node?._parent;
        if (parentRef == null || typeof parentRef !== 'object') {
            throw new Error('lumen_parent_ref_missing');
        }
        const parentIndex = (parentRef as { __id__?: number }).__id__;
        if (typeof parentIndex !== 'number') {
            throw new Error('lumen_parent_id_missing');
        }
        const parent = this._entries[parentIndex];
        if (parent == null) {
            throw new Error('lumen_parent_missing');
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        parent._children = children.filter((childRef) => {
            if (childRef == null || typeof childRef !== 'object') {
                return true;
            }
            return (childRef as { __id__?: number }).__id__ !== nodeIndex;
        });
        const removeSet = LumenPrefabIdTools.collectNodeClosure(this._entries, nodeIndex);
        const compacted = LumenPrefabIdTools.compactEntries(this._entries, removeSet);
        this._entries = compacted.entries;
    }

    /**
     * @description 精确写入自定义脚本的可序列化字段（支持 `$node` / `$component` / `$asset` / `$type`）。
     * @param nodePath 节点路径
     * @param compressedUuid 脚本组件 `__type__`（compressedUuid）
     * @param properties 属性补丁
     */
    public setScriptProperties(
        nodePath: string,
        compressedUuid: string,
        properties: Readonly<Record<string, unknown>>,
    ): void {
        const componentIndex = this.findComponentIndex(this.findNodeIndex(nodePath), compressedUuid);
        const component = this._entries[componentIndex];
        if (component == null) {
            throw new Error(`lumen_component_missing:${compressedUuid}`);
        }
        for (const [name, value] of Object.entries(properties)) {
            if (name.startsWith('__') || name === 'node' || name === '_id' || name === '_objFlags' || name === '__prefab') {
                throw new Error(`lumen_script_property_reserved:${name}`);
            }
            component[name] = this._encodeScriptValue(value);
        }
    }

    /**
     * @description 将脚本属性值编码为 Prefab 序列化形态。
     * @param value 原始值（可含 `$node` / `$component` / `$asset` / `$type`）
     * @returns 序列化值
     */
    private _encodeScriptValue(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map((item) => this._encodeScriptValue(item));
        }
        if (value == null || typeof value !== 'object') {
            return value;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.$node === 'string') {
            return this._resolveNodeRef(record.$node);
        }
        if (record.$component != null && typeof record.$component === 'object' && !Array.isArray(record.$component)) {
            const ref = record.$component as Record<string, unknown>;
            if (typeof ref.nodePath !== 'string' || typeof ref.type !== 'string') {
                throw new Error('lumen_script_component_ref_invalid');
            }
            return this._resolveComponentRef(ref.nodePath, ref.type);
        }
        if (record.$asset != null && typeof record.$asset === 'object' && !Array.isArray(record.$asset)) {
            const ref = record.$asset as Record<string, unknown>;
            if (typeof ref.uuid !== 'string') {
                throw new Error('lumen_script_asset_ref_invalid');
            }
            return {
                __uuid__: ref.uuid,
                ...(typeof ref.expectedType === 'string' ? { __expectedType__: ref.expectedType } : {}),
            };
        }
        const result: Record<string, unknown> = {};
        if (typeof record.$type === 'string') {
            result.__type__ = record.$type;
        }
        for (const [key, item] of Object.entries(record)) {
            if (key.startsWith('$')) {
                continue;
            }
            result[key] = this._encodeScriptValue(item);
        }
        return result;
    }

    /**
     * @description 重命名节点。
     * @param nodePath 节点路径
     * @param name 新名称
     */
    public renameNode(nodePath: string, name: string): void {
        if (name.trim().length === 0) {
            throw new Error('lumen_node_name_empty');
        }
        const nodeIndex = this.findNodeIndex(nodePath);
        const node = this._entries[nodeIndex];
        if (node == null) {
            throw new Error('lumen_node_missing');
        }
        node._name = name;
        if (nodeIndex === LumenHierarchyEntry.rootIndex(this._entries)) {
            const header = this._entries[0];
            if (header != null && (header.__type__ === 'cc.Prefab' || header.__type__ === 'cc.SceneAsset')) {
                header._name = name;
            }
        }
    }

    /**
     * @description 调整父节点下某个子节点的顺序。
     * @param parentPath 父节点路径
     * @param childName 子节点名
     * @param toIndex 目标下标（0-based）
     */
    public reorderChild(parentPath: string, childName: string, toIndex: number): void {
        if (!Number.isInteger(toIndex) || toIndex < 0) {
            throw new Error(`lumen_reorder_index_invalid:${toIndex}`);
        }
        const parentIndex = this.findNodeIndex(parentPath);
        const parent = this._entries[parentIndex];
        if (parent == null) {
            throw new Error('lumen_parent_missing');
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        let fromIndex = -1;
        for (let index = 0; index < children.length; index += 1) {
            const childRef = children[index];
            if (childRef == null || typeof childRef !== 'object') {
                continue;
            }
            const childId = (childRef as { __id__?: number }).__id__;
            if (typeof childId !== 'number') {
                continue;
            }
            if (this._entries[childId]?._name === childName) {
                fromIndex = index;
                break;
            }
        }
        if (fromIndex < 0) {
            throw new Error(`lumen_child_missing:${childName}`);
        }
        if (toIndex >= children.length) {
            throw new Error(`lumen_reorder_index_out_of_range:${toIndex}`);
        }
        const [moved] = children.splice(fromIndex, 1);
        if (moved == null) {
            throw new Error('lumen_reorder_failed');
        }
        children.splice(toIndex, 0, moved);
        parent._children = children;
    }

    /**
     * @description 挂载内置组件。
     * @param nodePath 节点路径
     * @param componentType 如 `cc.Button`
     * @returns 组件下标
     */
    public attachBuiltinComponent(nodePath: string, componentType: string): number {
        this._propertySchema.assertBuiltinAttachAllowed(componentType);
        const nodeIndex = this.findNodeIndex(nodePath);
        const host = this._entries[nodeIndex];
        if (!LumenHierarchyEntry.isNode(host)) {
            throw new Error('lumen_cannot_attach_on_scene');
        }
        try {
            return this.findComponentIndex(nodeIndex, componentType);
        } catch {
            // continue to attach
        }
        const existingTypes = this._listComponentTypes(nodeIndex);
        LumenNodeConventions.assertRendererCompatible(componentType, existingTypes);
        const node = this._entries[nodeIndex];
        if (node == null) {
            throw new Error('lumen_node_missing');
        }
        const currentLayer = typeof node._layer === 'number' ? node._layer : LumenNodeLayer.UI_2D;
        const suggested = LumenNodeConventions.suggestLayerOnAttach(
            componentType,
            currentLayer,
            existingTypes,
        );
        if (suggested != null) {
            node._layer = suggested;
        } else {
            LumenNodeConventions.assertLayerCompatible(componentType, currentLayer);
        }
        return this._attachComponent(nodeIndex, this._createBuiltinComponent(componentType, nodeIndex));
    }

    /**
     * @description 挂载脚本组件（`__type__` 为 compressedUuid）。
     * @param nodePath 节点路径
     * @param compressedUuid catalog 压缩 UUID
     * @returns 组件下标
     */
    public attachScriptComponent(nodePath: string, compressedUuid: string): number {
        if (compressedUuid.trim().length === 0) {
            throw new Error('lumen_compressed_uuid_empty');
        }
        const nodeIndex = this.findNodeIndex(nodePath);
        if (!LumenHierarchyEntry.isNode(this._entries[nodeIndex])) {
            throw new Error('lumen_cannot_attach_on_scene');
        }
        try {
            return this.findComponentIndex(nodeIndex, compressedUuid);
        } catch {
            // continue to attach
        }
        const infoIndex = this._entries.length;
        const componentIndex = infoIndex + 1;
        this._entries.push({ __type__: 'cc.CompPrefabInfo', fileId: LumenPrefabIdTools.createFileId() });
        this._entries.push({
            __type__: compressedUuid,
            _name: '',
            _objFlags: 0,
            node: { __id__: nodeIndex },
            _enabled: true,
            __prefab: { __id__: infoIndex },
            _id: '',
        });
        this._linkComponent(nodeIndex, componentIndex);
        return componentIndex;
    }

    /**
     * @description 移除节点上指定 `__type__` 的组件。
     * @param nodePath 节点路径
     * @param typeOrCompressedId 组件类型或脚本 compressedUuid
     */
    public removeComponent(nodePath: string, typeOrCompressedId: string): void {
        const nodeIndex = this.findNodeIndex(nodePath);
        const componentIndex = this.findComponentIndex(nodeIndex, typeOrCompressedId);
        const node = this._entries[nodeIndex];
        if (node == null) {
            throw new Error('lumen_node_missing');
        }
        const components = Array.isArray(node._components) ? [...node._components] : [];
        node._components = components.filter((componentRef) => {
            if (componentRef == null || typeof componentRef !== 'object') {
                return true;
            }
            return (componentRef as { __id__?: number }).__id__ !== componentIndex;
        });
        const removeSet = new Set<number>([componentIndex]);
        const component = this._entries[componentIndex];
        const infoRef = component?.__prefab;
        if (infoRef != null && typeof infoRef === 'object') {
            const infoId = (infoRef as { __id__?: number }).__id__;
            if (typeof infoId === 'number') {
                removeSet.add(infoId);
            }
        }
        const compacted = LumenPrefabIdTools.compactEntries(this._entries, removeSet);
        this._entries = compacted.entries;
    }

    /**
     * @description 按 3.8 可编辑属性表白名单写入组件内容（公开 API 名）。
     * @param nodePath 节点路径
     * @param componentType 组件类型，如 `cc.Label`
     * @param patch 公开属性补丁，如 `{ string: "Hello", fontSize: 28 }`
     */
    public setComponentProperty(nodePath: string, componentType: string, patch: Readonly<Record<string, unknown>>): void {
        const nodeIndex = this.findNodeIndex(nodePath);
        const componentIndex = this.findComponentIndex(nodeIndex, componentType);
        const component = this._entries[componentIndex];
        if (component == null) {
            throw new Error('lumen_component_missing');
        }
        this._propertySchema.applyComponentPatch(
            componentType,
            component,
            patch,
            {
                // 配方常烘焙 /Panel/pager/view/content 这类绝对路径；挂到场景 Canvas 下后
                // 真实路径是 /Game/Canvas/Panel/pager/...。解析失败时按 host 后缀对齐重写。
                resolveNodeRef: (refPath) => this._resolveNodeRef(refPath, nodePath),
                resolveComponentRef: (refPath, refComponentType) =>
                    this._resolveComponentRef(refPath, refComponentType, nodePath),
            },
            this._createEmbeddedHost(component),
            (entryIndex) => this._entries[entryIndex] ?? null,
        );
        if ('clickEvents' in patch) {
            const referencedClickEventIds = new Set<number>();
            for (const entry of this._entries) {
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
                this._entries.flatMap((entry, index) => {
                    if (entry.__type__ !== 'cc.ClickEvent' || referencedClickEventIds.has(index)) {
                        return [];
                    }
                    return [index];
                }),
            );
            if (staleIds.size > 0) {
                this._entries = LumenPrefabIdTools.compactEntries(this._entries, staleIds).entries;
            }
        }
    }

    /**
     * @description 为指定字段容器创建内嵌条目宿主。
     * @param owner 组件或子模块对象
     * @returns 内嵌宿主
     */
    private _createEmbeddedHost(owner: Record<string, unknown>): ILumenEmbeddedEntryHost {
        return {
            readEmbedded: (serializedName) => this._readEmbedded(owner, serializedName),
            resolveOrCreateEmbedded: (serializedName, embeddedType) =>
                this._resolveOrCreateEmbedded(owner, serializedName, embeddedType),
            allocateEmbedded: (embeddedType) => this._allocateEmbedded(embeddedType),
            forkForOwner: (nextOwner) => this._createEmbeddedHost(nextOwner),
        };
    }

    /**
     * @description 读取组件字段指向的内嵌对象（`__id__` 或内联）。
     * @param component 组件条目
     * @param serializedName 字段名
     * @returns 内嵌对象或 `null`
     */
    private _readEmbedded(
        component: Readonly<Record<string, unknown>>,
        serializedName: string,
    ): Record<string, unknown> | null {
        const raw = component[serializedName];
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
            return null;
        }
        const record = raw as Record<string, unknown>;
        if ('__id__' in record) {
            const id = record.__id__;
            if (typeof id !== 'number') {
                return null;
            }
            const entry = this._entries[id];
            return entry ?? null;
        }
        return record;
    }

    /**
     * @description 解析或创建内嵌条目并回写组件字段。
     * @param component 组件条目
     * @param serializedName 字段名
     * @param embeddedType 内嵌 `__type__`
     * @returns 可写内嵌对象
     */
    private _resolveOrCreateEmbedded(
        component: Record<string, unknown>,
        serializedName: string,
        embeddedType: string,
    ): Record<string, unknown> {
        const existing = this._readEmbedded(component, serializedName);
        if (existing != null) {
            return existing;
        }
        const inlineTypes = new Set(['cc.HingeLimitData', 'cc.HingeMotorData']);
        if (inlineTypes.has(embeddedType)) {
            const inline: Record<string, unknown> = { __type__: embeddedType };
            component[serializedName] = inline;
            return inline;
        }
        const allocated = this._allocateEmbedded(embeddedType);
        component[serializedName] = { __id__: allocated.id };
        return allocated.body;
    }

    /**
     * @description 分配独立内嵌条目（数组元素等）。
     * @param embeddedType 条目 `__type__`
     * @returns `{ id, body }`
     */
    private _allocateEmbedded(embeddedType: string): {
        readonly id: number;
        readonly body: Record<string, unknown>;
    } {
        const id = this._entries.length;
        const body: PrefabEntry = { __type__: embeddedType };
        this._entries.push(body);
        return { id, body };
    }

    /**
     * @description 将节点下标解析为绝对路径（如 `/Root/Content`）。
     * @param nodeIndex 节点条目下标
     * @returns 路径
     */
    public pathForNodeIndex(nodeIndex: number): string {
        const map = this._buildNodePathMap();
        const path = map.get(nodeIndex);
        if (path == null) {
            throw new Error(`lumen_node_index_unknown:${nodeIndex}`);
        }
        return path;
    }

    /**
     * @description 将条目下标解析为宿主节点路径（节点自身或其所属节点）。
     * @param entryIndex 节点或组件下标
     * @returns 路径；无法解析时 `null`
     */
    public pathForEntryIndex(entryIndex: number): string | null {
        const entry = this._entries[entryIndex];
        if (entry == null) {
            return null;
        }
        if (LumenHierarchyEntry.isNodeOrScene(entry)) {
            try {
                return this.pathForNodeIndex(entryIndex);
            } catch {
                return null;
            }
        }
        const nodeRef = entry.node;
        if (nodeRef == null || typeof nodeRef !== 'object') {
            return null;
        }
        const hostId = (nodeRef as { __id__?: unknown }).__id__;
        if (typeof hostId !== 'number') {
            return null;
        }
        try {
            return this.pathForNodeIndex(hostId);
        } catch {
            return null;
        }
    }

    /**
     * @description 解析节点引用输入。
     * @param refPath 节点路径或 `null`
     * @param hostNodePath 正在写属性的宿主节点路径；用于绝对路径挂载偏移时的后缀对齐
     * @returns `{ __id__ }` 或 `null`
     */
    private _resolveNodeRef(
        refPath: string | null,
        hostNodePath?: string,
    ): { __id__: number } | null {
        if (refPath == null) {
            return null;
        }
        try {
            return { __id__: this.findNodeIndex(refPath) };
        } catch (error) {
            const rewritten =
                hostNodePath == null
                    ? null
                    : this._rewriteAbsoluteRefUnderHost(refPath, hostNodePath);
            if (rewritten == null) {
                throw error;
            }
            return { __id__: this.findNodeIndex(rewritten) };
        }
    }

    /**
     * @description 解析组件引用输入。
     * @param refPath 组件所在节点路径或 `null`
     * @param componentType 目标组件类型
     * @param hostNodePath 宿主节点路径
     * @returns `{ __id__ }` 或 `null`
     */
    private _resolveComponentRef(
        refPath: string | null,
        componentType: string,
        hostNodePath?: string,
    ): { __id__: number } | null {
        if (refPath == null) {
            return null;
        }
        const resolved = this._resolveNodeRef(refPath, hostNodePath);
        if (resolved == null) {
            return null;
        }
        return { __id__: this.findComponentIndex(resolved.__id__, componentType) };
    }

    /**
     * @description 把配方里烘焙的绝对引用，按宿主节点路径做最长后缀对齐后重写。
     * 例：host=`/Game/Canvas/Panel/pager`，ref=`/Panel/pager/view/content`
     * → `/Game/Canvas/Panel/pager/view/content`。
     * @param refPath 配方绝对路径
     * @param hostNodePath 宿主绝对路径
     * @returns 重写后的路径；无法对齐时 null
     */
    private _rewriteAbsoluteRefUnderHost(refPath: string, hostNodePath: string): string | null {
        if (hostNodePath.length === 0) {
            return null;
        }
        const refParts = refPath.split('/').filter((part) => part.length > 0);
        const hostParts = hostNodePath.split('/').filter((part) => part.length > 0);
        if (refParts.length === 0 || hostParts.length === 0) {
            return null;
        }
        const maxOverlap = Math.min(hostParts.length, refParts.length);
        for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
            const hostSuffix = hostParts.slice(-overlap);
            const refPrefix = refParts.slice(0, overlap);
            let matched = true;
            for (let index = 0; index < overlap; index += 1) {
                if (hostSuffix[index] !== refPrefix[index]) {
                    matched = false;
                    break;
                }
            }
            if (!matched) {
                continue;
            }
            const rest = refParts.slice(overlap);
            const rewritten = `/${[...hostParts, ...rest].join('/')}`;
            try {
                this.findNodeIndex(rewritten);
                return rewritten;
            } catch {
                // 继续试更短 overlap
            }
        }
        return null;
    }

    /**
     * @description 构建节点下标 → 路径映射。
     * @returns 映射表
     */
    private _buildNodePathMap(): Map<number, string> {
        const map = new Map<number, string>();
        let rootIndex: number;
        try {
            rootIndex = LumenHierarchyEntry.rootIndex(this._entries);
        } catch {
            return map;
        }
        const walk = (index: number, parentPath: string): void => {
            const node = this._entries[index];
            if (!LumenHierarchyEntry.isNodeOrScene(node)) {
                return;
            }
            const name = typeof node._name === 'string' ? node._name : `Node${index}`;
            const path = parentPath.length === 0 ? `/${name}` : `${parentPath}/${name}`;
            map.set(index, path);
            const children = Array.isArray(node._children) ? node._children : [];
            for (const childRef of children) {
                if (childRef == null || typeof childRef !== 'object') {
                    continue;
                }
                const childId = (childRef as { __id__?: unknown }).__id__;
                if (typeof childId !== 'number') {
                    continue;
                }
                walk(childId, path);
            }
        };
        walk(rootIndex, '');
        return map;
    }

    /**
     * @description 设置节点变换/激活等属性。
     * @param nodePath 节点路径
     * @param patch 公开属性，如 `{ position: {x,y,z}, active: true }`
     */
    public setNodeProperty(nodePath: string, patch: Readonly<Record<string, unknown>>): void {
        const nodeIndex = this.findNodeIndex(nodePath);
        const node = this._entries[nodeIndex];
        if (!LumenHierarchyEntry.isNodeOrScene(node)) {
            throw new Error('lumen_node_missing');
        }
        const encoded = this._propertySchema.encodeNodePatch(patch, node);
        for (const [key, value] of Object.entries(encoded)) {
            node[key] = LumenDeepClone.clone(value);
        }
        if (patch.euler != null && typeof patch.euler === 'object' && !Array.isArray(patch.euler)) {
            // Creator 运行时以 `_lrot` 为准；只写 `_euler` 会留下模板单位四元数，场景视图姿态错误。
            const euler = patch.euler as { x?: unknown; y?: unknown; z?: unknown };
            const x = typeof euler.x === 'number' ? euler.x : 0;
            const y = typeof euler.y === 'number' ? euler.y : 0;
            const z = typeof euler.z === 'number' ? euler.z : 0;
            node._lrot = LumenPrefabDocument._quatFromEulerDegrees(x, y, z);
        }
        if (typeof patch.name === 'string' && nodeIndex === LumenHierarchyEntry.rootIndex(this._entries)) {
            const header = this._entries[0];
            if (header != null && (header.__type__ === 'cc.Prefab' || header.__type__ === 'cc.SceneAsset')) {
                header._name = patch.name;
            }
        }
    }

    /**
     * @description 欧拉角（度）转局部四元数（与 Creator default.scene 一致的约定）。
     * @param x 度
     * @param y 度
     * @param z 度
     * @returns `cc.Quat` 序列化对象
     */
    private static _quatFromEulerDegrees(
        x: number,
        y: number,
        z: number,
    ): { __type__: 'cc.Quat'; x: number; y: number; z: number; w: number } {
        const toRad = (deg: number): number => (deg * Math.PI) / 180;
        const ex = toRad(x);
        const ey = toRad(y);
        const ez = toRad(z);
        const cx = Math.cos(ex / 2);
        const sx = Math.sin(ex / 2);
        const cy = Math.cos(ey / 2);
        const sy = Math.sin(ey / 2);
        const cz = Math.cos(ez / 2);
        const sz = Math.sin(ez / 2);
        return {
            __type__: 'cc.Quat',
            x: sx * cy * cz + cx * sy * sz,
            y: cx * sy * cz - sx * cy * sz,
            z: cx * cy * sz - sx * sy * cz,
            w: cx * cy * cz + sx * sy * sz,
        };
    }

    /**
     * @description 绑定 Button.clickEvents 中的一条点击回调。
     * @param buttonNodePath Button 所在节点路径
     * @param targetNodePath 目标节点路径
     * @param component 脚本类名（显示用）
     * @param handler 方法名
     * @param customEventData 自定义数据
     * @param componentId 脚本 compressedUuid（写入 `_componentId`）
     */
    public bindClickEvent(
        buttonNodePath: string,
        targetNodePath: string,
        component: string,
        handler: string,
        customEventData: string = '',
        componentId: string = '',
    ): void {
        const buttonNodeIndex = this.findNodeIndex(buttonNodePath);
        const targetNodeIndex = this.findNodeIndex(targetNodePath);
        const buttonComponentIndex = this.findComponentIndex(buttonNodeIndex, 'cc.Button');
        const buttonComponent = this._entries[buttonComponentIndex];
        if (buttonComponent == null) {
            throw new Error('lumen_button_component_missing');
        }
        const clickEventIndex = this._entries.length;
        this._entries.push({
            __type__: 'cc.ClickEvent',
            target: { __id__: targetNodeIndex },
            component,
            _componentId: componentId,
            handler,
            customEventData,
        });
        const existing = buttonComponent.clickEvents;
        const nextEvents = Array.isArray(existing) ? [...existing] : [];
        nextEvents.push({ __id__: clickEventIndex });
        buttonComponent.clickEvents = nextEvents;
    }

    /**
     * @description 绑定 Sprite._spriteFrame。
     * @param nodePath 节点路径
     * @param spriteFrameUuid SpriteFrame uuid
     */
    public bindSpriteFrame(nodePath: string, spriteFrameUuid: string): void {
        const nodeIndex = this.findNodeIndex(nodePath);
        const spriteIndex = this.findComponentIndex(nodeIndex, 'cc.Sprite');
        const sprite = this._entries[spriteIndex];
        if (sprite == null) {
            throw new Error('lumen_sprite_missing');
        }
        sprite._spriteFrame = {
            __uuid__: spriteFrameUuid,
            __expectedType__: 'cc.SpriteFrame',
        };
        sprite._sizeMode = 2;
        sprite._isTrimmedMode = false;
    }

    /**
     * @description 写回磁盘，并在需要时写入最小 meta。
     * @param projectRoot 项目根
     * @param writeMetaIfMissing 缺少 meta 时是否创建
     * @param cocosVersion Creator 版本（决定 prefab/scene meta `ver`）
     */
    public save(
        projectRoot: string,
        writeMetaIfMissing: boolean = true,
        cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
    ): void {
        const absolutePath = join(projectRoot, this._relativePath);
        // 先补齐祖先目录与 directory.meta，禁止裸 mkdir 导致 AssetDB/Assets 空壳文件夹。
        const parentRelative = dirname(this._relativePath).replace(/\\/g, '/');
        if (parentRelative.length > 0 && parentRelative !== '.' && parentRelative.startsWith('assets')) {
            new SilentAssetCreateFolder().ensureDirectoryMetas({
                projectRoot,
                relativePath: parentRelative,
            });
        } else {
            mkdirSync(dirname(absolutePath), { recursive: true });
        }
        LumenAtomicFileWriter.writeUtf8(absolutePath, `${JSON.stringify(this._entries, null, 2)}\n`);
        const metaPath = `${absolutePath}.meta`;
        if (!existsSync(metaPath) && writeMetaIfMissing) {
            const rootIndex = LumenHierarchyEntry.rootIndex(this._entries);
            const rootName =
                typeof this._entries[rootIndex]?._name === 'string' ? this._entries[rootIndex]._name : 'Node';
            const isScene = this.assetKind === 'scene';
            const importer = isScene ? 'scene' : 'prefab';
            LumenAtomicFileWriter.writeUtf8(
                metaPath,
                `${JSON.stringify(
                    {
                        ver: LumenMetaImporterVersions.shared().resolve(cocosVersion, importer),
                        importer,
                        imported: false,
                        uuid: CompatibleUuid.create(),
                        files: [],
                        subMetas: {},
                        userData: isScene ? {} : { syncNodeName: rootName },
                    },
                    null,
                    2,
                )}\n`,
            );
        }
    }

    /**
     * @description 将模板文件复制到目标路径（不经内存改写时使用）。
     * @param projectRoot 项目根
     * @param relativePath 目标相对路径
     * @param templateAbsolutePath 模板绝对路径
     */
    public static copyTemplateFile(
        projectRoot: string,
        relativePath: string,
        templateAbsolutePath: string,
    ): void {
        LumenPrefabDocument._source.copyTemplateFile(projectRoot, relativePath, templateAbsolutePath);
    }

    /**
     * @description 规范化节点路径前缀。
     * @param nodePath 输入路径
     * @returns 以 `/` 开头的路径
     */
    private _normalizePath(nodePath: string): string {
        const trimmed = nodePath.replace(/\/+$/, '');
        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    /**
     * @description 递归创建单个配方节点及其子树。
     * @param parentPath 父路径
     * @param recipe 节点配方
     * @param resolveTemplateAbsolutePath 可选模板解析
     * @returns 新节点路径
     */
    private _buildRecipeNode(
        parentPath: string,
        recipe: ILumenNodeRecipe,
        resolveTemplateAbsolutePath?: (template: string) => string,
    ): string {
        if (recipe.name.trim().length === 0) {
            throw new Error('lumen_recipe_name_empty');
        }
        let nodePath: string;
        if (recipe.template != null && recipe.template.length > 0 && recipe.template !== 'empty') {
            if (resolveTemplateAbsolutePath == null) {
                throw new Error('lumen_recipe_template_resolver_required');
            }
            nodePath = this.addChildFromTemplate(
                parentPath,
                resolveTemplateAbsolutePath(recipe.template),
                recipe.name,
            );
        } else {
            nodePath = this.addChildFromSpec(parentPath, {
                name: recipe.name,
                components: recipe.components ?? ['cc.UITransform'],
            });
        }
        if (recipe.nodeProps != null) {
            this.setNodeProperty(nodePath, recipe.nodeProps);
        }
        const children = recipe.children ?? [];
        for (const child of children) {
            this._buildRecipeNode(nodePath, child, resolveTemplateAbsolutePath);
        }
        for (const [componentType, patch] of this._collectRecipeComponentPatches(recipe, nodePath)) {
            this.setComponentProperty(nodePath, componentType, patch);
        }
        return nodePath;
    }

    /**
     * @description 合并 `props` 与 `componentProps` 为按类型分组的补丁。
     * @param recipe 节点配方
     * @param nodePath 已创建节点路径
     * @returns 组件类型与补丁对
     */
    private _collectRecipeComponentPatches(
        recipe: ILumenNodeRecipe,
        nodePath: string,
    ): ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> {
        const byType = new Map<string, Record<string, unknown>>();
        if (recipe.props != null) {
            const componentType = recipe.propComponent ?? this._inferRecipeComponentType(recipe, nodePath);
            if (componentType == null) {
                throw new Error(`lumen_recipe_props_need_propComponent:${recipe.name}`);
            }
            byType.set(componentType, { ...recipe.props });
        }
        if (recipe.componentProps != null) {
            for (const [componentType, patch] of Object.entries(recipe.componentProps)) {
                const existing = byType.get(componentType) ?? {};
                byType.set(componentType, { ...existing, ...patch });
            }
        }
        return [...byType.entries()];
    }

    /**
     * @description 由已克隆节点或 `components` 推断 `props` 目标类型。
     * @param recipe 配方
     * @param nodePath 已创建节点路径
     * @returns 组件类型或 null
     */
    private _inferRecipeComponentType(recipe: ILumenNodeRecipe, nodePath: string): string | null {
        if (recipe.template == null || recipe.template.length === 0) {
            return recipe.components?.[0] ?? null;
        }
        const types = this._listComponentTypes(this.findNodeIndex(nodePath));
        const hint = LumenPrefabDocument._templateNameHint(recipe.template).toLowerCase();
        const matched = types.filter(
            (type) => LumenPrefabDocument._simpleTypeName(type).toLowerCase() === hint,
        );
        if (matched.length === 1) {
            return matched[0];
        }
        const nonUi = types.filter((type) => type !== 'cc.UITransform');
        if (nonUi.length === 1) {
            return nonUi[0];
        }
        return null;
    }

    /**
     * @description 模板相对路径末段（去空白）作为主组件线索。
     * @param template 如 `ui/Label` / `effects/Particle System`
     * @returns 线索名
     */
    private static _templateNameHint(template: string): string {
        const slash = Math.max(template.lastIndexOf('/'), template.lastIndexOf('\\'));
        const base = slash >= 0 ? template.slice(slash + 1) : template;
        return base.replace(/\s+/g, '');
    }

    /**
     * @description 取组件 `__type__` 最后一段。
     * @param componentType 类型名
     * @returns 简名
     */
    private static _simpleTypeName(componentType: string): string {
        const dot = componentType.lastIndexOf('.');
        return dot >= 0 ? componentType.slice(dot + 1) : componentType;
    }

    /**
     * @description 递归按规格追加节点。
     * @param spec 规格
     * @param parentIndex 父下标
     * @returns 新节点下标
     */
    private _appendNodeFromSpec(spec: ILumenNodeSpec, parentIndex: number): number {
        if (spec.name.trim().length === 0) {
            throw new Error('lumen_node_name_empty');
        }
        const nodeIndex = this._entries.length;
        const prefabInfoIndex = nodeIndex + 1;
        const components = spec.components ?? ['cc.UITransform'];
        for (const componentType of components) {
            this._propertySchema.assertBuiltinAttachAllowed(componentType);
        }
        LumenNodeConventions.assertRendererCompatibleAmong(components);
        const preferredLayer = LumenNodeConventions.preferredLayerForComponents(components);
        this._entries.push({
            __type__: 'cc.Node',
            _name: spec.name,
            _objFlags: 0,
            _parent: { __id__: parentIndex },
            _children: [],
            _active: true,
            _components: [],
            _prefab: { __id__: prefabInfoIndex },
            _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _layer: preferredLayer,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: '',
        });
        this._entries.push({
            __type__: 'cc.PrefabInfo',
            root: { __id__: 1 },
            asset: { __id__: 0 },
            fileId: LumenPrefabIdTools.createFileId(),
        });
        for (const componentType of components) {
            this._attachComponent(nodeIndex, this._createBuiltinComponent(componentType, nodeIndex));
        }
        const childSpecs = spec.children ?? [];
        const node = this._entries[nodeIndex];
        if (node == null) {
            throw new Error('lumen_node_append_failed');
        }
        const childRefs: Array<{ __id__: number }> = [];
        for (const childSpec of childSpecs) {
            const childIndex = this._appendNodeFromSpec(childSpec, nodeIndex);
            childRefs.push({ __id__: childIndex });
        }
        node._children = childRefs;
        return nodeIndex;
    }

    /**
     * @description 列出节点上已挂组件的 `__type__`。
     * @param nodeIndex 节点下标
     * @returns 类型列表
     */
    private _listComponentTypes(nodeIndex: number): string[] {
        const node = this._entries[nodeIndex];
        if (node == null || node.__type__ !== 'cc.Node') {
            return [];
        }
        const refs = Array.isArray(node._components) ? node._components : [];
        const types: string[] = [];
        for (const ref of refs) {
            if (ref == null || typeof ref !== 'object') {
                continue;
            }
            const id = (ref as { __id__?: unknown }).__id__;
            if (typeof id !== 'number') {
                continue;
            }
            const component = this._entries[id];
            if (typeof component?.__type__ === 'string') {
                types.push(component.__type__);
            }
        }
        return types;
    }

    /**
     * @description 对节点子树应用渲染互斥校验与 Layer 约定（模板嵌入后）。
     * @param nodeIndex 节点下标
     */
    private _applyConventionsToNode(nodeIndex: number): void {
        const types = this._listComponentTypes(nodeIndex);
        LumenNodeConventions.assertRendererCompatibleAmong(types);
        const node = this._entries[nodeIndex];
        if (node == null) {
            return;
        }
        node._layer = LumenNodeConventions.preferredLayerForComponents(types);
        const children = Array.isArray(node._children) ? node._children : [];
        for (const child of children) {
            if (child == null || typeof child !== 'object') {
                continue;
            }
            const childId = (child as { __id__?: unknown }).__id__;
            if (typeof childId === 'number') {
                this._applyConventionsToNode(childId);
            }
        }
    }

    /**
     * @description 创建内置组件骨架。
     * @param componentType 类型
     * @param nodeIndex 所属节点
     * @returns 组件条目（不含 CompPrefabInfo）
     */
    private _createBuiltinComponent(componentType: string, nodeIndex: number): PrefabEntry {
        const base: PrefabEntry = {
            __type__: componentType,
            _name: '',
            _objFlags: 0,
            node: { __id__: nodeIndex },
            _enabled: true,
            _id: '',
        };
        if (componentType === 'cc.UITransform') {
            return {
                ...base,
                _contentSize: { __type__: 'cc.Size', width: 100, height: 100 },
                _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
            };
        }
        if (componentType === 'cc.Button') {
            return {
                ...base,
                clickEvents: [],
                _interactable: true,
                _transition: 0,
                _duration: 0.1,
                _zoomScale: 1.2,
                _target: { __id__: nodeIndex },
            };
        }
        if (componentType === 'cc.Sprite') {
            return {
                ...base,
                _customMaterial: null,
                _srcBlendFactor: 2,
                _dstBlendFactor: 4,
                _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
                _spriteFrame: null,
                _type: 0,
                _fillType: 0,
                _sizeMode: 2,
                _isTrimmedMode: false,
            };
        }
        if (componentType === 'cc.Label') {
            return {
                ...base,
                _string: '',
                _horizontalAlign: 1,
                _verticalAlign: 1,
                _fontSize: 20,
                _lineHeight: 40,
                _font: null,
                _isSystemFontUsed: true,
            };
        }
        return base;
    }

    /**
     * @description 追加组件与 CompPrefabInfo 并挂到节点。
     * @param nodeIndex 节点下标
     * @param componentBody 组件体
     * @returns 组件下标
     */
    private _attachComponent(nodeIndex: number, componentBody: PrefabEntry): number {
        if (this.assetKind === 'scene') {
            const componentIndex = this._entries.length;
            this._entries.push({
                ...componentBody,
            });
            if (Object.prototype.hasOwnProperty.call(this._entries[componentIndex], '__prefab')) {
                delete this._entries[componentIndex]!.__prefab;
            }
            this._linkComponent(nodeIndex, componentIndex);
            return componentIndex;
        }
        const infoIndex = this._entries.length;
        const componentIndex = infoIndex + 1;
        this._entries.push({ __type__: 'cc.CompPrefabInfo', fileId: LumenPrefabIdTools.createFileId() });
        this._entries.push({
            ...componentBody,
            __prefab: { __id__: infoIndex },
        });
        this._linkComponent(nodeIndex, componentIndex);
        return componentIndex;
    }

    /**
     * @description 将组件下标写入节点 `_components`。
     * @param nodeIndex 节点下标
     * @param componentIndex 组件下标
     */
    private _linkComponent(nodeIndex: number, componentIndex: number): void {
        const node = this._entries[nodeIndex];
        if (node == null) {
            throw new Error('lumen_node_missing');
        }
        const components = Array.isArray(node._components) ? [...node._components] : [];
        components.push({ __id__: componentIndex });
        node._components = components;
    }

}
