import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ContractPayload,
  EditorMcpThinLayerAvailability,
  IPrefabCreateFromNodeMcpInput,
  IPrefabGetInfoMcpInput,
  IPrefabInstanceOpMcpInput,
  ISceneCreateNodeMcpInput,
  ISceneFocusNodeMcpInput,
  ISceneOpenMcpInput,
  ISceneQueryNodeMcpInput,
  ISceneReloadMcpInput,
  ISceneSaveMcpInput,
} from "@peanut/pod-protocol";
import type { IGrantedRuntimeClientSet } from "@peanut/pod-sdk";
import { EditorResourceGuard } from "@peanut/pod-engine/runtime";

import { EditorMcpThinLayerAvailabilityMapper } from "./editor-mcp-thin-layer-availability.js";
import type { IEditorMcpThinLayerAvailabilityInput } from "./editor-mcp-thin-layer-availability.js";
import {
  buildSceneSaveRefusePayload,
  CREATOR_SCENE_SAVE_MESSAGES as SCENE_HOST_SAVE_MESSAGES,
} from "./editor-mcp-scene-host-routes.js";
import { EditorMcpSceneInputReader } from "./editor-mcp-scene-input-reader.js";

/** @description Creator 会弹确认框、卡住无头自动化的 scene 持久化消息。 */
const CREATOR_SCENE_SAVE_MESSAGES = new Set<string>(SCENE_HOST_SAVE_MESSAGES);

/**
 * @description 场景 / Prefab 实例薄层结果。
 */
export interface IEditorMcpSceneOpResult {
  /** @description 是否调用成功。 */
  readonly available: boolean;
  /** @description 说明或错误码。 */
  readonly message: string;
  /** @description Agent 可观测：live / fallback / refused。 */
  readonly availability: EditorMcpThinLayerAvailability;
  /** @description 可选宿主原始结果。 */
  readonly data?: unknown;
  readonly recommendedNext?: {
    readonly operation: string;
    readonly input: Record<string, unknown>;
  };
}

/**
 * @description 场景打开/保存/重载与 Prefab 实例薄层网关（尽力 message；守卫路径）。
 */
export class EditorMcpSceneGateway {
  /**
   * @description Scene 与 Prefab 实例操作输入读取器。
   */
  private readonly _inputReader = new EditorMcpSceneInputReader();

  /** @description 授权 runtime。 */
  private readonly _runtime: IGrantedRuntimeClientSet;
  /** @description 打开场景路径守卫。 */
  private readonly _guard: EditorResourceGuard;

  /**
   * @description 构造场景网关。
   * @param runtime 授权 runtime。
   * @param guard 可选守卫。
   */
  public constructor(
    runtime: IGrantedRuntimeClientSet,
    guard: EditorResourceGuard = new EditorResourceGuard(),
  ) {
    this._runtime = runtime;
    this._guard = guard;
  }

  /**
   * @description 打开合法场景。
   * @param input 输入。
   * @returns 结果。
   */
  public async open(
    input: ISceneOpenMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const raw = input.path.trim();
    // Creator `open-scene` 参数是资源 UUID；传 db:// 会拼成 import://db/db://… 并失败。
    if (this._isAssetUuid(raw)) {
      return this._openSceneByUuid(raw, undefined);
    }
    const dbPath = this._toDbAssetsPath(raw);
    if (!this._guard.canOpenAsScene(dbPath)) {
      return this._finalize({
        available: false,
        message: "scene_open_blocked:invalid_or_blocked_path",
      });
    }
    const uuid = await this._resolveSceneUuid(dbPath);
    if (uuid == null) {
      return this._finalize({
        available: false,
        message: "scene_open_unavailable:uuid_unresolved",
        data: { dbPath },
      });
    }
    return this._openSceneByUuid(uuid, dbPath);
  }

  /**
   * @description 仅用 UUID 打开场景；失败时尝试 asset-db open-asset(UUID)，仍禁止传 db://。
   * @param uuid 场景资产 UUID。
   * @param dbPath 可选 db 路径，仅回显。
   * @returns 打开结果。
   */
  private async _openSceneByUuid(
    uuid: string,
    dbPath: string | undefined,
  ): Promise<IEditorMcpSceneOpResult> {
    const opened = await this._requestSceneFirst(
      [
        ["open-scene", [uuid]],
        // 部分 Creator 构建上 open-scene 不可用时，open-asset(UUID) 可打开场景且不弹确认框。
      ],
      "scene_open",
    );
    if (opened.available !== true) {
      const viaAsset = await this._openSceneViaAssetDb(uuid);
      if (viaAsset.available === true) {
        return {
          ...viaAsset,
          data: {
            ...(viaAsset.data != null && typeof viaAsset.data === "object"
              ? (viaAsset.data as Record<string, unknown>)
              : { raw: viaAsset.data }),
            uuid,
            ...(dbPath != null ? { dbPath } : {}),
            openVia: "asset-db:open-asset",
          },
        };
      }
      return {
        ...opened,
        data: {
          ...(opened.data != null && typeof opened.data === "object"
            ? (opened.data as Record<string, unknown>)
            : { raw: opened.data }),
          uuid,
          ...(dbPath != null ? { dbPath } : {}),
          assetDbFallback: viaAsset,
        },
      };
    }
    return {
      ...opened,
      data: {
        ...(opened.data != null && typeof opened.data === "object"
          ? (opened.data as Record<string, unknown>)
          : { raw: opened.data }),
        uuid,
        ...(dbPath != null ? { dbPath } : {}),
        openVia: "scene:open-scene",
      },
    };
  }

  /**
   * @description 用 asset-db open-asset(UUID) 打开场景（不传 db://）。
   * @param uuid 场景 UUID。
   * @returns 结果。
   */
  private async _openSceneViaAssetDb(
    uuid: string,
  ): Promise<IEditorMcpSceneOpResult> {
    const message = this._runtime.message;
    if (message == null) {
      return this._finalize({
        available: false,
        message: "scene_open_unavailable:runtime_message_missing",
      });
    }
    try {
      const data = await message.request("asset-db", "open-asset", uuid);
      return this._finalize({
        available: true,
        message: "scene_open_ok:asset-db:open-asset",
        data,
      });
    } catch (error) {
      return this._finalize({
        available: false,
        message: "scene_open_unavailable:asset-db_open_asset_failed",
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * @description 拒绝 Creator `save-scene` 弹窗路径；场景持久化走 lumen 离线写盘。
   * @param input 输入（仅用于回显建议路径）。
   * @returns 固定拒绝结果与推荐流水线。
   */
  public async save(
    input: ISceneSaveMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const path =
      typeof input.path === "string" && input.path.trim().length > 0
        ? input.path.trim()
        : undefined;
    if (path != null) {
      const dbPath = this._toDbAssetsPath(path);
      if (!this._guard.canOpenAsScene(dbPath)) {
        return this._finalize({
          available: false,
          message: "scene_save_blocked:invalid_or_blocked_path",
        });
      }
    }
    const sceneRelativeHint =
      path != null
        ? path.replace(/^db:\/\//u, "").replace(/\\/gu, "/")
        : undefined;
    const refuse = buildSceneSaveRefusePayload(sceneRelativeHint);
    return this._finalize({
      available: refuse.available,
      message: refuse.message,
      data: refuse.data,
      recommendedNext: refuse.recommendedNext,
    });
  }

  /**
   * @description 软重载当前场景。
   * @param _input 输入。
   * @returns 结果。
   */
  public async reload(
    _input: ISceneReloadMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    return this._requestSceneFirst(
      [
        ["soft-reload", []],
        ["reload-scene", []],
      ],
      "scene_reload",
    );
  }

  /**
   * @description 按路径从 hierarchy 快照查找节点。
   * @param input 输入。
   * @returns 节点快照或空。
   */
  public async queryNode(
    input: ISceneQueryNodeMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    if (this._runtime.scene == null) {
      return this._finalize({
        available: false,
        message: "scene_query_node_unavailable:scene_grant_missing",
      });
    }
    const loaded = await this._loadHierarchyNodes(
      input.includeEditorNodes === true,
    );
    return this.queryNodeWithNodes(input, loaded.nodes, loaded.availabilityHint);
  }

  /**
   * @description 在已加载的层次快照中按 path 查找节点。
   * @param input 查询输入。
   * @param nodes 扁平节点列表。
   * @returns 查询结果。
   */
  public queryNodeWithNodes(
    input: ISceneQueryNodeMcpInput,
    nodes: readonly Record<string, unknown>[],
    hierarchyAvailability: EditorMcpThinLayerAvailability = "live",
  ): IEditorMcpSceneOpResult {
    const needle = input.path.trim().replace(/\\/gu, "/");
    if (needle.length === 0) {
      throw new Error("editor_mcp_scene_query_node_path_required");
    }
    const hit = nodes.find((node) => this._nodeMatches(node, needle));
    if (hit == null) {
      return this._finalize({
        available: true,
        message: "scene_query_node_not_found",
        data: { path: needle, node: null },
        availabilityHint: hierarchyAvailability,
      });
    }
    return this._finalize({
      available: true,
      message: "scene_query_node_ok",
      data: { path: needle, node: hit },
      availabilityHint: hierarchyAvailability,
    });
  }

  /**
   * @description 聚焦 / 揭示场景节点（尽力 message + 选中）。
   * @param input 输入。
   * @returns 结果。
   */
  public async focusNode(
    input: ISceneFocusNodeMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const needle = input.path.trim().replace(/\\/gu, "/");
    if (needle.length === 0) {
      throw new Error("editor_mcp_scene_focus_node_path_required");
    }
    let uuid = needle;
    let nodePath = needle;
    const scene = this._runtime.scene;
    if (scene != null) {
      try {
        const loaded = await this._loadHierarchyNodes(false);
        const hit = loaded.nodes.find((node) => this._nodeMatches(node, needle));
        if (hit != null) {
          const record = hit as unknown as Record<string, unknown>;
          if (typeof record.uuid === "string" && record.uuid.length > 0) {
            uuid = record.uuid;
          } else if (typeof record.id === "string" && record.id.length > 0) {
            uuid = record.id;
          }
          if (typeof record.path === "string" && record.path.length > 0) {
            nodePath = record.path;
          }
        }
      } catch {
        // fall through with needle
      }
    }
    const focused = await this._requestSceneFirst(
      [
        ["focus-node", [uuid]],
        ["focus-node", [{ uuid }]],
        ["focus-node", [nodePath]],
        ["select-node", [uuid]],
        ["select-node", [{ uuid }]],
        ["hierarchy-focus", [uuid]],
        ["hierarchy-focus", [nodePath]],
      ],
      "scene_focus_node",
    );
    const selection = this._runtime.selection;
    if (selection != null && typeof selection.setActiveIds === "function") {
      try {
        await selection.setActiveIds([uuid]);
      } catch {
        // selection sync is best-effort
      }
    }
    if (focused.available) {
      return {
        ...focused,
        data: {
          ...(focused.data != null &&
          typeof focused.data === "object" &&
          !Array.isArray(focused.data)
            ? (focused.data as Record<string, unknown>)
            : { raw: focused.data }),
          path: nodePath,
          uuid,
        },
      };
    }
    if (selection != null) {
      return this._finalize({
        available: true,
        message: "scene_focus_node_ok:selection_only",
        data: { path: nodePath, uuid },
        availabilityHint: "fallback",
      });
    }
    return focused;
  }

  /**
   * @description 在当前场景创建节点（Camera/Light/empty 等；message 尽力 + 宿主场景脚本回退）。
   * @param input 输入。
   * @returns 结果。
   */
  public async createNode(
    input: ISceneCreateNodeMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const parentPath =
      typeof input.parentPath === "string" && input.parentPath.trim().length > 0
        ? input.parentPath.trim().replace(/\\/gu, "/")
        : undefined;
    const name =
      typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim()
        : undefined;
    const type =
      typeof input.type === "string" && input.type.trim().length > 0
        ? input.type.trim()
        : "empty";
    const parentUuid = await this._resolveNodeUuid(parentPath);
    const engineType = this._mapCreateNodeType(type);
    const payloadWithParent = {
      ...(parentUuid != null ? { parent: parentUuid } : {}),
      ...(name != null ? { name } : {}),
      ...(engineType != null ? { type: engineType } : {}),
    };
    const created = await this._requestSceneFirst(
      [
        ["create-node", [payloadWithParent]],
        [
          "create-node",
          [
            {
              ...(parentUuid != null ? { parent: parentUuid } : {}),
              ...(name != null ? { name } : {}),
              type: "cc.Node",
            },
          ],
        ],
        ["create-node", [type, parentUuid, name]],
        ["create-node", [name ?? type, parentUuid]],
        ["create-node", [{ type, name, parent: parentUuid, parentPath }]],
      ],
      "scene_create_node",
    );
    if (created.available) {
      return {
        ...created,
        data: {
          ...(created.data != null &&
          typeof created.data === "object" &&
          !Array.isArray(created.data)
            ? (created.data as Record<string, unknown>)
            : { raw: created.data }),
          parentUuid,
          parentPath,
          name,
          type,
        },
      };
    }
    return this._createNodeViaSceneScript({
      parentUuid,
      name,
      type,
      messageFallback: created.message,
    });
  }

  /**
   * @description 从节点创建 Prefab。
   * @param input 输入。
   * @returns 结果。
   */
  public async createFromNode(
    input: IPrefabCreateFromNodeMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const prefabPath = this._toDbAssetsPath(input.prefabPath);
    if (
      !prefabPath.startsWith("db://assets/") ||
      !/\.prefab$/iu.test(prefabPath)
    ) {
      return this._finalize({
        available: false,
        message: "prefab_create_blocked:invalid_prefab_path",
      });
    }
    const nodePath = input.nodePath.trim();
    const nodeUuid = await this._resolveNodeUuid(nodePath);
    if (nodeUuid == null) {
      return this._finalize({
        available: false,
        message: "prefab_create_refused:node_not_found",
        data: { nodePath, prefabPath },
      });
    }
    const created = await this._requestSceneFirst(
      [
        ["create-prefab", [nodeUuid, prefabPath]],
        ["create-prefab", [{ uuid: nodeUuid, url: prefabPath }]],
      ],
      "prefab_create",
    );
    if (!created.available) {
      return created;
    }
    const asset = await this._waitForReadableAsset(prefabPath);
    if (asset == null) {
      return this._finalize({
        available: false,
        message: "prefab_create_unverified:asset_missing",
        data: { nodePath, nodeUuid, prefabPath },
      });
    }
    const prefabName = prefabPath.split("/").pop()?.replace(/\.prefab$/iu, "");
    const parentPath = nodePath.includes("/")
      ? nodePath.slice(0, nodePath.lastIndexOf("/"))
      : "";
    const instancePath =
      prefabName == null || prefabName.length === 0
        ? nodePath
        : parentPath.length > 0
          ? `${parentPath}/${prefabName}`
          : prefabName;
    const instanceUuid = await this._resolveNodeUuid(instancePath);
    return {
      ...created,
      data: {
        nodePath,
        nodeUuid,
        prefabPath,
        asset,
        instancePath,
        instanceUuid,
      },
    };
  }

  /**
   * @description 应用 Prefab 实例覆盖。
   * @param input 输入。
   * @returns 结果。
   */
  public async apply(
    input: IPrefabInstanceOpMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const nodePath = input.nodePath.trim();
    const uuid = (await this._resolveNodeUuid(nodePath)) ?? nodePath;
    return this._requestSceneFirst(
      [
        ["apply-prefab", [uuid]],
        ["apply-prefab", [{ uuid }]],
      ],
      "prefab_apply",
    );
  }

  /**
   * @description 还原 Prefab 实例。
   * @param input 输入。
   * @returns 结果。
   */
  public async revert(
    input: IPrefabInstanceOpMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const nodePath = input.nodePath.trim();
    const uuid = (await this._resolveNodeUuid(nodePath)) ?? nodePath;
    const assetUuid = await this._resolvePrefabAssetUuid(uuid);
    if (assetUuid == null) {
      return this._finalize({
        available: false,
        message: "prefab_revert_refused:asset_uuid_unresolved",
        data: { nodePath, uuid },
      });
    }
    return this._requestSceneFirst(
      [
        ["restore-prefab", [uuid, assetUuid]],
        ["restore-prefab", [{ uuid }]],
        ["restore-prefab", [uuid]],
      ],
      "prefab_revert",
    );
  }

  /**
   * @description 解包 Prefab 实例。
   * @param input 输入。
   * @returns 结果。
   */
  public async unpack(
    input: IPrefabInstanceOpMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const nodePath = input.nodePath.trim();
    const uuid = (await this._resolveNodeUuid(nodePath)) ?? nodePath;
    return this._requestSceneFirst(
      [
        ["unlink-prefab", [uuid, true]],
        ["unlink-prefab", [uuid]],
        ["unlink-prefab", [{ uuid }]],
      ],
      "prefab_unpack",
    );
  }

  /**
   * @description 解除 Prefab 关联（unlink；message 尽力 → 场景脚本 unpack → unpack message）。
   * @param input 输入。
   * @returns 结果。
   */
  public async unlink(
    input: IPrefabInstanceOpMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const nodePath = input.nodePath.trim();
    const uuid = (await this._resolveNodeUuid(nodePath)) ?? nodePath;
    const unlinked = await this._requestSceneFirst(
      [
        ["unlink-prefab", [uuid, false]],
        ["unlink-prefab", [uuid]],
        ["unlink-prefab", [{ uuid }]],
        ["unlink-prefab", [nodePath]],
        ["unlink", [uuid]],
        ["prefab-unlink", [uuid]],
      ],
      "prefab_unlink",
    );
    if (unlinked.available) {
      return unlinked;
    }
    const viaScript = await this._unlinkViaSceneScript(uuid, unlinked.message);
    if (viaScript.available) {
      return viaScript;
    }
    return this._requestPrefabInstanceOp(
      nodePath,
      "unpack-prefab",
      "prefab_unlink_via_unpack",
    );
  }

  /**
   * @description 查询 Prefab / 实例信息。
   * @param input 输入。
   * @returns 结果。
   */
  public async getInfo(
    input: IPrefabGetInfoMcpInput,
  ): Promise<IEditorMcpSceneOpResult> {
    const key = input.pathOrUuid.trim();
    if (key.length === 0) {
      throw new Error("editor_mcp_prefab_path_or_uuid_required");
    }
    const assetRead = this._runtime.assetRead;
    if (
      assetRead != null &&
      (key.includes("/") || key.startsWith("db://") || /\.prefab$/iu.test(key))
    ) {
      try {
        const info = await assetRead.query(key.replace(/^db:\/\//, ""));
        return this._finalize({
          available: true,
          message: "prefab_get_info_ok:asset_read",
          data: info,
        });
      } catch {
        // fall through to message
      }
    }
    return this._requestSceneFirst(
      [
        ["query-prefab", [key]],
        ["query-node", [key]],
      ],
      "prefab_get_info",
    );
  }

  /**
   * @description 解析 scene.open 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readOpenInput(input: ContractPayload | undefined): ISceneOpenMcpInput {
    return this._inputReader.readOpenInput(input);
  }

  /**
   * @description 解析 scene.save 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readSaveInput(input: ContractPayload | undefined): ISceneSaveMcpInput {
    return this._inputReader.readSaveInput(input);
  }

  /**
   * @description 解析 scene.reload 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readReloadInput(
    input: ContractPayload | undefined,
  ): ISceneReloadMcpInput {
    return this._inputReader.readReloadInput(input);
  }

  /**
   * @description 解析 scene.queryNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readQueryNodeInput(
    input: ContractPayload | undefined,
  ): ISceneQueryNodeMcpInput {
    return this._inputReader.readQueryNodeInput(input);
  }

  /**
   * @description 解析 scene.focusNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readFocusNodeInput(
    input: ContractPayload | undefined,
  ): ISceneFocusNodeMcpInput {
    return this._inputReader.readFocusNodeInput(input);
  }

  /**
   * @description 解析 scene.createNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readCreateNodeInput(
    input: ContractPayload | undefined,
  ): ISceneCreateNodeMcpInput {
    return this._inputReader.readCreateNodeInput(input);
  }

  /**
   * @description 解析 prefab.createFromNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readCreateFromNodeInput(
    input: ContractPayload | undefined,
  ): IPrefabCreateFromNodeMcpInput {
    return this._inputReader.readCreateFromNodeInput(input);
  }

  /**
   * @description 解析 Prefab 实例操作输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readInstanceOpInput(
    input: ContractPayload | undefined,
  ): IPrefabInstanceOpMcpInput {
    return this._inputReader.readInstanceOpInput(input);
  }

  /**
   * @description 解析 prefab.getInfo 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readGetInfoInput(
    input: ContractPayload | undefined,
  ): IPrefabGetInfoMcpInput {
    return this._inputReader.readGetInfoInput(input);
  }
  /**
   * @description 将场景 db 路径解析为 AssetDB UUID。
   * @param dbPath `db://assets/...scene`。
   * @returns UUID；无法解析时为 null。
   */
  private async _resolveSceneUuid(dbPath: string): Promise<string | null> {
    const message = this._runtime.message;
    if (message != null) {
      const candidates: readonly (readonly [string, string, string])[] = [
        ["asset-db", "query-uuid", dbPath],
        ["asset-db", "query-uuid", dbPath.replace(/^db:\/\//u, "")],
      ];
      for (const [target, name, arg] of candidates) {
        try {
          const raw = await message.request(target, name, arg);
          if (typeof raw === "string" && this._isAssetUuid(raw)) {
            return raw;
          }
        } catch {
          // try next
        }
      }
      try {
        const info = await message.request(
          "asset-db",
          "query-asset-info",
          dbPath,
        );
        if (
          info != null &&
          typeof info === "object" &&
          !Array.isArray(info) &&
          typeof (info as { uuid?: unknown }).uuid === "string" &&
          this._isAssetUuid((info as { uuid: string }).uuid)
        ) {
          return (info as { uuid: string }).uuid;
        }
      } catch {
        // fall through to disk meta
      }
    }
    return this._resolveSceneUuidFromDiskMeta(dbPath);
  }

  /**
   * @description 从工程磁盘 `.scene.meta` 读取 UUID（AssetDB query 失败时的回退）。
   * @param dbPath `db://assets/...scene`。
   * @returns UUID；无法解析时为 null。
   */
  private async _resolveSceneUuidFromDiskMeta(
    dbPath: string,
  ): Promise<string | null> {
    const projectRead = this._runtime.projectRead;
    if (projectRead == null) {
      return null;
    }
    const projectPath = await projectRead.getProjectPath();
    if (projectPath == null || projectPath.trim().length === 0) {
      return null;
    }
    const relative = dbPath.replace(/^db:\/\//u, "").replace(/\\/gu, "/");
    const metaPath = join(projectPath, `${relative}.meta`);
    try {
      const raw = JSON.parse(readFileSync(metaPath, "utf8")) as unknown;
      if (
        raw != null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        typeof (raw as { uuid?: unknown }).uuid === "string" &&
        this._isAssetUuid((raw as { uuid: string }).uuid)
      ) {
        return (raw as { uuid: string }).uuid;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * @description 判断是否为 Creator 资产 UUID（不含 @ 子资源后缀）。
   * @param value 候选。
   * @returns 是否 UUID。
   */
  private _isAssetUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value.trim(),
    );
  }

  /**
   * @description 规范化为 `db://assets/...`。
   * @param pathOrUrl 输入。
   * @returns db 路径。
   */
  private _toDbAssetsPath(pathOrUrl: string): string {
    const trimmed = pathOrUrl.trim().replace(/\\/gu, "/");
    if (trimmed.startsWith("db://")) {
      return trimmed;
    }
    const withoutSlash = trimmed.replace(/^\/+/, "");
    return withoutSlash.startsWith("assets/")
      ? `db://${withoutSlash}`
      : `db://assets/${withoutSlash}`;
  }

  /**
   * @description 规范场景 path（去首尾斜杠、统一分隔符）。
   * @param value 原始 path。
   * @returns 规范化 path。
   */
  private _normalizeScenePath(value: string): string {
    return value.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
  }

  /**
   * @description 优先宿主场景脚本层次；空时回退 `query-node-tree`（供 action-router 委托）。
   * @param input 层次查询输入。
   * @returns 扁平节点快照与可用性。
   */
  public async getHierarchyWithFallback(input: {
    readonly includeEditorNodes?: boolean;
  }): Promise<{
    readonly nodes: readonly Record<string, unknown>[];
    readonly availability: EditorMcpThinLayerAvailability;
  }> {
    const loaded = await this._loadHierarchyNodes(input.includeEditorNodes === true);
    return {
      nodes: loaded.nodes,
      availability: loaded.availabilityHint,
    };
  }

  /**
   * @description open-scene 后轮询层次，直到有节点或超时（场景进程异步加载）。
   * @returns 沉降结果摘要。
   */
  public async waitForHierarchySettle(): Promise<{
    readonly waitedMs: number;
    readonly nodeCount: number;
    readonly settled: boolean;
    readonly sceneReady?: boolean;
  }> {
    if (this._runtime.scene == null) {
      return { waitedMs: 0, nodeCount: 0, settled: false };
    }
    const message = this._runtime.message;
    const deadline = Date.now() + 8000;
    let nodeCount = 0;
    let sceneReady = false;
    const started = Date.now();
    while (Date.now() < deadline) {
      if (message != null && !sceneReady) {
        try {
          const ready = await message.request("scene", "query-is-ready");
          sceneReady = ready === true;
        } catch {
          // 旧 Creator 可能无此消息。
        }
      }
      try {
        const hierarchy = await this.getHierarchyWithFallback({
          includeEditorNodes: false,
        });
        nodeCount = hierarchy.nodes.length;
        if (nodeCount > 0) {
          return {
            waitedMs: Date.now() - started,
            nodeCount,
            settled: true,
            sceneReady,
          };
        }
      } catch {
        // 继续等。
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 200);
      });
    }
    return {
      waitedMs: Date.now() - started,
      nodeCount,
      settled: false,
      sceneReady,
    };
  }

  /**
   * @description 加载扁平场景节点列表：宿主层次重试 + `query-node-tree` 回退。
   * @param includeEditorNodes 是否包含编辑器内部节点。
   * @returns 节点快照列表。
   */
  private async _loadHierarchyNodes(
    includeEditorNodes: boolean,
  ): Promise<{
    readonly nodes: readonly Record<string, unknown>[];
    readonly availabilityHint: EditorMcpThinLayerAvailability;
  }> {
    const scene = this._runtime.scene;
    const attempts = 4;
    if (scene != null) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const nodes = await scene.getHierarchy({ includeEditorNodes });
          if (Array.isArray(nodes) && nodes.length > 0) {
            return {
              nodes: nodes as readonly Record<string, unknown>[],
              availabilityHint: "live",
            };
          }
        } catch {
          // fall through to retry / query-node-tree
        }
        if (attempt + 1 < attempts) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 120);
          });
        }
      }
    }
    const fallbackNodes = await this._flattenQueryNodeTree(includeEditorNodes);
    return {
      nodes: fallbackNodes,
      availabilityHint: fallbackNodes.length > 0 ? "fallback" : "refused",
    };
  }

  /**
   * @description 用 Creator `query-node-tree` 展平为带 path 的节点列表。
   * @param includeEditorNodes 是否保留编辑器内部节点。
   * @returns 扁平列表；不可用时为空。
   */
  private async _flattenQueryNodeTree(
    includeEditorNodes: boolean,
  ): Promise<readonly Record<string, unknown>[]> {
    const message = this._runtime.message;
    if (message == null) {
      return [];
    }
    try {
      const tree = await message.request("scene", "query-node-tree");
      if (tree == null || typeof tree !== "object") {
        return [];
      }
      const nodes: Record<string, unknown>[] = [];
      const visit = (node: unknown, parentPath: string): void => {
        if (node == null || typeof node !== "object" || Array.isArray(node)) {
          return;
        }
        const record = node as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : "";
        const uuid = typeof record.uuid === "string" ? record.uuid : "";
        const hidden =
          record.hidden === true || record.should_hide_in_hierarchy === true;
        const nextPath =
          name.length > 0
            ? parentPath.length === 0
              ? name
              : `${parentPath}/${name}`
            : parentPath;
        const skipSelf =
          !includeEditorNodes && (hidden || name.startsWith("__"));
        if (!skipSelf && uuid.length > 0 && name.length > 0) {
          nodes.push({
            uuid,
            name,
            active: record.active !== false,
            path: nextPath,
            children: [],
          });
        }
        if (Array.isArray(record.children)) {
          for (const child of record.children) {
            visit(child, nextPath);
          }
        }
      };
      visit(tree, "");
      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * @description 判断节点快照是否匹配 path/name/uuid。
   * @param node 节点。
   * @param needle 查询。
   * @returns 是否匹配。
   */
  private _nodeMatches(node: Record<string, unknown>, needle: string): boolean {
    const normalizedNeedle = this._normalizeScenePath(needle);
    const needleLeaf =
      normalizedNeedle.split("/").filter((part) => part.length > 0).pop() ??
      normalizedNeedle;
    const candidates = [node.path, node.nodePath, node.name, node.uuid, node.id]
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\\/gu, "/"));
    return candidates.some((item) => {
      const normalized = this._normalizeScenePath(item);
      const leaf =
        normalized.split("/").filter((part) => part.length > 0).pop() ??
        normalized;
      return (
        item === needle ||
        normalized === normalizedNeedle ||
        item.endsWith(`/${needle}`) ||
        normalized.endsWith(`/${normalizedNeedle}`) ||
        normalizedNeedle.endsWith(`/${normalized}`) ||
        item.toLowerCase() === needle.toLowerCase() ||
        normalized.toLowerCase() === normalizedNeedle.toLowerCase() ||
        leaf.toLowerCase() === needleLeaf.toLowerCase()
      );
    });
  }

  /**
   * @description 将 path / uuid 解析为场景节点 uuid。
   * @param pathOrUuid 可选路径或 uuid。
   * @returns uuid；无法解析时 null。
   */
  private async _resolveNodeUuid(
    pathOrUuid: string | undefined,
  ): Promise<string | null> {
    if (pathOrUuid == null || pathOrUuid.trim().length === 0) {
      return null;
    }
    const needle = pathOrUuid.trim().replace(/\\/gu, "/");
    if (this._isAssetUuid(needle)) {
      return needle;
    }
    const scene = this._runtime.scene;
    if (scene == null) {
      return null;
    }
    try {
      const loaded = await this._loadHierarchyNodes(false);
      const hit = loaded.nodes.find((node) => this._nodeMatches(node, needle));
      if (hit == null) {
        return null;
      }
      const record = hit as unknown as Record<string, unknown>;
      if (typeof record.uuid === "string" && record.uuid.length > 0) {
        return record.uuid;
      }
      if (typeof record.id === "string" && record.id.length > 0) {
        return record.id;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * @description 将 MCP type 映射为 Creator create-node 常用 type 字段。
   * @param type 输入 type。
   * @returns 引擎 type 或 undefined（empty）。
   */
  private _mapCreateNodeType(type: string): string | undefined {
    const normalized = type.trim().toLowerCase();
    if (
      normalized.length === 0 ||
      normalized === "empty" ||
      normalized === "node"
    ) {
      return undefined;
    }
    if (normalized === "camera" || normalized === "cc.camera") {
      return "cc.Camera";
    }
    if (
      normalized === "light" ||
      normalized === "directionallight" ||
      normalized === "cc.directionallight"
    ) {
      return "cc.DirectionalLight";
    }
    return type.trim();
  }

  /** @description 宿主场景脚本包名候选（按优先级）。 */
  private static readonly _SCENE_SCRIPT_PACKAGES = [
    "peanut-pod",
    "peanut.plugin-host",
  ] as const;

  /**
   * @description 依次尝试宿主场景脚本包执行方法。
   * @param method 场景脚本方法名。
   * @param args 参数。
   * @returns 首个成功结果；全部失败时抛出最后一次错误。
   */
  private async _executeSceneScriptFirst<TData extends Record<string, unknown>>(
    method: string,
    args: readonly unknown[],
  ): Promise<{ readonly packageName: string; readonly data: TData }> {
    const scene = this._runtime.scene;
    if (scene == null || typeof scene.execute !== "function") {
      throw new Error("scene_script_unavailable");
    }
    let lastError = "scene_script_unavailable";
    for (const packageName of EditorMcpSceneGateway._SCENE_SCRIPT_PACKAGES) {
      try {
        const data = await scene.execute<TData>(packageName, method, args);
        return { packageName, data };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(lastError);
  }

  /**
   * @description 经宿主场景脚本创建节点。
   * @param options 父 uuid / 名 / 类型与 message 失败原因。
   * @returns 结果。
   */
  private async _createNodeViaSceneScript(options: {
    readonly parentUuid: string | null;
    readonly name: string | undefined;
    readonly type: string;
    readonly messageFallback: string;
  }): Promise<IEditorMcpSceneOpResult> {
    const scene = this._runtime.scene;
    if (scene == null || typeof scene.execute !== "function") {
      return this._finalize({
        available: false,
        message: `${options.messageFallback};scene_script_unavailable`,
        data: {
          bestEffort: true,
          recommended:
            "use lumen.nodeAdd / lumen.structure for persistent edits",
        },
      });
    }
    try {
      const executed = await this._executeSceneScriptFirst<Record<string, unknown>>(
        "createChildNode",
        [
          {
            ...(options.parentUuid != null
              ? { parentUuid: options.parentUuid }
              : {}),
            ...(options.name != null ? { name: options.name } : {}),
            type: options.type,
          },
        ],
      );
      return this._finalize({
        available: true,
        message: "scene_create_node_ok:host_scene_script",
        data: {
          ...executed.data,
          sceneScriptPackage: executed.packageName,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this._finalize({
        available: false,
        message: `${options.messageFallback};scene_script_failed:${detail}`,
        data: {
          bestEffort: true,
          recommended:
            "use lumen.nodeAdd / lumen.structure for persistent edits",
        },
      });
    }
  }

  /**
   * @description 经宿主场景脚本 unpack Prefab 实例。
   * @param uuid 节点 uuid。
   * @param messageFallback message 失败原因。
   * @returns 结果。
   */
  private async _unlinkViaSceneScript(
    uuid: string,
    messageFallback: string,
  ): Promise<IEditorMcpSceneOpResult> {
    const scene = this._runtime.scene;
    if (scene == null || typeof scene.execute !== "function") {
      return this._finalize({
        available: false,
        message: `${messageFallback};scene_script_unavailable`,
      });
    }
    try {
      const executed = await this._executeSceneScriptFirst<Record<string, unknown>>(
        "unlinkPrefabInstance",
        [{ uuid }],
      );
      return this._finalize({
        available: true,
        message: "prefab_unlink_ok:host_scene_script",
        data: {
          ...executed.data,
          sceneScriptPackage: executed.packageName,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this._finalize({
        available: false,
        message: `${messageFallback};scene_script_failed:${detail}`,
      });
    }
  }

  /**
   * @description Prefab 实例操作消息尝试。
   * @param nodePath 节点。
   * @param message 消息名。
   * @param label 结果前缀。
   * @returns 结果。
   */
  private async _requestPrefabInstanceOp(
    nodePath: string,
    message: string,
    label: string,
  ): Promise<IEditorMcpSceneOpResult> {
    return this._requestSceneFirst(
      [
        [message, [nodePath.trim()]],
        [message, [{ uuid: nodePath.trim() }]],
      ],
      label,
    );
  }

  /**
   * @description 等待 AssetDB 能读到刚创建的资源，避免把空操作误报为成功。
   * @param dbPath db:// 资源路径。
   * @returns 资源信息；超时或无读取能力时返回 null。
   */
  private async _waitForReadableAsset(
    dbPath: string,
  ): Promise<Record<string, unknown> | null> {
    const assetRead = this._runtime.assetRead;
    if (assetRead == null) {
      return null;
    }
    const queryPath = dbPath.replace(/^db:\/\//u, "");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const result = await assetRead.query(queryPath);
        if (result != null && typeof result === "object") {
          return result as Record<string, unknown>;
        }
      } catch {}
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    return null;
  }

  /**
   * @description 从 Creator 节点 dump 解析 Prefab 资源 UUID。
   * @param nodeUuid Prefab 实例节点 UUID。
   * @returns Prefab 资源 UUID；无法解析时返回 null。
   */
  private async _resolvePrefabAssetUuid(
    nodeUuid: string,
  ): Promise<string | null> {
    const message = this._runtime.message;
    if (message == null) {
      return null;
    }
    try {
      const node = await message.request<Record<string, unknown>>(
        "scene",
        "query-node",
        nodeUuid,
      );
      const prefab = node.__prefab__;
      if (prefab == null || typeof prefab !== "object") {
        return null;
      }
      const prefabRecord = prefab as Record<string, unknown>;
      const state = prefabRecord.prefabStateInfo;
      if (state != null && typeof state === "object") {
        const assetUuid = (state as Record<string, unknown>).assetUuid;
        if (typeof assetUuid === "string" && assetUuid.length > 0) {
          return assetUuid;
        }
      }
      return typeof prefabRecord.uuid === "string" && prefabRecord.uuid.length > 0
        ? prefabRecord.uuid
        : null;
    } catch {
      return null;
    }
  }

  /**
   * @description 单次 scene 消息。
   * @param message 消息名。
   * @param args 参数。
   * @param label 结果前缀。
   * @returns 结果。
   */
  private async _requestScene(
    message: string,
    args: readonly unknown[],
    label: string,
  ): Promise<IEditorMcpSceneOpResult> {
    return this._requestSceneFirst([[message, args]], label);
  }

  /**
   * @description 依次尝试多个 scene 消息。
   * @param candidates 候选。
   * @param label 结果前缀。
   * @returns 结果。
   */
  private async _requestSceneFirst(
    candidates: readonly (readonly [string, readonly unknown[]])[],
    label: string,
  ): Promise<IEditorMcpSceneOpResult> {
    const message = this._runtime.message;
    if (message == null) {
      return this._finalize({
        available: false,
        message: `${label}_unavailable:runtime_message_missing`,
      });
    }
    const errors: string[] = [];
    for (const [name, args] of candidates) {
      // 硬闸：禁止 Creator save* 弹窗路径（二次确认会断开无头 Agent）。
      if (CREATOR_SCENE_SAVE_MESSAGES.has(name)) {
        return this._finalize({
          available: false,
          message: "scene_save_refused:use_lumen_offline_write",
          data: {
            blockedMessage: name,
            reason: "creator_save_dialog_blocks_automation",
            doNotCall: [...CREATOR_SCENE_SAVE_MESSAGES],
          },
        });
      }
      // 硬闸：Creator open-scene 只接受 UUID。传 db:// 会变成 import://db/db://… 并刷 project.log。
      if (name === "open-scene") {
        const arg = args[0];
        if (typeof arg !== "string" || !this._isAssetUuid(arg)) {
          return this._finalize({
            available: false,
            message: "scene_open_blocked:open_scene_requires_uuid_not_db_path",
            data: {
              received: typeof arg === "string" ? arg : typeof arg,
              hint: "resolve asset-db query-uuid first; never pass db:// to open-scene",
            },
          });
        }
      }
      try {
        const data = await message.request("scene", name, ...args);
        return this._finalize({
          available: true,
          message: `${label}_ok:${name}`,
          data,
        });
      } catch (error) {
        errors.push(
          `${name}:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return this._finalize({
      available: false,
      message: `${label}_unavailable:no_supported_message`,
      data: { tried: candidates.map(([name]) => name), errors },
    });
  }

  /**
   * @description 为场景薄层结果附加 availability。
   * @param result 原始结果片段。
   * @returns 完整场景操作结果。
   */
  private _finalize(
    result: IEditorMcpThinLayerAvailabilityInput & Partial<IEditorMcpSceneOpResult>,
  ): IEditorMcpSceneOpResult {
    return EditorMcpThinLayerAvailabilityMapper.attach(result);
  }
}
