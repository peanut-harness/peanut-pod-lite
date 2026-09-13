import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'path';

import { LumenCatalogGateway } from './io/catalog-gateway';
import { LumenCocosInfoProbe } from './schema/cocos-info-probe';
import type { ILumenCocosInfoReport } from './schema/cocos-info-probe';
import { LumenCocosVersion } from './schema/cocos-version';
import { LumenComponentPropertySchema } from './schema/component-property';
import { LumenEngineSerializableProbe } from './schema/engine-serializable-probe';
import type { ILumenPropertyDescriptor, ILumenPropertyFieldSpec } from './schema/component-property';
import type { ILumenCuratedTypeLifecycle } from './schema/codec';
import { LumenNodeConventions } from './schema/node-conventions';
import { LumenDefaultTemplateRoot } from './templates/default-root';
import { LumenTemplateAlias } from './templates/template-alias';
import { LumenHierarchyEntry, type LumenAssetKind } from './hierarchy/entry';
import type { ILumenMaterialInspect } from './standalone/material';
import {
    LumenStandaloneAsset,
    type ILumenStandaloneAssetDocument,
    type ILumenStandaloneInspect,
} from './standalone/registry';
import { LumenAssetPatchUuidGuard } from './standalone/asset-patch-uuid-guard';
import { LumenNoopEditorRefreshAdapter } from './io/noop-refresh';
import { LumenPrefabDocument } from './hierarchy/prefab-document';
import { LumenPrefabInspector } from './hierarchy/prefab-inspector';
import type { ILumenNodeInspect, ILumenTreeNode } from './hierarchy/prefab-inspector';
import {
    LumenScriptPropertyExtractor,
    type ILumenScriptPropertyExtractResult,
} from './hierarchy/script-property-extractor';
import { LumenTemplateCatalog } from './templates/catalog';
import type { ILumenTemplateEntry } from './templates/catalog';
import type {
    ILumenAddChildFromSpecOptions,
    ILumenAddChildFromTemplateOptions,
    ILumenAttachComponentOptions,
    ILumenBindClickOptions,
    ILumenBindSpriteOptions,
    ILumenBuildFromRecipeOptions,
    ILumenEditorRefreshAdapter,
    ILumenEditorRefreshResult,
    ILumenResolveQuery,
    ILumenScaffoldPrefabOptions,
    ILumenSessionOptions,
    ILumenSetAssetPropertyOptions,
    ILumenSetComponentPropertyOptions,
    ILumenSetNodePropertyOptions,
    LumenPhase,
} from './types';

/**
 * @description 脚本属性自动发现并注册的结果。
 */
export interface ILumenScriptPropertyEnsureResult {
    /** @description Prefab `__type__` / schema ownerKey（compressedUuid）。 */
    readonly ownerKey: string;
    /** @description 项目相对脚本路径。 */
    readonly sourcePath: string;
    /** @description 是否新注册（已存在则为 false）。 */
    readonly registered: boolean;
    /** @description 提取详情。 */
    readonly extract: ILumenScriptPropertyExtractResult;
}
/**
 * @description lumen 会话：按阶段编排落盘、脚手架、编辑器刷新、catalog 与绑定。
 */
export class LumenSession {
    /** @description 解析后的项目根。 */
    private readonly _projectRoot: string;

    /** @description default_prefab 模板根。 */
    private readonly _templateRoot: string | null;

    /** @description catalog 网关。 */
    private readonly _catalog: LumenCatalogGateway;

    /** @description 编辑器刷新适配器。 */
    private readonly _editorRefresh: ILumenEditorRefreshAdapter;

    /** @description 会话绑定的 Creator 版本。 */
    private readonly _cocosVersion: LumenCocosVersion;

    /** @description 按版本门控的属性表。 */
    private readonly _propertySchema: LumenComponentPropertySchema;

    /** @description 当前阶段。 */
    private _phase: LumenPhase = 'idle';

    /** @description 当前打开的 prefab / scene 文档。 */
    private _document: LumenPrefabDocument | null = null;

    /** @description 当前打开的非层次资产文档。 */
    private _standalone: ILumenStandaloneAssetDocument | null = null;

    /**
     * @description 创建会话；未传 templateRoot 时使用产品 `default_prefab`。
     * @param options 会话选项
     * @param catalog 可选 catalog 网关
     */
    public constructor(options: ILumenSessionOptions, catalog: LumenCatalogGateway = new LumenCatalogGateway()) {
        this._projectRoot = this._resolveProjectRoot(options.projectRoot);
        this._templateRoot = this._resolveTemplateRoot(options.templateRoot, options.templateCacheDir);
        this._catalog = catalog;
        this._editorRefresh = options.editorRefresh ?? new LumenNoopEditorRefreshAdapter();
        this._cocosVersion = this._resolveCocosVersion(options.cocosVersion);
        this._propertySchema = new LumenComponentPropertySchema(this._cocosVersion);
        if (options.engineRoot != null && options.engineRoot.trim().length > 0) {
            const engineRoot = this._resolveAbsolute(options.engineRoot);
            const loaded = LumenEngineSerializableProbe.loadFromPath(engineRoot);
            this._propertySchema.bindEngineSerializableCatalog(loaded.catalog);
        }
    }

    /**
     * @description 当前阶段。
     * @returns 阶段枚举
     */
    public get phase(): LumenPhase {
        return this._phase;
    }

    /**
     * @description 当前打开文档种类（Prefab、Scene 或独立资产）。
     * @returns `prefab` / `scene` 或已登记独立资产种类；未打开时为 `null`
     */
    public get openedAssetKind(): LumenAssetKind | null {
        if (this._standalone != null) {
            return this._standalone.kind;
        }
        return this._document?.assetKind ?? null;
    }

    /**
     * @description 项目根绝对路径。
     * @returns 路径
     */
    public get projectRoot(): string {
        return this._projectRoot;
    }

    /**
     * @description 会话使用的 Creator 版本。
     * @returns 版本对象
     */
    public get cocosVersion(): LumenCocosVersion {
        return this._cocosVersion;
    }

    /**
     * @description 会话属性表白名单。
     * @returns 属性表
     */
    public get propertySchema(): LumenComponentPropertySchema {
        return this._propertySchema;
    }

    /**
     * @description 列出当前模板根下可用 template id。
     * @returns 模板列表
     */
    public listTemplates(): readonly ILumenTemplateEntry[] {
        if (this._templateRoot == null) {
            throw new Error('lumen_template_root_unresolved');
        }
        return LumenTemplateCatalog.list(this._templateRoot);
    }

    /**
     * @description 描述组件或节点属性（含 kind / 枚举提示）。
     * @param componentType 省略则返回组件清单 + 节点属性；传入如 `cc.Label`、脚本名、路径或 compressedUuid
     * @returns 描述载荷
     */
    public describeSchema(componentType?: string): {
        readonly cocos: string;
        readonly components?: readonly string[];
        readonly nodeProps?: readonly ILumenPropertyDescriptor[];
        readonly conventions?: ReturnType<typeof LumenNodeConventions.describeConventions>;
        readonly scriptPropertyDiscovery?: ReturnType<typeof LumenScriptPropertyExtractor.describeDiscovery>;
        readonly registeredScripts?: readonly string[];
        readonly component?: string;
        readonly props?: readonly ILumenPropertyDescriptor[];
        readonly layerRole?: ReturnType<typeof LumenNodeConventions.layerRoleForComponent>;
        readonly rendererExclusive?: boolean;
        readonly lifecycle?: ILumenCuratedTypeLifecycle;
        readonly scriptEnsure?: ILumenScriptPropertyEnsureResult;
        readonly inspectorParity?: {
            readonly attach: 'engine-deny-list';
            readonly fields: 'curated+serialized-instance+engine-serializable';
            readonly engineCatalogSize: number;
            readonly next: readonly string[];
        };
    } {
        if (componentType == null || componentType.trim().length === 0) {
            return {
                cocos: this._cocosVersion.toString(),
                components: this._propertySchema.listSupportedComponents(),
                nodeProps: this._propertySchema.describeNodeProperties(),
                conventions: LumenNodeConventions.describeConventions(),
                scriptPropertyDiscovery: LumenScriptPropertyExtractor.describeDiscovery(),
                registeredScripts: this._propertySchema.listRegisteredScripts(),
                inspectorParity: {
                    attach: 'engine-deny-list',
                    fields: 'curated+serialized-instance+engine-serializable',
                    engineCatalogSize: this._propertySchema.engineCatalogSize(),
                    next: [],
                },
            };
        }
        const trimmed = componentType.trim();
        let scriptEnsure: ILumenScriptPropertyEnsureResult | undefined;
        if (!this._isBuiltinOrRegistered(trimmed)) {
            scriptEnsure = this.ensureScriptProperties({ query: trimmed }) ?? undefined;
        }
        const ownerKey = scriptEnsure?.ownerKey ?? trimmed;
        const lifecycle = this._propertySchema.describeComponentLifecycle(ownerKey);
        return {
            cocos: this._cocosVersion.toString(),
            component: ownerKey,
            props: this._propertySchema.describeComponent(ownerKey),
            layerRole: LumenNodeConventions.layerRoleForComponent(ownerKey),
            rendererExclusive: LumenNodeConventions.isRendererExclusive(ownerKey),
            ...(lifecycle != null ? { lifecycle } : {}),
            ...(scriptEnsure != null ? { scriptEnsure } : {}),
        };
    }

    /**
     * @description 只读树巡检当前打开的 prefab / scene。
     * @returns 根树
     */
    public inspectTree(): ILumenTreeNode {
        this._assertHierarchyDocument();
        return LumenPrefabInspector.buildTree(this._document!.entries);
    }

    /**
     * @description 只读巡检节点。
     * @param nodePath 节点路径
     * @returns 巡检结果
     */
    public inspectNode(nodePath: string): ILumenNodeInspect {
        this._assertHierarchyDocument();
        this._ensureScriptSchemasOnNode(nodePath);
        return LumenPrefabInspector.inspectNode(
            this._document!.entries,
            nodePath,
            (path) => this._document!.findNodeIndex(path),
            this._propertySchema,
            (entryIndex) => this._document!.pathForEntryIndex(entryIndex),
        );
    }

    /**
     * @description 检视当前打开的非层次资产。
     * @param query 地形可传 `{ region }`
     * @returns 快照
     */
    public inspectAsset(query?: Readonly<Record<string, unknown>>): ILumenStandaloneInspect {
        this._assertStandaloneDocument();
        return this._requireStandalone().inspect(query);
    }

    /**
     * @description 检视当前打开的材质。
     * @returns 材质快照
     */
    public inspectMaterial(): ILumenMaterialInspect {
        const snapshot = this.inspectAsset();
        if (snapshot.kind !== 'material') {
            throw new Error('lumen_material_not_open');
        }
        return snapshot;
    }

    /**
     * @description 写入当前非层次资产的 Inspector 字段。
     * 补丁中的 Creator uuid（含 `@子资源`）须能在 asset-catalog 中解析；空字符串表示清空，不校验。
     * @param options 补丁
     */
    public setAssetProperty(options: ILumenSetAssetPropertyOptions): void {
        this._assertStandaloneDocument();
        const uuidRefs = LumenAssetPatchUuidGuard.collect(options.patch);
        if (uuidRefs.length > 0) {
            // 须用最新索引：同会话内后写入的 stub / Import 结果否则会 miss。
            this.refreshCatalog();
            LumenAssetPatchUuidGuard.assertResolvable(
                (projectRoot, query) => this._catalog.resolveOne(projectRoot, query),
                this._projectRoot,
                options.patch,
            );
        }
        this._requireStandalone().applyPatch(options.patch);
    }

    /**
     * @description 汇总项目版本与可选引擎对照。
     * @param engineRoot 可选引擎根或 cc.d.ts 路径
     * @param gapPage 可选缺口分页
     * @returns 报告
     */
    public probeCocosInfo(
        engineRoot?: string,
        gapPage?: { readonly offset?: number; readonly limit?: number },
    ): ILumenCocosInfoReport {
        return LumenCocosInfoProbe.probe({
            projectRoot: this._projectRoot,
            cocosVersion: this._cocosVersion.toString(),
            engineRoot,
            gapOffset: gapPage?.offset,
            gapLimit: gapPage?.limit,
        });
    }

    /**
     * @description 批量写入文本资源到项目内路径（stage）。
     * @param files 相对路径 → 文本内容
     */
    public stageTextFiles(files: Readonly<Record<string, string>>): void {
        for (const [relativePath, content] of Object.entries(files)) {
            const absolutePath = join(this._projectRoot, relativePath);
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, content, 'utf8');
        }
        this._phase = 'staged';
    }

    /**
     * @description 创建或打开 prefab / scene 并固定根结构（scaffold）。
     * @param options 脚手架选项；扩展名决定 Prefab / Scene / 独立资产
     * @returns 相对路径
     */
    public scaffoldPrefab(options: ILumenScaffoldPrefabOptions): string {
        const relativePath = normalize(options.prefabRelativePath).replace(/\\/g, '/');
        const absolutePath = join(this._projectRoot, relativePath);
        const template = options.template ?? 'empty';
        if (!existsSync(absolutePath)) {
            const lower = relativePath.toLowerCase();
            if (lower.endsWith('.plist')) {
                throw new Error(`lumen_plist_scaffold_unsupported:${relativePath}`);
            }
            if (lower.endsWith('.json')) {
                throw new Error(`lumen_json_scaffold_unsupported:${relativePath}`);
            }
        }
        if (options.reset === true && existsSync(absolutePath)) {
            this._removeScaffoldTarget(absolutePath);
        }
        const kind = LumenHierarchyEntry.assetKindFromPath(relativePath);
        if (existsSync(absolutePath)) {
            this.openPrefab(relativePath);
        } else if (LumenStandaloneAsset.isStandaloneKind(kind)) {
            const document = LumenStandaloneAsset.createEmpty(relativePath, options.rootName, template);
            this._adoptStandalone(document);
            document.save(this._projectRoot, options.writeMetaIfMissing ?? true, this._cocosVersion);
        } else if (kind === 'scene') {
            const sceneRootName = options.rootName.trim();
            const templateNormalized = template.trim().replace(/\\/g, '/');
            // Scene._name 会成为路径首段；若与 ui/Canvas 模板根同名，会出现 Scene=Canvas + 子节点 Canvas，
            // 配方绝对路径 /Panel/... 会被旧逻辑误重映射成 /Canvas/... → lumen_child_missing。
            // Playbook：rootName 用场景名（如 Game），template 才是 ui/Canvas。
            if (
                sceneRootName.toLowerCase() === 'canvas' &&
                /(^|\/)canvas$/iu.test(templateNormalized)
            ) {
                throw new Error(
                    'lumen_scene_root_name_collides_with_canvas_template:use_rootName_like_scene_stem_not_Canvas',
                );
            }
            this._adoptDocument(LumenPrefabDocument.createEmptyScene(relativePath, options.rootName));
            this._document!.save(this._projectRoot, options.writeMetaIfMissing ?? true, this._cocosVersion);
            this._seedSceneBaseline(`/${options.rootName}`);
            if (template !== 'empty') {
                const templatePath = this._resolveTemplatePath(template);
                this._document!.addChildFromTemplate(`/${options.rootName}`, templatePath);
            }
            this._document!.save(this._projectRoot, options.writeMetaIfMissing ?? true, this._cocosVersion);
        } else if (template === 'empty') {
            this._adoptDocument(LumenPrefabDocument.createEmpty(relativePath, options.rootName));
            this._document!.save(this._projectRoot, options.writeMetaIfMissing ?? true, this._cocosVersion);
        } else {
            const templatePath = this._resolveTemplatePath(template);
            this._adoptDocument(
                LumenPrefabDocument.cloneFromTemplate(relativePath, templatePath, options.rootName),
            );
            this._document!.save(this._projectRoot, options.writeMetaIfMissing ?? true, this._cocosVersion);
        }
        this._phase = 'scaffolded';
        return relativePath;
    }

    /**
     * @description 打开已有 prefab、scene 或独立资产。
     * @param prefabRelativePath 相对路径（层次资产、独立文档、常见图片或模型）
     * @returns 相对路径
     */
    public openPrefab(prefabRelativePath: string): string {
        const relativePath = normalize(prefabRelativePath).replace(/\\/g, '/');
        const kind = LumenHierarchyEntry.resolveAssetKind(this._projectRoot, relativePath);
        if (LumenStandaloneAsset.isStandaloneKind(kind)) {
            this._adoptStandalone(LumenStandaloneAsset.open(this._projectRoot, relativePath));
        } else {
            this._adoptDocument(LumenPrefabDocument.open(this._projectRoot, relativePath));
        }
        this._phase = 'scaffolded';
        return relativePath;
    }

    /**
     * @description 请求编辑器刷新（refresh）。
     * @param relativePaths 可选路径列表
     * @returns 刷新结果
     */
    public async requestEditorRefresh(relativePaths: readonly string[] = []): Promise<ILumenEditorRefreshResult> {
        const result = await this._editorRefresh.refresh(this._projectRoot, relativePaths);
        if (result.triggered) {
            this._phase = 'editor_refreshed';
        }
        return result;
    }

    /**
     * @description commit 屏障刷新：flush coalesce + AssetDB/面板 settle。
     * @param relativePaths 路径列表
     * @returns 刷新结果
     */
    public async requestEditorRefreshBarrier(
        relativePaths: readonly string[] = [],
    ): Promise<ILumenEditorRefreshResult> {
        const barrier = this._editorRefresh.refreshBarrier;
        const result =
            typeof barrier === 'function'
                ? await barrier.call(this._editorRefresh, this._projectRoot, relativePaths)
                : await this._editorRefresh.refresh(this._projectRoot, relativePaths);
        if (result.triggered || result.settle != null) {
            this._phase = 'editor_refreshed';
        }
        return result;
    }

    /**
     * @description 刷新 asset-catalog 索引（catalog）。
     * @returns 摘要
     */
    public refreshCatalog(): { readonly generatedAt: string; readonly counts: Readonly<Record<string, number>> } {
        const summary = this._catalog.refreshCatalog(this._projectRoot);
        this._phase = 'catalog_ready';
        return summary;
    }

    /**
     * @description 解析资源句柄。
     * @param query 查询
     * @returns 命中列表
     */
    public resolve(query: ILumenResolveQuery) {
        return this._catalog.resolve(this._projectRoot, query);
    }

    /**
     * @description 解析唯一句柄。
     * @param query 查询
     * @returns 唯一条目
     */
    public resolveOne(query: ILumenResolveQuery) {
        return this._catalog.resolveOne(this._projectRoot, query);
    }

    /**
     * @description 从模板挂子节点。
     * @param options 选项
     * @returns 新节点路径
     */
    public addChildFromTemplate(options: ILumenAddChildFromTemplateOptions): string {
        this._assertHierarchyDocument();
        const normalizedTemplate = LumenTemplateAlias.normalize(options.template);
        // `empty` is a logical template (createEmpty / recipe path); no bundled empty.prefab.
        if (normalizedTemplate === 'empty') {
            const childName = options.name != null && options.name.trim().length > 0 ? options.name.trim() : 'Node';
            return this.addChildFromSpec({
                parentPath: options.parentPath,
                spec: { name: childName, components: ['cc.UITransform'] },
            });
        }
        const templatePath = this._resolveTemplatePath(options.template);
        const path = this._document!.addChildFromTemplate(options.parentPath, templatePath, options.name);
        return path;
    }

    /**
     * @description 从规格挂子节点。
     * @param options 选项
     * @returns 新节点路径
     */
    public addChildFromSpec(options: ILumenAddChildFromSpecOptions): string {
        this._assertHierarchyDocument();
        return this._document!.addChildFromSpec(options.parentPath, options.spec);
    }

    /**
     * @description 按 `default_prefab` 配方树递归挂载结构化子树。
     * @param options 父路径与配方
     * @returns 本层创建的节点路径列表
     */
    public buildFromRecipe(options: ILumenBuildFromRecipeOptions): readonly string[] {
        this._assertHierarchyDocument();
        return this._document!.buildFromRecipe(options.parentPath, options.recipe, (template) =>
            this._resolveTemplatePath(template),
        );
    }

    /**
     * @description 设置组件公开属性。
     * @param options 选项
     */
    public setComponentProperty(options: ILumenSetComponentPropertyOptions): void {
        this._assertHierarchyDocument();
        if (!this._isBuiltinOrRegistered(options.componentType)) {
            const ensured = this.ensureScriptProperties({ query: options.componentType });
            if (ensured == null) {
                throw new Error(
                    `lumen_component_props_unsupported:${options.componentType}:hint=ensureScriptProperties_or_registerScriptProperties`,
                );
            }
            this._document!.setComponentProperty(options.nodePath, ensured.ownerKey, options.patch);
            return;
        }
        this._document!.setComponentProperty(options.nodePath, options.componentType, options.patch);
    }

    /**
     * @description 注册脚本 `@property` 清单，供 `setComponentProperty` / inspect 使用。
     * @param ownerKey 脚本 compressedUuid（与 Prefab `__type__` 一致）或稳定键
     * @param fields 字段规格
     */
    public registerScriptProperties(ownerKey: string, fields: readonly ILumenPropertyFieldSpec[]): void {
        this._propertySchema.registerScriptProperties(ownerKey, fields);
    }

    /**
     * @description 移除已注册的脚本属性清单。
     * @param ownerKey 脚本键
     */
    public unregisterScriptProperties(ownerKey: string): void {
        this._propertySchema.unregisterScriptProperties(ownerKey);
    }

    /**
     * @description 列出已注册脚本 ownerKey。
     * @returns 键列表
     */
    public listRegisteredScripts(): readonly string[] {
        return this._propertySchema.listRegisteredScripts();
    }

    /**
     * @description 从工程脚本半自动发现 `@property` 并注册到会话 schema。
     * @param options 查询：compressedUuid / 脚本类名 / 项目相对 `.ts` 路径
     * @returns 注册结果；无法解析时返回 `null`（不抛，便于 schema 探测）
     */
    public ensureScriptProperties(options: {
        readonly query: string;
        readonly forceReregister?: boolean;
    }): ILumenScriptPropertyEnsureResult | null {
        const query = options.query.trim();
        if (query.length === 0) {
            throw new Error('lumen_script_ensure_query_empty');
        }
        if (query.startsWith('cc.') || query.startsWith('sp.') || query.startsWith('dragonBones.')) {
            return null;
        }
        try {
            this._assertCatalogReadySoft();
            const hit = this._resolveScriptCatalogEntry(query);
            const ownerKey = hit.compressedUuid;
            const already = this._propertySchema.listRegisteredScripts().includes(ownerKey);
            if (already && options.forceReregister !== true) {
                const sourcePath = hit.path.replace(/\\/g, '/');
                const absolute = this._resolveScriptAbsolutePath(sourcePath);
                const extract = this._extractScriptPropertiesFromAbsolute(absolute);
                return {
                    ownerKey,
                    sourcePath,
                    registered: false,
                    extract,
                };
            }
            const sourcePath = hit.path.replace(/\\/g, '/');
            const absolute = this._resolveScriptAbsolutePath(sourcePath);
            const extract = this._extractScriptPropertiesFromAbsolute(absolute);
            this._propertySchema.registerScriptProperties(ownerKey, extract.fields);
            return {
                ownerKey,
                sourcePath,
                registered: true,
                extract,
            };
        } catch (error) {
            if (options.forceReregister === true) {
                throw error;
            }
            return null;
        }
    }

    /**
     * @description 设置节点属性。
     * @param options 选项
     */
    public setNodeProperty(options: ILumenSetNodePropertyOptions): void {
        this._assertHierarchyDocument();
        this._document!.setNodeProperty(options.nodePath, options.patch);
    }

    /**
     * @description 删除节点。
     * @param nodePath 节点路径
     */
    public removeNode(nodePath: string): void {
        this._assertHierarchyDocument();
        this._document!.removeNode(nodePath);
    }

    /**
     * @description 重命名节点。
     * @param nodePath 节点路径
     * @param name 新名称
     */
    public renameNode(nodePath: string, name: string): void {
        this._assertHierarchyDocument();
        this._document!.renameNode(nodePath, name);
    }

    /**
     * @description 重排子节点。
     * @param parentPath 父路径
     * @param childName 子名
     * @param toIndex 目标下标
     */
    public reorderChild(parentPath: string, childName: string, toIndex: number): void {
        this._assertHierarchyDocument();
        this._document!.reorderChild(parentPath, childName, toIndex);
    }

    /**
     * @description 挂载内置或脚本组件。
     * @param options 选项
     * @returns 组件下标
     */
    public attachComponent(options: ILumenAttachComponentOptions): number {
        this._assertHierarchyDocument();
        if (options.builtinType != null && options.builtinType.length > 0) {
            return this._document!.attachBuiltinComponent(options.nodePath, options.builtinType);
        }
        if (options.scriptName != null && options.scriptName.length > 0) {
            this._assertCatalogReady();
            // 与 ensureScriptProperties / CLI 一致：支持 uuid、路径、精确文件名；
            // 禁止只用 nameContains，否则 TableView / TableViewCell 等前缀族会 lumen_catalog_ambiguous。
            const hit = this._resolveScriptCatalogEntry(options.scriptName);
            this.ensureScriptProperties({ query: hit.compressedUuid, forceReregister: false });
            return this._document!.attachScriptComponent(options.nodePath, hit.compressedUuid);
        }
        throw new Error('lumen_attach_requires_builtin_or_script');
    }

    /**
     * @description 移除组件。
     * @param nodePath 节点路径
     * @param typeOrCompressedId 类型或 compressedUuid
     */
    public removeComponent(nodePath: string, typeOrCompressedId: string): void {
        this._assertHierarchyDocument();
        this._document!.removeComponent(nodePath, typeOrCompressedId);
    }

    /**
     * @description 绑定点击事件（须在 catalog_ready 之后）。
     * @param options 绑定选项
     */
    public bindClick(options: ILumenBindClickOptions): void {
        this._assertHierarchyDocument();
        this._assertCatalogReady();
        const component = options.component.trim();
        if (component.startsWith('cc.')) {
            throw new Error(
                `lumen_bind_click_handler_must_be_user_script:${component}:pass_project_script_name_or_uuid`,
            );
        }
        const hit = this._resolveScriptCatalogEntry(component);
        this._document!.bindClickEvent(
            options.buttonNodePath,
            options.targetNodePath,
            component,
            options.handler,
            options.customEventData ?? '',
            hit.compressedUuid,
        );
        this._phase = 'bound';
    }

    /**
     * @description 绑定 SpriteFrame。
     * @param options 绑定选项
     */
    public bindSprite(options: ILumenBindSpriteOptions): void {
        this._assertHierarchyDocument();
        this._assertCatalogReady();
        const spriteFrameUuid = options.spriteFrameUuid.trim();
        if (
            spriteFrameUuid.length === 0 ||
            /^0{8}-0{4}-0{4}-0{4}-0{12}$/u.test(spriteFrameUuid) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(@[0-9a-f]+)?$/iu.test(
                spriteFrameUuid,
            )
        ) {
            throw new Error(`lumen_bind_sprite_uuid_invalid:${spriteFrameUuid || '(empty)'}`);
        }
        this._catalog.resolveOne(this._projectRoot, { uuid: spriteFrameUuid, limit: 1 });
        this._document!.bindSpriteFrame(options.nodePath, spriteFrameUuid);
        this._phase = 'bound';
    }

    /**
     * @description 批量绑定 SpriteFrame。
     * @param bindings 绑定项。
     * @returns 无。
     */
    public bindSpriteBatch(
        bindings: readonly Readonly<{ nodePath: string; spriteFrameUuid: string }>[],
    ): void {
        if (bindings.length === 0) {
            throw new Error('lumen_bind_sprite_batch_empty');
        }
        for (const binding of bindings) {
            this.bindSprite({
                nodePath: binding.nodePath,
                spriteFrameUuid: binding.spriteFrameUuid,
            });
        }
    }

    /**
     * @description 将节点或组件引用写入组件字段。
     * @param options 绑定选项。
     * @returns 无。
     */
    public bindRef(options: {
        readonly nodePath: string;
        readonly componentType: string;
        readonly field: string;
        readonly nodeRef?: string;
        readonly componentRef?: Readonly<{ nodePath: string; type: string }>;
    }): void {
        this._assertHierarchyDocument();
        const field = options.field.trim();
        if (field.length === 0) {
            throw new Error('lumen_bind_ref_field_empty');
        }
        const hasNode = typeof options.nodeRef === 'string' && options.nodeRef.trim().length > 0;
        const hasComp = options.componentRef != null;
        if (hasNode === hasComp) {
            throw new Error('lumen_bind_ref_node_or_component_required');
        }
        const patch: Record<string, unknown> = {};
        if (hasNode) {
            patch[field] = options.nodeRef!.trim();
        } else {
            // componentRef 写入须为节点路径字符串；类型由字段 schema 的 refComponentType 决定。
            patch[field] = options.componentRef!.nodePath.trim();
        }
        this.setComponentProperty({
            nodePath: options.nodePath,
            componentType: options.componentType,
            patch,
        });
        this._phase = 'bound';
    }

    /**
     * @description 保存当前打开的 Prefab / Scene / 独立资产。
     */
    public save(): void {
        if (this._standalone != null) {
            this._standalone.save(this._projectRoot, true, this._cocosVersion);
            return;
        }
        this._assertHierarchyDocument();
        this._requireHierarchy().save(this._projectRoot, true, this._cocosVersion);
    }

    /**
     * @description 删除 scaffold 目标源文件与相邻 `.meta`，供 `reset: true` 重建。
     * @param absolutePath 目标资产绝对路径
     * @returns 无返回值
     */
    private _removeScaffoldTarget(absolutePath: string): void {
        unlinkSync(absolutePath);
        const metaPath = `${absolutePath}.meta`;
        if (existsSync(metaPath)) {
            unlinkSync(metaPath);
        }
    }

    /**
     * @description 为空 `.scene` 挂上与 Creator / `scene.scene` 一致的基线节点。
     *
     * 契约（回归必守）：
     * 1. 先挂 `Camera` 模板为 `Main Camera`（`clearFlags=14` 负责清色/天空）
     * 2. 位姿与清色对齐 Creator `default.scene`（避免 (0,0,0)+空天空盒白雾）
     * 3. 再挂 `light/Directional Light` 为 `Main Light`
     * 4. 之后才允许再挂 `ui/Canvas` 等；Canvas 内 Camera 保持 `clearFlags=6`（叠层），禁止改 Canvas 模板去清色
     *
     * @param sceneRootPath 场景根路径，如 `/Game`
     * @returns 无返回值
     */
    private _seedSceneBaseline(sceneRootPath: string): void {
        this._assertHierarchyDocument();
        const mainCameraTemplate = this._resolveTemplatePath('Camera');
        const mainLightTemplate = this._resolveTemplatePath('light/Directional Light');
        this._document!.addChildFromTemplate(sceneRootPath, mainCameraTemplate, 'Main Camera');
        const mainCameraPath = `${sceneRootPath}/Main Camera`;
        // Creator default.scene：斜视位姿 + 深灰清色；模板 Camera 默认在原点且清色偏蓝，易在 2D 视图呈白雾。
        this._document!.setNodeProperty(mainCameraPath, {
            position: { x: -10, y: 10, z: 10 },
            euler: { x: -35, y: -45, z: 0 },
        });
        this._document!.setComponentProperty(mainCameraPath, 'cc.Camera', {
            color: { r: 51, g: 51, b: 51, a: 255 },
        });
        this._document!.addChildFromTemplate(sceneRootPath, mainLightTemplate, 'Main Light');
    }

    /**
     * @description 确保已打开 Prefab / Scene。
     */
    private _assertHierarchyDocument(): void {
        if (this._standalone != null) {
            throw new Error('lumen_not_hierarchy_asset');
        }
        if (this._document == null) {
            throw new Error('lumen_document_not_open:call_scaffoldPrefab_first');
        }
    }

    /**
     * @description 返回已打开的层次文档。
     * @returns Prefab / Scene 文档
     */
    private _requireHierarchy(): LumenPrefabDocument {
        this._assertHierarchyDocument();
        const document = this._document;
        if (document == null) {
            throw new Error('lumen_document_not_open:call_scaffoldPrefab_first');
        }
        return document;
    }

    /**
     * @description 确保已打开非层次资产。
     */
    private _assertStandaloneDocument(): void {
        if (this._standalone == null) {
            throw new Error('lumen_standalone_asset_not_open');
        }
    }

    /**
     * @description 返回已打开的独立资产文档。
     * @returns 独立文档
     */
    private _requireStandalone(): ILumenStandaloneAssetDocument {
        this._assertStandaloneDocument();
        const document = this._standalone;
        if (document == null) {
            throw new Error('lumen_standalone_asset_not_open');
        }
        return document;
    }

    /**
     * @description 是否为内置前缀或已注册脚本键（无需再发现）。
     * @param componentType 类型或 compressedUuid
     * @returns 是否跳过发现
     */
    private _isBuiltinOrRegistered(componentType: string): boolean {
        const trimmed = componentType.trim();
        if (
            trimmed.startsWith('cc.') ||
            trimmed.startsWith('sp.') ||
            trimmed.startsWith('dragonBones.')
        ) {
            return true;
        }
        return this._propertySchema.listRegisteredScripts().includes(trimmed);
    }

    /**
     * @description catalog 未就绪时自动 refresh，便于 schema / ensure 探测。
     */
    private _assertCatalogReadySoft(): void {
        if (this._phase === 'catalog_ready' || this._phase === 'bound') {
            return;
        }
        this.refreshCatalog();
    }

    /**
     * @description 按 uuid / compressedUuid / 路径 / 名解析脚本 catalog 条目。
     * @param query 查询串
     * @returns catalog 条目
     */
    private _resolveScriptCatalogEntry(query: string): {
        readonly compressedUuid: string;
        readonly path: string;
        readonly uuid: string;
        readonly name: string;
    } {
        const normalized = query.replace(/\\/g, '/').trim();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
            return this._catalog.resolveOne(this._projectRoot, { type: 'script', uuid: normalized, limit: 5 });
        }
        // 项目相对路径（含目录）才走 pathContains，避免 "TableView.ts" 被当成 path 子串扫到整族脚本。
        if (normalized.includes('/') && (normalized.endsWith('.ts') || normalized.startsWith('assets/'))) {
            return this._catalog.resolveOne(this._projectRoot, {
                type: 'script',
                pathContains: normalized.replace(/\.ts$/i, ''),
                limit: 5,
            });
        }
        const bareName = normalized.replace(/\.ts$/i, '');
        const byName = this._catalog.resolve(this._projectRoot, {
            type: 'script',
            nameContains: bareName,
            limit: 50,
        });
        if (byName.length === 1) {
            return byName[0]!;
        }
        if (byName.length > 1) {
            const exact = byName.filter(
                (entry) =>
                    entry.name === bareName ||
                    entry.name === `${bareName}.ts` ||
                    entry.path.endsWith(`/${bareName}.ts`) ||
                    entry.path.endsWith(`/${bareName}`),
            );
            if (exact.length === 1) {
                return exact[0]!;
            }
            throw new Error(`lumen_catalog_ambiguous:${JSON.stringify({ query, count: byName.length })}`);
        }
        const scripts = this._catalog.resolve(this._projectRoot, { type: 'script', limit: 5000 });
        const byCompressed = scripts.filter((entry) => entry.compressedUuid === normalized);
        if (byCompressed.length === 1) {
            return byCompressed[0]!;
        }
        if (byCompressed.length > 1) {
            throw new Error(`lumen_catalog_ambiguous:compressedUuid:${normalized}`);
        }
        const byCcclass = this._resolveScriptEntriesByCcclass(bareName);
        if (byCcclass.length === 1) {
            return byCcclass[0]!;
        }
        if (byCcclass.length > 1) {
            throw new Error(
                `lumen_catalog_ambiguous:${JSON.stringify({
                    query,
                    reason: 'ccclass',
                    paths: byCcclass.map((entry) => entry.path.replace(/\\/g, '/')),
                })}:hint=use_assets_path_or_filename`,
            );
        }
        const missHint =
            /^[A-Z][A-Za-z0-9_]*$/u.test(bareName)
                ? 'hint=use_script_path_or_filename_catalog_does_not_index_ccclass_only'
                : 'run_editor_import_then_catalog_refresh';
        throw new Error(`lumen_catalog_miss:${JSON.stringify({ query })}:${missHint}`);
    }

    /**
     * @description 按 `@ccclass('…')` 声明扫描 catalog 脚本（name/uuid 未命中时的兜底）。
     * @param className `@ccclass` 字符串
     * @returns 匹配的 catalog 条目（0..n）
     */
    private _resolveScriptEntriesByCcclass(className: string): ReadonlyArray<{
        readonly compressedUuid: string;
        readonly path: string;
        readonly uuid: string;
        readonly name: string;
    }> {
        const trimmed = className.trim();
        if (trimmed.length === 0) {
            return [];
        }
        const scripts = this._catalog.resolve(this._projectRoot, { type: 'script', limit: 5000 });
        return scripts.filter((entry) => {
            try {
                const sourcePath = entry.path.replace(/\\/g, '/');
                const absolute = this._resolveScriptAbsolutePath(sourcePath);
                const extract = LumenScriptPropertyExtractor.extractFromSource(readFileSync(absolute, 'utf8'));
                return extract.className === trimmed;
            } catch {
                // 跳过不可读或非 TS 脚本
                return false;
            }
        });
    }

    /**
     * @description 从脚本绝对路径提取 `@property`，含工程内自定义组件引用。
     * @param absolute 脚本绝对路径
     * @returns 提取结果
     */
    private _extractScriptPropertiesFromAbsolute(absolute: string): ILumenScriptPropertyExtractResult {
        return LumenScriptPropertyExtractor.extractFromSource(readFileSync(absolute, 'utf8'), {
            resolveCustomComponentType: (simpleName) => this._resolveCustomComponentTypeByClassName(simpleName),
        });
    }

    /**
     * @description 将 `@ccclass` 类名解析为 Prefab 组件 `__type__`（compressedUuid）。
     * @param className 简单类名，如 `PeanutRichTextView`
     * @returns compressedUuid；未唯一命中时 `undefined`
     */
    private _resolveCustomComponentTypeByClassName(className: string): string | undefined {
        const hits = this._resolveScriptEntriesByCcclass(className);
        if (hits.length !== 1) {
            return undefined;
        }
        return hits[0]!.compressedUuid;
    }

    /**
     * @description 将项目相对脚本路径解析为绝对路径并校验落在项目内。
     * @param sourcePath 相对路径
     * @returns 绝对路径
     */
    private _resolveScriptAbsolutePath(sourcePath: string): string {
        const relativePath = normalize(sourcePath).replace(/\\/g, '/');
        if (relativePath.includes('..') || isAbsolute(relativePath)) {
            throw new Error(`lumen_script_path_invalid:${sourcePath}`);
        }
        const absolute = resolve(this._projectRoot, relativePath);
        const rootWithSep = this._projectRoot.endsWith(sep) ? this._projectRoot : `${this._projectRoot}${sep}`;
        if (absolute !== this._projectRoot && !absolute.startsWith(rootWithSep)) {
            throw new Error(`lumen_script_path_escape:${sourcePath}`);
        }
        if (!existsSync(absolute)) {
            throw new Error(`lumen_script_source_missing:${relativePath}`);
        }
        return absolute;
    }

    /**
     * @description 为节点上未注册的脚本组件尝试发现 `@property`。
     * @param nodePath 节点路径
     */
    private _ensureScriptSchemasOnNode(nodePath: string): void {
        const inspected = LumenPrefabInspector.inspectNode(
            this._document!.entries,
            nodePath,
            (path) => this._document!.findNodeIndex(path),
            this._propertySchema,
            (entryIndex) => this._document!.pathForEntryIndex(entryIndex),
        );
        for (const component of inspected.components) {
            if (this._isBuiltinOrRegistered(component.type)) {
                continue;
            }
            this.ensureScriptProperties({ query: component.type });
        }
    }

    /**
     * @description 确保已刷新 catalog。
     */
    private _assertCatalogReady(): void {
        if (this._phase !== 'catalog_ready' && this._phase !== 'bound') {
            throw new Error('lumen_catalog_not_ready:call_refreshCatalog_first');
        }
    }

    /**
     * @description 采用文档并绑定会话属性表。
     * @param document Prefab 文档
     */
    private _adoptDocument(document: LumenPrefabDocument): void {
        document.setPropertySchema(this._propertySchema);
        this._standalone = null;
        this._document = document;
    }

    /**
     * @description 采用独立资产文档并清空层次文档。
     * @param document 独立资产
     */
    private _adoptStandalone(document: ILumenStandaloneAssetDocument): void {
        this._document = null;
        this._standalone = document;
    }

    /**
     * @description 解析 Creator 版本：显式 → 项目 package.json → 默认。
     * @param explicit 可选显式版本字符串
     * @returns 版本对象
     */
    private _resolveCocosVersion(explicit: string | undefined): LumenCocosVersion {
        if (explicit != null && explicit.trim().length > 0) {
            return LumenCocosVersion.parse(explicit);
        }
        return LumenCocosVersion.tryReadFromProject(this._projectRoot) ?? LumenCocosVersion.DEFAULT;
    }

    /**
     * @description 解析模板根：显式路径 → 插件缓存同步 → 随包内置。
     * @param templateRoot 可选覆盖路径。
     * @param templateCacheDir 可选插件缓存根。
     * @returns 绝对路径或 null。
     */
    private _resolveTemplateRoot(
        templateRoot: string | undefined,
        templateCacheDir: string | undefined,
    ): string | null {
        if (templateRoot != null && templateRoot.length > 0) {
            return this._resolveAbsolute(templateRoot);
        }
        try {
            return LumenDefaultTemplateRoot.resolveForRuntime({
                cacheDir: templateCacheDir,
            });
        } catch {
            return null;
        }
    }

    /**
     * @description 解析项目根。
     * @param projectRoot 输入路径
     * @returns 绝对路径
     */
    private _resolveProjectRoot(projectRoot: string): string {
        const absolute = this._resolveAbsolute(projectRoot);
        if (!existsSync(absolute)) {
            throw new Error(`lumen_project_missing:${absolute}`);
        }
        return absolute;
    }

    /**
     * @description 解析模板路径。
     * @param template `ui/Label` 或绝对路径
     * @returns 绝对 prefab 路径
     */
    private _resolveTemplatePath(template: string): string {
        const trimmedTemplate = template.trim();
        if (isAbsolute(trimmedTemplate) || trimmedTemplate.endsWith('.prefab')) {
            const absolute = this._resolveAbsolute(trimmedTemplate);
            if (!existsSync(absolute)) {
                throw new Error(`lumen_template_missing:${absolute}`);
            }
            return absolute;
        }
        const normalizedTemplate = LumenTemplateAlias.normalize(template);
        if (this._templateRoot == null) {
            throw new Error('lumen_template_root_required:pass_templateRoot_or_use_empty');
        }
        const candidate = join(this._templateRoot, `${normalizedTemplate}.prefab`);
        if (!existsSync(candidate)) {
            throw new Error(`lumen_template_missing:${candidate}`);
        }
        return candidate;
    }

    /**
     * @description 相对 cwd 转绝对路径。
     * @param pathValue 输入
     * @returns 绝对路径
     */
    private _resolveAbsolute(pathValue: string): string {
        return isAbsolute(pathValue) ? pathValue : join(process.cwd(), pathValue);
    }
}
