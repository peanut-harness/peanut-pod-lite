import { LumenAnimationCurveTracks } from "./animation-curve-tracks";
import { LumenJsonAssetIo } from "../io/json-asset";
import { LumenCocosVersion } from "../schema/cocos-version";
import { LumenStandaloneInspectQuery } from "./inspect-query";

/**
 * @description 动画循环模式名 → 引擎数值。
 */
const WRAP_MODE_BY_NAME: Readonly<Record<string, number>> = {
  Default: 0,
  Normal: 1,
  Loop: 2,
  PingPong: 22,
  Reverse: 36,
  LoopReverse: 38,
  PingPongReverse: 54,
};

/**
 * @description 动画事件。
 */
export interface ILumenAnimationEvent {
  /** @description 帧时间（秒）。 */
  readonly frame: number;
  /** @description 回调方法名。 */
  readonly func: string;
  /** @description 字符串参数。 */
  readonly params: readonly string[];
}

/**
 * @description AnimationClip Inspector 快照。
 */
export interface ILumenAnimationClipInspect {
  /** @description 项目相对路径。 */
  readonly path: string;
  /** @description 资产种类。 */
  readonly kind: "animationClip";
  /** @description `_name`。 */
  readonly name: string;
  /** @description 采样率。 */
  readonly sample: number;
  /** @description 播放速度。 */
  readonly speed: number;
  /** @description 循环模式数值。 */
  readonly wrapMode: number;
  /** @description 循环模式名；未知数值时为 `null`。 */
  readonly wrapModeName: string | null;
  /** @description 时长。 */
  readonly duration: number;
  /** @description 是否混合节点 TRS。 */
  readonly enableTrsBlending: boolean;
  /** @description 动画事件。 */
  readonly events: readonly ILumenAnimationEvent[];
  /** @description 旧版 `_curves`。 */
  readonly curves: readonly unknown[];
  /** @description 旧版 `curveDatas`。 */
  readonly curveDatas: Readonly<Record<string, unknown>>;
  /** @description 3.x `_tracks`。 */
  readonly tracks: readonly unknown[];
}

/**
 * @description `.anim` 文档：头字段、事件、曲线/轨道序列化读写。
 */
export class LumenAnimationClipDocument {
  /** @description 读写辅助。 */
  private readonly _io = new LumenJsonAssetIo();

  /** @description 项目相对路径。 */
  private readonly _relativePath: string;

  /** @description 序列化对象。 */
  private readonly _record: Record<string, unknown>;

  /**
   * @description 从已有记录创建文档。
   * @param relativePath 相对路径
   * @param record 动画 JSON
   */
  public constructor(relativePath: string, record: Record<string, unknown>) {
    this._relativePath = relativePath;
    this._record = record;
  }

  /**
   * @description 相对项目根路径。
   * @returns 路径
   */
  public get relativePath(): string {
    return this._relativePath;
  }

  /**
   * @description 资产种类。
   * @returns `animationClip`
   */
  public get kind(): "animationClip" {
    return "animationClip";
  }

  /**
   * @description 创建空动画片段。
   * @param relativePath 相对路径
   * @param name 名称
   * @param template 仅 `empty`
   * @returns 文档
   */
  public static createEmpty(
    relativePath: string,
    name: string,
    template: string = "empty",
  ): LumenAnimationClipDocument {
    if (template !== "empty") {
      throw new Error(`lumen_animation_clip_template_unknown:${template}`);
    }
    return new LumenAnimationClipDocument(relativePath, {
      __type__: "cc.AnimationClip",
      _name: name.trim(),
      _objFlags: 0,
      _native: "",
      sample: 60,
      speed: 1,
      wrapMode: 1,
      enableTrsBlending: false,
      events: [],
      _events: [],
      _duration: 0,
      _keys: [],
      _stepness: 0,
      curveDatas: {},
      _curves: [],
      _commonTargets: [],
      _tracks: [],
      _hash: 0,
    });
  }

  /**
   * @description 从磁盘打开 `.anim`。
   * @param projectRoot 项目根
   * @param relativePath 相对路径
   * @returns 文档
   */
  public static open(
    projectRoot: string,
    relativePath: string,
  ): LumenAnimationClipDocument {
    const io = new LumenJsonAssetIo();
    const record = io.readRecord(
      projectRoot,
      relativePath,
      ["cc.AnimationClip"],
      "lumen_animation_clip_missing",
      "lumen_animation_clip_json_corrupt",
    );
    return new LumenAnimationClipDocument(relativePath, record);
  }

  /**
   * @description 检视公开字段。
   * @param query 动画不接受查询键
   * @returns 快照
   */
  public inspect(
    query?: Readonly<Record<string, unknown>>,
  ): ILumenAnimationClipInspect {
    LumenStandaloneInspectQuery.rejectIfPresent(query, "animationClip");
    const wrapMode =
      typeof this._record.wrapMode === "number" ? this._record.wrapMode : 1;
    return {
      path: this._relativePath,
      kind: "animationClip",
      name: typeof this._record._name === "string" ? this._record._name : "",
      sample:
        typeof this._record.sample === "number" ? this._record.sample : 60,
      speed: typeof this._record.speed === "number" ? this._record.speed : 1,
      wrapMode,
      wrapModeName: this._wrapModeName(wrapMode),
      duration:
        typeof this._record._duration === "number" ? this._record._duration : 0,
      enableTrsBlending: this._record.enableTrsBlending === true,
      events: this._readEvents(),
      curves: this._readArray(this._record._curves),
      curveDatas: this._readObject(this._record.curveDatas),
      tracks: this._readArray(this._record._tracks),
    };
  }

  /**
   * @description 写入 Inspector 公开补丁。
   * @param patch 头字段 / `events` / `curves`；原始 `curveDatas`/`tracks` 须 `allowRawTracks:true`
   */
  public applyPatch(patch: Readonly<Record<string, unknown>>): void {
    const allowed = [
      "name",
      "sample",
      "speed",
      "wrapMode",
      "duration",
      "enableTrsBlending",
      "events",
      "curves",
      "curveDatas",
      "tracks",
      "allowRawTracks",
    ];
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) {
        throw new Error(
          `lumen_animation_clip_property_not_editable:${key}:allowed=${allowed.join(",")}`,
        );
      }
    }
    const allowRawTracks = patch.allowRawTracks === true;
    if (
      (patch.tracks !== undefined || patch.curveDatas !== undefined) &&
      !allowRawTracks
    ) {
      throw new Error(
        "lumen_animation_clip_raw_tracks_blocked:use_curves_or_events_or_pass_allowRawTracks_true",
      );
    }
    const nativeTracks = patch.curves === undefined
      ? null : LumenAnimationCurveTracks.encode(patch.curves);
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string") {
        throw new Error("lumen_property_type:name:string");
      }
      this._record._name = patch.name;
    }
    if (patch.sample !== undefined) {
      this._record.sample = this._requirePositiveNumber(patch.sample, "sample");
    }
    if (patch.speed !== undefined) {
      this._record.speed = this._requireFiniteNumber(patch.speed, "speed");
    }
    if (patch.wrapMode !== undefined) {
      this._record.wrapMode = this._encodeWrapMode(patch.wrapMode);
    }
    if (patch.duration !== undefined) {
      this._record._duration = this._requireNonNegativeNumber(
        patch.duration,
        "duration",
      );
    }
    if (patch.enableTrsBlending !== undefined) {
      if (typeof patch.enableTrsBlending !== "boolean") {
        throw new Error("lumen_property_type:enableTrsBlending:boolean");
      }
      this._record.enableTrsBlending = patch.enableTrsBlending;
    }
    if (patch.events !== undefined) {
      const events = this._encodeEvents(patch.events);
      this._record.events = events;
      this._record._events = events;
    }
    if (patch.curves !== undefined) {
      this._applyCurves(patch.curves);
      if (nativeTracks !== null && (nativeTracks.length > 0
        || (Array.isArray(patch.curves) && patch.curves.length === 0))) {
        this._record._tracks = nativeTracks;
        if (nativeTracks.length === 0) {
          this._record._keys = [];
        }
      }
    }
    if (patch.curveDatas !== undefined) {
      if (
        patch.curveDatas == null ||
        typeof patch.curveDatas !== "object" ||
        Array.isArray(patch.curveDatas)
      ) {
        throw new Error("lumen_property_type:curveDatas:object");
      }
      this._assertRawCurveDatas(patch.curveDatas);
      this._record.curveDatas = this._io.cloneJson(patch.curveDatas);
    }
    if (patch.tracks !== undefined) {
      if (!Array.isArray(patch.tracks)) {
        throw new Error("lumen_property_type:tracks:array");
      }
      this._assertRawTracks(patch.tracks);
      this._record._tracks = this._io.cloneJson(patch.tracks);
    }
  }

  /**
   * @description 拒绝把整份 AnimationClip / 非对象条目塞进 `_tracks`。
   * @param tracks 原始轨道数组。
   * @returns 无。
   */
  private _assertRawTracks(tracks: readonly unknown[]): void {
    for (let index = 0; index < tracks.length; index += 1) {
      const item = tracks[index];
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(
          `lumen_animation_clip_tracks_invalid:${index}:object_required`,
        );
      }
      const record = item as Record<string, unknown>;
      if (record.__type__ === "cc.AnimationClip") {
        throw new Error(
          `lumen_animation_clip_tracks_invalid:${index}:clip_dump_forbidden`,
        );
      }
    }
  }

  /**
   * @description 校验 `curveDatas` 键为相对动画根的层级 path（可为空根），禁止裸显示名误当 path。
   * @param curveDatas 原始 curveDatas。
   * @returns 无。
   */
  private _assertRawCurveDatas(curveDatas: unknown): void {
    if (
      curveDatas == null ||
      typeof curveDatas !== "object" ||
      Array.isArray(curveDatas)
    ) {
      return;
    }
    for (const key of Object.keys(curveDatas as Record<string, unknown>)) {
      if (key.length === 0) {
        continue;
      }
      // 单段名允许（相对根下直接子节点）；含空格/反斜杠视为误用显示名或盘路径。
      if (
        /\s/.test(key) ||
        key.includes("\\") ||
        key.startsWith("db://") ||
        key.includes("..")
      ) {
        throw new Error(`lumen_animation_clip_curveDatas_path_invalid:${key}`);
      }
    }
  }

  /**
   * @description 写回磁盘与最小 meta。
   * @param projectRoot 项目根
   * @param writeMetaIfMissing 缺少 meta 时是否创建
   */
  /**
   * @description 序列化内存动画源文档，供原生首次创建。
   * @returns 源 JSON 文本。
   */
  public serializeNativeSource(): string {
    return `${JSON.stringify(this._record, null, 2)}\n`;
  }

  /**
   * @description 写回源文档和 meta。
   * @param projectRoot 工程根。
   * @param writeMetaIfMissing 是否写入缺失 meta。
   * @param cocosVersion Creator 版本。
   */
  public save(
    projectRoot: string,
    writeMetaIfMissing: boolean = true,
    cocosVersion: LumenCocosVersion = LumenCocosVersion.DEFAULT,
  ): void {
    this._io.writeRecord(
      projectRoot,
      this._relativePath,
      this._record,
      "animation-clip",
      writeMetaIfMissing,
      cocosVersion,
    );
  }

  /**
   * @description 读取事件列表。
   * @returns 事件
   */
  private _readEvents(): ILumenAnimationEvent[] {
    const raw = Array.isArray(this._record.events)
      ? this._record.events
      : this._record._events;
    if (!Array.isArray(raw)) {
      return [];
    }
    const events: ILumenAnimationEvent[] = [];
    for (const item of raw) {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const func = typeof record.func === "string" ? record.func : "";
      const frame = typeof record.frame === "number" ? record.frame : 0;
      const params = Array.isArray(record.params)
        ? record.params.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      events.push({ frame, func, params });
    }
    return events;
  }

  /**
   * @description 编码事件列表。
   * @param value 公开事件
   * @returns 序列化事件
   */
  private _encodeEvents(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
      throw new Error("lumen_property_type:events:array");
    }
    return value.map((item, index) => {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`lumen_property_type:events[${index}]:object`);
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.frame !== "number" ||
        !Number.isFinite(record.frame) ||
        record.frame < 0
      ) {
        throw new Error(`lumen_property_type:events[${index}].frame:number>=0`);
      }
      if (typeof record.func !== "string") {
        throw new Error(`lumen_property_type:events[${index}].func:string`);
      }
      const params = Array.isArray(record.params)
        ? record.params.map((param, paramIndex) => {
            if (typeof param !== "string") {
              throw new Error(
                `lumen_property_type:events[${index}].params[${paramIndex}]:string`,
              );
            }
            return param;
          })
        : [];
      return { frame: record.frame, func: record.func, params };
    });
  }

  /**
   * @description 写入 `_curves`：简写 `{ path, property, keys, values }` 或原样对象数组。
   * @param value 曲线补丁
   */
  private _applyCurves(value: unknown): void {
    if (!Array.isArray(value)) {
      throw new Error("lumen_property_type:curves:array");
    }
    const keys: unknown[] = [];
    const curves: unknown[] = [];
    value.forEach((item, index) => {
      if (item == null || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`lumen_property_type:curves[${index}]:object`);
      }
      const record = item as Record<string, unknown>;
      if (Array.isArray(record.modifiers) || record.data != null) {
        curves.push(this._io.cloneJson(record));
        return;
      }
      if (
        typeof record.path !== "string" ||
        typeof record.property !== "string"
      ) {
        throw new Error(
          `lumen_property_type:curves[${index}]:path+property_or_modifiers`,
        );
      }
      if (
        /\s/.test(record.path) ||
        record.path.includes("\\") ||
        record.path.includes("..")
      ) {
        throw new Error(
          `lumen_animation_clip_curve_path_invalid:${index}:use_hierarchy_path_from_animated_root`,
        );
      }
      if (!Array.isArray(record.keys) || !Array.isArray(record.values)) {
        throw new Error(`lumen_property_type:curves[${index}]:keys+values`);
      }
      const modifiers: unknown[] = [record.path];
      if (typeof record.component === "string" && record.component.length > 0) {
        modifiers.push(record.component);
      }
      modifiers.push(record.property);
      keys.push(this._io.cloneJson(record.keys));
      curves.push({
        modifiers,
        data: {
          keys: keys.length - 1,
          values: this._io.cloneJson(record.values),
          interpolate: record.interpolate !== false,
        },
      });
    });
    this._record._curves = curves;
    if (keys.length > 0) {
      this._record._keys = keys;
    }
  }

  /**
   * @description 编码 wrapMode。
   * @param value 数值或模式名
   * @returns 数值
   */
  private _encodeWrapMode(value: unknown): number {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return value;
    }
    if (typeof value === "string") {
      for (const [name, numeric] of Object.entries(WRAP_MODE_BY_NAME)) {
        if (name === value) {
          return numeric;
        }
      }
    }
    throw new Error(
      "lumen_property_type:wrapMode:int_or_Normal|Loop|PingPong|Reverse|LoopReverse|PingPongReverse|Default",
    );
  }

  /**
   * @description 由数值反查模式名。
   * @param wrapMode 数值
   * @returns 名或 `null`
   */
  private _wrapModeName(wrapMode: number): string | null {
    for (const [name, value] of Object.entries(WRAP_MODE_BY_NAME)) {
      if (value === wrapMode) {
        return name;
      }
    }
    return null;
  }

  /**
   * @description 读取对象数组拷贝。
   * @param raw 原始值
   * @returns 数组
   */
  private _readArray(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const cloned = this._io.cloneJson(raw);
    return Array.isArray(cloned) ? cloned : [];
  }

  /**
   * @description 读取对象拷贝。
   * @param raw 原始值
   * @returns 对象
   */
  private _readObject(raw: unknown): Record<string, unknown> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    const cloned = this._io.cloneJson(raw);
    if (cloned == null || typeof cloned !== "object" || Array.isArray(cloned)) {
      return {};
    }
    return cloned as Record<string, unknown>;
  }

  /**
   * @description 要求正数。
   * @param value 值
   * @param apiName 字段名
   * @returns 数字
   */
  private _requirePositiveNumber(value: unknown, apiName: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`lumen_property_type:${apiName}:number>0`);
    }
    return value;
  }

  /**
   * @description 要求有限数字。
   * @param value 值
   * @param apiName 字段名
   * @returns 数字
   */
  private _requireFiniteNumber(value: unknown, apiName: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`lumen_property_type:${apiName}:number`);
    }
    return value;
  }

  /**
   * @description 要求非负数字。
   * @param value 值
   * @param apiName 字段名
   * @returns 数字
   */
  private _requireNonNegativeNumber(value: unknown, apiName: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`lumen_property_type:${apiName}:number>=0`);
    }
    return value;
  }
}
