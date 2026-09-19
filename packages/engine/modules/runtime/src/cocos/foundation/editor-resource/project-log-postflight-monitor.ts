import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * @description 写操作前记录的 project.log 检查点。
 */
export interface IProjectLogCheckpoint {
  /** @description 日志绝对路径。 */
  readonly path: string;
  /** @description 检查点时的字节偏移。 */
  readonly offset: number;
}

/**
 * @description 写操作后的 project.log 增量检查结果。
 */
export interface IProjectLogPostflightResult {
  /** @description 是否成功读取日志增量。 */
  readonly logChecked: boolean;
  /** @description 日志路径。 */
  readonly logPath: string;
  /** @description 新增错误条数。 */
  readonly newErrorCount: number;
  /** @description 新增警告条数。 */
  readonly newWarningCount: number;
  /** @description 新增错误摘要（截断）。 */
  readonly newErrors: readonly string[];
  /** @description 新增警告摘要（截断）。 */
  readonly newWarnings: readonly string[];
  /** @description 无相关错误时为 `true`。 */
  readonly verified: boolean;
  /** @description 读日志失败时的可诊断信息。 */
  readonly error?: string;
}

/**
 * @description 对 Creator `temp/logs/project.log` 做增量检查的后置监视器。
 */
export class ProjectLogPostflightMonitor {
  /** @description 单次返回的最大错误/警告条数。 */
  private static readonly _maxLines = 20;

  /**
   * @description 在写操作开始前记录日志偏移。
   * @param projectRoot 已验证的项目根目录。
   * @returns 检查点；文件不存在时 offset 为 0。
   */
  public checkpoint(projectRoot: string): IProjectLogCheckpoint {
    const root = this._readProjectRoot(projectRoot);
    const logPath = join(root, "temp", "logs", "project.log");
    if (!existsSync(logPath)) {
      return { path: logPath, offset: 0 };
    }
    try {
      return { path: logPath, offset: statSync(logPath).size };
    } catch {
      return { path: logPath, offset: 0 };
    }
  }

  /**
   * @description 读取检查点之后的日志增量并分类错误/警告。
   * @param checkpoint 写操作前的检查点。
   * @returns 结构化 postflight 结果。
   */
  public readDelta(
    checkpoint: IProjectLogCheckpoint,
  ): IProjectLogPostflightResult {
    if (
      typeof checkpoint.path !== "string" ||
      checkpoint.path.trim().length === 0
    ) {
      return {
        logChecked: false,
        logPath: "",
        newErrorCount: 0,
        newWarningCount: 0,
        newErrors: [],
        newWarnings: [],
        verified: false,
        error: "project_log_checkpoint_invalid",
      };
    }
    if (!Number.isFinite(checkpoint.offset) || checkpoint.offset < 0) {
      return {
        logChecked: false,
        logPath: checkpoint.path,
        newErrorCount: 0,
        newWarningCount: 0,
        newErrors: [],
        newWarnings: [],
        verified: false,
        error: "project_log_offset_invalid",
      };
    }
    try {
      if (!existsSync(checkpoint.path)) {
        return {
          logChecked: true,
          logPath: checkpoint.path,
          newErrorCount: 0,
          newWarningCount: 0,
          newErrors: [],
          newWarnings: [],
          verified: true,
        };
      }
      const text = readFileSync(checkpoint.path, "utf8").slice(
        checkpoint.offset,
      );
      const lines = text
        .split(/\r?\n/u)
        .filter((line: string) => line.trim().length > 0);
      // 优先信任 Creator 行级 severity（` - error:` / ` - warn:`）；避免 warn 行里的 `Error:` 栈污染 postflight。
      const errors = lines
        .filter((line: string) => isCreatorErrorLine(line))
        .slice(-ProjectLogPostflightMonitor._maxLines);
      const warnings = lines
        .filter((line: string) => isCreatorWarningLine(line))
        .slice(-ProjectLogPostflightMonitor._maxLines);
      return {
        logChecked: true,
        logPath: checkpoint.path,
        newErrorCount: errors.length,
        newWarningCount: warnings.length,
        newErrors: errors,
        newWarnings: warnings,
        verified: errors.length === 0,
      };
    } catch (error: unknown) {
      return {
        logChecked: false,
        logPath: checkpoint.path,
        newErrorCount: 0,
        newWarningCount: 0,
        newErrors: [],
        newWarnings: [],
        verified: false,
        error:
          error instanceof Error ? error.message : "project_log_read_failed",
      };
    }
  }

  /**
   * @description 解析工程 project.log 绝对路径。
   * @param projectRoot 工程根。
   * @returns 日志路径。
   */
  public resolveLogPath(projectRoot: string): string {
    return join(
      this._readProjectRoot(projectRoot),
      "temp",
      "logs",
      "project.log",
    );
  }

  /**
   * @description 读取当前 project.log 字节偏移（文件不存在则为 0）。
   * @param projectRoot 工程根。
   * @returns 偏移。
   */
  public readCurrentOffset(projectRoot: string): number {
    return this.checkpoint(projectRoot).offset;
  }

  /**
   * @description 读取 project.log 尾部错误行（不依赖写前检查点）。
   * @param projectRoot 工程根。
   * @param limit 返回上限。
   * @returns 错误行与日志路径。
   */
  public readRecentErrors(
    projectRoot: string,
    limit = 50,
  ): {
    readonly logPath: string;
    readonly errors: readonly string[];
    readonly available: boolean;
  } {
    const root = this._readProjectRoot(projectRoot);
    const logPath = join(root, "temp", "logs", "project.log");
    const capped =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.min(200, Math.max(1, Math.floor(limit)))
        : 50;
    if (!existsSync(logPath)) {
      return { logPath, errors: [], available: false };
    }
    try {
      const text = readFileSync(logPath, "utf8");
      const errors = text
        .split(/\r?\n/u)
        .filter((line: string) => line.trim().length > 0)
        .filter((line: string) => isCreatorErrorLine(line))
        .slice(-capped);
      return { logPath, errors, available: true };
    } catch {
      return { logPath, errors: [], available: false };
    }
  }

  /**
   * @description 校验项目根路径非空。
   * @param projectRoot 未校验输入。
   * @returns 规范化后的项目根。
   */
  private _readProjectRoot(projectRoot: string): string {
    if (typeof projectRoot !== "string" || projectRoot.trim().length === 0) {
      throw new Error("project_log_project_root_invalid");
    }
    return projectRoot.trim();
  }
}

/**
 * @description 解析 Creator project.log 行级 severity（` - error:` / ` - warn:`）。
 * @param line 日志行。
 * @returns severity；无前缀时返回 null。
 * @oopException 纯日志行解析，无对象归属。
 */
function readCreatorLogSeverity(
  line: string,
): "error" | "warn" | "other" | null {
  const match = /(?:\s-\s*|^\s*)(error|warn(?:ing)?|info|log|debug)\s*:/iu.exec(line);
  if (match == null) {
    return null;
  }
  const raw = (match[1] ?? "").toLowerCase();
  if (raw === "error") {
    return "error";
  }
  if (raw.startsWith("warn")) {
    return "warn";
  }
  return "other";
}

/**
 * @description 判断是否应计入 postflight 错误。
 * @param line 日志行。
 * @returns 是否错误行。
 * @oopException 纯分类函数，无对象归属。
 */
function isCreatorErrorLine(line: string): boolean {
  if (/Render frame was disposed before WebFrameMain could be accessed/iu.test(line)) {
    return false;
  }
  const severity = readCreatorLogSeverity(line);
  if (severity === "warn" || severity === "other") {
    return false;
  }
  if (severity === "error") {
    return true;
  }
  // 无 Creator 行级 severity 时：只计主错误消息，忽略栈帧 / console.error 钩子，避免 Agent 误判。
  if (/^\s*at\s+/u.test(line) || /\bconsole\.error\b/iu.test(line)) {
    return false;
  }
  return /(?:^|\s)Error:|exception|failed|cannot read|cannot find/iu.test(line);
}

/**
 * @description 判断是否应计入 postflight 警告。
 * @param line 日志行。
 * @returns 是否警告行。
 * @oopException 纯分类函数，无对象归属。
 */
function isCreatorWarningLine(line: string): boolean {
  const severity = readCreatorLogSeverity(line);
  if (severity === "warn") {
    return true;
  }
  if (severity != null) {
    return false;
  }
  return /\bwarn(?:ing)?\b|slow editor operation/iu.test(line);
}
