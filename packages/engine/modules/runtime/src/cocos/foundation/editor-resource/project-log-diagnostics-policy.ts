/**
 * @description 固定容量策略；不允许外部请求扩大资源上限。
 */
export class ProjectLogDiagnosticsPolicy {
    /**
     * @description 单次实际读取上限，含游标锚点验证。
     */
    public static readonly scanBytes = 1024 * 1024;
    /**
     * @description UTF-8 JSON响应最大字节数。
     */
    public static readonly responseBytes = 64 * 1024;
    /**
     * @description 最大匹配数。
     */
    public static readonly matches = 100;
    /**
     * @description 最大前后上下文行数。
     */
    public static readonly context = 10;
    /**
     * @description 默认上下文行数。
     */
    public static readonly defaultContext = 2;
    /**
     * @description 游标锚点最大字节数。
     */
    public static readonly anchorBytes = 64;
    /**
     * @description 单行片段上限，保证一项也能容纳在响应预算内。
     */
    public static readonly fragmentBytes = 384;
}

