/**
 * @description Cocos SpriteFrame 子资源稳定 class id；子资源 UUID 形如 `<imageUuid>@f9941`。
 */
const SPRITE_FRAME_SUB_ASSET_CLASS_ID = "f9941";

/**
 * @description Cocos Texture 子资源稳定 class id。
 */
const TEXTURE_SUB_ASSET_CLASS_ID = "6c48a";

/**
 * @description 从已有 image meta 与 PNG 尺寸构造含 `@f9941` 的 SpriteFrame meta（与 host bridge 同构）。
 */
export class SpriteFrameMetaBuilder {
  /**
   * @description 判断未知值是否为普通记录。
   * @param value 未经信任的输入。
   * @returns 可读取字符串键时返回 true。
   */
  public static isRecord(
    value: unknown,
  ): value is Record<string, unknown> {
    return typeof value === "object" && value != null && !Array.isArray(value);
  }

  /**
   * @description 从 Creator AssetDB / meta 响应中提取可选 uuid。
   * @param value 资源或 meta。
   * @returns uuid；缺失时为 null。
   */
  public static readAssetUuid(value: unknown): string | null {
    if (!SpriteFrameMetaBuilder.isRecord(value)) {
      return null;
    }
    if (typeof value.uuid === "string" && value.uuid.length > 0) {
      return value.uuid;
    }
    return SpriteFrameMetaBuilder.readAssetUuid(value.asset);
  }

  /**
   * @description 从 AssetDB 信息或 meta 中提取 SpriteFrame 子资源 UUID。
   * @param value query-asset-info / query-asset-meta 返回值。
   * @returns SpriteFrame UUID；缺失时为 null。
   */
  public static readSpriteFrameUuid(value: unknown): string | null {
    if (!SpriteFrameMetaBuilder.isRecord(value)) {
      return null;
    }
    if (
      typeof value.spriteFrameUuid === "string" &&
      value.spriteFrameUuid.length > 0
    ) {
      return value.spriteFrameUuid;
    }
    for (const collectionKey of ["subMetas", "subAssets"] as const) {
      const collection = value[collectionKey];
      if (!SpriteFrameMetaBuilder.isRecord(collection)) {
        continue;
      }
      for (const [key, item] of Object.entries(collection)) {
        const uuid = SpriteFrameMetaBuilder.readAssetUuid(item);
        if (
          uuid != null &&
          uuid.endsWith(`@${SPRITE_FRAME_SUB_ASSET_CLASS_ID}`)
        ) {
          return uuid;
        }
        if (
          key.toLowerCase().includes("spriteframe") ||
          SpriteFrameMetaBuilder._subAssetDisplayNameContainsSpriteFrame(item)
        ) {
          const resolved = SpriteFrameMetaBuilder.readAssetUuid(item);
          if (resolved != null) {
            return resolved;
          }
        }
      }
    }
    return SpriteFrameMetaBuilder.readSpriteFrameUuid(value.asset);
  }

  /**
   * @description 读取 PNG IHDR 中的像素尺寸。
   * @param content PNG 二进制内容。
   * @returns 图片宽高。
   */
  public static readPngDimensions(
    content: Uint8Array,
  ): Readonly<{ width: number; height: number }> {
    if (
      content.byteLength < 24 ||
      content[0] !== 137 ||
      content[1] !== 80 ||
      content[2] !== 78 ||
      content[3] !== 71
    ) {
      throw new Error("lumen_sprite_frame_png_invalid");
    }
    const view = new DataView(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0) {
      throw new Error("lumen_sprite_frame_png_invalid");
    }
    return { width, height };
  }

  /**
   * @description 构造含 texture + sprite-frame 子资源的下一版 image meta。
   * @param meta 现有 meta（须含 uuid）。
   * @param dbUrl `db://assets/.../*.png`。
   * @param content PNG 内容（用于尺寸）。
   * @returns 可交给 `save-asset-meta` 的完整 meta 对象。
   */
  public static buildNextMeta(
    meta: Record<string, unknown>,
    dbUrl: string,
    content: Uint8Array,
  ): Record<string, unknown> {
    const { width, height } =
      SpriteFrameMetaBuilder.readPngDimensions(content);
    const imageUuid = SpriteFrameMetaBuilder.readAssetUuid(meta);
    if (imageUuid == null) {
      throw new Error("lumen_sprite_frame_meta_uuid_missing");
    }
    const textureUuid = `${imageUuid}@${TEXTURE_SUB_ASSET_CLASS_ID}`;
    const spriteFrameUuid = `${imageUuid}@${SPRITE_FRAME_SUB_ASSET_CLASS_ID}`;
    const displayName = dbUrl.slice(dbUrl.lastIndexOf("/") + 1).replace(/\.png$/i, "");
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const subMetas = SpriteFrameMetaBuilder.isRecord(meta.subMetas)
      ? meta.subMetas
      : {};
    const userData = SpriteFrameMetaBuilder.isRecord(meta.userData)
      ? meta.userData
      : {};
    const existingTexture = subMetas[TEXTURE_SUB_ASSET_CLASS_ID];
    return {
      ...meta,
      importer: "image",
      imported: true,
      uuid: imageUuid,
      files: Array.isArray(meta.files) ? meta.files : [".json", ".png"],
      subMetas: {
        ...subMetas,
        [TEXTURE_SUB_ASSET_CLASS_ID]: SpriteFrameMetaBuilder.isRecord(
          existingTexture,
        )
          ? existingTexture
          : {
              importer: "texture",
              uuid: textureUuid,
              displayName,
              id: TEXTURE_SUB_ASSET_CLASS_ID,
              name: "texture",
              userData: {
                wrapModeS: "repeat",
                wrapModeT: "repeat",
                minfilter: "linear",
                magfilter: "linear",
                mipfilter: "none",
                anisotropy: 0,
                isUuid: true,
                imageUuidOrDatabaseUri: imageUuid,
                visible: false,
              },
              ver: "1.0.22",
              imported: true,
              files: [".json"],
              subMetas: {},
            },
        [SPRITE_FRAME_SUB_ASSET_CLASS_ID]: {
          importer: "sprite-frame",
          uuid: spriteFrameUuid,
          displayName,
          id: SPRITE_FRAME_SUB_ASSET_CLASS_ID,
          name: "spriteFrame",
          userData: {
            trimType: "auto",
            trimThreshold: 1,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            trimX: 0,
            trimY: 0,
            width,
            height,
            rawWidth: width,
            rawHeight: height,
            borderTop: 0,
            borderBottom: 0,
            borderLeft: 0,
            borderRight: 0,
            packable: true,
            pixelsToUnit: 100,
            pivotX: 0.5,
            pivotY: 0.5,
            meshType: 0,
            vertices: {
              rawPosition: [
                -halfWidth,
                -halfHeight,
                0,
                halfWidth,
                -halfHeight,
                0,
                -halfWidth,
                halfHeight,
                0,
                halfWidth,
                halfHeight,
                0,
              ],
              indexes: [0, 1, 2, 2, 1, 3],
              uv: [0, height, width, height, 0, 0, width, 0],
              nuv: [0, 0, 1, 0, 0, 1, 1, 1],
              minPos: [-halfWidth, -halfHeight, 0],
              maxPos: [halfWidth, halfHeight, 0],
            },
            isUuid: true,
            imageUuidOrDatabaseUri: textureUuid,
            atlasUuid: "",
          },
          ver: "1.0.12",
          imported: true,
          files: [".json"],
          subMetas: {},
        },
      },
      userData: {
        ...userData,
        type: "sprite-frame",
        redirect: textureUuid,
      },
    };
  }

  /**
   * @description 将路径规范为 `db://...` URL。
   * @param pathOrUrl `db://` 或项目相对路径。
   * @returns 规范化 URL。
   */
  public static toDbUrl(pathOrUrl: string): string {
    const trimmed = pathOrUrl.trim();
    if (trimmed.length === 0) {
      throw new Error("lumen_sprite_frame_path_empty");
    }
    if (trimmed.startsWith("db://")) {
      return trimmed;
    }
    return `db://${trimmed.replace(/^\/+/, "")}`;
  }

  /**
   * @description 从 `db://` URL 得到工程相对路径。
   * @param dbUrl 已规范化 URL。
   * @returns 相对工程根的路径（POSIX）。
   */
  public static toProjectRelative(dbUrl: string): string {
    return dbUrl.replace(/^db:\/\//, "").split("\\").join("/");
  }

  /**
   * @description 判断子资源条目的人类可读名是否指示 SpriteFrame。
   * @param item AssetDB 子资源条目。
   * @returns `name`/`displayName` 含 spriteframe 时为 true。
   */
  private static _subAssetDisplayNameContainsSpriteFrame(
    item: unknown,
  ): boolean {
    if (!SpriteFrameMetaBuilder.isRecord(item)) {
      return false;
    }
    const name = typeof item.name === "string" ? item.name : "";
    const displayName =
      typeof item.displayName === "string" ? item.displayName : "";
    return (
      name.toLowerCase().includes("spriteframe") ||
      displayName.toLowerCase().includes("spriteframe")
    );
  }
}
