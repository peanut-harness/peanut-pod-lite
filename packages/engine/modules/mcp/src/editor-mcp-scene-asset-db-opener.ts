import type { IGrantedRuntimeClientSet } from "@peanut/pod-sdk";

import { EditorMcpMessageDeadline } from "./editor-mcp-message-deadline.js";
import { EditorMcpThinLayerAvailabilityMapper } from "./editor-mcp-thin-layer-availability.js";
import type { IEditorMcpSceneOpResult } from "./editor-mcp-scene-gateway.js";

/**
 * @description 通过 Creator AssetDB 消息触发场景打开。
 */
export class EditorMcpSceneAssetDbOpener {
  public constructor(private readonly _runtime: IGrantedRuntimeClientSet) {}

  /**
   * @description 用场景 UUID 触发 AssetDB 打开。
   */
  public async open(uuid: string): Promise<IEditorMcpSceneOpResult> {
    const message = this._runtime.message;
    if (message == null) {
      return this._result(false, "scene_open_unavailable:runtime_message_missing");
    }
    const errors: string[] = [];
    if (typeof message.send === "function") {
      try {
        await EditorMcpMessageDeadline.wait(
          message.send("asset-db", "open-asset", uuid),
          EditorMcpMessageDeadline.assetDbOpenMs,
          "creator_asset_db_open_send_timeout",
        );
        return this._result(true, "scene_open_accepted:asset-db:open-asset", {
          delivery: "send",
        });
      } catch (error) {
        errors.push(
          `send:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      const data = await EditorMcpMessageDeadline.wait(
        message.request("asset-db", "open-asset", uuid),
        EditorMcpMessageDeadline.assetDbOpenMs,
        "creator_asset_db_open_request_timeout",
      );
      return this._result(true, "scene_open_ok:asset-db:open-asset", data);
    } catch (error) {
      errors.push(
        `request:${error instanceof Error ? error.message : String(error)}`,
      );
      return this._result(
        false,
        "scene_open_unavailable:asset-db_open_asset_failed",
        { errors },
      );
    }
  }

  private _result(
    available: boolean,
    message: string,
    data?: unknown,
  ): IEditorMcpSceneOpResult {
    return EditorMcpThinLayerAvailabilityMapper.attach({
      available,
      message,
      ...(data === undefined ? {} : { data }),
    });
  }
}
