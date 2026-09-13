import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { Lumen24BuiltinComponents } from './lumen-24-builtin-components.js';
import { Lumen24PrefabIdTools } from './lumen-24-prefab-id-tools.js';
import { Lumen24SerializedAssetMeta } from './lumen-24-serialized-asset-meta.js';
import { Lumen24SerializedFields } from './lumen-24-serialized-fields.js';
import type { ILumen24NodeRecipe } from './lumen-24-recipe-types.js';
import { Lumen24SceneScaffold } from './lumen-24-scene-scaffold.js';
import { Lumen24TemplateCatalog } from './lumen-24-template-catalog.js';
import { Lumen24Templates } from './lumen-24-templates.js';
import type {
    ILumen24InspectNode,
    ILumen24NodePropsPatch,
    ILumen24TreeNode,
    Lumen24DocumentKind,
    Lumen24PrefabEntry,
} from './lumen-24-prefab-contracts.js';

export type {
    ILumen24InspectNode,
    ILumen24NodePropsPatch,
    ILumen24TreeNode,
    Lumen24DocumentKind,
    Lumen24PrefabEntry,
} from './lumen-24-prefab-contracts.js';


/**
 * @description Creator 2.4 Prefab / `.fire` Scene 文档（层次 CRUD；不做 3.x UITransform / `_lpos`）。
 */
export class Lumen24PrefabDocument {
    /** @description 工程相对路径。 */
    private readonly _relativePath: string;
    /** @description Prefab / Scene 条目（可变；嵌入解包时可能整体替换）。 */
    private _entries: Lumen24PrefabEntry[];

    /**
     * @description 构造文档。
     * @param relativePath 相对路径
     * @param entries 条目
     */
    public constructor(relativePath: string, entries: Lumen24PrefabEntry[]) {
        this._relativePath = relativePath.replace(/\\/g, '/');
        this._entries = entries;
    }

    /**
     * @description 相对路径。
     * @returns 路径
     */
    public get relativePath(): string {
        return this._relativePath;
    }

    /**
     * @description 文档种类。
     * @returns prefab 或 scene
     */
    public get kind(): Lumen24DocumentKind {
        return this._entries[0]?.__type__ === 'cc.SceneAsset' ? 'scene' : 'prefab';
    }

    /**
     * @description 条目只读视图。
     * @returns 条目
     */
    public get entries(): readonly Lumen24PrefabEntry[] {
        return this._entries;
    }

    /**
     * @description 创建仅含空根节点的 2.4 Prefab。
     * @param relativePath 目标相对路径（`.prefab`）
     * @param rootName 根节点名
     * @returns 文档
     */
    public static createEmpty(relativePath: string, rootName: string): Lumen24PrefabDocument {
        const fileId = Lumen24PrefabDocument._createFileId();
        const entries: Lumen24PrefabEntry[] = [
            {
                __type__: 'cc.Prefab',
                _name: rootName,
                _objFlags: 0,
                _native: '',
                data: { __id__: 1 },
                optimizationPolicy: 0,
                asyncLoadAssets: false,
                readonly: false,
            },
            Lumen24PrefabDocument._createEmptyNode(rootName, null, 2),
            {
                __type__: 'cc.PrefabInfo',
                root: { __id__: 1 },
                asset: null,
                fileId,
            },
        ];
        return new Lumen24PrefabDocument(relativePath, entries);
    }

    /**
     * @description 从官方 default_prefab_24 整树克隆为工程 Prefab。
     * @param relativePath 目标相对路径（`.prefab`）
     * @param templateAbsolutePath 模板绝对路径
     * @param rootName 可选重命名根节点
     * @returns 文档
     */
    public static cloneFromTemplate(
        relativePath: string,
        templateAbsolutePath: string,
        rootName?: string,
    ): Lumen24PrefabDocument {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!normalized.toLowerCase().endsWith('.prefab')) {
            throw new Error(`lumen_24_clone_not_prefab:${normalized}`);
        }
        const entries = Lumen24TemplateCatalog.readEntries(templateAbsolutePath).map((entry) =>
            JSON.parse(JSON.stringify(entry)) as Lumen24PrefabEntry,
        );
        Lumen24PrefabIdTools.prepareClonedRootPrefab(entries);
        if (rootName != null && rootName.trim().length > 0) {
            const name = rootName.trim();
            const prefabHeader = entries[0];
            const rootNode = entries[1];
            if (prefabHeader != null && prefabHeader.__type__ === 'cc.Prefab') {
                prefabHeader._name = name;
            }
            if (rootNode != null && rootNode.__type__ === 'cc.Node') {
                rootNode._name = name;
            }
        }
        return new Lumen24PrefabDocument(normalized, entries);
    }

    /**
     * @description 创建对齐官方模板的 2.4 `.fire` 场景。
     * @param relativePath 目标相对路径（`.fire`）
     * @param rootName 场景根名
     * @returns 文档
     */
    public static createEmptyScene(relativePath: string, rootName: string): Lumen24PrefabDocument {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!normalized.toLowerCase().endsWith('.fire')) {
            throw new Error(`lumen_24_scaffold_not_fire:${normalized}`);
        }
        return new Lumen24PrefabDocument(normalized, Lumen24SceneScaffold.createEntries(rootName));
    }

    /**
     * @description 从磁盘打开已有 Prefab 或 `.fire` Scene。
     * @param projectRoot 工程根
     * @param relativePath 相对路径
     * @returns 文档
     */
    public static open(projectRoot: string, relativePath: string): Lumen24PrefabDocument {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const lower = normalized.toLowerCase();
        const isPrefab = lower.endsWith('.prefab');
        const isFire = lower.endsWith('.fire');
        if (!isPrefab && !isFire) {
            throw new Error(`lumen_24_open_unsupported:${normalized}`);
        }
        const absolutePath = join(projectRoot, normalized);
        if (!existsSync(absolutePath)) {
            throw new Error(isFire ? `lumen_24_scene_missing:${normalized}` : `lumen_24_prefab_missing:${normalized}`);
        }
        const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error(`lumen_24_document_not_array:${normalized}`);
        }
        const entries = parsed.map((entry) => {
            if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`lumen_24_document_entry_invalid:${normalized}`);
            }
            return entry as Lumen24PrefabEntry;
        });
        if (entries.length < 2) {
            throw new Error(`lumen_24_document_shape_invalid:${normalized}`);
        }
        const headerType = entries[0]?.__type__;
        if (isPrefab && headerType !== 'cc.Prefab') {
            throw new Error(`lumen_24_prefab_shape_invalid:${normalized}`);
        }
        if (isFire && headerType !== 'cc.SceneAsset') {
            throw new Error(`lumen_24_scene_shape_invalid:${normalized}`);
        }
        const document = new Lumen24PrefabDocument(normalized, entries);
        if (document.kind === 'scene') {
            document._ensureSceneRootName();
        }
        return document;
    }

    /**
     * @description 根节点下标。
     * @returns 下标
     */
    public rootIndex(): number {
        const header = this._entries[0];
        if (header?.__type__ === 'cc.SceneAsset') {
            const sceneRef = header.scene;
            if (sceneRef != null && typeof sceneRef === 'object' && !Array.isArray(sceneRef)) {
                const id = (sceneRef as { __id__?: unknown }).__id__;
                if (typeof id === 'number' && this._isHierarchyNode(this._entries[id])) {
                    return id;
                }
            }
        }
        const data = header?.data;
        if (data != null && typeof data === 'object' && !Array.isArray(data)) {
            const id = (data as { __id__?: unknown }).__id__;
            if (typeof id === 'number' && this._isHierarchyNode(this._entries[id])) {
                return id;
            }
        }
        for (let index = 1; index < this._entries.length; index += 1) {
            if (this._isHierarchyNode(this._entries[index])) {
                return index;
            }
        }
        throw new Error('lumen_24_root_missing');
    }

    /**
     * @description 按路径查找节点下标。
     * @param nodePath 如 `/Root/Child` 或 `Root/Child`
     * @returns 下标
     */
    public findNodeIndex(nodePath: string): number {
        const parts = nodePath.split('/').filter((part) => part.length > 0);
        if (parts.length === 0) {
            throw new Error('lumen_24_node_path_empty');
        }
        let currentIndex = this.rootIndex();
        const root = this._entries[currentIndex];
        if (!this._isHierarchyNode(root)) {
            throw new Error('lumen_24_root_missing');
        }
        let startDepth = 1;
        if (this._nodeDisplayName(root) !== parts[0]) {
            const realChild = this._findDirectChildIndex(currentIndex, parts[0]);
            if (realChild == null) {
                parts[0] = this._nodeDisplayName(root);
            } else {
                startDepth = 0;
            }
        }
        for (let depth = startDepth; depth < parts.length; depth += 1) {
            const nextIndex = this._findDirectChildIndex(currentIndex, parts[depth]);
            if (nextIndex == null) {
                throw new Error(`lumen_24_child_missing:${parts.slice(0, depth + 1).join('/')}`);
            }
            currentIndex = nextIndex;
        }
        return currentIndex;
    }

    /**
     * @description 导出层次树。
     * @returns 树根
     */
    public inspectTree(): ILumen24TreeNode {
        return this._buildTreeNode(this.rootIndex(), []);
    }

    /**
     * @description 检视单节点。
     * @param nodePath 节点路径；空则根
     * @returns 摘要
     */
    public inspectNode(nodePath?: string): ILumen24InspectNode {
        const index = nodePath == null || nodePath.trim().length === 0 ? this.rootIndex() : this.findNodeIndex(nodePath);
        const path = this._pathForIndex(index);
        const node = this._entries[index];
        if (!this._isHierarchyNode(node)) {
            throw new Error(`lumen_24_not_a_node:${index}`);
        }
        const trs = this._readTrs(node);
        const childNames = this._childIndices(index).map((childIndex) => {
            const child = this._entries[childIndex];
            return this._isHierarchyNode(child) ? this._nodeDisplayName(child) : '';
        });
        const components = this._componentTypes(node);
        return {
            path,
            name: this._nodeDisplayName(node),
            index,
            active: node._active !== false,
            opacity: typeof node._opacity === 'number' ? node._opacity : 255,
            position: { x: trs[0], y: trs[1], z: trs[2] },
            scale: { x: trs[7], y: trs[8], z: trs[9] },
            childNames,
            components,
        };
    }

    /**
     * @description 在父节点下追加空子节点。
     * @param parentPath 父路径
     * @param childName 子节点名
     * @returns 新节点路径
     */
    public addEmptyChild(parentPath: string, childName: string): string {
        const name = childName.trim();
        if (name.length === 0) {
            throw new Error('lumen_24_child_name_empty');
        }
        const parentIndex = this.findNodeIndex(parentPath);
        if (this._findDirectChildIndex(parentIndex, name) != null) {
            throw new Error(`lumen_24_child_exists:${this._pathForIndex(parentIndex)}/${name}`);
        }
        const parent = this._entries[parentIndex];
        if (!this._isHierarchyNode(parent)) {
            throw new Error('lumen_24_parent_missing');
        }
        const nodeIndex = this._entries.length;
        if (this.kind === 'scene') {
            this._entries.push(Lumen24SceneScaffold.createChildNode(name, parentIndex));
        } else {
            const infoIndex = nodeIndex + 1;
            this._entries.push(Lumen24PrefabDocument._createEmptyNode(name, parentIndex, infoIndex));
            this._entries.push({
                __type__: 'cc.PrefabInfo',
                root: { __id__: this.rootIndex() },
                asset: null,
                fileId: Lumen24PrefabDocument._createFileId(),
            });
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        children.push({ __id__: nodeIndex });
        parent._children = children;
        return `${this._pathForIndex(parentIndex)}/${name}`;
    }

    /**
     * @description 从官方模板整树克隆并挂到父节点下。
     * @param parentPath 父路径
     * @param templateAbsolutePath 模板绝对路径
     * @param childName 可选重命名子根
     * @returns 新子路径
     */
    public addChildFromTemplate(parentPath: string, templateAbsolutePath: string, childName?: string): string {
        const parentIndexBefore = this.findNodeIndex(parentPath);
        const parentBefore = this._entries[parentIndexBefore];
        if (!this._isHierarchyNode(parentBefore)) {
            throw new Error('lumen_24_parent_missing');
        }
        const parsed = Lumen24TemplateCatalog.readEntries(templateAbsolutePath);
        const embedAt = this._entries.length;
        const { entries: subtree, rootIndex: embeddedRootBefore } = Lumen24PrefabIdTools.cloneSubtreeForEmbed(
            parsed,
            embedAt,
        );
        this._entries.push(...subtree);
        let parentIndex = parentIndexBefore;
        let rootIndex = embeddedRootBefore;
        if (this.kind === 'scene') {
            // compact 会 deepClone 整表：必须用新数组上的 parent/root，禁止继续改旧引用。
            const unpacked = Lumen24PrefabIdTools.unpackEmbeddedForScene(this._entries, embedAt);
            this._entries = unpacked.entries;
            parentIndex = unpacked.idMap.get(parentIndexBefore) ?? parentIndexBefore;
            rootIndex = unpacked.idMap.get(embeddedRootBefore) ?? embeddedRootBefore;
        } else {
            Lumen24PrefabIdTools.rebindEmbeddedPrefabInfos(this._entries, embedAt, this.rootIndex());
        }
        const parent = this._entries[parentIndex];
        if (!this._isHierarchyNode(parent)) {
            throw new Error('lumen_24_parent_missing');
        }
        const root = this._entries[rootIndex];
        if (root == null || root.__type__ !== 'cc.Node') {
            throw new Error('lumen_24_template_root_missing');
        }
        if (childName != null && childName.trim().length > 0) {
            const trimmed = childName.trim();
            if (this._findDirectChildIndex(parentIndex, trimmed) != null) {
                throw new Error(`lumen_24_child_exists:${this._pathForIndex(parentIndex)}/${trimmed}`);
            }
            root._name = trimmed;
        } else {
            const existingName = typeof root._name === 'string' ? root._name : 'Node';
            if (this._findDirectChildIndex(parentIndex, existingName) != null) {
                throw new Error(`lumen_24_child_exists:${this._pathForIndex(parentIndex)}/${existingName}`);
            }
        }
        root._parent = { __id__: parentIndex };
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        children.push({ __id__: rootIndex });
        parent._children = children;
        const name = typeof root._name === 'string' ? root._name : 'Node';
        return `${this._pathForIndex(parentIndex)}/${name}`;
    }

    /**
     * @description 删除节点（不可删根）。
     * @param nodePath 节点路径
     * @returns void
     */
    public removeNode(nodePath: string): void {
        const index = this.findNodeIndex(nodePath);
        if (index === this.rootIndex()) {
            throw new Error('lumen_24_cannot_remove_root');
        }
        const node = this._entries[index];
        if (!this._isCcNode(node)) {
            throw new Error(`lumen_24_not_a_node:${index}`);
        }
        const parentRef = node._parent;
        if (parentRef == null || typeof parentRef !== 'object' || Array.isArray(parentRef)) {
            throw new Error('lumen_24_parent_ref_missing');
        }
        const parentId = (parentRef as { __id__?: unknown }).__id__;
        if (typeof parentId !== 'number' || !this._isHierarchyNode(this._entries[parentId])) {
            throw new Error('lumen_24_parent_missing');
        }
        const parent = this._entries[parentId];
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        parent._children = children.filter((childRef) => {
            if (childRef == null || typeof childRef !== 'object') {
                return true;
            }
            return (childRef as { __id__?: unknown }).__id__ !== index;
        });
        this._nullifySubtree(index);
    }

    /**
     * @description 重命名节点。
     * @param nodePath 节点路径
     * @param name 新名
     * @returns 新路径
     */
    public renameNode(nodePath: string, name: string): string {
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            throw new Error('lumen_24_rename_empty');
        }
        const index = this.findNodeIndex(nodePath);
        const node = this._entries[index];
        if (!this._isHierarchyNode(node)) {
            throw new Error(`lumen_24_not_a_node:${index}`);
        }
        if (index !== this.rootIndex()) {
            const parentRef = node._parent;
            const parentId =
                parentRef != null && typeof parentRef === 'object' && !Array.isArray(parentRef)
                    ? (parentRef as { __id__?: unknown }).__id__
                    : null;
            if (typeof parentId === 'number') {
                const sibling = this._findDirectChildIndex(parentId, trimmed);
                if (sibling != null && sibling !== index) {
                    throw new Error(`lumen_24_rename_conflict:${trimmed}`);
                }
            }
        }
        node._name = trimmed;
        if (index === this.rootIndex() && this.kind === 'prefab' && this._entries[0] != null) {
            this._entries[0]._name = trimmed;
        }
        return this._pathForIndex(index);
    }

    /**
     * @description 调整父节点下某个子节点的顺序。
     * @param parentPath 父路径
     * @param childName 子节点名
     * @param toIndex 目标下标（0-based）
     * @returns void
     */
    public reorderChild(parentPath: string, childName: string, toIndex: number): void {
        if (!Number.isInteger(toIndex) || toIndex < 0) {
            throw new Error(`lumen_24_reorder_index_invalid:${toIndex}`);
        }
        const parentIndex = this.findNodeIndex(parentPath);
        const parent = this._entries[parentIndex];
        if (!this._isHierarchyNode(parent)) {
            throw new Error('lumen_24_parent_missing');
        }
        const children = Array.isArray(parent._children) ? [...parent._children] : [];
        let fromIndex = -1;
        for (let index = 0; index < children.length; index += 1) {
            const childRef = children[index];
            if (childRef == null || typeof childRef !== 'object') {
                continue;
            }
            const childId = (childRef as { __id__?: unknown }).__id__;
            if (typeof childId !== 'number') {
                continue;
            }
            const child = this._entries[childId];
            if (this._isCcNode(child) && String(child._name) === childName) {
                fromIndex = index;
                break;
            }
        }
        if (fromIndex < 0) {
            throw new Error(`lumen_24_child_missing:${childName}`);
        }
        if (toIndex >= children.length) {
            throw new Error(`lumen_24_reorder_index_out_of_range:${toIndex}`);
        }
        const [moved] = children.splice(fromIndex, 1);
        if (moved == null) {
            throw new Error('lumen_24_reorder_failed');
        }
        children.splice(toIndex, 0, moved);
        parent._children = children;
    }

    /**
     * @description 写入节点基础属性。
     * @param nodePath 节点路径
     * @param props 补丁
     * @returns 检视摘要
     */
    public setNodeProps(nodePath: string, props: ILumen24NodePropsPatch): ILumen24InspectNode {
        const index = this.findNodeIndex(nodePath);
        const node = this._entries[index];
        if (!this._isHierarchyNode(node)) {
            throw new Error(`lumen_24_not_a_node:${index}`);
        }
        if (props.active != null) {
            node._active = props.active;
        }
        if (props.opacity != null) {
            node._opacity = Math.max(0, Math.min(255, Math.floor(props.opacity)));
        }
        const trs = this._readTrs(node);
        if (props.x != null) {
            trs[0] = props.x;
        }
        if (props.y != null) {
            trs[1] = props.y;
        }
        if (props.z != null) {
            trs[2] = props.z;
        }
        if (props.scaleX != null) {
            trs[7] = props.scaleX;
        }
        if (props.scaleY != null) {
            trs[8] = props.scaleY;
        }
        if (props.scaleZ != null) {
            trs[9] = props.scaleZ;
        }
        node._trs = {
            __type__: 'TypedArray',
            ctor: 'Float64Array',
            array: trs,
        };
        return this.inspectNode(this._pathForIndex(index));
    }

    /**
     * @description 挂载 2.4 内置组件（Sprite/Label/Button；禁止 UITransform）。
     * @param nodePath 节点路径
     * @param builtinType 组件类型
     * @returns 组件下标
     */
    public attachBuiltinComponent(nodePath: string, builtinType: string): number {
        const type = Lumen24BuiltinComponents.normalizeType(builtinType);
        const nodeIndex = this.findNodeIndex(nodePath);
        const node = this._entries[nodeIndex];
        if (this._isScene(node)) {
            throw new Error('lumen_24_cannot_attach_on_scene');
        }
        if (!this._isCcNode(node)) {
            throw new Error(`lumen_24_not_a_node:${nodeIndex}`);
        }
        if (this._findComponentIndex(nodeIndex, type) != null) {
            throw new Error(`lumen_24_component_exists:${type}`);
        }
        const componentIndex = this._entries.length;
        this._entries.push(Lumen24BuiltinComponents.create(type, nodeIndex));
        const components = Array.isArray(node._components) ? [...node._components] : [];
        components.push({ __id__: componentIndex });
        node._components = components;
        return componentIndex;
    }

    /**
     * @description 移除节点上指定类型组件（下标保留，仅断链）。
     * @param nodePath 节点路径
     * @param componentType 组件类型
     * @returns void
     */
    public removeComponent(nodePath: string, componentType: string): void {
        const type = this._resolveComponentTypeKey(componentType);
        const nodeIndex = this.findNodeIndex(nodePath);
        const componentIndex = this._findComponentIndex(nodeIndex, type);
        if (componentIndex == null) {
            throw new Error(`lumen_24_component_missing:${type}`);
        }
        const node = this._entries[nodeIndex];
        if (!this._isCcNode(node)) {
            throw new Error(`lumen_24_not_a_node:${nodeIndex}`);
        }
        const components = Array.isArray(node._components) ? [...node._components] : [];
        node._components = components.filter((ref) => {
            if (ref == null || typeof ref !== 'object') {
                return true;
            }
            return (ref as { __id__?: unknown }).__id__ !== componentIndex;
        });
        this._entries[componentIndex] = {
            __type__: 'cc.MissingScript',
            _name: '',
            _objFlags: 0,
            node: null,
            _enabled: false,
        };
    }

    /**
     * @description 写入组件白名单属性。
     * @param nodePath 节点路径
     * @param componentType 组件类型
     * @param props 公开属性补丁
     * @returns void
     */
    public setComponentProps(nodePath: string, componentType: string, props: Readonly<Record<string, unknown>>): void {
        const type = this._resolveComponentTypeKey(componentType);
        const nodeIndex = this.findNodeIndex(nodePath);
        const componentIndex = this._findComponentIndex(nodeIndex, type);
        if (componentIndex == null) {
            throw new Error(`lumen_24_component_missing:${type}`);
        }
        const component = this._entries[componentIndex];
        if (component == null) {
            throw new Error(`lumen_24_component_missing:${type}`);
        }
        if (!type.startsWith('cc.')) {
            throw new Error(`lumen_24_compSet_script_props_unsupported:${type}`);
        }
        this._applyComponentProps(type, component, props);
    }

    /**
     * @description 绑定 SpriteFrame uuid。
     * @param nodePath 节点路径
     * @param spriteFrameUuid uuid
     * @returns void
     */
    public bindSpriteFrame(nodePath: string, spriteFrameUuid: string): void {
        const uuid = spriteFrameUuid.trim();
        if (uuid.length === 0) {
            throw new Error('lumen_24_sprite_frame_uuid_empty');
        }
        const nodeIndex = this.findNodeIndex(nodePath);
        let componentIndex = this._findComponentIndex(nodeIndex, 'cc.Sprite');
        if (componentIndex == null) {
            componentIndex = this.attachBuiltinComponent(nodePath, 'cc.Sprite');
        }
        const component = this._entries[componentIndex];
        if (component == null) {
            throw new Error('lumen_24_component_missing:cc.Sprite');
        }
        component._spriteFrame = { __uuid__: uuid };
    }

    /**
     * @description 挂载脚本组件（`__type__` = compressedUuid；无 CompPrefabInfo）。
     * @param nodePath 节点路径
     * @param compressedUuid 压缩 UUID
     * @returns 组件下标
     */
    public attachScriptComponent(nodePath: string, compressedUuid: string): number {
        const type = compressedUuid.trim();
        if (type.length === 0) {
            throw new Error('lumen_24_compressed_uuid_empty');
        }
        const nodeIndex = this.findNodeIndex(nodePath);
        const node = this._entries[nodeIndex];
        if (this._isScene(node)) {
            throw new Error('lumen_24_cannot_attach_on_scene');
        }
        if (!this._isCcNode(node)) {
            throw new Error(`lumen_24_not_a_node:${nodeIndex}`);
        }
        const existing = this._findComponentIndex(nodeIndex, type);
        if (existing != null) {
            return existing;
        }
        const componentIndex = this._entries.length;
        this._entries.push({
            __type__: type,
            _name: '',
            _objFlags: 0,
            node: { __id__: nodeIndex },
            _enabled: true,
        });
        const components = Array.isArray(node._components) ? [...node._components] : [];
        components.push({ __id__: componentIndex });
        node._components = components;
        return componentIndex;
    }

    /**
     * @description 绑定 Button.clickEvents（2.4：`_componentId` = 脚本压缩 UUID）。
     * @param buttonNodePath 按钮节点
     * @param targetNodePath 事件目标节点
     * @param componentDisplay 展示用组件名（可空）
     * @param handler 方法名
     * @param customEventData 自定义数据
     * @param componentId 脚本 compressedUuid
     * @returns ClickEvent 下标
     */
    public bindClickEvent(
        buttonNodePath: string,
        targetNodePath: string,
        componentDisplay: string,
        handler: string,
        customEventData: string,
        componentId: string,
    ): number {
        const handlerName = handler.trim();
        if (handlerName.length === 0) {
            throw new Error('lumen_24_bindClick_handler_empty');
        }
        const componentIdTrimmed = componentId.trim();
        if (componentIdTrimmed.length === 0) {
            throw new Error('lumen_24_bindClick_componentId_empty');
        }
        const buttonNodeIndex = this.findNodeIndex(buttonNodePath);
        const targetNodeIndex = this.findNodeIndex(targetNodePath);
        let buttonComponentIndex = this._findComponentIndex(buttonNodeIndex, 'cc.Button');
        if (buttonComponentIndex == null) {
            buttonComponentIndex = this.attachBuiltinComponent(buttonNodePath, 'cc.Button');
        }
        const buttonComponent = this._entries[buttonComponentIndex];
        if (buttonComponent == null) {
            throw new Error('lumen_24_component_missing:cc.Button');
        }
        const clickEventIndex = this._entries.length;
        this._entries.push({
            __type__: 'cc.ClickEvent',
            target: { __id__: targetNodeIndex },
            component: componentDisplay,
            _componentId: componentIdTrimmed,
            handler: handlerName,
            customEventData,
        });
        const existing = Array.isArray(buttonComponent.clickEvents) ? [...buttonComponent.clickEvents] : [];
        existing.push({ __id__: clickEventIndex });
        buttonComponent.clickEvents = existing;
        return clickEventIndex;
    }

    /**
     * @description 把节点/组件引用写入组件字段（2.4：`{ __id__ }`）。
     * @param nodePath 持有组件的节点
     * @param componentType 组件类型或脚本 compressedUuid
     * @param field 字段名
     * @param ref 引用目标（节点下标或组件下标）
     * @returns void
     */
    public bindRef(
        nodePath: string,
        componentType: string,
        field: string,
        ref: Readonly<{ readonly kind: 'node' | 'component'; readonly index: number }>,
    ): void {
        const fieldName = field.trim();
        if (fieldName.length === 0) {
            throw new Error('lumen_24_bindRef_field_empty');
        }
        const type = this._resolveComponentTypeKey(componentType);
        const ownerIndex = this.findNodeIndex(nodePath);
        const componentIndex = this._findComponentIndex(ownerIndex, type);
        if (componentIndex == null) {
            throw new Error(`lumen_24_component_missing:${type}`);
        }
        const component = this._entries[componentIndex];
        if (component == null) {
            throw new Error(`lumen_24_component_missing:${type}`);
        }
        if (ref.kind === 'node' && !this._isHierarchyNode(this._entries[ref.index])) {
            throw new Error(`lumen_24_bindRef_node_invalid:${ref.index}`);
        }
        if (ref.kind === 'component') {
            const target = this._entries[ref.index];
            if (target == null || typeof target.__type__ !== 'string' || target.__type__ === 'cc.Node') {
                throw new Error(`lumen_24_bindRef_component_invalid:${ref.index}`);
            }
        }
        const refValue = { __id__: ref.index };
        const keys = Lumen24SerializedFields.refFieldKeys(type, fieldName);
        for (const key of keys) {
            component[key] = refValue;
        }
    }

    /**
     * @description 按配方在父节点下构建子树。
     * @param parentPath 父路径
     * @param recipe 单棵或数组
     * @returns 创建的节点路径列表（仅顶层）
     */
    public buildFromRecipe(parentPath: string, recipe: ILumen24NodeRecipe | readonly ILumen24NodeRecipe[]): readonly string[] {
        const recipes = Array.isArray(recipe) ? recipe : [recipe];
        const created: string[] = [];
        for (const item of recipes) {
            created.push(this._buildRecipeNode(parentPath, item));
        }
        return created;
    }

    /**
     * @description 导出条目深拷贝（compileRecipe）。
     * @returns 条目
     */
    public cloneEntries(): Lumen24PrefabEntry[] {
        return JSON.parse(JSON.stringify(this._entries)) as Lumen24PrefabEntry[];
    }

    /**
     * @description 写到工程磁盘。
     * @param projectRoot 工程根
     * @returns 绝对路径
     */
    public save(projectRoot: string): string {
        const absolutePath = join(projectRoot, this._relativePath);
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, `${JSON.stringify(this._entries, null, 2)}\n`, 'utf8');
        // reset/scaffold 常删掉 .meta；无 meta 时 AssetDB update 会 copySubMetas of null。
        const lower = this._relativePath.toLowerCase();
        if (lower.endsWith('.prefab')) {
            Lumen24SerializedAssetMeta.ensure(absolutePath, 'prefab');
        } else if (lower.endsWith('.fire')) {
            Lumen24SerializedAssetMeta.ensure(absolutePath, 'scene');
        }
        return absolutePath;
    }

    /**
     * @description 目标是否已存在。
     * @param projectRoot 工程根
     * @returns 是否存在
     */
    public existsOnDisk(projectRoot: string): boolean {
        return existsSync(join(projectRoot, this._relativePath));
    }

    /**
     * @description 创建空节点条目。
     * @param name 节点名
     * @param parentIndex 父下标；根为 null
     * @param prefabInfoIndex PrefabInfo 下标
     * @returns 节点条目
     */
    private static _createEmptyNode(name: string, parentIndex: number | null, prefabInfoIndex: number): Lumen24PrefabEntry {
        return {
            __type__: 'cc.Node',
            _name: name,
            _objFlags: 0,
            _parent: parentIndex == null ? null : { __id__: parentIndex },
            _children: [],
            _active: true,
            _components: [],
            _prefab: { __id__: prefabInfoIndex },
            _opacity: 255,
            _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
            _contentSize: { __type__: 'cc.Size', width: 0, height: 0 },
            _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
            _trs: {
                __type__: 'TypedArray',
                ctor: 'Float64Array',
                array: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
            },
            _eulerAngles: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _id: '',
        };
    }

    /**
     * @description 生成 PrefabInfo.fileId。
     * @returns fileId
     */
    private static _createFileId(): string {
        return randomBytes(12).toString('base64').replace(/[+/=]/g, 'x').slice(0, 22);
    }

    /**
     * @description 是否为层次节点（`cc.Node` 或 `cc.Scene`）。
     * @param entry 条目
     * @returns 是否层次节点
     */
    private _isHierarchyNode(entry: Lumen24PrefabEntry | undefined): boolean {
        return entry != null && (entry.__type__ === 'cc.Node' || entry.__type__ === 'cc.Scene');
    }

    /**
     * @description 是否为普通 `cc.Node`。
     * @param entry 条目
     * @returns 是否 Node
     */
    private _isCcNode(entry: Lumen24PrefabEntry | undefined): boolean {
        return entry != null && entry.__type__ === 'cc.Node';
    }

    /**
     * @description 是否为场景根。
     * @param entry 条目
     * @returns 是否 Scene
     */
    private _isScene(entry: Lumen24PrefabEntry | undefined): boolean {
        return entry != null && entry.__type__ === 'cc.Scene';
    }

    /**
     * @description 节点显示名（官方 `.fire` 的 Scene 可能缺 `_name`）。
     * @param node 节点
     * @returns 名称
     */
    private _nodeDisplayName(node: Lumen24PrefabEntry): string {
        if (typeof node._name === 'string' && node._name.trim().length > 0) {
            return node._name;
        }
        if (this._isScene(node)) {
            return 'New Node';
        }
        return String(node._name ?? '');
    }

    /**
     * @description 打开缺名 Scene 时补 `_name`，稳定路径 API。
     * @returns void
     */
    private _ensureSceneRootName(): void {
        const root = this._entries[this.rootIndex()];
        if (!this._isScene(root)) {
            return;
        }
        if (typeof root._name !== 'string' || root._name.trim().length === 0) {
            root._name = 'New Node';
        }
    }

    /**
     * @description 读直接子节点下标。
     * @param parentIndex 父下标
     * @param childName 子名
     * @returns 下标或 null
     */
    private _findDirectChildIndex(parentIndex: number, childName: string): number | null {
        for (const childIndex of this._childIndices(parentIndex)) {
            const child = this._entries[childIndex];
            if (this._isCcNode(child) && String(child._name) === childName) {
                return childIndex;
            }
        }
        return null;
    }

    /**
     * @description 列出直接子节点下标。
     * @param parentIndex 父下标
     * @returns 下标列表
     */
    private _childIndices(parentIndex: number): number[] {
        const node = this._entries[parentIndex];
        if (!this._isHierarchyNode(node) || !Array.isArray(node._children)) {
            return [];
        }
        const result: number[] = [];
        for (const childRef of node._children) {
            if (childRef == null || typeof childRef !== 'object') {
                continue;
            }
            const childId = (childRef as { __id__?: unknown }).__id__;
            if (typeof childId === 'number' && this._isHierarchyNode(this._entries[childId])) {
                result.push(childId);
            }
        }
        return result;
    }

    /**
     * @description 由下标反推路径。
     * @param index 节点下标
     * @returns 路径
     */
    private _pathForIndex(index: number): string {
        const parts: string[] = [];
        let current = index;
        const guard = new Set<number>();
        while (this._isHierarchyNode(this._entries[current]) && !guard.has(current)) {
            guard.add(current);
            parts.unshift(this._nodeDisplayName(this._entries[current]));
            if (current === this.rootIndex()) {
                break;
            }
            const parentRef = this._entries[current]._parent;
            if (parentRef == null || typeof parentRef !== 'object' || Array.isArray(parentRef)) {
                break;
            }
            const parentId = (parentRef as { __id__?: unknown }).__id__;
            if (typeof parentId !== 'number') {
                break;
            }
            current = parentId;
        }
        return parts.join('/');
    }

    /**
     * @description 递归建树。
     * @param index 节点下标
     * @param prefix 祖先名
     * @returns 树节点
     */
    private _buildTreeNode(index: number, prefix: readonly string[]): ILumen24TreeNode {
        const node = this._entries[index];
        if (!this._isHierarchyNode(node)) {
            throw new Error(`lumen_24_not_a_node:${index}`);
        }
        const name = this._nodeDisplayName(node);
        const pathParts = [...prefix, name];
        return {
            path: pathParts.join('/'),
            name,
            index,
            active: node._active !== false,
            children: this._childIndices(index).map((childIndex) => this._buildTreeNode(childIndex, pathParts)),
        };
    }

    /**
     * @description 读取 `_trs.array`（长度 10）。
     * @param node 节点
     * @returns 可变拷贝
     */
    private _readTrs(node: Lumen24PrefabEntry): number[] {
        const defaults = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
        const trs = node._trs;
        if (trs == null || typeof trs !== 'object' || Array.isArray(trs)) {
            return [...defaults];
        }
        const array = (trs as { array?: unknown }).array;
        if (!Array.isArray(array)) {
            return [...defaults];
        }
        const result = [...defaults];
        for (let i = 0; i < Math.min(10, array.length); i += 1) {
            const value = array[i];
            result[i] = typeof value === 'number' && Number.isFinite(value) ? value : defaults[i];
        }
        return result;
    }

    /**
     * @description 递归构建单个配方节点。
     * @param parentPath 父路径
     * @param recipe 配方
     * @returns 新节点路径
     */
    private _buildRecipeNode(parentPath: string, recipe: ILumen24NodeRecipe): string {
        const name = recipe.name.trim();
        if (name.length === 0) {
            throw new Error('lumen_24_recipe_name_empty');
        }
        const templateId = Lumen24Templates.normalize(recipe.template);
        const absolute = Lumen24Templates.resolveAbsolutePath(templateId);
        let path: string;
        if (absolute != null) {
            path = this.addChildFromTemplate(parentPath, absolute, name);
        } else {
            path = this.addEmptyChild(parentPath, name);
            const builtin = Lumen24Templates.builtinFor(templateId);
            if (builtin != null) {
                this.attachBuiltinComponent(path, builtin);
            }
        }
        for (const componentType of recipe.components ?? []) {
            const trimmed = componentType.trim();
            if (trimmed.length === 0) {
                continue;
            }
            if (trimmed.startsWith('cc.') || trimmed === 'Sprite' || trimmed === 'Label' || trimmed === 'Button') {
                const normalized = Lumen24BuiltinComponents.normalizeType(trimmed);
                if (this._findComponentIndex(this.findNodeIndex(path), normalized) == null) {
                    this.attachBuiltinComponent(path, normalized);
                }
                continue;
            }
            if (this._findComponentIndex(this.findNodeIndex(path), trimmed) == null) {
                this.attachScriptComponent(path, trimmed);
            }
        }
        if (recipe.nodeProps != null) {
            this.setNodeProps(path, this._asNodePropsPatch(recipe.nodeProps));
        }
        for (const child of recipe.children ?? []) {
            this._buildRecipeNode(path, child);
        }
        for (const [componentType, patch] of this._collectRecipeComponentPatches(recipe, path)) {
            this.setComponentProps(path, componentType, patch);
        }
        return path;
    }

    /**
     * @description 合并配方组件补丁。
     * @param recipe 配方
     * @param nodePath 节点路径
     * @returns 类型-补丁对
     */
    private _collectRecipeComponentPatches(
        recipe: ILumen24NodeRecipe,
        nodePath: string,
    ): ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> {
        const byType = new Map<string, Record<string, unknown>>();
        if (recipe.props != null) {
            const componentType = recipe.propComponent ?? this._inferRecipeComponentType(recipe, nodePath);
            if (componentType == null) {
                throw new Error(`lumen_24_recipe_props_need_propComponent:${recipe.name}`);
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
     * @description 推断 props 目标组件。
     * @param recipe 配方
     * @param nodePath 节点
     * @returns 类型或 null
     */
    private _inferRecipeComponentType(recipe: ILumen24NodeRecipe, nodePath: string): string | null {
        if (recipe.propComponent != null && recipe.propComponent.trim().length > 0) {
            return recipe.propComponent.trim();
        }
        const templateId = Lumen24Templates.normalize(recipe.template);
        const builtin = Lumen24Templates.builtinFor(templateId);
        if (builtin != null) {
            return builtin;
        }
        if (recipe.components != null && recipe.components.length > 0) {
            return recipe.components[0] ?? null;
        }
        const types = this.inspectNode(nodePath).components.filter((type) => type.startsWith('cc.'));
        return types[0] ?? null;
    }

    /**
     * @description 收窄 nodeProps。
     * @param props 原始
     * @returns 补丁
     */
    private _asNodePropsPatch(props: Readonly<Record<string, unknown>>): ILumen24NodePropsPatch {
        const patch: {
            active?: boolean;
            opacity?: number;
            x?: number;
            y?: number;
            z?: number;
            scaleX?: number;
            scaleY?: number;
            scaleZ?: number;
        } = {};
        if (typeof props.active === 'boolean') {
            patch.active = props.active;
        }
        if (typeof props.opacity === 'number') {
            patch.opacity = props.opacity;
        }
        const position = props.position;
        if (position != null && typeof position === 'object' && !Array.isArray(position)) {
            const record = position as Record<string, unknown>;
            if (typeof record.x === 'number') {
                patch.x = record.x;
            }
            if (typeof record.y === 'number') {
                patch.y = record.y;
            }
            if (typeof record.z === 'number') {
                patch.z = record.z;
            }
        }
        if (typeof props.x === 'number') {
            patch.x = props.x;
        }
        if (typeof props.y === 'number') {
            patch.y = props.y;
        }
        if (typeof props.z === 'number') {
            patch.z = props.z;
        }
        if (typeof props.scaleX === 'number') {
            patch.scaleX = props.scaleX;
        }
        if (typeof props.scaleY === 'number') {
            patch.scaleY = props.scaleY;
        }
        if (typeof props.scaleZ === 'number') {
            patch.scaleZ = props.scaleZ;
        }
        return patch;
    }

    /**
     * @description 将用户组件标识解析为 Prefab `__type__` 键。
     * @param componentType builtin 或脚本 compressedUuid
     * @returns 键
     */
    private _resolveComponentTypeKey(componentType: string): string {
        const trimmed = componentType.trim();
        if (trimmed.length === 0) {
            throw new Error('lumen_24_component_type_empty');
        }
        if (trimmed.startsWith('cc.') || trimmed === 'Sprite' || trimmed === 'Label' || trimmed === 'Button' || trimmed === 'UITransform') {
            return Lumen24BuiltinComponents.normalizeType(trimmed);
        }
        return trimmed;
    }

    /**
     * @description 查找节点上某类型组件下标。
     * @param nodeIndex 节点下标
     * @param componentType 规范类型
     * @returns 下标或 null
     */
    private _findComponentIndex(nodeIndex: number, componentType: string): number | null {
        const node = this._entries[nodeIndex];
        if (!this._isCcNode(node) || !Array.isArray(node._components)) {
            return null;
        }
        for (const ref of node._components) {
            if (ref == null || typeof ref !== 'object') {
                continue;
            }
            const id = (ref as { __id__?: unknown }).__id__;
            if (typeof id !== 'number') {
                continue;
            }
            const component = this._entries[id];
            if (component != null && component.__type__ === componentType) {
                return id;
            }
        }
        return null;
    }

    /**
     * @description 应用 2.4 组件白名单补丁。
     * @param componentType 类型
     * @param component 组件条目
     * @param props 补丁
     * @returns void
     */
    private _applyComponentProps(componentType: string, component: Lumen24PrefabEntry, props: Readonly<Record<string, unknown>>): void {
        for (const [key, value] of Object.entries(props)) {
            if (key === 'enabled' && typeof value === 'boolean') {
                component._enabled = value;
                continue;
            }
            if (componentType === 'cc.Label') {
                if (key === 'string' && typeof value === 'string') {
                    component._N$string = value;
                    component._string = value;
                    continue;
                }
                if (key === 'fontSize' && typeof value === 'number') {
                    component._fontSize = value;
                    continue;
                }
                if (key === 'lineHeight' && typeof value === 'number') {
                    component._lineHeight = value;
                    continue;
                }
                if (key === 'overflow' && typeof value === 'number') {
                    component._N$overflow = value;
                    continue;
                }
            }
            if (componentType === 'cc.Sprite') {
                if ((key === 'spriteFrame' || key === 'spriteFrameUuid') && typeof value === 'string') {
                    component._spriteFrame = value.length === 0 ? null : { __uuid__: value };
                    continue;
                }
                if (key === 'type' && typeof value === 'number') {
                    component._type = value;
                    continue;
                }
                if (key === 'sizeMode' && typeof value === 'number') {
                    component._sizeMode = value;
                    continue;
                }
            }
            if (componentType === 'cc.Button') {
                if (key === 'interactable' && typeof value === 'boolean') {
                    component._N$interactable = value;
                    continue;
                }
                if (key === 'transition' && typeof value === 'number') {
                    component._N$transition = value;
                    component.transition = value;
                    continue;
                }
                if (key === 'zoomScale' && typeof value === 'number') {
                    component.zoomScale = value;
                    continue;
                }
            }
            if (componentType === 'cc.RichText') {
                if (key === 'string' && typeof value === 'string') {
                    component._N$string = value;
                    continue;
                }
                if (key === 'fontSize' && typeof value === 'number') {
                    component._N$fontSize = value;
                    continue;
                }
                if (key === 'lineHeight' && typeof value === 'number') {
                    component._N$lineHeight = value;
                    continue;
                }
                if (key === 'maxWidth' && typeof value === 'number') {
                    component._N$maxWidth = value;
                    continue;
                }
            }
            if (componentType === 'cc.ProgressBar') {
                if (key === 'progress' && typeof value === 'number') {
                    component._N$progress = value;
                    continue;
                }
                if (key === 'totalLength' && typeof value === 'number') {
                    component._N$totalLength = value;
                    continue;
                }
                if (key === 'reverse' && typeof value === 'boolean') {
                    component._N$reverse = value;
                    continue;
                }
            }
            if (componentType === 'cc.Widget') {
                const alignBits: Readonly<Record<string, number>> = {
                    isAlignTop: 1,
                    isAlignVerticalCenter: 2,
                    isAlignBottom: 4,
                    isAlignLeft: 8,
                    isAlignHorizontalCenter: 16,
                    isAlignRight: 32,
                };
                if (Object.prototype.hasOwnProperty.call(alignBits, key) && typeof value === 'boolean') {
                    const bit = alignBits[key] ?? 0;
                    const current = typeof component._alignFlags === 'number' ? component._alignFlags : 0;
                    component._alignFlags = value ? current | bit : current & ~bit;
                    continue;
                }
                if (key === 'top' && typeof value === 'number') {
                    component._top = value;
                    continue;
                }
                if (key === 'bottom' && typeof value === 'number') {
                    component._bottom = value;
                    continue;
                }
                if (key === 'left' && typeof value === 'number') {
                    component._left = value;
                    continue;
                }
                if (key === 'right' && typeof value === 'number') {
                    component._right = value;
                    continue;
                }
                if (key === 'alignMode' && typeof value === 'number') {
                    component.alignMode = value;
                    continue;
                }
            }
            if (componentType === 'cc.Graphics') {
                if (key === 'lineWidth' && typeof value === 'number') {
                    component._lineWidth = value;
                    continue;
                }
                if (key === 'miterLimit' && typeof value === 'number') {
                    component._miterLimit = value;
                    continue;
                }
                if (key === 'lineJoin' && typeof value === 'number') {
                    component._lineJoin = value;
                    continue;
                }
                if (key === 'lineCap' && typeof value === 'number') {
                    component._lineCap = value;
                    continue;
                }
            }
            if (componentType === 'cc.LabelOutline') {
                if (key === 'width' && typeof value === 'number') {
                    component._width = value;
                    continue;
                }
            }
            throw new Error(`lumen_24_comp_prop_unsupported:${componentType}.${key}`);
        }
    }

    /**
     * @description 读取组件类型列表。
     * @param node 节点
     * @returns 类型名
     */
    private _componentTypes(node: Lumen24PrefabEntry): string[] {
        if (!Array.isArray(node._components)) {
            return [];
        }
        const types: string[] = [];
        for (const ref of node._components) {
            if (ref == null || typeof ref !== 'object') {
                continue;
            }
            const id = (ref as { __id__?: unknown }).__id__;
            if (typeof id !== 'number') {
                continue;
            }
            const component = this._entries[id];
            if (component != null && typeof component.__type__ === 'string') {
                types.push(component.__type__);
            }
        }
        return types;
    }

    /**
     * @description 将子树条目置空（保留下标，避免大规模重编号）。
     * @param index 根下标
     * @returns void
     */
    private _nullifySubtree(index: number): void {
        const queue = [index];
        const seen = new Set<number>();
        while (queue.length > 0) {
            const current = queue.shift();
            if (current == null || seen.has(current)) {
                continue;
            }
            seen.add(current);
            for (const child of this._childIndices(current)) {
                queue.push(child);
            }
            const entry = this._entries[current];
            if (entry == null) {
                continue;
            }
            const prefabRef = entry._prefab;
            if (prefabRef != null && typeof prefabRef === 'object' && !Array.isArray(prefabRef)) {
                const infoId = (prefabRef as { __id__?: unknown }).__id__;
                if (typeof infoId === 'number' && this._entries[infoId]?.__type__ === 'cc.PrefabInfo') {
                    this._entries[infoId] = { __type__: 'cc.PrefabInfo', root: null, asset: null, fileId: '' };
                }
            }
            this._entries[current] = { __type__: 'cc.Node', _name: '', _objFlags: 0, _parent: null, _children: [], _active: false };
        }
    }
}
