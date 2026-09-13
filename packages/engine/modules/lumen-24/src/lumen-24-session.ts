import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
    Lumen24PrefabDocument,
    type ILumen24InspectNode,
    type ILumen24NodePropsPatch,
    type ILumen24TreeNode,
    type Lumen24PrefabEntry,
} from './lumen-24-prefab-document.js';
import type { ILumen24NodeRecipe } from './lumen-24-recipe-types.js';
import { Lumen24Templates } from './lumen-24-templates.js';

/**
 * @description 编辑器刷新适配器（2.4 AssetDB）。
 */
export interface ILumen24EditorRefreshAdapter {
    /**
     * @description 刷新相对路径列表。
     * @param projectRoot 工程根
     * @param relativePaths 相对路径
     * @returns 刷新结果
     */
    refresh(projectRoot: string, relativePaths: readonly string[]): Promise<{ readonly triggered: boolean; readonly detail?: unknown }>;
}

/**
 * @description scaffold 选项。
 */
export interface ILumen24ScaffoldOptions {
    /**
     * @description Prefab 或 `.fire` Scene 相对路径。
     */
    readonly prefabRelativePath: string;
    /**
     * @description 根节点名。
     */
    readonly rootName?: string;
    /**
     * @description 已存在时是否重置。
     */
    readonly reset?: boolean;
}

/**
 * @description Creator 2.4 lumen 会话：Prefab / `.fire` Scene 层次 CRUD + AssetDB 刷新。
 */
export class Lumen24Session {
    /** @description 工程根。 */
    private readonly _projectRoot: string;
    /** @description 刷新适配器。 */
    private readonly _editorRefresh: ILumen24EditorRefreshAdapter | null;
    /** @description 已打开文档。 */
    private _document: Lumen24PrefabDocument | null = null;

    /**
     * @description 创建会话。
     * @param projectRoot 工程根
     * @param editorRefresh 可选刷新
     */
    public constructor(projectRoot: string, editorRefresh: ILumen24EditorRefreshAdapter | null = null) {
        this._projectRoot = projectRoot;
        this._editorRefresh = editorRefresh;
    }

    /**
     * @description 工程根。
     * @returns 路径
     */
    public get projectRoot(): string {
        return this._projectRoot;
    }

    /**
     * @description 当前 Prefab 相对路径。
     * @returns 路径或 null
     */
    public get openedPrefabPath(): string | null {
        return this._document?.relativePath ?? null;
    }

    /**
     * @description 写 Prefab 到磁盘并打开（`empty` 空根；其它 template 克隆官方整树）。
     * @param options scaffold 选项
     * @param template 模板 id（缺省 empty）
     * @returns 相对路径
     */
    public scaffoldPrefab(options: ILumen24ScaffoldOptions, template: string = 'empty'): string {
        const relativePath = options.prefabRelativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        const lower = relativePath.toLowerCase();
        const isPrefab = lower.endsWith('.prefab');
        const isFire = lower.endsWith('.fire');
        if (!isPrefab && !isFire) {
            throw new Error(`lumen_24_scaffold_unsupported:${relativePath}`);
        }
        if (!relativePath.startsWith('assets/')) {
            throw new Error(`lumen_24_scaffold_outside_assets:${relativePath}`);
        }
        const absolutePath = join(this._projectRoot, relativePath);
        if (options.reset === true && existsSync(absolutePath)) {
            rmSync(absolutePath, { force: true });
            const metaPath = `${absolutePath}.meta`;
            if (existsSync(metaPath)) {
                rmSync(metaPath, { force: true });
            }
        }
        mkdirSync(dirname(absolutePath), { recursive: true });
        const rootName = options.rootName ?? (isFire ? 'New Node' : 'Root');
        const templateId = Lumen24Templates.normalize(template);
        let document: Lumen24PrefabDocument;
        if (isFire) {
            document = Lumen24PrefabDocument.createEmptyScene(relativePath, rootName);
        } else if (templateId === 'empty') {
            document = Lumen24PrefabDocument.createEmpty(relativePath, rootName);
        } else {
            const absolute = Lumen24Templates.resolveAbsolutePath(templateId);
            if (absolute == null) {
                document = Lumen24PrefabDocument.createEmpty(relativePath, rootName);
                const builtin = Lumen24Templates.builtinFor(templateId);
                if (builtin != null) {
                    document.save(this._projectRoot);
                    this._document = document;
                    document.attachBuiltinComponent(rootName, builtin);
                    document.save(this._projectRoot);
                    return relativePath;
                }
                throw new Error(`lumen_24_scaffold_template_missing:${templateId}`);
            }
            document = Lumen24PrefabDocument.cloneFromTemplate(relativePath, absolute, rootName);
        }
        document.save(this._projectRoot);
        this._document = document;
        return relativePath;
    }

    /**
     * @description 追加子节点：有整树模板则克隆，否则空节点 + 可选 builtin。
     * @param parentPath 父路径
     * @param name 子名
     * @param template 模板
     * @returns 新路径
     */
    public addChild(parentPath: string, name: string, template: string = 'empty'): string {
        const templateId = Lumen24Templates.normalize(template);
        const absolute = Lumen24Templates.resolveAbsolutePath(templateId);
        let path: string;
        if (absolute != null) {
            path = this._requireDocument().addChildFromTemplate(parentPath, absolute, name);
        } else {
            path = this._requireDocument().addEmptyChild(parentPath, name);
            const builtin = Lumen24Templates.builtinFor(templateId);
            if (builtin != null) {
                this._requireDocument().attachBuiltinComponent(path, builtin);
            }
        }
        this.save();
        return path;
    }

    /**
     * @description 追加空子节点并保存。
     * @param parentPath 父路径
     * @param name 子名
     * @returns 新路径
     */
    public addEmptyChild(parentPath: string, name: string): string {
        return this.addChild(parentPath, name, 'empty');
    }

    /**
     * @description 打开已有 Prefab 或 `.fire` Scene。
     * @param prefabRelativePath 相对路径
     * @returns 文档
     */
    public openPrefab(prefabRelativePath: string): Lumen24PrefabDocument {
        this._document = Lumen24PrefabDocument.open(this._projectRoot, prefabRelativePath);
        return this._document;
    }

    /**
     * @description 保存当前 Prefab。
     * @returns 相对路径
     */
    public save(): string {
        const document = this._requireDocument();
        document.save(this._projectRoot);
        return document.relativePath;
    }

    /**
     * @description 层次树。
     * @returns 树
     */
    public inspectTree(): ILumen24TreeNode {
        return this._requireDocument().inspectTree();
    }

    /**
     * @description 检视节点。
     * @param nodePath 可选路径
     * @returns 摘要
     */
    public inspectNode(nodePath?: string): ILumen24InspectNode {
        return this._requireDocument().inspectNode(nodePath);
    }

    /**
     * @description 删除节点并保存。
     * @param nodePath 路径
     * @returns void
     */
    public removeNode(nodePath: string): void {
        this._requireDocument().removeNode(nodePath);
        this.save();
    }

    /**
     * @description 重命名并保存。
     * @param nodePath 路径
     * @param name 新名
     * @returns 新路径
     */
    public renameNode(nodePath: string, name: string): string {
        const path = this._requireDocument().renameNode(nodePath, name);
        this.save();
        return path;
    }

    /**
     * @description 重排子节点并保存。
     * @param parentPath 父路径
     * @param childName 子名
     * @param index 目标下标
     * @returns void
     */
    public reorderChild(parentPath: string, childName: string, index: number): void {
        this._requireDocument().reorderChild(parentPath, childName, index);
        this.save();
    }

    /**
     * @description 写节点属性并保存。
     * @param nodePath 路径
     * @param props 补丁
     * @returns 摘要
     */
    public setNodeProps(nodePath: string, props: ILumen24NodePropsPatch): ILumen24InspectNode {
        const node = this._requireDocument().setNodeProps(nodePath, props);
        this.save();
        return node;
    }

    /**
     * @description 挂载内置组件并保存。
     * @param nodePath 节点
     * @param builtinType 类型
     * @returns 组件下标
     */
    public attachBuiltinComponent(nodePath: string, builtinType: string): number {
        const index = this._requireDocument().attachBuiltinComponent(nodePath, builtinType);
        this.save();
        return index;
    }

    /**
     * @description 移除组件并保存。
     * @param nodePath 节点
     * @param componentType 类型
     * @returns void
     */
    public removeComponent(nodePath: string, componentType: string): void {
        this._requireDocument().removeComponent(nodePath, componentType);
        this.save();
    }

    /**
     * @description 写组件属性并保存。
     * @param nodePath 节点
     * @param componentType 类型
     * @param props 补丁
     * @returns void
     */
    public setComponentProps(nodePath: string, componentType: string, props: Readonly<Record<string, unknown>>): void {
        this._requireDocument().setComponentProps(nodePath, componentType, props);
        this.save();
    }

    /**
     * @description 绑定 SpriteFrame 并保存。
     * @param nodePath 节点
     * @param spriteFrameUuid uuid
     * @returns void
     */
    public bindSpriteFrame(nodePath: string, spriteFrameUuid: string): void {
        this._requireDocument().bindSpriteFrame(nodePath, spriteFrameUuid);
        this.save();
    }

    /**
     * @description 挂载脚本组件并保存。
     * @param nodePath 节点
     * @param compressedUuid 压缩 UUID
     * @returns 组件下标
     */
    public attachScriptComponent(nodePath: string, compressedUuid: string): number {
        const index = this._requireDocument().attachScriptComponent(nodePath, compressedUuid);
        this.save();
        return index;
    }

    /**
     * @description 绑定点击事件并保存。
     * @param buttonNodePath 按钮节点
     * @param targetNodePath 目标节点
     * @param componentDisplay 展示名
     * @param handler 方法名
     * @param customEventData 自定义数据
     * @param componentId 压缩 UUID
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
        const index = this._requireDocument().bindClickEvent(
            buttonNodePath,
            targetNodePath,
            componentDisplay,
            handler,
            customEventData,
            componentId,
        );
        this.save();
        return index;
    }

    /**
     * @description 绑定引用并保存。
     * @param nodePath 持有组件的节点
     * @param componentType 组件
     * @param field 字段
     * @param ref 引用
     * @returns void
     */
    public bindRef(
        nodePath: string,
        componentType: string,
        field: string,
        ref: Readonly<{ readonly kind: 'node' | 'component'; readonly index: number }>,
    ): void {
        this._requireDocument().bindRef(nodePath, componentType, field, ref);
        this.save();
    }

    /**
     * @description 按配方构建并保存。
     * @param parentPath 父路径
     * @param recipe 配方
     * @returns 顶层路径
     */
    public buildFromRecipe(parentPath: string, recipe: ILumen24NodeRecipe | readonly ILumen24NodeRecipe[]): readonly string[] {
        const created = this._requireDocument().buildFromRecipe(parentPath, recipe);
        this.save();
        return created;
    }

    /**
     * @description 当前文档条目深拷贝。
     * @returns 条目
     */
    public cloneEntries(): Lumen24PrefabEntry[] {
        return this._requireDocument().cloneEntries();
    }

    /**
     * @description 请求编辑器刷新。
     * @param relativePaths 相对路径；空则刷当前打开
     * @returns 刷新结果
     */
    public async requestEditorRefresh(
        relativePaths: readonly string[] = [],
    ): Promise<{ readonly triggered: boolean; readonly detail?: unknown }> {
        if (this._editorRefresh == null) {
            return { triggered: false, detail: 'lumen_24_refresh_adapter_missing' };
        }
        const targets = relativePaths.length > 0 ? relativePaths : this._document != null ? [this._document.relativePath] : [];
        if (targets.length === 0) {
            return { triggered: false, detail: 'lumen_24_refresh_targets_empty' };
        }
        return this._editorRefresh.refresh(this._projectRoot, targets);
    }

    /**
     * @description 要求已打开文档。
     * @returns 文档
     */
    private _requireDocument(): Lumen24PrefabDocument {
        if (this._document == null) {
            throw new Error('lumen_24_prefab_not_open');
        }
        return this._document;
    }
}

export { Lumen24RuntimeAssetRefreshAdapter } from './lumen-24-runtime-asset-refresh-adapter.js';
