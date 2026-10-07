import type { ILumenCompressSettingsSnapshot } from './compress-settings';

/**
 * @description AudioClip 原生 meta 快照；Creator 3.8 导入器固定加载模式，不做播放器预览。
 */
export interface ILumenAudioMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'audio';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 读取已存储的加载模式；3.8 原生导入器固定为 `0`，不承诺可写。 */
    readonly downloadMode: number;
    /** @description 加载模式名；未知数值时为 `null`。 */
    readonly downloadModeName: string | null;
    /**
     * @description 策展表是否允许编辑加载模式；3.8 原生能力校验为只读。
     */
    readonly downloadModeWritable: boolean;
}

/**
 * @description VideoClip `.meta` Inspector 快照。3.8 检视器仅预览，无可写字段。
 */
export interface ILumenVideoMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'video';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description TTF / OTF `.meta` Inspector 快照。检视器仅预览，无可写字段。
 */
export interface ILumenTtfMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'ttfFont';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description BitmapFont `.fnt` `.meta` Inspector 快照。不解析字形表。
 */
export interface ILumenBitmapFontMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'bitmapFont';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 字号。 */
    readonly fontSize: number;
    /** @description 字图 uuid；未绑定时为空串。 */
    readonly textureUuid: string;
}

/**
 * @description 字体 meta 快照。
 */
export type ILumenFontMetaInspect = ILumenTtfMetaInspect | ILumenBitmapFontMetaInspect;

/**
 * @description Spine skeleton `.meta` Inspector 快照。不做动画预览，不读 library 贴图。
 */
export interface ILumenSpineMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'spine';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 共享图集 uuid；未指定时为空串。 */
    readonly atlasUuid: string;
}

/**
 * @description DragonBones 骨骼 `.meta` Inspector 快照。3.8 无可写字段。
 */
export interface ILumenDragonBonesMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'dragonBones';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description DragonBones 图集 `.meta` Inspector 快照。3.8 无可写字段。
 */
export interface ILumenDragonBonesAtlasMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'dragonBonesAtlas';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description DragonBones meta 快照。
 */
export type ILumenDragonBonesInspect = ILumenDragonBonesMetaInspect | ILumenDragonBonesAtlasMetaInspect;

/**
 * @description CubeMap 六面 ImageAsset uuid。空串表示未绑定。
 */
export interface ILumenCubeMapFacesInspect {
    /** @description -X 面图片 uuid。 */
    readonly left: string;
    /** @description +X 面图片 uuid。 */
    readonly right: string;
    /** @description +Y 面图片 uuid。 */
    readonly top: string;
    /** @description -Y 面图片 uuid。 */
    readonly bottom: string;
    /** @description +Z 面图片 uuid。 */
    readonly front: string;
    /** @description -Z 面图片 uuid。 */
    readonly back: string;
}

/**
 * @description CubeMap 贴图过滤。不做六面预览。
 */
export interface ILumenCubeMapTextureInspect {
    /** @description 各向异性。 */
    readonly anisotropy: number;
    /** @description 每面边长；未指定时为 0。 */
    readonly faceSize: number;
    /** @description U 方向寻址。 */
    readonly wrapModeS: string;
    /** @description V 方向寻址。 */
    readonly wrapModeT: string;
    /** @description 缩小过滤。 */
    readonly minfilter: string;
    /** @description 放大过滤。 */
    readonly magfilter: string;
    /** @description Mipmap 过滤。 */
    readonly mipfilter: string;
    /** @description 反射卷积：`1` 关闭，`2` 烘焙。 */
    readonly mipBakeMode: number;
}

/**
 * @description CubeMap `.meta` Inspector 快照。
 */
export interface ILumenCubeMapMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'cubeMap';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 六面绑定。 */
    readonly faces: ILumenCubeMapFacesInspect;
    /** @description 贴图过滤。 */
    readonly texture: ILumenCubeMapTextureInspect;
}

/**
 * @description TiledMap `.tmx` `.meta` Inspector 快照。3.8 无可写字段。
 */
export interface ILumenTiledMapMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'tiledMap';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description 文件夹 `.meta` Inspector 快照。含 Asset Bundle 开关。
 */
export interface ILumenDirectoryMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'directory';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 是否配置为 Asset Bundle。 */
    readonly isBundle: boolean;
    /** @description Bundle 名；未指定时为空串。 */
    readonly bundleName: string;
    /** @description Bundle 优先级；未指定时为 `null`。 */
    readonly priority: number | null;
    /** @description 分平台压缩类型。 */
    readonly compressionType: Readonly<Record<string, number>>;
    /** @description 分平台是否远程包。 */
    readonly isRemoteBundle: Readonly<Record<string, boolean>>;
}

/**
 * @description 粒子 `.plist` `.meta` Inspector 快照。3.8 `spriteFrameUuid` 为只读。
 */
export interface ILumenParticleMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'particle';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 检视器展示的 SpriteFrame uuid；空串表示未绑定。 */
    readonly spriteFrameUuid: string;
}

/**
 * @description Sprite Atlas 子图只读条目。
 */
export interface ILumenSpriteAtlasFrameInspect {
    /** @description subMetas 键名。 */
    readonly name: string;
    /** @description 子资源 uuid。 */
    readonly uuid: string;
    /** @description 显示名。 */
    readonly displayName: string;
}

/**
 * @description TexturePacker `.plist` `.meta` Inspector 快照。3.8 无可写字段。
 */
export interface ILumenSpriteAtlasMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'spriteAtlas';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 子 SpriteFrame 只读列表。 */
    readonly spriteFrames: readonly ILumenSpriteAtlasFrameInspect[];
}

/**
 * @description JSON 配置 `.meta` Inspector 快照。3.8 检视器仅预览源，无可写字段。
 */
export interface ILumenJsonMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'json';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description 文本配置 `.meta` Inspector 快照。3.8 检视器仅预览源，无可写字段。
 */
export interface ILumenTextMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'text';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description Buffer `.bin` `.meta` Inspector 快照。3.8 检视器仅预览源，无可写字段。
 */
export interface ILumenBufferMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'buffer';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description TypeScript `.ts` 脚本源文档：`.meta` 只读；`source` 读写 `.ts` 源文件（与 Prefab `@property` 发现分开）。
 */
export interface ILumenScriptMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'script';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 脚本源文件全文。 */
    readonly source: string;
}

/**
 * @description JavaScript `.js` `.meta` Inspector 快照。插件开关写 `userData`，不改脚本源。
 */
export interface ILumenJavascriptMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'javascript';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 是否作为插件脚本加载。 */
    readonly isPlugin: boolean;
    /** @description 编辑器内是否加载插件。 */
    readonly loadPluginInEditor: boolean;
    /** @description Web 是否加载插件。 */
    readonly loadPluginInWeb: boolean;
    /** @description Native 是否加载插件。 */
    readonly loadPluginInNative: boolean;
    /** @description 小游戏是否加载插件。 */
    readonly loadPluginInMiniGame: boolean;
}

/**
 * @description instantiation-mesh `.mesh` `.meta` Inspector 快照。不改引擎 dump 源。
 */
export interface ILumenMeshMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'mesh';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description instantiation-skeleton `.skeleton` `.meta` Inspector 快照。不改引擎 dump 源。
 */
export interface ILumenSkeletonMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'skeleton';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description instantiation-animation `.animation` `.meta` Inspector 快照。与 `.anim` 剪辑文档分开；不改 dump 源。
 */
export interface ILumenInstantiationAnimationMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'instantiationAnimation';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description instantiation-material `.material` `.meta` Inspector 快照。与 `.mtl` 材质文档分开；不改 dump 源。
 */
export interface ILumenInstantiationMaterialMetaInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'instantiationMaterial';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
}

/**
 * @description JSON / 文本配置快照。
 */
export type ILumenConfigMetaInspect = ILumenJsonMetaInspect | ILumenTextMetaInspect;

/**
 * @description Auto Atlas 打包设置。
 */
export interface ILumenAutoAtlasPackInspect {
    /** @description 单张图集最大宽度。 */
    readonly maxWidth: number;
    /** @description 单张图集最大高度。 */
    readonly maxHeight: number;
    /** @description 碎图间距。 */
    readonly padding: number;
    /** @description 是否允许旋转碎图。 */
    readonly allowRotation: boolean;
    /** @description 是否强制正方形。 */
    readonly forceSquared: boolean;
    /** @description 是否对齐到 2 的幂。 */
    readonly powerOfTwo: boolean;
    /** @description 打包算法；Creator 仅 `MaxRects`。 */
    readonly algorithm: string;
    /** @description 输出格式。 */
    readonly format: string;
    /** @description 输出质量。 */
    readonly quality: number;
    /** @description 是否轮廓 bleed。 */
    readonly contourBleed: boolean;
    /** @description 是否边距 bleed（Extrude）。 */
    readonly paddingBleed: boolean;
    /** @description 构建时是否过滤未引用资源。 */
    readonly filterUnused: boolean;
    /** @description Bundle 内是否剔除未用 Texture。 */
    readonly removeTextureInBundle: boolean;
    /** @description Bundle 内是否剔除未用图片。 */
    readonly removeImageInBundle: boolean;
    /** @description Bundle 内是否剔除未用 SpriteAtlas。 */
    readonly removeSpriteAtlasInBundle: boolean;
}

/**
 * @description Auto Atlas 生成贴图过滤设置。
 */
export interface ILumenAutoAtlasTextureInspect {
    /** @description U 方向寻址。 */
    readonly wrapModeS: string;
    /** @description V 方向寻址。 */
    readonly wrapModeT: string;
    /** @description 缩小过滤。 */
    readonly minfilter: string;
    /** @description 放大过滤。 */
    readonly magfilter: string;
    /** @description Mipmap 过滤。 */
    readonly mipfilter: string;
    /** @description 各向异性。 */
    readonly anisotropy: number;
}

/**
 * @description Auto Atlas Inspector 快照。
 */
export interface ILumenAutoAtlasInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'autoAtlas';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 打包页。 */
    readonly pack: ILumenAutoAtlasPackInspect;
    /** @description 贴图过滤页。 */
    readonly texture: ILumenAutoAtlasTextureInspect;
    /** @description 是否对生成的图集贴图启用压缩纹理。 */
    readonly useCompressTexture: boolean;
    /** @description 压缩预设 id；未绑定时为空串。 */
    readonly presetId: string;
    /** @description 压缩纹理默认与平台覆盖。 */
    readonly compressSettings: ILumenCompressSettingsSnapshot;
}

/**
 * @description LabelAtlas Inspector 快照。
 */
export interface ILumenLabelAtlasInspect {
    /** @description 项目相对路径。 */
    readonly path: string;
    /** @description 资产种类。 */
    readonly kind: 'labelAtlas';
    /** @description 主资源 uuid。 */
    readonly uuid: string;
    /** @description meta importer。 */
    readonly importer: string;
    /** @description 字图 SpriteFrame uuid；未绑定时为空串。 */
    readonly spriteFrameUuid: string;
    /** @description 单字宽度。 */
    readonly itemWidth: number;
    /** @description 单字高度。 */
    readonly itemHeight: number;
    /** @description 起始字符。 */
    readonly startChar: string;
    /** @description 导入后字号；只读。 */
    readonly fontSize: number;
}

/**
 * @description 旁路 `.meta` 资产 Inspector 快照。
 */
export type ILumenSidecarMetaInspect =
    | ILumenAudioMetaInspect
    | ILumenVideoMetaInspect
    | ILumenFontMetaInspect
    | ILumenSpineMetaInspect
    | ILumenDragonBonesInspect
    | ILumenCubeMapMetaInspect
    | ILumenTiledMapMetaInspect
    | ILumenDirectoryMetaInspect
    | ILumenParticleMetaInspect
    | ILumenSpriteAtlasMetaInspect
    | ILumenConfigMetaInspect
    | ILumenBufferMetaInspect
    | ILumenScriptMetaInspect
    | ILumenJavascriptMetaInspect
    | ILumenMeshMetaInspect
    | ILumenSkeletonMetaInspect
    | ILumenInstantiationAnimationMetaInspect
    | ILumenInstantiationMaterialMetaInspect
    | ILumenAutoAtlasInspect
    | ILumenLabelAtlasInspect;
