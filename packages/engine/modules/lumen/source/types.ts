/**
 * @description lumen 会话所处流水线阶段。
 */
export type LumenPhase = 'idle' | 'staged' | 'scaffolded' | 'editor_refreshed' | 'catalog_ready' | 'bound';

/**
 * @description Prefab JSON 条目（Creator 序列化对象）。
 */
export type PrefabEntry = Record<string, unknown>;

/**
 * @description 打开 lumen 会话的选项。
 */
export interface ILumenSessionOptions {
    /**
     * @description Creator 项目根目录（绝对或相对 cwd）。
     */
    readonly projectRoot: string;

    /**
     * @description 可选模板根；省略时使用 `products/cocos/default_prefab`。
     */
    readonly templateRoot?: string;

    /**
     * @description 可选编辑器刷新适配器；缺省为 no-op 并返回提示。
     */
    readonly editorRefresh?: ILumenEditorRefreshAdapter;

    /**
     * @description 显式 Cocos Creator 版本（如 `3.8.3` / `3.8.7`）；省略时读项目 `package.json` 的 `creator.version`，再回退基线 `3.8.3`。
     */
    readonly cocosVersion?: string;

    /**
     * @description 可选引擎根或引擎 `.ts`；传入后加载 `@serializable` 覆盖层。
     */
    readonly engineRoot?: string;

    /**
     * @description 插件缓存根；传入后启动/会话将内置 `default_prefab` 同步到该目录再使用。
     */
    readonly templateCacheDir?: string;
}

/**
 * @description 通知 Creator AssetDB 刷新的适配器。
 */
export interface ILumenEditorRefreshAdapter {
    /**
     * @description 请求编辑器刷新指定相对路径（或整库）。
     * @param projectRoot 项目根
     * @param relativePaths 相对 `assets/` 或项目根的路径；空表示尽力全量
     * @returns 刷新结果摘要
     */
    refresh(projectRoot: string, relativePaths: readonly string[]): Promise<ILumenEditorRefreshResult>;

    /**
     * @description commit 屏障：立即刷掉合并窗，刷新后等待 AssetDB/面板 settle，再返回。
     * @param projectRoot 项目根
     * @param relativePaths 相对路径
     * @returns 刷新 + settle 摘要
     */
    refreshBarrier?(
        projectRoot: string,
        relativePaths: readonly string[],
    ): Promise<ILumenEditorRefreshResult>;
}

/**
 * @description 最小 message 端口（供 AssetDB refresh 适配器注入，不依赖 plugin-sdk）。
 */
export interface ILumenMessagePort {
    /**
     * @description 向宿主发送请求并等待结果。
     * @param target 目标，如 `asset-db`
     * @param message 消息名
     * @param args 参数
     * @returns 宿主返回值
     */
    request<TData = unknown>(target: string, message: string, ...args: unknown[]): Promise<TData>;
}

/**
 * @description 编辑器刷新结果。
 */
export interface ILumenEditorRefreshResult {
    /**
     * @description 是否已真正触发宿主刷新。
     */
    readonly triggered: boolean;

    /**
     * @description 人类可读说明。
     */
    readonly message: string;

    /**
     * @description commit/验收前 hierarchy settle 摘要（可选）。
     */
    readonly settle?: ILumenEditorRefreshSettle;
}

/**
 * @description AssetDB / Assets 面板 settle 摘要。
 */
export interface ILumenEditorRefreshSettle {
    /**
     * @description settle 等待毫秒。
     */
    readonly waitedMs: number;

    /**
     * @description 本次 settle 预算毫秒（超时则 overBudget）。
     */
    readonly budgetMs: number;

    /**
     * @description waitedMs 是否超过 budgetMs。
     */
    readonly overBudget: boolean;

    /**
     * @description 已在 AssetDB 登记的路径数。
     */
    readonly registered: number;

    /**
     * @description 超时仍未登记的路径数。
     */
    readonly pending: number;

    /**
     * @description settle 结束时 `query-ready` 是否为 true。
     */
    readonly ready: boolean;

    /**
     * @description 本适配器累计 softRequest 失败次数（可观测）。
     */
    readonly softFailCount: number;
}

/**
 * @description catalog 解析请求。
 */
export interface ILumenResolveQuery {
    /**
     * @description 精确 uuid。
     */
    readonly uuid?: string;

    /**
     * @description 类型分桶。
     */
    readonly type?: string;

    /**
     * @description 路径子串。
     */
    readonly pathContains?: string;

    /**
     * @description 名称子串。
     */
    readonly nameContains?: string;

    /**
     * @description 条数上限。
     */
    readonly limit?: number;
}

/**
 * @description 脚手架创建 prefab 的选项。
 */
export interface ILumenScaffoldPrefabOptions {
    /**
     * @description 相对项目根的资产路径，如 `assets/ui/Demo.prefab` / `assets/Game.scene` / `assets/fx/Lit.mtl` / `assets/anim/Idle.anim`。
     */
    readonly prefabRelativePath: string;

    /**
     * @description 根节点名。
     */
    readonly rootName: string;

    /**
     * @description 模板：Prefab 为 `empty` 或 `ui/Label`；材质为 `empty` / `standard`；动画 / 物理材质 / 地形 / Effect / chunk / Auto Atlas / LabelAtlas / Animation Graph / Variant / Mask / RenderTexture 为 `empty`；Render Pipeline 为 `empty` 或 `forward`。图片、模型、音频、视频、TTF、BitmapFont、Spine、DragonBones、CubeMap、TiledMap、文件夹、粒子、Sprite Atlas、JSON、文本、Buffer 不走 scaffold。
     */
    readonly template?: string;

    /**
     * @description 是否在缺少 meta 时写入最小 meta（自带 uuid）。
     */
    readonly writeMetaIfMissing?: boolean;

    /**
     * @description 为 true 且目标已存在时，先删除源文件与相邻 `.meta` 再按模板重建；默认 false（已存在则只打开，随后 `structure` 会追加子节点）。
     */
    readonly reset?: boolean;
}

/**
 * @description Prefab / Scene 脚手架的内存序列化结果；由宿主决定如何原子发布。
 */
export interface ILumenSerializedHierarchyScaffold {
    /**
     * @description 工程相对目标路径。
     */
    readonly relativePath: string;
    /**
     * @description 层次资产种类。
     */
    readonly kind: 'prefab' | 'scene';
    /**
     * @description 规范化 Creator JSON 文本。
     */
    readonly content: string;
}

/**
 * @description 节点脚手架描述（仅结构，不含最终资源 uuid）。
 */
export interface ILumenNodeSpec {
    /**
     * @description 节点名。
     */
    readonly name: string;

    /**
     * @description 要挂载的组件类型列表，如 `cc.UITransform`、`cc.Button`。
     */
    readonly components?: readonly string[];

    /**
     * @description 子节点。
     */
    readonly children?: readonly ILumenNodeSpec[];
}

/**
 * @description 点击事件绑定请求。
 */
export interface ILumenBindClickOptions {
    /**
     * @description 带 Button 的节点路径，如 `/Root/Submit`。
     */
    readonly buttonNodePath: string;

    /**
     * @description 持有脚本组件的目标节点路径。
     */
    readonly targetNodePath: string;

    /**
     * @description 脚本类名（catalog 中应已存在）。
     */
    readonly component: string;

    /**
     * @description 回调方法名。
     */
    readonly handler: string;

    /**
     * @description 自定义事件数据。
     */
    readonly customEventData?: string;
}

/**
 * @description SpriteFrame 绑定请求。
 */
export interface ILumenBindSpriteOptions {
    /**
     * @description 带 Sprite 的节点路径。
     */
    readonly nodePath: string;

    /**
     * @description SpriteFrame uuid（通常含 `@f9941`）。
     */
    readonly spriteFrameUuid: string;
}

/**
 * @description 从模板挂子节点请求。
 */
export interface ILumenAddChildFromTemplateOptions {
    /**
     * @description 父节点路径。
     */
    readonly parentPath: string;

    /**
     * @description 模板：`ui/Label` 或绝对 `.prefab` 路径。
     */
    readonly template: string;

    /**
     * @description 可选子根名称。
     */
    readonly name?: string;
}

/**
 * @description 从规格挂子节点请求。
 */
export interface ILumenAddChildFromSpecOptions {
    /**
     * @description 父节点路径。
     */
    readonly parentPath: string;

    /**
     * @description 节点规格树。
     */
    readonly spec: ILumenNodeSpec;
}

/**
 * @description 挂载组件请求。
 */
export interface ILumenAttachComponentOptions {
    /**
     * @description 节点路径。
     */
    readonly nodePath: string;

    /**
     * @description 内置组件类型，如 `cc.Button`；与 scriptName 二选一。
     */
    readonly builtinType?: string;

    /**
     * @description 脚本资源名（catalog script）；与 builtinType 二选一。
     */
    readonly scriptName?: string;
}

/**
 * @description 设置组件属性请求。
 */
export interface ILumenSetComponentPropertyOptions {
    /**
     * @description 节点路径。
     */
    readonly nodePath: string;

    /**
     * @description 组件 `__type__`。
     */
    readonly componentType: string;

    /**
     * @description 浅合并补丁。
     */
    readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * @description 按 `default_prefab` 模板树描述的结构化节点（可嵌套）。
 */
export interface ILumenNodeRecipe {
    /**
     * @description 节点名（写入后的 `_name`）。
     */
    readonly name: string;

    /**
     * @description `default_prefab` 相对路径，如 `ui/Label`；与 `components` 二选一。
     */
    readonly template?: string;

    /**
     * @description 无模板时用内置组件规格创建空节点。
     */
    readonly components?: readonly string[];

    /**
     * @description 创建后写入的组件公开属性（编辑器可检视字段）。
     */
    readonly props?: Readonly<Record<string, unknown>>;

    /**
     * @description `props` 作用的组件类型；省略时按 template 推断（如 `ui/Label` → `cc.Label`）。
     */
    readonly propComponent?: string;

    /**
     * @description 按组件类型写入的公开属性；与 `props` 同时存在时覆盖同名字段。
     */
    readonly componentProps?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

    /**
     * @description 节点自身属性（position/active/name 等）。
     */
    readonly nodeProps?: Readonly<Record<string, unknown>>;

    /**
     * @description 子节点配方。
     */
    readonly children?: readonly ILumenNodeRecipe[];
}

/**
 * @description 写入非层次资产公开属性。补丁内非空 Creator uuid（含 `@子资源`）须存在于 asset-catalog。
 */
export interface ILumenSetAssetPropertyOptions {
    /**
     * @description 公开属性补丁，如 `{ wrapMode: 'Loop' }`、`{ pack, texture }` 或 `{ friction: 0.5 }`。
     */
    readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * @description 设置节点属性请求。
 */
export interface ILumenSetNodePropertyOptions {
    /**
     * @description 节点路径。
     */
    readonly nodePath: string;

    /**
     * @description 公开属性补丁。
     */
    readonly patch: Readonly<Record<string, unknown>>;
}

/**
 * @description 在已有父节点下按配方树批量创建。
 */
export interface ILumenBuildFromRecipeOptions {
    /**
     * @description 父节点路径。
     */
    readonly parentPath: string;

    /**
     * @description 配方树（可多根：数组中每个元素挂到同一父下）。
     */
    readonly recipe: ILumenNodeRecipe | readonly ILumenNodeRecipe[];
}
