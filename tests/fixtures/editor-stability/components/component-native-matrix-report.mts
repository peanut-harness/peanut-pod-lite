/**
 * @description 中途停止时也逐项保留完整分母，不把未执行字段从状态统计中漏掉。
 */
export class ComponentNativeMatrixReport {
    /**
     * @description 原始执行行不变，缺失组件补为未执行及全部字段待验证。
     * @param components 已冻结的完整输入契约。
     * @param observed 已实际执行或明确跳过的原始行。
     * @returns 与完整契约一一对应的报告行，不提升任何验收状态。
     */
    public static complete(components: readonly { componentType: string; cases: readonly { id: string }[] }[],
        observed: readonly Record<string, unknown>[]): Record<string, unknown>[] {
        const types = new Set(components.map(row => row.componentType));
        if (types.size !== components.length) throw new Error('component_matrix_report_duplicate_contract');
        const actual = new Map<string, Record<string, unknown>>();
        for (const row of observed) {
            if (typeof row.componentType !== 'string' || !types.has(row.componentType) || actual.has(row.componentType)) {
                throw new Error('component_matrix_report_unknown_or_duplicate_execution');
            }
            actual.set(row.componentType, row);
        }
        return components.map(component => actual.get(component.componentType) ?? {
            componentType: component.componentType, status: 'not-executed',
            fields: component.cases.map(field => ({ id: field.id, status: 'pending', reason: 'campaign-not-completed' })),
        });
    }
}
