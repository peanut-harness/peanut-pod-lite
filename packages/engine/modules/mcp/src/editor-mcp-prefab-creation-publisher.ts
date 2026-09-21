import type {
  EditorMcpAssetDbCreationCoordinator,
  IEditorMcpAssetDbCreationLifecycle,
  IEditorMcpAssetDbCreationEvidence,
} from "./editor-mcp-asset-db-creation-coordinator.js";

/**
 * @description Creator 原生 Prefab 发布结果的最小契约。
 */
interface IPrefabHostPublishResult {
  readonly available: boolean;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * @description Creator 原生 Prefab 首次发布与原子创建协调器的适配器。
 */
export class EditorMcpPrefabCreationPublisher {
  /**
   * @description 发布 Prefab，并在配置协调器时返回经 AssetDB 验证的创建身份。
   * @param coordinator 共享创建协调器。
   * @param targetPath Prefab db 路径。
   * @param lifecycle 任务生命周期。
   * @param publish Creator 原生发布调用。
   * @returns 宿主结果与可选创建身份。
   */
  public async publish<T extends IPrefabHostPublishResult>(
    coordinator: EditorMcpAssetDbCreationCoordinator | null,
    targetPath: string,
    lifecycle: IEditorMcpAssetDbCreationLifecycle | undefined,
    publish: () => Promise<T>,
  ): Promise<{ readonly created: T; readonly creation: IEditorMcpAssetDbCreationEvidence | null }> {
    let created: T | null = null;
    const invoke = async (): Promise<unknown> => {
      created = await publish();
      if (!created.available) {
        throw new Error(created.message);
      }
      return created.data;
    };
    const creation = coordinator == null
      ? (await invoke(), null)
      : await coordinator.create({ targetPath, resourceType: "prefab", publish: invoke, lifecycle });
    if (created == null) {
      throw new Error("prefab_create_publisher_result_missing");
    }
    return { created, creation };
  }
}
