import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

import type { IAssetImportMessagePort } from "./asset-import-batch-executor";
import { SpriteFrameMetaBuilder } from "./sprite-frame-meta-builder";

export { SpriteFrameMetaBuilder } from "./sprite-frame-meta-builder";


/** @description 等待 SpriteFrame 子资源就绪的最大轮询次数。 */
const SPRITE_FRAME_READY_ATTEMPTS = 40;

/** @description 每次轮询间隔（毫秒）。 */
const SPRITE_FRAME_READY_DELAY_MS = 250;

/**
 * @description 单项 SpriteFrame 提升结果状态。
 */
export type SpriteFrameEnsureStatus =
  | "already"
  | "ensured"
  | "failed"
  | "skipped";

/**
 * @description 单项 SpriteFrame 提升结果。
 */
export interface ISpriteFrameEnsureItemResult {
  /** @description 入参路径（原样回传）。 */
  readonly dbPath: string;
  /** @description 规范化后的 `db://assets/...` URL。 */
  readonly dbUrl: string;
  /** @description 提升状态。 */
  readonly status: SpriteFrameEnsureStatus;
  /** @description 成功时的 SpriteFrame UUID。 */
  readonly spriteFrameUuid?: string;
  /** @description 失败原因。 */
  readonly error?: string;
}

/**
 * @description 批量 SpriteFrame 提升结果。
 */
export interface IEnsureSpriteFramesBatchResult {
  /** @description 已有 SpriteFrame、无需改写的数量。 */
  readonly already: number;
  /** @description 本次经 `save-asset-meta` 提升成功的数量。 */
  readonly ensured: number;
  /** @description 失败数量。 */
  readonly errors: number;
  /** @description 跳过（非 PNG / 非 image）数量。 */
  readonly skipped: number;
  /** @description 逐项结果。 */
  readonly items: readonly ISpriteFrameEnsureItemResult[];
}

/**
 * @description 批量提升请求。
 */
export interface IEnsureSpriteFramesBatchRequest {
  /** @description Creator 工程根目录。 */
  readonly projectRoot: string;
  /** @description `db://assets/...` 或 `assets/...` 路径列表。 */
  readonly dbPaths: readonly string[];
  /** @description 可选批量刷新根（最后一次 `refresh-asset`）；省略则逐项刷新。 */
  readonly refreshRoot?: string;
}


/**
 * @description 经 AssetDB `save-asset-meta` 批量把已导入 PNG 提升为含 `@f9941` 的 SpriteFrame。
 * 优先走宿主 API，避免直接改盘 `.meta` 后再 reimport 引发的 UI 竞态。
 */
export class EnsureSpriteFramesBatchService {
  /** @description Creator 消息端口。 */
  private readonly _message: IAssetImportMessagePort;

  /**
   * @description 构造批量提升服务。
   * @param message AssetDB 消息端口。
   */
  public constructor(message: IAssetImportMessagePort) {
    this._message = message;
  }

  /**
   * @description 批量确保 PNG 具备 SpriteFrame 子资源。
   * @param request 工程根与路径列表。
   * @returns 汇总与逐项结果。
   */
  public async ensureBatch(
    request: IEnsureSpriteFramesBatchRequest,
  ): Promise<IEnsureSpriteFramesBatchResult> {
    const projectRoot = resolve(request.projectRoot);
    if (!existsSync(projectRoot)) {
      throw new Error(`lumen_sprite_frame_project_missing:${projectRoot}`);
    }
    if (!Array.isArray(request.dbPaths) || request.dbPaths.length === 0) {
      throw new Error("lumen_sprite_frame_db_paths_required");
    }
    const refreshRoot =
      typeof request.refreshRoot === "string" &&
      request.refreshRoot.trim().length > 0
        ? SpriteFrameMetaBuilder.toDbUrl(request.refreshRoot)
        : null;
    const items: ISpriteFrameEnsureItemResult[] = [];
    let already = 0;
    let ensured = 0;
    let errors = 0;
    let skipped = 0;
    for (const rawPath of request.dbPaths) {
      if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
        items.push({
          dbPath: String(rawPath),
          dbUrl: "",
          status: "failed",
          error: "lumen_sprite_frame_path_empty",
        });
        errors += 1;
        continue;
      }
      const item = await this._ensureOne(
        projectRoot,
        rawPath.trim(),
        refreshRoot == null,
      );
      items.push(item);
      if (item.status === "already") {
        already += 1;
      } else if (item.status === "ensured") {
        ensured += 1;
      } else if (item.status === "skipped") {
        skipped += 1;
      } else {
        errors += 1;
      }
    }
    if (refreshRoot != null && ensured > 0) {
      await this._refreshAsset(refreshRoot);
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item == null || item.status !== "ensured") {
          continue;
        }
        const waited = await this._waitForSpriteFrame(item.dbUrl);
        const uuid = SpriteFrameMetaBuilder.readSpriteFrameUuid(waited);
        if (uuid != null) {
          items[index] = { ...item, spriteFrameUuid: uuid };
        }
      }
    }
    return { already, ensured, errors, skipped, items };
  }

  /**
   * @description 提升单项 PNG。
   * @param projectRoot 工程根。
   * @param rawPath 入参路径。
   * @param refreshInline 是否在本项内 refresh+wait。
   * @returns 单项结果。
   */
  private async _ensureOne(
    projectRoot: string,
    rawPath: string,
    refreshInline: boolean,
  ): Promise<ISpriteFrameEnsureItemResult> {
    let dbUrl: string;
    try {
      dbUrl = SpriteFrameMetaBuilder.toDbUrl(rawPath);
    } catch (error) {
      return {
        dbPath: rawPath,
        dbUrl: "",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!dbUrl.toLowerCase().endsWith(".png")) {
      return {
        dbPath: rawPath,
        dbUrl,
        status: "skipped",
        error: "lumen_sprite_frame_not_png",
      };
    }
    const relative = SpriteFrameMetaBuilder.toProjectRelative(dbUrl);
    const absolute = resolve(join(projectRoot, ...relative.split("/")));
    if (
      absolute !== projectRoot &&
      !absolute.startsWith(`${projectRoot}/`) &&
      !absolute.startsWith(`${projectRoot}\\`)
    ) {
      return {
        dbPath: rawPath,
        dbUrl,
        status: "failed",
        error: "lumen_sprite_frame_path_escape",
      };
    }
    if (!existsSync(absolute)) {
      return {
        dbPath: rawPath,
        dbUrl,
        status: "failed",
        error: "lumen_sprite_frame_file_missing",
      };
    }
    try {
      const meta = await this._queryAssetMeta(dbUrl);
      const info = await this._queryAssetInfo(dbUrl);
      const existing =
        SpriteFrameMetaBuilder.readSpriteFrameUuid(meta) ??
        SpriteFrameMetaBuilder.readSpriteFrameUuid(info);
      if (existing != null) {
        return {
          dbPath: rawPath,
          dbUrl,
          status: "already",
          spriteFrameUuid: existing,
        };
      }
      if (
        meta == null ||
        !SpriteFrameMetaBuilder.isRecord(meta) ||
        meta.importer !== "image"
      ) {
        return {
          dbPath: rawPath,
          dbUrl,
          status: "failed",
          error: "lumen_sprite_frame_not_image_importer",
        };
      }
      const content = new Uint8Array(readFileSync(absolute));
      const nextMeta = SpriteFrameMetaBuilder.buildNextMeta(
        meta,
        dbUrl,
        content,
      );
      await this._message.request(
        "asset-db",
        "save-asset-meta",
        dbUrl,
        JSON.stringify(nextMeta, null, 4),
      );
      let spriteFrameUuid =
        SpriteFrameMetaBuilder.readSpriteFrameUuid(nextMeta) ?? undefined;
      if (refreshInline) {
        await this._refreshAsset(dbUrl);
        const waited = await this._waitForSpriteFrame(dbUrl);
        spriteFrameUuid =
          SpriteFrameMetaBuilder.readSpriteFrameUuid(waited) ??
          spriteFrameUuid;
      }
      if (spriteFrameUuid == null) {
        return {
          dbPath: rawPath,
          dbUrl,
          status: "failed",
          error: "lumen_sprite_frame_not_ready",
        };
      }
      return {
        dbPath: rawPath,
        dbUrl,
        status: "ensured",
        spriteFrameUuid,
      };
    } catch (error) {
      return {
        dbPath: rawPath,
        dbUrl,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * @description 查询资源 meta。
   * @param dbUrl `db://` URL。
   * @returns meta 或 null。
   */
  private async _queryAssetMeta(
    dbUrl: string,
  ): Promise<Record<string, unknown> | null> {
    for (const message of ["query-asset-meta", "query-meta"] as const) {
      try {
        const value = await this._message.request("asset-db", message, dbUrl);
        if (SpriteFrameMetaBuilder.isRecord(value)) {
          return value;
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  /**
   * @description 查询资源 info。
   * @param dbUrl `db://` URL。
   * @returns info 或 null。
   */
  private async _queryAssetInfo(dbUrl: string): Promise<unknown | null> {
    try {
      return await this._message.request("asset-db", "query-asset-info", dbUrl);
    } catch {
      return null;
    }
  }

  /**
   * @description 刷新资源。
   * @param dbUrl `db://` URL。
   * @returns 无。
   */
  private async _refreshAsset(dbUrl: string): Promise<void> {
    await this._message.request("asset-db", "refresh-asset", dbUrl);
  }

  /**
   * @description 等待 SpriteFrame 子资源出现在 AssetDB。
   * @param dbUrl `db://` URL。
   * @returns 最后一次 query-asset-info 快照。
   */
  private async _waitForSpriteFrame(dbUrl: string): Promise<unknown | null> {
    let last: unknown | null = null;
    for (let attempt = 0; attempt < SPRITE_FRAME_READY_ATTEMPTS; attempt += 1) {
      last = await this._queryAssetInfo(dbUrl);
      if (SpriteFrameMetaBuilder.readSpriteFrameUuid(last) != null) {
        return last;
      }
      if (attempt < SPRITE_FRAME_READY_ATTEMPTS - 1) {
        await EnsureSpriteFramesBatchService._delay(
          SPRITE_FRAME_READY_DELAY_MS,
        );
      }
    }
    return last;
  }

  /**
   * @description 等待指定毫秒。
   * @param milliseconds 时长。
   * @returns 无。
   */
  private static async _delay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, milliseconds);
    });
  }
}
