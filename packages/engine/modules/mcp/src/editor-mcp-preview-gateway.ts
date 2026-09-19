import { existsSync, readFileSync } from "fs";
import { join } from "path";

import type {
  ContractPayload,
  EditorMcpThinLayerAvailability,
  IPreviewQueryErrorsMcpInput,
  IPreviewQueryMcpInput,
  IPreviewRefreshMcpInput,
} from "@peanut/pod-protocol";
import type { IGrantedRuntimeClientSet } from "@peanut/pod-sdk";
import { AssetCatalogBuilder } from "@peanut/pod-engine/assets";
import { ProjectLogPostflightMonitor } from "@peanut/pod-engine/runtime";

import { EditorMcpThinLayerAvailabilityMapper } from "./editor-mcp-thin-layer-availability.js";
import type { IEditorMcpThinLayerAvailabilityInput } from "./editor-mcp-thin-layer-availability.js";
import { EditorMcpLumen24Bridge } from "./editor-mcp-lumen-24-bridge.js";

/**
 * @description 预览 MCP 结果（可能标记为不可用）。
 */
export interface IEditorMcpPreviewResult {
  /** @description 是否可用。 */
  readonly available: boolean;
  /** @description 说明。 */
  readonly message: string;
  /** @description Agent 可观测：live / fallback / refused。 */
  readonly availability: EditorMcpThinLayerAvailability;
  /** @description 数据来源。 */
  readonly source?: "live" | "fallback" | "project_log";
  /** @description 可选 URL。 */
  readonly url?: string;
  /** @description 可选端口。 */
  readonly port?: number;
  /** @description 可选启动场景 uuid / 配置原文。 */
  readonly startScene?: string;
  /** @description 启动场景工程相对路径（若可从 catalog 解析）。 */
  readonly startScenePath?: string;
  /** @description 启动场景 `db://` 路径。 */
  readonly startSceneDbPath?: string;
  /** @description 错误行。 */
  readonly errors?: readonly string[];
  /** @description 当前 project.log 字节偏移（供下次 sinceOffset）。 */
  readonly logOffset?: number;
  /** @description sinceOffset 模式下新增错误条数。 */
  readonly newErrorCount?: number;
  /** @description sinceOffset 模式下无新增错误时为 true。 */
  readonly verified?: boolean;
  /**
   * @description Agent 验收判定：`pass`/`fail` 仅在 sinceOffset 增量模式；无 sinceOffset 为 `observe`（历史观测，不算失败）。
   */
  readonly verdict?: "pass" | "fail" | "observe";
  /** @description 给 Agent 的下一步说明（勿把 observe 当失败重试）。 */
  readonly agentHint?: string;
  /** @description 可选下一步（跟 recommendedNext 习惯一致）。 */
  readonly recommendedNext?: {
    readonly operation: string;
    readonly input: Record<string, unknown>;
  };
}

/** @description 预览网关内部草稿（finalize 前可无 availability）。 */
type IEditorMcpPreviewResultDraft = Omit<
  IEditorMcpPreviewResult,
  "availability"
>;

/**
 * @description 预览闭环网关：live message → 工程配置 fallback → project.log。
 */
export class EditorMcpPreviewGateway {
  /** @description 常见浏览器预览端口（多开 Creator 时常递增）。 */
  private static readonly _defaultPorts: readonly number[] = [
    7456, 7457, 7458, 7459, 7460, 8080,
  ];

  /** @description 授权 runtime。 */
  private readonly _runtime: IGrantedRuntimeClientSet;
  /** @description 解析工程根。 */
  private readonly _resolveProjectRoot: () => Promise<string | null>;
  /** @description project.log 监视器。 */
  private readonly _projectLog: ProjectLogPostflightMonitor;

  /**
   * @description 构造预览网关。
   * @param runtime 授权 runtime。
   * @param resolveProjectRoot 可选工程根解析。
   */
  public constructor(
    runtime: IGrantedRuntimeClientSet,
    resolveProjectRoot: () => Promise<string | null> = async () => null,
  ) {
    this._runtime = runtime;
    this._resolveProjectRoot = resolveProjectRoot;
    this._projectLog = new ProjectLogPostflightMonitor();
  }

  /**
   * @description 查询预览 URL / 端口。
   * @param input 可选平台提示。
   * @returns 预览信息。
   */
  public async query(
    input: IPreviewQueryMcpInput,
  ): Promise<IEditorMcpPreviewResult> {
    const liveTried: string[] = [];
    // Creator 2.4 无 3.x preview/builder IPC；盲探会刷 `sendToMain "…" failed, no response received`。
    if (EditorMcpLumen24Bridge.isCreator2x()) {
      liveTried.push("creator2x:skip_live_preview_ipc");
      const fallback2x = await this._queryFallbackFromProject();
      if (fallback2x != null) {
        return this._enrichStartScene({
          ...fallback2x,
          message: `${fallback2x.message};creator2x_port_or_settings`,
        });
      }
      return this._finalize({
        available: false,
        message:
          "preview_unavailable:creator2x:open_browser_preview_or_check_port_7456+",
      });
    }
    const message = this._runtime.message;
    if (message != null) {
      const live = await this._queryLivePreview(message, liveTried);
      if (live != null) {
        return this._enrichStartScene(live);
      }
      try {
        await message.send("preview", "open-terminal", undefined);
        liveTried.push("preview.open-terminal");
      } catch {
        // optional warm-up
      }
      const afterWarmup = await this._queryLivePreview(message, liveTried);
      if (afterWarmup != null) {
        return this._enrichStartScene(afterWarmup);
      }
    }
    const fallback = await this._queryFallbackFromProject();
    if (fallback != null) {
      return this._enrichStartScene({
        ...fallback,
        message:
          liveTried.length > 0
            ? `${fallback.message};live_tried=${liveTried.join(",")}`
            : fallback.message,
      });
    }
    return this._finalize({
      available: false,
      message:
        liveTried.length > 0
          ? `preview_unavailable:no_supported_message_or_fallback;live_tried=${liveTried.join(",")}`
          : "preview_unavailable:no_supported_message_or_fallback; open Browser Preview in Creator or check port 7456",
    });
  }

  /**
   * @description 尝试 Creator live message 查询预览信息。
   * @param message runtime message 客户端。
   * @param liveTried 已尝试的 message 名（输出）。
   * @returns live 结果；全部失败返回 null。
   */
  private async _queryLivePreview(
    message: NonNullable<IGrantedRuntimeClientSet["message"]>,
    liveTried: string[],
  ): Promise<IEditorMcpPreviewResultDraft | null> {
    const liveCandidates = [
      ["preview", "query-preview-url"] as const,
      ["preview", "query-port"] as const,
      ["preview", "get-preview-url"] as const,
      ["preview", "query-info"] as const,
      ["preview", "query-preview-info"] as const,
      ["preview", "query-settings"] as const,
      ["preview", "get-preview-settings"] as const,
      ["preview", "query-server"] as const,
      ["preview", "get-server"] as const,
      ["server", "query-port"] as const,
      ["server", "query-preview-url"] as const,
      ["server", "query-ip"] as const,
      ["server", "query-url"] as const,
      ["device-manager", "query-port"] as const,
      ["device-manager", "query-preview-url"] as const,
      ["builder", "get-preview-settings"] as const,
      ["builder", "query-preview-settings"] as const,
      ["builder", "query-preview-url"] as const,
      ["scene", "query-preview-url"] as const,
      ["programmer", "query-preview-url"] as const,
    ];
    for (const [target, name] of liveCandidates) {
      const key = `${target}.${name}`;
      for (const args of [[{}], []] as const) {
        try {
          const raw = await message.request(target, name, ...args);
          liveTried.push(args.length === 0 ? `${key}:noarg` : key);
          const parsed = this._parsePreviewPayload(raw, "live");
          if (parsed != null) {
            return {
              ...parsed,
              message: `${parsed.message}:${key}`,
            };
          }
        } catch {
          liveTried.push(
            args.length === 0 ? `${key}:noarg:fail` : `${key}:fail`,
          );
        }
      }
    }
    return null;
  }

  /**
   * @description 刷新预览（尽力而为）。
   * @param input 刷新选项。
   * @returns 结果。
   */
  public async refresh(
    input: IPreviewRefreshMcpInput,
  ): Promise<IEditorMcpPreviewResult> {
    // Creator 2.4：无 3.x preview message；刷 AssetDB 即刷新预览可用资产。
    const host = globalThis as {
      Editor?: {
        versions?: { CocosCreator?: string };
        assetdb?: {
          refresh?: (
            url: string,
            cb?: (error: Error | null, result?: unknown) => void,
          ) => void;
        };
      };
    };
    const cocos = host.Editor?.versions?.CocosCreator ?? "";
    if (/^2\./.test(cocos) && typeof host.Editor?.assetdb?.refresh === "function") {
      if (input.refreshAssets !== false) {
        await new Promise<void>((resolve) => {
          host.Editor!.assetdb!.refresh!("db://assets/", () => resolve());
        });
      }
      return this._finalize({
        available: true,
        source: "live",
        message: "preview_refresh_ok:creator2x_assetdb_refresh",
      });
    }
    const message = this._runtime.message;
    if (message == null) {
      return this._finalize({
        available: false,
        message: "preview_refresh_unavailable:runtime_message_missing",
      });
    }
    if (input.refreshAssets !== false) {
      try {
        // Creator 3.8 `refresh-asset` 只接受 db URL 字符串；传对象会误走导入路径并报「不支持目录导入」。
        await message.request("asset-db", "refresh-asset", "db://assets/");
      } catch {
        // continue
      }
    }
    let opened = false;
    try {
      // Creator 3.8 的预览面板“播放”按钮调用 preview.open-terminal；
      // start-preview 不在 3.8 的消息清单中。
      // Do not await Creator's terminal lifecycle: before Scene is ready the
      // request form can hold the Hub lane until its timeout. The official
      // Message API provides send for this command-style operation.
      await message.send("preview", "open-terminal", undefined);
      opened = true;
    } catch {
      // Keep the reload fallbacks below for already-open preview terminals.
    }
    for (const candidate of [
      "reload-terminal",
      "refresh",
      "reload",
      "refresh-preview",
      "reload-preview",
    ] as const) {
      try {
        await message.request("preview", candidate, {});
        return this._finalize({
          available: true,
          source: "live",
          message: `preview_refresh_ok:${opened ? "open-terminal+" : ""}${candidate}`,
        });
      } catch {
        // try next
      }
    }
    if (opened) {
      return this._finalize({
        available: true,
        source: "live",
        message: "preview_refresh_ok:open-terminal",
      });
    }
    return this._finalize({
      available: false,
      message: "preview_refresh_unavailable:no_supported_message",
    });
  }

  /**
   * @description 查询预览/编辑器错误；无 console message 时回退 project.log。
   * @param input 限制。
   * @returns 错误列表。
   */
  public async queryErrors(
    input: IPreviewQueryErrorsMcpInput,
  ): Promise<IEditorMcpPreviewResult> {
    const limit =
      typeof input.limit === "number" && input.limit > 0
        ? Math.min(input.limit, 200)
        : 50;
    const contains =
      typeof input.contains === "string"
        ? input.contains.trim().toLowerCase()
        : "";
    const sinceOffset =
      typeof input.sinceOffset === "number" &&
      Number.isFinite(input.sinceOffset) &&
      input.sinceOffset >= 0
        ? Math.floor(input.sinceOffset)
        : undefined;
    const filterLines = (errors: readonly string[]): string[] => {
      const withoutNoise = errors.filter(
        (line) =>
          !/^\s*at\s+/u.test(line) && !/\bconsole\.error\b/iu.test(line),
      );
      if (contains.length === 0) {
        return [...withoutNoise];
      }
      return withoutNoise.filter((line) =>
        line.toLowerCase().includes(contains),
      );
    };
    const projectRoot = await this._resolveProjectRoot();
    const logOffset =
      projectRoot != null
        ? this._projectLog.readCurrentOffset(projectRoot)
        : undefined;

    // 验收流水线优先：只看 sinceOffset 之后的 project.log 增量，避免历史噪声误判。
    if (sinceOffset != null && projectRoot != null) {
      const delta = this._projectLog.readDelta({
        path: this._projectLog.resolveLogPath(projectRoot),
        offset: sinceOffset,
      });
      const errors = filterLines(delta.newErrors).slice(-limit);
      const verified = delta.verified && errors.length === 0;
      return this._finalize(
        this._attachQueryErrorsAgentGuidance(
          {
            available: delta.logChecked,
            source: "project_log",
            message:
              contains.length > 0
                ? "preview_errors_ok:project_log:sinceOffset:contains"
                : "preview_errors_ok:project_log:sinceOffset",
            errors,
            url: delta.logPath,
            ...(logOffset != null ? { logOffset } : {}),
            newErrorCount: errors.length,
            verified,
          },
          "delta",
        ),
      );
    }

    const message = this._runtime.message;
    if (message != null && !EditorMcpLumen24Bridge.isCreator2x()) {
      for (const candidate of [
        "query-logs",
        "query-console",
        "query-errors",
      ] as const) {
        try {
          const raw = await message.request("console", candidate, { limit });
          const errors = filterLines(this._parseErrorLines(raw, limit));
          if (errors.length > 0 || raw != null) {
            return this._finalize(
              this._attachQueryErrorsAgentGuidance(
                {
                  available: true,
                  source: "live",
                  message:
                    contains.length > 0
                      ? `preview_errors_ok:${candidate}:contains`
                      : `preview_errors_ok:${candidate}`,
                  errors,
                  ...(logOffset != null ? { logOffset } : {}),
                },
                "snapshot",
              ),
            );
          }
        } catch {
          // try next
        }
      }
    }
    if (projectRoot != null) {
      const recent = this._projectLog.readRecentErrors(projectRoot, limit);
      if (recent.available) {
        return this._finalize(
          this._attachQueryErrorsAgentGuidance(
            {
              available: true,
              source: "project_log",
              message:
                contains.length > 0
                  ? "preview_errors_ok:project_log:contains"
                  : "preview_errors_ok:project_log",
              errors: filterLines(recent.errors),
              url: recent.logPath,
              ...(logOffset != null ? { logOffset } : {}),
            },
            "snapshot",
          ),
        );
      }
    }
    return this._finalize(
      this._attachQueryErrorsAgentGuidance(
        {
          available: false,
          message: "preview_errors_unavailable:no_console_or_project_log",
          errors: [],
          ...(logOffset != null ? { logOffset } : {}),
        },
        "snapshot",
      ),
    );
  }

  /**
   * @description 为 queryErrors 附加 Agent 可读判定（pass/fail 仅增量；无 sinceOffset 为 observe）。
   * @param draft 原始结果片段。
   * @param mode `delta`=sinceOffset 验收；`snapshot`=历史观测。
   * @returns 带 verdict / agentHint 的草稿。
   */
  private _attachQueryErrorsAgentGuidance(
    draft: IEditorMcpPreviewResultDraft,
    mode: "delta" | "snapshot",
  ): IEditorMcpPreviewResultDraft {
    const errors = draft.errors ?? [];
    if (mode === "delta") {
      const pass = draft.verified === true || errors.length === 0;
      return {
        ...draft,
        verdict: pass ? "pass" : "fail",
        agentHint: pass
          ? "Acceptance delta clean (verdict=pass). Do not call scene.save/open for writing."
          : "New errors since sinceOffset (verdict=fail). Fix lumen/asset writes → lumen.commit → preview.refresh → queryErrors again with fresh logOffset.",
        ...(pass
          ? {}
          : {
              recommendedNext: {
                operation: "lumen.validateRefs",
                input: {},
              },
            }),
      };
    }
    return {
      ...draft,
      verdict: "observe",
      agentHint:
        "No sinceOffset: verdict=observe means historical observation only — NOT acceptance failure. Always pass sinceOffset from prior logOffset after writes. Ignore console.error / Sentry stack frames.",
      ...(draft.logOffset != null
        ? {
            recommendedNext: {
              operation: "preview.queryErrors",
              input: { sinceOffset: draft.logOffset },
            },
          }
        : {}),
    };
  }

  /**
   * @description 解析 query 输入。
   * @param input 未校验输入。
   * @returns 输入。
   */
  public readQueryInput(
    input: ContractPayload | undefined,
  ): IPreviewQueryMcpInput {
    if (input == null) {
      return {};
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new Error("editor_mcp_invalid_operation_input");
    }
    const record = input as Record<string, unknown>;
    return {
      platform:
        typeof record.platform === "string" ? record.platform : undefined,
    };
  }

  /**
   * @description 解析 refresh 输入。
   * @param input 未校验输入。
   * @returns 输入。
   */
  public readRefreshInput(
    input: ContractPayload | undefined,
  ): IPreviewRefreshMcpInput {
    if (input == null) {
      return {};
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new Error("editor_mcp_invalid_operation_input");
    }
    const record = input as Record<string, unknown>;
    return {
      refreshAssets: record.refreshAssets === false ? false : true,
    };
  }

  /**
   * @description 解析 errors 输入。
   * @param input 未校验输入。
   * @returns 输入。
   */
  public readErrorsInput(
    input: ContractPayload | undefined,
  ): IPreviewQueryErrorsMcpInput {
    if (input == null) {
      return {};
    }
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new Error("editor_mcp_invalid_operation_input");
    }
    const record = input as Record<string, unknown>;
    return {
      limit: typeof record.limit === "number" ? record.limit : undefined,
      contains:
        typeof record.contains === "string" ? record.contains : undefined,
      sinceOffset:
        typeof record.sinceOffset === "number" &&
        Number.isFinite(record.sinceOffset) &&
        record.sinceOffset >= 0
          ? Math.floor(record.sinceOffset)
          : undefined,
    };
  }

  /**
   * @description 从工程配置 / 可达端口探测拼 fallback URL。
   * @returns fallback 结果。
   */
  private async _queryFallbackFromProject(): Promise<IEditorMcpPreviewResultDraft | null> {
    const projectRoot = await this._resolveProjectRoot();
    if (projectRoot == null) {
      return null;
    }
    const fromSettings = this._readPreviewSettings(projectRoot);
    const projectName = this._readProjectDisplayName(projectRoot);
    const candidatePorts = [
      ...new Set(
        [fromSettings.port, ...EditorMcpPreviewGateway._defaultPorts].filter(
          (port): port is number =>
            typeof port === "number" && Number.isFinite(port),
        ),
      ),
    ];
    /** @description 可达探测结果，优先标题命中本工程名。 */
    const reachable: Array<{
      port: number;
      url: string;
      titleMatched: boolean;
    }> = [];
    for (const port of candidatePorts) {
      const url = `http://127.0.0.1:${port}`;
      const probe = await this._probePreviewServer(url, projectName);
      if (probe.reachable) {
        reachable.push({ port, url, titleMatched: probe.titleMatched });
      }
    }
    const preferred =
      reachable.find((item) => item.titleMatched) ?? reachable[0] ?? null;
    if (preferred != null) {
      // 标题命中本工程 = Browser Preview 实机在跑，升为 live（不再标 fallback）。
      if (preferred.titleMatched) {
        return {
          available: true,
          source: "live",
          message: "preview_query_ok:live_http_title_match",
          url: preferred.url,
          port: preferred.port,
          startScene: fromSettings.startScene,
        };
      }
      return {
        available: true,
        source: "fallback",
        message: "preview_query_ok:fallback_settings_or_default_port",
        url: preferred.url,
        port: preferred.port,
        startScene: fromSettings.startScene,
      };
    }
    const port = fromSettings.port ?? EditorMcpPreviewGateway._defaultPorts[0];
    const url = `http://127.0.0.1:${port}`;
    return {
      available: false,
      source: "fallback",
      message: "preview_query_fallback_unreachable:start_browser_preview",
      url,
      port,
      startScene: fromSettings.startScene,
    };
  }

  /**
   * @description 补齐 startScene：设置缺失时读工程配置，并把 uuid 解析为 path。
   * @param result 预览结果。
   * @returns 增强后的结果。
   */
  private async _enrichStartScene(
    result: IEditorMcpPreviewResultDraft,
  ): Promise<IEditorMcpPreviewResult> {
    const projectRoot = await this._resolveProjectRoot();
    let startScene = result.startScene;
    if (
      (startScene == null || startScene.trim().length === 0) &&
      projectRoot != null
    ) {
      startScene = this._readPreviewSettings(projectRoot).startScene;
    }
    if (startScene == null || startScene.trim().length === 0) {
      return this._finalize(result);
    }
    const trimmed = startScene.trim();
    let startScenePath: string | undefined = result.startScenePath;
    let startSceneDbPath: string | undefined = result.startSceneDbPath;
    if (
      projectRoot != null &&
      (startScenePath == null || startSceneDbPath == null)
    ) {
      const resolved = this._resolveStartScenePath(projectRoot, trimmed);
      startScenePath = resolved.path ?? startScenePath;
      startSceneDbPath = resolved.dbPath ?? startSceneDbPath;
    }
    return this._finalize({
      ...result,
      startScene: trimmed,
      ...(startScenePath != null ? { startScenePath } : {}),
      ...(startSceneDbPath != null ? { startSceneDbPath } : {}),
    });
  }

  /**
   * @description 为预览薄层结果附加 availability。
   * @param result 原始结果片段。
   * @returns 完整预览结果。
   */
  private _finalize(
    result: IEditorMcpThinLayerAvailabilityInput &
      Partial<IEditorMcpPreviewResult>,
  ): IEditorMcpPreviewResult {
    return EditorMcpThinLayerAvailabilityMapper.attach(result);
  }

  /**
   * @description 将启动场景 uuid 解析为工程相对路径。
   * @param projectRoot 工程根。
   * @param startScene uuid 或路径。
   * @returns path / dbPath。
   */
  private _resolveStartScenePath(
    projectRoot: string,
    startScene: string,
  ): { readonly path?: string; readonly dbPath?: string } {
    const normalized = startScene.replace(/^db:\/\//, "").trim();
    if (normalized.toLowerCase().endsWith(".scene")) {
      return {
        path: normalized,
        dbPath: `db://${normalized}`,
      };
    }
    try {
      const catalog = new AssetCatalogBuilder().build(projectRoot);
      const hit = Object.values(catalog.uuidMap).find(
        (entry) =>
          entry.parentUuid.length === 0 &&
          (entry.uuid === normalized ||
            entry.compressedUuid === normalized ||
            entry.uuid === startScene ||
            entry.compressedUuid === startScene),
      );
      if (hit != null) {
        return {
          path: hit.path,
          dbPath: `db://${hit.path}`,
        };
      }
    } catch {
      // catalog optional
    }
    return {};
  }

  /**
   * @description 读取工程显示名（用于多开 Creator 时按预览页标题匹配）。
   * @param projectRoot 工程根。
   * @returns 工程名。
   */
  private _readProjectDisplayName(projectRoot: string): string {
    const packagePath = join(projectRoot, "package.json");
    if (existsSync(packagePath)) {
      try {
        const raw = JSON.parse(readFileSync(packagePath, "utf8")) as unknown;
        if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
          const name = (raw as Record<string, unknown>).name;
          if (typeof name === "string" && name.trim().length > 0) {
            return name.trim();
          }
        }
      } catch {
        // fall through
      }
    }
    const segments = projectRoot
      .replace(/\\/gu, "/")
      .split("/")
      .filter((part) => part.length > 0);
    return segments[segments.length - 1] ?? "project";
  }

  /**
   * @description 读取常见 preview / server 配置文件。
   * @param projectRoot 工程根。
   * @returns 端口与启动场景。
   */
  private _readPreviewSettings(projectRoot: string): {
    readonly port?: number;
    readonly startScene?: string;
  } {
    const candidates = [
      join(projectRoot, "profiles", "v2", "packages", "preview.json"),
      join(projectRoot, "profiles", "v2", "packages", "server.json"),
      join(projectRoot, "settings", "v2", "packages", "preview.json"),
      join(projectRoot, "settings", "v2", "packages", "project.json"),
    ];
    let port: number | undefined;
    let startScene: string | undefined;
    for (const filePath of candidates) {
      if (!existsSync(filePath)) {
        continue;
      }
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        const found = this._extractPreviewSettings(raw);
        if (port == null && found.port != null) {
          port = found.port;
        }
        if (startScene == null && found.startScene != null) {
          startScene = found.startScene;
        }
      } catch {
        // try next
      }
    }
    return { port, startScene };
  }

  /**
   * @description 从配置 JSON（含嵌套 general）提取 port / startScene。
   * @param value 配置对象。
   * @returns 端口与启动场景。
   */
  private _extractPreviewSettings(value: unknown): {
    readonly port?: number;
    readonly startScene?: string;
  } {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const record = value as Record<string, unknown>;
    let port: number | undefined;
    let startScene: string | undefined;
    const visit = (node: Record<string, unknown>, depth: number): void => {
      if (depth > 4) {
        return;
      }
      if (port == null) {
        if (typeof node.port === "number") {
          port = node.port;
        } else if (typeof node.previewPort === "number") {
          port = node.previewPort;
        } else if (typeof node.server_port === "number") {
          port = node.server_port;
        }
      }
      if (startScene == null) {
        if (
          typeof node.startScene === "string" &&
          node.startScene.trim().length > 0
        ) {
          startScene = node.startScene.trim();
        } else if (
          typeof node.launchScene === "string" &&
          node.launchScene.trim().length > 0
        ) {
          startScene = node.launchScene.trim();
        }
      }
      for (const child of Object.values(node)) {
        if (
          child != null &&
          typeof child === "object" &&
          !Array.isArray(child)
        ) {
          visit(child as Record<string, unknown>, depth + 1);
        }
      }
    };
    visit(record, 0);
    return { port, startScene };
  }

  /**
   * @description 探测预览页是否可达，并尽量用 HTML title 匹配工程名。
   * @param url 预览 URL。
   * @param projectName 工程显示名。
   * @returns 可达性与标题匹配。
   */
  private async _probePreviewServer(
    url: string,
    projectName: string,
  ): Promise<{ readonly reachable: boolean; readonly titleMatched: boolean }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });
        if (!(response.ok || response.status < 500)) {
          return { reachable: false, titleMatched: false };
        }
        const text = await response.text();
        const titleMatch = /<title>([^<]*)<\/title>/iu.exec(text);
        const title = titleMatch?.[1] ?? "";
        const titleMatched =
          projectName.length > 0 &&
          title.toLowerCase().includes(projectName.toLowerCase());
        return { reachable: true, titleMatched };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return { reachable: false, titleMatched: false };
    }
  }

  /**
   * @description 探测 URL 是否可连。
   * @param url URL。
   * @returns 是否可达。
   */
  private async _probeUrl(url: string): Promise<boolean> {
    const probe = await this._probePreviewServer(url, "");
    return probe.reachable;
  }

  /**
   * @description 解析预览 payload。
   * @param raw 原始返回。
   * @param source 来源。
   * @returns 结构化结果。
   */
  private _parsePreviewPayload(
    raw: unknown,
    source: "live" | "fallback",
  ): IEditorMcpPreviewResultDraft | null {
    if (raw == null) {
      return null;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return {
        available: true,
        source,
        message: "preview_query_ok",
        port: raw,
        url: `http://127.0.0.1:${raw}`,
      };
    }
    if (typeof raw === "string" && raw.length > 0) {
      if (/^\d+$/.test(raw)) {
        const port = Number(raw);
        return {
          available: true,
          source,
          message: "preview_query_ok",
          port,
          url: `http://127.0.0.1:${port}`,
        };
      }
      return { available: true, source, message: "preview_query_ok", url: raw };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const nestedCandidates = [record];
    for (const key of [
      "data",
      "result",
      "preview",
      "settings",
      "general",
    ] as const) {
      const child = record[key];
      if (child != null && typeof child === "object" && !Array.isArray(child)) {
        nestedCandidates.push(child as Record<string, unknown>);
      }
    }
    let url: string | undefined;
    let port: number | undefined;
    let startScene: string | undefined;
    for (const node of nestedCandidates) {
      if (url == null) {
        if (typeof node.url === "string" && node.url.trim().length > 0) {
          url = node.url.trim();
        } else if (
          typeof node.previewUrl === "string" &&
          node.previewUrl.trim().length > 0
        ) {
          url = node.previewUrl.trim();
        } else if (
          typeof node.previewURL === "string" &&
          node.previewURL.trim().length > 0
        ) {
          url = node.previewURL.trim();
        }
      }
      if (port == null) {
        if (typeof node.port === "number" && Number.isFinite(node.port)) {
          port = node.port;
        } else if (
          typeof node.previewPort === "number" &&
          Number.isFinite(node.previewPort)
        ) {
          port = node.previewPort;
        } else if (
          typeof node.port === "string" &&
          /^\d+$/.test(node.port.trim())
        ) {
          port = Number(node.port.trim());
        }
      }
      if (startScene == null) {
        if (
          typeof node.startScene === "string" &&
          node.startScene.trim().length > 0
        ) {
          startScene = node.startScene.trim();
        } else if (
          typeof node.scene === "string" &&
          node.scene.trim().length > 0
        ) {
          startScene = node.scene.trim();
        } else if (
          typeof node.launchScene === "string" &&
          node.launchScene.trim().length > 0
        ) {
          startScene = node.launchScene.trim();
        }
      }
    }
    if (url == null && port == null && startScene == null) {
      return null;
    }
    return {
      available: true,
      source,
      message: "preview_query_ok",
      url: url ?? (port != null ? `http://127.0.0.1:${port}` : undefined),
      port,
      startScene,
    };
  }

  /**
   * @description 解析错误行。
   * @param raw 原始返回。
   * @param limit 上限。
   * @returns 错误行。
   */
  private _parseErrorLines(raw: unknown, limit: number): readonly string[] {
    if (Array.isArray(raw)) {
      return raw
        .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        .filter((item) => item.length > 0)
        .slice(0, limit);
    }
    if (typeof raw === "string" && raw.length > 0) {
      return raw
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(0, limit);
    }
    if (raw != null && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      if (Array.isArray(record.logs)) {
        return this._parseErrorLines(record.logs, limit);
      }
      if (Array.isArray(record.errors)) {
        return this._parseErrorLines(record.errors, limit);
      }
    }
    return [];
  }
}
