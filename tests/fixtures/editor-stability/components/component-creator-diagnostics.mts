/**
 * @description 仅增加同版SDK支持的诊断输出，不屏蔽日志或改变警告阈值。
 */
export class ComponentCreatorDiagnostics {
    /**
     * @description 显式选择3.8.7启动器已有的metric选项；未知输入和未核验版本拒绝。
     * @param value 工程登记中的有限布尔开关。
     * @param version 已核对的精确版本。
     * @returns 只包含官方诊断开关的参数。
     */
    public static args(value: unknown, version: string): string[] {
        if (value === undefined || value === false) return [];
        if (value !== true) throw new Error('component_creator_diagnostics_invalid');
        if (version !== '3.8.7') throw new Error('component_creator_diagnostics_version_unverified');
        return ['--metric'];
    }
}
