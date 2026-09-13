import type {
  ContractPayload,
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

/**
 * @description 校验并规范化 Scene 与 Prefab 实例操作的未受信输入。
 */
export class EditorMcpSceneInputReader {
  /**
   * @description 解析 scene.open 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readOpenInput(input: ContractPayload | undefined): ISceneOpenMcpInput {
    if (
      input == null ||
      typeof input.path !== "string" ||
      input.path.trim().length === 0
    ) {
      throw new Error("editor_mcp_scene_open_path_required");
    }
    return { path: input.path.trim() };
  }

  /**
   * @description 解析 scene.save 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readSaveInput(input: ContractPayload | undefined): ISceneSaveMcpInput {
    const path =
      input != null &&
      typeof input.path === "string" &&
      input.path.trim().length > 0
        ? input.path.trim()
        : undefined;
    return path == null ? {} : { path };
  }

  /**
   * @description 解析 scene.reload 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readReloadInput(
    input: ContractPayload | undefined,
  ): ISceneReloadMcpInput {
    return { soft: input?.soft !== false };
  }

  /**
   * @description 解析 scene.queryNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readQueryNodeInput(
    input: ContractPayload | undefined,
  ): ISceneQueryNodeMcpInput {
    if (
      input == null ||
      typeof input.path !== "string" ||
      input.path.trim().length === 0
    ) {
      throw new Error("editor_mcp_scene_query_node_path_required");
    }
    return {
      path: input.path.trim(),
      includeEditorNodes: input.includeEditorNodes === true,
    };
  }

  /**
   * @description 解析 scene.focusNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readFocusNodeInput(
    input: ContractPayload | undefined,
  ): ISceneFocusNodeMcpInput {
    if (
      input == null ||
      typeof input.path !== "string" ||
      input.path.trim().length === 0
    ) {
      throw new Error("editor_mcp_scene_focus_node_path_required");
    }
    return { path: input.path.trim() };
  }

  /**
   * @description 解析 scene.createNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readCreateNodeInput(
    input: ContractPayload | undefined,
  ): ISceneCreateNodeMcpInput {
    const parentPath = this._readOptionalTrimmedString(input, "parentPath");
    const name = this._readOptionalTrimmedString(input, "name");
    const type = this._readOptionalTrimmedString(input, "type");
    return {
      ...(parentPath != null ? { parentPath } : {}),
      ...(name != null ? { name } : {}),
      ...(type != null ? { type } : {}),
    };
  }

  /**
   * @description 解析 prefab.createFromNode 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readCreateFromNodeInput(
    input: ContractPayload | undefined,
  ): IPrefabCreateFromNodeMcpInput {
    if (
      input == null ||
      typeof input.nodePath !== "string" ||
      input.nodePath.trim().length === 0 ||
      typeof input.prefabPath !== "string" ||
      input.prefabPath.trim().length === 0
    ) {
      throw new Error("editor_mcp_prefab_create_node_and_path_required");
    }
    return {
      nodePath: input.nodePath.trim(),
      prefabPath: input.prefabPath.trim(),
    };
  }

  /**
   * @description 解析 Prefab 实例操作输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readInstanceOpInput(
    input: ContractPayload | undefined,
  ): IPrefabInstanceOpMcpInput {
    if (
      input == null ||
      typeof input.nodePath !== "string" ||
      input.nodePath.trim().length === 0
    ) {
      throw new Error("editor_mcp_prefab_node_path_required");
    }
    return { nodePath: input.nodePath.trim() };
  }

  /**
   * @description 解析 prefab.getInfo 输入。
   * @param input 未校验输入。
   * @returns 已验证输入。
   */
  public readGetInfoInput(
    input: ContractPayload | undefined,
  ): IPrefabGetInfoMcpInput {
    if (
      input == null ||
      typeof input.pathOrUuid !== "string" ||
      input.pathOrUuid.trim().length === 0
    ) {
      throw new Error("editor_mcp_prefab_path_or_uuid_required");
    }
    return { pathOrUuid: input.pathOrUuid.trim() };
  }

  /**
   * @description 从契约对象读取可选非空字符串。
   * @param input 未校验输入。
   * @param key 字段名。
   * @returns 规范化字符串或 `undefined`。
   */
  private _readOptionalTrimmedString(
    input: ContractPayload | undefined,
    key: string,
  ): string | undefined {
    const value = input?.[key];
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }
}
