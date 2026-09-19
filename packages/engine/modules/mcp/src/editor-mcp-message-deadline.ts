/**
 * @description 为不可取消的 Creator 消息提供统一调用期限。
 */
export class EditorMcpMessageDeadline {
  /**
   * @description Creator Scene 包打开消息的单次等待上限。
   */
  public static readonly sceneOpenMs = 1500;

  /**
   * @description Creator AssetDB 打开消息的单次等待上限。
   */
  public static readonly assetDbOpenMs = 1500;

  /**
   * @description Creator Scene 状态探针的单次等待上限。
   */
  public static readonly sceneProbeMs = 500;

  /**
   * @description 在调用侧期限内等待 Creator 消息，迟到结果由原 Promise 自行收口。
   * @param request Creator 消息 Promise。
   * @param timeoutMs 最长等待毫秒数。
   * @param errorCode 超时时稳定错误码。
   * @returns 在期限内完成的消息结果。
   */
  public static async wait<T>(
    request: Promise<T>,
    timeoutMs: number,
    errorCode: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
