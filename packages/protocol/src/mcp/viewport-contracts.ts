/**
 * @description Creator 视口查询结果中的相机文本快照。
 */
export interface IViewportCameraSnapshot {
    /**
     * @description 相机位置。
     */
    readonly position: readonly [number, number, number];
    /**
     * @description 相机旋转四元数。
     */
    readonly rotation: readonly [number, number, number, number];
    /**
     * @description 相机视点中心。
     */
    readonly viewCenter: readonly [number, number, number];
    /**
     * @description 视口内容矩形。
     */
    readonly contentRect: Readonly<{ x: number; y: number; width: number; height: number }>;
    /**
     * @description 2D缩放比例。
     */
    readonly scale: number;
}

/**
 * @description 当前 Creator 视口中由原生接口确认的状态。
 */
export interface IViewportState {
    /**
     * @description 精确宿主版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 查询到的2D模式。
     */
    readonly is2D: boolean | null;
    /**
     * @description 查询到的网格可见性。
     */
    readonly gridVisible: boolean | null;
    /**
     * @description 相机数值；接口不支持或读取失败时为null。
     */
    readonly camera: IViewportCameraSnapshot | null;
    /**
     * @description 每个字段的查询能力与失败说明。
     */
    readonly fields: Readonly<Record<string, Readonly<{ supported: boolean; available: boolean; failureCode: string | null }>>>;
}

/**
 * @description 指定 Creator 视口模式或网格的修改请求。
 */
export interface IViewportSetStateInput {
    /**
     * @description 可选2D模式。
     */
    readonly is2D?: boolean;
    /**
     * @description 可选网格可见性。
     */
    readonly gridVisible?: boolean;
}

/**
 * @description 视口控制的逐字段受理和回读证据。
 */
export interface IViewportMutationResult {
    /**
     * @description 是否每个请求字段均经原生接口回读验证。
     */
    readonly ok: boolean;
    /**
     * @description 完成状态，不将消息受理冒充为已验证。
     */
    readonly status: 'verified' | 'accepted_unverified' | 'partial_failure' | 'refused';
    /**
     * @description 精确宿主版本。
     */
    readonly creatorVersion: string;
    /**
     * @description 逐字段结果。
     */
    readonly fields: Readonly<Record<string, Readonly<{ requested: unknown; accepted: boolean; verified: boolean; actual: unknown; failureCode: string | null }>>>;
}
